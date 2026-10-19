'use strict';

const CHIAVE = 'dispensa-app-v1';
const CATEGORIE = ['Alimentari', 'Freschi e latticini', 'Bevande', 'Surgelati', 'Igiene personale', 'Pulizia casa', 'Altro'];
const MODI = {
  carico: 'Ogni scansione aggiunge 1 pezzo in dispensa.',
  consumo: 'Ogni scansione toglie 1 pezzo; se finisce o scende sotto la scorta minima va nella lista della spesa.',
  spesa: 'Ogni scansione aggiunge il prodotto alla lista della spesa.'
};

let db = carica();
let modo = 'carico';
let stream = null;
let ultimoCodice = '';
let ultimoTempo = 0;
let eanInModifica = null;
let nuovoDaScansione = false;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function carica() {
  try {
    const d = JSON.parse(localStorage.getItem(CHIAVE));
    if (d && d.prodotti) return d;
  } catch (e) { /* dati assenti o non validi */ }
  return { prodotti: {}, dispensa: {}, spesa: [] };
}
function salva() {
  try { localStorage.setItem(CHIAVE, JSON.stringify(db)); }
  catch (e) { toast('Impossibile salvare: spazio esaurito'); }
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('mostra');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('mostra'), 2200);
}
function vibra() { if (navigator.vibrate) navigator.vibrate(60); }

/* ---------- Dati ---------- */
const qtaDi = (ean) => (db.dispensa[ean] ? db.dispensa[ean].qta : 0);

function cambiaQta(ean, delta) {
  const voce = db.dispensa[ean] || (db.dispensa[ean] = { qta: 0, scadenza: '' });
  voce.qta = Math.max(0, voce.qta + delta);
  const p = db.prodotti[ean];
  if (delta < 0 && p && voce.qta <= (p.scorta || 0)) aggiungiSpesa(ean, p.nome, true);
  salva();
}
function aggiungiSpesa(ean, nome, silenzioso) {
  const esistente = db.spesa.find((s) => (ean && s.ean === ean) || (!ean && s.nome.toLowerCase() === nome.toLowerCase()));
  if (esistente) { if (!silenzioso) { esistente.qta += 1; toast(`${nome}: quantità ${esistente.qta}`); } return; }
  db.spesa.push({ id: Date.now() + Math.random(), ean: ean || '', nome, qta: 1, spuntato: false });
  if (!silenzioso) toast(`${nome} aggiunto alla spesa`);
}
function suggeriti() {
  return Object.keys(db.dispensa)
    .filter((ean) => db.prodotti[ean] && db.prodotti[ean].scorta > 0 && qtaDi(ean) <= db.prodotti[ean].scorta)
    .filter((ean) => !db.spesa.some((s) => s.ean === ean))
    .map((ean) => db.prodotti[ean]);
}

/* ---------- Navigazione ---------- */
function vai(vista) {
  $$('.vista').forEach((v) => (v.hidden = v.id !== 'vista-' + vista));
  $$('#tabbar button').forEach((b) => b.classList.toggle('attivo', b.dataset.vista === vista));
  $('#titolo').textContent = { dispensa: 'Dispensa', spesa: 'Lista della spesa', scan: 'Scansiona', impostazioni: 'Backup e info' }[vista];
  if (vista !== 'scan') fermaCamera();
  disegna();
}
$$('#tabbar button').forEach((b) => b.addEventListener('click', () => vai(b.dataset.vista)));

/* ---------- Disegno ---------- */
function disegna() {
  disegnaDispensa();
  disegnaSpesa();
  const n = db.spesa.filter((s) => !s.spuntato).length;
  const badge = $('#badge-spesa');
  badge.hidden = !n;
  badge.textContent = n;
  $('#statistiche').textContent = `${Object.keys(db.prodotti).length} prodotti in catalogo, ${Object.values(db.dispensa).filter((d) => d.qta > 0).length} in dispensa, ${db.spesa.length} nella lista.`;
}

function giorniA(data) {
  if (!data) return null;
  return Math.ceil((new Date(data + 'T00:00:00') - new Date().setHours(0, 0, 0, 0)) / 86400000);
}

