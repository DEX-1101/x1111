import type { VercelRequest, VercelResponse } from '@vercel/node';
import { pixivJson, pixivIllustUrl } from '../_lib/pixiv.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id || !/^\d+$/.test(id)) return res.status(400).json({ error: 'Missing or invalid id' });
  const { status, body } = await pixivJson(pixivIllustUrl(id));
  if (status === 200) res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(status).json(body);
}
