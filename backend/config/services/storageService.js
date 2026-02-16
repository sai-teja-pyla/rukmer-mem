// backend/services/storageService.js
/**
 * 
import { Storage } from '@google-cloud/storage';
const storage = new Storage();

export const generateResumableUrl = async (fileName, contentType) => {
    const bucket = storage.bucket('rukmer-saas-data');
    const file = bucket.file(`uploads/${Date.now()}_${fileName}`);

    // Create a resumable upload session
    const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'resumable',
        expires: Date.now() + 60 * 60 * 1000, // Valid for 1 hour to START
        contentType: contentType,
    });

    return url;
};

*/