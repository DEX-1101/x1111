import type { VercelRequest, VercelResponse } from '@vercel/node';
import { pipeImage } from './_lib/imageProxy.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  await pipeImage(url, 'danbooru', res, req.headers);
}