function disegnaDispensa() {
  const q = $('#cerca').value.trim().toLowerCase();
  const eans = Object.keys(db.dispensa).filter((e) => db.prodotti[e] && db.dispensa[e].qta > 0)
    .filter((e) => !q || (db.prodotti[e].nome + ' ' + db.prodotti[e].marca).toLowerCase().includes(q));
  if (!eans.length) {
    $('#elenco-dispensa').innerHTML = `<div class="vuoto">${q ? 'Nessun risultato.' : 'La dispensa è vuota.<br>Vai su Scansiona per aggiungere prodotti.'}</div>`;
    return;
  }
  const gruppi = {};
  eans.forEach((e) => (gruppi[db.prodotti[e].categoria] ||= []).push(e));
  $('#elenco-dispensa').innerHTML = CATEGORIE.concat(Object.keys(gruppi).filter((c) => !CATEGORIE.includes(c)))
    .filter((c) => gruppi[c])
    .map((c) => `<div class="gruppo"><h3>${esc(c)}</h3>${gruppi[c].sort((a, b) => db.prodotti[a].nome.localeCompare(db.prodotti[b].nome)).map(voceDispensa).join('')}</div>`).join('');
}
function voceDispensa(ean) {
  const p = db.prodotti[ean], d = db.dispensa[ean];
  const g = giorniA(d.scadenza);
  const scad = g === null ? '' : g < 0 ? ` · <span class="scad scaduto">scaduto</span>` : g <= 7 ? ` · <span class="scad">scade tra ${g} gg</span>` : ` · scade ${d.scadenza.split('-').reverse().join('/')}`;
  return `<div class="voce ${d.qta <= p.scorta && p.scorta > 0 ? 'sotto' : ''}" data-ean="${esc(ean)}">
    <div class="info" data-azione="modifica"><div class="nome">${esc(p.nome)}</div><div class="sub">${esc(p.marca)}${scad}</div></div>
    <div class="qta"><button data-azione="meno">−</button><output>${d.qta}</output><button data-azione="piu">+</button></div></div>`;
}
$('#elenco-dispensa').addEventListener('click', (e) => {
  const voce = e.target.closest('.voce');
  const az = e.target.closest('[data-azione]');
  if (!voce || !az) return;
  const ean = voce.dataset.ean;
  if (az.dataset.azione === 'modifica') apriProdotto(ean);
  else { cambiaQta(ean, az.dataset.azione === 'piu' ? 1 : -1); disegna(); }
});
$('#cerca').addEventListener('input', disegnaDispensa);

function disegnaSpesa() {
  const sug = suggeriti();
  $('#suggeriti').innerHTML = sug.length
    ? `<div class="suggeriti"><p>${sug.length} prodotti sotto la scorta minima: ${esc(sug.map((p) => p.nome).join(', '))}</p><button class="primario" id="btn-sug">Aggiungi alla lista</button></div>` : '';
  const ordine = [...db.spesa].sort((a, b) => a.spuntato - b.spuntato || a.nome.localeCompare(b.nome));
  $('#elenco-spesa').innerHTML = ordine.length ? ordine.map((s) => `
    <div class="voce ${s.spuntato ? 'spuntato' : ''}" data-id="${s.id}">
      <input type="checkbox" ${s.spuntato ? 'checked' : ''} data-azione="spunta">
      <div class="info"><div class="nome">${esc(s.nome)}</div></div>
      <div class="qta"><button data-azione="meno">−</button><output>${s.qta}</output><button data-azione="piu">+</button></div>
    </div>`).join('') : '<div class="vuoto">La lista è vuota.</div>';
  $('#btn-fine-spesa').hidden = !db.spesa.some((s) => s.spuntato);
}
$('#suggeriti').addEventListener('click', (e) => {
  if (e.target.id !== 'btn-sug') return;
  suggeriti().forEach((p) => aggiungiSpesa(p.ean, p.nome, true));
  salva(); disegna();
});
$('#elenco-spesa').addEventListener('click', (e) => {
  const voce = e.target.closest('.voce');
  const az = e.target.closest('[data-azione]');
  if (!voce || !az) return;
  const s = db.spesa.find((x) => String(x.id) === voce.dataset.id);
  if (!s) return;
  if (az.dataset.azione === 'spunta') s.spuntato = az.checked;
  else if (az.dataset.azione === 'piu') s.qta += 1;
  else if (az.dataset.azione === 'meno') {
    s.qta -= 1;
    if (s.qta <= 0) db.spesa = db.spesa.filter((x) => x !== s);
  }
  salva(); disegna();
});
$('#form-spesa').addEventListener('submit', (e) => {
  e.preventDefault();
  const nome = $('#spesa-nome').value.trim();
  if (!nome) return;
  const noto = Object.values(db.prodotti).find((p) => p.nome.toLowerCase() === nome.toLowerCase());
  aggiungiSpesa(noto ? noto.ean : '', noto ? noto.nome : nome);
  $('#spesa-nome').value = '';
  salva(); disegna();
});
$('#btn-fine-spesa').addEventListener('click', () => {
  const presi = db.spesa.filter((s) => s.spuntato);
  presi.forEach((s) => { if (s.ean && db.prodotti[s.ean]) cambiaQta(s.ean, s.qta); });
  db.spesa = db.spesa.filter((s) => !s.spuntato);
  salva(); disegna();
  toast(`${presi.length} articoli gestiti`);
});

