const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

export async function pixivJson(url: string): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.pixiv.net/',
      },
      signal: controller.signal,
    });
    if (!res.ok) return { status: res.status, body: { error: `Pixiv responded ${res.status}` } };
    return { status: 200, body: await res.json() };
  } catch (e: any) {
    return { status: e?.name === 'AbortError' ? 504 : 502, body: { error: 'Pixiv request failed' } };
  } finally {
    clearTimeout(timer);
  }
}

export const pixivSearchUrl = (word: string) => {
  const w = encodeURIComponent(word);
  return `https://www.pixiv.net/ajax/search/artworks/${w}?word=${w}&mode=all&p=1&lang=en`;
};

export const pixivIllustUrl = (id: string) =>
  `https://www.pixiv.net/ajax/illust/${encodeURIComponent(id)}?lang=en`;
