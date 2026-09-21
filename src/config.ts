import { decode } from '@nostr/tools/nip19';
import { loadRelayList } from '@nostr/gadgets/lists';
import { domMetaSource, type MetaSource } from './meta';

export type SiteConfig = {
  npub: string;
  readRelays: string[];
  writeRelays: string[];
  topics: string[];
  comments: boolean;
  blocks: Block[];
  pageLanguage: string;
  defaultTag: string;
  autoRedirectUrl: string;
  menuItems: { label: string; url: string }[];
  menuLang: { label: string; url: string } | null;
  promoImage: string;
  promoUrl: string;
  promoText: string;
  cacheUrl: string;
  articleImageFit: 'cover' | 'contain' | '';
  bio: string;
  permalinks: 'slug' | 'naddr' | 'id';
  /** Absolute site origin, needed for canonical/OG/sitemap URLs when prerendering. */
  siteUrl: string;
  /** Where the site is mounted, e.g. "/". */
  sitePath: string;
  /** Path prefix for baked article pages, e.g. "/a/". */
  articleBase: string;
};

export type Block = {
  type: 'articles' | 'notes' | 'images';
  config: Config;
};

export interface Config {
  count: number;
  style: 'grid' | 'list' | 'slide' | 'board' | 'wall';
  minChars: number;
  ids?: string[];
}

/**
 * Parse the site config out of its <meta> tags.
 *
 * Synchronous and DOM-free, so the prerenderer can run the exact same parse
 * over an HTML string that the browser runs over `document`. The one piece
 * that may need the network — discovering relays from the author's relay list
 * when no `relays` meta is set — is reported back through `needsRelayList`
 * and resolved by the caller.
 */
