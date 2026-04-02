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
import { google } from 'googleapis';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import { oauth2Client, GOOGLE_SCOPES } from './backend/config/googleConfig.js';

const pool = poolImport as any; 
import { Storage } from '@google-cloud/storage';
import { sendWelcomeEmail } from './src/utils/mailer.js';
import fs from 'fs';
import admin from 'firebase-admin'; // 🚨 The Security Bouncer
import { learnWorkspaceData, queryWorkspaceData, clearNamespace, fetchTeamsMessages } from './ingestionService.js';
import { Pinecone } from '@pinecone-database/pinecone';
import { ConfidentialClientApplication, InteractionRequiredAuthError, LogLevel } from '@azure/msal-node';
import { WebClient } from '@slack/web-api';

import { 
  CloudAdapter, 
  ConfigurationServiceClientCredentialFactory, 
  createBotFrameworkAuthenticationFromConfiguration, 
  ActivityHandler, 
  MessageFactory 
} from 'botbuilder';

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);

//import { stripeWebhookHandler } from './backend/config/stripeController.js';


const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;
const BACKEND_HOST = process.env.BACKEND_HOST || 'http://localhost:5001';
const BACKEND_PORT = process.env.PORT || 8080;

const IS_PROD = process.env.NODE_ENV === 'production';
const CURRENT_BACKEND_URL = IS_PROD ? 'https://app.rukmer.com' : 'http://localhost:5001';
const FRONTEND_URL = process.env.FRONTEND_URL || (IS_PROD ? 'https://app.rukmer.com/dashboard' : 'http://localhost:5173/dashboard');

const app: any = express();
const PORT = (process.env.PORT || 8080) as number | string;

// --- MSAL helpers for Microsoft token management ---
const msalAppConfig = {
  auth: {
    clientId: process.env.MS_CLIENT_ID!,
    authority: 'https://login.microsoftonline.com/common',
    clientSecret: process.env.MS_CLIENT_SECRET!,
  },
  system: {
    loggerOptions: {
      loggerCallback: (_level: number, message: string) => { if (_level === LogLevel.Error) console.error('[MSAL]', message); },
      logLevel: LogLevel.Error,
    }
  }
};

// Build a per-user MSAL app with Firestore-backed token cache
async function createMsalClient(userId: string): Promise<ConfidentialClientApplication> {
  const pca = new ConfidentialClientApplication(msalAppConfig);
  const doc = await admin.firestore().collection('userTokens').doc(userId).get();
  const cached = doc.data()?.msal_cache;
  if (cached) pca.getTokenCache().deserialize(cached);
  return pca;
}

// Persist the updated MSAL token cache (contains the refresh token) back to Firestore
async function saveMsalCache(userId: string, pca: ConfidentialClientApplication): Promise<void> {
  await admin.firestore().collection('userTokens').doc(userId).set(
    { msal_cache: pca.getTokenCache().serialize() },
    { merge: true }
  );
}

