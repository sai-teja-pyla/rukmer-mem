import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

const REDIRECT_URI = process.env.NODE_ENV === 'production' 
  ? 'https://app.rukmer.com/api/auth/google/callback' 
  : 'http://localhost:5001/api/auth/google/callback';

export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/devstorage.read_only'
];