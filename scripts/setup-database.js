const { Client } = require('pg');
require('dotenv').config();
const logger = require('../logger');

async function setupDatabase() {
    logger.info('DB_SETUP', 'Database setup started');
    const client = new Client({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: 'postgres'
    });

    try {
        await client.connect();
        logger.info('DB_SETUP', 'Connected to postgres database');
        
        try {
            await client.query(`CREATE DATABASE ${process.env.POSTGRES_DB}`);
            logger.info('DB_SETUP', `Database ${process.env.POSTGRES_DB} created successfully`);
        } catch (error) {
            if (error.code === '42P04') {
                logger.info('DB_SETUP', `Database ${process.env.POSTGRES_DB} already exists`);
            } else {
                logger.error('DB_SETUP', 'Error creating database', { error: error.message });
                throw error;
            }
        }
        
        await client.end();
        logger.info('DB_SETUP', 'Disconnected from postgres database');
        
        const targetClient = new Client({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.POSTGRES_USER,
            password: process.env.POSTGRES_PASSWORD,
            database: process.env.POSTGRES_DB
        });
        
        await targetClient.connect();
        logger.info('DB_SETUP', 'Connected to target database');
        
        logger.info('DB_SETUP', 'Creating tables...');
        await targetClient.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title VARCHAR(255) NOT NULL,
                topic TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT false,
                message_limit INTEGER DEFAULT 0,
                message_count INTEGER DEFAULT 0
            )
        `);
        logger.info('DB_SETUP', 'Conversations table created');
        
        await targetClient.query(`
            CREATE TABLE IF NOT EXISTS ai_participants (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                model_name VARCHAR(255) NOT NULL,
                model_provider VARCHAR(50) NOT NULL,
                personality_name VARCHAR(100) NOT NULL,
                system_instruction TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        logger.info('DB_SETUP', 'AI participants table created');
        
        await targetClient.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('user', 'ai')),
                sender_name VARCHAR(100),
                model_name VARCHAR(255),
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                message_order INTEGER NOT NULL
            )
        `);
        logger.info('DB_SETUP', 'Messages table created');
        
        logger.info('DB_SETUP', 'Creating indexes...');
        await targetClient.query(`
            CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);
        `);
        logger.info('DB_SETUP', 'Index created: idx_conversations_created_at');
        
        await targetClient.query(`
            CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
        `);
        logger.info('DB_SETUP', 'Index created: idx_messages_conversation_id');
        
        await targetClient.query(`
            CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(conversation_id, message_order);
        `);
        logger.info('DB_SETUP', 'Index created: idx_messages_order');
        
        logger.info('DB_SETUP', 'Database setup completed successfully');
        await targetClient.end();
        
    } catch (error) {
        logger.error('DB_SETUP', 'Database setup error', { error: error.message });
        process.exit(1);
    }
}

setupDatabase();