// Returns a valid access token, silently refreshing via MSAL if needed.
// Throws Error('RE_AUTH_REQUIRED') when the refresh token itself has expired.
async function getMicrosoftAccessToken(userId: string): Promise<string> {
  const pca = await createMsalClient(userId);
  const accounts = await pca.getTokenCache().getAllAccounts();

  if (accounts.length === 0) {
    // Legacy user whose tokens were stored before MSAL was introduced.
    // Return the raw token if it is still fresh; otherwise force re-auth.
    const doc = await admin.firestore().collection('userTokens').doc(userId).get();
    const t = doc.data()?.microsoft;
    if (t?.access_token && t.expires_at && Date.now() < t.expires_at - 300_000) {
      return t.access_token;
    }
    throw new Error('RE_AUTH_REQUIRED');
  }

  try {
    const result = await pca.acquireTokenSilent({
      account: accounts[0],
      scopes: ['https://graph.microsoft.com/.default'],
    });
    await saveMsalCache(userId, pca);
    return result!.accessToken;
  } catch (err: any) {
    if (err instanceof InteractionRequiredAuthError) {
      // Refresh token expired (~90 days inactive) — user must log in again
      await admin.firestore().collection('userConnections').doc(userId).set(
        { microsoft_reauth_required: true }, { merge: true }
      );
      throw new Error('RE_AUTH_REQUIRED');
    }
    throw err;
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

// --- Last-sync helpers (stored in Firestore so they survive server restarts) ---
async function getLastSyncAt(userId: string): Promise<Date | null> {
  try {
    const doc = await admin.firestore().collection('syncMeta').doc(userId).get();
    const ts = doc.data()?.lastSyncAt;
    return ts ? new Date(ts) : null;
  } catch { return null; }
}
async function setLastSyncAt(userId: string): Promise<void> {
  try {
    await admin.firestore().collection('syncMeta').doc(userId).set(
      { lastSyncAt: new Date().toISOString() }, { merge: true }
    );
  } catch (e: any) { console.warn('⚠️ Could not update lastSyncAt:', e.message); }
}

// Tracks which users have an in-progress background sync to avoid duplicates
const syncInProgress = new Set<string>();

const getAppContent = async (userId: string, sinceDate?: Date) => {
  const isIncremental = !!sinceDate;
  console.log(`🔄 getAppContent for ${userId} | mode: ${isIncremental ? `incremental since ${sinceDate!.toISOString()}` : 'full sync'}`);

  const tokenDoc = await admin.firestore().collection('userTokens').doc(userId).get();
  const tokens = tokenDoc.data() as { google?: any; slack?: any; microsoft?: any } | undefined;
  let context = "";

  // On a full sync, wipe old vectors first. On incremental, upsert only adds new ones.
  if (!isIncremental) {
    await clearNamespace(userId);
  }

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
      // For incremental syncs, only fetch messages newer than the last sync
      const gmailParams: any = { userId: 'me', maxResults: isIncremental ? 50 : 25 };
      if (sinceDate) gmailParams.q = `after:${Math.floor(sinceDate.getTime() / 1000)}`;
      const msgs = await gmail.users.messages.list(gmailParams);
      if (msgs.data.messages && msgs.data.messages.length > 0) {
        context += `\n📧 Gmail Emails:\n`;

        // Helper to decode base64url encoded Gmail body parts
        const decodeBody = (data: string) =>
          Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');

        // Recursively extract plain text from MIME parts
        const extractBodyText = (payload: any): string => {
          if (!payload) return '';
          if (payload.mimeType === 'text/plain' && payload.body?.data) {
            return decodeBody(payload.body.data);
          }
          if (payload.parts) {
            for (const part of payload.parts) {
              const result = extractBodyText(part);
              if (result) return result;
            }
          }
          return '';
        };

        for (const m of msgs.data.messages) {
          const detail = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'full' });
          const headers = detail.data.payload?.headers || [];
          const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(No subject)';
          const from = headers.find((h: any) => h.name === 'From')?.value || '(Unknown sender)';
          const date = headers.find((h: any) => h.name === 'Date')?.value || '';
          const snippet = detail.data.snippet || '';
          const bodyText = extractBodyText(detail.data.payload) || snippet;
          // Skip notification-style emails that pollute the knowledge base
          if (subject === 'Suren sent a message') continue;
          // Truncate to avoid embedding too-large documents
          const fullText = `Subject: ${subject}\nFrom: ${from}\nDate: ${date}\n\n${bodyText.substring(0, 2000)}`;
          context += `  - From: ${from} | Subject: ${subject} | Date: ${date}\n    Preview: ${snippet}\n`;

          // RAG ingestion
          try {
            await learnWorkspaceData(fullText, userId, {
              source: "gmail",
              message_id: m.id,
              from,
              subject,
              date
            });
          } catch (ragErr: any) {
            console.warn("⚠️  Gmail RAG ingestion failed:", ragErr.message);
          }
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
      const channelsRes = await axios.get<any>('https://slack.com/api/conversations.list', {
        headers: { Authorization: `Bearer ${tokens.slack.accessToken}` },
        params: { limit: 5, types: 'public_channel' }
      });
      
      if (channelsRes.data.ok && channelsRes.data.channels.length > 0) {
        for (const channel of channelsRes.data.channels) {
          const channelId = channel.id;
          const channelName = channel.name;
        
          // Fetch history from each channel (incremental: only messages after last sync)
          const slackHistParams: any = { channel: channelId, limit: isIncremental ? 200 : 25 };
          if (sinceDate) slackHistParams.oldest = String(sinceDate.getTime() / 1000);
          const slackRes = await axios.get<any>('https://slack.com/api/conversations.history', {
            params: slackHistParams,
            headers: { Authorization: `Bearer ${tokens.slack.accessToken}` }
          });
        
          if (slackRes.data.ok && slackRes.data.messages) {
            context += `\n💬 Slack (#${channelName}):\n`;
            for (const msg of slackRes.data.messages) {
              if (msg.text) {
                context += `  - ${msg.text.substring(0, 200)}\n`;

                // RAG ingestion
                try {
                  await learnWorkspaceData(msg.text, userId, {
                    source: "slack",
                    channel_id: channelId,
                    sender_id: msg.user,
                    message_id: msg.ts,
                    timestamp: new Date(parseFloat(msg.ts) * 1000).toISOString(),
                    link: `https://slack.com/archives/${channelId}/p${msg.ts.replace('.', '')}`
                  });
                } catch (ragErr: any) {
                  console.warn("⚠️  Slack RAG ingestion failed:", ragErr.message);
                }
              }
            }
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
      const accessToken = await getMicrosoftAccessToken(userId);
      
      // For incremental syncs, filter to only messages received after the last sync date
      const outlookTop = isIncremental ? 50 : 25;
      const outlookDateFilter = sinceDate
        ? `&$filter=receivedDateTime ge ${sinceDate.toISOString()}`
        : '';
      const outlookRes = await axios.get<any>(
        `https://graph.microsoft.com/v1.0/me/messages?$top=${outlookTop}&$select=subject,from,receivedDateTime,bodyPreview${outlookDateFilter}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      if (outlookRes.data.value && outlookRes.data.value.length > 0) {
        context += `\n📬 Outlook Emails:\n`;
        for (const msg of outlookRes.data.value) {
          const from = msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || '(Unknown sender)';
          const subject = msg.subject || '(No subject)';
          const date = msg.receivedDateTime || '(Unknown date)';
          const preview = msg.bodyPreview || '(No preview)';
          context += `  - From: ${from} | Subject: ${subject} | Date: ${date}\n    Preview: ${preview}\n`;

          // RAG ingestion
          try {
            const fullText = `Subject: ${subject}\nFrom: ${from}\nDate: ${date}\n\nContent: ${preview}`;
            await learnWorkspaceData(fullText, userId, {
              source: "outlook",
              message_id: msg.id,
              from,
              subject,
              date
            });
          } catch (ragErr: any) {
            console.warn("⚠️  Outlook RAG ingestion failed:", ragErr.message);
          }
        }
      }
    } catch (err: any) {
      if (err.message === 'RE_AUTH_REQUIRED') {
        console.warn("⚠️  Outlook: Microsoft re-authentication required for user:", userId);
      } else {
        console.warn("⚠️  Outlook fetch failed:", err.message);
        if (err.response?.data?.error) console.warn("   Error details:", err.response.data.error);
      }
    }
  }

  if (tokens?.microsoft) { // Fetch teams if Microsoft token exists
    try {
      const accessToken = await getMicrosoftAccessToken(userId);

      // Check if teams channels are explicitly enabled in userConnections
      const connectionsDoc = await admin.firestore().collection('userConnections').doc(userId).get();
      const connections = connectionsDoc.data() || {} as any;

      if (connections.teams) {
        // 1. Get the list of Teams the user is in
        const teamsRes = await axios.get<any>('https://graph.microsoft.com/v1.0/me/joinedTeams', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (teamsRes.data.value && teamsRes.data.value.length > 0) {
          context += `\n👥 Microsoft Teams:\n`;
          for (const team of teamsRes.data.value.slice(0, 2)) {
            context += `  - Team: ${team.displayName}\n`;
            const channelsRes = await axios.get<any>(`https://graph.microsoft.com/v1.0/teams/${team.id}/channels`, {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            const channelNames = channelsRes.data.value.map((c: any) => c.displayName).join(', ');
            context += `    Channels: ${channelNames}\n`;
          }
        }
      }

      // 2. Always fetch personal/group chat messages for ANY Microsoft user (requires Chat.Read scope)
      try {
        const teamsChats = await fetchTeamsMessages(accessToken, sinceDate);
        for (const item of teamsChats) {
          try {
            await learnWorkspaceData(item.text, userId, {
              source: item.metadata.source,
              message_id: item.id,
              chat_id: item.metadata.chatId,
              sender_id: item.metadata.sender ?? 'unknown',
              timestamp: item.metadata.date,
            });
          } catch (ragErr: any) {
            console.warn('⚠️  Teams chat RAG ingestion failed:', ragErr.message);
          }
        }
        console.log(`✅ Teams: ingested ${teamsChats.length} chat messages`);
      } catch (chatErr: any) {
        console.warn('⚠️  Teams chat fetch failed:', chatErr.response?.data?.error?.message ?? chatErr.message);
      }
    } catch (err: any) {
      if (err.message === 'RE_AUTH_REQUIRED') {
        console.warn("⚠️  Teams: Microsoft re-authentication required for user:", userId);
      } else {
        console.warn("⚠️  Teams fetch failed:", err.message);
      }
    }
  }

  // Persist the sync timestamp so incremental syncs know where to resume from
  await setLastSyncAt(userId);
  console.log(`✅ Sync complete for ${userId} (${isIncremental ? 'incremental' : 'full'})`);
  return context || "(No connected apps or no data available)";
};

// --- 3. Static Files & CORS ---
// Hashed assets (JS/CSS) — cache aggressively since filenames change on each build
app.use('/assets', express.static(path.join(process.cwd(), 'dist', 'assets'), {
    maxAge: '1y',
    immutable: true,
}));
// Everything else (index.html etc.) — never cache so browsers always get the latest build
app.use(express.static(path.join(process.cwd(), 'dist'), {
    etag: true,
    lastModified: true,
    setHeaders: (res: any, filePath: string) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    },
}));

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

