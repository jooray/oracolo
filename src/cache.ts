import { type NostrEvent } from '@nostr/tools/core';

export interface CacheData {
  generated_at: number;
  events: NostrEvent[];
}

async function fetchAndDecompress(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  if (url.endsWith('.gz') && typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const decompressed = response.body!.pipeThrough(ds);
    const reader = new Response(decompressed);
    return reader.text();
  }

  return response.text();
}

// In-process memoization. Both Blog.svelte and Note.svelte ask for the
// cache; without this, navigating from home → article would re-fetch and
// re-parse the cache file. With it, the second caller awaits the same
// promise and gets an instant in-memory hit.
let cachedPromise: Promise<CacheData | null> | null = null;

export function getCache(cacheUrl: string): Promise<CacheData | null> {
  if (cachedPromise === null) {
    cachedPromise = loadCache(cacheUrl);
  }
  return cachedPromise;
}

export async function loadCache(cacheUrl: string): Promise<CacheData | null> {
  // Try .gz first, fall back to plain JSON
  const urls = cacheUrl.endsWith('.gz')
    ? [cacheUrl]
    : [cacheUrl + '.gz', cacheUrl];

  for (const url of urls) {
    try {
      const text = await fetchAndDecompress(url);
      const data = JSON.parse(text);

      if (typeof data.generated_at !== 'number' || !Array.isArray(data.events)) {
        console.warn('Invalid cache format');
        return null;
      }

      return {
        generated_at: data.generated_at,
        events: data.events
      };
    } catch {
      // try next URL
    }
  }

  console.warn('Failed to load cache from', cacheUrl);
  return null;
}
