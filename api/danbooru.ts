import type { VercelRequest, VercelResponse } from '@vercel/node';
import { proxyDanbooru } from './_lib/danbooru.js';

/**
 * GET /api/danbooru?path=/tags.json&search[name_matches]=*k*&limit=10
 * Same-origin proxy for the Danbooru JSON API (fixes the browser CORS error).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const params = new URLSearchParams();
  let path: string | undefined;
  for (const [key, value] of Object.entries(req.query)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v === undefined) continue;
    if (key === 'path') path = v;
    else params.append(key, v);
  }

  const out = await proxyDanbooru(path, params);
  Object.entries(out.headers).forEach(([k, v]) => res.setHeader(k, v));
  return res.status(out.status).send(out.body);
}
