#!/usr/bin/env node

import esbuild from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import { sveltePreprocess } from 'svelte-preprocess';
import { sassPlugin } from 'esbuild-sass-plugin';
import fs from 'fs';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

const prod = process.argv.indexOf('prod') !== -1;
const watch = process.argv.indexOf('watch') !== -1;

// Create CSS extractor plugin with a unique identifier for each build
const createCssExtractorPlugin = () => ({
  name: 'css-extractor',
  setup(build) {
    // Store CSS content for this specific build
    let cssContent = '';

    // Capture CSS content during the build
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = await fs.promises.readFile(args.path, 'utf8');
      cssContent += css + '\n';
      return { contents: '' };
    });

    // Write the CSS file after the build completes
    build.onEnd(async () => {
      if (cssContent) {
        const outDir = path.dirname(build.initialOptions.outfile);
        const baseName = path.basename(build.initialOptions.outfile, '.js');
        const cssPath = path.join(outDir, `${baseName}.css`);
        await fs.promises.writeFile(cssPath, cssContent);
        // Reset the CSS content
        cssContent = '';
      }
    });
  }
});

const baseOptions = {
  mainFields: ['svelte', 'browser', 'module', 'main'],
  conditions: ['svelte', 'browser'],
  bundle: true,
  format: 'iife',
  loader: {
    '.jpg': 'copy',
    '.png': 'copy',
    '.svg': 'copy',
    '.gif': 'copy'
  },
  assetNames: 'images/[name]',
  plugins: [
    sveltePlugin({
      preprocess: sveltePreprocess(),
      emitCss: true,
      // Prerendered pages hand the browser finished markup; hydratable output
      // lets Svelte claim those nodes instead of rebuilding them.
      compilerOptions: { hydratable: true }
    }),
    sassPlugin()
    // CSS extractor will be added separately to each build
  ],
  logLevel: 'info',
  minify: prod,
  sourcemap: prod ? false : 'inline'
};

// Main app build
const mainOptions = {
  ...baseOptions,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/out.js',
  plugins: [...baseOptions.plugins, createCssExtractorPlugin()]
};

// Server-side render build, used by scripts/prerender.js.
//
// Two things in the client graph cannot survive `import` in Node: stylesheets
// (there is no CSS loader for a .mjs output) and @nostr/gadgets/metadata,
// which opens an IndexedDB store at module scope. Both are swapped out here.
const ssrStubPlugin = {
  name: 'ssr-stubs',
  setup(build) {
    build.onResolve({ filter: /^@nostr\/gadgets\/metadata$/ }, () => ({
      path: path.resolve('src/ssr/metadata.ts')
    }));
    build.onLoad({ filter: /\.(css|scss|sass)$/ }, () => ({ contents: '', loader: 'js' }));
  }
};

const ssrOptions = {
  entryPoints: ['src/ssr.ts'],
  outfile: 'dist/ssr.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  mainFields: ['svelte', 'module', 'main'],
  conditions: ['svelte', 'node', 'import'],
  logLevel: 'info',
  plugins: [
    sveltePlugin({
      preprocess: sveltePreprocess(),
      emitCss: false,
      compilerOptions: { generate: 'ssr', hydratable: true }
    }),
    ssrStubPlugin
  ]
};

// Homepage build
const homepageOptions = {
  ...baseOptions,
  entryPoints: ['src/homepage.ts'],
  outfile: 'dist/homepage.js',
  plugins: [...baseOptions.plugins, createCssExtractorPlugin()]
};

if (watch) {
  let mainCtx = await esbuild.context(mainOptions);
  let homeCtx = await esbuild.context(homepageOptions);
  await Promise.all([mainCtx.watch(), homeCtx.watch()]);
  await mainCtx.serve({
    host: 'localhost',
    port: 45071
  });
} else {
  await Promise.all([
    esbuild.build(mainOptions),
    esbuild.build(homepageOptions),
    esbuild.build(ssrOptions)
  ]);
  console.log('built.');
}
