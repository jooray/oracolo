#!/usr/bin/env node

/**
 * Oracolo CLI Bundler
 *
 * Takes an Oracolo HTML file (with meta tags for configuration) and produces
 * a self-contained single-file HTML with JS and CSS inlined.
 *
 * This replicates the Go server's ?bundled=1 functionality for offline use.
 *
 * Usage: node scripts/bundle.js <input.html> [output.html]
 *
 * If output is omitted, writes to stdout.
 * The script expects dist/out.js and dist/out.css to exist (run build first).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath) {
  console.error('Usage: node scripts/bundle.js <input.html> [output.html]');
  process.exit(1);
}

// Read built assets
const jsPath = resolve(projectRoot, 'dist/out.js');
const cssPath = resolve(projectRoot, 'dist/out.css');

if (!existsSync(jsPath) || !existsSync(cssPath)) {
  console.error('dist/out.js and dist/out.css not found. Run the build first:');
  console.error('  node build.js prod');
  process.exit(1);
}

const jsContent = readFileSync(jsPath, 'utf-8');
const cssContent = readFileSync(cssPath, 'utf-8');

// Read input HTML and extract meta tags
const inputHtml = readFileSync(inputPath, 'utf-8');

// Extract all <meta> tags from the <head>
const headMatch = inputHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
if (!headMatch) {
  console.error('No <head> section found in input HTML');
  process.exit(1);
}

// Drop HTML comments before parsing, so commenting a block out actually
// disables it. Without this, a commented-out <script> or <meta> is still
// picked up by the regexes below and silently shipped in the bundle — which
// matters for seasonal markup like a ticket popup that gets switched off
// between events.
const headContent = headMatch[1].replace(/<!--[\s\S]*?-->/g, '');

// Extract meta tags (both name/content and name/value attributes)
const metaTags = [];
const metaRegex = /<meta\s+([^>]*?)\/?\s*>/gi;
let match;
while ((match = metaRegex.exec(headContent)) !== null) {
  const attrs = match[1];

  // Skip standard meta tags (charset, viewport)
  if (/charset/i.test(attrs) || /viewport/i.test(attrs)) continue;

  // Match the actual opening quote (\1 backreference) so the value can
  // contain the *other* quote character — e.g. an apostrophe inside a
  // double-quoted bio.
  const nameMatch = attrs.match(/name\s*=\s*(["'])([\s\S]*?)\1/i);
  const contentMatch = attrs.match(/content\s*=\s*(["'])([\s\S]*?)\1/i) ||
                       attrs.match(/value\s*=\s*(["'])([\s\S]*?)\1/i);
  const propertyMatch = attrs.match(/property\s*=\s*(["'])([\s\S]*?)\1/i);

  if (nameMatch && contentMatch) {
    metaTags.push({ type: 'name', key: nameMatch[2], value: contentMatch[2] });
  } else if (propertyMatch && contentMatch) {
    metaTags.push({ type: 'property', key: propertyMatch[2], value: contentMatch[2] });
  }
}

// Escape a string for safe inclusion in a double-quoted HTML attribute.
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Extract html lang attribute
const langMatch = inputHtml.match(/<html[^>]*lang\s*=\s*["']([^"']*)["']/i);
const lang = langMatch ? langMatch[1] : 'en';

// Extract title
const titleMatch = inputHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
const title = titleMatch ? titleMatch[1].trim() : '';

// Extract any extra scripts from <head> that aren't module/src references
// (e.g., auto-redirect scripts added by the user)
const headScripts = [];
const scriptRegex = /<script(?![^>]*(?:src|type\s*=\s*["']module["']))[^>]*>([\s\S]*?)<\/script>/gi;
let scriptMatch;
while ((scriptMatch = scriptRegex.exec(headContent)) !== null) {
  const content = scriptMatch[1].trim();
  if (content) {
    headScripts.push(content);
  }
}

// Extract per-site CSS from <head>: inline <style> blocks and local
// <link rel="stylesheet"> files, in the order they were authored.
//
// The CSS is written next to the <meta> config — the natural place for it —
// but it is emitted at the *end of the body*, after Oracolo's own bundled
// stylesheet, so a site override actually wins the cascade without having to
// shout `!important` at every rule. Linked files are inlined so the bundle
// stays a single self-contained file.
const siteStyles = [];
const styleOrLinkRegex = /<style[^>]*>([\s\S]*?)<\/style>|<link\s+([^>]*?)\/?>/gi;
let cssMatch;
while ((cssMatch = styleOrLinkRegex.exec(headContent)) !== null) {
  if (cssMatch[1] !== undefined) {
    const inlineCss = cssMatch[1].trim();
    if (inlineCss) siteStyles.push({ source: 'inline <style>', css: inlineCss });
    continue;
  }

  const attrs = cssMatch[2] || '';
  if (!/rel\s*=\s*(["'])\s*stylesheet\s*\1/i.test(attrs)) continue;

  const hrefMatch = attrs.match(/href\s*=\s*(["'])([\s\S]*?)\1/i);
  if (!hrefMatch) continue;
  const href = hrefMatch[2].trim();

  if (/^(?:[a-z]+:)?\/\//i.test(href) || /^data:/i.test(href)) {
    console.error(
      `Refusing to bundle remote stylesheet "${href}": the output must stay ` +
        `self-contained. Save it next to the source and link it relatively.`
    );
    process.exit(1);
  }

  const cssFile = resolve(dirname(resolve(inputPath)), href);
  if (!existsSync(cssFile)) {
    console.error(`Linked stylesheet not found: ${href} (resolved to ${cssFile})`);
    process.exit(1);
  }
  siteStyles.push({ source: href, css: readFileSync(cssFile, 'utf-8').trim() });
}

// Build the bundled HTML — matching the Go server's renderModifiedBundled() output
let output = `<!doctype html>
<html lang="${lang}">
  <head>
`;

// Write meta tags
for (const meta of metaTags) {
  const key = escapeAttr(meta.key);
  const value = escapeAttr(meta.value);
  if (meta.type === 'property') {
    output += `    <meta property="${key}" content="${value}">\n`;
  } else {
    output += `    <meta name="${key}" content="${value}">\n`;
  }
}

output += `
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
`;

// Include any head scripts (auto-redirect, etc.)
for (const script of headScripts) {
  output += `    <script>\n${script}\n    </script>\n`;
}

output += `  </head>
  <body>
    <div id="app"></div>
    <script>
      window.wnjParams = {
        position: 'bottom',
        accent: 'neutral',
        startHidden: true,
        compactMode: true,
      };
    </script>
    <script>
      (function () {
        function getMetaTheme() {
          var meta = document.querySelector('meta[name="force-theme"]');
          if (!meta) return null;
          var value = (meta.getAttribute('content') || '').toLowerCase();
          if (value === 'dark' || value === 'light') return value;
          return null;
        }
        function isDarkTheme() {
          if (localStorage.getItem('theme') === 'dark') return true;
          if (localStorage.getItem('theme') === 'light') return false;
          var metaTheme = getMetaTheme();
          if (metaTheme) return metaTheme === 'dark';
          var darkSetting = window.matchMedia('(prefers-color-scheme: dark)').matches;
          localStorage.setItem('systemTheme', darkSetting ? 'dark' : 'light');
          return darkSetting;
        }
        if (isDarkTheme()) {
          document.documentElement.classList.add('dark');
        }
      })();
    </script>
    <script>
${jsContent}
    </script>
    <style>
${cssContent}
    </style>
`;

// Site CSS last, so it overrides Oracolo's own styles by cascade order.
for (const style of siteStyles) {
  output += `    <!-- site stylesheet: ${style.source} -->\n    <style>\n${style.css}\n    </style>\n`;
}

output += `  </body>
</html>
`;

if (outputPath) {
  writeFileSync(outputPath, output);
  const sizeKB = (Buffer.byteLength(output) / 1024).toFixed(1);
  console.log(`Bundled ${inputPath} → ${outputPath} (${sizeKB} KB)`);
} else {
  process.stdout.write(output);
}
