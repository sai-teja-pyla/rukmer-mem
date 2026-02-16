import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
// This imports the pool you already configured in db.js
import pool from './backend/config/db.js';
import { Storage } from '@google-cloud/storage';
import path from 'path';

// 1. Load Environment Variables
dotenv.config();

const { Pool } = pkg;
const app = express();
const PORT = process.env.PORT || 8080;

const storage = new Storage({
    keyFilename: path.join(process.cwd(), 'service-account.json'), // Path to your key
    projectId: 'rukmer-saas' // Your GCP Project ID
});

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
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-goog-resumable']
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

app.post('/api/chat', async (req, res) => { // <--- WAS likely '/chat'
  try {
    const { userId, reportId, message, aiResponse, imageUrl } = req.body;
    console.log("📥 Received Chat:", { userId, message });

    // ... (your existing database logic) ...
    
    // Example DB Insert (Keep your existing logic inside!)
    const result = await pool.query(
      `INSERT INTO chats (user_id, report_id, user_message, ai_reply, image_url, is_active) 
       VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *`,
      [userId, reportId, message, aiResponse, imageUrl]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("🚨 Chat Error:", err);
    res.status(200).json({ error: err.message });
  }
});

app.get('/api/history', async (req, res) => { // <--- WAS likely '/history'
  const { userId } = req.query;
  try {
    const result = await pool.query(
      `SELECT * FROM chats WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at ASC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/chat/hide', async (req, res) => { // <--- WAS likely '/chat/hide'
  try {
    // ... your logic ...
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// backend/server.js
// CRITICAL FIX: Proper resumable upload URL generation
app.post('/api/storage/resumable-url', async (req, res) => {
    try {
        const { fileName, contentType, userId } = req.body;

        const bucket = storage.bucket('rukmer-saas-data'); 
        const filePath = `uploads/${userId}/${Date.now()}_${fileName}`;
        const file = bucket.file(filePath);

        console.log(`📋 Generating resumable URL for: ${fileName}`);
        console.log(`📍 Destination: ${filePath}`);
        console.log(`📦 Content-Type: ${contentType}`);

        // CRITICAL: Use 'resumable' action with proper headers
        const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'resumable',  // This enables chunked uploads
            expires: Date.now() + 3 * 60 * 60 * 1000, // 3 hours (enough for large uploads)
            contentType: contentType,
            extensionHeaders: {
                'x-goog-resumable': 'start'  // Required header for resumable uploads
            }
        });

        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

        console.log(`✅ Handshake Success for: ${fileName}`);

        console.log(`✅ Resumable URL generated successfully`);
        console.log(`🔗 Upload URL: ${url.substring(0, 60)}...`);
        console.log(`🌐 Public URL: ${publicUrl}`);

        res.json({ 
            uploadUrl: url, 
            publicUrl: `https://storage.googleapis.com/rukmer-saas-data/${filePath}` 
        });

    } catch (error) {
        console.error("🚨 GCS Resumable URL Error:", error.message);
        console.error("Stack:", error.stack);
        res.status(500).json({ 
            error: "Failed to generate resumable upload URL",
            details: error.message,
            bucket: 'rukmer-saas-data'
        });
    }
});

// NEW: Check upload status (optional but helpful for debugging)
// backend/server.js
app.post('/api/storage/resumable-url', async (req, res) => {
    try {
        const { fileName, contentType, userId } = req.body;
        
        const bucket = storage.bucket('rukmer-saas-data'); 
        const filePath = `uploads/${userId}/${Date.now()}_${fileName}`;
        const file = bucket.file(filePath);

        // V4 Signing enabled chunked/resumable uploads for 5GB stability
        const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'resumable', 
            expires: Date.now() + 60 * 60 * 1000, // 1 hour session
            contentType: contentType,
        });

        res.json({ 
            uploadUrl: url, 
            publicUrl: `https://storage.googleapis.com/rukmer-saas-data/${filePath}` 
        });
    } catch (error) {
        console.error("🚨 Handshake Error:", error.message);
        res.status(500).json({ error: "Cloud signing failed" });
    }
});

// NEW: List uploaded files for a user (helpful for debugging)
app.get('/api/storage/list/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const prefix = `uploads/${userId}/`;
        
        const bucket = storage.bucket('rukmer-saas-data');
        const [files] = await bucket.getFiles({ prefix });
        
        const fileList = files.map(file => ({
            name: file.name,
            size: file.metadata.size,
            contentType: file.metadata.contentType,
            created: file.metadata.timeCreated,
            publicUrl: `https://storage.googleapis.com/${bucket.name}/${file.name}`
        }));

        console.log(`📂 Listed ${fileList.length} files for user: ${userId}`);
        res.json({ files: fileList, count: fileList.length });
    } catch (error) {
        console.error("List files error:", error);
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

        // Test GCS connection
        try {
            const bucket = storage.bucket('rukmer-saas-data');
            const [exists] = await bucket.exists();
            if (exists) {
                console.log("✅ Connected to GCS Bucket: rukmer-saas-data");
            } else {
                console.warn("⚠️ GCS Bucket 'rukmer-saas-data' not found!");
            }
        } catch (gcsError) {
            console.error("❌ GCS Connection Error:", gcsError.message);
        }

    } catch (err) {
        console.error("❌ Database Diagnostic Failed:", err.message);
    }

    app.listen(PORT, () => {
        console.log(`🚀 Rukmer Backend running on port ${PORT}`);
        console.log(`Environment: ${isProduction ? 'Production' : 'Development'}`);
        console.log(`📡 API Base: http://localhost:${PORT}/api`);
        console.log(`📦 GCS Bucket: rukmer-saas-data`);
        console.log(`\n🔧 Resumable uploads enabled for files up to 5GB`);
    });
};

runSetup();