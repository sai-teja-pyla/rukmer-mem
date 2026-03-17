import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env FIRST before anything reads process.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

// @ts-ignore
import poolImport from './backend/config/db.js';
import axios from 'axios';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { google } from 'googleapis';
import { oauth2Client, GOOGLE_SCOPES } from './backend/config/googleConfig.js';

const pool = poolImport as any; 
import { Storage } from '@google-cloud/storage';
import { sendWelcomeEmail } from './src/utils/mailer.js';
import fs from 'fs';
import admin from 'firebase-admin'; // 🚨 The Security Bouncer

//import { stripeWebhookHandler } from './backend/config/stripeController.js';


const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID ||'9849608649938.10629448222436';
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET || 'cb6668a9774c3cf8a8327f8cb8fbf6ae';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173/dashboard';
const BACKEND_HOST = process.env.BACKEND_HOST || 'http://localhost:5001';
const BACKEND_PORT = process.env.PORT || 8080;

const IS_PROD = process.env.NODE_ENV === 'production';
const CURRENT_BACKEND_URL = IS_PROD ? 'https://app.rukmer.com' : 'http://localhost:5001';

const app: any = express();
const PORT = (process.env.PORT || 8080) as number | string;

async function refreshMicrosoftToken(userId: string, refreshToken: string) {
  try {
    const data = new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_secret: process.env.MS_CLIENT_SECRET!
    });

    const response = await axios.post(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      data.toString(), // Convert URLSearchParams to string
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token: newRefreshToken } = response.data;

    // Update Firestore so the NEXT request uses the fresh token
    await admin.firestore().collection('userTokens').doc(userId).set({
      microsoft: {
        access_token,
        refresh_token: newRefreshToken || refreshToken, // MS doesn't always send a new refresh token
        expires_at: Date.now() + 3500 * 1000 // Tokens usually last 1 hour
      }
    }, { merge: true });

    return access_token;
  } catch (error: any) {
    console.error("❌ Microsoft Refresh Failed:", error.response?.data || error.message);
    return null;
  }
}

// --- 1. Cloud Storage Configuration ---
const storageConfig: any = { projectId: 'rukmer-saas' };
if (process.env.NODE_ENV !== 'production') {
  storageConfig.keyFilename = path.join(process.cwd(), 'service-account.json');
}
const storage = new Storage(storageConfig);

// --- 2. Firebase Admin Security ---
if (!admin.apps.length) {
    const adminConfig: any = {};
    if (process.env.NODE_ENV !== 'production') {
        const serviceAccountPath = path.join(process.cwd(), 'service-account.json');
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        adminConfig.credential = admin.credential.cert(serviceAccount);
    } else {
        adminConfig.credential = admin.credential.applicationDefault();
    }
    admin.initializeApp(adminConfig);
}

