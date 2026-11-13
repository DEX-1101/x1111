import { Tag, Post, WikiPage, TagGroup } from '../types';

const BASE_URL = 'https://danbooru.donmai.us';

/**
 * Browsers cannot call danbooru.donmai.us directly (no CORS headers), so every
 * JSON request goes through our same-origin proxy: /api/danbooru
 */
const API_PROXY = '/api/danbooru';

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;
const cache = new Map<string, { time: number; promise: Promise<any> }>();

/**
 * GET JSON from Danbooru through the proxy, with an in-memory cache and
 * in-flight de-duplication (identical concurrent calls share one request).
 * Failed requests are never cached.
 */
export async function danbooruGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  signal?: AbortSignal
): Promise<T> {
  const qs = new URLSearchParams({ path });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const url = `${API_PROXY}?${qs.toString()}`;

  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < CACHE_TTL_MS) return hit.promise;

  // NOTE: the shared promise is intentionally NOT tied to a single caller's AbortSignal,
  // otherwise one cancelled caller would reject everybody waiting on the same request.
  const promise = fetch(url).then(async res => {
    if (!res.ok) throw new Error(`Danbooru request failed: ${res.status}`);
    return (await res.json()) as T;
  });

  cache.set(url, { time: Date.now(), promise });
  if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  promise.catch(() => cache.delete(url));

  if (!signal) return promise;
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    promise.then(resolve, reject);
  });
}

/** Route Danbooru-hosted media through our image proxy (the CDN blocks hotlinking). */
const fixImageUrl = (url?: string) => {
  if (!url) return url;
  if (url.startsWith('/api/proxy-image')) return url; // already proxied
  if (url.startsWith('/')) url = `${BASE_URL}${url}`;
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
};

const withProxiedImages = (post: Post): Post => ({
  ...post,
  file_url: fixImageUrl(post.file_url),
  large_file_url: fixImageUrl(post.large_file_url),
  preview_file_url: fixImageUrl(post.preview_file_url),
  // Keep only the small thumbnail variants (used for sharp, data-friendly thumbnails).
  media_asset: post.media_asset?.variants
    ? {
        variants: post.media_asset.variants
          .filter(v => /^(180x180|360x360|720x720)$/.test(v.type) && v.url)
          .map(v => ({ ...v, url: fixImageUrl(v.url) as string })),
      }
    : undefined,
});

const escapeRegex = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
/** Danbooru wildcard ("*") -> anchored RegExp. Tags like `miku_(vocaloid)` contain regex metacharacters. */
const wildcardToRegex = (pattern: string) =>
  new RegExp('^' + pattern.split('*').map(escapeRegex).join('.*') + '$');

/**
 * Searches for tags matching the query, ordered by popularity.
 * Pass an AbortSignal to cancel stale autocomplete requests.
 */
export const searchTags = async (query: string, signal?: AbortSignal): Promise<Tag[]> => {
  // Danbooru tags use underscores, so "hatsune miku" must become "hatsune_miku".
  const q = query.trim().toLowerCase().replace(/\s+/g, '_');
  if (!q) return [];
  try {
    return await danbooruGet<Tag[]>(
      '/tags.json',
      { 'search[name_matches]': `*${q}*`, 'search[order]': 'count', limit: 10 },
      signal
    );
  } catch (error: any) {
    if (error?.name !== 'AbortError') console.error('Error searching tags:', error);
    return [];
  }
};

/**
 * Fetches a single tag by name to get its full details including related_tags.
 */
export const getTag = async (tagName: string): Promise<Tag | null> => {
  try {
    const data = await danbooruGet<Tag[]>('/tags.json', { 'search[name]': tagName });
    return data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error('Error fetching tag:', error);
    return null;
  }
};

/**
 * Fetches the wiki page for a specific tag to get its traits and description.
 */
export const getTagWiki = async (tagName: string): Promise<WikiPage | null> => {
  try {
    const data = await danbooruGet<WikiPage[]>('/wiki_pages.json', { 'search[title]': tagName });
    return data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error('Error fetching wiki:', error);
    return null;
  }
};

export const getPostById = async (id: string): Promise<Post | null> => {
  if (!/^\d+$/.test(id)) return null;
  try {
    return withProxiedImages(await danbooruGet<Post>(`/posts/${id}.json`));
  } catch (error) {
    console.error('Error fetching post:', error);
    return null;
  }
};

/**
 * Fetches recent posts (images) for a specific tag.
 * If safeMode is true, it appends 'rating:g' to filter out NSFW content.
 */
export const getPostsByTag = async (tagName: string, safeMode: boolean = true, page: number = 1, limit: number = 50): Promise<{ posts: Post[], hasMore: boolean }> => {
  try {
    const allTags = tagName.split(/\s+/).filter(t => t.trim().length > 0);
    
    // Danbooru anonymous API limit is 2 tags.
    // If safeMode is true, 'rating:g' takes 1 slot, leaving 1 slot for user tags.
    // If safeMode is false, user gets 2 slots.
    const maxApiTags = safeMode ? 1 : 2;
    
    const apiTags = allTags.slice(0, maxApiTags);
    const clientTags = allTags.slice(maxApiTags);
    
    const tagsParam = safeMode ? `${apiTags.join(' ')} rating:g` : apiTags.join(' ');
    
    // If we have client tags, fetch more results to increase the chance of finding matches after filtering
    const fetchLimit = clientTags.length > 0 ? 200 : limit;
    
    let posts = await danbooruGet<Post[]>('/posts.json', { tags: tagsParam, limit: fetchLimit, page });
    const hasMore = posts.length === fetchLimit;
    
    if (clientTags.length > 0) {
      posts = posts.filter(post => {
        const postTags = (post.tag_string || '').split(' ');
        return clientTags.every(ct => {
          if (ct.startsWith('-')) {
            const tagToExclude = ct.substring(1);
            if (tagToExclude.includes('*')) {
              const regex = wildcardToRegex(tagToExclude);
              return !postTags.some(t => regex.test(t));
            }
            return !postTags.includes(tagToExclude);
          }
          if (ct.includes('*')) {
            const regex = wildcardToRegex(ct);
            return postTags.some(t => regex.test(t));
          }
          return postTags.includes(ct);
        });
      });
    }
    
    return { posts: posts.map(withProxiedImages), hasMore };
  } catch (error) {
    console.error('Error fetching posts:', error);
    return { posts: [], hasMore: false };
  }
};

/**
 * Fetches tag groups.
 */
export const getTagGroups = async (page: number = 1): Promise<TagGroup[]> => {
  try {
    return await danbooruGet<TagGroup[]>('/tag_groups.json', { limit: 50, page });
  } catch (error) {
    console.error('Error fetching tag groups:', error);
    return [];
  }
};

/**
 * Helper to clean up Danbooru's DText (markdown) for basic display.
 * Removes links like [[tag]] or "text":/url
 */
export const cleanDText = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/\[\[(.*?)\]\]/g, '$1') // Remove [[tag]] brackets
    .replace(/"(.*?)":\/[^\s]+/g, '$1') // Remove "text":/url links
    .replace(/h\d\./g, '') // Remove header markers like h1., h2.
    .trim();
};

/** Public alias for components that need an endpoint without a dedicated helper. */
export const danbooruJson = danbooruGet;
