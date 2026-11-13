import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { proxyDanbooru } from './api/_lib/danbooru.js';
import { pipeImage } from './api/_lib/imageProxy.js';
import { pixivJson, pixivSearchUrl, pixivIllustUrl } from './api/_lib/pixiv.js';

const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

const first = (v: unknown): string | undefined =>
  Array.isArray(v) ? String(v[0]) : typeof v === 'string' ? v : undefined;

async function startServer() {
  const app = express();

  // ---- Danbooru JSON proxy (same-origin => no CORS problems) ----
  app.get('/api/danbooru', async (req, res) => {
    // Express 5 uses the "simple" query parser, so `search[name]` arrives as a flat key.
    const params = new URLSearchParams();
    let apiPath: string | undefined;
    for (const [key, value] of Object.entries(req.query)) {
      const v = first(value);
      if (v === undefined) continue;
      if (key === 'path') apiPath = v;
      else params.append(key, v);
    }
    const out = await proxyDanbooru(apiPath, params);
    Object.entries(out.headers).forEach(([k, v]) => res.setHeader(k, v));
    res.status(out.status).send(out.body);
  });

  // ---- Image proxies ----
  app.get('/api/proxy-image', (req, res) => pipeImage(first(req.query.url), 'danbooru', res, req.headers));
  app.get('/api/pixiv/image', (req, res) => pipeImage(first(req.query.url), 'pixiv', res, req.headers));

  // ---- Pixiv JSON proxies ----
  app.get('/api/pixiv/search', async (req, res) => {
    const word = first(req.query.word);
    if (!word) return res.status(400).json({ error: 'Missing word' });
    const { status, body } = await pixivJson(pixivSearchUrl(word));
    res.status(status).json(body);
  });

  app.get('/api/pixiv/illust', async (req, res) => {
    const id = first(req.query.id);
    if (!id || !/^\d+$/.test(id)) return res.status(400).json({ error: 'Missing or invalid id' });
    const { status, body } = await pixivJson(pixivIllustUrl(id));
    res.status(status).json(body);
  });

  // Unknown /api routes should 404 as JSON instead of falling through to the SPA.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  if (!isProd) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // NOTE: Express 5 (path-to-regexp v8) throws on app.get('*'), so use a plain middleware fallback.
    app.use((_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