const getAppContent = async (userId: string) => {
  const tokenDoc = await admin.firestore().collection('userTokens').doc(userId).get();
  const tokens = tokenDoc.data() as { google?: any; slack?: any; microsoft?: any } | undefined;
  let context = "";

  // --- GMAIL ---
  if (tokens?.google && tokens.google.access_token) {
    try {
      const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        `${CURRENT_BACKEND_URL}/api/auth/google/callback`
      );
      auth.setCredentials(tokens.google);
      const gmail = google.gmail({ version: 'v1', auth });
      const msgs = await gmail.users.messages.list({ userId: 'me', maxResults: 5 });
      if (msgs.data.messages && msgs.data.messages.length > 0) {
        context += `\n📧 Gmail Emails:\n`;
        for (const msg of msgs.data.messages) {
          if (!msg.id) continue;
          const fullMsg = await gmail.users.messages.get({ userId: 'me', id: msg.id as string });
          const headers = (fullMsg.data.payload?.headers as any[] | undefined) || [];
          const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(No subject)';
          const from = headers.find((h: any) => h.name === 'From')?.value || '(Unknown sender)';
          const date = headers.find((h: any) => h.name === 'Date')?.value || '(Unknown date)';
          const snippet = fullMsg.data.snippet || '(No preview)';
          context += `  - From: ${from} | Subject: ${subject} | Date: ${date}\n    Preview: ${snippet}\n`;
        }
      }
    } catch (err: any) {
      console.warn("⚠️  Gmail fetch failed:", err.message);
    }
  }

  // --- SLACK ---
  if (tokens?.slack) {
    try {
      // First, get the list of channels
      const channelsRes = await axios.get('https://slack.com/api/conversations.list', {
        headers: { Authorization: `Bearer ${tokens.slack.accessToken}` },
        params: { limit: 1, types: 'public_channel' }
      });
      
      if (channelsRes.data.ok && channelsRes.data.channels.length > 0) {
        const channelId = channelsRes.data.channels[0].id;
        const channelName = channelsRes.data.channels[0].name;
        
        // Then fetch history from that channel
        const slackRes = await axios.get('https://slack.com/api/conversations.history', {
          params: { channel: channelId, limit: 5 },
          headers: { Authorization: `Bearer ${tokens.slack.accessToken}` }
        });
        
        if (slackRes.data.ok && slackRes.data.messages) {
          context += `\n💬 Recent Slack Messages (${channelName} channel):\n`;
          for (const msg of slackRes.data.messages) {
            const text = msg.text || '(No text)';
            const user = msg.user || '(Unknown user)';
            const ts = new Date(msg.ts * 1000).toLocaleString();
            context += `  - User: ${user} | Time: ${ts}\n    Message: ${text.substring(0, 100)}...\n`;
          }
        }
      } else if (!channelsRes.data.ok) {
        console.warn("⚠️  Slack channels error:", channelsRes.data.error);
      }
    } catch (err: any) {
      console.warn("⚠️  Slack fetch failed:", err.message);
    }
  }

  // --- OUTLOOK / MICROSOFT ---
  if (tokens?.microsoft) {
    try {
      // Microsoft tokens have: access_token, refresh_token, expires_in, etc.
      const accessToken = tokens.microsoft.access_token;
      if (!accessToken) throw new Error("No access token in Microsoft tokens");
      
      const outlookRes = await axios.get('https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=subject,from,receivedDateTime,bodyPreview', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (outlookRes.data.value && outlookRes.data.value.length > 0) {
        context += `\n📬 Outlook Emails:\n`;
        for (const msg of outlookRes.data.value) {
          const from = msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || '(Unknown sender)';
          const subject = msg.subject || '(No subject)';
          const date = msg.receivedDateTime || '(Unknown date)';
          const preview = msg.bodyPreview || '(No preview)';
          context += `  - From: ${from} | Subject: ${subject} | Date: ${date}\n    Preview: ${preview}\n`;
        }
      }
    } catch (err: any) {
      console.warn("⚠️  Outlook fetch failed:", err.message);
      if (err.response?.data?.error) {
        console.warn("   Error details:", err.response.data.error);
      }
    }
  }

  if (tokens?.microsoft && tokens.microsoft.access_token) { // Fetch teams if Microsoft token exists
    try {
      // Check if teams is explicitly enabled in userConnections
      const connectionsDoc = await admin.firestore().collection('userConnections').doc(userId).get();
      const connections = connectionsDoc.data() || {} as any;
      
      if (!connections.teams) {
        console.log("⏭️  Teams not enabled in userConnections, skipping teams fetch");
      } else {
        const accessToken = tokens.microsoft.access_token;
        
        // 1. Get the list of Teams the user is in
        const teamsRes = await axios.get('https://graph.microsoft.com/v1.0/me/joinedTeams', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (teamsRes.data.value && teamsRes.data.value.length > 0) {
          context += `\n👥 Microsoft Teams:\n`;
          
          // Let's look at the first 2 teams to keep context concise
          for (const team of teamsRes.data.value.slice(0, 2)) {
            context += `  - Team: ${team.displayName}\n`;
            
            // Optional: Get channels for this team
            const channelsRes = await axios.get(`https://graph.microsoft.com/v1.0/teams/${team.id}/channels`, {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            
            const channelNames = channelsRes.data.value.map((c: any) => c.displayName).join(', ');
            context += `    Channels: ${channelNames}\n`;
          }
        }
      }
    } catch (err: any) {
      console.warn("⚠️  Teams fetch failed:", err.message);
    }
  }

  return context || "(No connected apps or no data available)";
};

// --- 3. Static Files & CORS ---
app.use(express.static(path.join(process.cwd(), 'dist')));

app.use((req: any, res: any, next: any): void => {
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
const authenticateUser = async (req: any, res: any, next: any): Promise<void> => {
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
    } catch (error: any) {
        console.error("🚨 Token Verification Failed:", error?.message || error);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

// --- SERVER-SIDE GEMINI HELPER ---
async function callGemini(prompt: string): Promise<string> {
    try {
        const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        console.log("🔑 API Key debug:", apiKey ? `${apiKey.substring(0, 10)}... (length: ${apiKey.length})` : "NOT SET");
        console.log("🔑 Key char codes:", apiKey ? [...apiKey].map(c => c.charCodeAt(0)).slice(0, 5).join(',') : "N/A");
        if (!apiKey) throw new Error('Missing GEMINI_API_KEY in server .env');
        
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-3.1-flash-lite-preview",
            // 🧠 UPDATED INSTRUCTION: More personality, less "bot"
            systemInstruction: `You are Rukmer, a friendly and intelligent workplace sidekick. 
            Your vibe is supportive, grounded, and slightly witty—like a helpful teammate, not a rigid robot.
            
            GUIDELINES:
            - Use natural language and contractions (e.g., "I've" instead of "I have").
            - Be concise but warm. 
            - If you find something in the data, present it helpfully (e.g., "I took a look at your Slack and found...").
            - If you don't know something, be honest but encouraging.`
        });
        
        // 🌡️ ADDED CONFIG: Higher temperature (0.7-0.8) makes it more "human"
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.8,
                topP: 0.95,
                maxOutputTokens: 1024,
            }
        });

        const response = await result.response;
        return response.text();
    } catch (error: any) {
        console.error("🚨 Gemini API Error:", error.message || error);
        return "Hey, I'm hitting a tiny snag processing that. Mind trying again in a second?";
    }
}

// --- 6. Routes ---
app.get('/', (req: any, res: any): void => {
    res.send(`<div style="font-family:sans-serif;text-align:center;padding:50px;">
        <h1>🚀 Rukmer AI Backend is Live</h1>
    </div>`);
});

// Apply auth only to protected routes
// server.ts
app.post('/api/ai/chat', authenticateUser, async (req: any, res: any) => {
  try {
    const { userId, prompt, message } = req.body;
    const userMessage = prompt || message;  // Support both 'prompt' and 'message' fields

    if (!userMessage) {
      return res.status(400).json({ error: "No prompt or message provided" });
    }

    console.log("🤖 AI Chat Request from user:", userId);

    // 1. ORCHESTRATION: Fetch context from all connected apps
    // This is where you call the helper functions we built earlier
    let context = "";
    try {
      context = await getAppContent(userId);
      console.log("✅ App context fetched successfully", context);
    } catch (contextErr: any) {
      console.warn("⚠️  Could not fetch app context:", contextErr.message);
      context = "(No connected apps data available)";
    }

    // 2. PROMPT ENGINEERING
    const systemInstruction = `You are Rukmer AI. Use the provided context from Slack and Email to answer.`;
    const finalPrompt = `
  Context: You are talking to a user who has connected their workspace apps.
  Current Context from Apps: ${context}
  
  User's Question: ${userMessage}
  
  (Instruction: Respond like a helpful peer. If the context is empty, politely ask them to connect an app so you can be more useful!)
`;

    // 3. AI GENERATION
    console.log("🔄 Calling Gemini API...");
    const aiResponse = await callGemini(finalPrompt);
    console.log("✅ Gemini response received");

    // 4. PERSISTENCE: Save the interaction to your PostgreSQL 'chats' table
    try {
      const insertResult = await pool.query(
        "INSERT INTO chats (user_id, user_message, ai_reply) VALUES ($1, $2, $3) RETURNING id, created_at",
        [userId, userMessage, aiResponse]
      );
      console.log("✅ Chat saved to database");
      const chatId = insertResult.rows[0].id;
      const createdAt = insertResult.rows[0].created_at;
      res.json({ 
        reply: aiResponse,
        chatId: chatId,
        createdAt: createdAt
      });
    } catch (dbErr: any) {
      console.warn("⚠️  Could not save to database:", dbErr.message);
      // Still return the response even if database save fails
      res.json({ reply: aiResponse });
    }
  } catch (err: any) {
    console.error("❌ AI Chat Error:", err?.message || err);
    res.status(500).json({ error: "Chat failed: " + (err?.message || "Unknown error") });
  }
});

app.get('/api/history', authenticateUser, async (req: any, res: any): Promise<void> => {
  const { userId } = req.query;
  try {
    const result = await pool.query(
      `SELECT * FROM chats WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at DESC LIMIT 30`,
      [userId]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.post('/api/storage/resumable-url', authenticateUser, async (req: any, res: any): Promise<void> => {
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
    } catch (error: any) {
        res.status(500).json({ error: "Failed to generate upload URL: " + (error?.message || error) });
    }
});

app.get('/api/storage/files', authenticateUser, async (req: any, res: any): Promise<void> => {
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
    } catch (error: any) {
        res.status(500).json({ error: "Failed to fetch files: " + (error?.message || error) });
    }
});

app.put('/api/chat/hide', authenticateUser, async (req: any, res: any): Promise<void> => {
    const { userId }: any = req.body;
    if (!userId) return res.status(400).json({ error: "User ID is required" });
    try {
        await pool.query("UPDATE chats SET is_active = FALSE WHERE user_id = $1 AND is_active = TRUE", [userId]);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err?.message || 'Unknown error' });
    }
});

app.get('/api/chat/history/:userId', authenticateUser, async (req: any, res: any): Promise<void> => {
    const { userId }: any = req.params;
    try {
        const result = await pool.query("SELECT * FROM chats WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at ASC", [userId]);
        res.json({ success: true, hidden: result.rowCount });
    } catch (error: any) {
        res.status(500).json({ error: "Failed to fetch history: " + (error?.message || error) });
    }
});

app.get('/api/user-status/:userId', authenticateUser, async (req: any, res: any): Promise<void> => {
    try {
        const { userId }: any = req.params;
        const result = await pool.query('SELECT is_pro, plan_type FROM users WHERE id = $1', [userId]);
        if (result.rows.length > 0) {
            res.json({ isPro: result.rows[0].is_pro, planType: result.rows[0].plan_type });
        } else {
            res.json({ isPro: false, planType: 'free' });
        }
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch user status: ' + (error?.message || error) });
    }
});

// Example Node.js/Express Route
app.delete('/api/user/delete-complete', authenticateUser, async (req: any, res: any): Promise<void> => {
  try {
    const token = req.headers.authorization.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;

    // 1. Delete from PostgreSQL
    // await pool.query('DELETE FROM chats WHERE user_id = $1', [uid]);

    // 2. Delete from Google Cloud Storage
    // await storage.bucket('rukmer-assets').deleteFiles({ prefix: `uploads/${uid}/` });

    res.status(200).send({ message: 'Cleanup successful' });
  } catch (error: any) {
    console.error(error?.message || error);
    res.status(500).send('Cleanup failed: ' + (error?.message || error));
  }
});

app.post('/api/signup-success', authenticateUser, async (req: any, res: any): Promise<void> => {
  const { email, name } = req.body;
  
  // 1. Your logic to sync Firestore...
  
  // 2. Trigger the professional welcome
  await sendWelcomeEmail(email, name);
  
  res.status(200).send({ message: "Welcome email sent" });
});

app.get('/api/auth/slack', (req: any, res: any): void => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).send("User ID is required");

    // 1. Create the state
    const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
    
    // 2. Define your scopes (Bot scopes use 'scope', User scopes use 'user_scope')
    const scope = 'channels:read,channels:history,groups:read,groups:history,chat:write';
    
    // 3. Construct the URL using the variables
    const redirectUri = encodeURIComponent(`${CURRENT_BACKEND_URL}/api/auth/slack/callback`);
    
    const slackAuthUrl = `https://slack.com/oauth/v2/authorize?client_id=${SLACK_CLIENT_ID}&scope=${scope}&user_scope=identity.basic&redirect_uri=${redirectUri}&state=${state}`;
    
    console.log("🔗 Redirecting to Slack with Scopes:", scope);
    res.redirect(slackAuthUrl);
});

