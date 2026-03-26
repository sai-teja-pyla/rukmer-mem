import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Pinecone } from "@pinecone-database/pinecone";
import { GoogleAuth } from "google-auth-library";
import axios from "axios";

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const index = pc.index(process.env.PINECONE_INDEX_NAME!);

// Reuse a single auth client across the process lifetime (avoids re-auth on every call)
let _authClient: any = null;
let _projectId: string | null = null;
async function getVertexClient() {
  if (!_authClient) {
    const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
    _authClient = await auth.getClient();
    _projectId = await auth.getProjectId();
  }
  return { client: _authClient, projectId: _projectId };
}

// 1. Logic to get Embeddings from Vertex AI
async function getEmbedding(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY") {
  // Normalise whitespace so newlines/tabs don't fragment the semantic signal
  const cleanText = text.replace(/\s+/g, ' ').trim();
  const { client, projectId } = await getVertexClient();
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/text-embedding-004:predict`;

  const res = await client.request({
    url,
    method: "POST",
    data: { instances: [{ content: cleanText, task_type: taskType }] }
  });

  return (res.data as any).predictions[0].embeddings.values;
}

// Extract key semantic keywords from text to boost embedding relevance
function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/).slice(0, 50); // Top 50 words
  const stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that', 'i', 'you', 'he', 'she', 'it', 'we', 'they']);
  return words.filter(w => w.length > 3 && !stopwords.has(w) && !/^\d+$/.test(w)).slice(0, 8);
}

// Build a rich context prefix so the *embedding* captures source + topic,
// not just the raw content. This is the primary driver of 0.9+ scores.
function buildContextPrefix(metadata: any, textKeywords: string[]): string {
  const parts: string[] = [];
  
  if (metadata.source === "gmail") {
    parts.push(`email message`);
    if (metadata.from)    parts.push(`from sender ${metadata.from}`);
    if (metadata.subject) parts.push(`subject "${metadata.subject}"`);
    parts.push(`keywords: ${textKeywords.join(' ')}`);
    if (metadata.date)    parts.push(`date ${metadata.date}`);
  } else if (metadata.source === "slack") {
    parts.push(`slack workspace message`);
    if (metadata.channel_id) parts.push(`channel ${metadata.channel_id}`);
    if (metadata.sender_id)  parts.push(`user ${metadata.sender_id}`);
    parts.push(`content: ${textKeywords.join(' ')}`);
    if (metadata.timestamp)  parts.push(`timestamp ${metadata.timestamp}`);
  } else if (metadata.source === "teams-chat" || metadata.source === "teams_chat" || metadata.source === "teams-actual-chat") {
    parts.push(`microsoft teams chat message`);
    if (metadata.sender_id) parts.push(`from ${metadata.sender_id}`);
    if (metadata.topic)     parts.push(`chat topic: ${metadata.topic}`);
    parts.push(`content: ${textKeywords.join(' ')}`);
    if (metadata.timestamp) parts.push(`timestamp ${metadata.timestamp}`);
  } else if (metadata.source) {
    parts.push(`${metadata.source} document`);
    parts.push(`keywords: ${textKeywords.join(' ')}`);
  }
  
  return parts.length ? parts.join(' | ') + ' || ' : '';
}

// Clear the entire namespace ONCE before a full re-ingestion cycle
export async function clearNamespace(orgId: string) {
  console.log(`🧹 Clearing old vectors from namespace "${orgId}"...`);
  try {
    await index.namespace(orgId).deleteAll();
    console.log(`✅ Namespace cleared`);
  } catch (err: any) {
    if (!err.message?.includes('not found')) {
      console.warn(`⚠️ Warning clearing namespace: ${err.message}`);
    }
  }
}

// 2. Main function to "Learn" a piece of text
export async function learnWorkspaceData(text: string, orgId: string, metadata: any) {
  console.log(`📡 Starting ingestion for Org: ${orgId}...`);

  // Smaller chunks = denser, higher-precision vectors (sweet spot for short comms data)
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 250,
    chunkOverlap: 40,
  });

  const chunks = await splitter.splitText(text);
  console.log(`🧠 Embedding ${chunks.length} chunks with rich context prefix...`);

  const vectors = await Promise.all(chunks.map(async (chunk, i) => {
    // Extract keywords from THIS chunk to make the prefix semantic
    const keywords = extractKeywords(chunk);
    const contextPrefix = buildContextPrefix(metadata, keywords);
    
    // Enrich text: context prefix + chunk content = a "document" with semantic labels
    const enrichedText = contextPrefix + chunk;
    const embedding = await getEmbedding(enrichedText, "RETRIEVAL_DOCUMENT");

    // Sanitize metadata: Pinecone rejects null or undefined values
    const rawMeta = { ...metadata, text: chunk, orgId, keywords: keywords.join(' ') };
    const cleanMeta: Record<string, string | number | boolean | string[]> = {};
    for (const [key, value] of Object.entries(rawMeta)) {
      if (value !== null && value !== undefined) {
        cleanMeta[key] = value as string | number | boolean | string[];
      }
    }

    const sourceId = metadata.source ?? "doc";
    const messageId = metadata.message_id ?? `chunk${i}`;

    return {
      id: `rukmer_${sourceId}_${messageId}_${i}_${Date.now()}`,
      values: embedding,
      metadata: cleanMeta,
    };
  }));

  console.log(`📦 Built ${vectors.length} enriched vectors with keyword metadata`);
  console.log(`   Sample prefix: \"${buildContextPrefix(metadata, extractKeywords(chunks[0] ?? '')).substring(0, 80)}...\"`);

  try {
    await index.namespace(orgId).upsert({ records: vectors });
    console.log(`✅ Successfully upserted ${vectors.length} vectors into namespace "${orgId}"`);
  } catch (err: any) {
    console.error(`❌ Pinecone upsert FAILED for namespace "${orgId}":`, err?.message ?? err);
    if (err?.response?.data) {
      console.error("Pinecone error details:", JSON.stringify(err.response.data, null, 2));
    }
    throw err;
  }
}

