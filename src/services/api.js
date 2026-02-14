// 1. Ensure the variable name matches what is used in the functions below
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

/**
 * Sends a new chat message to the Node.js backend to be stored in Cloud SQL.
 * @param {string} message - The user's input message
 * @param {string} aiResponse - The AI's generated response to be archived
 */
export const sendChatMessage = async (message, aiResponse, imageUrl = null) => {
    try {
        const response = await fetch(`${API_BASE_URL}/chat`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json' 
            },
            // We send both the message and the AI response to the backend 
            // so the backend can save both columns to your SQL table.
            body: JSON.stringify({ message, aiResponse, imageUrl }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to send message');
        }

        return await response.json();
    } catch (error) {
        console.error("🚨 API Service Error (sendChatMessage):", error);
        throw error;
    }
};

/**
 * Fetches the existing chat history from the Cloud SQL database.
 */
export const fetchChatHistory = async () => {
    try {
        const response = await fetch(`${API_BASE_URL}/api/history`);
        
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
    const response = await fetch(`${API_BASE_URL}/chat/hide`, {
        method: 'PUT'
    });
    return response.json();
};