// 2. Handle the Callback from Slack
app.get('/api/auth/slack/callback', async (req: any, res: any): Promise<void> => {
    const { code, state, error } = req.query;

    if (error) return res.redirect(`${FRONTEND_URL}?error=slack_auth_failed`);

    try {
        // Decode the state to figure out which user this is
        const decodedState = JSON.parse(Buffer.from(state as string, 'base64').toString('ascii'));
        const userId = decodedState.userId;
        if (!userId) throw new Error("No userId found in state");

        const redirectUri = `${CURRENT_BACKEND_URL}/api/auth/slack/callback`;

        // Exchange the code for an Access Token
        const tokenResponse = await axios.post('https://slack.com/api/oauth.v2.access', null, {
            params: {
                client_id: SLACK_CLIENT_ID,
                client_secret: SLACK_CLIENT_SECRET,
                code: code as string,
                redirect_uri: redirectUri
            }
        });

        const data = tokenResponse.data;
        if (!data.ok) {
            console.error("Slack Token Exchange Failed:", data.error);
            throw new Error(data.error);
        }

// 🚨 THE FIX: Capture both Bot and User data
await admin.firestore().collection('userTokens').doc(userId).set({
    "slack": {
        // Use the bot token (xoxb-) as the primary access token
        accessToken: data.access_token, 
        botUserId: data.bot_user_id,
        teamId: data.team.id,
        teamName: data.team.name,
        // Optional: save user-specific info if you need to act as the user later
        authedUser: {
            id: data.authed_user.id,
            accessToken: data.authed_user.access_token // (xoxp-)
        },
        connectedAt: admin.firestore.FieldValue.serverTimestamp()
    }
}, { merge: true });

        // 🔥 UPDATE CONNECTION STATUS SO DASHBOARD LISTENS TO THIS
        await admin.firestore().collection('userConnections').doc(userId).set({
            slack: true
        }, { merge: true });

        console.log(`✅ Green light turned on for user: ${userId}`);


        // Send the user back to the dashboard
        res.redirect(`${FRONTEND_URL}?connection=success`);

    } catch (err: any) {
        console.error("Slack Auth Error:", err?.message || err);
        res.redirect(`${FRONTEND_URL}?error=slack_failed`);
    }
});

