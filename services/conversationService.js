const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const logger = require('../logger');

class ConversationService {
    async createConversation(title, topic, messageLimit = 0) {
        logger.info('CONVERSATION_SERVICE', 'Creating conversation', { title, topic, messageLimit });
        const client = await pool.connect();
        try {
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
            client.release();
        }
    }

    async addAIParticipant(conversationId, modelName, provider, personalityName, personalityDetails) {
        logger.info('CONVERSATION_SERVICE', 'Adding AI participant', { conversationId, modelName, provider, personalityName });
        const client = await pool.connect();
        try {
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

    async addMessage(conversationId, senderType, senderName, modelName, content) {
        logger.debug('CONVERSATION_SERVICE', 'Adding message', { conversationId, senderType, senderName });
        const client = await pool.connect();
        try {
            const countResult = await client.query(
                'SELECT COALESCE(MAX(message_order), 0) as max_order FROM messages WHERE conversation_id = $1',
                [conversationId]
            );
            
            const nextOrder = countResult.rows[0].max_order + 1;
            
            const result = await client.query(
                `INSERT INTO messages (conversation_id, sender_type, sender_name, model_name, content, message_order) 
                 VALUES ($1, $2, $3, $4, $5, $6) 
                 RETURNING *`,
                [conversationId, senderType, senderName, modelName, content, nextOrder]
            );

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

    async updateMessageContent(messageId, content) {
        logger.debug('CONVERSATION_SERVICE', 'Updating message content', { messageId });
        const client = await pool.connect();
        try {
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

    async getConversationHistory(conversationId) {
        logger.debug('CONVERSATION_SERVICE', 'Getting conversation history', { conversationId });
        const client = await pool.connect();
        try {
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

    async getConversationDetails(conversationId) {
        logger.debug('CONVERSATION_SERVICE', 'Getting conversation details', { conversationId });
        const client = await pool.connect();
        try {
            const convResult = await client.query(
                'SELECT * FROM conversations WHERE id = $1',
                [conversationId]
            );
            
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

    async getAllConversations() {
        logger.debug('CONVERSATION_SERVICE', 'Getting all conversations');
        const client = await pool.connect();
        try {
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

    async setConversationActive(conversationId, isActive) {
        logger.info('CONVERSATION_SERVICE', 'Setting conversation active state', { conversationId, isActive });
        const client = await pool.connect();
        try {
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

    async checkMessageLimit(conversationId) {
        logger.debug('CONVERSATION_SERVICE', 'Checking message limit', { conversationId });
        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT message_limit, message_count FROM conversations WHERE id = $1',
                [conversationId]
            );
            
            if (result.rows.length === 0) {
                logger.warn('CONVERSATION_SERVICE', 'Conversation not found for limit check', { conversationId });
                return { limitReached: true, reason: 'Conversation not found' };
            }
            
            const { message_limit, message_count } = result.rows[0];
            
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

    async deleteConversation(conversationId) {
        logger.info('CONVERSATION_SERVICE', 'Deleting conversation', { conversationId });
        const client = await pool.connect();
        try {
            await client.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
            logger.info('CONVERSATION_SERVICE', 'Conversation deleted successfully', { conversationId });
        } catch (error) {
            logger.error('CONVERSATION_SERVICE', 'Error deleting conversation', { error: error.message });
            throw error;
        } finally {
            client.release();
        }
    }

    async getConversationParticipants(conversationId) {
        logger.debug('CONVERSATION_SERVICE', 'Getting conversation participants', { conversationId });
        const client = await pool.connect();
        try {
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

module.exports = new ConversationService();
