/* 22.10.2026 (Ionuț): „Sesizare” — under „Șantier nou”. One photo of a site with an irregularity (no identification panel,
   works that may have no building permit); the GPS position decides the place; the website finds the competent ISC structure,
   the city hall and the local police and writes the petition; after 30 seconds (Anulează stops it) the iPhone shortcut
   „Sesizare” sends it from the user's own Mail account, with the photo attached. The petitioner's name and address stay on this
   phone only (OG 27/2002: a petition without them is filed without an answer). Admin and operators, each with their own data. */
(function () {
  const API = 'https://santiere.pages.dev/api/sesizare/';
  const WAIT = 30;
  const MOT = [['panou', 'Lipsă panou de identificare'], ['autorizatie', 'Posibil fără autorizație de construire']];
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const SES = window.SES = { f: null, tm: null };
  const pet = () => { try { return JSON.parse(localStorage.getItem('harta_petent') || 'null') || {}; } catch (e) { return {}; } };
  const savePet = p => { try { localStorage.setItem('harta_petent', JSON.stringify(p)); } catch (e) {} };
  const petOk = p => !!(p && String(p.nume || '').trim() && String(p.adresa || '').trim() && /@/.test(p.email || ''));
  async function req(path, opt) {
    const key = await CLOUD.k(); if (!key) throw new Error('Intră în aplicație cu parola ta.');
    let r; try { r = await fetch(API + path, Object.assign({}, opt, { headers: Object.assign({ 'x-key': key, 'content-type': 'application/json' }, (opt && opt.headers) || {}) })); }
    catch (e) { throw new Error('Fără internet. Sesizarea pleacă doar cu semnal.'); }
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const er = new Error(j.mesaj || j.error || ('server ' + r.status)); er.code = j.error; throw er; }
    return j;
  }
  function put(id, blob, prog) {
    return CLOUD.k().then(key => new Promise((res, rej) => {
      const x = new XMLHttpRequest(); x.open('PUT', API + 'poza?id=' + encodeURIComponent(id)); x.setRequestHeader('x-key', key); x.setRequestHeader('content-type', 'image/jpeg');
      x.upload.onprogress = e => { if (prog && e.lengthComputable) prog(e.loaded / e.total); };
      x.onload = () => x.status >= 200 && x.status < 300 ? res() : rej(new Error('poza nu a urcat (' + x.status + ')'));
      x.onerror = () => rej(new Error('poza nu a urcat (fără semnal)')); x.send(blob);
    }));
  }
  const el = () => document.getElementById('sesBody');
  const fmtD = t => new Date(t).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const STARE = { pregatit: 'pregătită', predat: 'predată telefonului', trimis: '✓ trimisă', anulat: 'anulată', test: 'test' };

  function render() {
    const f = SES.f, b = el(); if (!f || !b) return;
    const p = pet();
    if (f.step === 'pet') {
      b.innerHTML = `<div class="ses-h"><b>Datele tale pentru sesizări</b></div>
        <div class="sub">Legea petițiilor (OG 27/2002) cere numele și adresa celui care face sesizarea; fără ele, sesizarea se clasează fără răspuns. Datele rămân doar pe acest telefon și apar în textul sesizării.</div>
        <div class="ses-f"><label>Nume și prenume<input id="sesN" autocomplete="name" value="${esc(p.nume || '')}"></label>
        <label>Adresa de domiciliu (sau de corespondență)<input id="sesA" autocomplete="street-address" value="${esc(p.adresa || '')}"></label>
        <label>E-mail (contul din aplicația Mail de pe iPhone, de pe care pleacă sesizarea)<input id="sesE" type="email" autocomplete="email" value="${esc(p.email || '')}"></label>
        <label>Telefon (opțional)<input id="sesT" type="tel" autocomplete="tel" value="${esc(p.telefon || '')}"></label>
        <div class="ses-chips" role="group" aria-label="Formula"><button class="chip" data-sub="m" aria-pressed="${p.sub === 'm'}">Subsemnatul</button><button class="chip" data-sub="f" aria-pressed="${p.sub === 'f'}">Subsemnata</button></div></div>
        ${f.err ? `<div class="note warn" style="margin-top:8px">${esc(f.err)}</div>` : ''}
        <div class="btns" style="margin-top:12px"><button class="btn primary" id="sesPetOk">Salvează</button><button class="btn ghost" id="sesClose">${petOk(p) ? 'Înapoi' : 'Renunță'}</button></div>`;
      return;
    }
    if (f.step === 'start') {
      const g = gpsFresh();
      b.innerHTML = `<div class="ses-h"><b>Sesizare</b><button class="btn sm ghost" id="sesPet">${esc(p.nume || '')} · modifică</button></div>
        <div class="ses-chips" role="group" aria-label="Neregula">${MOT.map(([k, l]) => `<button class="chip" data-mot="${k}" aria-pressed="${f.mot.includes(k)}">${l}</button>`).join('')}</div>
        <label class="qc-tile ses-shot"><span class="qc-n">📷</span><span class="qc-l">Fă poza șantierului</span><span class="qc-s">cu ce se vede de pe stradă (fără fețe sau numere de mașini în prim-plan)</span><input type="file" accept="image/*" capture="environment" id="sesIn"></label>
        <div class="qc-gps ${g ? 'ok' : 'wait'}">${g ? `● GPS activ (±${Math.round(g.acc || 0)} m)` : '● Aștept semnalul GPS… sesizarea pleacă doar cu locație'}</div>
        <label class="ses-test"><input type="checkbox" id="sesTest" ${f.test ? 'checked' : ''}> Doar test: trimite-o numai la mine (${esc(p.email || '')})</label>
        <div class="btns" style="margin-top:10px"><button class="btn ghost" id="sesClose">Renunță</button></div>
        <div class="ses-ist" id="sesIst">${f.ist ? f.ist : ''}</div>`;
      if (!f.ist && !f.istBusy) { f.istBusy = true; req('lista').then(d => { f.ist = d.L.length ? '<div class="ses-ih">Sesizările tale</div>' + d.L.slice(0, 8).map(x => `<div class="ses-i"><span>${fmtD(x.t)} · ${esc(x.uat)}${x.adr ? ', ' + esc(x.adr) : ''}</span><b>${STARE[x.stare] || esc(x.stare)}</b></div>`).join('') : ''; if (SES.f === f && f.step === 'start') { const i = document.getElementById('sesIst'); if (i) i.innerHTML = f.ist; } }).catch(() => {}); }
      return;
    }
    if (f.step === 'prep') {
      b.innerHTML = `<div class="ses-h"><b>Sesizare</b></div>${f.url ? `<img class="ses-img" src="${f.url}" alt="">` : ''}<div class="ses-wait">${esc(f.msg || 'Pregătesc sesizarea…')}</div>`;
      return;
    }
    if (f.step === 'count' || f.step === 'hold') {
      const r = f.r, left = Math.max(0, f.left);
      b.innerHTML = `<div class="ses-h"><b>${f.test ? 'Sesizare de test' : 'Sesizare'} · ${esc(r.uat)}</b></div>
        <div class="ses-top">${f.url ? `<img class="ses-img sm" src="${f.url}" alt="">` : ''}<div class="ses-to"><div class="ses-k">Către</div>${r.catre.map(a => `<div><b>${esc(a.nume)}</b><span>${esc(a.email)}</span></div>`).join('')}</div></div>
        ${r.lipsa && r.lipsa.length && !f.test ? `<div class="note" style="margin-top:8px">Nu am adresă pentru: ${esc(r.lipsa.join(', '))}.</div>` : ''}
        ${r.dup && !f.test ? `<div class="note warn" style="margin-top:8px">Ai mai trimis o sesizare aici pe ${fmtD(r.dup.t)} (${STARE[r.dup.stare] || r.dup.stare}). O sesizare repetată pentru același lucru se clasează. Trimite doar dacă e altceva.</div>` : ''}
        <details class="ses-txt"><summary>${esc(r.subiect)}</summary><pre>${esc(r.text)}</pre></details>
        <div class="ses-up">${f.upDone ? '✓ Poza a urcat' : '⏳ Urc poza… ' + Math.round((f.up || 0) * 100) + '%'}</div>
        ${f.step === 'count' ? `<div class="ses-count"><b class="num">${left}</b><span>secunde până pleacă</span></div>` : ''}
        <div class="btns" style="margin-top:10px"><button class="btn ghost danger" id="sesStop">Anulează</button><button class="btn primary" id="sesGo">${f.step === 'hold' ? 'Trimite oricum' : 'Trimite acum'}</button></div>`;
      return;
    }
    if (f.step === 'gone') {
      const r = f.r;
      b.innerHTML = `<div class="ses-h"><b>${f.test ? 'Test trimis spre Mail' : 'Sesizarea a plecat spre Mail'}</b></div>
        <div class="sub">${iOS ? 'Scurtătura „Sesizare” o trimite din contul tău de e-mail, cu poza atașată. Răspunsurile și numerele de înregistrare vin la tine.' : 'Se deschide aplicația de e-mail cu sesizarea completată; poza e trimisă ca link. Apasă Trimite acolo.'}</div>
        <div class="sub" style="margin-top:6px">Dacă nu s-a deschis nimic: ${iOS ? 'verifică întâi că ai scurtătura „Sesizare” (numele exact), apoi ' : ''}folosește butonul de mai jos.</div>
        <div class="btns" style="margin-top:12px">${iOS ? '<button class="btn" id="sesAgain">Pornește din nou scurtătura</button>' : ''}<a class="btn" href="${esc(mailto(r))}">Deschide în Mail (poza ca link)</a></div>
        <div class="btns" style="margin-top:8px"><button class="btn primary" id="sesClose">Gata</button></div>`;
      return;
    }
    if (f.step === 'err') {
      b.innerHTML = `<div class="ses-h"><b>Sesizare</b></div><div class="note warn">${esc(f.err || 'A apărut o eroare.')}</div>
        <div class="btns" style="margin-top:12px">${f.retry ? '<button class="btn primary" id="sesRetry">Încearcă din nou</button>' : ''}<button class="btn ghost" id="sesClose">Închide</button></div>`;
    }
  }
  const mailto = r => 'mailto:' + r.catre.map(a => a.email).join(',') + '?subject=' + encodeURIComponent(r.subiect) + '&body=' + encodeURIComponent(r.text + '\n\nFotografia: ' + r.foto);
  function open() {
    if (QC && QC.f) return;
    const p = pet();
    SES.f = { step: petOk(p) ? 'start' : 'pet', mot: ['panou'], test: false };
    if (!gpsFresh() && typeof locateNow === 'function') try { locateNow(); } catch (e) {}
    document.getElementById('ses').hidden = false; render();
    // only the GPS line is redrawn: redrawing the whole dialog while the camera is open would lose the photo (the field would be replaced)
    clearInterval(SES.gt); SES.gt = setInterval(() => { const f = SES.f; if (!f || f.step !== 'start') return; const g = gpsFresh(), c = document.querySelector('#ses .qc-gps'); if (!c) return;
      c.className = 'qc-gps ' + (g ? 'ok' : 'wait'); c.textContent = g ? `● GPS activ (±${Math.round(g.acc || 0)} m)` : '● Aștept semnalul GPS… sesizarea pleacă doar cu locație'; }, 2000);
  }
  function close() {
    const f = SES.f; clearInterval(SES.tm); clearInterval(SES.gt);
    if (f && (f.step === 'count' || f.step === 'hold') && f.r) req('stare', { method: 'POST', body: JSON.stringify({ id: f.r.id, stare: 'anulat' }) }).catch(() => {});
    if (f && f.url) setTimeout(() => URL.revokeObjectURL(f.url), 1000);
    SES.f = null; document.getElementById('ses').hidden = true;
  }
  async function shot(file) {
    const f = SES.f; if (!f || f.step !== 'start') return;
    f.url = URL.createObjectURL(file); f.step = 'prep'; f.msg = 'Aștept poziția GPS…'; render();
    let g = gpsNow(); for (let i = 0; !g && i < 30 && SES.f === f; i++) { await new Promise(r => setTimeout(r, 1000)); g = gpsNow(); }
    if (SES.f !== f) return;
    if (!g) { f.step = 'err'; f.err = 'Nu am semnal GPS, deci nu știu unde e șantierul. Ieși în aer liber și încearcă din nou.'; render(); return; }
    f.msg = 'Caut primăria, poliția locală și ISC pentru locul ăsta…'; render();
    try {
      const done = await withGps(await toJpeg(file), g); f.blob = done.blob; const gp = done.gps || g;
      const p = pet();
      f.r = await req('pregatire', { method: 'POST', body: JSON.stringify({ lat: gp.lat, lng: gp.lng, acc: g.acc || 0, t: g.t || Date.now(), motiv: f.mot, petent: p, test: f.test }) });
      if (f.test) f.r = Object.assign({}, f.r, { catre: [{ nume: 'Test – doar către tine', email: p.email }], dup: null, lipsa: [] });
    } catch (e) {
      if (SES.f !== f) return;
      if (e.code === 'petent') { f.step = 'pet'; f.err = e.message; render(); return; }
      f.step = 'err'; f.err = e.message; f.retry = true; f.file = file; render(); return;
    }
    if (SES.f !== f) return;
    f.up = 0; put(f.r.id, f.blob, x => { f.up = x; if (SES.f === f && f.step !== 'gone') { const u = document.querySelector('#ses .ses-up'); if (u) u.textContent = '⏳ Urc poza… ' + Math.round(x * 100) + '%'; } })
      .then(() => { f.upDone = true; if (SES.f === f && f.step !== 'gone') render(); if (f.goWhenUp) send(); })
      .catch(e => { f.upErr = e.message; if (SES.f === f) { f.step = 'err'; f.err = e.message + '. Sesizarea nu a plecat.'; f.retry = true; f.file = file; clearInterval(SES.tm); render(); } });
    f.left = WAIT; f.step = f.r.dup && !f.test ? 'hold' : 'count'; render();
    clearInterval(SES.tm);
    if (f.step === 'count') SES.tm = setInterval(() => { if (SES.f !== f || f.step !== 'count') { clearInterval(SES.tm); return; } f.left--; const c = document.querySelector('#ses .ses-count b'); if (c) c.textContent = Math.max(0, f.left); if (f.left <= 0) { clearInterval(SES.tm); send(); } }, 1000);
  }
  function launch(f) {
    const r = f.r, data = { catre: r.catre.map(a => a.email), subiect: r.subiect, text: r.text, foto: r.foto, trimis: r.trimis };
    const go = SES.nav || (u => { location.href = u; });   // SES.nav: only the automatic tests replace it
    if (iOS) go('shortcuts://run-shortcut?name=' + encodeURIComponent('Sesizare') + '&input=text&text=' + encodeURIComponent(JSON.stringify(data)));
    else go(mailto(r));
  }
  function send() {
    const f = SES.f; if (!f || !f.r || f.step === 'gone') return;
    clearInterval(SES.tm);
    if (!f.upDone) { f.goWhenUp = true; f.step = 'count'; f.left = 0; render(); return; }
    f.step = 'gone'; render();
    if (!f.test) req('stare', { method: 'POST', body: JSON.stringify({ id: f.r.id, stare: 'predat' }) }).catch(() => {});
    launch(f);
  }
  document.addEventListener('click', e => {
    if (e.target.closest('#btnSes, #navSes')) { open(); return; }
    const box = e.target.closest('#ses'); if (!box) return;
    const f = SES.f; if (!f) return;
    const id = e.target.id;
    if (id === 'sesClose') { close(); return; }
    if (id === 'sesPet') { f.step = 'pet'; f.err = ''; render(); return; }
    { const c = e.target.closest('[data-mot]'); if (c && f.step === 'start') { const k = c.dataset.mot; f.mot = f.mot.includes(k) ? f.mot.filter(x => x !== k) : f.mot.concat(k); if (!f.mot.length) f.mot = [k]; render(); return; } }
    { const c = e.target.closest('[data-sub]'); if (c && f.step === 'pet') { const p = Object.assign(pet(), readPet()); p.sub = c.dataset.sub; savePet(p); render(); return; } }
    if (id === 'sesTest') { f.test = e.target.checked; return; }
    if (id === 'sesPetOk') { const p = Object.assign(pet(), readPet()); if (!petOk(p)) { f.err = 'Completează numele, adresa și e-mailul.'; render(); return; } savePet(p); f.err = ''; f.step = 'start'; render(); return; }
    if (id === 'sesStop') { close(); toast('Sesizarea a fost anulată'); return; }
    if (id === 'sesGo') { send(); return; }
    if (id === 'sesAgain') { launch(f); return; }
    if (id === 'sesRetry' && f.file) { const fl = f.file; Object.assign(f, { step: 'start', err: '', retry: false, r: null, upDone: false, goWhenUp: false }); shot(fl); return; }
  });
  function readPet() { const v = id => (document.getElementById(id) || {}).value; return { nume: (v('sesN') || '').trim(), adresa: (v('sesA') || '').trim(), email: (v('sesE') || '').trim(), telefon: (v('sesT') || '').trim() }; }
  document.addEventListener('change', e => { if (e.target.id === 'sesIn' && e.target.files && e.target.files[0]) shot(e.target.files[0]); });
})();