app.get('/api/slack/history', authenticateUser, async (req: any, res: any) => {
    const { channelId } = req.query; // The ID of the Slack channel (e.g., C12345)
    const userId = req.user.uid;     // From your authenticateUser middleware

    try {
        // 1. Get the specific user's token from your 'userTokens' collection
        const userTokenDoc = await admin.firestore().collection('userTokens').doc(userId).get();

if (!userTokenDoc.exists) {
    return res.status(404).json({ error: "Slack not connected for this user" });
}

// 🔥 FIX: Cast the data so TypeScript knows 'slack' exists
const userData = userTokenDoc.data() as { slack: { accessToken: string } };
const slackToken = userData.slack.accessToken;

        // 2. Call Slack's API to get conversations
        const response = await axios.get('https://slack.com/api/conversations.history', {
            params: { channel: channelId, limit: 20 },
            headers: { 'Authorization': `Bearer ${slackToken}` }
        });

        if (!response.data.ok) {
            throw new Error(response.data.error);
        }

        // 3. Return the messages to the frontend or LLM
        res.json({ messages: response.data.messages });

    } catch (error: any) {
        console.error("Fetch Slack Error:", error?.message || error);
        res.status(500).json({ error: "Failed to fetch Slack history" });
    }
});

app.get('/api/slack/channels', authenticateUser, async (req: any, res: any) => {
    try {
        const userId = req.user.uid;
        const userTokenDoc = await admin.firestore().collection('userTokens').doc(userId).get();
        const userData = userTokenDoc.data() as { slack: { accessToken: string } };
        
        const response = await axios.get('https://slack.com/api/conversations.list', {
            headers: { 'Authorization': `Bearer ${userData.slack.accessToken}` },
            params: { types: 'public_channel,private_channel' }
        });

        // 🔥 THE FIX: Check if Slack returned an error instead of channels
        if (!response.data.ok) {
            console.error("Slack API Error:", response.data.error);
            return res.status(400).json({ 
                error: `Slack Error: ${response.data.error}`,
                hint: "Check your scopes (channels:read) and reinstall the app." 
            });
        }

        // Now it's safe to map!
        const channels = response.data.channels.map((c: any) => ({ 
            name: c.name, 
            id: c.id 
        }));

        res.json(channels);
    } catch (err: any) {
        console.error("Internal Server Error:", err.message);
        res.status(500).json({ error: "Internal server error fetching channels" });
    }
});

