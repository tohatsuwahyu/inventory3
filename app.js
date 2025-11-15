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
   function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));
  }

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
    const btn =
      document.getElementById('btn-items-print-all') ||
      document.getElementById('btn-print-all-labels') ||
      document.querySelector('[data-action="print-all-labels"]') ||
      Array.from(document.querySelectorAll('#view-items .items-toolbar button, #view-items .items-toolbar .btn'))
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
      // 棚卸一覧：リスト + 集計は loadTanaList の中で行う
      if (id === "view-shelf-list") { loadTanaList(); }
 });
  })();

  /* -------------------- Dashboard -------------------- */
    let chartLine = null, chartPie = null;
  async function renderDashboard() {
    const who = getCurrentUser();
    if (who) $("#who").textContent = `${who.name || who.id || "user"} (${who.id} | ${who.role || "user"})`;

    try {
      const [itemsRaw, usersRaw, seriesRaw, historyRaw] = await Promise.all([
        api("items", { method: "GET" }).catch(() => []),
        api("users", { method: "GET" }).catch(() => []),
        api("statsMonthlySeries", { method: "GET" }).catch(() => []),
        api("history", { method: "GET" }).catch(() => [])
      ]);

      const items   = Array.isArray(itemsRaw) ? itemsRaw : [];
      const users   = Array.isArray(usersRaw) ? usersRaw : [];
      const series  = Array.isArray(seriesRaw) ? seriesRaw : [];
      const history = Array.isArray(historyRaw)
        ? historyRaw
        : (Array.isArray(historyRaw?.history) ? historyRaw.history
          : (Array.isArray(historyRaw?.data) ? historyRaw.data : []));

      // --- metric kartu utama ---
      $("#metric-total-items").textContent = items.length;
      const low = items.filter(it => Number(it.stock || 0) <= Number(it.min || 0)).length;
      $("#metric-low-stock").textContent = low;
      $("#metric-users").textContent = users.length;

      // --- 直近30日の入出庫 件数 → #metric-txn ---
      const now   = new Date();
      const limit = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 hari ke belakang
      let count30 = 0;
      for (const h of history) {
        const raw = h.timestamp || h.date || "";
        if (!raw) continue;
        let dt;
        if (raw instanceof Date) {
          dt = raw;
        } else {
          // dukung "yyyy-MM-dd HH:mm:ss" dari GAS
          dt = new Date(String(raw).replace(" ", "T"));
        }
        if (isNaN(dt)) continue;
        if (dt >= limit && dt <= now) count30++;
      }
      const elTxn = $("#metric-txn");
      if (elTxn) elTxn.textContent = count30;

      // --- grafik line bulanan ---
      const ctx1 = $("#chart-monthly");
      if (ctx1) {
        chartLine?.destroy();
        chartLine = new Chart(ctx1, {
          type: "line",
          data: {
            labels: series.map(s => s.month || ""),
            datasets: [
              { label: "IN",  data: series.map(s => Number(s.in  || 0)), borderWidth: 2 },
              { label: "OUT", data: series.map(s => Number(s.out || 0)), borderWidth: 2 }
            ]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });
      }

      // --- grafik pie (bulan terakhir) ---
      const ctx2 = $("#chart-pie");
      if (ctx2) {
        chartPie?.destroy();
        const last = series.length ? series[series.length - 1] : { in: 0, out: 0 };
        chartPie = new Chart(ctx2, {
          type: "pie",
          data: {
            labels: ["IN", "OUT"],
            datasets: [{ data: [Number(last.in || 0), Number(last.out || 0)] }]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });
      }

      $("#btn-export-mov")?.addEventListener("click", () => {
        const heads = ["月","IN","OUT"];
        const csv = [heads.join(",")]
          .concat(series.map(s => [s.month, s.in || 0, s.out || 0].join(",")))
          .join("\n");
        downloadCSV_JP("月次INOUT.csv", csv);
      }, { once: true });
    } catch (e) {
      console.error("renderDashboard()", e);
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
        // 1) checkbox
        '<td style="width:36px">',
          '<input type="checkbox" class="row-chk" data-code="', escapeAttr(it.code), '">',
        '</td>',

        // 2) QR
        '<td style="width:110px">',
          '<div class="tbl-qr-box"><div id="', qrid, '" class="d-inline-block"></div></div>',
        '</td>',

        // 3) コード / 名称 (digabung)
        '<td>',
          '<div class="small text-muted">', escapeHtml(it.code), '</div>',
          '<div class="td-name">',
            '<a href="#" class="link-underline link-item" data-code="', escapeAttr(it.code), '">',
              escapeHtml(it.name),
            '</a>',
          '</div>',
        '</td>',

        // 4) 画像
        '<td>',
          (it.img ? `<img src="${escapeAttr(it.img)}" alt="" style="height:32px">` : ''),
        '</td>',

        // 5) 価格
        '<td class="text-end">¥', fmt(it.price), '</td>',

        // 6) 在庫
        '<td class="text-end">', fmt(stock), badge, '</td>',

        // 7) 最小
        '<td class="text-end">', fmt(min), '</td>',

        // 8) 部門
        '<td>', dept, '</td>',

        // 9) 置場
        '<td>', loc, '</td>',

        // 10) 操作
        '<td>',
          '<div class="act-grid" style="display:grid;grid-auto-flow:column;gap:.25rem;place-content:center">',
            actions,
          '</div>',
        '</td>',
      '</tr>'
    ].join('');
  }


  // === Mobile mini "操作" button renderer (HP only) ===
  function ensureMobileActions(){
    if (window.matchMedia('(min-width:577px)').matches) return;

    document.querySelectorAll('#tbl-items tr[data-code]').forEach(tr=>{
      if (tr.querySelector('.mobile-ops')) return;

      const firstCell = tr.querySelector('td'); if (!firstCell) return;
      const opsCell   = tr.querySelector('td:last-child'); if (!opsCell) return;
      const opsGroup  = opsCell.querySelector('.row-actions, .btn-group, .act-grid') || opsCell;

      const wrap = document.createElement('div');
      wrap.className = 'mobile-ops d-inline-block ms-1';
      wrap.innerHTML = '<button type="button" class="btn btn-sm btn-primary">操作</button>';

      const btn = wrap.querySelector('button');
      btn.addEventListener('click', ()=>{
        const open = opsGroup.classList.toggle('show');
        if (open){
          opsGroup.style.position   = 'absolute';
          opsGroup.style.right      = '8px';
          opsGroup.style.top        = '50%';
          opsGroup.style.transform  = 'translateY(-50%)';
          opsGroup.style.background = '#fff';
          opsGroup.style.padding    = '6px';
          opsGroup.style.border     = '1px solid var(--bs-border-color)';
          opsGroup.style.borderRadius = '.5rem';
          opsGroup.style.boxShadow  = '0 8px 26px rgba(15,23,42,.06)';
          opsGroup.style.zIndex     = '5';
          opsGroup.classList.add('d-inline-flex');
          opsGroup.style.gap = '.25rem';
        }else{
          opsGroup.removeAttribute('style');
          opsGroup.classList.add('d-inline-flex');
        }
      });

      firstCell.style.position = 'relative';
      firstCell.appendChild(wrap);
    });
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
          ensureMobileActions();
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
        showItemPreview(item);
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

  
// --- Tambahan: hint visual untuk input manual di 入出荷 ---
function setManualHints({ autoFromLot } = { autoFromLot:false }){
  const qty  = document.getElementById('io-qty');
  const type = document.getElementById('io-type');
  if (!qty || !type) return;
  if (autoFromLot){
    qty.classList.remove('needs-manual');
    type.classList.remove('needs-manual');
    qty.dataset.autofill = '1';
  }else{
    qty.classList.add('needs-manual');
    type.classList.add('needs-manual');
    delete qty.dataset.autofill;
  }
}
/* -------------------- IO Scanner -------------------- */
  let IO_SCANNER = null;

  function bindIO() {
    const btnStart = $("#btn-io-scan"),
          btnStop  = $("#btn-io-stop"),
          area     = $("#io-scan-area");
    if (!btnStart || !btnStop || !area) return;

    setManualHints({ autoFromLot:false });

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
        timer = setTimeout(() => { setManualHints({autoFromLot:false}); findItemIntoIO(v); }, 220);
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
            setManualHints({ autoFromLot:false });
            // Tidak ada confirm di 入出荷. User isi qty → klik 登録.
            return;
          }

         if (parsed.kind === "lot") {
  const { code, qty, lot } = parsed;
  $("#io-code").value = code;
  await findItemIntoIO(code);

  // Auto-fill quantity dari QR LOT, tapi TIDAK otomatis register.
  const qtyField = document.getElementById("io-qty");
  if (qtyField) qtyField.value = Number(qty || 0) || "";

  setManualHints({ autoFromLot:true });
  // User tetap input / cek sendiri lalu klik 登録, sama seperti QR satuan.
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

  const who = getCurrentUser();
  if (!who) return toast("ログイン情報がありません。");

  const code = ($("#io-code").value || "").trim();
  const qty  = Number($("#io-qty").value || 0);
  const unit = $("#io-unit").value || "pcs";
  const type = $("#io-type").value || "IN";

  if (!code) return toast("コードを入力またはスキャンしてください。");
  if (!Number.isFinite(qty) || qty <= 0) return toast("数量を入力してください。");

  // anti double submit
  const btn = $("#form-io button[type=submit]") || $("#btn-io-submit");
  if (btn?.__busy) return;
  if (btn) { btn.__busy = true; btn.disabled = true; }

  try {
    const r = await api("log", { method: "POST", body: { userId: who.id, code, qty, unit, type } });
    if (r?.ok) {
      const msgType = (type === "IN") ? "入庫" : "出庫";
      toast(`${msgType}として登録しました（${code} × ${qty} ${unit}）`);
      $("#io-qty").value = "";
      await findItemIntoIO(code);
            setManualHints({ autoFromLot:false });
      renderDashboard();
    } else {
      toast(r?.error || "登録失敗");
    }
  } catch (err) {
    toast("登録失敗: " + (err?.message || err));
  } finally {
    if (btn) { btn.disabled = false; btn.__busy = false; }
  }
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
  // --- toolbar buttons (差異のみ / 下書き保存 / 読込 / クリア / 確定) ---
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

  const btnStart = $("#btn-start-scan"),
        btnStop  = $("#btn-stop-scan"),
        area     = $("#scan-area");

  if (!btnStart || !btnStop || !area) return;

  // --- スキャン開始 / 停止 ---
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
    } catch (e) {
      toast(e?.message || String(e));
    }
  });

  btnStop.addEventListener("click", async () => {
    try { await SHELF_SCANNER?.stop?.(); SHELF_SCANNER?.clear?.(); } catch (e) {}
    area.innerHTML = "カメラ待機中…";
  });

  // --- フィルタ (コード / 名称) ---
  $("#st-filter")?.addEventListener("input", (e) => {
    const q = (e.target.value || "").toLowerCase();
    $$("#tbl-stocktake tr").forEach(tr => {
      const code = (tr.children[0]?.textContent || "").toLowerCase();
      const name = (tr.children[1]?.textContent || "").toLowerCase();
      tr.style.display = (code.includes(q) || name.includes(q)) ? "" : "none";
    });
  });

  // --- 手入力で1件追加 ---
  $("#st-add")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const code = ($("#st-code").value || "").trim();
    const qty  = Number($("#st-qty").value || 0);
    if (!code) return;
    await addOrUpdateStocktake(code, qty || undefined);
    $("#st-code").value = "";
    $("#st-qty").value  = "";
  });

  // --- 差異のみスイッチ ---
  const diffOnly = document.getElementById("st-diff-only");
  if (diffOnly && !diffOnly.__bound) {
    diffOnly.__bound = true;
    diffOnly.addEventListener("change", () => {
      const only = diffOnly.checked;
      $$("#tbl-stocktake tr").forEach(tr => {
        const diffText = (tr.children[5]?.textContent || "0").replace(/[,¥]/g, "");
        const diff = Number(diffText || 0);
        tr.style.display = (!only || diff !== 0) ? "" : "none";
      });
    });
  }

  // --- 下書き保存 / 読込 / クリア ---
  $("#st-save")?.addEventListener("click", (e) => {
    e.preventDefault();
    saveShelfDraft();
  });

  $("#st-load")?.addEventListener("click", (e) => {
    e.preventDefault();
    loadShelfDraft();
  });

  $("#st-clear")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!confirm("現在の棚卸データをクリアしますか？")) return;
    ST.rows = new Map();
    renderShelfTable();
    clearShelfDraft();
  });

  // ---- Tambahan aman: stub supaya pemanggilan tidak error ----
