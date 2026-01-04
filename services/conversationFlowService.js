const logger = require("../logger");

class ConversationFlowService {
  constructor() {
    this.conversationStates = new Map();
    this.mentionPattern = /@(\w+)/g;
  }

  // Initialize conversation flow state
  initializeConversation(conversationId, participants) {
    const state = {
      participants: participants,
      lastSpeaker: null,
      speakingOrder: this.shuffleArray([...participants]),
      currentIndex: 0,
      mentionQueue: [],
      consecutiveTurns: new Map(), // Track consecutive turns per participant
      lastMentions: new Map(), // Track recent mentions
      mentionChainCount: new Map(), // Track @mention chains between participants
      lastMentionTime: new Map(), // Track when mentions happened
      maxMentionChain: 2, // Max consecutive @mention responses
      mentionCooldown: 30000 // 30 seconds cooldown for mentions
    };

    this.conversationStates.set(conversationId, state);
    logger.info(
      "CONVERSATION_FLOW",
      "Conversation flow initialized with mention limits",
      {
        conversationId,
        participantCount: participants.length,
        maxMentionChain: state.maxMentionChain
      }
    );

    return state;
  }

  // Shuffle array for random order
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Extract mentions from message content
  extractMentions(content) {
    const mentions = [];
    let match;

    // Reset regex
    this.mentionPattern.lastIndex = 0;

    while ((match = this.mentionPattern.exec(content)) !== null) {
      mentions.push(match[1].toLowerCase());
    }

    return mentions;
  }

  // Find participant by name (case insensitive, partial match)
  findParticipantByName(participants, mentionName) {
    const lowerMention = mentionName.toLowerCase();

    return participants.find(p => {
      const lowerName = p.personality_name.toLowerCase();
      // Exact match or partial match
      return (
        lowerName === lowerMention ||
        lowerName.includes(lowerMention) ||
        lowerMention.includes(lowerName)
      );
    });
  }

  // Check if mention chain should be broken
  shouldBreakMentionChain(state, mentioner, mentioned) {
    const chainKey = `${mentioner}-${mentioned}`;
    const reverseChainKey = `${mentioned}-${mentioner}`;

    const currentChain = state.mentionChainCount.get(chainKey) || 0;
    const reverseChain = state.mentionChainCount.get(reverseChainKey) || 0;

    // Break chain if:
    // 1. Too many consecutive mentions in one direction
    // 2. Too many back-and-forth mentions
    // 3. Recent mention is still in cooldown
    const lastMentionTime = state.lastMentionTime.get(chainKey) || 0;
    const timeSinceLastMention = Date.now() - lastMentionTime;

    const shouldBreak =
      currentChain >= state.maxMentionChain ||
      currentChain + reverseChain >= state.maxMentionChain * 2 ||
      timeSinceLastMention < state.mentionCooldown;

    if (shouldBreak) {
      logger.info("CONVERSATION_FLOW", "Breaking mention chain", {
        chainKey,
        currentChain,
        reverseChain,
        timeSinceLastMention,
        reason:
          currentChain >= state.maxMentionChain
            ? "max_chain"
            : currentChain + reverseChain >= state.maxMentionChain * 2
              ? "too_much_back_forth"
              : "cooldown"
      });
    }

    return shouldBreak;
  }

  // Update mention chain tracking
  updateMentionChain(state, mentioner, mentioned) {
    const chainKey = `${mentioner}-${mentioned}`;

    // Increment chain count
    const currentCount = state.mentionChainCount.get(chainKey) || 0;
    state.mentionChainCount.set(chainKey, currentCount + 1);

    // Update timestamp
    state.lastMentionTime.set(chainKey, Date.now());

    // Clean up old chains (reset chains older than 5 minutes)
    const fiveMinutesAgo = Date.now() - 300000;
    for (const [key, timestamp] of state.lastMentionTime.entries()) {
      if (timestamp < fiveMinutesAgo) {
        state.mentionChainCount.delete(key);
        state.lastMentionTime.delete(key);
      }
    }

    logger.debug("CONVERSATION_FLOW", "Updated mention chain", {
      chainKey,
      newCount: currentCount + 1
    });
  }

