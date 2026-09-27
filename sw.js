/* Offline cache + serves photos taken in the app (stored in IndexedDB) at /_blob/<id>. */
const VERSION = 'd5b3e36b04';
const SHELL = 'shell-' + VERSION, DATA = 'data-' + VERSION;
const SHELL_FILES = ['./', 'index.html', 'platform.js', 'manifest.webmanifest', 'lib/maplibre-gl.js', 'lib/NoSleep.min.js', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'glyphs.json', 'tiles/index.json', 'tiles/low.json', 'data/salt.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim()));
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
    e.respondWith(caches.open(DATA).then(async c => { const hit = await c.match(e.request); if (hit) return hit; const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r; }));
    return;
  }
  // app shell: network first so updates arrive, cache when offline
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(SHELL).then(c => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request).then(m => m || caches.match('index.html'))));
});
