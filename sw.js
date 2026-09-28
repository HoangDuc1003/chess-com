// Offline support. Bump VERSION when shipping changes to app files.
const VERSION = 'v2';
const CORE = `core-${VERSION}`;
const HEAVY = 'heavy-v1'; // engine, fonts, opening data: large and rarely changed

const CORE_FILES = [
  './', 'manifest.webmanifest',
  'app/style.css', 'app/pieces.css', 'app/main.js', 'app/board.js', 'app/bots.js', 'app/engine.js',
  'app/hash.js', 'app/lessons.js', 'app/openings.js', 'app/puzzles.js', 'app/review.js', 'app/sound.js',
  'lib/chess.js', 'fonts/fonts.css', 'icons/icon-192.png', 'icons/favicon-32.png',
];

const HEAVY_FILES = ['data/openings.json', 'data/puzzles.json', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  "fonts/be-vietnam-pro-latin-400-normal.woff2",
  "fonts/be-vietnam-pro-latin-500-normal.woff2",
  "fonts/be-vietnam-pro-latin-600-normal.woff2",
  "fonts/be-vietnam-pro-latin-700-normal.woff2",
  "fonts/be-vietnam-pro-latin-800-normal.woff2",
  "fonts/be-vietnam-pro-latin-ext-400-normal.woff2",
  "fonts/be-vietnam-pro-latin-ext-500-normal.woff2",
  "fonts/be-vietnam-pro-latin-ext-600-normal.woff2",
  "fonts/be-vietnam-pro-latin-ext-700-normal.woff2",
  "fonts/be-vietnam-pro-latin-ext-800-normal.woff2",
  "fonts/be-vietnam-pro-vietnamese-400-normal.woff2",
  "fonts/be-vietnam-pro-vietnamese-500-normal.woff2",
  "fonts/be-vietnam-pro-vietnamese-600-normal.woff2",
  "fonts/be-vietnam-pro-vietnamese-700-normal.woff2",
  "fonts/be-vietnam-pro-vietnamese-800-normal.woff2"];

self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([
    caches.open(CORE).then((c) => c.addAll(CORE_FILES)),
    caches.open(HEAVY).then((c) => c.addAll(HEAVY_FILES)),
  ]).then(() => self.skipWaiting()));
});

// The page asks for the engine build it actually uses (single or multi-threaded), so only that one is stored.
self.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.type !== 'warm' || !Array.isArray(d.urls)) return;
  e.waitUntil(caches.open(HEAVY).then(async (c) => {
    for (const u of d.urls) {
      const clean = new URL(u); clean.hash = '';
      if (clean.origin !== self.location.origin || await c.match(clean.href)) continue;
      try { const r = await fetch(clean.href); if (r.ok) await c.put(clean.href, r); } catch {}
    }
  }));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CORE && k !== HEAVY).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cleanCopy(res) {
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
const isHeavy = (url) => /\/(engine|fonts|data|icons)\//.test(url.pathname);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network first so a new deploy shows up, cached copy when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CORE).then((c) => c.put('./', copy)); return res; })
        .catch(() => caches.match('./')),
    );
    return;
  }

  // Engine, fonts, data: cache first (they are big and do not change between deploys).
  if (isHeavy(url)) {
    e.respondWith((async () => {
      let res = await caches.match(req);
      if (!res) {
        res = await fetch(req);
        if (res.ok) { const copy = res.clone(); caches.open(HEAVY).then((c) => c.put(url.origin + url.pathname, copy)); }
      }
      // A worker takes its location from the response URL. A cached copy can carry the URL of a
      // helper-thread request ("…#…,worker"), which would start the main engine in the wrong role.
      return /\/engine\/[^/]+\.js$/.test(url.pathname) ? cleanCopy(res) : res;
    })());
    return;
  }

  // App code: serve from cache right away, refresh the cache in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CORE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
