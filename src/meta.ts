// Isomorphic access to the site's <meta> configuration.
//
// The config lives in <meta> tags, which the browser reads off `document`
// and the prerenderer reads out of an HTML string. Both call sites want the
// exact same parse (see config.ts), so the *source* of the tags is abstracted
// here and the parsing stays in one place.

export interface MetaSource {
  get(name: string): string | null;
  /** Every meta tag, in document order — needed for the `block:*` family. */
  all(): { name: string; content: string }[];
}

/** Reads <meta> tags from a live DOM. */
export function domMetaSource(doc: Document = document): MetaSource {
  return {
    get(name) {
      const el = doc.querySelector(`meta[name="${name}"]`);
      return el?.getAttribute('content') ?? null;
    },
    all() {
      const out: { name: string; content: string }[] = [];
      doc.querySelectorAll('meta').forEach((meta) => {
        const name = meta.getAttribute('name');
        if (name) out.push({ name, content: meta.getAttribute('content') || '' });
      });
      return out;
    }
  };
}

/**
 * Reads <meta> tags out of an HTML string, for Node-side rendering.
 *
 * HTML comments are stripped first, so a commented-out block really is
 * disabled — the same rule scripts/bundle.js applies.
 */
export function htmlMetaSource(html: string): MetaSource {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const scope = (headMatch ? headMatch[1] : html).replace(/<!--[\s\S]*?-->/g, '');

  const tags: { name: string; content: string }[] = [];
  const metaRegex = /<meta\s+([^>]*?)\/?\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = metaRegex.exec(scope)) !== null) {
    const attrs = match[1];
    // Match the actual opening quote (\1) so a value may contain the other
    // quote character — e.g. an apostrophe inside a double-quoted bio.
    const nameMatch = attrs.match(/name\s*=\s*(["'])([\s\S]*?)\1/i);
    const contentMatch =
      attrs.match(/content\s*=\s*(["'])([\s\S]*?)\1/i) ||
      attrs.match(/value\s*=\s*(["'])([\s\S]*?)\1/i);
    if (nameMatch && contentMatch) {
      tags.push({ name: nameMatch[2], content: decodeAttr(contentMatch[2]) });
    }
  }

  return {
    get: (name) => tags.find((t) => t.name === name)?.content ?? null,
    all: () => tags
  };
}

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
