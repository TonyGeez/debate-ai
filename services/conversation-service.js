const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const logger = require('../logger');

/**
* Conversation Service - Manages database operations for conversations, participants, and messages
* 
* @description This service provides a data access layer for conversation-related operations
* in a PostgreSQL database. It handles CRUD operations for conversations, AI participants,
* and messages while maintaining proper connection pooling and comprehensive logging.
* 
* Key features:
* - Conversation lifecycle management (create, read, update, delete)
* - AI participant management with model and personality tracking
* - Message handling with order preservation and content updates
* - Message limit enforcement for conversation boundaries
* - Comprehensive logging for all database operations
*/
class ConversationService {
   /**
    * @description Creates a new conversation in the database
    * @param {string} title - The conversation title
    * @param {string} topic - The discussion topic
    * @param {number} [messageLimit=0] - Maximum number of messages (0 = unlimited)
    * @returns {Promise<Object>} The created conversation record
    * @throws {Error} If database query fails
    */
   async createConversation(title, topic, messageLimit = 0) {
       logger.info('CONVERSATION_SERVICE', 'Creating conversation', { title, topic, messageLimit });
       const client = await pool.connect();
       try {
           // Insert new conversation with active status and optional message limit
           const result = await client.query(
               `INSERT INTO conversations (title, topic, message_limit, is_active) 
                VALUES ($1, $2, $3, true) 
                RETURNING *`,
               [title, topic, messageLimit]
           );
           logger.info('CONVERSATION_SERVICE', 'Conversation created successfully', { conversationId: result.rows[0].id });
           return result.rows[0];
       } catch (error) {
           logger.error('CONVERSATION_SERVICE', 'Error creating conversation', { error: error.message });
           throw error;
       } finally {
           // Ensure connection is always returned to pool
           client.release();
       }
   }

   /**
    * @description Adds an AI participant to an existing conversation
    * @param {string} conversationId - The conversation UUID
    * @param {string} modelName - The AI model identifier
    * @param {string} provider - The model provider name
    * @param {string} personalityName - The participant's display name
    * @param {string} personalityDetails - System instructions for the AI
    * @returns {Promise<Object>} The created participant record
    * @throws {Error} If database query fails or conversation doesn't exist
    */
   async addAIParticipant(conversationId, modelName, provider, personalityName, personalityDetails) {
       logger.info('CONVERSATION_SERVICE', 'Adding AI participant', { conversationId, modelName, provider, personalityName });
       const client = await pool.connect();
       try {
           // Insert AI participant with model and personality configuration
           const result = await client.query(
               `INSERT INTO ai_participants (conversation_id, model_name, model_provider, personality_name, system_instruction) 
                VALUES ($1, $2, $3, $4, $5) 
                RETURNING *`,
               [conversationId, modelName, provider, personalityName, personalityDetails]
           );
           logger.info('CONVERSATION_SERVICE', 'AI participant added successfully', { participantId: result.rows[0].id });
           return result.rows[0];
       } catch (error) {
           logger.error('CONVERSATION_SERVICE', 'Error adding AI participant', { error: error.message });
           throw error;
       } finally {
           client.release();
       }
   }

   /**
    * @description Adds a new message to a conversation with automatic order assignment
    * @param {string} conversationId - The conversation UUID
    * @param {string} senderType - Type of sender ('user' or 'ai')
    * @param {string} senderName - Display name of the sender
    * @param {string} modelName - AI model name (if applicable)
    * @param {string} content - Message content
    * @returns {Promise<Object>} The created message record
    * @throws {Error} If database query fails
    */
   async addMessage(conversationId, senderType, senderName, modelName, content) {
       logger.debug('CONVERSATION_SERVICE', 'Adding message', { conversationId, senderType, senderName });
       const client = await pool.connect();
       try {
           // Get current maximum message order for sequential numbering
           const countResult = await client.query(
               'SELECT COALESCE(MAX(message_order), 0) as max_order FROM messages WHERE conversation_id = $1',
               [conversationId]
           );
           
           const nextOrder = countResult.rows[0].max_order + 1;
           
           // Insert message with calculated order and update conversation timestamp
           const result = await client.query(
               `INSERT INTO messages (conversation_id, sender_type, sender_name, model_name, content, message_order) 
                VALUES ($1, $2, $3, $4, $5, $6) 
                RETURNING *`,
               [conversationId, senderType, senderName, modelName, content, nextOrder]
           );

           // Increment conversation message count and update timestamp
           await client.query(
               'UPDATE conversations SET message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
               [conversationId]
           );

           logger.info('CONVERSATION_SERVICE', 'Message added successfully', { 
               conversationId, 
               messageId: result.rows[0].id,
               senderType,
               senderName
           });
           return result.rows[0];
       } catch (error) {
           logger.error('CONVERSATION_SERVICE', 'Error adding message', { error: error.message });
           throw error;
       } finally {
           client.release();
       }
   }

