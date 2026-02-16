//services/api.js
// 1. Ensure the variable name matches what is used in the functions below
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

/**
 * Sends a new chat message to the Node.js backend to be stored in Cloud SQL.
 * @param {string} message - The user's input message
 * @param {string} aiResponse - The AI's generated response to be archived
 * @param {string} imageUrl - Optional URL of an image to associate with this chat entry
 * @param {string} userId - The ID of the user sending the message (critical for multi-user support)
 * @param {string} reportId - The ID of the report/project this chat is associated with (optional)
 */
// services/api.js
export const sendChatMessage = async ({ userId, reportId, message, aiResponse, imageUrl }) => {
    try {

        console.log("📤 API Sending:", {  userId, reportId, message, aiResponse, imageUrl  });

        const response = await fetch( `${API_BASE_URL}/api/chat` || `http://localhost:5001/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, reportId, message, aiResponse, imageUrl }), // This sends {userId, message, aiResponse, imageUrl}
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to send message');
        }

        return await response.json();
    } catch (error) {
        console.error("🚨 API Service Error:", error);
        throw error;
    }
};

/**
 * Fetches the existing chat history from the Cloud SQL database.
 */
export const fetchChatHistory = async () => {
    try {
        const response = await fetch(`${API_BASE_URL}/history?userId=${userId}`|| `http://localhost:5001/history?userId=${userId}`);
        
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
    const response = await fetch(`${API_BASE_URL}/chat/hide` || `http://localhost:5001/chat/hide`, {
        method: 'PUT'
    });
    return response.json();
};