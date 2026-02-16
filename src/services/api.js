const BASE_DOMAIN = import.meta.env.VITE_API_URL || 'http://localhost:5001';

/**
 * Sends a chat message to the backend.
 */
export const sendChatMessage = async ({ userId, reportId, message, aiResponse, imageUrl }) => {
    try {
        // FIX #1: We explicitly add '/api/chat' here.
        // This fixes the "405 Method Not Allowed" error.
        const endpoint = `${BASE_DOMAIN}/api/chat`; 
        
        console.log("📤 API Sending to:", endpoint); 

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, reportId, message, aiResponse, imageUrl }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(errorData || 'Failed to send message');
        }

        return await response.json();
    } catch (error) {
        console.error("🚨 API Service Error (sendChatMessage):", error);
        throw error;
    }
};

/**
 * Fetches chat history.
 */
// FIX #2: Added 'userId' inside the parentheses below!
// Previously it was empty "async () =>", causing the ReferenceError.
export const fetchChatHistory = async (userId) => { 
    try {
        if (!userId) {
            console.warn("⚠️ fetchChatHistory called without userId");
            return [];
        }

        // FIX #3: Ensure we hit /api/history, not just /history
        const endpoint = `${BASE_DOMAIN}/api/history?userId=${userId}`;
        
        console.log("📡 Fetching History from:", endpoint);

        const response = await fetch(endpoint);
        
        if (!response.ok) {
            throw new Error('Failed to fetch history');
        }

        return await response.json();
    } catch (error) {
        console.error("🚨 API Service Error (fetchChatHistory):", error);
        throw error;
    }
};

export const hideChatHistory = async () => {
    // FIX #4: Ensure we hit /api/chat/hide
    const endpoint = `${BASE_DOMAIN}/api/chat/hide`;
    const response = await fetch(endpoint, {
        method: 'PUT'
    });
    return response.json();
};