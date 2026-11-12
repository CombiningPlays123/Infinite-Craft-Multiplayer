/* injector.js - the console snippet, readable form. `tools/build.mjs` minifies this into the one-liner
   that goes in the docs/website, substituting the real hosted URL for __CLIENT_URL__.
   What it does, and ONLY this: load the multiplayer client (a single script you can read at that URL)
   into the Infinite Craft tab, once. */
(function () {
  var URL_ = '__CLIENT_URL__';
  if (window.__ICMP__) { try { window.__ICMP__.show(); } catch (e) {} console.info('[ICMP] already installed'); return; }
  if (!/(^|\.)neal\.fun$/.test(location.hostname) || location.pathname.indexOf('/infinite-craft') !== 0) {
    alert('Open https://neal.fun/infinite-craft/ first, then run this snippet in that tab.'); return;
  }
  var s = document.createElement('script');
  s.src = URL_ + (URL_.indexOf('?') < 0 ? '?t=' : '&t=') + Date.now();
  s.onerror = function () {
    // Script tags blocked? Try fetch + evaluate (only the same URL; nothing else is run).
    fetch(URL_).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (code) { (0, eval)(code); })
      .catch(function (e) { alert('Could not load Infinite Craft Multiplayer (' + e + '). The network may block ' + URL_ + ' - see docs/INSTALLATION.md.'); });
  };
  document.head.appendChild(s);
})();
