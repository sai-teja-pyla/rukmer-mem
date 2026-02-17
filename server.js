import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
import pool from './backend/config/db.js'; // Ensure this path is correct in your project
import { Storage } from '@google-cloud/storage';
import path from 'path';


dotenv.config();
const app = express();
const PORT = process.env.PORT || 5001 || 8080;

// 1. Storage Configuration
// Note: Ensure service-account.json is in your root folder
const storage = new Storage({
    keyFilename: path.join(process.cwd(), 'service-account.json'),
    projectId: 'rukmer-saas'
});

app.use(express.static(path.join(__dirname, 'dist')));

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: isProduction 
        ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` 
        : (process.env.DB_HOST || '127.0.0.1'),
    port: isProduction ? 5432 : (process.env.DB_PORT || 5432),
};

// 2. Middleware (Fixed CORS for Production)
app.use(cors({
  // Refined: Allow both local and production URLs to prevent CORS errors
  origin: [
    process.env.FRONTEND_URL, process.env.HOST_BASE_URL
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// 3. Routes

// Root Route (Visual confirmation)
app.get('/', (req, res) => {
    res.send(`<div style="font-family:sans-serif;text-align:center;padding:50px;">
        <h1>🚀 Rukmer AI Backend is Live</h1>
        <p>Database: <strong>${process.env.DB_NAME}</strong></p>
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
    res.status(500).json({ error: err.message });
  }
});

/**
 * FIXED: Resumable URL Route (Merged & Corrected)
 */
app.post('/api/storage/resumable-url', async (req, res) => {
    try {
        const { fileName, contentType, userId } = req.body;
        const bucket = storage.bucket('rukmer-saas-data'); 
        const filePath = `uploads/${userId}/${Date.now()}_${fileName}`;
        const file = bucket.file(filePath);

        console.log(`📋 Generating resumable URL for: ${fileName}`);

        // Generate V4 Signed URL for resumable upload
        const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'resumable',
            expires: Date.now() + 60 * 60 * 1000, // 1 hour
            contentType: contentType,
        });

        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

        res.json({ 
            uploadUrl: url, 
            publicUrl: publicUrl 
        });
    } catch (error) {
        console.error("🚨 GCS Resumable URL Error:", error.message);
        res.status(500).json({ error: "Failed to generate upload URL" });
    }
});

// 4. Start Server
const runSetup = async () => {
    try {
        await pool.query("SELECT 1");
        console.log("✅ Connected to PostgreSQL");
    } catch (err) {
        console.error("❌ Database Connection Failed:", err.message);
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Rukmer Backend running on port ${PORT}`);
    });
};

runSetup();