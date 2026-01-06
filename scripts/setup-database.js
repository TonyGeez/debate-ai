const { Client } = require('pg');
require('dotenv').config();
const chalk = require('chalk');

async function setupDatabase() {
    console.log(chalk.cyan('\n=== Database Setup ===\n'));

    const client = new Client({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: 'postgres'
    });

    try {
        console.log(chalk.cyan('Connecting to PostgreSQL...'));
        await client.connect();
        console.log(chalk.green('✓ Connected'));

        // Check if database exists
        const dbCheck = await client.query(`SELECT 1 FROM pg_database WHERE datname = '${process.env.POSTGRES_DB}'`);
        
        if (dbCheck.rows.length === 0) {
            await client.query('CREATE DATABASE ' + process.env.POSTGRES_DB);
            console.log(chalk.green('✓ Database ' + process.env.POSTGRES_DB + ' created'));
        } else {
            console.log(chalk.yellow('✓ Database ' + process.env.POSTGRES_DB + ' already exists'));
        }

        await client.end();
        console.log(chalk.green('✓ Disconnected'));

        const targetClient = new Client({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.POSTGRES_USER,
            password: process.env.POSTGRES_PASSWORD,
            database: process.env.POSTGRES_DB
        });

        await targetClient.connect();
        console.log(chalk.green('✓ Connected to ' + process.env.POSTGRES_DB));

        // Tables to create
        const tables = [
            { name: 'conversations', sql: `
                CREATE TABLE IF NOT EXISTS conversations (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    title VARCHAR(255) NOT NULL,
                    topic TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    is_active BOOLEAN DEFAULT false,
                    message_limit INTEGER DEFAULT 0,
                    message_count INTEGER DEFAULT 0
                )` },
            { name: 'ai_participants', sql: `
                CREATE TABLE IF NOT EXISTS ai_participants (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                    model_name VARCHAR(255) NOT NULL,
                    model_provider VARCHAR(50) NOT NULL,
                    personality_name VARCHAR(100) NOT NULL,
                    system_instruction TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )` },
            { name: 'messages', sql: `
                CREATE TABLE IF NOT EXISTS messages (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                    sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('user', 'ai')),
                    sender_name VARCHAR(100),
                    model_name VARCHAR(255),
                    content TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    message_order INTEGER NOT NULL
                )` }
        ];

        for (const table of tables) {
            const exists = await targetClient.query(`
                SELECT 1 FROM information_schema.tables 
                WHERE table_name = '${table.name}'`);
            
            if (exists.rows.length === 0) {
                await targetClient.query(table.sql);
                console.log(chalk.green('✓ ' + table.name + ' table created'));
            } else {
                console.log(chalk.yellow('✓ ' + table.name + ' table already exists'));
            }
        }

        // Indexes
        const indexes = [
            { name: 'idx_conversations_created_at', sql: 'CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);' },
            { name: 'idx_messages_conversation_id', sql: 'CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);' },
            { name: 'idx_messages_order', sql: 'CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(conversation_id, message_order);' }
        ];

        for (const index of indexes) {
            const exists = await targetClient.query(`
                SELECT 1 FROM pg_indexes 
                WHERE indexname = '${index.name}'`);
            
            if (exists.rows.length === 0) {
                await targetClient.query(index.sql);
                console.log(chalk.green('✓ ' + index.name + ' index created'));
            } else {
                console.log(chalk.yellow('✓ ' + index.name + ' index already exists'));
            }
        }

        await targetClient.end();
        console.log(chalk.green('\n✓ Setup complete!\n'));

    } catch (err) {
        console.log(chalk.red('\n✗ Error: ' + err.message + '\n'));
        process.exit(1);
    }
}

setupDatabase();