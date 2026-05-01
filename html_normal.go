package main

import (
	"fmt"
	"io"
)

var start = []byte(`<!doctype html>
<html lang="en">
  <head>
`)

var autoRedirectScript = []byte(`
    <script>
      (function () {
        function getMeta(name) {
          var element = document.querySelector('meta[name="' + name + '"]');
          return element ? element.getAttribute('content') || '' : '';
        }
        function langMatches(stored, target) {
          if (!stored || !target) return false;
          return new RegExp('^' + stored + '(?:-|$)', 'i').test(target);
        }
        function parseLang(url) {
          var m = (url || '').match(/[?&]lang=([^&#]+)/);
          return m ? decodeURIComponent(m[1]) : '';
        }
        var STORAGE_KEY = 'oracolo-lang';
        var pageLanguage = getMeta('page-language');
        var redirectUrl = getMeta('auto-redirect-url');
        var menuLangRaw = getMeta('menu-lang');
        var menuLangUrl = menuLangRaw ? (menuLangRaw.split('|')[1] || '').trim() : '';
        var params = new URLSearchParams(window.location.search);
        var explicitLang = params.get('lang');
        var hasHash = !!window.location.hash && window.location.hash !== '#';
        // Persist explicit ?lang=X choice so future visits without it honor the user's selection.
        if (explicitLang) {
          try { localStorage.setItem(STORAGE_KEY, explicitLang); } catch (e) {}
        }
        if (!pageLanguage || explicitLang || hasHash) return;

        var stored = null;
        try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) {}
        if (stored) {
          // Stored preference matches this page; stay regardless of browser language.
          if (langMatches(stored, pageLanguage)) return;
          // Stored preference matches an alternate-language URL we know about; honor it.
          var alt = redirectUrl || menuLangUrl;
          if (alt && langMatches(stored, parseLang(alt))) {
            window.location.replace(alt);
            return;
          }
          // Stored value doesn't match either side; fall through to browser detection.
        }

        // Browser-language fallback only fires when auto-redirect-url is set
        // (menu-lang alone is treated as a manual switcher, not an auto-redirect).
        if (!redirectUrl) return;
        var browserLanguages = Array.isArray(window.navigator.languages) && window.navigator.languages.length
          ? window.navigator.languages
          : [window.navigator.language || ''];
        var prefersPageLanguage = browserLanguages.some(function (lang) {
          return langMatches(pageLanguage, lang);
        });
        if (!prefersPageLanguage) {
          window.location.replace(redirectUrl);
        }
      })();
    </script>
`)

var rest = []byte(`
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title></title>
    <link id="css" rel="stylesheet" href="/out.css" />
  </head>
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
    <script id="js" src="/out.js"></script>
`)

var devEsbuild = []byte(`
    <script>
      let es = new EventSource('http://localhost:45071/esbuild')

      es.addEventListener('change', (ev) => {
        let change = JSON.parse(ev.data)
        console.log('reload!', change)

        if (change.added.length || change.removed.length) return

        if (change.updated[0]?.endsWith('.css')) {
          let css = document.getElementById('css')
          let newCSS = document.createElement('link')
          newCSS.id = 'css'
          newCSS.rel = 'stylesheet'
          newCSS.href = 'http://localhost:45071' + change.updated[0] + '?' + Math.random().toString(36).slice(2)
          newCSS.onload = () => css.remove()
          css.parentNode.appendChild(newCSS)
        } else if (change.updated[0]?.endsWith('.js')) {
          let js = document.getElementById('js')
          let parent = js.parentNode
          js.remove()

          let newJS = document.createElement('script')
          newJS.id = 'js'
          newJS.src = 'http://localhost:45071' + change.updated[0] + '?' + Math.random().toString(36).slice(2)
          window.destroySvelteApp()
          parent.appendChild(newJS)
        }
      })
    </script>
`)

func renderModified(w io.Writer, params Params) {
	w.Write(start)

	for _, param := range params {
		fmt.Fprintf(w, "    <meta name=\"%s\" content=\"%s\">\n", param[0], param[1])
	}
	writeOGTags(w, params)
	w.Write(autoRedirectScript)
	w.Write(rest)

	if s.Development {
		w.Write(devEsbuild)
	}
}
