import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
import pool from './backend/config/db.js';
import { Storage } from '@google-cloud/storage';
import path from 'path';
import { fileURLToPath } from 'url';

// 1. Setup paths for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;

// 2. Storage Configuration (Environment Aware)
const storageOptions = { projectId: 'rukmer-saas' };
if (!isProduction) {
    storageOptions.keyFilename = path.join(process.cwd(), 'service-account.json');
}
const storage = new Storage(storageOptions);

// 3. Middleware
app.use(cors({
    origin: [
        'https://rukmer-saas-service-361739908342.us-central1.run.app',
        'http://localhost:5173',
        'https://rukmer-saas.web.app'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin, X-Requested-With, Content-Type, Accept, Authorization, x-goog-resumable'],
    credentials: true
}));

app.options('*', cors()); // Enable pre-flight for all routes
app.use(express.json());

// Serve static files from React build
app.use(express.static(path.join(process.cwd(), 'dist')));

// 4. API Routes

// Root/Health Check
app.get('/', (req, res) => {
    res.send(`<div style="font-family:sans-serif;text-align:center;padding:50px;">
        <h1>🚀 Rukmer AI Backend is Live</h1>
        <p>Database: <strong>${process.env.DB_NAME || 'Not Connected'}</strong></p>
    </div>`);
});

// Chat Route
app.post('/api/chat', async (req, res) => {
    try {
        const { userId, reportId, message, aiResponse, imageUrl } = req.body;
        const result = await pool.query(
            `INSERT INTO chats (user_id, report_id, user_message, ai_reply, image_url, is_active) 
             VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *`,
            [userId, reportId, message, aiResponse, imageUrl]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error("🚨 Chat Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// History Route
app.get('/api/history', async (req, res) => {
    const { userId } = req.query;
    try {
        const result = await pool.query(
            `SELECT * FROM chats WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at ASC LIMIT 30`,
            [userId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error("🚨 History Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// GCS Resumable URL Route
app.post('/api/storage/resumable-url', async (req, res) => {
    try {
        const { fileName, contentType, userId } = req.body;
        const bucket = storage.bucket('rukmer-saas-data'); 
        const filePath = `uploads/${userId}/${Date.now()}_${fileName}`;
        const file = bucket.file(filePath);

        const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'resumable',
            expires: Date.now() + 60 * 60 * 1000,
            contentType: contentType,
        });

        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
        res.json({ uploadUrl: url, publicUrl: publicUrl });
    } catch (error) {
        console.error("🚨 GCS Error:", error.message);
        res.status(500).json({ error: "Failed to generate upload URL" });
    }
});

// 5. Catch-All Route for React SPA (MUST BE LAST)
// Named wildcard syntax for Express 5 compatibility
app.get('/*splat', (req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'API route not found' });
    }
    res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
});

// 6. Start Server
const runSetup = async () => {
    // Listen first to pass Cloud Run health checks
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Rukmer Backend is listening on port ${PORT}`);
        
        // Connect to DB in background
        pool.query("SELECT 1")
            .then(() => console.log("✅ Connected to PostgreSQL"))
            .catch((err) => {
                console.error("❌ Database Connection Failed:", err.message);
            });
    });
};

runSetup();