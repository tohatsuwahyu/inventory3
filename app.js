/* =========================================================
 * app.js — Inventory Dashboard (full)
 * - Koneksi GAS stabil (GET/POST + apikey)
 * - QR scanner kecil & fokus (BarcodeDetector → html5-qrcode)
 * - QR renderer auto-fallback (lokal qrlib.js → CDN)
 * - Label item rapi (Gambar + QR + コード/商品名/置場)
 * - Burger menu mobile
 * =======================================================*/

// ======= Session guard =======
const saved = localStorage.getItem('currentUser');
if (!saved) location.href = 'index.html';

// ======= State & helpers =======
const state = {
  currentUser: JSON.parse(saved),
  items: [], users: [], history: [], monthly: [],
  scanner: null, ioScanner: null, stocktakeRows: [],
  filteredItems: []
};
const qs  = (s, el=document)=>el.querySelector(s);
const qsa = (s, el=document)=>Array.from(el.querySelectorAll(s));
const fmt = (n)=>new Intl.NumberFormat('ja-JP').format(n ?? 0);
const isMobile = ()=> window.innerWidth < 992;
const today = ()=> new Date();
const safeFile = (s)=> String(s||'').replace(/[\s\\/:*?"<>|]+/g,'_');

// ======= Loading overlay =======
let loadingCount = 0;
function loading(on, text='読み込み中…'){
  const host = qs('#global-loading'); if(!host) return;
  const label = qs('#loading-text'); if(label && text) label.textContent = text;
  if(on){ loadingCount++; host.classList.remove('d-none'); }
  else { loadingCount = Math.max(0, loadingCount-1); if(loadingCount===0) host.classList.add('d-none'); }
}

// ======= Brand/logo (opsional) =======
(function setBrand(){ try{
  const url = (window.CONFIG && CONFIG.LOGO_URL) || './assets/tsh.png';
  const img = qs('#brand-logo'); if(img) img.src = url;
}catch(_){}})();

function setTitle(t){ const el=qs('#page-title'); if(el) el.textContent=t; }
function updateWho(){ const u=state.currentUser; const el=qs('#who'); if(el) el.text
