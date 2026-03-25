import { auth } from '../firebase';

const BASE_DOMAIN = "https://rukmer-saas-service-361739908342.us-central1.run.app";

// ⚡ TOKEN CACHE: Dramatically improves performance
let tokenCache: { token: string; expiresAt: number } | null = null;

const getTokenFromCache = () => {
    if (tokenCache && Date.now() < tokenCache.expiresAt - 60000) { // 1 min buffer
        return tokenCache.token;
    }
    return null;
};

const setTokenCache = (token: string) => {
    // Firebase tokens expire in ~1 hour (3600 seconds)
    tokenCache = { token, expiresAt: Date.now() + 3540000 }; // 59 minutes
};

// Optimized token retrieval with caching
const getToken = async (): Promise<string> => {
    // Check cache first
    const cachedToken = getTokenFromCache();
    if (cachedToken) {
        console.log("♻️  TOKEN CACHE HIT");
        return cachedToken;
    }

    return new Promise((resolve, reject) => {
        const unsubscribe = auth.onAuthStateChanged(async (user) => {
            unsubscribe();
            if (user) {
                try {
                    // Only use cached token, no force refresh (much faster)
                    const token = await user.getIdToken(false); // false = use cache
                    console.log("💎 TOKEN OBTAINED (fresh):", token.substring(0, 15) + "...");
                    setTokenCache(token);
                    resolve(token);
                } catch (error) {
                    reject(new Error("Failed to get Firebase token"));
                }
            } else {
                reject(new Error("User is not logged in"));
            }
        });
    });
};

/**
 * Sends a chat message to the backend with streaming support.
 */
export const sendChatMessage = async (data) => {
    try {
        const endpoint = `${BASE_DOMAIN}/api/ai/chat`; // ✅ Correct endpoint
        const token = await getToken();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 
                'Accept': 'text/event-stream',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(errorData || 'Failed to send message');
        }

        // Handle SSE streaming response
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullResponse = "";

        if (!reader) throw new Error('No response body');

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.text) fullResponse += data.text;
                        if (data.done) return { aiResponse: fullResponse, reply: fullResponse };
                    } catch (e) {
                        // Ignore parse errors in SSE parsing
                    }
                }
            }
        }

        return { aiResponse: fullResponse, reply: fullResponse };
    } catch (error: any) {
        console.error("🚨 API Service Error (sendChatMessage):", error);
        throw error;
    }
};

/**
 * Fetches chat history.
 */
export const fetchChatHistory = async (userId) => { 
    try {
        if (!userId) return [];

        const endpoint = `${BASE_DOMAIN}/api/history?userId=${userId}`;
        const token = await getToken();
        
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}` 
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch history');
        return await response.json();
    } catch (error) {
        console.error("🚨 API Service Error (fetchChatHistory):", error);
        throw error;
    }
};

/**
 * Hides chat history.
 */
export const hideChatHistory = async (userId) => { 
    try {
        const endpoint = `${BASE_DOMAIN}/api/chat/hide`;
        const token = await getToken();

        const response = await fetch(endpoint, {
            method: 'PUT',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ userId }) 
        });

        if (!response.ok) throw new Error('Failed to hide chat history');
        return await response.json();
    } catch (error) {
        console.error("🚨 API Service Error (hideChatHistory):", error);
        throw error;
    }
};