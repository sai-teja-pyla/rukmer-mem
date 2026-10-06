import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { bootMemoryEngine, mountMemoryEngine } from './routes.js';
import { stats } from './pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
app.use(cors());
app.use(express.json({ limit: '40mb' }));
mountMemoryEngine(app);

const PORT = Number(process.env.PORT || 5001);
app.listen(PORT, '0.0.0.0', async () => {
  const s = await bootMemoryEngine();
  console.log(`🧠 Rukmer open-core engine on http://localhost:${PORT}`);
  console.log(`   docs=${s.documents} chunks=${s.chunks} llm=${stats().llm}`);
});