   /**
    * @description Updates the content of an existing message
    * @param {string} messageId - The message UUID
    * @param {string} content - New message content
    * @returns {Promise<void>}
    * @throws {Error} If database query fails
    */
   async updateMessageContent(messageId, content) {
       logger.debug('CONVERSATION_SERVICE', 'Updating message content', { messageId });
       const client = await pool.connect();
       try {
           // Update message content and timestamp
           await client.query(
               'UPDATE messages SET content = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
               [content, messageId]
           );
           logger.info('CONVERSATION_SERVICE', 'Message content updated', { messageId });
       } catch (error) {
           logger.error('CONVERSATION_SERVICE', 'Error updating message content', { error: error.message });
           throw error;
       } finally {
           client.release();
       }
   }

   /**
    * @description Retrieves complete message history for a conversation
    * @param {string} conversationId - The conversation UUID
    * @returns {Promise<Array<Object>>} Array of message records in chronological order
    * @throws {Error} If database query fails
    */
   async getConversationHistory(conversationId) {
       logger.debug('CONVERSATION_SERVICE', 'Getting conversation history', { conversationId });
       const client = await pool.connect();
       try {
           // Fetch all messages ordered by message_order for chronological sequence
           const result = await client.query(
               `SELECT * FROM messages 
                WHERE conversation_id = $1 
                ORDER BY message_order ASC`,
               [conversationId]
           );
           logger.info('CONVERSATION_SERVICE', 'Conversation history retrieved', { conversationId, count: result.rows.length });
           return result.rows;
       } catch (error) {
           logger.error('CONVERSATION_SERVICE', 'Error retrieving conversation history', { error: error.message });
           throw error;
       } finally {
           client.release();
       }
   }

   /**
    * @description Retrieves conversation details and participant information
    * @param {string} conversationId - The conversation UUID
    * @returns {Promise<Object|null>} Object containing conversation and participants, or null if not found
    * @throws {Error} If database query fails
    */
   async getConversationDetails(conversationId) {
       logger.debug('CONVERSATION_SERVICE', 'Getting conversation details', { conversationId });
       const client = await pool.connect();
       try {
           // Fetch conversation metadata
           const convResult = await client.query(
               'SELECT * FROM conversations WHERE id = $1',
               [conversationId]
           );
           
           // Fetch all AI participants for this conversation
           const participantsResult = await client.query(
               'SELECT * FROM ai_participants WHERE conversation_id = $1 ORDER BY created_at ASC',
               [conversationId]
           );
           
           if (convResult.rows.length === 0) {
               logger.warn('CONVERSATION_SERVICE', 'Conversation not found', { conversationId });
               return null;
           }
           
           logger.info('CONVERSATION_SERVICE', 'Conversation details retrieved', { conversationId });
           return {
               conversation: convResult.rows[0],
               participants: participantsResult.rows
           };
       } catch (error) {
           logger.error('CONVERSATION_SERVICE', 'Error retrieving conversation details', { error: error.message });
           throw error;
       } finally {
           client.release();
       }
   }

   /**
    * @description Retrieves all conversations with message statistics
    * @returns {Promise<Array<Object>>} Array of conversation records with aggregated statistics
    * @throws {Error} If database query fails
    */
   async getAllConversations() {
       logger.debug('CONVERSATION_SERVICE', 'Getting all conversations');
       const client = await pool.connect();
       try {
           // Aggregate conversation data with message counts and last activity
           const result = await client.query(
               `SELECT c.*, 
                       COUNT(m.id) as total_messages,
                       MAX(m.created_at) as last_message_at
                FROM conversations c
                LEFT JOIN messages m ON c.id = m.conversation_id
                GROUP BY c.id
                ORDER BY c.updated_at DESC`
           );
           logger.info('CONVERSATION_SERVICE', 'All conversations retrieved', { count: result.rows.length });
           return result.rows;
       } catch (error) {
           logger.error('CONVERSATION_SERVICE', 'Error retrieving all conversations', { error: error.message });
           throw error;
       } finally {
           client.release();
       }
   }