// 1. Start the Auth Flow for Google (Gmail & Google Drive)
app.get('/api/auth/google', async (req: any, res: any) => {
  const { userId, type } = req.query; // type will be 'gmail' or 'gdrive'
  if (!userId) return res.status(400).send("User ID required");

  // 1. Define scopes based on what the user clicked
  let scopes: string[] = [];
  if (type === 'gmail') {
    scopes = ['https://www.googleapis.com/auth/gmail.readonly'];
  } else if (type === 'gdrive') {
    scopes = ['https://www.googleapis.com/auth/devstorage.read_only'];
  }

  // 2. Encode both userId and the type into the state 
  // so the callback knows which "light" to turn green
  const state = Buffer.from(JSON.stringify({ userId, type })).toString('base64');

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    state: state
  });

  res.redirect(url);
});

// Aliases for gmail and gdrive - both redirect to /api/auth/google
app.get('/api/auth/gmail', async (req: any, res: any) => {
  const userId = req.query.userId;
  res.redirect(`/api/auth/google?userId=${userId}&type=gmail`);
});

app.get('/api/auth/gdrive', async (req: any, res: any) => {
  const userId = req.query.userId;
  res.redirect(`/api/auth/google?userId=${userId}&type=gdrive`);
});


// 2. The Callback
app.get('/api/auth/google/callback', async (req: any, res: any) => {
  const { code, state } = req.query;
  const { userId, type } = JSON.parse(Buffer.from(state as string, 'base64').toString('ascii'));

  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    
    // Save tokens for future AI use
    await admin.firestore().collection('userTokens').doc(userId).set({
      google: tokens 
    }, { merge: true });

    // Turn on the Green Lights for both
    await admin.firestore().collection('userConnections').doc(userId).set({
      [type]: true, // Assuming GDrive/GCS are grouped for your UI
    }, { merge: true });

    res.redirect(`${FRONTEND_URL}?connection=success`);
  } catch (error) {
    res.redirect(`${FRONTEND_URL}?error=google_failed`);
  }
});

