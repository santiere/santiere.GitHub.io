/* Harta Șantierelor · camera inside the app, used for the site panel.
   Why: the camera iOS opens for web apps only zooms by enlarging a 12 MP photo, so a panel shot from afar comes out
   with unreadable text. Here the zoom is the camera's own (the iPhone picks the lens / sensor crop), the shot keeps
   the sharpest of a short burst of frames, and the photo can be checked at real size before it is used.
   Nothing is ever enlarged: the photo is saved at the camera's own pixels. If anything fails, the iPhone camera
   (the old way) is one tap away. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const st = { stream: null, track: null, caps: {}, z0: 1, z: 1, zMin: 1, zMax: 1, real: false, dz: 1, onPhoto: null, sys: null, busy: false, url: null, blob: null, pending: null, applying: false };

  function ok() { return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

  function css() {
    if ($('#pcamCss')) return;
    const s = document.createElement('style'); s.id = 'pcamCss';
    s.textContent = `
.pcam{position:fixed;inset:0;z-index:90;background:#000;color:#fff;display:flex;flex-direction:column;-webkit-user-select:none;user-select:none;font:15px/1.3 -apple-system,system-ui,sans-serif}
.pcam[hidden]{display:none}
.pcam-v{position:relative;flex:1;min-height:0;overflow:hidden;display:grid;place-items:center;touch-action:none}
.pcam-v video{width:100%;height:100%;object-fit:contain;transform-origin:50% 50%;background:#000}
.pcam-top,.pcam-bot{flex:none;display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(0,0,0,.6)}
.pcam-top{padding-top:max(10px,env(safe-area-inset-top));justify-content:space-between}
.pcam-bot{padding-bottom:max(14px,env(safe-area-inset-bottom));flex-direction:column}
.pcam button{font:inherit;color:#fff;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:8px 14px;cursor:pointer}
.pcam .pcam-msg{flex:1;text-align:center;font-size:13px;color:#cfd6da}
.pcam-zs{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.pcam-zs button{min-width:52px;padding:7px 10px;font-weight:600}
.pcam-zs button.on{background:#F5B700;color:#111;border-color:#F5B700}
.pcam-row{display:flex;align-items:center;justify-content:center;gap:22px;width:100%}
.pcam-shot{width:74px;height:74px;border-radius:50% !important;padding:0 !important;background:#fff !important;border:5px solid rgba(255,255,255,.45) !important;box-shadow:0 0 0 3px #000 inset}
.pcam-shot:disabled{opacity:.5}
.pcam-zl{min-width:64px;text-align:center;font-weight:700;font-size:17px}
.pcam-info{font-size:11px;color:#9aa6ad;text-align:center}
.pcam-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .25s}
.pcam-flash.on{opacity:.55;transition:none}
.pcam-hint{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);background:rgba(0,0,0,.6);padding:6px 12px;border-radius:999px;font-size:13px;white-space:nowrap}
.pcam-err{padding:24px;text-align:center;line-height:1.5}
.pcam-rev{position:absolute;inset:0;background:#000;display:flex;flex-direction:column}
.pcam-rev[hidden]{display:none}
.pcam-rv{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y;display:grid;place-items:center}
.pcam-rv img{max-width:100%;max-height:100%;display:block}
.pcam-rv.full{display:block}
.pcam-rv.full img{max-width:none;max-height:none;width:calc(var(--w) * 1px / var(--dpr));height:auto}
.pcam-rb{flex:none;display:flex;gap:10px;justify-content:center;padding:12px 14px max(14px,env(safe-area-inset-bottom));background:rgba(0,0,0,.7);flex-wrap:wrap}
.pcam-rb .use{background:#F5B700;color:#111;border-color:#F5B700;font-weight:700}
`;
    document.head.appendChild(s);
  }

  function ui() {
    let el = $('#pcam'); if (el) return el;
    css();
    el = document.createElement('div'); el.id = 'pcam'; el.className = 'pcam'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Camera pentru panou');
    el.innerHTML = `
<div class="pcam-top"><button type="button" data-pc="close">Închide</button><span class="pcam-msg">Panou · zoom cu 2 degete</span><button type="button" data-pc="sys">Camera iPhone</button></div>
<div class="pcam-v"><video playsinline muted autoplay></video><div class="pcam-flash"></div><div class="pcam-hint" hidden></div></div>
<div class="pcam-bot">
  <div class="pcam-zs"></div>
  <div class="pcam-row"><span class="pcam-zl">1×</span><button type="button" class="pcam-shot" data-pc="shot" aria-label="Fă poza"></button><span class="pcam-zl pcam-sp"></span></div>
  <div class="pcam-info"></div>
</div>
<div class="pcam-rev" hidden>
  <div class="pcam-rv"><img alt="Poza panoului"></div>
  <div class="pcam-rb"><button type="button" data-pc="again">Refă</button><button type="button" data-pc="full">Verifică textul (mărime reală)</button><button type="button" class="use" data-pc="use">Folosește poza</button></div>
</div>`;
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
    const v = $('.pcam-v', el);
    v.addEventListener('touchstart', pinchStart, { passive: false });
    v.addEventListener('touchmove', pinchMove, { passive: false });
    v.addEventListener('touchend', pinchEnd);
    v.addEventListener('touchcancel', pinchEnd);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && !el.hidden) close(); });
    return el;
  }

  function hint(t, ms) {
    const h = $('#pcam .pcam-hint'); if (!h) return;
    h.textContent = t; h.hidden = !t; clearTimeout(hint.t);
    if (t && ms) hint.t = setTimeout(() => { h.hidden = true; }, ms);
  }

  // ---------- zoom ----------
  const rel = () => (st.real ? st.z / st.z0 : st.dz);
  function zoomUi() {
    const r = rel();
    const zl = $('#pcam .pcam-zl'); if (zl) zl.textContent = (r < 1 ? r.toFixed(1) : r >= 10 ? Math.round(r) : (Math.round(r * 10) / 10)).toString().replace('.', ',') + '×';
    const lo = st.real ? st.zMin / st.z0 : 1, hi = st.real ? st.zMax / st.z0 : 4;
    const pre = [0.5, 1, 2, 3, 5, 10].filter(p => p >= lo - 0.02 && p <= hi + 0.02);
    const box = $('#pcam .pcam-zs');
    const html = pre.map(p => `<button type="button" data-z="${p}" class="${Math.abs(r - p) < 0.06 ? 'on' : ''}">${String(p).replace('.', ',')}×</button>`).join('');
    if (box && box.innerHTML !== html) box.innerHTML = html;
    if (!st.real) { const v = $('#pcam video'); if (v) v.style.transform = st.dz > 1 ? `scale(${st.dz})` : ''; }
  }
  function setRel(r) {
    if (st.real) { st.z = clamp(r * st.z0, st.zMin, st.zMax); push(); }
    else st.dz = clamp(r, 1, 4);
    zoomUi();
    if (!st.real && rel() > 1.05) hint('Zoom digital (camera nu permite zoom real aici)', 2500);
  }
  // one zoom change at a time: the camera gets the newest value when it has finished the previous one
  function push() {
    st.pending = st.z;
    if (st.applying || !st.track) return;
    st.applying = true;
    const z = st.pending; st.pending = null;
    st.track.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {}).then(() => {
      st.applying = false; if (st.pending != null && st.pending !== z) push(); else st.pending = null;
    });
  }
  let pin = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  function pinchStart(e) { if (e.touches.length === 2) { e.preventDefault(); pin = { d: dist(e.touches), r: rel() }; } }
  function pinchMove(e) { if (pin && e.touches.length === 2) { e.preventDefault(); setRel(pin.r * dist(e.touches) / pin.d); } }
  function pinchEnd(e) { if (!e.touches || e.touches.length < 2) pin = null; }

  // ---------- start / stop ----------
  async function start() {
    const el = ui(); const v = $('video', el);
    const base = { facingMode: { ideal: 'environment' } };
    let s = null;
    try { s = await navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign({ width: { ideal: 4032 }, height: { ideal: 3024 } }, base) }); }
    catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
      s = await navigator.mediaDevices.getUserMedia({ audio: false, video: base });
    }
    if (el.hidden) { s.getTracks().forEach(t => t.stop()); return; }   // closed while the camera was starting
    st.stream = s; st.track = s.getVideoTracks()[0];
    const caps = (st.track.getCapabilities && st.track.getCapabilities()) || {};
    st.caps = caps;
    // the highest resolution the camera gives, if the first answer was lower
    try {
      const se = st.track.getSettings();
      if (caps.width && caps.height && caps.width.max * caps.height.max > (se.width || 0) * (se.height || 0) * 1.2)
        await st.track.applyConstraints({ width: { ideal: caps.width.max }, height: { ideal: caps.height.max } });
    } catch (e) {}
    v.srcObject = s;
    try { await v.play(); } catch (e) {}
    const se = st.track.getSettings ? st.track.getSettings() : {};
    st.real = !!(caps.zoom && caps.zoom.max > caps.zoom.min);
    st.z0 = st.z = (se.zoom || (caps.zoom && Math.max(1, caps.zoom.min)) || 1);
    st.zMin = st.real ? caps.zoom.min : 1; st.zMax = st.real ? caps.zoom.max : 1; st.dz = 1;
    zoomUi();
    const info = () => { const t = $('.pcam-info', el); if (t && v.videoWidth) t.textContent = `${v.videoWidth}×${v.videoHeight}${st.real ? ' · zoom real' : ' · zoom digital'}`; };
    v.onloadedmetadata = v.onresize = info; info();
    hint('Apropie panoul cu zoom și ține telefonul nemișcat', 3500);
  }
  function stop() {
    if (st.stream) st.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
    st.stream = st.track = null; st.pending = null; st.applying = false;
    const v = $('#pcam video'); if (v) { v.srcObject = null; v.style.transform = ''; }
  }
  function close() {
    stop(); review(false);
    const el = $('#pcam'); if (el) el.hidden = true;
    st.onPhoto = st.sys = null;
  }

  // ---------- the shot: several frames, the sharpest one is kept ----------
  const nextFrame = v => new Promise(res => {
    let done = false; const fin = () => { if (!done) { done = true; res(); } };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(fin);
    setTimeout(fin, 90);
  });
  function sharp(ctx, n) {
    const d = ctx.getImageData(0, 0, n, n).data; const g = new Float32Array(n * n);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114;
    let s = 0, s2 = 0, c = 0;
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      const i = y * n + x; const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - n] - g[i + n];
      s += l; s2 += l * l; c++;
    }
    const m = s / c; return s2 / c - m * m;
  }
  async function shoot() {
    if (st.busy || !st.track) return; st.busy = true;
    const el = $('#pcam'); const v = $('video', el); const btn = $('[data-pc="shot"]', el); btn.disabled = true;
    try {
      const W = v.videoWidth, H = v.videoHeight; if (!W || !H) throw new Error('camera');
      const k = st.real ? 1 : st.dz;
      const sw = Math.round(W / k), sh = Math.round(H / k), sx = Math.round((W - sw) / 2), sy = Math.round((H - sh) / 2);
      const big = document.createElement('canvas'); big.width = sw; big.height = sh;
      const bx = big.getContext('2d');
      const n = Math.min(384, sw, sh); const pc = document.createElement('canvas'); pc.width = pc.height = n;
      const px = pc.getContext('2d', { willReadFrequently: true });
      const fl = $('.pcam-flash', el); fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 60);
      let best = -1, got = 0;
      for (let i = 0; i < 7; i++) {
        await nextFrame(v);
        px.drawImage(v, Math.round(W / 2 - n / 2), Math.round(H / 2 - n / 2), n, n, 0, 0, n, n);
        const q = sharp(px, n);
        if (q > best) { best = q; bx.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh); got++; }
      }
      if (!got) throw new Error('camera');
      const blob = await new Promise(r => big.toBlob(r, 'image/jpeg', 0.95));
      big.width = big.height = 0;
      if (!blob) throw new Error('jpeg');
      st.blob = blob; review(true, sw, sh);
    } catch (e) { hint('Poza nu a reușit. Încearcă din nou sau folosește Camera iPhone.', 4000); }
    btn.disabled = false; st.busy = false;
  }
  function review(on, w, h) {
    const el = $('#pcam'); if (!el) return;
    const r = $('.pcam-rev', el), box = $('.pcam-rv', el), img = $('img', r);
    if (st.url) { URL.revokeObjectURL(st.url); st.url = null; }
    if (!on) { r.hidden = true; img.removeAttribute('src'); box.classList.remove('full'); return; }
    st.url = URL.createObjectURL(st.blob); img.src = st.url;
    box.style.setProperty('--w', w); box.style.setProperty('--dpr', window.devicePixelRatio || 1);
    box.classList.remove('full'); $('[data-pc="full"]', r).textContent = 'Verifică textul (mărime reală)';
    r.hidden = false;
  }

  function onClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.pc;
    if (b.dataset.z) { setRel(+b.dataset.z); return; }
    if (a === 'close') close();
    else if (a === 'shot') shoot();
    else if (a === 'again') review(false);
    else if (a === 'full') {
      const box = $('#pcam .pcam-rv'); const on = box.classList.toggle('full');
      b.textContent = on ? 'Toată poza' : 'Verifică textul (mărime reală)';
      if (on) requestAnimationFrame(() => { box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2; box.scrollTop = (box.scrollHeight - box.clientHeight) / 2; });
    }
    else if (a === 'use') {
      const cb = st.onPhoto, blob = st.blob; close();
      if (cb && blob) cb(new File([blob], 'panou.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
    }
    else if (a === 'sys') {
      const inp = st.sys; close();
      if (inp) { window.PCAM.sysPass = true; inp.click(); setTimeout(() => { window.PCAM.sysPass = false; }, 1500); }   // the iPhone camera, as before (this tap is the user's own)
    }
  }

  // open the camera; onPhoto(file) gets the photo the user chose to use; sysInput = the old camera field (fallback)
  async function open(onPhoto, sysInput) {
    const el = ui();
    st.onPhoto = onPhoto; st.sys = sysInput || null; st.blob = null;
    review(false); el.hidden = false;
    $('.pcam-v', el).querySelectorAll('.pcam-err').forEach(x => x.remove());
    $('video', el).hidden = false;
    $('[data-pc="shot"]', el).disabled = false;
    $('.pcam-info', el).textContent = '';
    try { await start(); }
    catch (e) {
      stop();
      if (el.hidden) return;
      $('video', el).hidden = true; $('[data-pc="shot"]', el).disabled = true;
      const m = document.createElement('div'); m.className = 'pcam-err';
      m.innerHTML = (e && e.name === 'NotAllowedError')
        ? 'Aplicația nu are voie la cameră.<br>Apasă „Camera iPhone” sus, sau permite camera din Setări › Safari › Cameră.'
        : 'Camera nu a pornit în aplicație.<br>Apasă „Camera iPhone” sus ca să faci poza ca înainte.';
      $('.pcam-v', el).appendChild(m);
    }
  }

  window.PCAM = { ok, open, close };
})();
