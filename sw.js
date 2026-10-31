/* Offline cache + serves photos taken in the app (stored in IndexedDB) at /_blob/<id>. */
const VERSION = 'st19s';
const SHELL = 'shell-' + VERSION, DATA = 'data-' + VERSION;
// 31.10.2026 (audit): the map tiles and the road graph (≈60 MB) keep their own cache across app updates — they were downloaded again
// after every update. Change MAPV only when tiles/ or route/ are regenerated.
const MAPV = 'map-1';
const isMap = p => /\/route\//.test(p) || (/\/tiles\//.test(p) && !/\/tiles\/(index|low)\.json$/.test(p));
const SHELL_FILES = ['./', 'index.html', 'platform.js', 'pcam.js', 'manifest.webmanifest', 'lib/maplibre-gl.js', 'lib/NoSleep.min.js', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/lockup-name.png', 'icons/splash-bg.jpg', 'icons/splash-bg-wide.jpg', 'glyphs.json', 'tiles/index.json', 'tiles/low.json', 'data/salt.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== DATA && k !== MAPV).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
function blobFromIDB(id) {
  return new Promise(res => {
    const r = indexedDB.open('harta-santiere', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('blobs'); };
    r.onsuccess = () => { try { const g = r.result.transaction('blobs', 'readonly').objectStore('blobs').get(id); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); } catch (e) { res(null); } };
    r.onerror = () => res(null);
  });
}
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  const p = url.pathname;
  const bi = p.indexOf('/_blob/');
  if (bi >= 0) {
    e.respondWith(blobFromIDB(decodeURIComponent(p.slice(bi + 7))).then(b => b ? new Response(b, { headers: { 'Content-Type': b.type || 'image/jpeg' } }) : new Response('', { status: 404 })));
    return;
  }
  const isData = /\/(tiles|p|route|data)\//.test(p) || p.endsWith('glyphs.json');
  if (isData) {
    // map tiles, road graph and photo packs: cache first, they only change with a new version
    const m = isMap(p);
    e.respondWith(caches.open(m ? MAPV : DATA).then(async c => { const hit = m ? await c.match(e.request) : await caches.match(e.request, { cacheName: SHELL }) || await c.match(e.request); if (hit) return hit; const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r; }));
    return;
  }
  // app shell: network first so updates arrive, cache when offline
  // 31.10.2026 (audit): on a weak signal the app no longer waits for the network — after 2.5 s it opens from the cache (the fresh copy
  // still lands in the cache for the next start)
  const net = fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(SHELL).then(c => c.put(e.request, cp)); } return r; });
  const cached = () => caches.match(e.request).then(m => m || caches.match('index.html'));
  e.respondWith(Promise.race([net.catch(() => null), new Promise(r => setTimeout(r, 2500, null))]).then(r => r || cached().then(m => m || net)).catch(cached));
});
