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
