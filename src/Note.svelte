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
    type EventData
  } from './utils';
  import { pool } from '@nostr/gadgets/global';
  import { neventEncode, naddrEncode } from '@nostr/tools/nip19';
  import 'zapthreads';
  import { type NostrUser } from '@nostr/gadgets/metadata';
  import { getCache } from './cache';
  import { type NostrEvent } from '@nostr/tools/core';

  let replyRelays: string[];
  let note: EventData;
  let renderedContent = '';
  let nevent = '';
  // Anchor used for the external "Note:" link and for the comments widget.
  // For addressable articles this is the naddr (stable across edits) so that
  // comments stay attached to the article, not to a single version's id.
  let anchor = '';
  let comments = false;

  $: documentTitle.subscribe((value) => {
    document.title = value;
  });

  export let id: string;
  export let profile: NostrUser | null;
  export let config: SiteConfig;

  onMount(async () => {
    if (!profile) {
      throw new Error('invalid npub');
    }

    replyRelays = config.readRelays;

    profile = await getProfile(config.npub);
    if (!profile) {
      throw new Error('npub is invalid');
    }
    comments = config.comments;

    // The hash may be a permanent article slug (`d` tag), an naddr/nevent/note
    // code, or a raw event id. Resolve it into either a concrete event id
    // (notes, images, legacy links) or an addressable coordinate
    // (kind:pubkey:d) that always points at the *latest* version of an article.
    const target = resolvePermalink(id, profile.pubkey);

    // Set the external anchor up front so the header link is valid during load.
    anchor = nevent =
      target.type === 'id'
        ? neventEncode({ id: target.id })
        : naddrEncode({
            identifier: target.identifier,
            pubkey: target.pubkey,
            kind: target.kind,
            relays: config.writeRelays.slice(0, 2)
          });

    const applyEvent = async (event: NostrEvent) => {
      // Keep only the newest version of an addressable event.
      if (note && event.created_at <= note.created_at) return;
      note = getEventData(event);
      documentTitle.set(note.title);
      if (target.type === 'addr' && note.identifier) {
        anchor = naddrEncode({
          identifier: note.identifier,
          pubkey: note.pubkey,
          kind: note.kind,
          relays: config.writeRelays.slice(0, 2)
        });
      } else {
        anchor = neventEncode({ id: event.id });
      }
      nevent = anchor;
      renderedContent = await processAll(note);
    };

    const matchesTarget = (e: NostrEvent): boolean =>
      target.type === 'id'
        ? e.id === target.id
        : e.kind === target.kind &&
          e.pubkey === target.pubkey &&
          (e.tags.find(([k]) => k === 'd')?.[1] || '') === target.identifier;

    // Cache-first: navigating from the home grid → article view should be
    // instant since the event is almost always already in the cache file
    // (memoized in-process, so no second network roundtrip after Blog.svelte
    // populated it). Fall back to a relay subscription only if the cache
    // doesn't have this target.
    let renderedFromCache = false;
    if (config.cacheUrl) {
      try {
        const cache = await getCache(config.cacheUrl);
        const cached = cache?.events
          .filter(matchesTarget)
          .sort((a, b) => b.created_at - a.created_at)[0];
        if (cached) {
          await applyEvent(cached);
          renderedFromCache = true;
        }
      } catch (err) {
        console.warn('cache lookup failed', err);
      }
    }

    if (renderedFromCache) return;

    const filter =
      target.type === 'id'
        ? { ids: [target.id] }
        : { kinds: [target.kind], authors: [target.pubkey], '#d': [target.identifier] };

    pool.subscribeManyEose(config.writeRelays, [filter], {
      onevent: applyEvent,
      onclose() {}
    });
  });

  $: renderedHtml = renderedContent;
</script>

<div class="header note">
  <div class="external-link">
    Note: <a href="https://njump.me/{nevent}"
      >{nevent.substring(0, 12) + '...' + nevent.slice(-5)}</a
    >
  </div>
  <!-- svelte-ignore a11y-invalid-attribute -->
  <a href="#">
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
    <zap-threads anchor={anchor} relays={replyRelays.join(',')} />
  {/if}
{:else}
  <!-- <Loading /> Temorary disabled, it creates scrolling issue -->
{/if}