function ensureItemsColgroup(){ /* no-op; tambahkan logika jika perlu */ }

// ---- Potongan akhir bindShelf() (biarkan kode di atasnya tetap) ----
const btnCommit = $("#st-commit");
if (btnCommit && !btnCommit.__bound) {
  btnCommit.__bound = true;
  btnCommit.addEventListener("click", async (e) => {
    e.preventDefault();

    const rows = [...ST.rows.values()];
    if (!rows.length) {
      toast("棚卸データがありません。");
      return;
    }

    const who = getCurrentUser();
    if (!who) {
      toast("ログイン情報がありません。");
      return;
    }

    if (!confirm("帳簿在庫を更新し、棚卸結果を保存しますか？")) return;

    btnCommit.disabled = true;

    try {
      const payloadRows = rows.map(r => ({
        code      : r.code,
        name      : r.name,
        qty       : Number(r.qty || 0),
        book      : Number(r.book || 0),
        diff      : Number(r.diff || 0),
        unit      : "pcs",
        department: r.department || ""
      }));

      const res = await api("tanaCommit", {
        method: "POST",
        body: { userId: who.id, rows: payloadRows }
      });

      if (!res || !res.ok) { throw new Error((res && res.error) || "tanaCommit failed"); }

      toast(`棚卸を確定しました（在庫更新 ${res.updated || 0} 件）`);

      ST.rows = new Map();
      renderShelfTable();
      clearShelfDraft();

      try { await loadTanaList(); } catch (_) {}
      try { await renderItems(); } catch (_) {}
      renderDashboard();

    } catch (err) {
      console.error("tanaCommit error", err);
      toast("棚卸の確定に失敗しました。");
    } finally {
      btnCommit.disabled = false;
    }
  });
}