export function parseConfig(source: MetaSource): {
  config: SiteConfig;
  needsRelayList: boolean;
} {
  const attr = (name: string) => source.get(name);

  // Author
  // -------------------------------------------------------
  let npub: string;
  const authorValue = attr('author');
  if (authorValue) {
    npub = authorValue;
  } else {
    console.warn('Missing meta tags for configuration, using hodlbod as a fallback');
    npub = 'npub1jlrs53pkdfjnts29kveljul2sm0actt6n8dxrrzqcersttvcuv3qdjynqn';
  }

  // Relays
  // -------------------------------------------------------
  let readRelays: string[] = [];
  let writeRelays: string[] = [];
  const relays = attr('relays')
    ?.split(',')
    .map((url) => url.trim())
    .filter((url) => url !== '');
  const needsRelayList = !(relays && relays.length > 0);
  if (relays && relays.length > 0) {
    readRelays = relays;
    writeRelays = relays;
  }

  // Topics
  // -------------------------------------------------------
  const topics =
    attr('topics')
      ?.split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '') || [];

  // Comments
  const comments = (attr('comments') || 'no') === 'yes' ? true : false;

  // Blocks
  // -------------------------------------------------------
  let blocks: Block[] = [];
  const PREFIX = 'block:';
  source.all().forEach(({ name, content: value }) => {
    if (!name || !name.startsWith(PREFIX)) {
      return;
    }
    const options = value ? value.split('-') : [];

    let config: Config;
    const type = name.substring(PREFIX.length);
    switch (type) {
      case 'articles':
        config = { count: 2, minChars: 10, style: 'grid' };
        break;
      case 'notes':
        config = { count: 10, minChars: 0, style: 'list' };
        break;
      case 'images':
        config = { count: 10, minChars: 0, style: 'grid' };
        break;
      default:
        return;
    }

    if (options.length > 0 && !isNaN(Number(options[0]))) {
      config.count = parseInt(options[0], 10);
      options.shift();
    }
    const styleIndex = options.findIndex((opt) =>
      ['list', 'slide', 'grid', 'board', 'wall'].includes(opt)
    );
    if (styleIndex >= 0) {
      config.style = options[styleIndex] as Config['style'];
      options.splice(styleIndex, 1);
    }
    options.forEach((opt) => {
      if (opt.startsWith('m') && !isNaN(Number(opt.substring(1)))) {
        config.minChars = parseInt(opt.substring(1), 10);
      }
      if (opt.startsWith('i')) {
        config.ids = config.ids || [];
        config.ids.push(opt.substring(1));
      }
    });
    blocks.push({
      type: type as Block['type'],
      config
    });
  });

  // Pinned articles (edit-stable)
  // -------------------------------------------------------
  // A comma-separated list of article `d` tags (or full 64-char event ids),
  // rendered as a grid at the top. Kept separate from the dash-delimited
  // `block:articles` / `i…` syntax because a `d` tag can itself contain
  // dashes, which the block parser would split on. Values are taken verbatim.
  // Pinning by `d` tag survives article edits (the event id changes, the `d`
  // tag does not).
  const pinnedArticles = (attr('pinned-articles') || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (pinnedArticles.length > 0) {
    blocks.unshift({
      type: 'articles',
      config: { count: pinnedArticles.length, style: 'grid', minChars: 0, ids: pinnedArticles }
    });
  }

  // Fallback if no blocks are present
  if (blocks.length == 0) {
    blocks.push({ type: 'articles', config: { count: 3, style: 'grid', minChars: 10 } });
    blocks.push({ type: 'notes', config: { count: 10, style: 'slide', minChars: 400 } });
    blocks.push({ type: 'articles', config: { count: 2, style: 'grid', minChars: 10 } });
    blocks.push({ type: 'images', config: { count: 10, style: 'grid', minChars: 0 } });
    blocks.push({ type: 'articles', config: { count: 10, style: 'list', minChars: 0 } });
    blocks.push({ type: 'articles', config: { count: 2, style: 'grid', minChars: 0 } });
    blocks.push({ type: 'articles', config: { count: 30, style: 'list', minChars: 0 } });
  }

  // Language
  const pageLanguage = attr('page-language') || '';
  const defaultTag = attr('default-tag') || '';
  const autoRedirectUrl = attr('auto-redirect-url') || '';

  // Menu
  const menuRaw = attr('menu') || '';
  const menuItems = menuRaw
    ? menuRaw
        .split(',')
        .map((item) => {
          const [label, url] = item.split('|').map((s) => s.trim());
          return { label: label || '', url: url || '' };
        })
        .filter((item) => item.label && item.url)
    : [];

  const menuLangRaw = attr('menu-lang') || '';
  const menuLang = menuLangRaw
    ? (() => {
        const [label, url] = menuLangRaw.split('|').map((s) => s.trim());
        return label && url ? { label, url } : null;
      })()
    : null;

  // Promo
  const promoImage = attr('promo-image') || '';
  const promoUrl = attr('promo-url') || '';
  const promoText = attr('promo-text') || '';

  // Cache
  const cacheUrl = attr('cache-url') || '';

  // Article cover-image fit: 'cover' (default) or 'contain'.
  // 'contain' is for sites with square cover-art that should not be cropped.
  const articleImageFitRaw = (attr('article-image-fit') || '').trim().toLowerCase();
  const articleImageFit: 'cover' | 'contain' | '' =
    articleImageFitRaw === 'cover' || articleImageFitRaw === 'contain' ? articleImageFitRaw : '';

  // Optional override for the homepage bio. If empty, the bio is taken
  // from the author's kind-0 metadata (`about` field) at render time.
  const bio = attr('bio') || '';

  // How to build article links. Long-form posts (kind 30023) are replaceable:
  // their event id changes on every edit, so linking by id breaks bookmarks
  // after an edit. Default to the permanent `d`-tag slug so links survive
  // edits. 'naddr' uses the self-contained NIP-19 code; 'id' restores the
  // legacy (edit-fragile) event-id behaviour.
  const permalinksRaw = (attr('permalinks') || '').trim().toLowerCase();
  const permalinks: 'slug' | 'naddr' | 'id' =
    permalinksRaw === 'naddr' || permalinksRaw === 'id' ? permalinksRaw : 'slug';

  // Prerendering only: where the site lives, so canonical/OG/sitemap URLs and
  // baked article paths can be built.
  const siteUrl = (attr('site-url') || '').trim().replace(/\/+$/, '');
  const sitePath = withSlashes(attr('site-path') || '/');
  const articleBase = withSlashes(attr('article-base') || sitePath + 'a/');

  return {
    config: {
      npub,
      readRelays,
      writeRelays,
      topics,
      comments,
      blocks,
      pageLanguage,
      defaultTag,
      autoRedirectUrl,
      menuItems,
      menuLang,
      promoImage,
      promoUrl,
      promoText,
      cacheUrl,
      articleImageFit,
      bio,
      permalinks,
      siteUrl,
      sitePath,
      articleBase
    },
    needsRelayList
  };
}

function withSlashes(value: string): string {
  let v = value.trim() || '/';
  if (!v.startsWith('/')) v = '/' + v;
  if (!v.endsWith('/')) v = v + '/';
  return v;
}

/**
 * Browser entry point: parse `document`, and fall back to the author's relay
 * list when the site does not pin its relays in a <meta> tag.
 */
export async function getConfig(): Promise<SiteConfig> {
  const { config, needsRelayList } = parseConfig(domMetaSource());
  if (needsRelayList) {
    const rl = (await loadRelayList(decode(config.npub).data as string)).items;
    config.writeRelays = rl
      .filter((r) => r.write)
      .map((r) => r.url)
      .slice(0, 5);
    config.readRelays = rl.filter((r) => r.read).map((r) => r.url);
  }
  return config;
}
