import { Readable } from 'node:stream';
import type { ServerResponse, IncomingHttpHeaders } from 'node:http';

/**
 * Hosts we are willing to fetch images from. Without this allow-list the proxy
 * is an open relay / SSRF hole (anyone could make your server fetch any URL).
 */
const DANBOORU_HOSTS = ['donmai.us']; // matches donmai.us and *.donmai.us (cdn.donmai.us, danbooru.donmai.us)
const PIXIV_HOSTS = ['pximg.net'];    // matches i.pximg.net etc.

const matchesHost = (host: string, roots: string[]) =>
  roots.some(root => host === root || host.endsWith(`.${root}`));

export function parseAllowedUrl(raw: string | undefined, kind: 'danbooru' | 'pixiv'): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return matchesHost(url.hostname, kind === 'danbooru' ? DANBOORU_HOSTS : PIXIV_HOSTS) ? url : null;
  } catch {
    return null;
  }
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const API_UA = process.env.DANBOORU_USER_AGENT || 'DanbooruTagExplorer/1.0 (goblin.gabonga.x1@gmail.com)';

async function fetchWithFallback(url: URL, kind: 'danbooru' | 'pixiv', signal: AbortSignal, range?: string, ifRange?: string) {
  // Range is what makes video seeking work: without it the browser can only play from byte 0.
  const rangeHeaders: Record<string, string> = {};
  if (range) rangeHeaders['Range'] = range;
  if (range && ifRange) rangeHeaders['If-Range'] = ifRange;
  if (kind === 'pixiv') {
    return fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Referer: 'https://www.pixiv.net/', ...rangeHeaders },
      signal,
    });
  }

  // Danbooru: descriptive UA + Referer first, then fall back on 403.
  const attempts: Record<string, string>[] = [
    { 'User-Agent': API_UA, Referer: 'https://danbooru.donmai.us/' },
    { 'User-Agent': API_UA },
    { 'User-Agent': BROWSER_UA, Referer: 'https://danbooru.donmai.us/' },
  ];
  let res!: Response;
  for (const headers of attempts) {
    res = await fetch(url, { headers: { Accept: 'image/*,video/*,*/*;q=0.8', ...headers, ...rangeHeaders }, signal });
    if (res.status !== 403) break;
    await res.body?.cancel().catch(() => {});
  }
  return res;
}

/**
 * Streams the remote image straight to the client (no full buffering in memory,
 * and it avoids Vercel's 4.5 MB limit for buffered responses).
 */
export async function pipeImage(
  rawUrl: string | undefined,
  kind: 'danbooru' | 'pixiv',
  res: ServerResponse & { status?: (code: number) => any },
  reqHeaders: IncomingHttpHeaders = {}
) {
  const send = (code: number, msg: string) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(msg);
  };

  const url = parseAllowedUrl(rawUrl, kind);
  if (!url) return send(400, 'Missing or disallowed url');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  res.on('close', () => controller.abort());

  try {
    const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
    const upstream = await fetchWithFallback(url, kind, controller.signal, one(reqHeaders.range), one(reqHeaders['if-range']));
    if (upstream.status === 416) {
      res.statusCode = 416;
      const cr = upstream.headers.get('content-range');
      if (cr) res.setHeader('Content-Range', cr);
      return res.end();
    }
    if (!upstream.ok || !upstream.body) {
      return send(upstream.status || 502, `Failed to fetch image: ${upstream.statusText}`);
    }

    const type = upstream.headers.get('content-type') || 'application/octet-stream';
    // Only relay images/videos, never HTML or scripts from an allowed host.
    if (!/^(image|video)\//i.test(type)) return send(415, 'Unsupported content type');

    const isVideoType = /^video\//i.test(type);
    res.statusCode = upstream.status === 206 ? 206 : 200; // 206 = partial content (seeking)
    res.setHeader('Content-Type', type);
    if (upstream.status === 206 || upstream.headers.get('accept-ranges') === 'bytes') {
      res.setHeader('Accept-Ranges', 'bytes');
    }
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    // fetch() transparently decompresses, so a compressed Content-Length would be wrong.
    const len = upstream.headers.get('content-length');
    if (len && !upstream.headers.get('content-encoding')) res.setHeader('Content-Length', len);
    // Videos: browser cache only. Edge/CDN caching could answer a Range request with the full
    // file (200), which silently breaks seeking.
    res.setHeader(
      'Cache-Control',
      isVideoType ? 'public, max-age=86400' : 'public, max-age=86400, s-maxage=604800, immutable'
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');

    Readable.fromWeb(upstream.body as any).pipe(res);
  } catch (err: any) {
    if (!res.headersSent) send(err?.name === 'AbortError' ? 504 : 500, 'Image proxy error');
    else res.end();
  } finally {
    clearTimeout(timer);
  }
}
