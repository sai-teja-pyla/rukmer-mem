import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
import pool from './backend/config/db.js'; 
import { Storage } from '@google-cloud/storage';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin'; // 🚨 The Security Bouncer
//import { stripeWebhookHandler } from './backend/config/stripeController.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// --- 1. Cloud Storage Configuration ---
const storageConfig = { projectId: 'rukmer-saas' };
if (process.env.NODE_ENV !== 'production') {
  storageConfig.keyFilename = path.join(process.cwd(), 'service-account.json');
}
const storage = new Storage(storageConfig);

// --- 2. Firebase Admin Security ---
if (!admin.apps.length) {
    const adminConfig = {};
    if (process.env.NODE_ENV !== 'production') {
        adminConfig.credential = admin.credential.cert(path.join(process.cwd(), 'service-account.json'));
    } else {
        adminConfig.credential = admin.credential.applicationDefault();
    }
    admin.initializeApp(adminConfig);
}

// --- 3. Static Files & CORS ---
app.use(express.static(path.join(process.cwd(), 'dist')));

app.use((req, res, next) => {
    const allowedOrigins = [
        'http://localhost:5173', 
        'https://rukmer-saas-service-361739908342.us-central1.run.app',
        'https://rukmer.com',
        'https://www.rukmer.com',
        'https://app.rukmer.com'
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-goog-resumable');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        return res.status(200).send();
    }
    next();
});


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 5. The Production Auth Middleware ---
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    console.log("📋 Request to:", req.method, req.path);
    console.log("📋 Auth Header Received:", authHeader ? "YES" : "NO");
    console.log("📋 All Headers:", req.headers);
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn("🚨 Blocked: Missing Firebase token");
        console.warn("Expected format: 'Bearer <token>', but got:", authHeader);
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        console.log("✅ Token verified for user:", decodedToken.uid);
        next();
    } catch (error) {
        console.error("🚨 Token Verification Failed:", error.message);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

// --- 6. Routes ---
app.get('/', (req, res) => {
    res.send(`<div style="font-family:sans-serif;text-align:center;padding:50px;">
        <h1>🚀 Rukmer AI Backend is Live</h1>
    </div>`);
});

// Apply auth only to protected routes
app.post('/api/chat', authenticateUser, async (req, res) => {
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

app.get('/api/history', authenticateUser, async (req, res) => {
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

app.post('/api/storage/resumable-url', authenticateUser, async (req, res) => {
    try {
        const { fileName, contentType, userId, userName } = req.body;
        const bucket = storage.bucket('rukmer-saas-data');
        const safeName = (userName || 'user').split('@')[0].replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const folderName = `${safeName}_${userId.substring(0, 5)}`;
        
        let rootDir = 'others'; 
        if (contentType.startsWith('image/')) rootDir = 'images';
        if (contentType.startsWith('video/')) rootDir = 'videos';

        const filePath = `${rootDir}/${folderName}/${Date.now()}_${fileName}`;
        const file = bucket.file(filePath);
        const [url] = await file.getSignedUrl({
            version: 'v4', action: 'resumable', expires: Date.now() + 60 * 60 * 1000, contentType
        });

        res.json({ uploadUrl: url, publicUrl: `https://storage.googleapis.com/${bucket.name}/${filePath}` });
    } catch (error) {
        res.status(500).json({ error: "Failed to generate upload URL" });
    }
});

app.get('/api/storage/files', authenticateUser, async (req, res) => {
    try {
        const { userId } = req.query; 
        const bucket = storage.bucket('rukmer-saas-data');
        const [allFiles] = await bucket.getFiles();
        const shortId = userId.substring(0, 5);
        const userFiles = allFiles.filter(f => f.name.includes(shortId) || f.name.includes(userId));

        const fileList = userFiles.map(file => ({
            name: file.name.split('/').pop(),
            fullPath: file.name,
            url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
            timeCreated: file.metadata.timeCreated
        }));
        res.json(fileList);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch files" });
    }
});

app.put('/api/chat/hide', authenticateUser, async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "User ID is required" });
    try {
        await pool.query("UPDATE chats SET is_active = FALSE WHERE user_id = $1 AND is_active = TRUE", [userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/chat/history/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query("SELECT * FROM chats WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at ASC", [userId]);
        res.json({ success: true, hidden: result.rowCount });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch history" });
    }
});

app.get('/api/user-status/:userId', authenticateUser, async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await pool.query('SELECT is_pro, plan_type FROM users WHERE id = $1', [userId]);
        if (result.rows.length > 0) {
            res.json({ isPro: result.rows[0].is_pro, planType: result.rows[0].plan_type });
        } else {
            res.json({ isPro: false, planType: 'free' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user status' });
    }
});

// Example Node.js/Express Route
app.delete('/api/user/delete-complete', authenticateUser,async (req, res) => {
  try {
    const token = req.headers.authorization.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;

    // 1. Delete from PostgreSQL
    // await pool.query('DELETE FROM chats WHERE user_id = $1', [uid]);

    // 2. Delete from Google Cloud Storage
    // await storage.bucket('rukmer-assets').deleteFiles({ prefix: `uploads/${uid}/` });

    res.status(200).send({ message: 'Cleanup successful' });
  } catch (error) {
    console.error(error);
    res.status(500).send('Cleanup failed');
  }
});

app.get('/{*any}', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found' });
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// --- 7. Start Server ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Rukmer Backend on port ${PORT}`);
    pool.query("SELECT 1")
        .then(() => console.log("✅ PostgreSQL Connected"))
        .catch(err => console.error("❌ DB Error:", err.message));
});