// --- SERVER-SIDE VERTEX AI HELPER ---
const vertexAI = new VertexAI({
    project: process.env.GOOGLE_CLOUD_PROJECT || 'rukmer-saas',
    location: 'us-central1',
    googleAuthOptions: process.env.NODE_ENV !== 'production'
        ? { keyFilename: path.join(process.cwd(), 'service-account.json') }
        : undefined
});

async function callGemini(prompt: string): Promise<string> {
    try {
        const model = vertexAI.getGenerativeModel({
            model: 'gemini-2.5-pro',
            safetySettings: [
              {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
            ],
            systemInstruction: {
                role: 'system',
                parts: [{ text: `You are Rukmer AI, the intelligent infrastructure and knowledge engine for this enterprise.
  Your purpose is to synthesize fragmented workspace data into a single, verifiable source of truth.
  
  CRITICAL ENTERPRISE GUIDELINES:
  1. ZERO KNOWLEDGE DRIFT: Base your answers STRICTLY on the provided Workspace Context. If the answer is not in the context, explicitly state: "I cannot verify this based on the current workspace data." Do not guess.
  2. MANDATORY CITATIONS: You MUST cite your sources for every factual claim. Use brackets to cite the source and date. 
     Example: "The Q3 budget is $50k [Source: Slack #general - Oct 12] and was approved by Sarah [Source: Gmail - Oct 14]."
  3. MULTI-MODAL AWARENESS: If the user uploads an image or video, analyze it deeply and cross-reference it with the text context provided.
  4. FORMATTING: Use professional Markdown (tables, bold text, bullet points) to make complex data instantly readable.` }]
            },
        });

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.8,
                topP: 0.95,
                maxOutputTokens: 2048,
            }
        });

        const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text;
        return text || "I'm having trouble thinking of a response right now.";
    } catch (error: any) {
        console.error("🚨 Vertex AI Error:", error.message || error);
        return "Hey, I'm hitting a tiny snag processing that. Mind trying again in a second?";
    }
}

// --- 6. Routes ---

// ─── Microsoft Teams Bot Setup ─────────────────────────────────────────────
// Azure Portal App Registration is "Any Entra ID tenant" → MultiTenant.
const botConfig: Record<string, string> = {
  MicrosoftAppId: process.env.MS_BOT_ID || '',
  MicrosoftAppPassword: process.env.MS_BOT_PASSWORD || '',
  MicrosoftAppType: 'MultiTenant',
  MicrosoftAppTenantId: 'common', // Use 'common' for multi-tenant bots
};

const credentialsFactory = new ConfigurationServiceClientCredentialFactory(botConfig);
const botAuthentication = createBotFrameworkAuthenticationFromConfiguration(null, credentialsFactory);
const adapter = new CloudAdapter(botAuthentication);

// Don't try sendActivity in onTurnError — if outbound auth is broken that also 401s and cascades
adapter.onTurnError = async (_context, error) => {
  console.error('[Teams Bot Adapter Error]:', JSON.stringify({
    name: (error as any)?.name,
    message: error?.message,
    statusCode: (error as any)?.statusCode,
  }));
};
// The main bot logic lives here. It fires every time someone types @Rukmer in Teams.

