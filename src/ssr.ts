// Server-side rendering entry point.
//
// The prerenderer renders the *same* components the browser runs, so there is
// only ever one implementation of the markup. Everything async — relay
// queries, profile lookups, markdown processing — has to be resolved before
// calling renderPage(), because Svelte's SSR render is synchronous.

import App from './App.svelte';
import { parseConfig, type SiteConfig } from './config';
import { htmlMetaSource } from './meta';
import { resetRenderState } from './blockUtils';
import { setLocale } from './utils';
import type { Seed } from './seed';

export { parseConfig, htmlMetaSource };
export { serializeSeed, SEED_ELEMENT_ID } from './seed';
export { getEventData, processAll, dedupeReplaceable, replaceableKey, setLocale } from './utils';
export { isBakeableSlug, articlePath } from './router';
export { setMetadataRelays, closePools } from './ssr/metadata';
export type { SiteConfig, Seed };

export function parseConfigFromHtml(html: string) {
  return parseConfig(htmlMetaSource(html));
}

export interface RenderedPage {
  html: string;
  head: string;
  css: string;
}

export function renderPage(opts: { config: SiteConfig; seed: Seed }): RenderedPage {
  // The render stores are module-level singletons — fine in a browser tab,
  // but this process renders every page of the site in a row.
  resetRenderState();

  if (opts.config.pageLanguage) setLocale(opts.config.pageLanguage);

  const { html, head, css } = (App as any).render({
    seed: opts.seed,
    ssrConfig: opts.config
  });

  return { html, head, css: css?.code || '' };
}