  // Determine next speaker based on mentions and natural flow
  getNextSpeaker(conversationId, lastMessage = null) {
    const state = this.conversationStates.get(conversationId);
    if (!state) {
      logger.error("CONVERSATION_FLOW", "No conversation state found", {
        conversationId
      });
      return null;
    }

    let nextSpeaker = null;
    let reason = "random_order";

    // Check for mentions in the last message
    if (lastMessage && lastMessage.content && lastMessage.sender_name) {
      const mentions = this.extractMentions(lastMessage.content);

      if (mentions.length > 0) {
        // Find mentioned participants
        for (const mention of mentions) {
          const mentionedParticipant = this.findParticipantByName(
            state.participants,
            mention
          );
          if (mentionedParticipant) {
            // Don't let someone mention themselves
            if (
              mentionedParticipant.personality_name !== lastMessage.sender_name
            ) {
              // Check if we should break the mention chain
              const shouldBreak = this.shouldBreakMentionChain(
                state,
                lastMessage.sender_name,
                mentionedParticipant.personality_name
              );

              if (!shouldBreak) {
                nextSpeaker = mentionedParticipant;
                reason = `mentioned_by_${lastMessage.sender_name}`;

                // Update mention chain tracking
                this.updateMentionChain(
                  state,
                  lastMessage.sender_name,
                  mentionedParticipant.personality_name
                );

                // Track the mention
                state.lastMentions.set(mentionedParticipant.id, {
                  mentionedBy: lastMessage.sender_name,
                  timestamp: Date.now()
                });

                logger.info(
                  "CONVERSATION_FLOW",
                  "Participant mentioned (chain allowed)",
                  {
                    conversationId,
                    mentioned: mentionedParticipant.personality_name,
                    mentionedBy: lastMessage.sender_name,
                    reason
                  }
                );
                break;
              } else {
                logger.info(
                  "CONVERSATION_FLOW",
                  "Mention ignored due to chain limit",
                  {
                    conversationId,
                    mentioned: mentionedParticipant.personality_name,
                    mentionedBy: lastMessage.sender_name
                  }
                );
              }
            }
          }
        }
      }
    }

    // If no valid mention, use smart random selection
    if (!nextSpeaker) {
      nextSpeaker = this.selectRandomSpeaker(state, lastMessage);
      reason = "smart_random";

      // Reset mention chains when switching to random mode
      if (lastMessage && lastMessage.sender_name) {
        this.resetMentionChainsForSpeaker(state, lastMessage.sender_name);
      }
    }

    // Update state
    if (nextSpeaker) {
      state.lastSpeaker = nextSpeaker;

      // Track consecutive turns
      const consecutiveCount =
        (state.consecutiveTurns.get(nextSpeaker.id) || 0) + 1;
      state.consecutiveTurns.set(nextSpeaker.id, consecutiveCount);

      // Reset other participants' consecutive counts
      state.participants.forEach(p => {
        if (p.id !== nextSpeaker.id) {
          state.consecutiveTurns.set(p.id, 0);
        }
      });
    }

    logger.info(
      "CONVERSATION_FLOW",
      "Next speaker selected with chain limits",
      {
        conversationId,
        nextSpeaker: nextSpeaker?.personality_name,
        reason,
        consecutiveTurns: state.consecutiveTurns.get(nextSpeaker?.id) || 0
      }
    );

    return nextSpeaker;
  }

  // Reset mention chains for a specific speaker
  resetMentionChainsForSpeaker(state, speakerName) {
    const keysToReset = [];
    for (const key of state.mentionChainCount.keys()) {
      if (
        key.startsWith(speakerName + "-") ||
        key.endsWith("-" + speakerName)
      ) {
        keysToReset.push(key);
      }
    }

    keysToReset.forEach(key => {
      state.mentionChainCount.delete(key);
      state.lastMentionTime.delete(key);
    });

    if (keysToReset.length > 0) {
      logger.debug("CONVERSATION_FLOW", "Reset mention chains for speaker", {
        speakerName,
        resetCount: keysToReset.length
      });
    }
  }