// Helper: send a reply to Teams, trying SDK first then manual REST API fallback
async function sendTeamsReply(context: any, text: string): Promise<void> {
  try {
    await context.sendActivity(MessageFactory.text(text));
    console.log('[Teams Bot] ✅ Reply sent via SDK');
    return;
  } catch (sdkErr: any) {
    console.warn('[Teams Bot] SDK sendActivity failed:', sdkErr?.statusCode, sdkErr?.message);
  }

  // FALLBACK: try TWO different token authorities to find which one the Bot Connector accepts.
  // Authority 1: botframework.com — correct for MultiTenant Azure Bot
  // Authority 2: home tenant — correct for SingleTenant Azure Bot
  const HOME_TENANT = 'd6d49420-f39b-4df7-a1dc-d59a935871db';
  const authorities = [
    { name: 'botframework.com', url: 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token' },
    { name: 'home-tenant',      url: `https://login.microsoftonline.com/${HOME_TENANT}/oauth2/v2.0/token` },
  ];

  const serviceUrl = context.activity.serviceUrl.replace(/\/?$/, '/');
  const conversationId = context.activity.conversation.id;
  const replyToId = context.activity.id || '';
  const replyUrl = `${serviceUrl}v3/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(replyToId)}`;
  const replyBody = JSON.stringify({
    type: 'message',
    from: { id: process.env.MS_BOT_ID },
    text: text,
    replyToId: replyToId,
  });

  for (const auth of authorities) {
    try {
      const tokenRes = await fetch(auth.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: process.env.MS_BOT_ID!,
          client_secret: process.env.MS_BOT_PASSWORD!,
          scope: 'https://api.botframework.com/.default',
        }),
      });
      const tokenData: any = await tokenRes.json();

      if (!tokenData.access_token) {
        console.error(`[Teams Bot] ❌ Token fetch failed (${auth.name}):`, tokenData.error, tokenData.error_description);
        continue;
      }

      // Decode token for diagnostics
      try {
        const payload = JSON.parse(Buffer.from(tokenData.access_token.split('.')[1], 'base64url').toString());
        console.log(`[Teams Bot] Token (${auth.name}) tid:`, payload.tid, '| iss:', payload.iss);
      } catch { /* ignore */ }

      const res = await fetch(replyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenData.access_token}`,
        },
        body: replyBody,
      });

      const resText = await res.text();
      if (res.ok) {
        console.log(`[Teams Bot] ✅ Reply sent via ${auth.name} authority:`, res.status);
        return; // success — stop trying
      } else {
        console.error(`[Teams Bot] ❌ Rejected by Bot Connector (${auth.name}):`, res.status, resText);
      }
    } catch (err: any) {
      console.error(`[Teams Bot] ❌ Exception (${auth.name}):`, err?.message);
    }
  }

  console.error('[Teams Bot] ❌ ALL reply methods failed. Check Azure Bot resource type vs App Registration type.');
}

class RukmerTeamsBot extends ActivityHandler {
  constructor() {
    super();

    // Fires every time someone types @Rukmer in Teams
    this.onMessage(async (context, next) => {
      try {
        // Teams wraps mentions in HTML — strip the <at>Rukmer</at> tag
        const cleanPrompt = context.activity.text.replace(/<at>.*?<\/at>/g, '').trim();

        // Show a typing indicator (silently skip if 401)
        try {
          await context.sendActivities([{ type: 'typing' }]);
        } catch (typingErr: any) {
          console.warn('[Teams Bot] Typing indicator skipped:', typingErr?.message);
        }

        // Identify the user via their Entra ID (Azure AD Object ID)
        const userAadObjectId = context.activity.from.aadObjectId;
        console.log('[Teams Bot] aadObjectId:', userAadObjectId ?? '(null)');

        // Look up the user in Firestore by their Entra OID
        let orgId: string | null = null;
        if (userAadObjectId) {
          const usersRef = admin.firestore().collection('userTokens');
          const snapshot = await usersRef.where('microsoft.oid', '==', userAadObjectId).limit(1).get();
          if (!snapshot.empty) {
            orgId = snapshot.docs[0].id;
          }
        }
        console.log('[Teams Bot] Firestore orgId:', orgId ?? '(not linked)');

        // Run the RAG pipeline only if the user has a linked Rukmer account
        let workspaceContext = '';
        if (orgId) {
          try {
            workspaceContext = await queryWorkspaceData(cleanPrompt, orgId);
          } catch (e) {
            console.warn('[Teams Bot] Vector search failed');
          }
        }

        const systemInstruction = orgId
          ? `You are Rukmer AI. Answer the user's question using the following workspace context.
Format your answer for Microsoft Teams (use markdown, bolding, and bullet points).
CONTEXT: ${workspaceContext || 'No relevant data found.'}`
          : `You are Rukmer AI, a helpful assistant. The user hasn't linked their Microsoft account to Rukmer yet, so you don't have workspace context. Answer from your general knowledge. Mention they can link their account at app.rukmer.com for workspace-aware answers.
Format your answer for Microsoft Teams (use markdown, bolding, and bullet points).`;

        const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
        const aiResponse = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: `SYSTEM: ${systemInstruction}\n\nUSER: ${cleanPrompt}` }] }]
        });

        const finalReply =
          aiResponse.response.candidates?.[0]?.content?.parts?.[0]?.text ||
          "I couldn't process that.";

        console.log('[Teams Bot] Sending reply, length:', finalReply.length, '| serviceUrl:', context.activity.serviceUrl);
        await sendTeamsReply(context, finalReply);
      } catch (err) {
        console.error('[Teams Bot Logic Error]:', err);
      }

      await next();
    });
  }
}

const teamsBot = new RukmerTeamsBot();
// ────────────────────────────────────────────────────────────────────────────

app.get('/', (req: any, res: any): void => {
    res.send(`<div style="font-family:sans-serif;text-align:center;padding:50px;">
        <h1>🚀 Rukmer AI Backend is Live</h1>
    </div>`);
});

// Apply auth only to protected routes
// server.ts
// ─── Rukmer System Instruction ─────────────────────────────────────────────
const RUKMER_SYSTEM_INSTRUCTION = `You are Rukmer, an expert AI assistant with comprehensive knowledge across all domains: science, technology, software engineering, mathematics, medicine, law, finance, history, language, creative writing, and more.

## Core Behaviour
- Think before you answer. For complex questions, reason through the problem step-by-step before giving your final answer.
- Be accurate above all else. Never fabricate facts, statistics, names, URLs, papers, or citations. If you are uncertain, say so explicitly and offer to help find the answer.
- Give complete, thorough answers that fully address the question — do not truncate or say "I'll stop here for brevity."
- Build on the conversation. The full conversation history is available to you. Reference and continue prior threads naturally ("As we discussed...", "Building on your earlier point..."). Never repeat what you already said unless the user asks.
- Anticipate follow-ups. When useful, proactively offer next steps, related information, or clarifying questions.

## Capabilities
You are fully capable of:
- Answering any factual or knowledge-based question from your training
- Writing, reviewing, and debugging code in any programming language — always use fenced code blocks with the language identifier
- Solving mathematical problems step-by-step — show all working
- Analysing documents, images, PDFs, spreadsheets, and data files the user attaches
- Writing professional emails, reports, essays, summaries, and creative content
- Explaining any concept at any level of depth, from beginner to expert
- Strategic planning, decision analysis, brainstorming, and problem-solving
- Translating text between languages with high accuracy

## Using Workspace Context (RAG)
When verified data retrieved from the user's connected workspace apps (Gmail, Slack, Teams, Outlook, Drive, etc.) is provided below, follow these rules:
- Treat retrieved data as ground truth for questions about the user's own data.
- Quote or reference specific detail from it (names, dates, subjects, message content).
- If the retrieved data directly answers the question, lead with that answer and cite the source.
- If the retrieved data is only partially relevant, use it to supplement your answer.
- If NO workspace context is provided, answer entirely from your own broad knowledge — do not mention the absence of workspace data.

## Response Format
- Use Markdown formatting: headers (##, ###), bullet points, numbered lists, bold/italic, tables, and code blocks as appropriate.
- Match response length to the depth the question requires — brief for simple questions, detailed for complex ones.
- For code: always use fenced code blocks (\`\`\`language ... \`\`\`).
- For maths: show equations clearly, step by step.
- For multi-step reasoning: use numbered steps.

## Honesty and Limitations
- If a question is outside your knowledge cut-off, say so and provide useful context about where to look.
- Never roleplay as a different AI model (e.g. GPT, Claude). You are Rukmer.
- If a request is harmful or unethical, politely decline.`;
// ────────────────────────────────────────────────────────────────────────────

app.post('/api/ai/chat', authenticateUser, async (req: any, res: any) => {
  const { userId, prompt, message, sessionId, files } = req.body;
  const userMessage = prompt || message;
  const orgId = userId || req.user.uid;
  const currentSessionId = sessionId || Math.random().toString(36).substring(2, 11);
  const attachedFiles: Array<{ name: string; mimeType: string; type: string; data: string }> = Array.isArray(files) ? files : [];

  if (!userMessage) return res.status(400).json({ error: "Empty message" });

  console.log("🤖 Chat Request from:", orgId, "Session:", currentSessionId, "Files:", attachedFiles.length);

  // 1. SET UP STREAMING HEADERS
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Gemini-supported MIME types for inline multimodal data
  const INLINE_MIME_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/mpeg', 'video/quicktime', 'video/avi', 'video/webm', 'video/3gpp',
    'audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/flac', 'audio/aac', 'audio/ogg',
    'application/pdf',
    'text/plain', 'text/csv', 'text/markdown', 'text/html', 'application/json',
  ]);

  try {
    // 2. RAG RETRIEVAL (Pinecone) — run in parallel with session history fetch
    let workspaceContext = "";
    let sessionHistory: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    const [ragResult, histResult] = await Promise.allSettled([
      // RAG with 6-second timeout
      Promise.race([
        queryWorkspaceData(userMessage, orgId),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('RAG timeout')), 6000))
      ]),
      // Full session history — last 50 exchanges (100 rows), no arbitrary cap
      pool.query(
        `SELECT user_message, ai_reply FROM chats
         WHERE user_id = $1 AND session_id = $2
         ORDER BY created_at ASC LIMIT 50`,
        [req.user.uid, currentSessionId]
      )
    ]);

    // Process RAG result — only use context when it contains real retrieved data
    if (ragResult.status === 'fulfilled') {
      const raw = ragResult.value as string;
      // Discard the "nothing found" placeholder string returned by queryWorkspaceData
      if (raw && !raw.startsWith("I couldn't find anything specific enough")) {
        workspaceContext = raw;
      }
    } else {
      console.warn("⚠️ RAG retrieval failed:", (ragResult as PromiseRejectedResult).reason?.message);
    }

    // Process session history
    if (histResult.status === 'fulfilled') {
      for (const row of (histResult.value as any).rows) {
        sessionHistory.push({ role: 'user',  parts: [{ text: row.user_message }] });
        sessionHistory.push({ role: 'model', parts: [{ text: row.ai_reply }] });
      }
      console.log(`📚 Loaded ${sessionHistory.length / 2} prior turns for session ${currentSessionId}`);
    } else {
      console.warn("⚠️ Session history fetch failed:", (histResult as PromiseRejectedResult).reason?.message);
    }

    // 3. BUILD CURRENT USER MESSAGE PARTS
    const fileParts = attachedFiles
      .filter(f => f.data && INLINE_MIME_TYPES.has(f.mimeType))
      .map(f => ({ inlineData: { mimeType: f.mimeType, data: f.data } }));

    const unsupportedFileNote = attachedFiles
      .filter(f => !INLINE_MIME_TYPES.has(f.mimeType))
      .map(f => `[Attached file (unsupported for inline reading): ${f.name}]`)
      .join('\n');

    // Build the text part for the current turn — prepend workspace context only when we have it
    let currentTurnText = '';
    if (workspaceContext) {
      currentTurnText += `<workspace_context>\n${workspaceContext}\n</workspace_context>\n\n`;
    }
    if (unsupportedFileNote) {
      currentTurnText += `<attached_files_note>\n${unsupportedFileNote}\n</attached_files_note>\n\n`;
    }
    currentTurnText += userMessage;

    const userParts: any[] = [{ text: currentTurnText }, ...fileParts];

    // 4. GENERATION — use systemInstruction for persistent persona, keep history clean
    const model = vertexAI.getGenerativeModel({
      model: 'gemini-2.5-pro',
      systemInstruction: { role: 'system', parts: [{ text: RUKMER_SYSTEM_INSTRUCTION }] },
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: 8192,
      },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      ],
    });

    console.log(`🚀 Calling generateContentStream. History turns: ${sessionHistory.length / 2}. RAG: ${workspaceContext ? 'YES' : 'NO'}`);

    const resultStream = await model.generateContentStream({
      contents: [...sessionHistory, { role: 'user', parts: userParts }],
    });

    let fullResponse = "";
    let chunkCount = 0;

    for await (const chunk of resultStream.stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        // Skip thinking/reasoning tokens (thought: true) from Gemini 2.5 thinking models
        if ((part as any).thought === true) continue;
        const chunkText = part.text || "";
        if (chunkText) {
          chunkCount++;
          fullResponse += chunkText;
          res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
        }
      }
    }

    console.log(`✅ Stream complete. Chunks: ${chunkCount}. Response length: ${fullResponse.length} chars`);

    // Safety net: if the model produced no text at all, send an explicit fallback
    if (!fullResponse) {
      console.warn("⚠️ Empty response from model — candidate may have been safety-blocked.");
      fullResponse = "I wasn't able to generate a response for that. Could you try rephrasing your question?";
      res.write(`data: ${JSON.stringify({ text: fullResponse })}\n\n`);
    }

    // 5. PERSISTENCE
    let insertResult;
    try {
      insertResult = await pool.query(
        "INSERT INTO chats (user_id, user_message, ai_reply, session_id) VALUES ($1, $2, $3, $4) RETURNING id, created_at",
        [req.user.uid, userMessage, fullResponse, currentSessionId]
      );
    } catch (insertErr: any) {
      // Fallback: session_id column might not exist yet
      console.warn("⚠️ INSERT with session_id failed, trying without:", insertErr.message);
      insertResult = await pool.query(
        "INSERT INTO chats (user_id, user_message, ai_reply) VALUES ($1, $2, $3) RETURNING id, created_at",
        [req.user.uid, userMessage, fullResponse]
      );
    }

    // Send final payload with Database IDs
    res.write(`data: ${JSON.stringify({ done: true, chatId: insertResult.rows[0].id, createdAt: insertResult.rows[0].created_at })}\n\n`);
    res.end();

    // ─── Auto background sync (fire-and-forget, never blocks the chat response) ───
    // Re-index only new data if the last sync is more than 15 minutes old.
    if (!syncInProgress.has(req.user.uid)) {
      getLastSyncAt(req.user.uid).then(lastSync => {
        const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
        if (!lastSync || Date.now() - lastSync.getTime() > STALE_THRESHOLD_MS) {
          syncInProgress.add(req.user.uid);
          console.log(`🔄 Auto-sync triggered for ${req.user.uid} (last sync: ${lastSync?.toISOString() ?? 'never'})`);
          getAppContent(req.user.uid, lastSync ?? undefined)
            .catch(e => console.warn(`⚠️ Background sync failed for ${req.user.uid}:`, e.message))
            .finally(() => syncInProgress.delete(req.user.uid));
        }
      }).catch(() => {});
    }
    // ─────────────────────────────────────────────────────────────────────────────

  } catch (err: any) {
    console.error("❌ RAG Chat Error:", err?.message || err);
    console.error("❌ Error details:", JSON.stringify(err?.response?.data || err?.errorDetails || {}, null, 2));
    console.error("❌ Stack:", err?.stack);
    res.write(`data: ${JSON.stringify({ error: err?.message || "Something went wrong. Please try again." })}\n\n`);
    res.end();
  }
});