export async function queryWorkspaceData(query: string, orgId: string) {
  console.log(`--- 🔍 START RAG RETRIEVAL ---`);
  console.log(`Namespace: ${orgId} | Query: "${query.substring(0, 80)}"`);

  // Extract keywords from the query itself to boost metadata filtering
  const queryKeywords = extractKeywords(query);
  console.log(`Query keywords: ${queryKeywords.join(', ')}`);

  // Clean the query the same way documents are cleaned
  const queryVector = await getEmbedding(query.replace(/\s+/g, ' ').trim(), "RETRIEVAL_QUERY");
  console.log(`Generated Vector: [${queryVector.slice(0, 3)}... length: ${queryVector.length}]`);

  // Query with HYBRID approach: semantic search across ALL sources
  const queryResponse = await index.namespace(orgId).query({
    vector: queryVector,
    topK: 15,
    includeMetadata: true,
  });

  const topScore = queryResponse.matches[0]?.score;
  console.log(`✅ RAG: Found ${queryResponse.matches.length} matches. Top score: ${topScore?.toFixed(4)}`);

  queryResponse.matches.forEach((m, i) => {
    const preview = String(m.metadata?.text ?? '').replace(/\s+/g, ' ').substring(0, 60);
    console.log(`  Match ${i + 1}: score=${m.score?.toFixed(4)} src=${m.metadata?.source} | "${preview}..."`);
  });

  // Only surface matches above a confidence threshold to avoid hallucination
  const SCORE_THRESHOLD = 0.55;
  const goodMatches = queryResponse.matches.filter(m => (m.score ?? 0) >= SCORE_THRESHOLD);

  if (goodMatches.length === 0) {
    console.warn(`⚠️ No matches above confidence threshold (${SCORE_THRESHOLD}). Top was ${topScore?.toFixed(4)}.`);
    return "I couldn't find anything specific enough in your connected apps to answer that question.";
  } else {
    console.log(`✅ Found ${goodMatches.length} high-confidence matches (score >= ${SCORE_THRESHOLD})`);
  }

  console.log(`--- 🔍 END RAG RETRIEVAL ---`);

  // Format results with rich context for the LLM
  const context = goodMatches
    .map((match: any) => {
      const meta = match.metadata;
      const score = match.score?.toFixed(3) ?? 'N/A';
      const source = meta.source === "gmail"
        ? `Gmail: ${meta.from ?? 'unknown'} — Subject: "${meta.subject ?? 'N/A'}"`
        : meta.source === "slack"
        ? `Slack: #${meta.channel_id ?? 'general'} (${meta.sender_id ?? 'unknown'})`
        : (meta.source === "teams-chat" || meta.source === "teams_chat" || meta.source === "teams-actual-chat")
        ? `Teams Chat: ${meta.sender_id ?? 'unknown'}${meta.topic ? ` — ${meta.topic}` : ''}`
        : meta.source === "outlook"
        ? `Outlook: ${meta.from ?? 'unknown'} — Subject: "${meta.subject ?? 'N/A'}"`
        : `${meta.source ?? 'Unknown source'}`;
      return `[${source}] (confidence: ${score})\n${meta.text}`;
    })
    .join("\n\n---\n\n");

  return context || "";
}

export async function fetchTeamsMessages(accessToken: string, sinceDate?: Date) {
  // 1. Get all Chat IDs first (limit 20, covers most users)
  const chatsResponse = await axios.get<any>(
    'https://graph.microsoft.com/v1.0/me/chats?$top=20',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const allTeamsData: { id: string; text: string; metadata: { source: string; sender: string; date: string; chatId: string } }[] = [];

  for (const chat of chatsResponse.data.value) {
    // 2. Get messages for each specific Chat ID — wrapped per-chat so one failure doesn't abort all
    try {
      // For incremental syncs, filter server-side with $filter to avoid downloading old messages
      const messagesUrl = sinceDate
        ? `https://graph.microsoft.com/v1.0/me/chats/${chat.id}/messages?$top=50&$filter=createdDateTime ge ${sinceDate.toISOString()}`
        : `https://graph.microsoft.com/v1.0/me/chats/${chat.id}/messages?$top=20`;
      const messagesResponse = await axios.get<any>(messagesUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      // 3. Save to Pinecone with cleaned text and a unique source name
      for (const msg of messagesResponse.data.value) {
        const rawContent = msg.body?.content ?? '';
        // Skip system events (meeting joins/leaves etc.)
        if (rawContent === '<systemEventMessage/>' || msg.messageType === 'systemEventMessage') continue;
        // Strip HTML tags and decode common entities
        const text = rawContent
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim();
        if (!text) continue;

        allTeamsData.push({
          id: msg.id,
          text,
          metadata: {
            source: "teams-actual-chat",
            sender: msg.from?.user?.displayName ?? 'unknown',
            date: msg.createdDateTime,
            chatId: chat.id,
          },
        });
      }
    } catch (err: any) {
      // Individual chat may be inaccessible (e.g. meeting chat after it ends) — skip silently
      console.warn(`⚠️  Teams: skipping chat ${chat.id} (${chat.chatType}): ${err.response?.data?.error?.message ?? err.message}`);
    }
  }

  console.log(`📨 Teams: collected ${allTeamsData.length} messages from ${chatsResponse.data.value.length} chats`);
  return allTeamsData;
}

