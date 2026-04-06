import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const imageUrl = req.query.url as string;
  if (!imageUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    console.log(`Proxying image request for: ${imageUrl}`);
    
    const commonHeaders = {
      'User-Agent': 'DanbooruTagExplorer/1.0 (goblin.gabonga.x1@gmail.com)',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    };

    // Try with Referer first
    let imageResponse = await fetch(imageUrl, {
      headers: {
        ...commonHeaders,
        'Referer': 'https://danbooru.donmai.us/',
      },
    });

    // If 403, try without Referer
    if (imageResponse.status === 403) {
      console.log('403 Forbidden with Referer, retrying without Referer...');
      imageResponse = await fetch(imageUrl, {
        headers: commonHeaders,
      });
    }

    // If still 403, try with a generic browser User-Agent
    if (imageResponse.status === 403) {
      console.log('403 Forbidden with descriptive UA, retrying with generic browser UA...');
      imageResponse = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Referer': 'https://danbooru.donmai.us/',
        },
      });
    }

    if (!imageResponse.ok) {
      console.error(`Failed to fetch image from source: ${imageResponse.status} ${imageResponse.statusText} for ${imageUrl}`);
      return res.status(imageResponse.status).send(`Failed to fetch image from source: ${imageResponse.statusText}`);
    }

    // Forward the content type
    const contentType = imageResponse.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    // Set cache headers
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const buffer = await imageResponse.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error proxying image:', error);
    res.status(500).send('Internal Server Error');
  }
}
