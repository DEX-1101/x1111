import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const imageUrl = req.query.url as string;
  if (!imageUrl) return res.status(400).send('Missing url parameter');
  try {
    const imageResponse = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.pixiv.net/',
      },
    });
    if (!imageResponse.ok) {
      return res.status(imageResponse.status).send(`Failed to fetch image`);
    }
    const contentType = imageResponse.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const buffer = await imageResponse.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).send('Internal Server Error');
  }
}