/* ---------- Scheda prodotto ---------- */
$('#p-categoria').innerHTML = CATEGORIE.map((c) => `<option>${c}</option>`).join('');

function apriProdotto(ean, bozza) {
  eanInModifica = ean || '';
  nuovoDaScansione = !!bozza;
  const p = bozza || db.prodotti[ean] || { ean: '', nome: '', marca: '', categoria: 'Alimentari', scorta: 0 };
  const d = db.dispensa[ean] || { qta: bozza ? 0 : 1, scadenza: '' };
  $('#dlg-titolo').textContent = ean && !bozza ? 'Modifica prodotto' : 'Nuovo prodotto';
  $('#p-ean').value = p.ean || ean || '';
  $('#p-ean').readOnly = !!(ean && !bozza);
  $('#p-nome').value = p.nome;
  $('#p-marca').value = p.marca || '';
  $('#p-categoria').value = p.categoria;
  $('#p-qta').value = bozza ? 1 : d.qta;
  $('#p-scorta').value = p.scorta || 0;
  $('#p-scadenza').value = d.scadenza || '';
  $('#p-elimina').hidden = !(ean && !bozza);
  $('#dlg-prodotto').showModal();
}
$('#p-annulla').addEventListener('click', () => { $('#dlg-prodotto').close(); riprendiScan(); });
$('#btn-aggiungi-manuale').addEventListener('click', () => apriProdotto('', null));
$('#form-prodotto').addEventListener('submit', (e) => {
  e.preventDefault();
  const nome = $('#p-nome').value.trim();
  if (!nome) return;
  let ean = $('#p-ean').value.trim();
  if (!ean) ean = 'M' + Date.now();
  const nuovo = !db.prodotti[ean];
  db.prodotti[ean] = { ean, nome, marca: $('#p-marca').value.trim(), categoria: $('#p-categoria').value, scorta: Math.max(0, +$('#p-scorta').value || 0) };
  const qta = Math.max(0, +$('#p-qta').value || 0);
  db.dispensa[ean] = { qta, scadenza: $('#p-scadenza').value };
  salva();
  $('#dlg-prodotto').close();
  if (nuovoDaScansione) azioneScansione(ean, true);
  disegna();
  if (nuovo) toast(`${nome} salvato`);
  riprendiScan();
});
$('#p-elimina').addEventListener('click', () => {
  if (!confirm('Eliminare questo prodotto dal catalogo e dalla dispensa?')) return;
  delete db.prodotti[eanInModifica];
  delete db.dispensa[eanInModifica];
  db.spesa = db.spesa.filter((s) => s.ean !== eanInModifica);
  salva(); $('#dlg-prodotto').close(); disegna();
});

/* ---------- Scansione ---------- */
function impostaModo(m) {
  modo = m;
  $$('#modi button').forEach((b) => b.classList.toggle('attivo', b.dataset.modo === m));
  $('#descr-modo').textContent = MODI[m];
}
$$('#modi button').forEach((b) => b.addEventListener('click', () => impostaModo(b.dataset.modo)));
impostaModo('carico');

const FORMATI = ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'Code128'];
let ciclo = null;
let occupato = false;
let canvas = null;