// POST /api/ingest — manually trigger RAG ingestion for a user's connected apps
app.post('/api/ingest', authenticateUser, async (req: any, res: any): Promise<void> => {
  const orgId: string = req.user.uid;
  console.log(`🚀 Manual ingest triggered for: ${orgId}`);
  try {
    const context = await getAppContent(orgId);
    const chunkCount = context ? context.split('\n').filter(Boolean).length : 0;
    console.log(`✅ Ingest complete for ${orgId}. Approx lines synced: ${chunkCount}`);
    res.json({ success: true, message: `Workspace data synced successfully.` });
  } catch (err: any) {
    console.error(`❌ Ingest failed for ${orgId}:`, err.message);
    res.status(500).json({ error: 'Ingestion failed. Check server logs.' });
  }
});

// DEV ONLY — trigger ingest by passing userId directly (no auth token needed)
// Remove this endpoint before deploying to production
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/dev/ingest', async (req: any, res: any): Promise<void> => {
    const { userId } = req.body;
    if (!userId) { res.status(400).json({ error: 'userId is required in the request body' }); return; }
    console.log(`🛠️  DEV ingest triggered for: ${userId}`);
    try {
      await getAppContent(userId);
      res.json({ success: true, message: `Dev ingest complete for ${userId}` });
    } catch (err: any) {
      console.error(`❌ Dev ingest failed:`, err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

app.get('/api/history', authenticateUser, async (req: any, res: any): Promise<void> => {
  try {
    const userId = req.user.uid;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    // Return ONE lightweight row per session (the most recent message).
    // We deliberately exclude ai_reply to keep the payload tiny — full message
    // bodies are fetched on demand via /api/history/session/:sessionId.
    const result = await pool.query(
      `SELECT id, session_id,
              COALESCE(title, LEFT(user_message, 60)) AS title,
              created_at,
              message_count
       FROM (
         SELECT id, session_id, title, user_message, created_at,
                COUNT(*) OVER (PARTITION BY session_id) AS message_count,
                ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC) AS rn
         FROM chats
         WHERE user_id = $1 AND hidden IS NOT TRUE
       ) sub
       WHERE rn = 1
       ORDER BY created_at DESC
       LIMIT 500`,
      [userId]
    );

    console.log("✅ History sessions for", userId, ":", result.rows.length);
    res.json(result.rows);
  } catch (err: any) {
    console.error("❌ History fetch error:", err?.message || err);
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// ⚡ Fetch ALL messages for a specific session (no limit) — used when restoring full chat history
app.get('/api/history/session/:sessionId', authenticateUser, async (req: any, res: any): Promise<void> => {
  try {
    const { sessionId } = req.params;
    if (!sessionId || sessionId.length > 128) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }
    const result = await pool.query(
      `SELECT id, user_message, ai_reply, created_at
       FROM chats
       WHERE user_id = $1 AND session_id = $2
       ORDER BY created_at ASC`,
      [req.user.uid, sessionId]
    );
    console.log(`📋 Session ${sessionId}: returning ${result.rows.length} messages for user ${req.user.uid}`);
    res.json(result.rows);
  } catch (err: any) {
    console.error("❌ Session history fetch error:", err?.message || err);
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

app.put('/api/chat/rename', authenticateUser, async (req: any, res: any): Promise<void> => {
    const { chatId, title } = req.body;
    if (!chatId || !title) return res.status(400).json({ error: 'chatId and title are required' });
    try {
      // Try with title column first, create it if missing
      try {
        await pool.query('UPDATE chats SET title = $1 WHERE id = $2 AND user_id = $3', [title, chatId, req.user.uid]);
      } catch (colErr: any) {
        if (colErr.message?.includes('column "title"')) {
          await pool.query('ALTER TABLE chats ADD COLUMN title VARCHAR(200)');
          await pool.query('UPDATE chats SET title = $1 WHERE id = $2 AND user_id = $3', [title, chatId, req.user.uid]);
        } else throw colErr;
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error('❌ Rename error:', err.message);
      res.status(500).json({ error: err?.message || 'Unknown error' });
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
        const tokenResponse = await axios.post<any>('https://slack.com/api/oauth.v2.access', null, {
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

        // Fire-and-forget RAG ingestion so Pinecone is populated immediately after connecting
        getAppContent(userId).catch((e: any) => console.warn('⚠️ Post-Slack ingest failed:', e.message));

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
        const response = await axios.get<any>('https://slack.com/api/conversations.history', {
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
        
        const response = await axios.get<any>('https://slack.com/api/conversations.list', {
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

app.post('/api/webhooks/slack', async (req: any, res: any) => {
  const { type, challenge, event, team_id } = req.body;

  // 1. SLACK URL VERIFICATION (Required when you first set up the webhook)
  if (type === 'url_verification') {
    return res.status(200).send(challenge);
  }

  // 2. ACKNOWLEDGE IMMEDIATELY (To prevent Slack from retrying)
  res.status(200).send(''); 

  // 3. ONLY LISTEN TO APP MENTIONS (Ignore bot's own messages)
  if (event && event.type === 'app_mention' && !event.bot_id) {
    try {
      console.log(`💬 Received Slack mention in team ${team_id}: ${event.text}`);
      
      // Clean the text (remove the <@U12345> bot mention part)
      const cleanPrompt = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

      // 4. FIND THE RIGHT TOKEN IN FIRESTORE
      // We search Firestore for the user who connected this specific Slack Workspace
      const usersRef = admin.firestore().collection('userTokens');
      const snapshot = await usersRef.where('slack.teamId', '==', team_id).limit(1).get();
      
      if (snapshot.empty) {
        console.error("No user found for this Slack workspace.");
        return;
      }

      const userData = snapshot.docs[0].data();
      const slackBotToken = userData.slack.accessToken; // The xoxb- token
      const orgId = snapshot.docs[0].id; // The user's Rukmer ID
      const slackClient = new WebClient(slackBotToken);

      // (Optional UX) Send a "Rukmer is thinking..." message
      const loadingMsg = await slackClient.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts, // Reply in a thread so it doesn't clutter the channel!
        text: "⏳ *Synthesizing workspace data...*"
      });

      // 5. RUN YOUR EXISTING RAG & AI LOGIC
      let workspaceContext = "";
      try {
        // You already wrote this function!
        workspaceContext = await queryWorkspaceData(cleanPrompt, orgId);
      } catch (e) { console.warn("Vector search failed"); }

      const systemInstruction = `
        You are Rukmer AI. Answer the user's question based ONLY on the following workspace context. 
        Format your answer beautifully for Slack.
        CONTEXT: ${workspaceContext || "No relevant data found."}
      `;

      const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
      const aiResponse = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `SYSTEM: ${systemInstruction}\n\nUSER: ${cleanPrompt}` }] }]
      });
      
      const finalReply = aiResponse.response.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't process that.";

      // 6. UPDATE THE SLACK MESSAGE WITH THE REAL ANSWER
      await slackClient.chat.update({
        channel: event.channel,
        ts: loadingMsg.ts as string,
        text: finalReply
      });

    } catch (error: any) {
      console.error("Slack Webhook Error:", error.message);
    }
  }
});

// ─── Microsoft Teams Bot Webhook ──────────────────────────────────────────
// Azure Bot Service always posts to /api/messages (Bot Framework default).
// /api/teams/messages is kept as an alias for any manual configuration.
const teamsBotHandler = async (req: any, res: any) => {
  console.log("🔥 TEAMS PING RECEIVED!");
   console.log("👉 BOT ID:", process.env.MS_BOT_ID);
  console.log("👉 PASS LENGTH:", process.env.MS_BOT_PASSWORD ? process.env.MS_BOT_PASSWORD.length : "UNDEFINED!");
  await adapter.process(req, res, async (context) => {
    await teamsBot.run(context);
  });
};

app.post('/api/messages', teamsBotHandler);          // Azure Bot Service default
app.post('/api/teams/messages', teamsBotHandler);    // alias (kept for backward compat)

// Diagnostic: test whether MS_BOT_ID + MS_BOT_PASSWORD can fetch a valid
// Bot Framework outbound token. Hit GET /api/teams/debug-auth to instantly see
// if your credentials are the problem. Remove before going live if desired.
app.get('/api/teams/debug-auth', async (req: any, res: any) => {
  // Decode a JWT payload without verifying signature (for diagnostics only)
  const decodeJwtPayload = (token: string) => {
    try {
      const payload = token.split('.')[1];
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    } catch { return null; }
  };

  try {
    // Test 1: Multi-tenant (botframework.com tenant)
    const multiRes = await fetch('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.MS_BOT_ID!,
        client_secret: process.env.MS_BOT_PASSWORD!,
        scope: 'https://api.botframework.com/.default',
      }).toString(),
    });
    const multiData: any = await multiRes.json();
    const multiClaims = multiData.access_token ? decodeJwtPayload(multiData.access_token) : null;

    // Test 2: Common tenant (works for both single + multi)
    const commonRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.MS_BOT_ID!,
        client_secret: process.env.MS_BOT_PASSWORD!,
        scope: 'https://api.botframework.com/.default',
      }).toString(),
    });
    const commonData: any = await commonRes.json();
    const commonClaims = commonData.access_token ? decodeJwtPayload(commonData.access_token) : null;

    // Discover the home tenant of this App Registration
    const openIdRes = await fetch(
      `https://login.microsoftonline.com/${process.env.MS_BOT_ID}/v2.0/.well-known/openid-configuration`
    );
    const openIdData: any = await openIdRes.json().catch(() => ({}));

    res.json({
      botId: process.env.MS_BOT_ID,
      passwordLength: process.env.MS_BOT_PASSWORD?.length ?? 0,
      multiTenantTest: {
        httpStatus: multiRes.status,
        hasToken: !!multiData.access_token,
        error: multiData.error ?? null,
        errorDescription: multiData.error_description ?? null,
        // tid = tenant that ISSUED the token. Should be botframework.com's GUID for true MultiTenant.
        // If this is YOUR tenant GUID instead, the bot is registered as Single-Tenant in Azure.
        tokenTenantId: multiClaims?.tid ?? null,
        tokenIssuer: multiClaims?.iss ?? null,
        tokenAppId: multiClaims?.appid ?? null,
      },
      commonTenantTest: {
        httpStatus: commonRes.status,
        hasToken: !!commonData.access_token,
        error: commonData.error ?? null,
        errorDescription: commonData.error_description ?? null,
        tokenTenantId: commonClaims?.tid ?? null,
      },
      diagnosis: multiClaims?.tid === 'f8cdef31-a31e-4b4a-93e4-5f571e91255a'
        ? '✅ App is TRUE MultiTenant (botframework.com tenant). Check Azure Bot > Channels > Teams is added.'
        : `⚠️  App is SINGLE-TENANT. Token tid="${multiClaims?.tid}". Fix: set MicrosoftAppType="SingleTenant" and MicrosoftAppTenantId="${multiClaims?.tid}" in your credentialsFactory.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
// ────────────────────────────────────────────────────────────────────────────

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

    // Fire-and-forget RAG ingestion so Pinecone is populated immediately after connecting
    getAppContent(userId).catch((e: any) => console.warn('⚠️ Post-Google ingest failed:', e.message));

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
  let scope = 'openid profile email offline_access Chat.Read Team.ReadBasic.All Channel.ReadBasic.All Group.Read.All'; 
  if (type === 'outlook') scope += ' Mail.Read';
  if (type === 'onedrive') scope += ' Files.Read.All';
  if (type === 'teams') scope += ' Chat.Read Team.ReadBasic.All Channel.ReadBasic.All Group.Read.All';

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

    console.log("🔄 Exchanging auth code for tokens...", {
      client_id: process.env.MS_CLIENT_ID?.substring(0, 5) + "...",
      has_secret: !!process.env.MS_CLIENT_SECRET,
      has_code: !!code
    });

    // Exchange code for tokens using MSAL (auto-populates the token cache with refresh token)
    const pca = await createMsalClient(userId);
    const msalScopes = (['openid', 'profile', 'email', 'offline_access', 'Chat.Read'] as string[])
      .concat(type === 'outlook' ? ['Mail.Read'] : [])
      .concat(type === 'onedrive' ? ['Files.Read.All'] : [])
      .concat(['Team.ReadBasic.All', 'Channel.ReadBasic.All', 'Group.Read.All']);

    const result = await pca.acquireTokenByCode({
      code: code as string,
      scopes: msalScopes,
      redirectUri: `${CURRENT_BACKEND_URL}/api/auth/microsoft/callback`,
    });

    console.log("✅ Token exchange successful!");

    // Persist MSAL cache to Firestore (contains the refresh token)
    await saveMsalCache(userId, pca);

    // Also persist the raw access token + expiry for legacy compatibility
    const account = result!.account;
    await admin.firestore().collection('userTokens').doc(userId).set({
      microsoft: {
        access_token: result!.accessToken,
        expires_at: result!.expiresOn ? result!.expiresOn.getTime() : Date.now() + 3500_000,
        oid: account?.localAccountId, // Azure AD Object ID — used by the Teams bot to identify the user
      }
    }, { merge: true });

    // Turn on the specific green light
    await admin.firestore().collection('userConnections').doc(userId).set({
      [type]: true 
    }, { merge: true });

    // Fire-and-forget RAG ingestion so Pinecone is populated immediately after connecting
    getAppContent(userId).catch((e: any) => console.warn('⚠️ Post-Microsoft ingest failed:', e.message));

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
        const teamsResponse = await axios.get<any>('https://graph.microsoft.com/v1.0/me/joinedTeams', {
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

// DEV ONLY — test Teams chat message access for a given userId
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/debug/teams-chat', async (req: any, res: any) => {
    const userId = (req.query.userId as string) || 'hnaJEx4Bf7ghikvHZZYqq4XjizA2';
    try {
      const accessToken = await getMicrosoftAccessToken(userId);
      const headers = { Authorization: `Bearer ${accessToken}` };

      // Step 1: List all chats the user is part of
      const chatsRes = await axios.get<any>('https://graph.microsoft.com/v1.0/me/chats?$top=5', { headers });
      const chats: any[] = chatsRes.data.value ?? [];

      if (chats.length === 0) {
        return res.json({ status: 'no_chats', message: 'No chats found for this user.' });
      }

      // Step 2: Attempt to read messages from each chat
      const results = await Promise.all(chats.map(async (chat: any) => {
        try {
          const msgRes = await axios.get<any>(
            `https://graph.microsoft.com/v1.0/me/chats/${chat.id}/messages?$top=3`,
            { headers }
          );
          const messages = msgRes.data.value ?? [];
          return {
            chatId: chat.id,
            chatType: chat.chatType,
            topic: chat.topic ?? '(no topic)',
            messageCount: messages.length,
            status: messages.length > 0 ? '✅ messages_readable' : '❌ empty_or_blocked',
            preview: messages[0]?.body?.content?.substring(0, 120) ?? null,
          };
        } catch (e: any) {
          return {
            chatId: chat.id,
            chatType: chat.chatType,
            topic: chat.topic ?? '(no topic)',
            status: '❌ permission_denied',
            error: e.response?.data?.error?.code ?? e.message,
          };
        }
      }));

      res.json({ userId, totalChats: chats.length, results });
    } catch (err: any) {
      if (err.message === 'RE_AUTH_REQUIRED') {
        return res.status(401).json({ error: 'RE_AUTH_REQUIRED — user must reconnect Microsoft account.' });
      }
      res.status(500).json({ error: err.response?.data?.error ?? err.message });
    }
  });
}

