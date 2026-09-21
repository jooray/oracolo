<script lang="ts">
  import { onMount } from 'svelte';
  import { type SiteConfig } from './config';
  import { documentTitle } from './stores/documentTitleStore';
  import {
    getEventData,
    processAll,
    formatDate,
    getProfile,
    resolvePermalink,
    type EventData,
    type ResolvedTarget
  } from './utils';
  import { pool } from '@nostr/gadgets/global';
  import { neventEncode, naddrEncode } from '@nostr/tools/nip19';
  import { type NostrUser } from '@nostr/gadgets/metadata';
  import { getCache } from './cache';
  import { type NostrEvent } from '@nostr/tools/core';
  import type { Seed } from './seed';
  import { homeHref } from './router';

  let replyRelays: string[];
  let note: EventData;
  let renderedContent = '';
  let nevent = '';
  // Anchor used for the external "Note:" link and for the comments widget.
  // For addressable articles this is the naddr (stable across edits) so that
  // comments stay attached to the article, not to a single version's id.
  let anchor = '';
  let comments = false;

  export let id: string;
  export let profile: NostrUser | null;
  export let config: SiteConfig;
  export let seed: Seed | null = null;

  $: if (typeof document !== 'undefined') {
    documentTitle.subscribe((value) => {
      document.title = value;
    });
  }

  // The hash may be a permanent article slug (`d` tag), an naddr/nevent/note
  // code, or a raw event id. Resolve it into either a concrete event id
  // (notes, images, legacy links) or an addressable coordinate
  // (kind:pubkey:d) that always points at the *latest* version of an article.
  const target: ResolvedTarget | null = profile ? resolvePermalink(id, profile.pubkey) : null;

  // Set the external anchor up front so the header link is valid during load.
  if (target) anchor = nevent = anchorForTarget(target);

  // A prerendered article page carries both its event and its rendered body,
  // so the whole view is built during init — server-side there is no onMount,
  // and client-side this is the markup hydration claims.
  let seeded = false;
  if (seed && target) {
    const match = pickLatest(seed.events, target);
    const pre = match && seed.rendered?.[getEventData(match).replKey];
    if (match && pre !== undefined) {
      applyEventSync(match, pre);
      seeded = true;
    }
  }

  function anchorForTarget(t: ResolvedTarget): string {
    return t.type === 'id'
      ? neventEncode({ id: t.id })
      : naddrEncode({
          identifier: t.identifier,
          pubkey: t.pubkey,
          kind: t.kind,
          relays: config.writeRelays.slice(0, 2)
        });
  }

  function matchesTarget(e: NostrEvent, t: ResolvedTarget): boolean {
    return t.type === 'id'
      ? e.id === t.id
      : e.kind === t.kind &&
          e.pubkey === t.pubkey &&
          (e.tags.find(([k]) => k === 'd')?.[1] || '') === t.identifier;
  }

  function pickLatest(events: NostrEvent[], t: ResolvedTarget): NostrEvent | undefined {
    return events.filter((e) => matchesTarget(e, t)).sort((a, b) => b.created_at - a.created_at)[0];
  }

  /** Render an event whose body has already been processed. */
  function applyEventSync(event: NostrEvent, rendered: string) {
    note = getEventData(event);
    renderedContent = rendered;
    anchor = nevent = anchorForEvent(event);
  }

  function anchorForEvent(event: NostrEvent): string {
    const data = getEventData(event);
    if (target?.type === 'addr' && data.identifier) {
      return naddrEncode({
        identifier: data.identifier,
        pubkey: data.pubkey,
        kind: data.kind,
        relays: config.writeRelays.slice(0, 2)
      });
    }
    return neventEncode({ id: event.id });
  }

  onMount(async () => {
    if (!profile || !target) {
      throw new Error('invalid npub');
    }

    replyRelays = config.readRelays;
    comments = config.comments;

    if (comments) {
      try {
        await import('zapthreads');
      } catch (err) {
        console.warn('failed to load the comments widget', err);
      }
    }

    const applyEvent = async (event: NostrEvent) => {
      // Keep only the newest version of an addressable event.
      if (note && event.created_at <= note.created_at) return;
      note = getEventData(event);
      documentTitle.set(note.title);
      anchor = nevent = anchorForEvent(event);
      renderedContent = await processAll(note);
    };

    if (seeded) {
      documentTitle.set(note.title);
      // The bake is a snapshot; if the article was edited since, the newer
      // version replaces it in place.
      refreshFromRelays(applyEvent);
      return;
    }

    if (!seed) {
      profile = await getProfile(config.npub);
      if (!profile) {
        throw new Error('npub is invalid');
      }
    }

    // Cache-first: navigating from the home grid → article view should be
    // instant since the event is almost always already in the seed or the
    // cache file (memoized in-process, so no second network roundtrip after
    // Blog.svelte populated it). Fall back to a relay subscription only if
    // neither has this target.
    const seedHit = seed ? pickLatest(seed.events, target) : undefined;
    if (seedHit) {
      await applyEvent(seedHit);
      return;
    }

    // With a seed in the page the cache file adds nothing: both come from the
    // same run and hold the same events. (It would also resolve relative to
    // the article's own path, which is not where it lives.)
    let renderedFromCache = false;
    if (config.cacheUrl && !seed) {
      try {
        const cache = await getCache(config.cacheUrl);
        const cached = cache ? pickLatest(cache.events, target) : undefined;
        if (cached) {
          await applyEvent(cached);
          renderedFromCache = true;
        }
      } catch (err) {
        console.warn('cache lookup failed', err);
      }
    }

    if (renderedFromCache) return;

    refreshFromRelays(applyEvent);
  });

  function refreshFromRelays(applyEvent: (event: NostrEvent) => Promise<void>) {
    if (!target) return;
    const filter =
      target.type === 'id'
        ? { ids: [target.id] }
        : { kinds: [target.kind], authors: [target.pubkey], '#d': [target.identifier] };

    pool.subscribeManyEose(config.writeRelays, [filter], {
      onevent: applyEvent,
      onclose() {}
    });
  }

  $: renderedHtml = renderedContent;
</script>

<div class="header note">
  <div class="external-link">
    Note: <a href="https://njump.me/{nevent}"
      >{nevent.substring(0, 12) + '...' + nevent.slice(-5)}</a
    >
  </div>
  <!-- svelte-ignore a11y-invalid-attribute -->
  <a href={homeHref(seed?.paths)}>
    <div class="picture-container">
      <!-- svelte-ignore a11y-missing-attribute -->
      <img src={profile?.image} />
    </div>
    <span>{profile?.shortName} homepage</span>
  </a>
</div>

{#if note && Object.keys(note).length > 0}
  <div class="event-wrapper">
    <div class="date">{formatDate(note.created_at, true)}</div>
    <h1>{note.title}</h1>
    {#if note.image}
      <!-- svelte-ignore a11y-missing-attribute -->
      <img class={note.image ? 'note-image' : 'note-banner'} src={note.image} />
    {/if}
    <div class="content">
      {@html renderedHtml}
    </div>
  </div>
  {#if comments}
    <zap-threads {anchor} relays={replyRelays.join(',')} />
  {/if}
{:else}
  <!-- <Loading /> Temorary disabled, it creates scrolling issue -->
{/if}
