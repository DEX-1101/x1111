import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = req.query.id as string;
  if (!id) return res.status(400).send('Missing id');
  try {
    const url = `https://www.pixiv.net/ajax/illust/${id}?lang=en`;
    const pixivRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.pixiv.net/'
      }
    });
    if (!pixivRes.ok) throw new Error('Pixiv illust details failed');
    const data = await pixivRes.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
