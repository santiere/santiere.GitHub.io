/* Platform layer for the installable app: replaces the Claude runtime (db, assets, downloads)
   with on-device storage (IndexedDB), decrypts the private data files, keeps the screen on. */
(() => {
  'use strict';
  window.PWA = true;
  document.documentElement.setAttribute('data-theme', 'light');

  /* ---------- IndexedDB ---------- */
  let idbP;
  function idb() {
    if (!idbP) idbP = new Promise((res, rej) => {
      const r = indexedDB.open('harta-santiere', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('blobs'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return idbP;
  }
  function req(store, mode, fn) {
    return idb().then(d => new Promise((res, rej) => {
      const t = d.transaction(store, mode); const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r ? r.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    }));
  }
  const kvGet = k => req('kv', 'readonly', s => s.get(k));
  const kvPut = (k, v) => req('kv', 'readwrite', s => s.put(v, k));
  const kvDel = k => req('kv', 'readwrite', s => s.delete(k));
  const kvKeys = () => req('kv', 'readonly', s => s.getAllKeys());

  /* ---------- crypto ---------- */
  let keyResolve; const keyReady = new Promise(r => { keyResolve = r; });
  async function deriveKey(pass) {
    const salt = Uint8Array.from(atob((await (await fetch('data/salt.json')).json()).salt), c => c.charCodeAt(0));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  async function decryptWith(key, buf) { const u = new Uint8Array(buf); return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12)); }
  async function decrypt(buf) { return decryptWith(await keyReady, buf); }
  async function fetchEnc(path) { const r = await fetch(path); if (!r.ok) throw new Error(path + ' ' + r.status); return decrypt(await r.arrayBuffer()); }
  async function encJSON(path) { return JSON.parse(new TextDecoder().decode(await fetchEnc(path))); }
  async function tryPass(pass) {
    try { const key = await deriveKey(pass); const r = await fetch('data/check.enc'); await decryptWith(key, await r.arrayBuffer()); return key; } catch (e) { return null; }
  }
  function lockScreen(msg) {
    return new Promise(async resolve => {
      if (!document.body) await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
      const el = document.createElement('div'); el.className = 'lock';
      el.innerHTML = `<form class="lock-card"><div class="lock-k">Harta Șantierelor</div><h2>Parola datelor</h2><p class="sub">${msg || 'Scrie parola primită. O cer o singură dată pe acest telefon.'}</p>
        <input class="in" id="lockPass" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="parola">
        <button class="btn primary" type="submit" style="width:100%;margin-top:12px">Deschide</button><p class="sub" id="lockErr" style="color:var(--danger);min-height:1.4em"></p></form>`;
      document.body.appendChild(el);
      el.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault(); const p = el.querySelector('#lockPass').value.trim(); if (!p) return;
        el.querySelector('#lockErr').textContent = 'Verific…';
        const key = await tryPass(p);
        if (!key) { el.querySelector('#lockErr').textContent = 'Parola nu e corectă.'; return; }
        try { localStorage.setItem('harta_pass', p); } catch (e2) {}
        el.remove(); resolve(key);
      });
    });
  }
  (async () => {
    let key = null; let saved = null;
    try { saved = localStorage.getItem('harta_pass'); } catch (e) {}
    if (saved) key = await tryPass(saved);
    if (!key) key = await lockScreen(saved ? 'Parola salvată nu mai e valabilă. Scrie parola nouă.' : '');
    keyResolve(key);
  })();

  /* ---------- seed + local document store ---------- */
  const KEEP = ['inactiv', 'panouA', 'santierA', 'panouT', 'sters', 'deScanat', 'manual', 'creat'];
  let seeded = null;
  function mergeSite(old, fresh) {
    if (!old) return fresh;
    const out = Object.assign({}, fresh);
    for (const k of KEEP) if (old[k] !== undefined) out[k] = old[k];
    if (old.auto === false) for (const k of ['name', 'beneficiar', 'denumire', 'adresa', 'constructor', 'autorizatie', 'finalizare']) if (old[k] !== undefined) out[k] = old[k];
    if (old.ultimaApp) { out.ultimaApp = old.ultimaApp; if (!out.ultima || old.ultimaApp > out.ultima) out.ultima = old.ultimaApp; }
    if (old.lat && old.moved) { out.lat = old.lat; out.lng = old.lng; }
    return out;
  }
  function ensureSeed() {
    if (!seeded) seeded = (async () => {
      const seed = await encJSON('data/sites.enc');
      const cur = await kvGet('seedVersion');
      if (cur === seed.v) return;
      const byId = {};
      for (const k of await kvKeys()) if (String(k).startsWith('doc:sites/')) { const d = await kvGet(k); for (const [id, s] of Object.entries((d && d.s) || {})) if (s) byId[id] = s; }
      const seen = new Set();
      for (const [sh, doc] of Object.entries(seed.shards)) {
        const out = {};
        for (const [id, s] of Object.entries(doc.s)) { out[id] = mergeSite(byId[id], s); seen.add(id); }
        const old = await kvGet('doc:sites/' + sh);
        if (old && old.s) for (const [id, s] of Object.entries(old.s)) if (!seen.has(id) && s && s.manual) { out[id] = s; seen.add(id); }
        await kvPut('doc:sites/' + sh, { s: out });
      }
      for (const [id, s] of Object.entries(byId)) if (!seen.has(id) && s.manual) { const d = (await kvGet('doc:sites/sh0')) || { s: {} }; d.s[id] = s; await kvPut('doc:sites/sh0', d); }
      await kvPut('seedVersion', seed.v);
    })();
    return seeded;
  }
  const listeners = new Set();
  const notify = () => listeners.forEach(f => { try { f(); } catch (e) {} });
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  function merge(a, b) { for (const [k, v] of Object.entries(b)) { if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) merge(a[k], v); else a[k] = v; } return a; }
  const snap = (path, data) => ({ id: path.split('/').pop(), exists: data !== undefined, data: () => clone(data), metadata: { fromCache: false, hasPendingWrites: false } });
  let chain = Promise.resolve();
  const serial = fn => (chain = chain.then(fn, fn));
  function doc(path) {
    const k = 'doc:' + path;
    return {
      id: path.split('/').pop(), path,
      get: async () => { await ensureSeed(); return snap(path, await kvGet(k)); },
      set: d => serial(async () => { await kvPut(k, clone(d)); notify(); }),
      update: d => serial(async () => { const cur = await kvGet(k); if (cur === undefined) throw { code: 'invalid_argument', message: 'missing' }; await kvPut(k, merge(cur, clone(d))); notify(); }),
      delete: () => serial(async () => { await kvDel(k); notify(); }),
      onSnapshot(next) { let alive = true; const f = async () => { await ensureSeed(); if (alive) next(snap(path, await kvGet(k))); }; listeners.add(f); f(); return () => { alive = false; listeners.delete(f); }; },
      collection: sub => collection(path + '/' + sub),
    };
  }
  function collection(path) {
    const depth = path.split('/').length + 1;
    async function all() { await ensureSeed(); const out = []; for (const k of await kvKeys()) { const p = String(k).slice(4); if (String(k).startsWith('doc:' + path + '/') && p.split('/').length === depth) out.push(snap(p, await kvGet(k))); } return out; }
    return {
      path, doc: id => doc(path + '/' + (id || Math.random().toString(36).slice(2))),
      get: async () => { const docs = await all(); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }; },
      onSnapshot(next) { let alive = true; const f = async () => { const docs = await all(); if (alive) next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }); }; listeners.add(f); f(); return () => { alive = false; listeners.delete(f); }; },
    };
  }
  const dbApi = { doc, collection };

  /* ---------- photos stored on the phone ---------- */
  const assetsApi = {
    async upload(blob) {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      await req('blobs', 'readwrite', s => s.put(blob, id));
      return { id, url: new URL('_blob/' + id, location.href.replace(/[^/]*([?#].*)?$/, '')).pathname, sizeBytes: blob.size, contentType: blob.type || 'image/jpeg' };
    },
    async list() { return { assets: [], usage: {} }; },
    async delete(id) { await req('blobs', 'readwrite', s => s.delete(id)); return { deleted: true }; },
  };
  const downloadsApi = {
    shareFiles: async files => {
      if (navigator.canShare && navigator.canShare({ files })) return navigator.share({ files });
      for (const f of files) { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); }
    },
    save: async ({ filename, data }) => {
      const f = new File([data], filename, { type: /\.csv$/.test(filename) ? 'text/csv' : 'image/jpeg' });
      return downloadsApi.shareFiles([f]);
    },
  };
  window.claude = { use: async name => { await keyReady; await ensureSeed(); return name === 'db' ? dbApi : name === 'assets' ? assetsApi : name === 'downloads' ? downloadsApi : null; } };

  /* ---------- encrypted data files ---------- */
  const ENC = { 'data/ocr.json': 'data/ocr.enc', 'f/index.json': 'p/index.enc' };
  window.PWA_json = p => ENC[p] ? encJSON(ENC[p]) : fetch(p).then(r => r.json());
  const bundles = new Map(), urls = new Map(); let pidx = null;
  window.PWA_photo = id => {
    if (!urls.has(id)) urls.set(id, (async () => {
      if (!pidx) pidx = encJSON('p/index.enc');
      const e = (await pidx)[id]; if (!e) return null;
      const f = 'p/' + String(e[0]).padStart(3, '0') + '.bin';
      if (!bundles.has(f)) bundles.set(f, fetchEnc(f).catch(err => { bundles.delete(f); throw err; }));
      const buf = await bundles.get(f);
      return URL.createObjectURL(new Blob([new Uint8Array(buf, e[1], e[2])], { type: 'image/jpeg' }));
    })().catch(() => { urls.delete(id); return null; }));
    return urls.get(id);
  };

  /* ---------- screen always on ---------- */
  let lock = null, noSleep = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); return; } } catch (e) {}
    try { if (!noSleep && window.NoSleep) noSleep = new NoSleep(); if (noSleep) { const r = noSleep.enable(); if (r && r.catch) r.catch(() => {}); } } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
  ['touchend', 'click'].forEach(ev => document.addEventListener(ev, function once() { keepAwake(); }, { once: true }));
  window.addEventListener('load', keepAwake);
  try { localStorage.removeItem('harta_awake'); } catch (e) {}
  /* no page zoom: pinch / double-tap act on the map only */
  ['gesturestart', 'gesturechange'].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));

  /* ---------- offline cache ---------- */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
