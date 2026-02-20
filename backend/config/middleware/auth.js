import admin from 'firebase-admin';
import path from 'path';

// Initialize Firebase Admin if it hasn't been already
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(path.join(process.cwd(), 'service-account.json'))
    });
}

export const authenticateUser = async (req, res, next) => {
    // 1. Extract the token from the header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn("🚨 Unauthorized: No token provided");
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        // 2. Verify the token with Firebase Admin
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        
        // 3. Attach the decoded user data to the request so your routes can use it
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error("🚨 Firebase Auth Error:", error.message);
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }
};