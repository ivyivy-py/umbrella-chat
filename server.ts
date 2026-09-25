import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import weatherHandler from './api/weather.js';
import healthHandler from './api/health.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Mount API handlers
  app.all('/api/weather', async (req, res) => {
    try {
      await weatherHandler(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Internal server error' });
      }
    }
  });

  app.all('/api/health', async (req, res) => {
    try {
      await healthHandler(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Internal server error' });
      }
    }
  });

  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
