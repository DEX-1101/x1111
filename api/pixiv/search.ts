import type { VercelRequest, VercelResponse } from '@vercel/node';
import { pixivJson, pixivSearchUrl } from '../_lib/pixiv.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const word = Array.isArray(req.query.word) ? req.query.word[0] : req.query.word;
  if (!word) return res.status(400).json({ error: 'Missing word' });
  const { status, body } = await pixivJson(pixivSearchUrl(word));
  if (status === 200) res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
  return res.status(status).json(body);
}