// 1. Start Microsoft Auth Flow
app.get('/api/auth/microsoft', (req: any, res: any) => {
  const { userId, type } = req.query; // type: 'outlook', 'onedrive', or 'teams'
  if (!userId) return res.status(400).send("User ID required");

  // Check for required env vars
  if (!process.env.MS_CLIENT_ID || !process.env.MS_CLIENT_SECRET) {
    console.error("❌ Missing MS_CLIENT_ID or MS_CLIENT_SECRET in env");
    return res.status(500).send("Microsoft OAuth not configured");
  }

  const state = Buffer.from(JSON.stringify({ userId, type })).toString('base64');
  
  // Define scopes - MUST include 'openid' according to Azure AD v2.0 requirements
  let scope = 'openid profile email offline_access Team.ReadBasic.All Channel.ReadBasic.All Group.Read.All'; 
  if (type === 'outlook') scope += ' Mail.Read';
  if (type === 'onedrive') scope += ' Files.Read.All';
  if (type === 'teams') scope += ' Team.ReadBasic.All Channel.ReadBasic.All Group.Read.All';

  const root = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
  const redirectUri = `${CURRENT_BACKEND_URL}/api/auth/microsoft/callback`;
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: scope,
    state: state
  });

  console.log("🔐 Starting Microsoft OAuth for:", type, "User:", userId);
  res.redirect(`${root}?${params.toString()}`);
});

