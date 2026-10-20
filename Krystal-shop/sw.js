// Krystal Shop service worker — lets the app open and run with no internet.
//
// Bump CACHE only when the precache list below changes. index.html itself is
// fetched network-first, so normal app updates never need a bump.
// (The 'electropro-v' prefix is relied on by the app's "Check Now" update button.)
const CACHE = 'electropro-v2';

// Must match the <script> URLs in index.html exactly.
const FIREBASE = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js'
];
const LOCAL = ['./index.html', './', './shop-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Firebase SDK is required: without it the app can't start offline, so a
    // failure here fails the install and the browser retries on the next visit.
    await Promise.all(FIREBASE.map(u => cache.add(new Request(u, { cache: 'reload' }))));
    // Local files are best-effort (they also get cached as they're used).
    await Promise.all(LOCAL.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
  })());
  // No skipWaiting() here on purpose: a new version waits until the user taps
  // "Reload" on the update banner, so it can never reload mid-sale.
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('electropro-v') && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim(); // so the very first visit is already offline-capable
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scopePath = new URL(self.registration.scope).pathname;

  // Firebase SDK — versioned URL, never changes: cache-first.
  if (FIREBASE.includes(req.url)) { e.respondWith(cacheFirst(req)); return; }

  // Everything else cross-origin (Firestore / Auth API calls, etc.) — never touch.
  if (url.origin !== location.origin) return;

  // The app page itself — only this app's own page, not other apps on the same site.
  if (req.mode === 'navigate') {
    if (url.pathname === scopePath || url.pathname === scopePath + 'index.html') {
      e.respondWith(networkFirst(req));
    }
    return;
  }

  // Static files (icons, fonts): serve the saved copy, refresh in the background.
  if (url.pathname.startsWith(scopePath) && /\.(png|jpe?g|svg|ico|webp|woff2?)$/i.test(url.pathname)) {
    e.respondWith(staleWhileRevalidate(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req.url, res.clone());
  return res;
}

// Fresh when the network is good; the saved copy when it's offline OR just slow
// (weak signal shouldn't leave the shop staring at a blank screen).
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const saved = async () => (await cache.match('./index.html')) || (await cache.match('./')) || null;
  const net = fetch(req).then(res => {
    if (res.ok) cache.put('./index.html', res.clone());
    return res;
  });
  net.catch(() => {}); // avoid an unhandled rejection if we answer from the cache first
  const slow = new Promise(r => setTimeout(() => r(null), 4000));
  try {
    const first = await Promise.race([net, slow]);
    if (first) return first;
    return (await saved()) || net; // slow network: saved copy now (cache refreshes in the background)
  } catch (_) {
    return (await saved()) || Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}
