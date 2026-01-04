const axios = require("axios");
const dotenv = require("dotenv");
const logger = require("../logger");
const flowService = require("./flow-service");

dotenv.config();

/**
* Balanced AI Service - Manages AI interactions with chain-limiting features
* 
* @description This service orchestrates AI responses across multiple providers
* (DeepInfra and Fireworks) while implementing conversation flow management
* to prevent long back-and-forth chains. It tracks recent responses, detects
* mentions, and encourages variety in participant interactions.
* 
* Key features:
* - Multi-provider AI model support
* - Response tracking for conversation variety
* - Mention detection and chain prevention
* - Streaming response processing
* - Personality and topic generation
*/
class AIService {
 /**
  * @description Initializes the Balanced AI Service with provider configurations
  * from environment variables and sets up response tracking for conversation
  * variety management.
  */
 constructor() {
   // Provider configurations loaded from environment variables
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

   // Track recent responses to encourage variety and prevent repetition
   this.recentResponses = new Map();
   // Maximum number of recent responses to keep per conversation-participant pair
   this.maxRecentResponses = 5;

   logger.info("BALANCED_AI_SERVICE", "Chain-limited AI Service initialized");
 }

 /**
  * @description Retrieves all available AI models across configured providers
  * @returns {Array<{id: string, name: string, provider: string}>} Array of available model objects
  */
 getAllAvailableModels() {
   const models = [];
   // Iterate through each provider and collect their configured models
   for (const [provider, config] of Object.entries(this.providers)) {
     // Only include providers with valid API keys and models
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

 /**
  * @description Formats a model ID into a readable display name
  * @param {string} modelId - The raw model identifier (e.g., "provider/model-name")
  * @returns {string} Formatted model name with spaces and proper capitalization
  */
 formatModelName(modelId) {
   const parts = modelId.split("/");
   const modelName = parts[parts.length - 1];
   // Replace hyphens with spaces and capitalize each word
   return modelName.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
 }

 /**
  * @description Tracks AI responses to encourage variety in future responses
  * @param {string} conversationId - Unique identifier for the conversation
  * @param {string} aiName - Name of the AI participant
  * @param {string} response - The generated response content
  */
 trackResponse(conversationId, aiName, response) {
   const key = `${conversationId}-${aiName}`;
   if (!this.recentResponses.has(key)) {
     this.recentResponses.set(key, []);
   }

   const responses = this.recentResponses.get(key);
   // Store lowercase snippet with timestamp for variety analysis
   responses.push({
     content: response.toLowerCase().substring(0, 50),
     timestamp: Date.now()
   });

   // Maintain sliding window of recent responses to prevent memory bloat
   if (responses.length > this.maxRecentResponses) {
     responses.shift();
   }
 }

 /**
  * @description Generates a variety prompt based on conversation context and mention status
  * @param {string} conversationId - Unique identifier for the conversation
  * @param {string} aiName - Name of the AI participant
  * @param {number} messageCount - Total number of messages in conversation
  * @param {boolean} [wasMentioned=false] - Whether this participant was mentioned
  * @param {Array} [recentMessages=[]] - Recent message history
  * @returns {string} A prompt encouraging varied and appropriate response style
  */
 getVarietyPrompt(
   conversationId,
   aiName,
   messageCount,
   wasMentioned = false,
   recentMessages = []
 ) {
   // Special handling when participant is mentioned
   if (wasMentioned) {
     // Check if this is part of a back-and-forth chain
     const recentMentions = recentMessages
       .slice(-3)
       .filter(msg => msg.content && msg.content.includes("@"));

     // If multiple recent mentions exist, discourage long chains
     if (recentMentions.length >= 2) {
       return "You were mentioned, but avoid creating a long back-and-forth. Respond briefly and let others join the conversation.";
     } else {
       return "You were specifically mentioned - respond directly but keep it brief.";
     }
   }

   // Rotating set of prompts to encourage diverse participation styles
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

   // Cycle through prompts based on message count for natural variety
   return prompts[messageCount % prompts.length];
 }

 /**
  * @description Generates an AI response with chain-limiting and variety features
  * @param {string} modelId - The AI model identifier to use
  * @param {string} provider - The provider name (deepinfra or fireworks)
  * @param {string} conversationId - Unique identifier for the conversation
  * @param {Object} currentParticipant - Participant object with personality details
  * @param {Array} history - Full conversation history
  * @param {string} conversationTopic - The main topic being discussed
  * @param {Function} [onChunk=null] - Callback function for streaming chunks
  * @returns {Promise<string>} The generated and cleaned response
  * @throws {Error} If provider is not configured or API request fails
  */
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

   // Validate provider configuration
   if (!providerConfig || !providerConfig.apiKey) {
     throw new Error(`Provider ${provider} not configured`);
   }

   try {
     // Limit history to last 15 messages to keep context manageable
     const recentHistory = history.slice(-15);

     // Build conversation context from recent messages
     const conversationContext = recentHistory
       .map(msg => {
         const speakerName =
           msg.sender_name || (msg.sender_type === "user" ? "User" : "AI");
         return `${speakerName}: ${msg.content}`;
       })
       .join("\n\n");

     // Check if this participant was mentioned in the last message
     const lastMessage = recentHistory[recentHistory.length - 1];
     const wasMentioned =
       lastMessage &&
       this.checkIfMentioned(
         currentParticipant.personality_name,
         lastMessage.content
       );

     // Generate context-aware mention guidance
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

     // Analyze recent mention patterns to discourage chains
     const recentMentionCount = recentHistory
       .slice(-5)
       .filter(msg => msg.content && msg.content.includes("@")).length;

     // Dynamic mention guidance based on recent activity
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

     // Construct enhanced prompt with chain prevention and variety guidance
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

     // Prepare messages for API request
     const messages = [
       {
         role: "user",
         content: userPrompt
       }
     ];

     // Configure API request payload with chain-limiting parameters
     const requestPayload = {
       model: modelId,
       messages: messages,
       max_tokens: 1000, // Reduced to encourage brevity and prevent monopolization
       temperature: 0.7,
       top_p: 0.9,
       frequency_penalty: 0.3, // Increased to reduce repetition
       presence_penalty: 0.0,
       stream: true
     };

     // Configure request headers and streaming options
     const requestConfig = {
       headers: {
         Authorization: `Bearer ${providerConfig.apiKey}`,
         "Content-Type": "application/json"
       },
       responseType: "stream",
       timeout: 300000 // 5 minute timeout for long responses
     };

     logger.apiMessage(provider, modelId, "CHAIN_LIMITED_REQUEST_SENT", {
       url: `${providerConfig.baseURL}/chat/completions`,
       payload: requestPayload,
       wasMentioned,
       recentMentionCount,
       mentionContext: !!mentionContext
     });

     // Execute streaming API request
     const response = await axios.post(
       `${providerConfig.baseURL}/chat/completions`,
       requestPayload,
       requestConfig
     );

     // Process streaming response
     return new Promise((resolve, reject) => {
       let fullText = "";
       let buffer = "";

       response.data.on("data", chunk => {
         try {
           const chunkStr = chunk.toString();
           buffer += chunkStr;

           // Split buffer into lines for SSE processing
           const lines = buffer.split("\n");
           buffer = lines.pop();

           // Process each line of the stream
           for (const line of lines) {
             const trimmedLine = line.trim();
             if (!trimmedLine || trimmedLine === "data: [DONE]") continue;

             // Parse JSON data from SSE stream
             if (trimmedLine.startsWith("data: ")) {
               try {
                 const jsonStr = trimmedLine.substring(6);
                 const json = JSON.parse(jsonStr);

                 // Extract content from streaming response
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

       // Handle stream completion
       response.data.on("end", () => {
         try {
           // Clean and process the complete response
           const cleaned = this.cleanResponse(
             fullText,
             currentParticipant.personality_name
           );

           // Track this response for variety analysis
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

       // Handle stream errors
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

 /**
  * @description Checks if a participant was mentioned in message content
  * @param {string} participantName - Name of the participant to check
  * @param {string} content - Message content to search
  * @returns {boolean} True if participant was mentioned, false otherwise
  */
 checkIfMentioned(participantName, content) {
   if (!content) return false;

   // Regex pattern to find @mentions
   const mentionPattern = /@(\w+)/g;
   let match;

   // Check each mention against participant name with fuzzy matching
   while ((match = mentionPattern.exec(content)) !== null) {
     const mentionedName = match[1].toLowerCase();
     const participantNameLower = participantName.toLowerCase();

     // Support partial name matches for flexible mentioning
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

 /**
  * @description Checks if content contains any @mentions
  * @param {string} content - Text content to check
  * @returns {boolean} True if mentions exist, false otherwise
  */
 containsMentions(content) {
   return /@\w+/.test(content);
 }

 /**
  * @description Cleans AI response by removing prefixes and excessive formatting
  * @param {string} response - Raw AI response text
  * @param {string} participantName - Name of the participant
  * @returns {string} Cleaned response text
  */
 cleanResponse(response, participantName) {
   let cleaned = response.trim();

   // Remove participant name prefix (e.g., "AI Name: response")
   const prefixPattern = new RegExp(`^${participantName}:\\s*`, "i");
   cleaned = cleaned.replace(prefixPattern, "");

   // Remove common response prefixes
   cleaned = cleaned.replace(/^(Here is|My response|I think|Let me):\s*/i, "");

   // Remove excessive markdown formatting but preserve @ mentions
   cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, "$1"); // Remove bold
   cleaned = cleaned.replace(/_{2,}/g, ""); // Remove multiple underscores

   return cleaned;
 }

 /**
  * @description Generates a personality instruction for an AI participant
  * @param {string} modelId - The AI model to use for generation
  * @param {string} provider - The provider name
  * @param {string} personalityName - Name of the personality
  * @param {string} personalityShortDetails - Brief personality description
  * @returns {Promise<string>} Generated personality instruction
  */
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
         timeout: 60000 // 1 minute timeout
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
     // Fallback personality instruction if generation fails
     return `You are ${personalityName}, a thoughtful participant who brings valuable insights to discussions and engages constructively with others.`;
   }
 }

 /**
  * @description Generates an opening message for a new conversation topic
  * @param {string} modelId - The AI model to use
  * @param {string} provider - The provider name
  * @param {string} personalityName - Name of the personality
  * @param {string} personalityDetails - Full personality description
  * @param {string} topic - The topic to discuss
  * @param {Function} [onChunk=null] - Streaming callback function
  * @returns {Promise<string>} Generated opening message
  */
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
         timeout: 60000 // 1 minute timeout
       }
     );

     // Process streaming opening message
     return new Promise((resolve, reject) => {
       let fullText = "";
       let buffer = "";

       response.data.on("data", chunk => {
         try {
           const chunkStr = chunk.toString();
           buffer += chunkStr;
           const lines = buffer.split("\n");
           buffer = lines.pop();

           // Process SSE stream lines
           for (const line of lines) {
             const trimmedLine = line.trim();
             if (!trimmedLine || trimmedLine === "data: [DONE]") continue;

             if (trimmedLine.startsWith("data: ")) {
               try {
                 const jsonStr = trimmedLine.substring(6);
                 const json = JSON.parse(jsonStr);
                 // Extract content from streaming response
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

       // Handle opening message stream completion
       response.data.on("end", () => {
         const cleaned = this.cleanResponse(fullText, personalityName);
         logger.info("BALANCED_AI_SERVICE", "Opening message completed", {
           responseLength: cleaned.length,
           containsMentions: this.containsMentions(cleaned)
         });
         resolve(cleaned);
       });

       // Handle stream errors
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
     // Fallback opening message if generation fails
     return `I think ${topic} is really interesting. What are your thoughts on this?`;
   }
 }
}

// Export singleton instance
module.exports = new AIService();
