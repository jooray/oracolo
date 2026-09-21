// Routing for both the hash router (always on) and the path router that
// prerendered deployments add on top of it.
//
// Hash URLs are permanent: every link ever shared — `#<d-tag>`, `#<event-id>`,
// `#naddr1…`, `#nevent1…`, `#note1…` — keeps resolving exactly as before. When
// a page has been baked to disk the app additionally knows a real path for it
// (`/a/<d-tag>/`), which is what it links to and what it upgrades the address
// bar to.

import type { SeedPaths } from './seed';
import { permalinkHash, type EventData, type PermalinkMode } from './utils';

export type Route =
  | { type: 'home' }
  /** The raw `tags/<topic>` hash value, as Blog.svelte expects it. */
  | { type: 'tag'; tag: string }
  | { type: 'event'; ref: string };

/** A `d` tag safe to use as a path segment (and as a directory on disk). */
export function isBakeableSlug(slug: string | undefined): slug is string {
  return !!slug && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) && slug !== '..';
}

export function decodeRef(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    // malformed percent-encoding — keep the raw value
    return raw;
  }
}

export function routeFromHash(rawHash: string): Route {
  const value = decodeRef(rawHash.replace(/^#/, ''));
  if (value === '') return { type: 'home' };
  if (value.startsWith('tags/')) return { type: 'tag', tag: value };
  return { type: 'event', ref: value };
}

/** Identity used to decide whether the rendered view has to change. */
export function routeKey(route: Route): string {
  switch (route.type) {
    case 'home':
      return '';
    case 'tag':
      return route.tag;
    case 'event':
      return route.ref;
  }
}

/**
 * The route the current URL asks for.
 *
 * A fragment always wins: it is the explicit deep link, and it is the form
 * every already-published link uses.
 */
export function routeFromLocation(paths?: SeedPaths | null): Route {
  if (typeof window === 'undefined') return { type: 'home' };

  const hash = window.location.hash.substring(1);
  if (hash !== '') return routeFromHash(hash);

  if (paths) {
    const ref = refFromPathname(window.location.pathname, paths);
    if (ref) return { type: 'event', ref };
  }

  return { type: 'home' };
}

export function refFromPathname(pathname: string, paths: SeedPaths): string | null {
  if (!pathname.startsWith(paths.base)) return null;
  const rest = pathname.slice(paths.base.length).replace(/\/+$/, '');
  if (!rest || rest.includes('/')) return null;
  return decodeRef(rest);
}

export function articlePath(slug: string, paths: SeedPaths): string {
  return paths.base + encodeURIComponent(slug) + '/';
}

/**
 * Where a card or a link should point.
 *
 * Articles get their real path once path routing is on; notes and images are
 * not replaceable and have no baked page, so they stay on their immutable
 * event id in the fragment.
 */
export function eventHref(
  event: Pick<EventData, 'kind' | 'id' | 'pubkey' | 'identifier'>,
  opts: { permalinks?: PermalinkMode; relays?: string[]; paths?: SeedPaths | null }
): string {
  if (opts.paths && event.kind === 30023 && isBakeableSlug(event.identifier)) {
    return articlePath(event.identifier, opts.paths);
  }
  return '#' + permalinkHash(event, opts.permalinks ?? 'slug', opts.relays ?? []);
}

/** The site root — where `/app.js` and the homepage live. */
export function homeHref(paths?: SeedPaths | null): string {
  return paths ? paths.root : '#';
}

/**
 * The canonical path for a route, but only when that page exists on disk.
 *
 * Rewriting the address bar to a path that 404s on reload would turn a working
 * shared link into a broken one, so an article that has not been baked yet —
 * published since the last run, or resolved live from a relay — keeps its
 * fragment URL. That fragment is the only URL that works for it.
 */
export function bakedPathFor(route: Route, paths?: SeedPaths | null): string | null {
  if (!paths || route.type !== 'event') return null;
  if (!paths.slugs.includes(route.ref)) return null;
  if (!isBakeableSlug(route.ref)) return null;
  return articlePath(route.ref, paths);
}
