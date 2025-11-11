/* =========================================================
 * app.js — Inventory (GAS backend)
 * =======================================================*/
(function () {
  "use strict";

  // Helpers
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const fmt = (n) => new Intl.NumberFormat("ja-JP").format(Number(n || 0));
  const isMobile = () => /Android|iPhone|iPad/i.test(navigator.userAgent);
  function toast(msg) { alert(msg); }
  function ensure(x, msg) { if (!x) throw new Error(msg || "Assertion failed"); return x; }

  

// === PATCH: role gate & utils ===
function can(perm){  if (perm === 'admin') return isAdmin(); return true; }
function toastMini(msg, kind='info'){
  const host = document.getElementById('toast-area'); if(!host) return;
  const el = document.createElement('div'); el.className = 'toast-mini'; el.textContent = msg;
  if (kind==='err') el.style.background = '#b91c1c'; if(kind==='ok') el.style.background='#16a34a';
  host.appendChild(el); setTimeout(()=> el.remove(), 2500);
}
const _memo = new Map();
function memo(key, fn){ if(_memo.has(key)) return _memo.get(key); const v=fn(); _memo.set(key,v); return v; }
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

// Health ping
let _healthTimer = null;
function startHealthPing(){
  if (!CONFIG.FEATURES?.HEALTH_PING) return;
  const dot = document.getElementById('health-dot'); if(!dot) return;
  const set = (c)=> dot.style.background = c;
  async function ping(){
    try { const r = await api('ping', { method: 'GET', silent:true }); 
      set(r?.ok ? '#16a34a' : '#f59e0b'); }
    catch { set('#ef4444'); }
  }
  clearInterval(_healthTimer); ping(); _healthTimer = setInterval(ping, CONFIG.HEALTH_PING_MS||15000);
}

// Idle timer
let _idleTimer = null, _idleWarned = false;
function startIdleTimer(){
  const MIN = Number(CONFIG.IDLE_MIN||20);
  const warnAt = Math.max(1, MIN - 1);
  let last = Date.now();
  function reset(){ last = Date.now(); if(_idleWarned){ _idleWarned=false; toastMini('Sesi diperpanjang', 'ok'); } }
  ['click','keydown','touchstart','scroll'].forEach(e=>document.addEventListener(e, reset, {passive:true}));
  clearInterval(_idleTimer);
  _idleTimer = setInterval(()=>{
    const m = (Date.now() - last)/60000;
    if (m >= MIN){ toastMini('Sesi berakhir. Logout…','err'); logout?.(); }
    else if (!_idleWarned && m >= warnAt){ _idleWarned = true; toastMini('Sesi hampir habis。操作すると延長されます。'); }
  }, 10000);
}

// Diagnostics copy button
document.addEventListener('DOMContentLoaded', ()=>{
  startHealthPing();
  startIdleTimer();

  const btn = document.getElementById('btn-copy-diagnostics');
  btn?.addEventListener('click', ()=>{
    const who = getCurrentUser?.();
    const info = { at: new Date().toISOString(), ua: navigator.userAgent, url: location.href, api: CONFIG.BASE_URL, user: who };
    navigator.clipboard.writeText(JSON.stringify(info, null, 2)).then(()=> toastMini('Info teknis disalin','ok'));
  });
});

// Escape
  function escapeHtml(s){ return String(s || "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])); }
  function escapeAttr(s){ return escapeHtml(s); }

  // CSV helper: paksa Excel baca UTF-8 + JP header OK
  function downloadCSV_JP(filename, csv){
    const bom = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    // setTimeout(() => URL.revokeObjectURL(url), 2000); // opsional
  }

  // File helpers
  function sanitizeFilename(name){ return String(name || "").replace(/[\\/:*?"<>|]/g, "_"); }
  function normalizeCodeDash(s){ return String(s || "").replace(/[\u2212\u2010-\u2015\uFF0D]/g, "-").trim(); }
  function safeId(s){ return String(s||"").replace(/[^a-zA-Z0-9_-]/g, "_"); }

  // Global caches
  let _ITEMS_CACHE = [];

  function setLoading(show, text) {
    const el = $("#global-loading"); if (!el) return;
    if (show) { el.classList.remove("d-none"); $("#loading-text").textContent = text || "読み込み中…"; }
    else el.classList.add("d-none");
  }

  async function api(action, { method = "GET", body = null, silent = false } = {}) {
    if (!window.CONFIG || !CONFIG.BASE_URL) { throw new Error("config.js BASE_URL belum di-set"); }
    const apikey = encodeURIComponent(CONFIG.API_KEY || "");
    const url = `${CONFIG.BASE_URL}?action=${encodeURIComponent(action)}&apikey=${apikey}&_=${Date.now()}`;
    if (!silent) setLoading(true);
    try {
      if (method === "GET") {
        const r = await fetch(url, { mode: "cors", cache: "no-cache" });
        if (!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
        return await r.json();
      } else {
        const r = await fetch(url, {
          method: "POST", mode: "cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ ...(body || {}), apikey: CONFIG.API_KEY })
        });
        if (!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
        return await r.json();
      }
    } finally { if (!silent) setLoading(false); }
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if ([...document.scripts].some(s => s.src === src || s.src.endsWith(src))) return resolve();
      const s = document.createElement("script");
      s.src = src; s.async = true; s.crossOrigin = "anonymous";
      s.onload = () => resolve(); s.onerror = () => reject(new Error("Gagal memuat: " + src));
      document.head.appendChild(s);
    });
  }

  async function ensureQRCode() {
    if (window.QRCode) return;
    const locals = ["./qrlib.js", "./qrcode.min.js", "./vendor/qrcode.min.js"];
    for (const p of locals) { try { await loadScriptOnce(p); if (window.QRCode) return; } catch {} }
    const cdns = [
      "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js",
      "https://unpkg.com/qrcodejs@1.0.0/qrcode.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"
    ];
    for (const u of cdns) { try { await loadScriptOnce(u); if (window.QRCode) return; } catch {} }
    throw new Error("QRCode library tidak tersedia (qrlib.js)");
  }

  async function ensureHtml5Qrcode() {
    if (window.Html5Qrcode) return;
    const locals = ["./html5-qrcode.min.js", "./vendor/html5-qrcode.min.js"];
    for (const p of locals) { try { await loadScriptOnce(p); if (window.Html5Qrcode) return; } catch {} }
    const cdns = [
      "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/minified/html5-qrcode.min.js",
      "https://unpkg.com/html5-qrcode@2.3.8/minified/html5-qrcode.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/minified/html5-qrcode.min.js"
    ];
    for (const u of cdns) { try { await loadScriptOnce(u); if (window.Html5Qrcode) return; } catch {} }
    throw new Error("html5-qrcode tidak tersedia");
  }

  function getCurrentUser() { try { return JSON.parse(localStorage.getItem("currentUser") || "null"); } catch { return null; } }
  function setCurrentUser(u) { localStorage.setItem("currentUser", JSON.stringify(u || null)); }
  function logout() { setCurrentUser(null); location.href = "index.html"; }
  function isAdmin() { return (getCurrentUser()?.role || "user").toLowerCase() === "admin"; }
// --- User hydrator & sync ---
function readCookie(name){
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g,'\\$1') + '=([^;]*)'));
  try { return m ? decodeURIComponent(m[1]) : null; } catch { return null; }
}

/** Coba ambil identitas user dari berbagai sumber, lalu simpan ke localStorage jika belum ada */
function hydrateCurrentUser(){
  // 1) localStorage (kunci lain yang mungkin dipakai halaman login lama)
  const keys = ["currentUser","authUser","user","loggedInUser","me"];
  for (const k of keys){
    const v = localStorage.getItem(k);
    if (v){ try { const o = JSON.parse(v); if (o && o.id){ setCurrentUser(o); return o; } } catch{} }
  }
  // 2) sessionStorage
  for (const k of keys){
    const v = sessionStorage.getItem(k);
    if (v){ try { const o = JSON.parse(v); if (o && o.id){ setCurrentUser(o); return o; } } catch{} }
  }
  // 3) cookie `currentUser`
  const ck = readCookie("currentUser");
  if (ck){ try { const o = JSON.parse(ck); if (o && o.id){ setCurrentUser(o); return o; } } catch{} }

  // 4) global var yang mungkin diisi server-side
  if (window.CURRENT_USER && window.CURRENT_USER.id){ setCurrentUser(window.CURRENT_USER); return window.CURRENT_USER; }

  // 5) fallback opsional dari config
  if (window.CONFIG && CONFIG.DEFAULT_USER && CONFIG.DEFAULT_USER.id){
    setCurrentUser(CONFIG.DEFAULT_USER);
    return CONFIG.DEFAULT_USER;
  }
  return null;
}

// Jika tab/login lain mengubah user → refresh banner di sini juga
window.addEventListener("storage", (e) => {
  if (e.key === "currentUser") { updateWelcomeBanner(); }
});

  /* -------------------- Sidebar + Router -------------------- */
  (function navHandler() {
    function toggleSB() { document.body.classList.toggle("sb-open"); }
    function closeSB() { document.body.classList.remove("sb-open"); }

    document.addEventListener("click", (e) => {
      const trg = e.target.closest("[data-burger], .btn-burger, #burger, #btn-menu");
      if (trg) { e.preventDefault(); toggleSB(); }
      const isBackdrop = e.target.id === "sb-backdrop" || e.target.closest?.("#sb-backdrop");
      if (isBackdrop) closeSB();
    });

    document.addEventListener("touchend", (e) => {
      const trg = e.target.closest("[data-burger], .btn-burger, #burger, #btn-menu");
      if (trg) { e.preventDefault(); e.stopPropagation(); toggleSB(); }
    }, { passive: false });

    document.addEventListener("click", (e) => {
      const a = e.target.closest("aside nav a[data-view]");
      if (!a) return; e.preventDefault();

      $$("aside nav a").forEach(n => n.classList.remove("active"));
      a.classList.add("active");

      $$("main section").forEach(s => { s.classList.add("d-none"); s.classList.remove("active"); });
      const id = a.getAttribute("data-view");
      const sec = document.getElementById(id);
      if (sec) { sec.classList.remove("d-none"); sec.classList.add("active"); }

      const h = $("#page-title"); if (h) h.textContent = a.textContent.trim();

      closeSB();

      if (id === "view-items") renderItems();
      if (id === "view-users") renderUsers();
      if (id === "view-history") renderHistory();
      if (id === "view-shelf") { renderShelfTable(); }
      if (id === "view-shelf-list") { loadTanaList(); renderShelfRecapForList(); }
    });
  })();

  /* -------------------- Dashboard -------------------- */
  let chartLine = null, chartPie = null;
  async function renderDashboard() {
    const who = getCurrentUser();
    if (who) $("#who").textContent = `${who.name || who.id || "user"} (${who.id} | ${who.role || "user"})`;

    try {
      const [itemsRaw, usersRaw, seriesRaw] = await Promise.all([
        api("items", { method: "GET" }).catch(() => []),
        api("users", { method: "GET" }).catch(() => []),
        api("statsMonthlySeries", { method: "GET" }).catch(() => [])
      ]);

      const items = Array.isArray(itemsRaw) ? itemsRaw : [];
      const users = Array.isArray(usersRaw) ? usersRaw : [];
      const series = Array.isArray(seriesRaw) ? seriesRaw : [];

      $("#metric-total-items").textContent = items.length;
      const low = items.filter(it => Number(it.stock || 0) <= Number(it.min || 0)).length;
      $("#metric-low-stock").textContent = low;
      $("#metric-users").textContent = users.length;
      const badge = document.getElementById('low-badge');
      if (badge){ badge.classList.toggle('d-none', !low); badge.textContent = low ? `Low-stock: ${low}` : 'OK'; }
      if (CONFIG.FEATURES?.LOW_STOCK_ALERT && low > 0){ toastMini(`最小在庫以下が ${low} 件あります`, 'err'); }

      const ctx1 = $("#chart-monthly");
      if (ctx1) {
        chartLine?.destroy();
        chartLine = new Chart(ctx1, {
          type: "line",
          data: {
            labels: series.map(s => s.month || ""),
            datasets: [
              { label: "IN", data: series.map(s => Number(s.in || 0)), borderWidth: 2 },
              { label: "OUT", data: series.map(s => Number(s.out || 0)), borderWidth: 2 }
            ]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });
      }
      const ctx2 = $("#chart-pie");
      if (ctx2) {
        chartPie?.destroy();
        const last = series.length ? series[series.length - 1] : { in: 0, out: 0 };
        chartPie = new Chart(ctx2, {
          type: "pie",
          data: { labels: ["IN", "OUT"], datasets: [{ data: [Number(last.in || 0), Number(last.out || 0)] }] },
          options: { responsive: true, maintainAspectRatio: false }
        });
      }

      $("#btn-export-mov")?.addEventListener("click", () => {
        const heads = ["月","IN","OUT"];
        const csv = [heads.join(",")].concat(series.map(s => [s.month, s.in || 0, s.out || 0].join(","))).join("\n");
        downloadCSV_JP("月次INOUT.csv", csv);
      }, { once: true });
    } catch {
      toast("ダッシュボードの読み込みに失敗しました。");
    }
  }
  // --- PASANG DI SINI: tepat setelah } penutup renderDashboard() ---
  // --- PASANG MENGGANTI fungsi lama updateWelcomeBanner ---
function updateWelcomeBanner() {
  const who = getCurrentUser();
  const nama = who?.name || who?.id || "ユーザー";
  const roleRaw = (who?.role || "user").toLowerCase();
  const roleJP  = roleRaw === "admin" ? "管理者" : "ユーザー";

  // 1) Jika dashboard pakai kontainer khusus (rencana baru)
  const banner = document.getElementById("welcome-banner");
  if (banner) {
    banner.innerHTML = `ようこそ、<b>${escapeHtml(nama)}</b> さん。<span class="badge-soft" style="margin-left:.4rem">${roleJP}</span>
      <span class="text-muted small">端末、電源、電波確認しましょう。</span>`;
  }

  // 2) Kompatibel dengan struktur lama: cuma ada <b id="wel-name">
  const welName = document.getElementById("wel-name");
  if (welName) {
    // Tampilkan nama + peran agar “Admin” tidak lagi terbaca “User”
    welName.textContent = `${nama}（${roleJP}）`;
  }

  // 3) Header kecil di kanan (info ringkas)
  const whoEl = document.getElementById("who");
  if (whoEl) {
    const id = who?.id || "";
    const role = who?.role || "user";
    whoEl.textContent = `${nama} (${id} | ${role})`;
  }
}


  // === Live reload (user-configurable) ===
  const LIVE_KEY = "liveRefreshSec";
  let LIVE_TIMER = null;
  let LIVE_SEC = Number(localStorage.getItem(LIVE_KEY) || "120"); // default 120s (lebih lambat)

  function setLiveRefresh(seconds){
    LIVE_SEC = Math.max(0, Number(seconds || 0));
    localStorage.setItem(LIVE_KEY, String(LIVE_SEC));
    startLiveReload();
  }

  function startLiveReload(){
    clearInterval(LIVE_TIMER);
    if (LIVE_SEC <= 0) return; // Off
    LIVE_TIMER = setInterval(async () => {
      try {
        const active = document.querySelector("main section.active")?.id || "";
        // refresh cache item supaya stok/nama terbaru
        api("items", { method: "GET", silent: true }).then(list => {
          _ITEMS_CACHE = Array.isArray(list) ? list : (list?.data || []);
        }).catch(()=>{});
        // per layar aktif:
        if (active === "view-dashboard")    renderDashboard();
        if (active === "view-history")      renderHistory();
        if (active === "view-shelf-list")   loadTanaList();  // 棚卸一覧
        // if (active === "view-shelf")     renderShelfTable(); // opsional
      } catch {}
    }, LIVE_SEC * 1000);
  }

  /* -------------------- Items -------------------- */
  function tplItemRow(it) {
    const qrid = `qr-${safeId(it.code)}`;
    return `<tr data-code="${escapeAttr(it.code)}">
      <td><input type="checkbox" class="row-chk"></td>
      <td style="width:110px"><div class="tbl-qr-box"><div id="${qrid}" class="d-inline-block"></div></div></td>
      <td>${escapeHtml(it.code)}</td>
      <td><a href="#" class="link-underline link-item" data-code="${escapeAttr(it.code)}">${escapeHtml(it.name)}</a>
          <a href="#" class="ms-2 small link-timeline" data-code="${escapeAttr(it.code)}" title="履歴">履歴</a></td>
      <td>${it.img ? `<img src="${escapeAttr(it.img)}" class="thumb"/>` : ""}</td>
      <td class="text-end">${fmt(it.price)}</td>
      <td class="text-end">${fmt(it.stock)}</td>
      <td class="text-end">${fmt(it.min)}</td>
      <td>${escapeHtml(it.department||"")}</td>
      <td>${escapeHtml(it.location||"")}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary" data-act="edit" data-code="${escapeAttr(it.code)}">編集</button>
      </td>
    </tr>`;
})();
  // === PATCH: QUICK SCAN & FOCUS GUARD ===
  const beep = document.getElementById('beep-ok');
  document.getElementById('io-qty')?.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('form-io')?.requestSubmit(); }
  });
  document.getElementById('form-io')?.addEventListener('submit', ()=>{ try{ beep?.currentTime=0; beep?.play?.(); }catch{} });
  ['focus','click'].forEach(ev=>{
    document.getElementById('io-code')?.addEventListener(ev, ()=>{ document.getElementById('io-code')?.scrollIntoView({block:'center', behavior:'smooth'}); });
    document.getElementById('io-qty')?.addEventListener(ev, ()=>{ document.getElementById('io-qty')?.scrollIntoView({block:'center', behavior:'smooth'}); });
  });
}
* =========================================================
 * app.js — Inventory (GAS backend)
 * =======================================================*/
