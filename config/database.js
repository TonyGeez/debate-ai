const { Pool } = require('pg');
require('dotenv').config();
const logger = require('../logger');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    max: 220,
    idleTimeoutMillis: 300000,
    connectionTimeoutMillis: 20000,
});

logger.info('DATABASE', 'Database pool created', { 
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.POSTGRES_DB,
    max: 220
});

pool.on('error', (err) => {
    logger.error('DATABASE', 'Unexpected error on idle client', { error: err.message });
    process.exit(-1);
});

pool.on('connect', () => {
    logger.debug('DATABASE', 'New client connected to database');
});

pool.on('remove', () => {
    logger.debug('DATABASE', 'Client removed from database pool');
});

module.exports = pool;