// 2. Microsoft Callback
app.get('/api/auth/microsoft/callback', async (req: any, res: any) => {
  const { code, state, error, error_description } = req.query;
  
  if (error) {
    console.error("Microsoft declined auth:", error, error_description);
    return res.redirect(`${FRONTEND_URL}?error=${error}`);
  }

  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL}?error=missing_code_or_state`);
  }
  
  try {
    const { userId, type } = JSON.parse(Buffer.from(state as string, 'base64').toString('ascii'));

    // Exchange code for tokens - using proper form encoding
    const tokenData: Record<string, string> = {
      client_id: process.env.MS_CLIENT_ID || '',
      client_secret: process.env.MS_CLIENT_SECRET || '',
      code: code as string,
      grant_type: 'authorization_code',
      redirect_uri: `${CURRENT_BACKEND_URL}/api/auth/microsoft/callback`
    };

    console.log("🔄 Exchanging auth code for tokens...", {
      client_id: process.env.MS_CLIENT_ID?.substring(0, 5) + "...",
      has_secret: !!process.env.MS_CLIENT_SECRET,
      has_code: !!code
    });

    const response = await axios.post(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      new URLSearchParams(tokenData),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    console.log("✅ Token exchange successful!");
    const tokens = response.data;

    // Save to Firestore
    await admin.firestore().collection('userTokens').doc(userId).set({
      microsoft: tokens 
    }, { merge: true });

    // Turn on the specific green light
    await admin.firestore().collection('userConnections').doc(userId).set({
      [type]: true 
    }, { merge: true });

    res.redirect(`${FRONTEND_URL}?connection=success`);
  } catch (error: any) {
    console.error("Microsoft Auth Error:", error.response?.data || error.message);
    res.redirect(`${FRONTEND_URL}?error=microsoft_token_failed`);
  }
});

app.get('/api/teams/channels', authenticateUser, async (req: any, res: any) => {
    try {
        const userId = req.user.uid;
        const userTokenDoc = await admin.firestore().collection('userTokens').doc(userId).get();
        const userData = userTokenDoc.data() as { microsoft: { access_token: string } };

        if (!userData?.microsoft?.access_token) {
            return res.status(404).json({ error: "Microsoft account not connected" });
        }

        // Fetch teams first
        const teamsResponse = await axios.get('https://graph.microsoft.com/v1.0/me/joinedTeams', {
            headers: { 'Authorization': `Bearer ${userData.microsoft.access_token}` }
        });

        res.json(teamsResponse.data.value);
    } catch (err: any) {
        console.error("Teams API Error:", err.response?.data || err.message);
        res.status(500).json({ error: "Failed to fetch Teams" });
    }
});

// Aliases for Outlook & OneDrive - route to Microsoft auth
app.get('/api/auth/outlook', (req: any, res: any) => {
  const { userId } = req.query;
  res.redirect(`/api/auth/microsoft?userId=${userId}&type=outlook`);
});

app.get('/api/auth/onedrive', (req: any, res: any) => {
  const { userId } = req.query;
  res.redirect(`/api/auth/microsoft?userId=${userId}&type=onedrive`);
});

app.get('/api/auth/teams', (req: any, res: any) => {
  const { userId } = req.query;
  res.redirect(`/api/auth/microsoft?userId=${userId}&type=teams`);
});

app.get('/{*any}', (req: any, res: any): void => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found' });
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// --- 7. Start Server ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Rukmer Backend on port ${PORT}`);
    pool.query("SELECT 1")
        .then(() => console.log("✅ PostgreSQL Connected"))
        .catch((err: any) => console.error("❌ DB Error:", err?.message || err));
});