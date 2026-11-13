/**
 * Shared Danbooru proxy logic. Used by:
 *   - api/danbooru.ts  (Vercel serverless function)
 *   - server.ts        (local dev / self-hosted Express)
 *
 * The folder name starts with "_" so Vercel does NOT deploy it as its own route.
 */

const DANBOORU_ORIGIN = 'https://danbooru.donmai.us';

// Only these read-only JSON endpoints can be reached through the proxy.
const ALLOWED_PATHS: RegExp[] = [
  /^\/tags\.json$/,
  /^\/tag_aliases\.json$/,
  /^\/wiki_pages\.json$/,
  /^\/tag_groups\.json$/,
  /^\/posts\.json$/,
  /^\/posts\/\d+\.json$/,
];

const USER_AGENT =
  process.env.DANBOORU_USER_AGENT || 'DanbooruTagExplorer/1.0 (goblin.gabonga.x1@gmail.com)';

export interface ProxyResult {
  status: number;
  body: string;
  headers: Record<string, string>;
}

const json = (status: number, payload: unknown, extra: Record<string, string> = {}): ProxyResult => ({
  status,
  body: JSON.stringify(payload),
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
});

/**
 * @param path   Danbooru path, e.g. "/tags.json"
 * @param params Query params to forward, e.g. { "search[name]": "foo", limit: "10" }
 */
export async function proxyDanbooru(
  path: string | undefined,
  params: URLSearchParams
): Promise<ProxyResult> {
  if (!path || !ALLOWED_PATHS.some(re => re.test(path))) {
    return json(400, { error: 'Path not allowed' });
  }

  const url = new URL(path, DANBOORU_ORIGIN);
  params.forEach((value, key) => url.searchParams.append(key, value));

  // Optional auth lifts the anonymous 2-tag search limit & raises rate limits.
  const login = process.env.DANBOORU_LOGIN;
  const apiKey = process.env.DANBOORU_API_KEY;
  if (login && apiKey) {
    url.searchParams.set('login', login);
    url.searchParams.set('api_key', apiKey);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await upstream.text();

    if (!upstream.ok) {
      // Never cache errors (429 / 5xx would otherwise get stuck on the CDN).
      return {
        status: upstream.status,
        body: text || JSON.stringify({ error: upstream.statusText }),
        headers: {
          'Content-Type': upstream.headers.get('content-type') || 'application/json',
          'Cache-Control': 'no-store',
        },
      };
    }

    return {
      status: 200,
      body: text,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // Edge-cache 5 min, serve stale for 1 h while revalidating. Cuts rate-limit hits a lot.
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
      },
    };
  } catch (err: any) {
    const timedOut = err?.name === 'AbortError';
    return json(timedOut ? 504 : 502, { error: timedOut ? 'Upstream timeout' : 'Upstream request failed' }, {
      'Cache-Control': 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}