  // Smart random speaker selection with anti-repetition logic
  selectRandomSpeaker(state, lastMessage) {
    let availableSpeakers = [...state.participants];

    // Remove last speaker to avoid immediate repetition
    if (state.lastSpeaker) {
      availableSpeakers = availableSpeakers.filter(
        p => p.id !== state.lastSpeaker.id
      );
    }

    // If someone has spoken too many times consecutively, reduce their chance
    const maxConsecutive = 2;
    const preferredSpeakers = availableSpeakers.filter(p => {
      const consecutive = state.consecutiveTurns.get(p.id) || 0;
      return consecutive < maxConsecutive;
    });

    // Use preferred speakers if available, otherwise use all available
    const candidateSpeakers =
      preferredSpeakers.length > 0 ? preferredSpeakers : availableSpeakers;

    // If we still have no candidates, use all participants
    if (candidateSpeakers.length === 0) {
      return state.participants[
        Math.floor(Math.random() * state.participants.length)
      ];
    }

    // Random selection from candidates
    return candidateSpeakers[
      Math.floor(Math.random() * candidateSpeakers.length)
    ];
  }

  // Get conversation state
  getConversationState(conversationId) {
    return this.conversationStates.get(conversationId);
  }

  // Clean up old conversation states
  cleanupConversation(conversationId) {
    this.conversationStates.delete(conversationId);
    logger.info("CONVERSATION_FLOW", "Conversation state cleaned up", {
      conversationId
    });
  }

  // Generate mention-aware prompt additions
  generateMentionContext(conversationId, currentParticipant, recentMessages) {
    const state = this.conversationStates.get(conversationId);
    if (!state) return "";

    let contextAdditions = [];

    // Check if this participant was recently mentioned
    const mentionInfo = state.lastMentions.get(currentParticipant.id);
    if (mentionInfo && Date.now() - mentionInfo.timestamp < 300000) {
      // 5 minutes
      contextAdditions.push(
        `You were specifically mentioned by ${mentionInfo.mentionedBy}. What your taught on this? `
      );
    }

    // Check if there are recent mentions in the conversation
    const recentMentions = this.extractMentionsFromMessages(recentMessages);
    if (recentMentions.length > 0) {
      contextAdditions.push(
        `Recent mentions: ${recentMentions.join(", ")}. You can reference participants using @Name, but avoid long back-and-forth chains.`
      );
    }

    return contextAdditions.length > 0
      ? "\n\nSpecial context:\n" + contextAdditions.join("\n")
      : "";
  }

  // Extract mentions from multiple messages
  extractMentionsFromMessages(messages) {
    const allMentions = new Set();

    messages.slice(-15).forEach(msg => {
      // Last 15 messages
      const mentions = this.extractMentions(msg.content || "");
      mentions.forEach(mention => allMentions.add(mention));
    });

    return Array.from(allMentions);
  }

  // Get statistics for debugging
  getFlowStatistics(conversationId) {
    const state = this.conversationStates.get(conversationId);
    if (!state) return null;

    return {
      participantCount: state.participants.length,
      lastSpeaker: state.lastSpeaker?.personality_name,
      consecutiveTurns: Object.fromEntries(
        state.participants.map(p => [
          p.personality_name,
          state.consecutiveTurns.get(p.id) || 0
        ])
      ),
      recentMentions: Object.fromEntries(
        Array.from(state.lastMentions.entries()).map(([id, info]) => {
          const participant = state.participants.find(p => p.id === id);
          return [participant?.personality_name || id, info];
        })
      ),
      mentionChains: Object.fromEntries(state.mentionChainCount.entries()),
      maxMentionChain: state.maxMentionChain,
      mentionCooldown: state.mentionCooldown
    };
  }
}

module.exports = new ConversationFlowService();
