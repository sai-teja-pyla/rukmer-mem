// backend/config/db.js
import path from 'path';
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Necessary for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// 1. Detect environment
// Cloud Run provides 'K_SERVICE' automatically
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    // Fix: Ensure the ? follows the condition and : separates the options
    host: isProduction 
        ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` 
        : '127.0.0.1',
    port: 5432,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
};

if (isProduction) {
    /**
     * PRODUCTION: Connect via Unix Socket
     * This is the fastest and most secure method inside Google Cloud.
     * Ensure you enabled the 'Cloud SQL Connection' in your Cloud Run settings.
     */
    const connectionName = process.env.INSTANCE_CONNECTION_NAME;
    dbConfig.host = `/cloudsql/${connectionName}`;
} else {
    /**
     * LOCAL: Connect via Public IP
     * The ETIMEDOUT error happened because the 'Authorized Networks' 
     * firewall on Cloud SQL is blocking your local machine.
     */
    dbConfig.host = process.env.DB_HOST || '127.0.0.1';
    dbConfig.port = 5432;
}

const pool = new Pool(dbConfig);

pool.on('connect', () => {
    console.log(`📡 Rukmer DB: Connected via ${isProduction ? 'Unix Socket' : 'Public IP (' + dbConfig.host + ')'}`);
});

pool.on('error', (err) => {
    console.error('🚨 Rukmer DB: Unexpected error on idle client', err);
    // On ETIMEDOUT, check if your local IP is whitelisted in Google Cloud Console
});

// Refined Export for ESM (Compatibility with your server.js import)
export const query = (text, params) => pool.query(text, params);
export default pool;

// This forces the app to try connecting immediately on startup
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error("❌ CONNECTION ATTEMPT FAILED:", err.message);
    } else {
        console.log("✅ DATABASE HANDSHAKE SUCCESSFUL AT:", res.rows[0].now);
    }
});