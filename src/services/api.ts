import { auth } from '../firebase';

const BASE_DOMAIN = "https://rukmer-saas-service-361739908342.us-central1.run.app";

// 🚨 THE BULLETPROOF LOCK: Forces React to wait for Firebase
const waitForToken = () => {
    return new Promise((resolve, reject) => {
        const unsubscribe = auth.onAuthStateChanged(async (user) => {
            unsubscribe(); // Stop listening once we get the user
            if (user) {
                try {
                    const token = await user.getIdToken(true); // Force a fresh token
                    console.log("💎 TOKEN OBTAINED:", token.substring(0, 15) + "...");
                    resolve(token);
                } catch (error) {
                    reject(new Error("Failed to refresh Firebase token"));
                }
            } else {
                reject(new Error("User is not logged in"));
            }
        });
    });
};

/**
 * Sends a chat message to the backend.
 */
export const sendChatMessage = async (data) => {
    try {
        const endpoint = `${BASE_DOMAIN}/api/chat`;
        const token = await waitForToken(); // 👈 Wait securely for the token

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` // 👈 Guaranteed to exist now
            },
            body: JSON.stringify(data),
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
export const fetchChatHistory = async (userId) => { 
    try {
        if (!userId) return [];

        const endpoint = `${BASE_DOMAIN}/api/history?userId=${userId}`;
        const token = await waitForToken(); // 👈 Wait securely
        
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
        const token = await waitForToken(); // 👈 Wait securely

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