// <<< PENUTUP bindShelf() dipindah ke sini >>>
} 




        /* -------------------- Tanaoroshi List (棚卸一覧) -------------------- */

  // Header JP + kolom "棚卸年月", 単価, 金額
  const JP_TANA_MAP = {
    period : "棚卸年月",   // contoh: 2025-11
    date   : "日付",
    code   : "コード",
    name   : "品名",
    qty    : "数量",
    unit   : "単位",
    price  : "単価",
    amount : "金額",
    location   : "場所",
    department : "部門",
    userId     : "担当者",
    note       : "備考"
  };

  // cache data 棚卸一覧 (sudah diperkaya: price, amount, dll)
  let _TANA_ROWS = [];

  function tanaJPHeaders() {
    return Object.values(JP_TANA_MAP);
  }

  // format note: "book:6 diff:0" → "帳簿:6 / 差異:0"
  function formatTanaNote(row) {
    const raw = String(row.note || "");
    let book = row.book;
    let diff = row.diff;

    if (book == null || diff == null) {
      const m = raw.match(/book:\s*(-?\d+)\s+diff:\s*(-?\d+)/i);
      if (m) {
        book = Number(m[1]);
        diff = Number(m[2]);
      }
    }
    if (book != null || diff != null) {
      const b = Number(book || 0);
      const d = Number(diff || 0);
      return `帳簿:${fmt(b)} / 差異:${fmt(d)}`;
    }
    return raw;
  }

  // ubah ke bentuk "header JP → nilai"
  function tanaToJPRow(row) {
    return {
      [JP_TANA_MAP.period]    : row.period || "",
      [JP_TANA_MAP.date]      : row.date || "",
      [JP_TANA_MAP.code]      : row.code || "",
      [JP_TANA_MAP.name]      : row.name || "",
      [JP_TANA_MAP.qty]       : String(row.qty ?? ""),
      [JP_TANA_MAP.unit]      : row.unit || "pcs",
      [JP_TANA_MAP.price]     : row.price != null ? String(row.price) : "",
      [JP_TANA_MAP.amount]    : row.amount != null ? String(row.amount) : "",
      [JP_TANA_MAP.location]  : row.location || "",
      [JP_TANA_MAP.department]: row.department || "",
      [JP_TANA_MAP.userId]    : row.userId || "",
      [JP_TANA_MAP.note]      : formatTanaNote(row)
    };
  }

  // render tabel utama (pakai _TANA_ROWS yang sudah diperkaya)
  function renderTanaTable() {
    const tbl = document.getElementById("tbl-tana");
    if (!tbl) return;

    const heads        = tanaJPHeaders();          // ['棚卸年月','日付',...,'金額','備考']
    const headsWithOps = [...heads, "操作"];

    const monthSel = document.getElementById("tana-month");
    const month    = (monthSel?.value || "").trim();

    const data = month
      ? _TANA_ROWS.filter(r => r.period === month)
      : _TANA_ROWS.slice();

    // header
    tbl.innerHTML =
      "<thead><tr>" +
      headsWithOps.map(h => `<th>${h}</th>`).join("") +
      "</tr></thead>";

    if (!data.length) {
      tbl.insertAdjacentHTML(
        "beforeend",
        `<tbody><tr><td colspan="${headsWithOps.length}" class="text-muted py-4 text-center">データはありません</td></tr></tbody>`
      );
      updateTanaSummary();
      bindTanaTableEvents();
      return;
    }

    let totalAmount = 0;

    const bodyHtml =
      "<tbody>" +
      data.map((row) => {
        const jpRow = tanaToJPRow(row);
        const code  = jpRow[JP_TANA_MAP.code] || "";

        // hitung total 金額
        totalAmount += Number(row.amount || 0);

        const tds = heads.map(h => {
          const v = jpRow[h] ?? "";
          if (h === JP_TANA_MAP.price || h === JP_TANA_MAP.amount) {
            const num = Number(v || 0);
            return `<td class="text-end">${num ? "¥" + fmt(num) : ""}</td>`;
          }
          if (h === JP_TANA_MAP.qty) {
            return `<td class="text-end">${fmt(v)}</td>`;
          }
          return `<td>${escapeHtml(v)}</td>`;
        }).join("");

        return `
          <tr data-idx="${row.idx}" data-code="${escapeAttr(code)}">
            ${tds}
            <td class="text-end">
              <button class="btn btn-sm btn-outline-primary btn-tana-edit">編集</button>
            </td>
          </tr>`;
      }).join("") +
      "</tbody>";

    // total 金額 di bawah tabel (tfoot)
    const idxAmount = heads.indexOf(JP_TANA_MAP.amount);
    const leftSpan  = idxAmount;          // sebelum kolom 金額
    const rightSpan = headsWithOps.length - idxAmount - 1;

    const tfootHtml = `
      <tfoot>
        <tr>
          <td colspan="${leftSpan}" class="text-end fw-bold">合計金額</td>
          <td class="text-end fw-bold">¥${fmt(totalAmount)}</td>
          <td colspan="${rightSpan}"></td>
        </tr>
      </tfoot>`;

    tbl.insertAdjacentHTML("beforeend", bodyHtml + tfootHtml);

    updateTanaSummary();
    bindTanaTableEvents();
  }

  // rekap bulanan: total qty & 金額 per 月 (pakai semua data, bukan hanya filter)
  function updateTanaSummary() {
    const host = document.getElementById("tana-summary");
    if (!host) return;
    if (!_TANA_ROWS.length) {
      host.textContent = "";
      return;
    }

    const agg = new Map();  // period → { qty, amount }
    for (const r of _TANA_ROWS) {
      const key = r.period || "不明";
      const cur = agg.get(key) || { qty: 0, amount: 0 };
      cur.qty    += Number(r.qty || 0);
      cur.amount += Number(r.amount || 0);
      agg.set(key, cur);
    }

    const rows = [...agg.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    const html =
      '<div class="fw-semibold mb-1">月別集計（全データ）</div>' +
      '<div class="table-responsive"><table class="table table-sm mb-0">' +
      '<thead><tr><th>棚卸年月</th><th class="text-end">数量合計</th><th class="text-end">金額合計</th></tr></thead>' +
      '<tbody>' +
      rows.map(([period, v]) => `
        <tr>
          <td>${escapeHtml(period)}</td>
          <td class="text-end">${fmt(v.qty)}</td>
          <td class="text-end">¥${fmt(v.amount)}</td>
        </tr>`).join("") +
      '</tbody></table></div>';

    host.innerHTML = html;
  }

  // binding filter bulan
  function bindTanaFilterUI() {
    const monthSel = document.getElementById("tana-month");
    if (monthSel && !monthSel.__bound) {
      monthSel.__bound = true;
      monthSel.addEventListener("change", () => renderTanaTable());
    }
    const clearBtn = document.getElementById("tana-month-clear");
    if (clearBtn && !clearBtn.__bound) {
      clearBtn.__bound = true;
      clearBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (monthSel) monthSel.value = "";
        renderTanaTable();
      });
    }
  }

  // klik 編集 → modal edit quantity saja
  function bindTanaTableEvents() {
    const tbl = document.getElementById("tbl-tana");
    if (!tbl || tbl.__tanaBound) return;
    tbl.__tanaBound = true;

    tbl.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".btn-tana-edit");
      if (!btn) return;
      const tr  = btn.closest("tr");
      const idx = Number(tr?.getAttribute("data-idx") || "-1");
      const row = _TANA_ROWS.find(r => r.idx === idx);
      if (!row) return;
      openTanaEditModal(row);
    });
  }

  // modal untuk edit quantity (hanya qty yang bisa diubah)
  function openTanaEditModal(row) {
    const who = getCurrentUser();
    if (!who) return toast("ログイン情報がありません。");

    const wrap = document.createElement("div");
    wrap.className = "modal fade";
    wrap.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title">棚卸数量の編集</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <div class="mb-2 small text-muted">コード・名称などは変更不可です。数量のみ編集できます。</div>
            <div class="row g-3">
              <div class="col-md-6"><label class="form-label">コード</label>
                <input class="form-control" value="${escapeAttr(row.code)}" readonly></div>
              <div class="col-md-6"><label class="form-label">品名</label>
                <input class="form-control" value="${escapeAttr(row.name || "")}" readonly></div>
              <div class="col-md-4"><label class="form-label">棚卸年月</label>
                <input class="form-control" value="${escapeAttr(row.period || "")}" readonly></div>
              <div class="col-md-4"><label class="form-label">単価</label>
                <input class="form-control" value="${fmt(row.price || 0)}" readonly></div>
              <div class="col-md-4"><label class="form-label">数量</label>
                <input id="tana-edit-qty" type="number" class="form-control" min="0" value="${row.qty}"></div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">キャンセル</button>
            <button class="btn btn-primary" id="tana-edit-save">保存</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap); modal.show();

    $("#tana-edit-save", wrap)?.addEventListener("click", async () => {
      const qtyVal = Number($("#tana-edit-qty", wrap).value || 0);
      if (!Number.isFinite(qtyVal) || qtyVal < 0) {
        return toast("数量を正しく入力してください。");
      }

      // hitung selisih terhadap qty lama → log koreksi
      const oldQty = Number(row.qty || 0);
      const delta  = qtyVal - oldQty;

      // coba rekonstruksi book & diff lama dari data / note
      let book = row.book;
      let oldDiff = row.diff;
      if (book == null || oldDiff == null) {
        const m = String(row.note || "").match(/book:\s*(-?\d+)\s+diff:\s*(-?\d+)/i);
        if (m) {
          book    = Number(m[1]);
          oldDiff = Number(m[2]);
        }
      }
      if (book == null) {
        book = oldQty - (oldDiff || 0);
      }
      const newDiff = qtyVal - book;

      try {
        // 1) kalau quantity berubah, catat koreksi ke history (log)
        if (delta !== 0) {
          const type = delta > 0 ? "IN" : "OUT";
          const qty  = Math.abs(delta);
          await api("log", {
            method: "POST",
            body: {
              userId: who.id,
              code  : row.code,
              qty,
              unit  : row.unit || "pcs",
              type,
              note  : "棚卸修正"
            }
          });
        }

        // 2) simpan rekaman 棚卸 baru (baris koreksi) dengan quantity terbaru
        await api("tanaSave", {
          method: "POST",
          body: {
            code      : row.code,
            name      : row.name,
            qty       : qtyVal,
            unit      : row.unit || "pcs",
            location  : row.location || "",
            department: row.department || "",
            userId    : row.userId || who.id,
            note      : `book:${book} diff:${newDiff}`
          }
        });

        toast("棚卸数量を保存しました。");
        modal.hide();
        wrap.remove();
        // reload dari backend supaya data & rekap up to date
        loadTanaList();
      } catch (e) {
        console.error(e);
        toast("保存に失敗しました。");
      }
    });

    wrap.addEventListener("hidden.bs.modal", () => wrap.remove(), { once: true });
  }

  // load data dari backend, join dengan 商品一覧 untuk ambil 単価 & 部門
  async function loadTanaList() {
    try {
      const [res, itemsRaw] = await Promise.all([
        api("tanaList", { method: "GET" }),
        api("items",   { method: "GET", silent: true }).catch(() => [])
      ]);

      const rowsRaw =
        Array.isArray(res)        ? res :
        Array.isArray(res?.rows) ? res.rows :
        Array.isArray(res?.data) ? res.data : [];

      const items =
        Array.isArray(itemsRaw) ? itemsRaw :
        Array.isArray(itemsRaw?.data) ? itemsRaw.data : [];

      const mapItems = new Map(items.map(it => [String(it.code), it]));

      _TANA_ROWS = rowsRaw.map((r, idx) => {
        const date   = r.date || "";
        const period = date ? String(date).slice(0, 7) : "";
        const code   = r.code || "";
        const item   = mapItems.get(String(code)) || {};

        const qty   = Number(r.qty || 0);
        const unit  = r.unit || "pcs";
        const price = (r.price != null)
          ? Number(r.price || 0)
          : Number(item.price || 0);
        const amount = qty * price;

        const location   = r.location   || item.location   || "";
        const department = r.department || item.department || "";

        return {
          idx,
          period,
          date,
          code,
          name      : r.name || item.name || "",
          qty,
          unit,
          price,
          amount,
          location,
          department,
          userId    : r.userId || "",
          note      : r.note || "",
          book      : (typeof r.book !== "undefined") ? Number(r.book || 0) : null,
          diff      : (typeof r.diff !== "undefined") ? Number(r.diff || 0) : null
        };
      });

      renderTanaTable();
      bindTanaFilterUI();
      ensureViewAutoMenu("shelf-list", "#view-shelf-list .items-toolbar .right");
    } catch (e) {
      console.error("loadTanaList error", e);
      const tbl = document.getElementById("tbl-tana");
      if (tbl) {
        tbl.innerHTML =
          '<tbody><tr><td colspan="5" class="text-danger py-4">取得に失敗しました</td></tr></tbody>';
      }
      const host = document.getElementById("tana-summary");
      if (host) host.textContent = "取得に失敗しました。";
      ensureViewAutoMenu("shelf-list", "#view-shelf-list .items-toolbar .right");
    }
  }

  // CSV Export / Import untuk 棚卸一覧 (per bulan)
  $("#tana-exp")?.addEventListener("click", (e)=> {
    e.preventDefault();
    if (!_TANA_ROWS.length) {
      alert("データがありません。");
      return;
    }

    const month = (document.getElementById("tana-month")?.value || "").trim();
    const rows  = month
      ? _TANA_ROWS.filter(r => r.period === month)
      : _TANA_ROWS.slice();

    if (!rows.length) {
      alert("該当するデータがありません。");
      return;
    }

    const heads = tanaJPHeaders(); // sudah termasuk 単価, 金額, dll
    const csvRows = rows.map(r => {
      const jp = tanaToJPRow(r);
      return heads.map(h => {
        let v = jp[h] ?? "";
        v = String(v).replace(/,/g, " ");
        return v;
      }).join(",");
    });

    const fname = month ? `棚卸_${month}.csv` : "棚卸.csv";
    const csv   = [heads.join(",")].concat(csvRows).join("\n");
    downloadCSV_JP(fname, csv);
  });

  $("#input-tana-imp")?.addEventListener("change", async (ev)=> {
    const file = ev.target.files?.[0]; if(!file) return;
    const buf = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const resp = await api("tanaImportCSV", { method:'POST', body:{ csvBase64: b64 } });
    if(!resp || !resp.ok) return alert('インポート失敗');
    alert(`インポート: ${resp.imported} 行`);
    loadTanaList();
    ev.target.value = '';
  });

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
  // --- Expose core helpers for global preview block ---
  window.__INV_APP__ = window.__INV_APP__ || {};
  Object.assign(window.__INV_APP__, {
    fmt,
    api,
    generateQrDataUrl,
    makeItemLabelDataURL,
    openEditItem
  });

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
    bindPrintAllLabels();
    $("#btn-logout")?.addEventListener("click", logout);

    // Preload QR lib & aktifkan Preview
    ensureQRCode()
      .catch(()=>{})
      .finally(()=>{ try{ bindPreviewButtons(); }catch(e){} });

    startLiveReload();
  });

})();   // <-- PENUTUP IIFE UTAMA, hanya baris ini yang ditambahkan



