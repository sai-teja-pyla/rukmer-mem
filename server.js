import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
// This imports the pool you already configured in db.js
import pool from './backend/config/db.js'; 

// 1. Load Environment Variables
dotenv.config();

const { Pool } = pkg;
const app = express();
const PORT = process.env.PORT || 5001 || 8080;

// 2. Database Config
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;

/**
 * NOTE: We are using the 'pool' imported above from db.js.
 * We keep your dbConfig object here for your reference, but we 
 * do NOT redeclare 'const pool' to avoid the "already declared" error.
 */
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: isProduction 
        ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` 
        : (process.env.DB_HOST || '127.0.0.1'),
    port: isProduction ? 5432 : (process.env.DB_PORT || 5432),
};

// 3. Middleware
app.use(cors({
  // Refined: Allow both local and production URLs to prevent CORS errors
  origin: [
    process.env.FRONTEND_URL, process.env.HOST_BASE_URL
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// 4. Routes

// --- ADDED: Root Route to fix "Cannot GET /" ---
app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: sans-serif; text-align: center; padding-top: 50px;">
            <h1>🚀 Rukmer AI Backend is Live</h1>
            <p>Status: <strong>Connected to Database: ${process.env.DB_NAME}</strong></p>
            <p>Environment: <strong>${isProduction ? 'Production' : 'Development'}</strong></p>
        </div>
    `);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/chat', async (req, res) => {
    try {
        const { message, aiResponse, imageUrl } = req.body; 
        
        const query = 'INSERT INTO chats (user_message, ai_reply, image_url) VALUES ($1, $2, $3) RETURNING *';
        const values = [message, aiResponse, imageUrl || null];
        
        const result = await pool.query(query, values);
        console.log("✅ Chat Saved to Cloud SQL:", result.rows[0].id);
        res.json(result.rows[0]);
    } catch (error) {
        console.error("🚨 DB Insert Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/history', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM chats WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 30');
        console.log(`Sent ${result.rowCount} rows to frontend`);
        res.json(result.rows);
    } catch (error) {
        console.error("Backend History Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/chat/hide', async (req, res) => {
    try {
        // Refined: Added 'result' variable to capture the count properly
        const result = await pool.query('UPDATE chats SET is_active = FALSE WHERE is_active = TRUE');
        console.log(`✅ Soft-deleted ${result.rowCount} rows.`);
        res.json({ message: "Chat history hidden from UI" });
    } catch (error) {
        console.error("🚨 Hide Route Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// 5. THE FIX: The Diagnostic and Server Start
const runSetup = async () => {
    try {
        const res = await pool.query("SELECT current_database(), now(), inet_server_addr();");
        
        console.log("✅ Connected to PostgreSQL");
        console.log("--- DATABASE DIAGNOSTIC ---");
        console.log("Connected to DB Name:", res.rows[0].current_database);
        console.log("Server IP seen by DB:", res.rows[0].inet_server_addr || 'Unix Socket/Local');
        console.log("Server Time:", res.rows[0].now);
        console.log("---------------------------");

    } catch (err) {
        console.error("❌ Database Diagnostic Failed:", err.message);
    }

    app.listen(PORT, () => {
        console.log(`🚀 Rukmer Backend running on port ${PORT}`);
        console.log(`Environment: ${isProduction ? 'Production' : 'Development'}`);
    });
};

runSetup();