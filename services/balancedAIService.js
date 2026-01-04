const axios = require("axios");
const dotenv = require("dotenv");
const logger = require("../logger");
const flowService = require("./conversationFlowService");

dotenv.config();

class BalancedAIService {
  constructor() {
    this.providers = {
      deepinfra: {
        baseURL: process.env.DEEPINFRA_BASE_URL,
        apiKey: process.env.DEEPINFRA_API_KEY,
        models: process.env.DEEPINFRA_MODELS
          ? process.env.DEEPINFRA_MODELS.split(",")
          : []
      },
      fireworks: {
        baseURL: process.env.FIREWORKS_BASE_URL,
        apiKey: process.env.FIREWORKS_API_KEY,
        models: process.env.FIREWORKS_MODELS
          ? process.env.FIREWORKS_MODELS.split(",")
          : []
      }
    };

    // Track recent responses to encourage variety
    this.recentResponses = new Map();
    this.maxRecentResponses = 5;

    logger.info("BALANCED_AI_SERVICE", "Chain-limited AI Service initialized");
  }

  getAllAvailableModels() {
    const models = [];
    for (const [provider, config] of Object.entries(this.providers)) {
      if (config.apiKey && config.models.length > 0) {
        config.models.forEach(model => {
          models.push({
            id: model.trim(),
            name: this.formatModelName(model.trim()),
            provider: provider
          });
        });
      }
    }
    return models;
  }

  formatModelName(modelId) {
    const parts = modelId.split("/");
    const modelName = parts[parts.length - 1];
    return modelName.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  }

  // Track responses to encourage variety
  trackResponse(conversationId, aiName, response) {
    const key = `${conversationId}-${aiName}`;
    if (!this.recentResponses.has(key)) {
      this.recentResponses.set(key, []);
    }

    const responses = this.recentResponses.get(key);
    responses.push({
      content: response.toLowerCase().substring(0, 50),
      timestamp: Date.now()
    });

    // Keep only recent responses
    if (responses.length > this.maxRecentResponses) {
      responses.shift();
    }
  }

  // Get variety prompt based on conversation flow
  getVarietyPrompt(
    conversationId,
    aiName,
    messageCount,
    wasMentioned = false,
    recentMessages = []
  ) {
    if (wasMentioned) {
      // Check if this is part of a back-and-forth chain
      const recentMentions = recentMessages
        .slice(-3)
        .filter(msg => msg.content && msg.content.includes("@"));

      if (recentMentions.length >= 2) {
        return "You were mentioned, but avoid creating a long back-and-forth. Respond briefly and let others join the conversation.";
      } else {
        return "You were specifically mentioned - respond directly but keep it brief.";
      }
    }

    const prompts = [
      "Ask a thoughtful question to engage others.",
      "Share a different perspective from what's been said.",
      "Build on someone else's point with a short comment.",
      "Offer a practical suggestion or example.",
      "Express agreement or disagreement respectfully and briefly.",
      "Reference a specific previous comment using @Name format.",
      "Bring up a related point that hasn't been discussed yet.",
      "When a decision is made on an approach, post the first few lines of code to get the ball rolling and invite others to add the next lines.",
      "When a bug is mentioned, ask for the exact error message and environment, then immediately try to reproduce it in a local or sandbox setup.",
      "If the group is debating between two technical solutions, quickly prototype the core logic of both and share the results to compare.",
      "Break down the requested feature into the smallest possible working piece of code and volunteer to build that first piece.",
      "Instead of just discussing a code approach, propose: 'Let's test this hypothesis. I'll write a quick function to see if it works.",
      "If code is requested, suggest writing a small snippet right now in the chat (if possible) or in a shared environment, and tag someone (@Name) to review or run it.",
      "Flag a potential obstacle to execution early so the group can problem-solve it.",
      "Break down a big suggestion into a smaller, immediate first step we can take.",
      "If the chat is moving fast, briefly recap the last two points before adding yours.",
      "Offer a concise, real-world analogy to illustrate a complex point.",
      "Ask for clarification on a point that wasn't fully explained.",
      "Politently introduce a gentle counterpoint with 'Have we considered...'",
      "Clarify a potential misunderstanding before it derails the conversation.",
      "Call out common ground when the discussion feels tense or divided."
    ];

    return prompts[messageCount % prompts.length];
  }

