const logger = require("../logger");

/**
* Conversation Flow Service - Manages turn-taking and mention-based interactions
* 
* @description This service orchestrates natural conversation flow between AI participants
* by implementing intelligent turn-taking logic with mention chain prevention. It tracks
* speaking order, manages @mention responses, and prevents repetitive back-and-forth
* patterns that can make conversations feel unnatural.
* 
* Key features:
* - Mention detection and participant lookup
* - Chain-breaking logic to prevent long @mention sequences
* - Smart random selection with anti-repetition algorithms
* - Conversation state management per conversation ID
* - Cooldown periods and consecutive turn tracking
*/
class FlowService {
 /**
  * @description Initializes the conversation flow service with empty state tracking
  */
 constructor() {
   // Map to store conversation-specific states by conversation ID
   this.conversationStates = new Map();
   // Regex pattern for extracting @mentions from message content
   this.mentionPattern = /@(\w+)/g;
 }

 /**
  * @description Initializes conversation state with participants and flow controls
  * @param {string} conversationId - Unique identifier for the conversation
  * @param {Array<Object>} participants - Array of participant objects with personality details
  * @returns {Object} The initialized conversation state
  */
 initializeConversation(conversationId, participants) {
   // Create comprehensive state object with mention chain prevention mechanisms
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

 /**
  * @description Randomizes array order using Fisher-Yates shuffle algorithm
  * @param {Array} array - Array to shuffle
  * @returns {Array} New shuffled array
  */
 shuffleArray(array) {
   const shuffled = [...array];
   // Fisher-Yates shuffle for unbiased randomization
   for (let i = shuffled.length - 1; i > 0; i--) {
     const j = Math.floor(Math.random() * (i + 1));
     [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
   }
   return shuffled;
 }

 /**
  * @description Extracts all @mentions from message content
  * @param {string} content - Message text to parse
  * @returns {Array<string>} Array of mentioned names (lowercase)
  */
 extractMentions(content) {
   const mentions = [];
   let match;

   // Reset regex to avoid state issues from previous executions
   this.mentionPattern.lastIndex = 0;

   // Extract all @mentions from content
   while ((match = this.mentionPattern.exec(content)) !== null) {
     mentions.push(match[1].toLowerCase());
   }

   return mentions;
 }

 /**
  * @description Finds participant by name with case-insensitive and partial matching
  * @param {Array<Object>} participants - Array of participant objects
  * @param {string} mentionName - The mentioned name to search for
  * @returns {Object|null} Found participant or null
  */
 findParticipantByName(participants, mentionName) {
   const lowerMention = mentionName.toLowerCase();

   // Support flexible matching: exact, partial, or substring matches
   return participants.find(p => {
     const lowerName = p.personality_name.toLowerCase();
     return (
       lowerName === lowerMention ||
       lowerName.includes(lowerMention) ||
       lowerMention.includes(lowerName)
     );
   });
 }

 /**
  * @description Determines if a mention chain should be broken to prevent long sequences
  * @param {Object} state - Conversation state object
  * @param {string} mentioner - Name of the participant making the mention
  * @param {string} mentioned - Name of the mentioned participant
  * @returns {boolean} True if chain should be broken, false otherwise
  */
 shouldBreakMentionChain(state, mentioner, mentioned) {
   const chainKey = `${mentioner}-${mentioned}`;
   const reverseChainKey = `${mentioned}-${mentioner}`;

   const currentChain = state.mentionChainCount.get(chainKey) || 0;
   const reverseChain = state.mentionChainCount.get(reverseChainKey) || 0;

   // Check cooldown period to prevent rapid-fire mentions
   const lastMentionTime = state.lastMentionTime.get(chainKey) || 0;
   const timeSinceLastMention = Date.now() - lastMentionTime;

   // Break chain if:
   // 1. Too many consecutive mentions in one direction
   // 2. Too many back-and-forth mentions
   // 3. Recent mention is still in cooldown
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

 /**
  * @description Updates mention chain tracking to prevent excessive back-and-forth
  * @param {Object} state - Conversation state object
  * @param {string} mentioner - Name of the participant making the mention
  * @param {string} mentioned - Name of the mentioned participant
  */
 updateMentionChain(state, mentioner, mentioned) {
   const chainKey = `${mentioner}-${mentioned}`;

   // Increment chain count for this direction
   const currentCount = state.mentionChainCount.get(chainKey) || 0;
   state.mentionChainCount.set(chainKey, currentCount + 1);

   // Update timestamp for cooldown tracking
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

 /**
  * @description Determines next speaker based on mentions, chains, and natural flow
  * @param {string} conversationId - Unique identifier for the conversation
  * @param {Object|null} lastMessage - The most recent message in the conversation
  * @returns {Object|null} Next participant object or null
  */
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

   // Check for mentions in the last message to prioritize mentioned participants
   if (lastMessage && lastMessage.content && lastMessage.sender_name) {
     const mentions = this.extractMentions(lastMessage.content);

     if (mentions.length > 0) {
       // Find mentioned participants and validate mention chains
       for (const mention of mentions) {
         const mentionedParticipant = this.findParticipantByName(
           state.participants,
           mention
         );
         if (mentionedParticipant) {
           // Prevent self-mentions
           if (
             mentionedParticipant.personality_name !== lastMessage.sender_name
           ) {
             // Validate mention chain limits before allowing
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

               // Track the mention for context generation
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

   // Fallback to smart random selection if no valid mentions
   if (!nextSpeaker) {
     nextSpeaker = this.selectRandomSpeaker(state, lastMessage);
     reason = "smart_random";

     // Reset mention chains when switching to random mode
     if (lastMessage && lastMessage.sender_name) {
       this.resetMentionChainsForSpeaker(state, lastMessage.sender_name);
     }
   }

   // Update conversation state with new speaker
   if (nextSpeaker) {
     state.lastSpeaker = nextSpeaker;

     // Track consecutive turns to prevent domination
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

 /**
  * @description Resets mention chains for a specific speaker to allow natural flow
  * @param {Object} state - Conversation state object
  * @param {string} speakerName - Name of the speaker
  */
 resetMentionChainsForSpeaker(state, speakerName) {
   // Find all mention chains involving this speaker
   const keysToReset = [];
   for (const key of state.mentionChainCount.keys()) {
     if (
       key.startsWith(speakerName + "-") ||
       key.endsWith("-" + speakerName)
     ) {
       keysToReset.push(key);
     }
   }

   // Reset all relevant chains
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

 /**
  * @description Selects random speaker with anti-repetition and balance logic
  * @param {Object} state - Conversation state object
  * @param {Object|null} lastMessage - The most recent message
  * @returns {Object} Selected participant object
  */
 selectRandomSpeaker(state, lastMessage) {
   let availableSpeakers = [...state.participants];

   // Remove last speaker to avoid immediate repetition
   if (state.lastSpeaker) {
     availableSpeakers = availableSpeakers.filter(
       p => p.id !== state.lastSpeaker.id
     );
   }

   // Filter out participants who have spoken too many times consecutively
   const maxConsecutive = 2;
   const preferredSpeakers = availableSpeakers.filter(p => {
     const consecutive = state.consecutiveTurns.get(p.id) || 0;
     return consecutive < maxConsecutive;
   });

   // Use preferred speakers if available, otherwise fall back to all available
   const candidateSpeakers =
     preferredSpeakers.length > 0 ? preferredSpeakers : availableSpeakers;

   // Final fallback to all participants if no candidates
   if (candidateSpeakers.length === 0) {
     return state.participants[
       Math.floor(Math.random() * state.participants.length)
     ];
   }

   // Random selection from qualified candidates
   return candidateSpeakers[
     Math.floor(Math.random() * candidateSpeakers.length)
   ];
 }

 /**
  * @description Retrieves the current state of a conversation
  * @param {string} conversationId - Unique identifier for the conversation
  * @returns {Object|null} Conversation state or null if not found
  */
 getConversationState(conversationId) {
   return this.conversationStates.get(conversationId);
 }

 /**
  * @description Removes conversation state to free up memory
  * @param {string} conversationId - Unique identifier for the conversation
  */
 cleanupConversation(conversationId) {
   this.conversationStates.delete(conversationId);
   logger.info("CONVERSATION_FLOW", "Conversation state cleaned up", {
     conversationId
   });
 }

 /**
  * @description Generates context about mentions for AI prompt enhancement
  * @param {string} conversationId - Unique identifier for the conversation
  * @param {Object} currentParticipant - The participant being prompted
  * @param {Array<Object>} recentMessages - Recent message history
  * @returns {string} Formatted context string for prompt injection
  */
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

 /**
  * @description Extracts unique mentions from recent messages
  * @param {Array<Object>} messages - Array of message objects
  * @returns {Array<string>} Array of unique mentioned names
  */
 extractMentionsFromMessages(messages) {
   const allMentions = new Set();

   // Process last 15 messages to get recent mention context
   messages.slice(-15).forEach(msg => {
     const mentions = this.extractMentions(msg.content || "");
     mentions.forEach(mention => allMentions.add(mention));
   });

   return Array.from(allMentions);
 }

 /**
  * @description Returns debugging statistics about conversation flow
  * @param {string} conversationId - Unique identifier for the conversation
  * @returns {Object|null} Statistics object or null if conversation not found
  */
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

// Export singleton instance for use across the application
module.exports = new FlowService();
