
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
import pool from './backend/config/db.js'; // Ensure this path is correct in your project
import { Storage } from '@google-cloud/storage';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

//const folderName = userName ? `${userName}_${userId}` : userId;

// 1. Storage Configuration
// Note: Ensure service-account.json is in your root folder
const storageConfig = {
  projectId: 'rukmer-saas',
};

// ONLY add the key file if we are NOT in production
if (process.env.NODE_ENV !== 'production') {
  storageConfig.keyFilename = path.join(process.cwd(), 'service-account.json');
}

const storage = new Storage(storageConfig);

const folderName = "FORCE_TEST_" + Date.now();

//app.use(express.static(path.join(__dirname, 'dist')));

app.use(express.static(path.join(process.cwd(), 'dist')));

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;

// 2. Middleware (Fixed CORS for Production)
app.use((req, res, next) => {
    const allowedOrigins = [
        'http://localhost:5173', // Local development (Vite default)
        'https://rukmer-saas-service-361739908342.us-central1.run.app' // Production
    ];
    
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }

    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-goog-resumable');
    res.header('Access-Control-Allow-Credentials', 'true');

    // EXPLICITLY handle the OPTIONS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).send();
    }
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));



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



app.post('/api/storage/resumable-url', async (req, res) => {
    try {
        const { fileName, contentType, userId, userName } = req.body;
        const bucket = storage.bucket('rukmer-saas-data');
        const displayLabel = userName || 'user';
        const safeName = (userName || 'user')
            .split('@')[0]
            .replace(/[^a-z0-9]/gi, '_') // Replace symbols with underscores
            .toLowerCase();

        const folderName = `${safeName}_${userId.substring(0, 5)}`;

        // Map the contentType to your new folder names
        let rootDir = 'others'; // Fallback for PDF, etc.
        if (contentType.startsWith('image/')) rootDir = 'images';
        if (contentType.startsWith('video/')) rootDir = 'videos';

        //const rootDir = category === 'reports' ? 'reports' : 'uploads';
        const filePath = `${rootDir}/${folderName}/${Date.now()}_${fileName}`; // Foldername replaced
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

app.get('/api/storage/files', async (req, res) => {
    try {
        const { userId } = req.query; // The frontend sends the long UID
        const bucket = storage.bucket('rukmer-saas-data');

        // 1. Search everything under 'uploads/'
        const [allFiles] = await bucket.getFiles();


        // 2. Filter files: Keep them if the path contains the userId
        // This works for: 
        // - uploads/ya42I9u7.../ (Old format)
        // - uploads/john_ya42I/ (New format)
        //const userFiles = allFiles.filter(file => file.name.includes(userId.substring(0, 5)) || file.name.includes(userId));

        const shortId = userId.substring(0, 5);
        const userFiles = allFiles.filter(file => 
            file.name.includes(shortId) || file.name.includes(userId)
        );

        // 3. Map to a clean list for the frontend
        const fileList = userFiles.map(file => ({
            name: file.name.split('/').pop(), // Just the filename
            fullPath: file.name,
            url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
            timeCreated: file.metadata.timeCreated
        }));

        res.json(fileList);
    } catch (error) {
        console.error("🚨 Error listing files:", error);
        res.status(500).json({ error: "Failed to fetch files" });
    }
});

app.get('/{*any}', (req, res) => {
    // If it's a broken API call, return a JSON error
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'API route not found' });
    }
    // Otherwise, serve the React app
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});




// 4. Start Server
const runSetup = async () => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Rukmer Backend is listening on port ${PORT}`);
        
        // 2. Perform DB check in the background after the server is up
        pool.query("SELECT 1")
            .then(() => {
                console.log("✅ Connected to PostgreSQL");
            })
            .catch((err) => {
                console.error("❌ Database Connection Failed:", err.message);
                console.log("⚠️  Server is still running, but DB features will fail.");
            });
    });
};

// Execute the function
runSetup();