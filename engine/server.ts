import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { bootMemoryEngine, mountMemoryEngine } from './routes.js';
import { securityMiddleware } from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
app.use(securityMiddleware);
app.use(express.json({ limit: '40mb' }));
app.use(express.urlencoded({ extended: true, limit: '40mb' }));
mountMemoryEngine(app);

const PORT = Number(process.env.PORT || 5001);
try {
  const s = await bootMemoryEngine();
  console.log(`🧠 Memory store ready docs=${s.documents} chunks=${s.chunks} llm=${s.llm}`);
} catch (err) {
  console.error('Memory engine boot failed', (err as Error).message || err);
}
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🧠 Rukmer open-core engine on http://localhost:${PORT}`);
});
