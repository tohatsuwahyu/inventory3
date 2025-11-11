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
    for (const p of locals) { try { await loadScriptOnce(p); if (window.QRCode) return; } catch (e) {} }
    const cdns = [
      "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js",
      "https://unpkg.com/qrcodejs@1.0.0/qrcode.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"
    ];
    for (const u of cdns) { try { await loadScriptOnce(u); if (window.QRCode) return; } catch (e) {} }
    throw new Error("QRCode library tidak tersedia (qrlib.js)");
  }

  async function ensureHtml5Qrcode() {
    if (window.Html5Qrcode) return;
    const locals = ["./html5-qrcode.min.js", "./vendor/html5-qrcode.min.js"];
    for (const p of locals) { try { await loadScriptOnce(p); if (window.Html5Qrcode) return; } catch (e) {} }
    const cdns = [
      "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/minified/html5-qrcode.min.js",
      "https://unpkg.com/html5-qrcode@2.3.8/minified/html5-qrcode.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/minified/html5-qrcode.min.js"
    ];
    for (const u of cdns) { try { await loadScriptOnce(u); if (window.Html5Qrcode) return; } catch (e) {} }
    throw new Error("html5-qrcode tidak tersedia");
  }

  function getCurrentUser() { try { return JSON.parse(localStorage.getItem("currentUser") || "null"); } catch (e) { return null; } }
  function setCurrentUser(u) { localStorage.setItem("currentUser", JSON.stringify(u || null)); }
  function logout() { setCurrentUser(null); location.href = "index.html"; }
  function isAdmin() { return (getCurrentUser()?.role || "user").toLowerCase() === "admin"; }

  // --- User hydrator & sync ---
  function readCookie(name){
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g,'\\$1') + '=([^;]*)'));
    try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
  }
  function hydrateCurrentUser(){
    const keys = ["currentUser","authUser","user","loggedInUser","me"];
    for (const k of keys){
      const v = localStorage.getItem(k);
      if (v){ try { const o = JSON.parse(v); if (o && o.id){ setCurrentUser(o); return o; } } catch (e) {} }
    }
    for (const k of keys){
      const v = sessionStorage.getItem(k);
      if (v){ try { const o = JSON.parse(v); if (o && o.id){ setCurrentUser(o); return o; } } catch (e) {} }
    }
    const ck = readCookie("currentUser");
    if (ck){ try { const o = JSON.parse(ck); if (o && o.id){ setCurrentUser(o); return o; } } catch (e) {} }
    if (window.CURRENT_USER && window.CURRENT_USER.id){ setCurrentUser(window.CURRENT_USER); return window.CURRENT_USER; }
    if (window.CONFIG && CONFIG.DEFAULT_USER && CONFIG.DEFAULT_USER.id){
      setCurrentUser(CONFIG.DEFAULT_USER);
      return CONFIG.DEFAULT_USER;
    }
    return null;
  }
  window.addEventListener("storage", (e) => {
    if (e.key === "currentUser") { updateWelcomeBanner(); }
  });

  // === PATCH: print semua label (A4 panjang, 1 label per "halaman") ===
  function bindPrintAllLabels(){
    const btn = document.getElementById('btn-print-all-labels')
      || document.querySelector('[data-action="print-all-labels"]')
      || Array.from(document.querySelectorAll('#view-items .items-toolbar button, #view-items .items-toolbar .btn'))
           .find(b => /全件ラベルを印刷/.test((b.textContent||'').trim()));
    if (!btn) return;

    btn.addEventListener('click', async ()=>{
      try{
        btn.disabled = true;
        const orig = btn.textContent;
        btn.textContent = '生成中...';

        if (!_ITEMS_CACHE.length) {
          const listAll = await api('items', { method:'GET' });
          _ITEMS_CACHE = Array.isArray(listAll) ? listAll : (listAll?.data || []);
        }

        const w = window.open('', '_blank', 'width=1024,height=700');
        if (!w) { alert('ポップアップがブロックされました。'); btn.disabled=false; btn.textContent=orig; return; }

        w.document.write('<meta charset="utf-8">');
        w.document.write('<title>全件ラベル</title>');
        w.document.write('<style>body{font-family:sans-serif;padding:8mm;} img{width:100%;max-width:100%;display:block;margin:6mm auto;} @media print{img{page-break-inside:avoid;}}</style>');
        w.document.write('<h3>全件ラベル</h3>');

        for (const it of _ITEMS_CACHE){
          const url = await makeItemLabelDataURL(it);
          w.document.write(`<img src="${url}" alt="${(it.code||'')}" />`);
        }
        w.document.close();
        w.focus();
        setTimeout(()=>{ try{ w.print(); }catch(e){} }, 600);

        btn.textContent = orig;
        btn.disabled = false;
      }catch(e){
        alert('印刷用ラベルの生成に失敗しました。');
        try{ btn.disabled=false; }catch(_){}
      }
    }, { once:true });
  }

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
    } catch (e) {
      toast("ダッシュボードの読み込みに失敗しました。");
    }
  }

  // --- GANTI fungsi lama updateWelcomeBanner ---
  function updateWelcomeBanner() {
    const who = getCurrentUser();
    const nama = who?.name || who?.id || "ユーザー";
    const roleRaw = (who?.role || "user").toLowerCase();
    const roleJP  = roleRaw === "admin" ? "管理者" : "ユーザー";

    const banner = document.getElementById("welcome-banner");
    if (banner) {
      banner.innerHTML = `ようこそ、<b>${escapeHtml(nama)}</b> さん。<span class="badge-soft" style="margin-left:.4rem">${roleJP}</span>
        <span class="text-muted small">端末、電源、電波確認しましょう。</span>`;
    }
    const welName = document.getElementById("wel-name");
    if (welName) { welName.textContent = `${nama}（${roleJP}）`; }
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
  let LIVE_SEC = Number(localStorage.getItem(LIVE_KEY) || "120");

  function setLiveRefresh(seconds){
    LIVE_SEC = Math.max(0, Number(seconds || 0));
    localStorage.setItem(LIVE_KEY, String(LIVE_SEC));
    startLiveReload();
  }
  function startLiveReload(){
    clearInterval(LIVE_TIMER);
    if (LIVE_SEC <= 0) return;
    LIVE_TIMER = setInterval(async () => {
      try {
        const active = document.querySelector("main section.active")?.id || "";
        api("items", { method: "GET", silent: true }).then(list => {
          _ITEMS_CACHE = Array.isArray(list) ? list : (list?.data || []);
        }).catch(()=>{});
        if (active === "view-dashboard")    renderDashboard();
        if (active === "view-history")      renderHistory();
        if (active === "view-shelf-list")   loadTanaList();
      } catch (e) {}
    }, LIVE_SEC * 1000);
  }

  /* -------------------- Items -------------------- */
  // ukuran tetap untuk tombol agar “操作” simetris
  const ACT_GRID_STYLE = 'display:grid;grid-template-columns:repeat(5,32px);gap:8px;min-width:200px;justify-content:end;';

  // alias agar tombol DL & bulk tidak error meski 62mm belum dibuat
  async function makeItemLabel62mmDataURL(item){ return await makeItemLabelDataURL(item); }

  
function tplItemRow(it){
  const qrid  = `qr-${safeId(it.code)}`;
  const stock = Number(it.stock || 0);
  const min   = Number(it.min   || 0);

  const badge =
    (stock <= 0) ? '<span class="badge bg-secondary ms-1">ゼロ</span>' :
    (stock <= min) ? '<span class="badge bg-danger ms-1">要補充</span>' :
    '<span class="badge bg-success ms-1">OK</span>';

  const dept = it.department
    ? `<span class="badge rounded-pill text-bg-light">${escapeHtml(it.department)}</span>` : '';
  const loc  = it.location
    ? `<span class="badge rounded-pill bg-body-secondary">${escapeHtml(it.location)}</span>` : '';

  const actions = [
    `<button class="btn btn-sm btn-primary btn-edit" data-code="${escapeAttr(it.code)}" title="編集"><i class="bi bi-pencil-square"></i></button>`,
    `<button class="btn btn-sm btn-danger btn-del" data-code="${escapeAttr(it.code)}" title="削除"><i class="bi bi-trash3"></i></button>`,
    `<button class="btn btn-sm btn-outline-success btn-dl" data-code="${escapeAttr(it.code)}" title="ラベルDL"><i class="bi bi-download"></i></button>`,
    `<button class="btn btn-sm btn-outline-warning btn-lotqr" data-code="${escapeAttr(it.code)}" title="Lot QR"><i class="bi bi-qr-code"></i></button>`,
    `<button class="btn btn-sm btn-outline-secondary btn-preview" data-code="${escapeAttr(it.code)}" title="プレビュー"><i class="bi bi-search"></i></button>`
  ].join('');

  return [
    '<tr data-code="', escapeAttr(it.code), '">',
      '<td style="width:36px"><input type="checkbox" class="row-chk" data-code="', escapeAttr(it.code), '"></td>',
      '<td style="width:110px"><div class="tbl-qr-box"><div id="', qrid, '" class="d-inline-block"></div></div></td>',
      '<td>', escapeHtml(it.code), '</td>',
      '<td class="td-name"><a href="#" class="link-underline link-item" data-code="', escapeAttr(it.code), '">', escapeHtml(it.name), '</a></td>',
      '<td>', (it.img ? `<img src="${escapeAttr(it.img)}" alt="" style="height:32px">` : ''), '</td>',
      '<td class="text-end">¥', fmt(it.price), '</td>',
      '<td class="text-end">', fmt(stock), badge, '</td>',
      '<td class="text-end">', fmt(min), '</td>',
      '<td>', dept, '</td>',
      '<td>', loc, '</td>',
      '<td><div class="act-grid" style="display:grid;grid-auto-flow:column;gap:.25rem;place-content:center">', actions, '</div></td>',
    '</tr>'
  ].join('');
}

  async function renderItems(){
    const tbody = $("#tbl-items");

    if (CONFIG.FEATURES && CONFIG.FEATURES.SKELETON) {
      tbody.innerHTML = '<tr><td colspan="10"><div class="skel" style="height:120px"></div></td></tr>';
    }

    try {
      const listAll = await api("items", { method: "GET" });
      _ITEMS_CACHE = Array.isArray(listAll) ? listAll : (Array.isArray(listAll?.data) ? listAll.data : []);

      let page = 0, size = 100;
      function renderPage(){
        const slice = _ITEMS_CACHE.slice(page*size, (page+1)*size);
       if (page === 0) {
  tbody.innerHTML = slice.map(tplItemRow).join("");
  ensureItemsColgroup();
} else {
  tbody.insertAdjacentHTML("beforeend", slice.map(tplItemRow).join(""));
}

        page++;

        // highlight low-stock
        var rows = $$("#tbl-items tr");
        rows.forEach(function(tr){
          var stock = Number((tr.children[5] && tr.children[5].textContent || "0").replace(/[,¥]/g, ""));
          var min   = Number((tr.children[6] && tr.children[6].textContent || "0").replace(/[,¥]/g, ""));
          tr.classList.toggle("row-low", stock <= min);
        });
      }
      renderPage();

      if (_ITEMS_CACHE.length > size) {
        var more = document.createElement("div");
        more.className = "text-center my-3";
        more.innerHTML = '<button id="btn-load-more" class="btn btn-outline-secondary btn-sm">Load more</button>';
        tbody.parentElement.appendChild(more);
        more.addEventListener("click", function(e){
          e.preventDefault();
          renderPage();
          if (page*size >= _ITEMS_CACHE.length) more.remove();
        });
      }

      await ensureQRCode();
      renderRowQRCodes(_ITEMS_CACHE.slice(0, Math.min(size, _ITEMS_CACHE.length)));

    } catch (e) {
      console.error("renderItems()", e);
      toast("商品一覧の読み込みに失敗しました。");
    }

    // === Event delegation untuk kolom 「操作」
    tbody?.addEventListener("click", async (ev)=>{
      const btn = ev.target.closest("button"); if(!btn) return;
      const code = btn.getAttribute("data-code"); if(!code) return;
      const item = _ITEMS_CACHE.find(x => String(x.code) === String(code));
      if (btn.classList.contains("btn-edit")) { openEditItem(code); return; }
      if (btn.classList.contains("btn-del")) {
        if (!isAdmin()) return toast("Akses ditolak (admin only)");
        if (!confirm("削除してもよろしいですか？")) return;
        try{
          const r = await api("deleteItem", { method:"POST", body:{ code }});
          if (r?.ok) { toast("削除しました"); renderItems(); }
          else toast(r?.error || "削除失敗");
        }catch(e){ toast("削除失敗: " + (e?.message||e)); }
        return;
      }
      if (btn.classList.contains("btn-dl")) {
        if (!item) return;
        const url = await makeItemLabel62mmDataURL(item);
        const a = document.createElement("a");
        a.href = url; a.download = `label_${sanitizeFilename(item.code)}.png`; a.click();
        return;
      }
      if (btn.classList.contains("btn-lotqr")) {
        if (!item) return;
        openLotQRModal(item);
        return;
      }
      if (btn.classList.contains("btn-preview")) {
        if (!item) return;
        const url = await makeItemLabelDataURL(item);
        openPreview(url);
        return;
      }
    });

    // simetrikan header kolom terakhir (「操作」)
    try{
      const th = tbody?.closest("table")?.querySelector("thead tr th:last-child");
      if (th) th.style.minWidth = "220px";
    }catch{}
    try { bindPreviewButtons(); } catch(e) {}

  }

  // === render QR di tiap baris items ===
  function renderRowQRCodes(items){
    items = Array.isArray(items) ? items : [];
    for (const it of items){
      const qrid = 'qr-' + safeId(it.code);
      const el = document.getElementById(qrid);
      if (!el) continue;
      el.innerHTML = '';
      try {
        new QRCode(el, {
          text: 'ITEM|' + normalizeCodeDash(it.code),
          width: 64, height: 64,
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch(e){}
    }
  }

  // ---------- LABEL CANVAS ----------
  async function makeItemLabelDataURL(item) {
    const W = 760, H = 260, pad = 18, imgW = 200, gap = 16;
    const QUIET = 16, qrSize = 136, gapQR = 14;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"); g.imageSmoothingEnabled = false;

    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#000"; g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);

    const rx = pad, ry = pad, rw = imgW, rh = H - 2 * pad, r = 18;
    roundRect(g, rx, ry, rw, rh, r, true, true, "#eaf1ff", "#cbd5e1");
    await drawImageIfAny(g, item.img, rx, ry, rw, rh, r);

    const colStart = pad + imgW + gap;
    const qy = pad + ((H - 2 * pad) - qrSize) / 2;
    const qx = colStart + gapQR + QUIET;
    g.fillStyle = "#fff";
    g.fillRect(qx - QUIET, qy - QUIET, qrSize + 2 * QUIET, qrSize + 2 * QUIET);
    try {
      const codeNorm = normalizeCodeDash(item.code);
      const du = await generateQrDataUrl(`ITEM|${codeNorm}`, qrSize);
      const im = new Image(); im.src = du; await imgLoaded(im);
      g.drawImage(im, qx, qy, qrSize, qrSize);
    } catch (e) {}

    const colQRW = qrSize + 2 * QUIET;
    const gridX  = colStart + gapQR + colQRW + gapQR;
    const cellH  = (H - 2 * pad) / 3;
    g.strokeStyle = "#000"; g.lineWidth = 1;
    g.strokeRect(gridX + 0.5, pad + 0.5, W - gridX - pad - 1, H - 2 * pad - 1);
    for (let i = 1; i <= 2; i++) {
      const y = pad + cellH * i;
      g.beginPath(); g.moveTo(gridX + 0.5, y + 0.5); g.lineTo(W - pad - 0.5, y + 0.5); g.stroke();
    }

    const labelWidth = 96;
    const labelX = gridX + 10;
    const valX   = gridX + 10 + labelWidth;
    const valMaxW = W - pad - valX - 10;

    const LBL_FONT = '600 14px "Noto Sans JP", system-ui';
    const VAL_WEIGHT = "700";

    const cells = [
      { title: "コード：",     value: String(item.code || ""),            base: 20, min: 11 },
      { title: "商品名：",     value: String(item.name || ""),            base: 22, min: 11 },
      { title: "部門／置場：", value: [item.department||"", item.location? "／"+String(item.location).toUpperCase():""].join(""), base: 18, min: 11 }
    ];

    cells.forEach((cell, i) => {
      const yTop = pad + i * cellH;
      g.font = LBL_FONT; g.fillStyle = "#000";
      const labelH = 14;
      const ly = yTop + (cellH - labelH) / 2;
      g.textBaseline = "top"; g.textAlign = "left";
      g.fillText(cell.title, labelX, Math.round(ly));

      drawWrapBoxVCenter(
        g, cell.value, valX, yTop + 4, valMaxW, cellH - 8,
        { base: cell.base, min: cell.min, lineGap: 3, weight: VAL_WEIGHT }
      );
    });

    return c.toDataURL("image/png");

    // helpers
    function roundRect(ctx, x, y, w, h, r, fill, stroke, fillColor, border) {
      ctx.save(); ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      if (fill)   { ctx.fillStyle = fillColor || "#eef"; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = border || "#000"; ctx.stroke(); }
      ctx.restore();
    }
    function imgLoaded(im){ return new Promise(res => { im.onload = res; im.onerror = res; }); }
    async function drawImageIfAny(ctx, url, x, y, w, h, rr){
      if (!url){
        ctx.save(); ctx.fillStyle="#3B82F6"; ctx.font='bold 28px "Noto Sans JP", system-ui';
        ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText("画像", x + w/2, y + h/2);
        ctx.restore(); return;
      }
      try{
        const im = new Image(); im.crossOrigin="anonymous"; im.src=url; await imgLoaded(im);
        const s = Math.min(w/im.width, h/im.height), iw = im.width*s, ih = im.height*s;
        const ix = x + (w - iw)/2, iy = y + (h - ih)/2;
        ctx.save(); ctx.beginPath();
        ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr); ctx.closePath(); ctx.clip();
        ctx.drawImage(im, ix, iy, iw, ih); ctx.restore();
      } catch (e) {}
    }

    function measureLines(ctx, text, maxW){
      const tokens = String(text ?? "").split(/(\s+)/);
      const lines = []; let line = "";
      const push = (tok) => {
        if (ctx.measureText(tok).width <= maxW) {
          const t = line + tok;
          if (!line || ctx.measureText(t).width <= maxW) line = t;
          else { lines.push(line.trim()); line = tok.trimStart(); }
        } else {
          for (const ch of Array.from(tok)) {
            const t = line + ch;
            if (!line || ctx.measureText(t).width <= maxW) line = t;
            else { lines.push(line.trim()); line = ch; }
          }
        }
      };
      tokens.forEach(push);
      if (line) lines.push(line.trim());
      return lines;
    }

    function drawWrapBoxVCenter(ctx, text, x, yTop, maxW, maxH, opt={}){
      const base = opt.base || 18, min = opt.min || 12, gap = opt.lineGap || 4;
      const fam  = '"Noto Sans JP", system-ui';
      const weight = opt.weight || "normal";
      let size = base, lines;
      while (true){
        ctx.font = `${weight} ${size}px ${fam}`;
        lines = measureLines(ctx, text, maxW);
        const totalH = lines.length * size + (lines.length - 1) * gap;
        if (totalH <= maxH || size <= min) break;
        size -= 1;
      }
      const totalH = lines.length * size + (lines.length - 1) * gap;
      let y = yTop + (maxH - totalH) / 2;
      ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillStyle = "#000";
      for (const ln of lines){
        ctx.fillText(ln, x, Math.round(y));
        y += size + gap;
        if (y - yTop > maxH) break;
      }
    }
  } // end makeItemLabelDataURL

  async function generateQrDataUrl(text, size) {
    await ensureQRCode();
    return await new Promise((resolve) => {
      const tmp = document.createElement("div");
      Object.assign(tmp.style, {
        position: "fixed", left: "-9999px", top: "0", width: size + "px", height: size + "px"
      });
      document.body.appendChild(tmp);

      new QRCode(tmp, { text, width: size, height: size, correctLevel: QRCode.CorrectLevel.M });

      const grab = () => {
        const node = tmp.querySelector("img,canvas");
        if (!node) return "";
        try { return node.tagName === "IMG" ? node.src : node.toDataURL("image/png"); }
        catch (e) { return ""; }
      };

      let tries = 0;
      (function waitRender() {
        const url = grab();
        if (url || tries >= 5) {
          document.body.removeChild(tmp);
          resolve(url || "");
          return;
        }
        tries++; setTimeout(waitRender, 30);
      })();
    });
  }

  // === LOT label (pakai layout item, QR diganti LOT + caption) ===
  async function makeLotLabelDataURL(item, qtyPerBox, lotId) {
    const base = await makeItemLabelDataURL(item);
    const im = new Image(); im.src = base;
    await new Promise(r => { im.onload = r; im.onerror = r; });

    const W = im.width, H = im.height;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"); g.imageSmoothingEnabled = false;

    g.drawImage(im, 0, 0);

    const pad = 18, imgW = 200, gap = 16;
    const QUIET = 16, qrSize = 136, gapQR = 14;
    const colStart = pad + imgW + gap;
    const qy = pad + ((H - 2 * pad) - qrSize) / 2;
    const qx = colStart + gapQR + QUIET;

    try {
      const codeNorm = normalizeCodeDash(item.code);
      const txt = lotId ? `LOT|${codeNorm}|${qtyPerBox}|${lotId}` : `LOT|${codeNorm}|${qtyPerBox}`;
      const du = await generateQrDataUrl(txt, qrSize);
      const qr = new Image(); qr.src = du;
      await new Promise(r => { qr.onload = r; qr.onerror = r; });
      g.fillStyle = "#fff"; g.fillRect(qx - QUIET, qy - QUIET, qrSize + 2 * QUIET, qrSize + 2 * QUIET);
      g.drawImage(qr, qx, qy, qrSize, qrSize);
    } catch (e) {}

    const capW = qrSize + 2 * QUIET;
    const capH = 40;
    const capX = colStart + gapQR;
    const capY = qy + qrSize + 6;

    g.fillStyle = "#ffffff";
    g.fillRect(capX, capY, capW, capH);
    g.strokeStyle = "#d1d5db";
    g.lineWidth = 1;
    g.strokeRect(capX + 0.5, capY + 0.5, capW - 1, capH - 1);

    g.fillStyle = "#111";
    g.textAlign = "center";
    g.textBaseline = "top";
    g.font = '700 14px "Noto Sans JP", system-ui';
    g.fillText(`箱あたり：${Number(qtyPerBox || 0)} pcs`, capX + capW / 2, capY + 6);

    if ((lotId || "").trim()) {
      g.font = '600 12px "Noto Sans JP", system-ui';
      g.fillStyle = "#374151";
      g.fillText(`ロット：${String(lotId)}`, capX + capW / 2, capY + 22);
    }

    return c.toDataURL("image/png");
  }

  /* -------------------- Users -------------------- */
  async function renderUsers() {
    try {
      const who = getCurrentUser();
      const list = await api("users", { method: "GET" });
      let arr = Array.isArray(list) ? list : (Array.isArray(list?.data) ? list.data : []);

      const admin = isAdmin();

      $("#btn-users-import")?.classList.toggle("d-none", !admin);
      $("#btn-users-export")?.classList.toggle("d-none", !admin);
      $("#btn-print-qr-users")?.classList.toggle("d-none", !admin);
      $("#btn-open-new-user")?.classList.toggle("d-none", !admin);

      if (!admin && who) {
        arr = arr.filter(u => String(u.id) === String(who.id));
      }

      const tbody = $("#tbl-userqr");
      tbody.innerHTML = arr.map(u => {
        const uidSafe = safeId(u.id);
        return `
        <tr>
          <td style="width:170px"><div id="uqr-${uidSafe}"></div></td>
          <td>${escapeHtml(u.id)}</td>
          <td>${escapeHtml(u.name)}</td>
          <td>${escapeHtml(u.role || "user")}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-success btn-dl-user" data-id="${escapeAttr(u.id)}" title="ダウンロード">
              <i class="bi bi-download"></i>
            </button>
          </td>
        </tr>`;
      }).join("");

      await ensureQRCode();
      for (const u of arr) {
        const el = document.getElementById(`uqr-${safeId(u.id)}`);
        if (!el) continue;
        el.innerHTML = ""; new QRCode(el, { text: `USER|${u.id}`, width: 64, height: 64, correctLevel: QRCode.CorrectLevel.M });
      }

      tbody.addEventListener("click", async (e) => {
        const b = e.target.closest(".btn-dl-user"); if (!b) return;
        const id = b.getAttribute("data-id");
        const url = await generateQrDataUrl(`USER|${id}`, 300);
        const a = document.createElement("a"); a.href = url; a.download = `user_${id}.png`; a.click();
      });

      const right = $("#print-qr-users-grid");
      if (right) {
        if (!admin && who) {
          right.innerHTML = `
            <div class="card p-3 w-100">
              <div class="fw-semibold mb-2">ユーザー情報</div>
              <div class="d-flex align-items-center gap-3">
                <div id="me-qr"></div>
                <div class="small">
                  <div><b>ID</b>：${escapeHtml(who.id || "")}</div>
                  <div><b>氏名</b>：${escapeHtml(who.name || "")}</div>
                  <div><b>ユーザー</b>：${escapeHtml(who.role || "user")}</div>
                  <div><b>PIN</b>：<span class="text-muted">（非表示）</span></div>
                </div>
              </div>
            </div>`;
          const box = document.getElementById("me-qr");
          if (box) { new QRCode(box, { text: `USER|${who.id}`, width: 120, height: 120 }); }
        } else {
          right.innerHTML = `<div class="text-muted small">印刷するユーザーQRを左の表から選択してダウンロードしてください。</div>`;
        }
      }
    } catch (e) { toast("ユーザーQRの読み込みに失敗しました。"); }
  }

  // New User (admin only)
  function openNewUser() {
    if (!isAdmin()) return toast("Akses ditolak (admin only)");
    const wrap = document.createElement("div");
    wrap.className = "modal fade";
    wrap.innerHTML = `
<div class="modal-dialog">
  <div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">新規ユーザー</h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <div class="row g-3">
        <div class="col-md-4"><label class="form-label">ID</label><input id="nu-id" class="form-control" placeholder="USER001"></div>
        <div class="col-md-5"><label class="form-label">氏名</label><input id="nu-name" class="form-control"></div>
        <div class="col-md-3"><label class="form-label">権限</label>
          <select id="nu-role" class="form-select"><option value="user">user</option><option value="admin">admin</option></select>
        </div>
      </div>
      <div class="small text-muted mt-2">PIN の設定は別途（GAS 側）で行ってください。</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-bs-dismiss="modal">閉じる</button>
      <button class="btn btn-primary" id="nu-save">作成</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap); modal.show();
    $("#nu-save", wrap)?.addEventListener("click", async () => {
      const id = ($("#nu-id", wrap).value || "").trim();
      const name = $("#nu-name", wrap).value || "";
      const role = $("#nu-role", wrap).value || "user";
      if (!id) return toast("ID を入力してください。");
      try {
        const r = await api("upsertUser", { method: "POST", body: { id, name, role } });
        if (r?.ok) { modal.hide(); wrap.remove(); renderUsers(); toast("作成しました"); }
        else toast(r?.error || "作成失敗");
      } catch (e) { toast("作成失敗: " + (e?.message || e)); }
    });
    wrap.addEventListener("hidden.bs.modal", () => wrap.remove(), { once: true });
  }

  /* -------------------- History -------------------- */
  async function renderHistory() {
    try {
      const raw = await api("history", { method: "GET" });
      const list = Array.isArray(raw) ? raw
        : Array.isArray(raw?.history) ? raw.history
          : Array.isArray(raw?.data) ? raw.data
            : [];
      const tbody = $("#tbl-history");
      const recent = list.slice(-400).reverse();
      tbody.innerHTML = recent.map(h => `
        <tr>
          <td>${escapeHtml(h.timestamp || h.date || "")}</td>
          <td>${escapeHtml(h.userId || "")}</td>
          <td>${escapeHtml(h.userName || "")}</td>
          <td>${escapeHtml(h.code || "")}</td>
          <td>${escapeHtml(h.itemName || h.name || "")}</td>
          <td class="text-end">${fmt(h.qty || 0)}</td>
          <td>${escapeHtml(h.unit || "")}</td>
          <td>${escapeHtml(h.type || "")}</td>
          <td>${escapeHtml(h.note || "")}</td>
          <td></td>
        </tr>
      `).join("");
      ensureViewAutoMenu("history", "#view-history .items-toolbar .right");
    } catch (e) { toast("履歴の読み込みに失敗しました。"); }
  }

  /* -------------------- IO Scanner -------------------- */
  let IO_SCANNER = null;

  function bindIO() {
    const btnStart = $("#btn-io-scan"),
          btnStop  = $("#btn-io-stop"),
          area     = $("#io-scan-area");
    if (!btnStart || !btnStop || !area) return;

    const ioCode = document.getElementById("io-code");
    if (ioCode) {
      let timer = null;
      ioCode.addEventListener("input", (e) => {
        clearTimeout(timer);
        const v = (e.target.value || "").trim();
        if (!v) {
          const n = document.getElementById("io-name");
          const p = document.getElementById("io-price");
          const s = document.getElementById("io-stock");
          if (n) n.value = ""; if (p) p.value = ""; if (s) s.value = "";
          return;
        }
        timer = setTimeout(() => findItemIntoIO(v), 220);
      });
      ioCode.addEventListener("blur", () => {
        const v = (ioCode.value || "").trim();
        if (v) findItemIntoIO(v);
      });
      ioCode.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const v = (ioCode.value || "").trim();
          if (v) findItemIntoIO(v);
        }
      });
    }

    btnStart.addEventListener("click", async () => {
      try {
        area.textContent = "カメラ起動中…";
        IO_SCANNER = await startBackCameraScan("io-scan-area", async (text) => {
          const parsed = parseScanText(String(text || ""));
          if (!parsed) return;

          if (parsed.kind === "item") {
            const code = parsed.code;
            $("#io-code").value = code;
            await findItemIntoIO(code);
            if (confirm("この商品を追加してもよろしいですか？")) {
              // user isi qty lalu submit manual
            }
            return;
          }

          if (parsed.kind === "lot") {
            const { code, qty, lot } = parsed;
            $("#io-code").value = code;
            await findItemIntoIO(code);

            const unit = $("#io-unit").value || "pcs";
            const type = $("#io-type").value || "IN";
            const who  = getCurrentUser();
            if (!who) return toast("ログイン情報がありません。");

            if (confirm("この商品を追加してもよろしいですか？")) {
              try {
                const r = await api("log", { method: "POST", body: {
                  userId: who.id, code, qty: Number(qty || 0), unit, type,
                  note: lot ? `LOT:${lot} x ${qty}` : `LOT x ${qty}`
                }});
                if (r?.ok) {
                  toast("登録しました");
                  $("#io-qty").value = "";
                  await findItemIntoIO(code);
                  renderDashboard();
                } else {
                  toast(r?.error || "登録失敗");
                }
              } catch(e){ toast("登録失敗: " + (e?.message || e)); }
            }
            return;
          }
        });
      } catch (e) { toast(e?.message || String(e)); }
    });

    btnStop.addEventListener("click", async () => {
      try { await IO_SCANNER?.stop?.(); IO_SCANNER?.clear?.(); } catch (e) {}
      area.innerHTML = "カメラ待機中…";
    });

    $("#btn-io-lookup")?.addEventListener("click", (e) => {
      e.preventDefault();
      const code = ($("#io-code").value || "").trim();
      if (code) findItemIntoIO(code);
    });

    $("#form-io")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const who = getCurrentUser(); if (!who) return toast("ログイン情報がありません。");
      const code = $("#io-code").value, qty = Number($("#io-qty").value || 0);
      const unit = $("#io-unit").value, type = $("#io-type").value;
      try {
        const r = await api("log", { method: "POST", body: { userId: who.id, code, qty, unit, type } });
        if (r?.ok) { toast("登録しました"); $("#io-qty").value = ""; await findItemIntoIO(code); renderDashboard(); }
        else toast(r?.error || "登録失敗");
      } catch (e2) { toast("登録失敗: " + (e2?.message || e2)); }
    });
  }

  async function startBackCameraScan(mountId, onScan, boxSize) {
    const isPhone = isMobile();
    const qrboxSize = boxSize ?? (isPhone ? 220 : 240);
    const mount = document.getElementById(mountId);
    if (mount) Object.assign(mount.style, { maxWidth: "420px", margin: "0 auto", aspectRatio: "4/3", position: "relative" });

    if ("BarcodeDetector" in window) {
      try {
        const ok = await (async () => {
          let stream;
          const video = Object.assign(document.createElement("video"), { playsInline: true, autoplay: true, muted: true });
          Object.assign(video.style, { width: "100%", height: "100%", objectFit: "cover" });
          mount.innerHTML = ""; mount.appendChild(video);

          const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
          const back = devs.find(d => /back|rear|environment/i.test(d.label)) || devs.at(-1);
          const constraints = {
            audio: false,
            video: {
              deviceId: back ? { exact: back.deviceId } : { ideal: "environment" },
              width: { ideal: 1280 }, height: { ideal: 720 },
              focusMode: "continuous", exposureMode: "continuous"
            }
          };
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          video.srcObject = stream;

          await new Promise(r => setTimeout(r, 500));

          const detector = new BarcodeDetector({ formats: ["qr_code"] });
          let raf = 0, stopped = false;
          const loop = async () => {
            if (stopped) return;
            try {
              const codes = await detector.detect(video);
              if (codes?.length) {
                const txt = codes[0].rawValue || "";
                if (txt) { stop(); onScan(txt); return; }
              }
            } catch (e) { }
            raf = requestAnimationFrame(loop);
          };
          const stop = () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks()?.forEach(t => t.stop()); mount.innerHTML = ""; };
          loop();
          return { stop: async () => stop(), clear: () => { try { mount.innerHTML = ""; } catch (e) { } } };
        })();
        if (ok) return ok;
      } catch (e) { console.warn("Native detector gagal → fallback html5-qrcode", e); }
    }

    await ensureHtml5Qrcode();
    const formatsOpt = (window.Html5QrcodeSupportedFormats && Html5QrcodeSupportedFormats.QR_CODE)
      ? { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] }
      : {};
    const cfg = {
      fps: 30,
      qrbox: { width: qrboxSize, height: qrboxSize },
      aspectRatio: 1.33,
      rememberLastUsedCamera: true,
      disableFlip: true,
      videoConstraints: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        focusMode: "continuous",
        exposureMode: "continuous"
      },
      ...formatsOpt
    };
    const scanner = new Html5Qrcode(mountId, { useBarCodeDetectorIfSupported: true });
    async function startWith(source) {
      await scanner.start(source, cfg, txt => onScan(txt));
      try {
        await new Promise(r => setTimeout(r, 600));
        await scanner.applyVideoConstraints({ advanced: [{ focusMode: "continuous" }, { exposureMode: "continuous" }, { zoom: 3 }] }).catch(() => { });
      } catch (e) { }
      return scanner;
    }
    try { return await startWith({ facingMode: "environment" }); }
    catch (e) {
      const cams = await Html5Qrcode.getCameras();
      if (!cams?.length) throw new Error("カメラが見つかりません。権限をご確認ください。");
      const back = cams.find(c => /back|rear|environment/i.test(c.label)) || cams.at(-1);
      return await startWith({ deviceId: { exact: back.id } });
    }
  }

  // Parser QR
  function parseScanText(txt) {
    const s = String(txt || "").trim();

    if (/^ITEM\|/i.test(s)) {
      const code = normalizeCodeDash((s.split("|")[1] || "").trim());
      return { kind: "item", code };
    }
    if (/^LOT\|/i.test(s)) {
      const [, codeRaw, qtyRaw, lotRaw] = s.split("|");
      const code = normalizeCodeDash(codeRaw || "");
      const qty  = Number(qtyRaw || 0) || 0;
      const lot  = (lotRaw || "").trim();
      if (code && qty > 0) return { kind: "lot", code, qty, lot };
    }
    try {
      const o = JSON.parse(s);
      if ((o.t === "item" || o.type === "item") && o.code) {
        return { kind: "item", code: normalizeCodeDash(String(o.code)) };
      }
      if ((o.t === "lot" || o.type === "lot") && o.code && Number(o.qty || 0) > 0) {
        return { kind: "lot", code: normalizeCodeDash(String(o.code)), qty: Number(o.qty), lot: String(o.lot || "") };
      }
    } catch (e) {}
    return null;
  }

  // IO lookup form
  async function findItemIntoIO(codeRaw) {
    const code = normalizeCodeDash(String(codeRaw || "")).trim();
    const nameEl  = document.getElementById("io-name");
    const priceEl = document.getElementById("io-price");
    const stockEl = document.getElementById("io-stock");
    if (!nameEl || !priceEl || !stockEl) return;

    nameEl.value  = "";
    priceEl.value = "";
    stockEl.value = "";

    let item = _ITEMS_CACHE.find(x => String(x.code) === code);
    if (!item) {
      try {
        const r = await api("itemByCode", { method: "POST", body: { code }, silent: true });
        if (r?.ok && r.item) item = r.item;
      } catch (e) {}
    }

    if (item) {
      nameEl.value  = item.name || "";
      priceEl.value = Number(item.price || 0);
      stockEl.value = Number(item.stock || 0);
    }
    return item;
  }

  /* -------------------- Stocktake (棚卸) -------------------- */
  let SHELF_SCANNER = null;
  const ST = { rows: new Map() };

  const ST_DRAFT_KEY = "shelfDraftV1";
  function saveShelfDraft(){
    try{
      const arr = [...ST.rows.values()];
      const data = { at: new Date().toISOString(), rows: arr };
      localStorage.setItem(ST_DRAFT_KEY, JSON.stringify(data));
      toast("下書きを保存しました");
    }catch(e){ toast("保存失敗: " + (e?.message || e)); }
  }
  function loadShelfDraft(){
    try{
      const raw = localStorage.getItem(ST_DRAFT_KEY);
      if(!raw){ return toast("下書きがありません"); }
      const data = JSON.parse(raw||"{}");
      const map = new Map();
      (data.rows||[]).forEach(r => { 
        const book = Number(r.book||0), qty=Number(r.qty||0);
        map.set(String(r.code), { code:String(r.code), name:r.name, department:(r.department||""), book, qty, diff: qty - book });
      });
      ST.rows = map;
      renderShelfTable();
      toast("下書きを読み込みました");
    }catch(e){ toast("読込失敗: " + (e?.message || e)); }
  }
  function clearShelfDraft(){
    try{ localStorage.removeItem(ST_DRAFT_KEY); toast("下書きを削除しました"); }catch (e) {}
  }

  window.ST = ST;

  async function addOrUpdateStocktake(code, realQty) {
    if (!code) return;
    let item = _ITEMS_CACHE.find(x => String(x.code) === String(code));
    if (!item) { const r = await api("itemByCode", { method: "POST", body: { code } }); if (r?.ok) item = r.item; }
    if (!item) return toast("アイテムが見つかりません: " + code);
    const book = Number(item.stock || 0);
    const qty = Number(realQty ?? book);
    const diff = qty - book;
    ST.rows.set(code, { code, name: item.name, department: (item.department || ""), book, qty, diff });
    renderShelfTable();
  }
  async function addOrIncStocktake(code, delta) {
    if (!code || !delta) return;
    let item = _ITEMS_CACHE.find(x => String(x.code) === String(code));
    if (!item) { const r = await api("itemByCode", { method: "POST", body: { code } }); if (r?.ok) item = r.item; }
    if (!item) return toast("アイテムが見つかりません: " + code);

    const row = ST.rows.get(code);
    const book = Number(item.stock || 0);
    const currentQty = row ? Number(row.qty || 0) : book;
    const newQty = currentQty + Number(delta);
    ST.rows.set(code, { code, name: item.name, department: (item.department || ""), book, qty: newQty, diff: newQty - book });
    renderShelfTable();
  }

  function renderShelfTable() {
    const tbody = $("#tbl-stocktake"); if (!tbody) return;
    const isadmin = isAdmin();
    const arr = [...ST.rows.values()];
    tbody.innerHTML = arr.map(r => `
      <tr data-code="${escapeAttr(r.code)}">
        <td>${escapeHtml(r.code)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.department || "")}</td>
        <td class="text-end">${fmt(r.book)}</td>
        <td class="text-end"><input type="number" class="form-control form-control-sm st-qty" value="${r.qty}"></td>
        <td class="text-end ${r.diff === 0 ? "" : "fw-bold"}">${fmt(r.qty - r.book)}</td>
        <td class="text-end">
          <div class="st-actions d-inline-flex gap-2">
            ${isadmin ? `<button class="btn btn-outline-primary btn-st-adjust btn-sm">Edit</button>` : ""}
            <button class="btn btn-outline-danger btn-st-del btn-sm">削除</button>
          </div>
        </td>
      </tr>
    `).join("");

    const sumEl = $("#st-summary");
    if (sumEl) {
      const total = arr.length;
      const diffRows = arr.filter(x => (x.diff||0) !== 0).length;
      const diffSum = arr.reduce((a,b)=>a+Number(b.diff||0),0);
      const absSum  = arr.reduce((a,b)=>a+Math.abs(Number(b.diff||0)),0);
      sumEl.textContent = `件数: ${total} ／ 差異あり: ${diffRows} ／ 差異合計: ${fmt(diffSum)} ／ 絶対差異: ${fmt(absSum)}`;
    }

    tbody.oninput = (e) => {
      const tr = e.target.closest("tr"); if (!tr) return;
      if (!e.target.classList.contains("st-qty")) return;

      const code = tr.getAttribute("data-code");
      const rec = ST.rows.get(code); if (!rec) return;

      rec.qty = Number(e.target.value || 0);
      rec.diff = rec.qty - rec.book;

      tr.children[5].textContent = fmt(rec.diff);
      tr.children[5].classList.toggle("fw-bold", rec.diff !== 0);

      const arr2 = [...ST.rows.values()];
      const sumEl2 = $("#st-summary");
      if (sumEl2){
        const diffRows = arr2.filter(x => (x.diff||0) !== 0).length;
        const diffSum  = arr2.reduce((a,b)=>a+Number(b.diff||0),0);
        const absSum   = arr2.reduce((a,b)=>a+Math.abs(Number(b.diff||0)),0);
        sumEl2.textContent = `件数: ${arr2.length} ／ 差異あり: ${diffRows} ／ 差異合計: ${fmt(diffSum)} ／ 絶対差異: ${fmt(absSum)}`;
      }
    };

    tbody.onclick = (e) => {
      const tr = e.target.closest("tr"); if (!tr) return; 
      const code = tr.getAttribute("data-code"); const rec = ST.rows.get(code); if (!rec) return;
      if (e.target.closest(".btn-st-adjust")) { if (!isAdmin()) return toast("Akses ditolak (admin only)"); openEditItem(code); }
      if (e.target.closest(".btn-st-del")) {
        ST.rows.delete(code);
        renderShelfTable();
      }
    };
  }

  function bindShelf() {
    const toolbarRight = document.querySelector('#view-shelf .items-toolbar .right');
    if (toolbarRight && !toolbarRight.querySelector('.st-controls')) {
      const wrap = document.createElement('div');
      wrap.className = 'st-controls d-flex align-items-center gap-2 flex-wrap';
      wrap.innerHTML = `
        <div class="form-check form-switch m-0">
          <input class="form-check-input" type="checkbox" id="st-diff-only">
          <label class="form-check-label small" for="st-diff-only">差異のみ</label>
        </div>
        <button id="st-save"   class="btn btn-sm btn-outline-secondary">下書き保存</button>
        <button id="st-load"   class="btn btn-sm btn-outline-secondary">読込</button>
        <button id="st-clear"  class="btn btn-sm btn-outline-danger">クリア</button>
        <button id="st-commit" class="btn btn-sm btn-primary">確定（在庫更新）</button>
      `;
      toolbarRight.appendChild(wrap);
    }

    const btnStart = $("#btn-start-scan"), btnStop = $("#btn-stop-scan"), area = $("#scan-area");
    if (!btnStart || !btnStop || !area) return;

    btnStart.addEventListener("click", async () => {
      try {
        area.textContent = "カメラ起動中…";
        SHELF_SCANNER = await startBackCameraScan("scan-area", async (text) => {
          const p = parseScanText(String(text || ""));
          if (!p) return;
          if (p.kind === "item") {
            if (confirm("この商品を追加してもよろしいですか？")) {
              await addOrUpdateStocktake(p.code, ST.rows.get(p.code)?.qty ?? undefined);
            }
            return;
          }
          if (p.kind === "lot") {
            if (confirm("この商品を追加してもよろしいですか？")) {
              await addOrIncStocktake(p.code, Number(p.qty || 0));
            }
            return;
          }
        });
      } catch (e) { toast(e?.message || String(e)); }
    });

    btnStop.addEventListener("click", async () => {
      try { await SHELF_SCANNER?.stop?.(); SHELF_SCANNER?.clear?.(); } catch (e) {}
      area.innerHTML = "カメラ待機中…";
    });

    $("#st-filter")?.addEventListener("input", (e) => {
      const q = (e.target.value || "").toLowerCase();
      $$("#tbl-stocktake tr").forEach(tr => {
        const code = (tr.children[0]?.textContent || "").toLowerCase();
        const name = (tr.children[1]?.textContent || "").toLowerCase();
        tr.style.display = (code.includes(q) || name.includes(q)) ? "" : "none";
      });
    });

    $("#st-add")?.addEventListener("click", async (e) => {
      e.preventDefault();
      const code = ($("#st-code").value || "").trim();
      const qty = Number($("#st-qty").value || 0);
      if (!code) return;
      await addOrUpdateStocktake(code, qty || undefined);
      $("#st-code").value = ""; $("#st-qty").value = "";
    });
  }

  /* -------------------- Export / Import (JP) -------------------- */

  // Users print
  $("#btn-print-qr-users")?.addEventListener("click", () => window.print());

  // Users export/import (JP headers)
  $("#btn-users-export")?.addEventListener("click", async () => {
    try {
      const list = await api("users", { method: "GET" });
      const arr = Array.isArray(list) ? list : (list?.data || []);
      const heads = ["ユーザーID","氏名","権限"];
      const csv = [heads.join(",")]
        .concat(arr.map(u => [
          u.id,
          String(u.name || "").replace(/,/g, " "),
          (u.role || "user")
        ].join(","))).join("\n");
      downloadCSV_JP("ユーザー一覧.csv", csv);
    } catch (e) { alert("エクスポート失敗"); }
  });
  $("#btn-users-import")?.addEventListener("click", () => {
    if (!isAdmin()) return alert("権限がありません（admin のみ）");
    $("#input-users-import")?.click();
  });
  $("#input-users-import")?.addEventListener("change", async (e) => {
    if (!isAdmin()) return alert("権限がありません（admin のみ）");
    const f = e.target.files?.[0]; if (!f) return;
    const text = await f.text();
    const rows = text.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
    const start = rows[0]?.includes("ユーザーID") ? 1 : 0;
    let ok = 0, fail = 0;
    for (let i = start; i < rows.length; i++) {
      const [id, name, role] = rows[i].split(",").map(s => s?.trim());
      if (!id) { fail++; continue; }
      try { await api("upsertUser", { method: "POST", body: { id, name, role: (role || "user") } }); ok++; }
      catch (e) { fail++; }
    }
    alert(`インポート完了：成功 ${ok} 件 / 失敗 ${fail} 件`); e.target.value = ""; renderUsers();
  });

  // Items export (CSV) + Excel (JP)
  $("#btn-items-export")?.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const list = await api("items", { method: "GET" });
      const arr = Array.isArray(list) ? list : (list?.data || []);
      const heads = ["コード","品名","価格","在庫","最小","置場","部門","画像"];
      const csv = [heads.join(",")]
        .concat(arr.map(i => [
          i.code,
          String(i.name || "").replace(/,/g, " "),
          Number(i.price || 0),
          Number(i.stock || 0),
          Number(i.min || 0),
          String(i.location || "").toUpperCase(),
          String(i.department || "").replace(/,/g, " "),
          i.img || ""
        ].join(",")))
        .join("\n");
      downloadCSV_JP("商品.csv", csv);
    } catch (e) { alert("エクスポート失敗"); }
  });

  $("#btn-items-xlsx")?.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const list = await api("items", { method: "GET" });
      const arr = Array.isArray(list) ? list : (list?.data || []);
      const rows = arr.map(i => ({
        "コード": i.code,
        "品名": i.name || "",
        "価格": Number(i.price || 0),
        "在庫": Number(i.stock || 0),
        "最小": Number(i.min || 0),
        "置場": String(i.location || "").toUpperCase(),
        "部門": i.department || "",
        "画像": i.img || ""
      }));
      const ws = XLSX.utils.json_to_sheet(rows, { header: ["コード","品名","価格","在庫","最小","置場","部門","画像"] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "商品");
      XLSX.writeFile(wb, "商品.xlsx");
    } catch (e) { alert("エクスポート失敗"); }
  });

  // Items import (CSV) — dukung header JP atau EN
  $("#btn-items-import")?.addEventListener("click", () => $("#input-items-import")?.click());
  $("#input-items-import")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    const rows = text.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
    const head = (rows[0] || "").toLowerCase();
    const jp = head.includes("コード");
    const start = (head.includes("code") || jp) ? 1 : 0;
    let ok = 0, fail = 0;
    for (let i = start; i < rows.length; i++) {
      const cols = rows[i].split(",").map(s => s?.trim());
      const [code,name,price,stock,min,location,department,img] = jp
        ? [cols[0], cols[1], cols[2], cols[3], cols[4], cols[5], cols[6], cols[7]]
        : [cols[0], cols[1], cols[2], cols[3], cols[4], cols[5], cols[7], cols[6]];
      if (!code) { fail++; continue; }
      try {
        await api("updateItem", {
          method: "POST", body: {
            code, name,
            price: Number(price || 0), stock: Number(stock || 0), min: Number(min || 0),
            location: (location || "").toUpperCase(), img, department: (department || "").trim(), overwrite: true
          }
        });
        ok++;
      } catch (e) { fail++; }
    }
    alert(`インポート完了：成功 ${ok} 件 / 失敗 ${fail} 件`); e.target.value = ""; renderItems();
  });

  // IO export/import (CSV JP)
  $("#btn-io-export")?.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const raw = await api("history", { method: "GET" });
      const list = Array.isArray(raw) ? raw : (raw?.history || raw?.data || []);
      const recent = list.slice(-200);
      const heads = ["日時","ユーザーID","コード","数量","単位","種別","備考"];
      const csv = [heads.join(",")]
        .concat(recent.map(h => [
          h.timestamp || h.date || "", h.userId || "", h.code || "", h.qty || 0, h.unit || "", h.type || "", (h.note || "").replace(/,/g, " ")
        ].join(","))).join("\n");
      downloadCSV_JP("入出庫履歴.csv", csv);
    } catch (e) { alert("エクスポート失敗"); }
  });
  $("#btn-io-import")?.addEventListener("click", (e) => {
    e.preventDefault(); $("#input-io-import")?.click();
  });
  $("#input-io-import")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const text = await f.text();
    const rows = text.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
    const start = rows[0]?.includes("ユーザーID") || rows[0]?.toLowerCase?.().includes("user") ? 1 : 0;
    let ok = 0, fail = 0;
    for (let i = start; i < rows.length; i++) {
      const [userId, code, qty, unit, type, note] = rows[i].split(",").map(s => s?.trim());
      if (!userId || !code) { fail++; continue; }
      try { await api("log", { method: "POST", body: { userId, code, qty: Number(qty || 0), unit, type, note } }); ok++; }
      catch (e) { fail++; }
    }
    alert(`インポート完了：成功 ${ok} 件 / 失敗 ${fail} 件`); e.target.value = "";
  });

  // 履歴 CSV (JP)
  $("#btn-history-export")?.addEventListener("click", async () => {
    try {
      const raw = await api("history", { method: "GET" });
      const list = Array.isArray(raw) ? raw : (raw?.history || raw?.data || []);
      const heads = ["日時","ユーザーID","ユーザー名","コード","品名","数量","単位","種別","備考"];
      const csv = [heads.join(",")]
        .concat(list.map(h => [
          h.timestamp || h.date || "",
          h.userId || "",
          h.userName || "",
          h.code || "",
          (h.itemName || h.name || "").replace(/,/g, " "),
          h.qty || 0,
          h.unit || "",
          h.type || "",
          (h.note || "").replace(/,/g, " ")
        ].join(","))).join("\n");
      downloadCSV_JP("履歴.csv", csv);
    } catch (e) { alert("エクスポート失敗"); }
  });
// === Fix lebar kolom: sejajarkan dengan header ==================
function ensureItemsColgroup(){
  const tb = document.getElementById('tbl-items');
  if(!tb) return;
  const table = tb.closest('table');
  if(!table || table.__colgroupPatched) return;

  const cg = document.createElement('colgroup');
  cg.innerHTML = `
    <col style="width:36px">
    <col style="width:110px">
    <col style="width:160px">
    <col>
    <col style="width:72px">
    <col style="width:110px">
    <col style="width:80px">
    <col style="width:80px">
    <col style="width:100px">
    <col style="width:90px">
    <col style="width:220px">
  `;
  table.insertBefore(cg, table.firstElementChild);
  table.style.tableLayout = 'fixed';
  table.__colgroupPatched = true;
}

  /* -------------------- Tanaoroshi List (menu baru) -------------------- */
  const JP_TANA_MAP = {
    date:'日付', code:'コード', name:'品名', qty:'数量', unit:'単位',
    location:'場所', department:'部門', userId:'担当者', note:'備考'
  };
  function tanaJPHeaders(){ return Object.values(JP_TANA_MAP); }
  function tanaToJPRow(r){
    return {
      [JP_TANA_MAP.date]: r.date || '',
      [JP_TANA_MAP.code]: r.code || '',
      [JP_TANA_MAP.name]: r.name || '',
      [JP_TANA_MAP.qty] : String(r.qty ?? ''),
      [JP_TANA_MAP.unit]: r.unit || 'pcs',
      [JP_TANA_MAP.location]: r.location || '',
      [JP_TANA_MAP.department]: r.department || '',
      [JP_TANA_MAP.userId]: r.userId || '',
      [JP_TANA_MAP.note]: r.note || ''
    };
  }

  async function loadTanaList(){
    try{
      const res = await api("tanaList", { method:'GET' });
      const tbl = document.getElementById('tbl-tana');
      if (!tbl) return;

      const rowsRaw =
        Array.isArray(res) ? res :
        Array.isArray(res?.rows) ? res.rows :
        Array.isArray(res?.data) ? res.data : [];

      const heads = tanaJPHeaders();
      tbl.innerHTML = '<thead><tr>' + heads.map(h=>`<th>${h}</th>`).join('') + '</tr></thead>';

      if (!rowsRaw.length){
        tbl.insertAdjacentHTML('beforeend',
          '<tbody><tr><td colspan="'+heads.length+'" class="text-muted py-4">データはありません</td></tr></tbody>');
        ensureViewAutoMenu("shelf-list", "#view-shelf-list .items-toolbar .right");
        return;
      }

      const rows = rowsRaw.map(tanaToJPRow);
      tbl.insertAdjacentHTML('beforeend',
        '<tbody>' + rows.map(r => `<tr>${
          heads.map(h=>`<td>${escapeHtml(r[h])}</td>`).join('')
        }</tr>`).join('') + '</tbody>');

      ensureViewAutoMenu("shelf-list", "#view-shelf-list .items-toolbar .right");
    }catch (e) {
      const tbl = document.getElementById('tbl-tana');
      if (tbl) tbl.innerHTML =
        '<tbody><tr><td class="text-danger">取得に失敗</td></tr></tbody>';
      ensureViewAutoMenu("shelf-list", "#view-shelf-list .items-toolbar .right");
    }
  }

  $("#tana-exp")?.addEventListener("click", async ()=>{
    const resp = await api("tanaExportCSV", { method:'GET' });
    if(!resp || !resp.ok) return alert('エクスポート失敗');
    downloadCSV_JP(resp.filename || "棚卸.csv", resp.csv);
  });

  $("#input-tana-imp")?.addEventListener("change", async (ev)=>{
    const file = ev.target.files?.[0]; if(!file) return;
    const buf = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const resp = await api("tanaImportCSV", { method:'POST', body:{ csvBase64: b64 } });
    if(!resp || !resp.ok) return alert('インポート失敗');
    alert(`インポート: ${resp.imported} 行`);
    loadTanaList();
    ev.target.value = '';
  });

  async function renderShelfRecapForList(){
    try {
      const raw = await api("history", { method: "GET" });
      const list = Array.isArray(raw) ? raw : (raw?.history || raw?.data || []);
      const byMonth = new Map();
      const byYear = new Map();
      for (const h of list) {
        const d = new Date(h.timestamp || h.date || ""); if (isNaN(d)) continue;
        const m = d.toISOString().slice(0, 7);
        const y = String(d.getFullYear());
        const type = String(h.type || "").toUpperCase();
        const qty = Number(h.qty || 0);
        if (!byMonth.has(m)) byMonth.set(m, { in: 0, out: 0 });
        if (!byYear.has(y)) byYear.set(y, { in: 0, out: 0 });
        if (type === "IN") { byMonth.get(m).in += qty; byYear.get(y).in += qty; }
        else if (type === "OUT") { byMonth.get(m).out += qty; byYear.get(y).out += qty; }
      }

      $("#tana-recap-export-monthly")?.addEventListener("click", () => {
        const heads = ["月","IN","OUT"];
        const csv = [heads.join(",")]
          .concat([...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, v.in, v.out].join(","))).join("\n");
        downloadCSV_JP("棚卸_月次.csv", csv);
      }, { once: true });

      $("#tana-recap-export-yearly")?.addEventListener("click", () => {
        const heads = ["年","IN","OUT"];
        const csv = [heads.join(",")]
          .concat(
            [...byYear.entries()]
              .sort((a,b)=>a[0].localeCompare(b[0]))
              .map(([k,v]) => [k, v.in, v.out].join(","))
          )
          .join("\n");
        downloadCSV_JP("棚卸_年次.csv", csv);
      }, { once: true });

      $("#tana-matome-exp")?.addEventListener("click", async ()=>{
        const res = await api("tanaList", { method:'GET' }); if(!res || !res.rows) return;
        const agg = {}; res.rows.forEach(r=>{ agg[r.code] = (agg[r.code]||0) + Number(r.qty||0); });
        const heads = ['コード','数量'];
        const csv = [heads.join(',')]
          .concat(Object.keys(agg).map(k=>[k, agg[k]].join(',')))
          .join('\n');
        downloadCSV_JP("棚卸まとめ.csv", csv);
      }, { once:true });

      ensureViewAutoMenu("shelf-list", "#view-shelf-list .items-toolbar .right");
    } catch (e) {
      ensureViewAutoMenu("shelf-list", "#view-shelf-list .items-toolbar .right");
    }
  }

  /* -------------------- Auto-refresh UI helpers -------------------- */
  function itemsAuto_refreshLabel(sec){
    const btn = document.getElementById("btn-items-auto");
    if (!btn) return;
    if (!sec) btn.textContent = "Auto: Off";
    else if (sec >= 60) btn.textContent = `Auto: ${Math.round(sec/60)}分`;
    else btn.textContent = `Auto: ${sec}秒`;
  }
  function itemsAuto_extendMenu(){
    const btn = document.getElementById("btn-items-auto");
    const menu = btn?.parentElement?.querySelector(".dropdown-menu");
    if (!menu) return;
    if (!menu.querySelector('[data-autorefresh="180"]')) {
      menu.insertAdjacentHTML("beforeend", `
        <li><a class="dropdown-item" data-autorefresh="180">180秒</a></li>
        <li><a class="dropdown-item" data-autorefresh="300">300秒（5分）</a></li>
        <li><a class="dropdown-item" data-autorefresh="600">600秒（10分）</a></li>
      `);
    }
    menu.querySelectorAll("[data-autorefresh]").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const sec = Number(a.getAttribute("data-autorefresh") || "0");
        itemsAuto_refreshLabel(sec);
        setLiveRefresh(sec);
      });
    });
    const saved = Number(localStorage.getItem("liveRefreshSec") || "120");
    itemsAuto_refreshLabel(saved);
  }
  itemsAuto_extendMenu();

  function ensureViewAutoMenu(viewKey, toolbarRightSel){
    const host = document.querySelector(toolbarRightSel); if (!host) return;
    const BTN_ID = `btn-auto-${viewKey}`;
    const WRAP_ID = `auto-wrap-${viewKey}`;
    if (document.getElementById(BTN_ID)) {
      const saved = Number(localStorage.getItem("liveRefreshSec") || "120");
      const btn = document.getElementById(BTN_ID);
      if (btn) {
        btn.textContent = !saved ? "Auto: Off" : (saved >= 60 ? `Auto: ${Math.round(saved/60)}分` : `Auto: ${saved}秒`);
      }
      return;
    }
    const wrap = document.createElement("div");
    wrap.id = WRAP_ID;
    wrap.className = "btn-group";
    wrap.innerHTML = `
      <button id="${BTN_ID}" class="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">Auto</button>
      <ul class="dropdown-menu dropdown-menu-end">
        <li><a class="dropdown-item" data-autorefresh="0">Off</a></li>
        <li><a class="dropdown-item" data-autorefresh="120">120秒（2分）</a></li>
        <li><a class="dropdown-item" data-autorefresh="180">180秒（3分）</a></li>
        <li><a class="dropdown-item" data-autorefresh="300">300秒（5分）</a></li>
        <li><a class="dropdown-item" data-autorefresh="600">600秒（10分）</a></li>
      </ul>`;
    host.appendChild(wrap);
    wrap.querySelectorAll("[data-autorefresh]").forEach(a=>{
      a.addEventListener("click",(e)=>{
        e.preventDefault();
        const sec = Number(a.getAttribute("data-autorefresh") || "0");
        setLiveRefresh(sec);
        const btn = document.getElementById(BTN_ID);
        if (!btn) return;
        btn.textContent = !sec ? "Auto: Off" : (sec >= 60 ? `Auto: ${Math.round(sec/60)}分` : `Auto: ${sec}秒`);
      });
    });
    const saved = Number(localStorage.getItem("liveRefreshSec") || "120");
    const btn = document.getElementById(BTN_ID);
    if (btn) btn.textContent = !saved ? "Auto: Off" : (saved >= 60 ? `Auto: ${Math.round(saved/60)}分` : `Auto: ${saved}秒`);
  }

  function openEditItem(code) {
    if (!isAdmin()) return toast("Akses ditolak (admin only)");
    const it = _ITEMS_CACHE.find(x => String(x.code) === String(code)); if (!it) return;
    const wrap = document.createElement("div");
    wrap.className = "modal fade";
    wrap.innerHTML = `
<div class="modal-dialog">
  <div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">商品編集</h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <div class="row g-3">
        <div class="col-md-6"><label class="form-label">コード</label><input id="md-code" class="form-control" value="${escapeAttr(it.code)}" readonly></div>
        <div class="col-md-6"><label class="form-label">名称</label><input id="md-name" class="form-control" value="${escapeAttr(it.name)}"></div>
        <div class="col-md-4"><label class="form-label">価格</label><input id="md-price" type="number" class="form-control" value="${Number(it.price || 0)}"></div>
        <div class="col-md-4"><label class="form-label">在庫</label><input id="md-stock" type="number" class="form-control" value="${Number(it.stock || 0)}"></div>
        <div class="col-md-4"><label class="form-label">最小</label><input id="md-min" type="number" class="form-control" value="${Number(it.min || 0)}"></div>
        <div class="col-md-8"><label class="form-label">画像URL</label><input id="md-img" class="form-control" value="${escapeAttr(it.img || "")}"></div>
        <div class="col-md-4"><label class="form-label">置場</label>
          <input id="md-location" class="form-control text-uppercase" value="${escapeAttr(it.location || "")}" placeholder="A-01-03"></div>
        <div class="col-md-4"><label class="form-label">部門</label>
          <input id="md-department" class="form-control" value="${escapeAttr(it.department || "")}" placeholder="製造/品質/倉庫など"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-bs-dismiss="modal">閉じる</button>
      <button class="btn btn-primary" id="md-save">保存</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap); modal.show();

    $("#md-location", wrap)?.addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""); });

    $("#md-save", wrap)?.addEventListener("click", async () => {
      try {
        const payload = {
          code: $("#md-code", wrap).value,
          name: $("#md-name", wrap).value,
          price: Number($("#md-price", wrap).value || 0),
          stock: Number($("#md-stock", wrap).value || 0),
          min: Number($("#md-min", wrap).value || 0),
          img: $("#md-img", wrap).value,
          location: ($("#md-location", wrap).value || "").toUpperCase().trim(),
          department: ($("#md-department", wrap).value || "").trim(),
          overwrite: true
        };
        const r = await api("updateItem", { method: "POST", body: payload });
        if (r?.ok) { modal.hide(); wrap.remove(); renderItems(); renderShelfTable(); }
        else toast(r?.error || "保存失敗");
      } catch (e) { toast("保存失敗: " + (e?.message || e)); }
    });

    wrap.addEventListener("hidden.bs.modal", () => wrap.remove(), { once: true });
  }

  function openNewItem() {
    if (!isAdmin()) return toast("Akses ditolak (admin only)");
    const wrap = document.createElement("div");
    wrap.className = "modal fade";
    wrap.innerHTML = `
<div class="modal-dialog">
  <div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">新規商品</h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <div class="row g-3">
        <div class="col-md-6"><label class="form-label">コード</label><input id="nw-code" class="form-control" placeholder="SKU-001"></div>
        <div class="col-md-6"><label class="form-label">名称</label><input id="nw-name" class="form-control"></div>
        <div class="col-md-4"><label class="form-label">価格</label><input id="nw-price" type="number" class="form-control" value="0"></div>
        <div class="col-md-4"><label class="form-label">在庫</label><input id="nw-stock" type="number" class="form-control" value="0"></div>
        <div class="col-md-4"><label class="form-label">最小</label><input id="nw-min" type="number" class="form-control" value="0"></div>
        <div class="col-md-8"><label class="form-label">画像URL</label><input id="nw-img" class="form-control"></div>
        <div class="col-md-4"><label class="form-label">置場</label><input id="nw-location" class="form-control text-uppercase" placeholder="A-01-03"></div>
        <div class="col-md-4"><label class="form-label">部門</label>
          <input id="nw-department" class="form-control" placeholder="製造/品質/倉庫など">
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-bs-dismiss="modal">閉じる</button>
      <button class="btn btn-primary" id="nw-save">作成</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap); modal.show();
    $("#nw-location", wrap)?.addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""); });
    $("#nw-save", wrap)?.addEventListener("click", async () => {
      try {
        const payload = {
          code: ($("#nw-code", wrap).value || "").trim(),
          name: $("#nw-name", wrap).value,
          price: Number($("#nw-price", wrap).value || 0),
          stock: Number($("#nw-stock", wrap).value || 0),
          min: Number($("#nw-min", wrap).value || 0),
          img: $("#nw-img", wrap).value,
          location: ($("#nw-location", wrap).value || "").toUpperCase().trim(),
          department: ($("#nw-department", wrap).value || "").trim(),
          overwrite: false
        };
        if (!payload.code) return toast("コードを入力してください。");
        const r = await api("updateItem", { method: "POST", body: payload });
        if (r?.ok) { modal.hide(); wrap.remove(); renderItems(); toast("作成しました"); }
        else toast(r?.error || "作成失敗");
      } catch (e) { toast("作成失敗: " + (e?.message || e)); }
    });
    wrap.addEventListener("hidden.bs.modal", () => wrap.remove(), { once: true });
  }

  // === LOT QR modal ===
  function openLotQRModal(item) {
    if (!item) return;
    const wrap = document.createElement("div");
    wrap.className = "modal fade";
    wrap.innerHTML = `
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">Lot/箱 QR ラベル</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label">コード</label><input class="form-control" value="${escapeAttr(item.code)}" readonly></div>
          <div class="col-md-6"><label class="form-label">名称</label><input class="form-control" value="${escapeAttr(item.name || "")}" readonly></div>
          <div class="col-md-4"><label class="form-label">1箱の数量</label><input id="lot-qty" type="number" min="1" class="form-control" value="10"></div>
          <div class="col-md-8"><label class="form-label">ロットID（任意）</label><input id="lot-id" class="form-control" placeholder="LOT-2025-11-A"></div>
        </div>
        <div class="mt-3 d-flex align-items-center gap-3">
          <div id="lotqr-box"></div>
          <div class="small text-muted" id="lot-caption"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline-secondary" data-bs-dismiss="modal">閉じる</button>
        <button class="btn btn-outline-primary" id="lot-preview">プレビュー</button>
        <button class="btn btn-primary" id="lot-dl">DL</button>
      </div>
    </div>
  </div>`;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap); modal.show();

    const box = $("#lotqr-box", wrap);

    async function renderQR() {
      const qty = Math.max(1, Number($("#lot-qty", wrap).value || 0) || 1);
      const lot = ($("#lot-id", wrap).value || "").trim();
      const codeNorm = normalizeCodeDash(item.code);
      const text = lot ? `LOT|${codeNorm}|${qty}|${lot}` : `LOT|${codeNorm}|${qty}`;

      const cap = $("#lot-caption", wrap);
      if (cap) cap.textContent = `コード: ${codeNorm} / 数量: ${qty}` + (lot ? ` / ロット: ${lot}` : "");

      box.innerHTML = "";
      try {
        await ensureQRCode();
        new QRCode(box, { text, width: 140, height: 140, correctLevel: QRCode.CorrectLevel.M });
      } catch {
        box.textContent = text; // fallback teks
      }
    }

    $("#lot-qty", wrap)?.addEventListener("input", renderQR);
    $("#lot-id", wrap)?.addEventListener("input", renderQR);
    renderQR();

    $("#lot-preview", wrap)?.addEventListener("click", async ()=> {
      const qty = Math.max(1, Number($("#lot-qty", wrap).value || 0) || 1);
      const lot = ($("#lot-id", wrap).value || "").trim();
      const url = await makeLotLabelDataURL(item, qty, lot);
      openPreview(url);
    });

    $("#lot-dl", wrap)?.addEventListener("click", async ()=>{
      const qty = Math.max(1, Number($("#lot-qty", wrap).value || 0) || 1);
      const lot = ($("#lot-id", wrap).value || "").trim();
      const url = await makeLotLabelDataURL(item, qty, lot);
      const lotSafe  = lot ? `_${sanitizeFilename(lot)}` : "";
      const codeSafe = sanitizeFilename(item.code);
      const a = document.createElement("a");
      a.href = url; a.download = `LOT_${codeSafe}${lotSafe}_${qty}.png`; a.click();
    });

    wrap.addEventListener("hidden.bs.modal", () => wrap.remove(), { once: true });
  }

  /* -------------------- Boot -------------------- */
  window.addEventListener("DOMContentLoaded", () => {
    const logo = document.getElementById("brand-logo");
    if (logo && window.CONFIG && CONFIG.LOGO_URL) {
      logo.src = CONFIG.LOGO_URL; logo.alt = "logo";
      logo.onerror = () => { logo.style.display = "none"; };
    }

    const newItemBtn = $("#btn-open-new-item");
    const newUserBtn = $("#btn-open-new-user");
    if (newItemBtn) { newItemBtn.classList.toggle("d-none", !isAdmin()); newItemBtn.addEventListener("click", openNewItem); }
    if (newUserBtn) { newUserBtn.classList.toggle("d-none", !isAdmin()); newUserBtn.addEventListener("click", openNewUser); }

    hydrateCurrentUser();
    bindIO();
    bindShelf();
    updateWelcomeBanner();
    renderDashboard();
    $("#btn-logout")?.addEventListener("click", logout);

    // Preload QR lib supaya Lot QR langsung tampil
   // Preload QR lib & aktifkan Preview
ensureQRCode()
  .catch(()=>{})                // QR lib gagal? nggak apa-apa (Preview tetap jalan tanpa QR box)
  .finally(()=>{ try{ bindPreviewButtons(); }catch(e){} });

    startLiveReload();
  });

})();



function ensurePreviewModal(){
  if(document.getElementById('preview-modal')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="modal fade" id="preview-modal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title"><i class="bi bi-search me-2"></i>商品プレビュー</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="閉じる"></button>
        </div>
        <div class="modal-body">
          <div class="d-flex gap-3 align-items-start flex-wrap">
            <div>
              <div id="pv-qr" class="rounded p-2 border bg-light"></div>
              <div class="small text-muted mt-1">QR を印刷ラベルと同一サイズ比で生成</div>
            </div>
            <div class="flex-grow-1">
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <span id="pv-name" class="fw-semibold fs-5"></span>
                <span id="pv-status" class="badge"></span>
              </div>
              <div class="text-muted mt-1">
                <span class="me-3">コード: <span id="pv-code"></span></span>
                <span class="me-3">部門: <span id="pv-dept"></span></span>
                <span>置場: <span id="pv-loc"></span></span>
              </div>
              <div class="mt-2">
                <span class="me-3">価格: <span id="pv-price"></span></span>
                <span class="me-3">在庫: <span id="pv-stock"></span></span>
                <span>最小: <span id="pv-min"></span></span>
              </div>
            </div>
            <div class="ms-auto">
              <img id="pv-img" alt="" style="max-height:120px;max-width:180px;object-fit:contain;border:1px solid var(--bs-border-color);border-radius:.5rem;display:none">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button id="pv-edit" type="button" class="btn btn-primary btn-sm"><i class="bi bi-pencil me-1"></i>編集</button>
          <button id="pv-print" type="button" class="btn btn-outline-secondary btn-sm"><i class="bi bi-printer me-1"></i>ラベル印刷</button>
          <button type="button" class="btn btn-light btn-sm" data-bs-dismiss="modal">閉じる</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(wrap);
}




function extractRowData(tr){
  const get = (sel)=> tr.querySelector(sel);
  const code = tr.getAttribute('data-code') || (get('td:nth-child(3)')?.textContent||'').trim();
  const name = (get('td.td-name')?.textContent || '').trim();
  const imgEl = get('td:nth-child(5) img');
  const price = (get('td:nth-child(6)')?.textContent||'').trim();
  const stock = Number((get('td:nth-child(7)')?.textContent||'0').replace(/[^0-9.-]/g,''));
  const min   = Number((get('td:nth-child(8)')?.textContent||'0').replace(/[^0-9.-]/g,''));
  const dept  = (get('td:nth-child(9)')?.textContent||'').trim();
  const loc   = (get('td:nth-child(10)')?.textContent||'').trim();
  return { code, name, img: imgEl?.getAttribute('src')||'', price, stock, min, dept, loc };
}




function bindPreviewButtons(){
  const tbl = document.getElementById('tbl-items');
  if(!tbl) return;
  ensurePreviewModal();

  tbl.addEventListener('click', (ev)=>{
    const btn = ev.target.closest('.btn-preview');
    if(!btn) return;
    ev.preventDefault();

    const tr = btn.closest('tr');
    const d = extractRowData(tr);

    document.getElementById('pv-code').textContent  = d.code || '-';
    document.getElementById('pv-name').textContent  = d.name || '(名称未設定)';
    document.getElementById('pv-dept').textContent  = d.dept || '-';
    document.getElementById('pv-loc').textContent   = d.loc  || '-';
    document.getElementById('pv-price').textContent = d.price || '¥0';
    document.getElementById('pv-stock').textContent = String(d.stock);
    document.getElementById('pv-min').textContent   = String(d.min);

    const st = document.getElementById('pv-status');
    st.className = 'badge';
    if(d.stock <= 0){
      st.classList.add('bg-secondary'); st.textContent = '在庫ゼロ';
    }else if(d.stock <= d.min){
      st.classList.add('bg-danger'); st.textContent = '要補充';
    }else{
      st.classList.add('bg-success'); st.textContent = '十分';
    }

    const pvImg = document.getElementById('pv-img');
    if(d.img){ pvImg.src = d.img; pvImg.style.display = ''; } else { pvImg.style.display = 'none'; }

// --- QR di modal preview: pakai dataURL agar selalu muncul ---
const qrBox = document.getElementById('pv-qr');
qrBox.innerHTML = '';
(async () => {
  try {
    const content = d.code ? `ITEM|${String(d.code).trim()}` : (d.name || '');
    const url = await generateQrDataUrl(content, 128);   // <- pakai helper yang sudah ada
    if (url) {
      const img = new Image();
      img.width = 128; img.height = 128;
      img.alt = content;
      img.src = url;
      qrBox.appendChild(img);
    } else {
      qrBox.textContent = content || '(QR なし)';
    }
  } catch (e) {
    qrBox.textContent = d.code || d.name || '(QR 生成失敗)';
  }
})();
    const toEdit = document.getElementById('pv-edit');
    const toPrint = document.getElementById('pv-print');
    toEdit.onclick = ()=> document.querySelector(`.btn-edit[data-code="${CSS.escape(d.code)}"]`)?.click();
    toPrint.onclick = ()=> document.querySelector('#btn-print-all, #btnPrintAll')?.click();

    const modalEl = document.getElementById('preview-modal');
    let modal;
    if (window.bootstrap && window.bootstrap.Modal){
      modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();
    }else{
      // fallback simple show/hide
      modalEl.style.display='block';
    }
  });
}



document.addEventListener('click',(e)=>{
  const a = e.target.closest('.js-filter'); if(!a) return;
  const f = a.dataset.f;
  const rows = document.querySelectorAll('#tbl-items tr[data-code]');
  rows.forEach(tr=>{
    const d = extractRowData(tr);
    let show = true;
    if(f==='low')  show = d.stock>0 && d.stock<=d.min;
    if(f==='zero') show = d.stock<=0;
    if(f==='img')  show = !!d.img;
    if(f==='all')  show = true;
    tr.style.display = show ? '' : 'none';
  });
});

