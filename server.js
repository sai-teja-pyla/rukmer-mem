import express from 'express';
import cors from 'cors'; // if you have this
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;
dotenv.config();


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test the connection
pool.connect()
  .then(() => console.log("✅ Connected to PostgreSQL"))
  .catch(err => console.error("❌ PostgreSQL Connection Error:", err));


// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*', // Update after deploying frontend
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Main API endpoint for image analysis
app.post('/api/analyze', async (req, res) => {
  try {
    const { messages, max_tokens = 4000 } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request: messages array required' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens,
        messages
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Anthropic API error:', errorData);
      return res.status(response.status).json({ 
        error: 'API request failed', 
        details: errorData 
      });
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

// Chat endpoint (for chatbot functionality)
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, max_tokens = 1500 } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request: messages array required' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens,
        messages
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Anthropic API error:', errorData);
      return res.status(response.status).json({ 
        error: 'API request failed', 
        details: errorData 
      });
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

// Simple chat endpoint for testing
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    console.log("User sent:", message);

    // TODO: Connect to Gemini/OpenAI here later
    // For now, return a dummy response
    const aiResponse = `Rukmer AI received: "${message}"`;

    res.json({ reply: aiResponse });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const aiResponse = `Rukmer AI processed: "${message}"`;

    // SAVE TO POSTGRESQL
    const query = 'INSERT INTO chats (user_message, ai_reply) VALUES ($1, $2) RETURNING *';
    const values = [message, aiResponse];
    
    const result = await pool.query(query, values);
    
    console.log("Saved chat ID:", result.rows[0].id);

    res.json({ reply: aiResponse });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to process chat" });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Test route to check if server is running
app.get('/', (req, res) => {
  res.send('Rukmer AI Server is Running!');
});

// Test API Route
app.get('/api/test', (req, res) => {
  res.json({ message: "Connected to Rukmer Backend successfully!" });
});