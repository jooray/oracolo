<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { nostrUserFromEvent, type NostrUser } from '@nostr/gadgets/metadata';

  import { getConfig, parseConfig, type SiteConfig } from './config';
  import { domMetaSource } from './meta';
  import { getProfile, downloadHtmlApp, setLocale, preferDisplayName } from './utils';
  import { getCache } from './cache';
  import type { Seed } from './seed';
  import { bakedPathFor, refFromPathname, routeFromLocation, routeKey, type Route } from './router';
  import Home from './Blog.svelte';
  import Note from './Note.svelte';
  import ThemeSwitch from './ThemeSwitch.svelte';
  import TopMenu from './TopMenu.svelte';
  import PromoPopup from './PromoPopup.svelte';

  /** Inline events from a prerendered page; null on a classic (fetch) boot. */
  export let seed: Seed | null = null;
  /** Config handed in by the prerenderer, which has no `document` to read. */
  export let ssrConfig: SiteConfig | null = null;

  let profile: NostrUser | null = null;
  let missingConfig = false;
  let name = '';
  let picture: string | null = null;
  let route: Route = { type: 'home' };

  // A prerendered page boots synchronously: the config comes from the same
  // <meta> parse the prerenderer ran, and the profile from the kind-0 event in
  // the seed. This has to happen during init rather than in onMount, because
  // hydration reuses the baked DOM and the first client render has to match it.
  const seededConfig: SiteConfig | null =
    ssrConfig ??
    (seed && typeof document !== 'undefined' ? parseConfig(domMetaSource()).config : null);

  let config: SiteConfig = seededConfig as SiteConfig;

  if (seed && seededConfig) {
    route = seed.route;
    if (seededConfig.pageLanguage) setLocale(seededConfig.pageLanguage);
    const k0 = seed.events.find((e) => e.kind === 0);
    if (k0) {
      profile = preferDisplayName(nostrUserFromEvent(k0));
      name = profile.metadata.name || profile.shortName;
      picture = profile.image || null;
    }
  }

  $: relays = config ? Array.from(new Set(config.readRelays.concat(config.writeRelays))) : [];

  onMount(() => {
    // Check if the URL has a download parameter
    const urlParams = new URLSearchParams(window.location.search);
    const shouldDownload = urlParams.get('download') === 'true';

    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    document.addEventListener('click', interceptLink);

    if (seed && config) {
      // Already rendered from the seed. Point the view at whatever the URL
      // actually asks for (a `#permalink` the server could never see), then
      // catch up with the relays in the background.
      document.documentElement.lang = config.pageLanguage || document.documentElement.lang;
      syncRoute();
      refreshProfile();
      if (shouldDownload) downloadHtmlApp();
      return;
    }

    bootFromNetwork(shouldDownload);
  });

  onDestroy(() => {
    if (typeof window === 'undefined') return;
    window.removeEventListener('hashchange', syncRoute);
    window.removeEventListener('popstate', syncRoute);
    document.removeEventListener('click', interceptLink);
  });

  function syncRoute() {
    const next = routeFromLocation(seed?.paths);
    if (routeKey(next) !== routeKey(route) || next.type !== route.type) {
      route = next;
    }
    upgradeUrl();
    markIndexability();
    // The head script hides the app while a fragment route is resolving, so
    // that a `#permalink` load does not flash the baked homepage first.
    document.documentElement.classList.remove('oracolo-routing');
  }

  /**
   * An article published since the last bake has no page on disk; the server
   * falls back to serving the app shell so the link still works. That shell is
   * not a page a crawler should index under that URL, so say so.
   */
  function markIndexability() {
    if (!seed?.paths) return;
    const onArticlePath = window.location.pathname.startsWith(seed.paths.base);
    const baked = route.type === 'event' && seed.paths.slugs.includes(route.ref);
    const meta =
      document.querySelector<HTMLMetaElement>('meta[name="robots"][data-oracolo]') || null;

    if (onArticlePath && !baked) {
      if (!meta) {
        const el = document.createElement('meta');
        el.setAttribute('name', 'robots');
        el.setAttribute('content', 'noindex');
        el.setAttribute('data-oracolo', '');
        document.head.appendChild(el);
      }
    } else if (meta) {
      meta.remove();
    }
  }

  /**
   * Swap a fragment permalink for the article's real path — but only when that
   * page exists on disk. Rewriting to a path that would 404 on reload turns a
   * working shared link into a broken one, so anything not baked keeps the
   * fragment it arrived with.
   */
  function upgradeUrl() {
    if (!seed?.paths || !window.location.hash) return;
    const path = bakedPathFor(route, seed.paths);
    if (!path || window.location.pathname === path) return;
    history.replaceState(history.state, '', path + window.location.search);
  }

  /** Keep in-app navigation to baked article pages client-side. */
  function interceptLink(event: MouseEvent) {
    if (!seed?.paths) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = (event.target as Element | null)?.closest?.('a');
    if (!anchor || anchor.target || anchor.hasAttribute('download')) return;

    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;

    const ref = refFromPathname(url.pathname, seed.paths);
    if (!ref) return;

    event.preventDefault();
    if (url.pathname !== window.location.pathname) {
      history.pushState({}, '', url.pathname + url.search);
    }
    route = { type: 'event', ref };
    markIndexability();
    window.scrollTo(0, 0);
  }

  async function refreshProfile() {
    try {
      const fresh = await getProfile(config.npub);
      // A metadata lookup that finds nothing still resolves — with a
      // placeholder carrying an empty metadata object and a truncated npub for
      // a name. Taking that over the kind-0 event we already have would wipe
      // the name, avatar and bio off a page that was rendering them correctly.
      if (fresh && Object.keys(fresh.metadata || {}).length > 0) {
        profile = fresh;
        name = fresh.metadata.name || fresh.shortName;
        picture = fresh.image || null;
      }
    } catch {
      // keep the profile we already have
    }
  }

  function bootFromNetwork(shouldDownload: boolean) {
    getConfig()
      .then(async (configOrUndefined) => {
        // Early return if config is undefined
        if (!configOrUndefined) {
          missingConfig = true;
          return;
        } else {
          config = configOrUndefined;
        }

        // Set locale for date formatting
        if (configOrUndefined.pageLanguage) {
          setLocale(configOrUndefined.pageLanguage);
          document.documentElement.lang = configOrUndefined.pageLanguage;
        }

        // Destructure with default values to satisfy TypeScript
        const { npub = '', comments = false } = configOrUndefined;

        // Validate config
        if (!npub) {
          missingConfig = true;
          return;
        }

        if (comments) {
          try {
            await import('window.nostr.js');
            console.log('window.nostr.js has been successfully loaded');
          } catch (error) {
            console.error('Failed to load window.nostr.js:', error);
          }
        }

        syncRoute();

        // Cache-first profile: a kind-0 event is included in
        // events-cache.json; constructing the NostrUser from it lets the
        // header render immediately without waiting on a relay.
        if (configOrUndefined.cacheUrl) {
          try {
            const cache = await getCache(configOrUndefined.cacheUrl);
            const k0 = cache?.events.find((e) => e.kind === 0);
            if (k0) {
              profile = preferDisplayName(nostrUserFromEvent(k0));
              name = profile.metadata.name || profile.shortName;
              picture = profile.image || null;
            }
          } catch (err) {
            console.warn('cache profile load failed', err);
          }
        }

        if (!profile) {
          profile = await getProfile(npub);
          if (profile) {
            name = profile.metadata.name || profile.shortName;
            picture = profile.image || null;
          } else {
            missingConfig = true;
            return;
          }
        } else {
          // Background refresh in case the cached profile is stale.
          refreshProfile();
        }

        if (shouldDownload) {
          downloadHtmlApp();
        }
      })
      .catch((error) => {
        console.error('Error fetching config:', error);
        missingConfig = true;
        return;
      });
  }
