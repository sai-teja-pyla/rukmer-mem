const { Pool } = require('pg');

// 1. Detect if we are running in the Google Cloud Run environment
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;

let dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    max: 20, // Connection pooling for enterprise scale
    idleTimeoutMillis: 30000,
};

if (isProduction) {
    // 2. PRODUCTION: Connect via Unix Socket
    // The format is /cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
    const connectionName = process.env.CLOUD_SQL_CONNECTION_NAME || 'rukmer-saas:us-central1:rukmer-saas-ai';
    dbConfig.host = `/cloudsql/${connectionName}`;
} else {
    // 3. LOCAL: Connect via localhost (Cloud SQL Auth Proxy)
    dbConfig.host = '16.98.92.52';
    dbConfig.port = 5432;
}

const pool = new Pool(dbConfig);

// Diagnostic: Log connection status on startup
pool.on('connect', () => {
    console.log(`📡 Rukmer DB: Connected via ${isProduction ? 'Unix Socket' : 'Local Proxy'}`);
});

pool.on('error', (err) => {
    console.error('🚨 Rukmer DB: Unexpected error on idle client', err);
    process.exit(-1);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};