   /**
    * @description Updates the active status of a conversation
    * @param {string} conversationId - The conversation UUID
    * @param {boolean} isActive - New active state
    * @returns {Promise<void>}
    * @throws {Error} If database query fails
    */
   async setConversationActive(conversationId, isActive) {
       logger.info('CONVERSATION_SERVICE', 'Setting conversation active state', { conversationId, isActive });
       const client = await pool.connect();
       try {
           // Update conversation status and timestamp
           await client.query(
               'UPDATE conversations SET is_active = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
               [conversationId, isActive]
           );
           logger.info('CONVERSATION_SERVICE', 'Conversation active state updated', { conversationId, isActive });
       } catch (error) {
           logger.error('CONVERSATION_SERVICE', 'Error setting conversation active state', { error: error.message });
           throw error;
       } finally {
           client.release();
       }
   }

   /**
    * @description Checks if a conversation has reached its message limit
    * @param {string} conversationId - The conversation UUID
    * @returns {Promise<Object>} Object with limitReached boolean and optional reason
    * @throws {Error} If database query fails
    */
   async checkMessageLimit(conversationId) {
       logger.debug('CONVERSATION_SERVICE', 'Checking message limit', { conversationId });
       const client = await pool.connect();
       try {
           // Retrieve message limit and current count for comparison
           const result = await client.query(
               'SELECT message_limit, message_count FROM conversations WHERE id = $1',
               [conversationId]
           );
           
           if (result.rows.length === 0) {
               logger.warn('CONVERSATION_SERVICE', 'Conversation not found for limit check', { conversationId });
               return { limitReached: true, reason: 'Conversation not found' };
           }
           
           const { message_limit, message_count } = result.rows[0];
           
           // Check if limit is set (0 = unlimited) and has been reached
           if (message_limit > 0 && message_count >= message_limit) {
               logger.warn('CONVERSATION_SERVICE', 'Message limit reached', { conversationId, limit: message_limit, count: message_count });
               return { limitReached: true, reason: 'Message limit reached' };
           }
           
           logger.debug('CONVERSATION_SERVICE', 'Message limit check passed', { conversationId });
           return { limitReached: false };
       } catch (error) {
           logger.error('CONVERSATION_SERVICE', 'Error checking message limit', { error: error.message });
           throw error;
       } finally {
           client.release();
       }
   }

   /**
    * @description Permanently deletes a conversation and all associated data
    * @param {string} conversationId - The conversation UUID
    * @returns {Promise<void>}
    * @throws {Error} If database query fails
    */
   async deleteConversation(conversationId) {
       logger.info('CONVERSATION_SERVICE', 'Deleting conversation', { conversationId });
       const client = await pool.connect();
       try {
           // Cascade delete will remove related participants and messages
           await client.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
           logger.info('CONVERSATION_SERVICE', 'Conversation deleted successfully', { conversationId });
       } catch (error) {
           logger.error('CONVERSATION_SERVICE', 'Error deleting conversation', { error: error.message });
           throw error;
       } finally {
           client.release();
       }
   }

   /**
    * @description Retrieves all AI participants for a conversation
    * @param {string} conversationId - The conversation UUID
    * @returns {Promise<Array<Object>>} Array of participant objects with essential fields
    * @throws {Error} If database query fails
    */
   async getConversationParticipants(conversationId) {
       logger.debug('CONVERSATION_SERVICE', 'Getting conversation participants', { conversationId });
       const client = await pool.connect();
       try {
           // Fetch participant details ordered by creation time
           const result = await client.query(
               `SELECT 
                   id,
                   model_name,
                   model_provider,
                   personality_name,
                   system_instruction
                FROM ai_participants 
                WHERE conversation_id = $1 
                ORDER BY created_at ASC`,
               [conversationId]
           );
           
           logger.info('CONVERSATION_SERVICE', 'Conversation participants retrieved', { conversationId, count: result.rows.length });
           // Return only essential fields for external use
           return result.rows.map(participant => ({
               id: participant.id,
               model_name: participant.model_name,
               model_provider: participant.model_provider,
               personality_name: participant.personality_name,
               system_instruction: participant.system_instruction
           }));
       } catch (error) {
           logger.error('CONVERSATION_SERVICE', 'Error retrieving conversation participants', { error: error.message });
           throw error;
       } finally {
           client.release();
       }
   }
}

// Export singleton instance for use throughout the application
module.exports = new ConversationService();