  async generateResponse(
    modelId,
    provider,
    conversationId,
    currentParticipant,
    history,
    conversationTopic,
    onChunk = null
  ) {
    const providerConfig = this.providers[provider];
    logger.info("BALANCED_AI_SERVICE", "Generating chain-limited response", {
      modelId,
      provider,
      participantName: currentParticipant.personality_name,
      historyLength: history.length
    });

    if (!providerConfig || !providerConfig.apiKey) {
      throw new Error(`Provider ${provider} not configured`);
    }

    try {
      // Get recent conversation (last 15 messages to keep context manageable)
      const recentHistory = history.slice(-15);

      const conversationContext = recentHistory
        .map(msg => {
          const speakerName =
            msg.sender_name || (msg.sender_type === "user" ? "User" : "AI");
          return `${speakerName}: ${msg.content}`;
        })
        .join("\n\n");

      // Check if this participant was mentioned
      const lastMessage = recentHistory[recentHistory.length - 1];
      const wasMentioned =
        lastMessage &&
        this.checkIfMentioned(
          currentParticipant.personality_name,
          lastMessage.content
        );

      // Get mention-aware context
      const mentionContext = flowService.generateMentionContext(
        conversationId,
        currentParticipant,
        recentHistory
      );

      // Get variety prompt with chain awareness
      const varietyPrompt = this.getVarietyPrompt(
        conversationId,
        currentParticipant.personality_name,
        history.length,
        wasMentioned,
        recentHistory
      );

      // Check for recent @mention patterns to discourage chains
      const recentMentionCount = recentHistory
        .slice(-5)
        .filter(msg => msg.content && msg.content.includes("@")).length;

      let mentionGuidance = "";
      if (recentMentionCount >= 3) {
        mentionGuidance =
          "\n- IMPORTANT: There have been many @mentions recently. Avoid using @mentions in your response to let the conversation flow naturally.";
      } else if (wasMentioned) {
        mentionGuidance =
          "\n- You can @mention someone else if relevant, but keep it brief to avoid long chains.";
      } else {
        mentionGuidance =
          "\n- You can use @Name to reference someone if truly relevant, but don't overuse it.";
      }

      // Enhanced prompt with chain prevention
      const userPrompt = `You are ${currentParticipant.personality_name}. ${currentParticipant.system_instruction}

Topic: "${conversationTopic}"

Recent conversation:
${conversationContext}

Instructions:
- ${varietyPrompt}
- If the topic is question, you should debate over all other participant, just agree with x participant if you really think like him, otherwise, debate and provide your point of view.
- If the topic is related to code, you must also debate, but provide some snippet of code, or complete code, but not on every turn, argue, debate sometime only with text. 
- You are debating with other participant. Even you can agree with other participant, you are not working with them eg: 'let's implement this', but rather 'in my own opinion, the best way to implement this is ....' or 'That statement is false, and science already proved it' etc.
- You do not have access to tools, no email access, no terminal access, no web access, no private message, etc etc, but only pure text output.
- Don't halucinate, and don't mention thing you are not sure about it.
- Don't repeat what others have already said but rather debate if you are not agreeing with them. ${mentionContext}

${currentParticipant.personality_name}:`;

      const messages = [
        {
          role: "user",
          content: userPrompt
        }
      ];

      const requestPayload = {
        model: modelId,
        messages: messages,
        max_tokens: 1000, // Reduced further to encourage brevity
        temperature: 0.7,
        top_p: 0.9,
        frequency_penalty: 0.3, // Increased to reduce repetition
        presence_penalty: 0.0,
        stream: true
      };

      const requestConfig = {
        headers: {
          Authorization: `Bearer ${providerConfig.apiKey}`,
          "Content-Type": "application/json"
        },
        responseType: "stream",
        timeout: 300000
      };

      logger.apiMessage(provider, modelId, "CHAIN_LIMITED_REQUEST_SENT", {
        url: `${providerConfig.baseURL}/chat/completions`,
        payload: requestPayload,
        wasMentioned,
        recentMentionCount,
        mentionContext: !!mentionContext
      });

      const response = await axios.post(
        `${providerConfig.baseURL}/chat/completions`,
        requestPayload,
        requestConfig
      );

      return new Promise((resolve, reject) => {
        let fullText = "";
        let buffer = "";

        response.data.on("data", chunk => {
          try {
            const chunkStr = chunk.toString();
            buffer += chunkStr;

            const lines = buffer.split("\n");
            buffer = lines.pop();

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine || trimmedLine === "data: [DONE]") continue;

              if (trimmedLine.startsWith("data: ")) {
                try {
                  const jsonStr = trimmedLine.substring(6);
                  const json = JSON.parse(jsonStr);

                  if (
                    json.choices &&
                    json.choices[0].delta &&
                    json.choices[0].delta.content
                  ) {
                    const content = json.choices[0].delta.content;
                    fullText += content;
                    if (onChunk) {
                      onChunk(content);
                    }
                  }
                } catch (e) {
                  logger.warn("BALANCED_AI_SERVICE", "Error parsing chunk", {
                    error: e.message
                  });
                }
              }
            }
          } catch (error) {
            logger.error("BALANCED_AI_SERVICE", "Error processing chunk", {
              error: error.message
            });
          }
        });

        response.data.on("end", () => {
          try {
            const cleaned = this.cleanResponse(
              fullText,
              currentParticipant.personality_name
            );

            // Track this response
            this.trackResponse(
              conversationId,
              currentParticipant.personality_name,
              cleaned
            );

            logger.apiMessage(
              provider,
              modelId,
              "CHAIN_LIMITED_RESPONSE_RECEIVED",
              {
                rawResponse: fullText,
                cleanedResponse: cleaned,
                finalLength: cleaned.length,
                wasMentioned,
                containsMentions: this.containsMentions(cleaned),
                recentMentionCount
              }
            );

            logger.info(
              "BALANCED_AI_SERVICE",
              "Chain-limited response completed",
              {
                modelId,
                provider,
                responseLength: cleaned.length,
                wasMentioned,
                containsMentions: this.containsMentions(cleaned)
              }
            );

            resolve(cleaned);
          } catch (error) {
            logger.error(
              "BALANCED_AI_SERVICE",
              "Error processing final response",
              { error: error.message }
            );
            reject(error);
          }
        });

        response.data.on("error", err => {
          logger.error("BALANCED_AI_SERVICE", "Stream error", {
            error: err.message
          });
          reject(err);
        });
      });
    } catch (error) {
      logger.error("BALANCED_AI_SERVICE", "Request failed", {
        modelId,
        provider,
        error: error.response?.data || error.message
      });
      throw new Error(
        `Failed to generate response: ${error.response?.data?.error?.message || error.message}`
      );
    }
  }

  // Check if a participant was mentioned in content
  checkIfMentioned(participantName, content) {
    if (!content) return false;

    const mentionPattern = /@(\w+)/g;
    let match;

    while ((match = mentionPattern.exec(content)) !== null) {
      const mentionedName = match[1].toLowerCase();
      const participantNameLower = participantName.toLowerCase();

      if (
        participantNameLower === mentionedName ||
        participantNameLower.includes(mentionedName) ||
        mentionedName.includes(participantNameLower)
      ) {
        return true;
      }
    }

    return false;
  }

  // Check if response contains mentions
  containsMentions(content) {
    return /@\w+/.test(content);
  }

  cleanResponse(response, participantName) {
    let cleaned = response.trim();

    // Remove participant name prefix
    const prefixPattern = new RegExp(`^${participantName}:\\s*`, "i");
    cleaned = cleaned.replace(prefixPattern, "");

    // Remove common response prefixes
    cleaned = cleaned.replace(/^(Here is|My response|I think|Let me):\s*/i, "");

    // Remove excessive formatting but keep @ mentions
    cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, "$1"); // Remove bold
    cleaned = cleaned.replace(/_{2,}/g, ""); // Remove multiple underscores

    return cleaned;
  }

  async generatePersonalityInstruction(
    modelId,
    provider,
    personalityName,
    personalityShortDetails
  ) {
    logger.info("BALANCED_AI_SERVICE", "Generating personality", {
      modelId,
      provider,
      personalityName
    });
    try {
      const messages = [
        {
          role: "user",
          content: `Create a brief personality description for "${personalityName} (${personalityShortDetails}" in group discussions. Focus on their communication style and expertise. Keep it under 100 words, and just provide this, nothing else, no confirmation, no question or whatever, just the personality description like that eg: "You are ${personalityName}, and you are the world best coder, everytime someone say something, you...." rather than "${personalityName} is the best coder, everytime someone say something, he..."`
        }
      ];

      const requestPayload = {
        model: modelId,
        messages: messages,
        max_tokens: 4000,
        temperature: 0.3,
        top_p: 0.9,
        frequency_penalty: 0.3, // Increased to reduce repetition
        presence_penalty: 0.0
      };

      const response = await axios.post(
        `${this.providers[provider].baseURL}/chat/completions`,
        requestPayload,
        {
          headers: {
            Authorization: `Bearer ${this.providers[provider].apiKey}`,
            "Content-Type": "application/json"
          },
          timeout: 60000
        }
      );

      const instruction = response.data.choices[0].message.content.trim();
      logger.info("BALANCED_AI_SERVICE", "Personality generated", {
        length: instruction.length
      });
      return instruction;
    } catch (error) {
      logger.error("BALANCED_AI_SERVICE", "Error generating personality", {
        error: error.message
      });
      return `You are ${personalityName}, a thoughtful participant who brings valuable insights to discussions and engages constructively with others.`;
    }
  }

  async generateTopicOpeningMessage(
    modelId,
    provider,
    personalityName,
    personalityDetails,
    topic,
    onChunk = null
  ) {
    logger.info("BALANCED_AI_SERVICE", "Generating opening message", {
      modelId,
      provider,
      personalityName,
      topic
    });

    try {
      const messages = [
        {
          role: "user",
          content: `You are ${personalityName}. ${personalityDetails}

Start a discussion about: "${topic}"

Guidelines:
- Keep it brief and engaging (1-2 sentences)
- Share your initial thought or question
- Invite others to participate naturally
- Be conversational, not overly formal
- Avoid @mentions in opening messages to let conversation flow naturally

Your opening message:`
        }
      ];

      const requestPayload = {
        model: modelId,
        messages: messages,
        max_tokens: 1000,
        temperature: 0.7,
        top_p: 0.9,
        frequency_penalty: 0.3, // Increased to reduce repetition
        presence_penalty: 0.0,
        stream: true
      };

      const response = await axios.post(
        `${this.providers[provider].baseURL}/chat/completions`,
        requestPayload,
        {
          headers: {
            Authorization: `Bearer ${this.providers[provider].apiKey}`,
            "Content-Type": "application/json"
          },
          responseType: "stream",
          timeout: 60000
        }
      );

      return new Promise((resolve, reject) => {
        let fullText = "";
        let buffer = "";

        response.data.on("data", chunk => {
          try {
            const chunkStr = chunk.toString();
            buffer += chunkStr;
            const lines = buffer.split("\n");
            buffer = lines.pop();

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine || trimmedLine === "data: [DONE]") continue;

              if (trimmedLine.startsWith("data: ")) {
                try {
                  const jsonStr = trimmedLine.substring(6);
                  const json = JSON.parse(jsonStr);
                  if (
                    json.choices &&
                    json.choices[0].delta &&
                    json.choices[0].delta.content
                  ) {
                    const content = json.choices[0].delta.content;
                    fullText += content;
                    if (onChunk) onChunk(content);
                  }
                } catch (e) {
                  logger.warn(
                    "BALANCED_AI_SERVICE",
                    "Error parsing opening chunk",
                    { error: e.message }
                  );
                }
              }
            }
          } catch (error) {
            logger.error(
              "BALANCED_AI_SERVICE",
              "Error processing opening chunk",
              { error: error.message }
            );
          }
        });

        response.data.on("end", () => {
          const cleaned = this.cleanResponse(fullText, personalityName);
          logger.info("BALANCED_AI_SERVICE", "Opening message completed", {
            responseLength: cleaned.length,
            containsMentions: this.containsMentions(cleaned)
          });
          resolve(cleaned);
        });

        response.data.on("error", err => {
          logger.error("BALANCED_AI_SERVICE", "Opening stream error", {
            error: err.message
          });
          reject(err);
        });
      });
    } catch (error) {
      logger.error("BALANCED_AI_SERVICE", "Error generating opening", {
        error: error.message
      });
      return `I think ${topic} is really interesting. What are your thoughts on this?`;
    }
  }
}

module.exports = new BalancedAIService();
