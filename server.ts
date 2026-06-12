import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Lightweight keep-warm endpoint. The free Render tier sleeps after ~15 min idle and
// takes ~30s to wake on the next request; the client pings this on load / camera open
// so the server is awake before anyone loads the app or fetches the on-device model.
// (Scanning itself runs fully in the browser now — there is no server-side AI call.)
app.get('/api/warmup', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

// Serve frontend routes
const isProd = process.env.NODE_ENV === 'production';
if (!isProd) {
  const { createServer: createViteServer } = await import('vite');
  const viteServer = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });
  app.use(viteServer.middlewares);
} else {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Tarabish app online on port ${port}`);
});