/* -------------------- Preview Modal & Preview helpers -------------------- */
(function () {
  "use strict";

  // escapeHtml lokal (modul preview berdiri sendiri dari IIFE utama)
 function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}


  // Bridge ke helper inti di dalam IIFE utama (lihat window.__INV_APP__)
  function __invCore() {
    return window.__INV_APP__ || {};
  }

  // wrapper fmt → pakai formatter dari core kalau ada
  function fmt(n) {
    const core = __invCore();
    if (typeof core.fmt === "function") {
      return core.fmt(n);
    }
    try {
      return new Intl.NumberFormat("ja-JP").format(Number(n || 0));
    } catch {
      return String(n || 0);
    }
  }

  async function invApi(action, opts) {
    const core = __invCore();
    if (typeof core.api !== "function") {
      throw new Error("API helper not ready");
    }
    return core.api(action, opts);
  }

  async function invGenerateQr(text, size) {
    const core = __invCore();
    if (typeof core.generateQrDataUrl !== "function") {
      throw new Error("QR helper not ready");
    }
    return core.generateQrDataUrl(text, size);
  }

  async function invMakeItemLabel(item) {
    const core = __invCore();
    if (typeof core.makeItemLabelDataURL !== "function") {
      throw new Error("Label helper not ready");
    }
    return core.makeItemLabelDataURL(item);
  }

  function invOpenEditItem(code) {
    const core = __invCore();
    if (typeof core.openEditItem !== "function") {
      throw new Error("Edit helper not ready");
    }
    return core.openEditItem(code);
  }

  // --------- Modal dasar untuk preview ---------
  function ensurePreviewModal() {
    if (document.getElementById("preview-modal")) return;
    const wrap = document.createElement("div");
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
              <button id="pv-edit" type="button" class="btn btn-primary btn-sm">
                <i class="bi bi-pencil me-1"></i>編集
              </button>
              <button id="pv-print" type="button" class="btn btn-outline-secondary btn-sm">
                <i class="bi bi-printer me-1"></i>ラベル印刷
              </button>
              <button type="button" class="btn btn-light btn-sm" data-bs-dismiss="modal">閉じる</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
  }

  // --------- Panel history kecil di dalam modal ---------
  function ensurePreviewHistoryArea() {
    ensurePreviewModal();
    const modal = document.getElementById("preview-modal");
    if (!modal) return;
    if (modal.querySelector("#pv-history")) return;

    const body = modal.querySelector(".modal-body") || modal;
    const panel = document.createElement("div");
    panel.id = "pv-history";
    panel.className = "mt-3";
    panel.innerHTML = `
      <div class="fw-semibold mb-1">履歴（最新10件）</div>
      <div class="table-responsive">
        <table class="table table-sm mb-0">
          <thead>
            <tr>
              <th style="white-space:nowrap">日時</th>
              <th style="white-space:nowrap">ユーザー</th>
              <th style="white-space:nowrap">種別</th>
              <th class="text-end" style="white-space:nowrap">数量</th>
              <th style="white-space:nowrap">備考</th>
            </tr>
          </thead>
          <tbody id="pv-history-body">
            <tr><td colspan="5" class="text-muted">読み込み中…</td></tr>
          </tbody>
        </table>
      </div>`;
    body.appendChild(panel);
  }

  async function loadItemHistory(code) {
    try {
      ensurePreviewHistoryArea();
      const tb = document.getElementById("pv-history-body");
      if (tb) {
        tb.innerHTML = `<tr><td colspan="5" class="text-muted">読み込み中…</td></tr>`;
      }
      const res = await invApi("historyByCode", {
        method: "POST",
        body: { code, limit: 10 },
        silent: true
      });
      const rows = (res && res.ok && Array.isArray(res.rows)) ? res.rows : [];
      if (!rows.length) {
        if (tb) {
          tb.innerHTML = `<tr><td colspan="5" class="text-muted">履歴はありません</td></tr>`;
        }
        return;
      }
      if (tb) {
        tb.innerHTML = rows.map(r => `
          <tr>
            <td>${escapeHtml(r.date || "")}</td>
            <td>${escapeHtml(r.userId || "")}</td>
            <td>${escapeHtml(r.type || "")}</td>
            <td class="text-end">${fmt(r.qty || 0)} ${escapeHtml(r.unit || "")}</td>
            <td>${escapeHtml(r.note || "")}</td>
          </tr>`).join("");
      }
    } catch (e) {
      const tb = document.getElementById("pv-history-body");
      if (tb) {
        tb.innerHTML = `<tr><td colspan="5" class="text-danger">履歴の取得に失敗</td></tr>`;
      }
    }
  }

  // Ambil data dari <tr> kalau item object dari cache tidak tersedia
  function extractRowData(tr) {
    const get = sel => tr.querySelector(sel);
    const codeCell = get("td:nth-child(3) .small, td:nth-child(3)");
    const code = (tr.getAttribute("data-code") ||
                 (codeCell ? codeCell.textContent : "") ||
                 "").trim();
    const name = (get(".td-name")?.textContent || "").trim();
    const imgEl = get("td:nth-child(4) img");
    const priceText = (get("td:nth-child(5)")?.textContent || "").trim();
    const stockText = (get("td:nth-child(6)")?.textContent || "0").replace(/[^0-9.-]/g, "");
    const minText   = (get("td:nth-child(7)")?.textContent || "0").replace(/[^0-9.-]/g, "");
    const dept  = (get("td:nth-child(8)")?.textContent || "").trim();
    const loc   = (get("td:nth-child(9)")?.textContent || "").trim();
    return {
      code,
      name,
      img: imgEl?.getAttribute("src") || "",
      price: priceText,
      stock: Number(stockText || 0),
      min: Number(minText || 0),
      department: dept,
      location: loc
    };
  }

  // --------- Fungsi utama untuk preview item ---------
  function showItemPreview(item) {
    try {
      ensurePreviewModal();

      const d = {
        code: String(item?.code || "").trim(),
        name: String(item?.name || "").trim(),
        dept: String(item?.department || item?.dept || "").trim(),
        loc : String(item?.location || item?.loc || "").trim(),
        priceNum: Number(item?.price || 0),
        stock: Number(item?.stock || 0),
        min  : Number(item?.min || 0),
        img  : item?.img || ""
      };

      const elCode  = document.getElementById("pv-code");
      const elName  = document.getElementById("pv-name");
      const elDept  = document.getElementById("pv-dept");
      const elLoc   = document.getElementById("pv-loc");
      const elPrice = document.getElementById("pv-price");
      const elStock = document.getElementById("pv-stock");
      const elMin   = document.getElementById("pv-min");
      const elImg   = document.getElementById("pv-img");
      const elStatus= document.getElementById("pv-status");
      const qrBox   = document.getElementById("pv-qr");

      if (elCode)  elCode.textContent  = d.code || "-";
      if (elName)  elName.textContent  = d.name || "(名称未設定)";
      if (elDept)  elDept.textContent  = d.dept || "-";
      if (elLoc)   elLoc.textContent   = d.loc  || "-";
      if (elPrice) elPrice.textContent = "¥" + fmt(d.priceNum || 0);
      if (elStock) elStock.textContent = String(d.stock);
      if (elMin)   elMin.textContent   = String(d.min);

      if (elStatus) {
        elStatus.className = "badge";
        if (d.stock <= 0) {
          elStatus.classList.add("bg-secondary");
          elStatus.textContent = "在庫ゼロ";
        } else if (d.stock <= d.min) {
          elStatus.classList.add("bg-danger");
          elStatus.textContent = "要補充";
        } else {
          elStatus.classList.add("bg-success");
          elStatus.textContent = "十分";
        }
      }

      if (elImg) {
        if (d.img) {
          elImg.src = d.img;
          elImg.style.display = "";
        } else {
          elImg.style.display = "none";
        }
      }

      if (qrBox) {
        qrBox.innerHTML = "";
        (async () => {
          try {
            const url = await invGenerateQr(`ITEM|${d.code}`, 128);
            if (url) {
              const im = new Image();
              im.src = url;
              im.width = 128;
              im.height = 128;
              im.alt = d.code;
              qrBox.appendChild(im);
            } else {
              qrBox.textContent = d.code || "(QR)";
            }
          } catch {
            qrBox.textContent = d.code || "(QR)";
          }
        })();
      }

      const btnEdit  = document.getElementById("pv-edit");
      const btnPrint = document.getElementById("pv-print");

      if (btnEdit) {
        btnEdit.onclick = () => {
          try { invOpenEditItem(d.code); }
          catch (e) { alert("編集を開けませんでした"); }
        };
      }

      if (btnPrint) {
        btnPrint.onclick = async () => {
          try {
            const url = await invMakeItemLabel(item);
            const w = window.open("", "_blank", "width=900,height=700");
            if (!w) {
              alert("ポップアップがブロックされました。");
              return;
            }
            w.document.write("<meta charset='utf-8'><title>ラベル印刷</title>");
            w.document.write("<style>body{margin:0;padding:16px;font-family:sans-serif} img{max-width:100%;display:block;margin:0 auto} @media print{img{page-break-inside:avoid;}}</style>");
            w.document.write(`<img src="${url}" alt="${d.code}">`);
            w.document.close();
            w.focus();
            setTimeout(() => { try { w.print(); } catch (_) {} }, 500);
          } catch (e) {
            alert("ラベル生成に失敗しました");
          }
        };
      }

      const modalEl = document.getElementById("preview-modal");
      if (window.bootstrap && window.bootstrap.Modal && modalEl) {
        window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
      } else if (modalEl) {
        modalEl.style.display = "block";
      }

      try { loadItemHistory(d.code); } catch (_e) {}

    } catch (e) {
      console.error("showItemPreview()", e);
      alert("プレビューを開けませんでした。");
    }
  }

  // Untuk Lot / dataURL saja
  function openPreview(url) {
    try {
      ensurePreviewModal();
      const modalEl = document.getElementById("preview-modal");
      if (!modalEl) return;

      const imgEl   = modalEl.querySelector("#pv-img");
      const qrBox   = modalEl.querySelector("#pv-qr");
      const nameEl  = modalEl.querySelector("#pv-name");
      const codeEl  = modalEl.querySelector("#pv-code");
      const deptEl  = modalEl.querySelector("#pv-dept");
      const locEl   = modalEl.querySelector("#pv-loc");
      const priceEl = modalEl.querySelector("#pv-price");
      const stockEl = modalEl.querySelector("#pv-stock");
      const minEl   = modalEl.querySelector("#pv-min");
      const statusEl= modalEl.querySelector("#pv-status");

      if (nameEl)  nameEl.textContent  = "";
      if (codeEl)  codeEl.textContent  = "";
      if (deptEl)  deptEl.textContent  = "";
      if (locEl)   locEl.textContent   = "";
      if (priceEl) priceEl.textContent = "";
      if (stockEl) stockEl.textContent = "";
      if (minEl)   minEl.textContent   = "";
      if (statusEl) { statusEl.className = "badge"; statusEl.textContent = ""; }
      if (qrBox)   qrBox.innerHTML     = "";

      if (imgEl) {
        imgEl.src = url || "";
        imgEl.style.display = url ? "block" : "none";
      }

      if (window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
      } else {
        modalEl.style.display = "block";
      }
    } catch (e) {
      console.error("openPreview failed:", e);
      alert("プレビューを開けませんでした。");
    }
  }

  // Binding tombol preview di tabel 商品一覧
  function bindPreviewButtons() {
    const tbl = document.getElementById("tbl-items");
    if (!tbl || tbl.__pvBound) return;
    tbl.__pvBound = true;

    ensurePreviewModal();

    // klik tombol プレビュー (fallback kalau IIFE utama tidak memanggil showItemPreview langsung)
    tbl.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".btn-preview");
      if (!btn) return;
      ev.preventDefault();
      const tr = btn.closest("tr");
      if (!tr) return;
      const data = extractRowData(tr);
      showItemPreview(data);
    });

    // klik nama item
    tbl.addEventListener("click", (ev) => {
      const a = ev.target.closest(".link-item");
      if (!a) return;
      ev.preventDefault();
      const tr = a.closest("tr");
      if (!tr) return;
      const data = extractRowData(tr);
      showItemPreview(data);
    });

    // alias lain kalau nanti ada
    tbl.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-action='detail'], [data-role='preview']");
      if (!btn) return;
      ev.preventDefault();
      const tr = btn.closest("tr");
      if (!tr) return;
      const data = extractRowData(tr);
      showItemPreview(data);
    });
  }

  // Filter badge cepat (low / zero / img / all)
  document.addEventListener("click", (e) => {
    const a = e.target.closest(".js-filter");
    if (!a) return;
    const f = a.dataset.f;
    const rows = document.querySelectorAll("#tbl-items tr[data-code]");
    rows.forEach(tr => {
      const d = extractRowData(tr);
      let show = true;
      if (f === "low")  show = d.stock > 0 && d.stock <= d.min;
      if (f === "zero") show = d.stock <= 0;
      if (f === "img")  show = !!d.img;
      if (f === "all")  show = true;
      tr.style.display = show ? "" : "none";
    });
  });

  // Expose helper ke global agar bisa dipakai dari IIFE utama
  window.showItemPreview    = showItemPreview;
  window.openPreview        = openPreview;
  window.bindPreviewButtons = bindPreviewButtons;

})();