(function () {
  "use strict";

  // Helpers
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const fmt = (n) => new Intl.NumberFormat("ja-JP").format(Number(n || 0));
  const isMobile = () => /Android|iPhone|iPad/i.test(navigator.userAgent);
  function toast(msg) { alert(msg); }
  function ensure(x, msg) { if (!x) throw new Error(msg || "Assertion failed"); return x; }

  

// === PATCH: role gate & utils ===
function can(perm){  if (perm === 'admin') return isAdmin(); return true; }
function toastMini(msg, kind='info'){
  const host = document.getElementById('toast-area'); if(!host) return;
  const el = document.createElement('div'); el.className = 'toast-mini'; el.textContent = msg;
  if (kind==='err') el.style.background = '#b91c1c'; if(kind==='ok') el.style.background='#16a34a';
  host.appendChild(el); setTimeout(()=> el.remove(), 2500);
}
const _memo = new Map();
function memo(key, fn){ if(_memo.has(key)) return _memo.get(key); const v=fn(); _memo.set(key,v); return v; }
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

// Health ping
let _healthTimer = null;
function startHealthPing(){
  if (!CONFIG.FEATURES?.HEALTH_PING) return;
  const dot = document.getElementById('health-dot'); if(!dot) return;
  const set = (c)=> dot.style.background = c;
  async function ping(){
    try { const r = await api('ping', { method: 'GET', silent:true }); 
      set(r?.ok ? '#16a34a' : '#f59e0b'); }
    catch { set('#ef4444'); }
  }
  clearInterval(_healthTimer); ping(); _healthTimer = setInterval(ping, CONFIG.HEALTH_PING_MS||15000);
}

// Idle timer
let _idleTimer = null, _idleWarned = false;
function startIdleTimer(){
  const MIN = Number(CONFIG.IDLE_MIN||20);
  const warnAt = Math.max(1, MIN - 1);
  let last = Date.now();
  function reset(){ last = Date.now(); if(_idleWarned){ _idleWarned=false; toastMini('Sesi diperpanjang', 'ok'); } }
  ['click','keydown','touchstart','scroll'].forEach(e=>document.addEventListener(e, reset, {passive:true}));
  clearInterval(_idleTimer);
  _idleTimer = setInterval(()=>{
    const m = (Date.now() - last)/60000;
    if (m >= MIN){ toastMini('Sesi berakhir. Logout…','err'); logout?.(); }
    else if (!_idleWarned && m >= warnAt){ _idleWarned = true; toastMini('Sesi hampir habis。操作すると延長されます。'); }
  }, 10000);
}

// Diagnostics copy button
document.addEventListener('DOMContentLoaded', ()=>{
  const btn = document.getElementById('btn-copy-diagnostics');
  btn?.addEventListener('click', ()=>{
    const who = getCurrentUser?.();
    const info = { at: new Date().toISOString(), ua: navigator.userAgent, url: location.href, api: CONFIG.BASE_URL, user: who };
    navigator.clipboard.writeText(JSON.stringify(info, null, 2)).then(()=> toastMini('Info teknis disalin','ok'));
  });
});

// Escape
  function escapeHtml(s){ return String(s || "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])); }
  function escapeAttr(s){ return escapeHtml(s); }

  // CSV helper: paksa Excel baca UTF-8 + JP header OK
  function downloadCSV_JP(filename, csv){
    const bom = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    // setTimeout(() => URL.revokeObjectURL(url), 2000); // opsional
  }

  // File helpers
  function sanitizeFilename(name){ return String(name || "").replace(/[\\/:*?"<>|]/g, "_"); }
  function normalizeCodeDash(s){ return String(s || "").replace(/[\u2212\u2010-\u2015\uFF0D]/g, "-").trim(); }
  function safeId(s){ return String(s||"").replace(/[^a-zA-Z0-9_-]/g, "_"); }

  // Global caches
  let _ITEMS_CACHE = [];

  function setLoading(show, text) {
    const el = $("#global-loading"); if (!el) return;
    if (show) { el.classList.remove("d-none"); $("#loading-text").textContent = text || "読み込み中…"; }
    else el.classList.add("d-none");
  }

  async function api(action, { method = "GET", body = null, silent = false } = {}) {
    if (!window.CONFIG || !CONFIG.BASE_URL) { throw new Error("config.js BASE_URL belum di-set"); }
    const apikey = encodeURIComponent(CONFIG.API_KEY || "");
    const url = `${CONFIG.BASE_URL}?action=${encodeURIComponent(action)}&apikey=${apikey}&_=${Date.now()}`;
    if (!silent) setLoading(true);
    try {
      if (method === "GET") {
        const r = await fetch(url, { mode: "cors", cache: "no-cache" });
        if (!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
        return await r.json();
      } else {
        const r = await fetch(url, {
          method: "POST", mode: "cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ ...(body || {}), apikey: CONFIG.API_KEY })
        });
        if (!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
        return await r.json();
      }
    } finally { if (!silent) setLoading(false); }
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if ([...document.scripts].some(s => s.src === src || s.src.endsWith(src))) return resolve();
      const s = document.createElement("script");
      s.src = src; s.async = true; s.crossOrigin = "anonymous";
      s.onload = () => resolve(); s.onerror = () => reject(new Error("Gagal memuat: " + src));
      document.head.appendChild(s);
    });
  }

  async function ensureQRCode() {
    if (window.QRCode) return;
    const locals = ["./qrlib.js", "./qrcode.min.js", "./vendor/qrcode.min.js"];
    for (const p of locals) { try { await loadScriptOnce(p); if (window.QRCode) return; } catch {} }
    const cdns = [
      "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js",
      "https://unpkg.com/qrcodejs@1.0.0/qrcode.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"
    ];
    for (const u of cdns) { try { await loadScriptOnce(u); if (window.QRCode) return; } catch {} }
    throw new Error("QRCode library tidak tersedia (qrlib.js)");
  }

  async function ensureHtml5Qrcode() {
    if (window.Html5Qrcode) return;
    const locals = ["./html5-qrcode.min.js", "./vendor/html5-qrcode.min.js"];
    for (const p of locals) { try { await loadScriptOnce(p); if (window.Html5Qrcode) return; } catch {} }
    const cdns = [
      "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/minified/html5-qrcode.min.js",
      "https://unpkg.com/html5-qrcode@2.3.8/minified/html5-qrcode.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/minified/html5-qrcode.min.js"
    ];
    for (const u of cdns) { try { await loadScriptOnce(u); if (window.Html5Qrcode) return; } catch {} }
    throw new Error("html5-qrcode tidak tersedia");
  }

  function getCurrentUser() { try { return JSON.parse(localStorage.getItem("currentUser") || "null"); } catch { return null; } }
  function setCurrentUser(u) { localStorage.setItem("currentUser", JSON.stringify(u || null)); }
  function logout() { setCurrentUser(null); location.href = "index.html"; }
  function isAdmin() { return (getCurrentUser()?.role || "user").toLowerCase() === "admin"; }
// --- User hydrator & sync ---
function readCookie(name){
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g,'\\$1') + '=([^;]*)'));
  try { return m ? decodeURIComponent(m[1]) : null; } catch { return null; }
}

/** Coba ambil identitas user dari berbagai sumber, lalu simpan ke localStorage jika belum ada */
function hydrateCurrentUser(){
  // 1) localStorage (kunci lain yang mungkin dipakai halaman login lama)
  const keys = ["currentUser","authUser","user","loggedInUser","me"];
  for (const k of keys){
    const v = localStorage.getItem(k);
    if (v){ try { const o = JSON.parse(v); if (o && o.id){ setCurrentUser(o); return o; } } catch{} }
  }
  // 2) sessionStorage
  for (const k of keys){
    const v = sessionStorage.getItem(k);
    if (v){ try { const o = JSON.parse(v); if (o && o.id){ setCurrentUser(o); return o; } } catch{} }
  }
  // 3) cookie `currentUser`
  const ck = readCookie("currentUser");
  if (ck){ try { const o = JSON.parse(ck); if (o && o.id){ setCurrentUser(o); return o; } } catch{} }

  // 4) global var yang mungkin diisi server-side
  if (window.CURRENT_USER && window.CURRENT_USER.id){ setCurrentUser(window.CURRENT_USER); return window.CURRENT_USER; }

  // 5) fallback opsional dari config
  if (window.CONFIG && CONFIG.DEFAULT_USER && CONFIG.DEFAULT_USER.id){
    setCurrentUser(CONFIG.DEFAULT_USER);
    return CONFIG.DEFAULT_USER;
  }
  return null;
}

// Jika tab/login lain mengubah user → refresh banner di sini juga
window.addEventListener("storage", (e) => {
  if (e.key === "currentUser") { updateWelcomeBanner(); }
});

  /* -------------------- Sidebar + Router -------------------- */
  (function navHandler() {
    function toggleSB() { document.body.classList.toggle("sb-open"); }
    function closeSB() { document.body.classList.remove("sb-open"); }

    document.addEventListener("click", (e) => {
      const trg = e.target.closest("[data-burger], .btn-burger, #burger, #btn-menu");
      if (trg) { e.preventDefault(); toggleSB(); }
      const isBackdrop = e.target.id === "sb-backdrop" || e.target.closest?.("#sb-backdrop");
      if (isBackdrop) closeSB();
    });

    document.addEventListener("touchend", (e) => {
      const trg = e.target.closest("[data-burger], .btn-burger, #burger, #btn-menu");
      if (trg) { e.preventDefault(); e.stopPropagation(); toggleSB(); }
    }, { passive: false });

    document.addEventListener("click", (e) => {
      const a = e.target.closest("aside nav a[data-view]");
      if (!a) return; e.preventDefault();

      $$("aside nav a").forEach(n => n.classList.remove("active"));
      a.classList.add("active");

      $$("main section").forEach(s => { s.classList.add("d-none"); s.classList.remove("active"); });
      const id = a.getAttribute("data-view");
      const sec = document.getElementById(id);
      if (sec) { sec.classList.remove("d-none"); sec.classList.add("active"); }

      const h = $("#page-title"); if (h) h.textContent = a.textContent.trim();

      closeSB();

      if (id === "view-items") renderItems();
      if (id === "view-users") renderUsers();
      if (id === "view-history") renderHistory();
      if (id === "view-shelf") { renderShelfTable(); }
      if (id === "view-shelf-list") { loadTanaList(); renderShelfRecapForList(); }
    });
  })();

  /* -------------------- Dashboard -------------------- */
  let chartLine = null, chartPie = null;
  async function renderDashboard() {
    const who = getCurrentUser();
    if (who) $("#who").textContent = `${who.name || who.id || "user"} (${who.id} | ${who.role || "user"})`;

    try {
      const [itemsRaw, usersRaw, seriesRaw] = await Promise.all([
        api("items", { method: "GET" }).catch(() => []),
        api("users", { method: "GET" }).catch(() => []),
        api("statsMonthlySeries", { method: "GET" }).catch(() => [])
      ]);

      const items = Array.isArray(itemsRaw) ? itemsRaw : [];
      const users = Array.isArray(usersRaw) ? usersRaw : [];
      const series = Array.isArray(seriesRaw) ? seriesRaw : [];

      $("#metric-total-items").textContent = items.length;
      const low = items.filter(it => Number(it.stock || 0) <= Number(it.min || 0)).length;
      $("#metric-low-stock").textContent = low;
      $("#metric-users").textContent = users.length;
      const badge = document.getElementById('low-badge');
      if (badge){ badge.classList.toggle('d-none', !low); badge.textContent = low ? `Low-stock: ${low}` : 'OK'; }
      if (CONFIG.FEATURES?.LOW_STOCK_ALERT && low > 0){ toastMini(`最小在庫以下が ${low} 件あります`, 'err'); }

      const ctx1 = $("#chart-monthly");
      if (ctx1) {
        chartLine?.destroy();
        chartLine = new Chart(ctx1, {
          type: "line",
          data: {
            labels: series.map(s => s.month || ""),
            datasets: [
              { label: "IN", data: series.map(s => Number(s.in || 0)), borderWidth: 2 },
              { label: "OUT", data: series.map(s => Number(s.out || 0)), borderWidth: 2 }
            ]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });
      }
      const ctx2 = $("#chart-pie");
      if (ctx2) {
        chartPie?.destroy();
        const last = series.length ? series[series.length - 1] : { in: 0, out: 0 };
        chartPie = new Chart(ctx2, {
          type: "pie",
          data: { labels: ["IN", "OUT"], datasets: [{ data: [Number(last.in || 0), Number(last.out || 0)] }] },
          options: { responsive: true, maintainAspectRatio: false }
        });
      }

      $("#btn-export-mov")?.addEventListener("click", () => {
        const heads = ["月","IN","OUT"];
        const csv = [heads.join(",")].concat(series.map(s => [s.month, s.in || 0, s.out || 0].join(","))).join("\n");
        downloadCSV_JP("月次INOUT.csv", csv);
      }, { once: true });
    } catch {
      toast("ダッシュボードの読み込みに失敗しました。");
    }
  }
  // --- PASANG DI SINI: tepat setelah } penutup renderDashboard() ---
  // --- PASANG MENGGANTI fungsi lama updateWelcomeBanner ---
function updateWelcomeBanner() {
  const who = getCurrentUser();
  const nama = who?.name || who?.id || "ユーザー";
  const roleRaw = (who?.role || "user").toLowerCase();
  const roleJP  = roleRaw === "admin" ? "管理者" : "ユーザー";

  // 1) Jika dashboard pakai kontainer khusus (rencana baru)
  const banner = document.getElementById("welcome-banner");
  if (banner) {
    banner.innerHTML = `ようこそ、<b>${escapeHtml(nama)}</b> さん。<span class="badge-soft" style="margin-left:.4rem">${roleJP}</span>
      <span class="text-muted small">端末、電源、電波確認しましょう。</span>`;
  }

  // 2) Kompatibel dengan struktur lama: cuma ada <b id="wel-name">
  const welName = document.getElementById("wel-name");
  if (welName) {
    // Tampilkan nama + peran agar “Admin” tidak lagi terbaca “User”
    welName.textContent = `${nama}（${roleJP}）`;
  }

  // 3) Header kecil di kanan (info ringkas)
  const whoEl = document.getElementById("who");
  if (whoEl) {
    const id = who?.id || "";
    const role = who?.role || "user";
    whoEl.textContent = `${nama} (${id} | ${role})`;
  }
}


  // === Live reload (user-configurable) ===
  const LIVE_KEY = "liveRefreshSec";
  let LIVE_TIMER = null;
  let LIVE_SEC = Number(localStorage.getItem(LIVE_KEY) || "120"); // default 120s (lebih lambat)

  function setLiveRefresh(seconds){
    LIVE_SEC = Math.max(0, Number(seconds || 0));
    localStorage.setItem(LIVE_KEY, String(LIVE_SEC));
    startLiveReload();
  }

  function startLiveReload(){
    clearInterval(LIVE_TIMER);
    if (LIVE_SEC <= 0) return; // Off
    LIVE_TIMER = setInterval(async () => {
      try {
        const active = document.querySelector("main section.active")?.id || "";
        // refresh cache item supaya stok/nama terbaru
        api("items", { method: "GET", silent: true }).then(list => {
          _ITEMS_CACHE = Array.isArray(list) ? list : (list?.data || []);
        }).catch(()=>{});
        // per layar aktif:
        if (active === "view-dashboard")    renderDashboard();
        if (active === "view-history")      renderHistory();
        if (active === "view-shelf-list")   loadTanaList();  // 棚卸一覧
        // if (active === "view-shelf")     renderShelfTable(); // opsional
      } catch {}
    }, LIVE_SEC * 1000);
  }

  /* -------------------- Items -------------------- */
  function tplItemRow(it) {
    const qrid = `qr-${safeId(it.code)}`;
    return `<tr data-code="${escapeAttr(it.code)}">
      <td><input type="checkbox" class="row-chk"></td>
      <td style="width:110px"><div class="tbl-qr-box"><div id="${qrid}" class="d-inline-block"></div></div></td>
      <td>${escapeHtml(it.code)}</td>
      <td><a href="#" class="link-underline link-item" data-code="${escapeAttr(it.code)}">${escapeHtml(it.name)}</a>
          <a href="#" class="ms-2 small link-timeline" data-code="${escapeAttr(it.code)}" title="履歴">履歴</a></td>
      <td>${it.img ? `<img src="${escapeAttr(it.img)}" class="thumb"/>` : ""}</td>
      <td class="text-end">${fmt(it.price)}</td>
      <td class="text-end">${fmt(it.stock)}</td>
      <td class="text-end">${fmt(it.min)}</td>
      <td>${escapeHtml(it.department||"")}</td>
      <td>${escapeHtml(it.location||"")}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary" data-act="edit" data-code="${escapeAttr(it.code)}">編集</button>
      </td>
    </tr>`;
})();


// === PATCH: label 62mm generator ===
async function makeItemLabel62mmDataURL(item){
  const W = 378, H = 236;
  const c = document.createElement('canvas'); c.width=W; c.height=H;
  const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,W,H);
  g.fillStyle='#000'; g.font='700 20px "Noto Sans JP",system-ui'; g.fillText(String(item.code||''), 12, 28);
  g.font='600 18px "Noto Sans JP",system-ui'; g.fillText(String(item.name||''), 12, 56);
  const du = await generateQrDataUrl(`ITEM|${normalizeCodeDash(item.code)}`, 170);
  const im = new Image(); im.src=du; await new Promise(r=>{im.onload=r; im.onerror=r;});
  g.drawImage(im, W-12-170, 12, 170, 170);
  g.font='600 16px "Noto Sans JP",system-ui'; g.fillText(`置: ${(item.location||'')}`, 12, H-40);
  g.fillText(`最小: ${Number(item.min||0)}`, 12, H-16);
  return c.toDataURL('image/png');
}