</script>

{#if config}
  <TopMenu menuItems={config.menuItems} menuLang={config.menuLang} />
  {#if config.promoUrl}
    <PromoPopup
      promoImage={config.promoImage}
      promoUrl={config.promoUrl}
      promoText={config.promoText}
    />
  {/if}
{/if}

{#if missingConfig}
  <div class="unfinished-setup">
    <h1>Oracolo</h1>
    <h2>Missing config!</h2>
    <p>
      You need to <a href="https://github.com/dtonon/oracolo?tab=readme-ov-file#configuration"
        >configure your blog</a
      >
      adding some meta tags inside this HTML file.<br /><br />
      Are you lazy? Use the handy web wizard at <a href="https://oracolo.me">oracolo.me</a>.
    </p>
  </div>
{/if}

{#if profile && Object.keys(profile).length > 0}
  {#key routeKey(route)}
    {#if route.type === 'home'}
      <Home tag="" {profile} {config} {seed} />
    {:else if route.type === 'tag'}
      <Home tag={route.tag} {profile} {config} {seed} />
    {:else}
      <Note id={route.ref} {profile} {config} {seed} />
    {/if}
  {/key}
{/if}

<div class="footer">
  This blog is powered by <a href="https://github.com/dtonon/oracolo">Oracolo</a> and Nostr.
  <a href="https://oracolo.me">Make your own</a>.<br /><br />

  {#if !missingConfig}
    Would you like to host this website yourself? It's just one HTML file,
    <button on:click={() => downloadHtmlApp()} class="link-button">download it</button>.<br /><br />

    {#if relays.length > 0}
      This page connects to some servers (Nostr relays) to retrieve data: {relays.join(', ')}
    {/if}
  {/if}
</div>

<ThemeSwitch />