app.get('/api/debug/pinecone-stats', async (req: any, res: any) => {
  try {
    const stats = await index.describeIndexStats();
    res.json({
      message: "Pinecone Connectivity Successful",
      stats: stats,
      namespaces: stats.namespaces // This shows every orgId and their vector count
    });
  } catch (err: any) {
    res.status(500).json({ error: "Could not connect to Pinecone", details: err.message });
  }
});

app.get('/api/debug/pinecone-check', async (req: any, res: any) => {
  try {
    const stats = await index.describeIndexStats();
    
    // This tells us exactly which 'drawers' (namespaces) have data
    const namespaces = stats.namespaces || {};
    const targetNamespace = "hnaJEx4Bf7ghikvHZZYqq4XjizA2"; // Your specific ID
    
    res.json({
      indexDimension: stats.dimension,
      totalVectors: stats.totalRecordCount,
      allNamespaces: namespaces,
      targetFound: !!namespaces[targetNamespace],
      targetCount: namespaces[targetNamespace]?.recordCount || 0,
      suggestion: stats.dimension !== 768 ? "DIMENSION MISMATCH: Index should be 768" : "Check Ingestion"
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/{*any}', (req: any, res: any): void => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found' });
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// --- 7. Start Server ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Rukmer Backend on port ${PORT}`);
    pool.query("SELECT 1")
        .then(async () => {
            console.log("✅ PostgreSQL Connected");
            // Ensure schema columns exist
            await pool.query(`
                ALTER TABLE chats ADD COLUMN IF NOT EXISTS session_id VARCHAR(36);
                ALTER TABLE chats ADD COLUMN IF NOT EXISTS title VARCHAR(200);
                ALTER TABLE chats ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;
            `);
            console.log("✅ Schema columns verified (session_id, title, hidden)");

            // Create indexes for the hot query paths (safe to re-run — IF NOT EXISTS)
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_chats_user_created
                    ON chats (user_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_chats_user_session_created
                    ON chats (user_id, session_id, created_at ASC);
            `).catch((e: any) => console.warn('⚠️ Index creation skipped (may already exist):', e.message));
            console.log("✅ DB indexes verified");

            // Migrate id column from integer to UUID (one-time, safe to re-run)
            const colCheck = await pool.query(`
                SELECT data_type FROM information_schema.columns 
                WHERE table_name = 'chats' AND column_name = 'id'
            `);
            if (colCheck.rows.length > 0 && colCheck.rows[0].data_type !== 'uuid') {
                console.log("🔄 Migrating chats.id from integer to UUID...");
                await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
                await pool.query(`
                    ALTER TABLE chats 
                      ALTER COLUMN id DROP DEFAULT,
                      ALTER COLUMN id SET DATA TYPE UUID USING (gen_random_uuid()),
                      ALTER COLUMN id SET DEFAULT gen_random_uuid()
                `);
                console.log("✅ chats.id migrated to UUID");
            } else {
                console.log("✅ chats.id is already UUID");
            }
        })
        .catch((err: any) => console.error("❌ DB Error:", err?.message || err));
});