async function avviaCamera() {
  if (typeof ZXingWASM === 'undefined') { $('#msg-scan').textContent = 'Libreria di scansione non caricata.'; return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('#msg-scan').textContent = 'Fotocamera non disponibile: serve una connessione HTTPS.'; return;
  }
  fermaCamera();
  ZXingWASM.setZXingModuleOverrides({ locateFile: (f, prefisso) => (f.endsWith('.wasm') ? 'lib/' + f : prefisso + f) });
  $('#msg-scan').textContent = 'Avvio fotocamera…';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
    });
    const v = $('#video');
    v.srcObject = stream;
    await v.play();
    $('#btn-camera').textContent = 'Ferma fotocamera';
    $('#msg-scan').textContent = 'Inquadra il codice a barre…';
    ciclo = setInterval(leggiFotogramma, 250);
  } catch (err) {
    fermaCamera();
    $('#msg-scan').textContent = 'Impossibile usare la fotocamera: controlla i permessi di Safari.';
  }
}
async function leggiFotogramma() {
  const v = $('#video');
  if (occupato || !stream || !v.videoWidth || $('#dlg-prodotto').open) return;
  occupato = true;
  try {
    // ritaglia la fascia centrale del fotogramma alla risoluzione originale
    const w = v.videoWidth, h = Math.round(v.videoHeight * 0.5), y = Math.round((v.videoHeight - h) / 2);
    canvas ||= document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, y, w, h, 0, 0, w, h);
    const risultati = await ZXingWASM.readBarcodes(ctx.getImageData(0, 0, w, h), { formats: FORMATI, tryHarder: true, maxNumberOfSymbols: 1 });
    const ok = risultati.find((r) => r.isValid && r.text);
    if (ok) trovatoCodice(ok.text);
  } catch (err) {
    $('#msg-scan').textContent = 'Errore di lettura: ' + (err && err.message ? err.message : err);
  } finally { occupato = false; }
}
function fermaCamera() {
  clearInterval(ciclo); ciclo = null;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  const v = $('#video');
  if (v) v.srcObject = null;
  const b = $('#btn-camera');
  if (b) b.textContent = 'Avvia fotocamera';
}
function riprendiScan() { ultimoTempo = Date.now(); }
$('#btn-camera').addEventListener('click', () => (stream ? fermaCamera() : avviaCamera()));
$('#form-codice').addEventListener('submit', (e) => {
  e.preventDefault();
  const c = $('#codice-manuale').value.replace(/\D/g, '');
  if (c.length < 6) { toast('Codice non valido'); return; }
  $('#codice-manuale').value = '';
  trovatoCodice(c, true);
});

async function trovatoCodice(codice, forza) {
  const ora = Date.now();
  if (!forza && codice === ultimoCodice && ora - ultimoTempo < 3000) return;
  if ($('#dlg-prodotto').open) return;
  ultimoCodice = codice; ultimoTempo = ora;
  vibra();
  if (db.prodotti[codice]) { azioneScansione(codice); return; }
  $('#msg-scan').textContent = `Codice ${codice}: cerco il prodotto…`;
  const trovato = await cercaOpenFoodFacts(codice);
  $('#msg-scan').textContent = trovato ? 'Controlla i dati e salva.' : 'Prodotto non trovato online: inserisci il nome.';
  apriProdotto(codice, trovato || { ean: codice, nome: '', marca: '', categoria: 'Alimentari', scorta: 0 });
}
function azioneScansione(ean, appenaCreato) {
  const p = db.prodotti[ean];
  if (modo === 'carico') {
    if (!appenaCreato) cambiaQta(ean, 1);
    toast(`${p.nome}: ${qtaDi(ean)} in dispensa`);
  } else if (modo === 'consumo') {
    if (qtaDi(ean) <= 0) { toast(`${p.nome}: non risulta in dispensa`); aggiungiSpesa(ean, p.nome, true); salva(); }
    else { cambiaQta(ean, -1); toast(`${p.nome}: ne restano ${qtaDi(ean)}`); }
  } else {
    aggiungiSpesa(ean, p.nome);
    salva();
  }
  $('#msg-scan').textContent = `Ultimo: ${p.nome}`;
  disegna();
}

async function cercaOpenFoodFacts(ean) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=product_name,product_name_it,brands,categories_tags`, { signal: ctrl.signal });
    clearTimeout(t);
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    const pr = j.product;
    const nome = (pr.product_name_it || pr.product_name || '').trim();
    if (!nome) return null;
    return { ean, nome, marca: (pr.brands || '').split(',')[0].trim(), categoria: indovinaCategoria(pr.categories_tags || []), scorta: 0 };
  } catch (e) { return null; }
}
function indovinaCategoria(tags) {
  const t = tags.join(' ');
  if (/beverages|waters|drinks/.test(t)) return 'Bevande';
  if (/frozen/.test(t)) return 'Surgelati';
  if (/dairies|milks|cheeses|yogurts|meats|fresh/.test(t)) return 'Freschi e latticini';
  return 'Alimentari';
}

/* ---------- Backup ---------- */
$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dispensa_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d.prodotti || !d.dispensa || !Array.isArray(d.spesa)) throw new Error('formato');
    if (!confirm('Sostituire i dati attuali con il backup?')) return;
    db = d; salva(); disegna(); toast('Backup importato');
  } catch (err) { toast('File di backup non valido'); }
});
$('#btn-azzera').addEventListener('click', () => {
  if (!confirm('Cancellare tutti i dati? L\'operazione non si può annullare.')) return;
  db = { prodotti: {}, dispensa: {}, spesa: [] };
  salva(); disegna();
});

/* ---------- Avvio ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
vai('dispensa');
