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
    host: isProduction 
        ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` 
        : '127.0.0.1',
    port: isProduction ? undefined : 5432,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,  // Increased from 2000 to 5000ms
    statement_timeout: 10000,
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
    console.error('  Host:', dbConfig.host);
    console.error('  Port:', dbConfig.port);
    console.error('  Database:', dbConfig.database);
});

// Refined Export for ESM (Compatibility with your server.js import)
export const query = (text, params) => pool.query(text, params);
export default pool;

// For development: make database optional by default
const REQUIRE_DB = process.env.REQUIRE_DB === 'true';

// Try to connect on startup with better error handling
const testConnection = async () => {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log("✅ DATABASE HANDSHAKE SUCCESSFUL AT:", result.rows[0].now);
        return true;
    } catch (err) {
        console.error("\n❌ DATABASE CONNECTION FAILED");
        console.error("  Error:", err.message);
        console.error("  Connection Target:", `${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
        
        if (isProduction || REQUIRE_DB) {
            console.error("\n⚠️  FATAL: Database is required in production\n");
            process.exit(1);  // Exit if database is required
        } else {
            console.warn("\n⚠️  DATABASE UNAVAILABLE (development mode)");
            console.warn("  The app will continue without database functionality");
            console.warn("\n  To fix this:");
            console.warn("  1. Open a new terminal in the project root");
            console.warn("  2. Run: cloud-sql-proxy rukmer-saas:us-central1:rukmer-saas-ai");
            console.warn("  3. Restart this server");
            console.warn("  4. Or set REQUIRE_DB=true to exit on failure\n");
        }
        return false;
    }
};

// Run connection test asynchronously
testConnection().catch(err => {
    if (isProduction || REQUIRE_DB) {
        console.error("Failed to connect to database during startup", err);
        process.exit(1);
    }
});