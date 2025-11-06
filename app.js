/* =========================================================
 * app.js — Inventory (GAS backend)
 * =======================================================*/
(function () {
  "use strict";

  /* -------------------- Helpers -------------------- */
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const fmt = (n) => new Intl.NumberFormat("ja-JP").format(Number(n || 0));
  const isMobile = () => /Android|iPhone|iPad/i.test(navigator.userAgent);
  function toast(msg) { alert(msg); }
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
    for (const p of locals) { try { await loadScriptOnce(p); if (window.QRCode) return; } catch { } }
    const cdns = [
      "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js",
      "https://unpkg.com/qrcodejs@1.0.0/qrcode.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"
    ];
    for (const u of cdns) { try { await loadScriptOnce(u); if (window.QRCode) return; } catch { } }
    throw new Error("QRCode library tidak tersedia (qrlib.js)");
  }
  async function ensureHtml5Qrcode() {
    if (window.Html5Qrcode) return;
    const locals = ["./html5-qrcode.min.js", "./vendor/html5-qrcode.min.js"];
    for (const p of locals) { try { await loadScriptOnce(p); if (window.Html5Qrcode) return; } catch { } }
    const cdns = [
      "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/minified/html5-qrcode.min.js",
      "https://unpkg.com/html5-qrcode@2.3.8/minified/html5-qrcode.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/minified/html5-qrcode.min.js"
    ];
    for (const u of cdns) { try { await loadScriptOnce(u); if (window.Html5Qrcode) return; } catch { } }
    throw new Error("html5-qrcode tidak tersedia");
  }

  function getCurrentUser() { try { return JSON.parse(localStorage.getItem("currentUser") || "null"); } catch { return null; } }
  function setCurrentUser(u) { localStorage.setItem("currentUser", JSON.stringify(u || null)); }
  function logout() { setCurrentUser(null); location.href = "index.html"; }
  function isAdmin() { return (getCurrentUser()?.role || "user").toLowerCase() === "admin"; }

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
      if (id === "view-shelf") { renderShelfTable(); renderShelfRecap(); }
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
        const csv = ["month,in,out"].concat(series.map(s => [s.month, s.in || 0, s.out || 0].join(","))).join("\n");
        const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "monthly.csv"; a.click(); URL.revokeObjectURL(url);
      }, { once: true });
    } catch {
      toast("ダッシュボードの読み込みに失敗しました。");
    }
  }

  /* -------------------- Items -------------------- */
  let _ITEMS_CACHE = [];
  function escapeHtml(s) { return String(s || "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", "&gt;": "&gt;", "\"": "&quot;", "'": "&#39;" }[m])); }
  function escapeAttr(s) { return escapeHtml(s); }

  function tplItemRow(it) {
    const qrid = `qr-${it.code}`;
    return `<tr>
      <td style="width:110px">
        <div class="tbl-qr-box"><div id="${qrid}" class="d-inline-block"></div></div>
      </td>
      <td>${escapeHtml(it.code)}</td>
      <td><a href="#" class="link-underline link-item" data-code="${escapeHtml(it.code)}">${escapeHtml(it.name)}</a></td>
      <td>${it.img ? `<img src="${escapeAttr(it.img)}" alt="" style="height:32px">` : ""}</td>
      <td class="text-end">¥${fmt(it.price)}</td>
      <td class="text-end">${fmt(it.stock)}</td>
      <td class="text-end">${fmt(it.min)}</td>
      <td>${escapeHtml(it.department || "")}</td>
      <td>${escapeHtml(it.location || "")}</td>
      <td>
        <div class="act-grid">
          <button class="btn btn-sm btn-primary btn-edit" data-code="${escapeAttr(it.code)}" title="編集"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-danger btn-del" data-code="${escapeAttr(it.code)}" title="削除"><i class="bi bi-trash"></i></button>
          <button class="btn btn-sm btn-outline-success btn-dl" data-code="${escapeAttr(it.code)}" title="ダウンロード"><i class="bi bi-download"></i></button>
          <button class="btn btn-sm btn-outline-warning btn-lotqr" data-code="${escapeAttr(it.code)}" title="Lot QR"><i class="bi bi-qr-code"></i></button>
          <button class="btn btn-sm btn-outline-secondary btn-preview" data-code="${escapeAttr(it.code)}" title="プレビュー"><i class="bi bi-search"></i></button>
        </div>
      </td>
    </tr>`;
  }

  async function renderItems() {
    try {
      const list = await api("items", { method: "GET" });
      _ITEMS_CACHE = Array.isArray(list) ? list : (Array.isArray(list?.data) ? list.data : []);
      const tbody = $("#tbl-items");
      tbody.innerHTML = _ITEMS_CACHE.map(tplItemRow).join("");

      await ensureQRCode();
      for (const it of _ITEMS_CACHE) {
        const holder = document.getElementById(`qr-${it.code}`);
        if (!holder) continue; holder.innerHTML = "";
        new QRCode(holder, { text: `ITEM|${it.code}`, width: 64, height: 64, correctLevel: QRCode.CorrectLevel.M });
      }

      tbody.onclick = async (e) => {
        const btn = e.target.closest("button"); if (!btn) return;
        const code = btn.getAttribute("data-code");
        if (btn.classList.contains("btn-edit")) openEditItem(code);
        else if (btn.classList.contains("btn-del")) {
          if (!isAdmin()) return toast("Akses ditolak (admin only)");
          if (!confirm("削除しますか？")) return;
          const r = await api("deleteItem", { method: "POST", body: { code } });
          r?.ok ? renderItems() : toast(r?.error || "削除失敗");
        } else if (btn.classList.contains("btn-dl")) {
          const it = _ITEMS_CACHE.find(x => String(x.code) === String(code));
          const url = await makeItemLabelDataURL(it);
          const a = document.createElement("a"); a.href = url; a.download = `label_${it.code}.png`; a.click();
        } else if (btn.classList.contains("btn-preview")) {
          const it = _ITEMS_CACHE.find(x => String(x.code) === String(code));
          const url = await makeItemLabelDataURL(it); openPreview(url);
        }// === LOT QR: open modal buat QR per lot/kotak ===
else if (btn.classList.contains("btn-lotqr")) {
  const it = _ITEMS_CACHE.find(x => String(x.code) === String(code));
  openLotQRModal(it);
}

      };

      $$("#tbl-items .link-item").forEach(a => {
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          const code = a.getAttribute("data-code");
          const it = _ITEMS_CACHE.find(x => String(x.code) === String(code));
          showItemDetail(it);
        });
      });

      $("#items-search")?.addEventListener("input", (e) => {
        const q = (e.target.value || "").toLowerCase();
        $$("#tbl-items tr").forEach(tr => {
          const name = (tr.children[2]?.textContent || "").toLowerCase();
          const code = (tr.children[1]?.textContent || "").toLowerCase();
          tr.style.display = (name.includes(q) || code.includes(q)) ? "" : "none";
        });
      });

    } catch { toast("商品一覧の読み込みに失敗しました。"); }
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
          <input id="md-location" class="form-control text-uppercase" value="${escapeAttr(it.location || "")}" placeholder="A-01-03">
          <div class="col-md-4"><label class="form-label">部門</label>
          <input id="md-department" class="form-control" value="${escapeAttr(it.department || "")}" placeholder="製造/品質/倉庫など"></div>
        </div>
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

  // New Item (admin only)
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
// === LOT QR: modal pembuat QR per lot/kotak ===
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
          <div class="small text-muted">内容：<code>LOT|${escapeHtml(item.code)}|&lt;qty&gt;|&lt;lotId?&gt;</code><br>または JSON <code>{"t":"lot","code","qty","lot"}</code></div>
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
  let lastUrl = "";

  async function renderQR() {
    await ensureQRCode();
    box.innerHTML = "";
    const qty = Math.max(1, Number($("#lot-qty", wrap).value || 0) || 1);
    const lot = ($("#lot-id", wrap).value || "").trim();
    const text = lot ? `LOT|${item.code}|${qty}|${lot}` : `LOT|${item.code}|${qty}`;
    new QRCode(box, { text, width: 140, height: 140, correctLevel: QRCode.CorrectLevel.M });
    // simpan dataURL untuk DL
    lastUrl = await generateQrDataUrl(text, 300);
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
    const a = document.createElement("a");
    const lotSafe = lot ? `_${lot}` : "";
    a.href = url; a.download = `LOT_${item.code}${lotSafe}_${qty}.png`; a.click();
  });

  wrap.addEventListener("hidden.bs.modal", () => wrap.remove(), { once: true });
}

  function showItemDetail(it) {
    const card = $("#card-item-detail"); if (!card) return;
    const body = $("#item-detail-body", card);
    body.innerHTML = `
      <div class="d-flex gap-3">
        <div style="width:160px;height:120px;background:#f3f6ff;border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden">
          ${it.img ? `<img src="${escapeAttr(it.img)}" style="max-width:100%;max-height:100%">` : '<span class="text-primary">画像</span>'}
        </div>
        <div class="flex-1">
          <div><b>コード</b>：${escapeHtml(it.code)}</div>
          <div><b>名称</b>：${escapeHtml(it.name)}</div>
          <div><b>価格</b>：¥${fmt(it.price)}</div>
          <div><b>在庫</b>：${fmt(it.stock)}</div>
          <div><b>最小</b>：${fmt(it.min)}</div>
          <div><b>部門</b>：${escapeHtml(it.department || "")}</div>
          <div><b>置場</b>：<span class="badge text-bg-light border">${escapeHtml(it.location || "")}</span></div>
        </div>
      </div>`;
    card.classList.remove("d-none");
    $("#btn-close-detail")?.addEventListener("click", () => card.classList.add("d-none"), { once: true });
  }

  function openPreview(url) {
    const w = window.open("", "_blank", "width=900,height=600");
    if (!w || !w.document) { const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.download = ""; a.click(); return; }
    w.document.write(`<img src="${url}" style="max-width:100%">`);
  }

  // ---------- LABEL CANVAS (wrap teks & grid cetak) ----------
async function makeItemLabelDataURL(item) {
  const W = 760, H = 260, pad = 18, imgW = 200, gap = 16;
  const QUIET = 16, qrSize = 136, gapQR = 14;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"); g.imageSmoothingEnabled = false;

  // --- border luar (garis tajam 0.5px align) ---
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.strokeStyle = "#000"; g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, W - 1, H - 1);

  // --- kolom kiri (gambar) ---
  const rx = pad, ry = pad, rw = imgW, rh = H - 2 * pad, r = 18;
  roundRect(g, rx, ry, rw, rh, r, true, true, "#eaf1ff", "#cbd5e1");
  await drawImageIfAny(g, item.img, rx, ry, rw, rh, r);

  // --- QR ---
  const colStart = pad + imgW + gap;
  const qy = pad + ((H - 2 * pad) - qrSize) / 2;
  const qx = colStart + gapQR + QUIET;
  g.fillStyle = "#fff";
  g.fillRect(qx - QUIET, qy - QUIET, qrSize + 2 * QUIET, qrSize + 2 * QUIET);
  try {
    const du = await generateQrDataUrl(`ITEM|${item.code}`, qrSize);
    const im = new Image(); im.src = du; await imgLoaded(im);
    g.drawImage(im, qx, qy, qrSize, qrSize);
  } catch {}

  // --- grid kanan ---
  const colQRW = qrSize + 2 * QUIET;
  const gridX  = colStart + gapQR + colQRW + gapQR;
  const cellH  = (H - 2 * pad) / 3;
  g.strokeStyle = "#000"; g.lineWidth = 1;
  g.strokeRect(gridX + 0.5, pad + 0.5, W - gridX - pad - 1, H - 2 * pad - 1);
  for (let i = 1; i <= 2; i++) {
    const y = pad + cellH * i;
    g.beginPath(); g.moveTo(gridX + 0.5, y + 0.5); g.lineTo(W - pad - 0.5, y + 0.5); g.stroke();
  }

  // --- label & nilai (rapi & tengah) ---
  const labelWidth = 96;             // ruang label (kolom kiri di grid)
  const labelX = gridX + 10;
  const valX   = gridX + 10 + labelWidth;   // mulai nilai setelah label
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
    // label (vertikal center)
    g.font = LBL_FONT; g.fillStyle = "#000";
    const labelH = 14; // dari font di atas
    const ly = yTop + (cellH - labelH) / 2;
    g.textBaseline = "top"; g.textAlign = "left";
    g.fillText(cell.title, labelX, Math.round(ly));

    // nilai (wrap & center vertikal)
    drawWrapBoxVCenter(
      g, cell.value, valX, yTop + 4, valMaxW, cellH - 8,
      { base: cell.base, min: cell.min, lineGap: 3, weight: VAL_WEIGHT }
    );
  });

  return c.toDataURL("image/png");

  // ===== helpers =====
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
    } catch {}
  }

  // token-aware + pecah per karakter bila perlu (CJK)
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
    // vertikal tengah
    const totalH = lines.length * size + (lines.length - 1) * gap;
    let y = yTop + (maxH - totalH) / 2;
    ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillStyle = "#000";
    for (const ln of lines){
      ctx.fillText(ln, x, Math.round(y));
      y += size + gap;
      if (y - yTop > maxH) break;
    }
  }
}



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
        catch { return ""; }
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
// === LOT QR: label dataURL (mirip item, ada info lot & qty/box) ===
async function makeLotLabelDataURL(item, qtyPerBox, lotId) {
  // pakai kanvas item sebagai base, lalu tulis keterangan tambahan
  const base = await makeItemLabelDataURL(item);
  const im = new Image(); im.src = base; await new Promise(r=>{im.onload=r; im.onerror=r;});
  const W = im.width, H = im.height;
  const c = document.createElement("canvas"); c.width=W; c.height=H;
  const g = c.getContext("2d"); g.imageSmoothingEnabled = false;
  g.drawImage(im, 0, 0);

  // Tulisan tambahan di area kanan atas (ringkas & jelas)
  g.fillStyle = "#111";
  g.font = '700 18px "Noto Sans JP", system-ui';
  const line1 = `箱あたり：${qtyPerBox} pcs`;
  const line2 = lotId ? `ロット：${lotId}` : "";
  g.fillText(line1, W - 260, 36);
  if (line2) g.fillText(line2, W - 260, 62);

  // QR berbeda: LOT|
  try {
    const du = await generateQrDataUrl(
      lotId ? `LOT|${item.code}|${qtyPerBox}|${lotId}` : `LOT|${item.code}|${qtyPerBox}`,
      136
    );
    const qr = new Image(); qr.src = du; await new Promise(r=>{qr.onload=r; qr.onerror=r;});
    // timpa QR default (posisi sama seperti makeItemLabelDataURL)
    const pad = 18, imgW = 200, gap = 16, QUIET = 16, qrSize = 136, gapQR = 14;
    const colStart = pad + imgW + gap;
    const qy = pad + ((H - 2 * pad) - qrSize) / 2;
    const qx = colStart + gapQR + QUIET;
    g.fillStyle = "#fff"; g.fillRect(qx - QUIET, qy - QUIET, qrSize + 2*QUIET, qrSize + 2*QUIET);
    g.drawImage(qr, qx, qy, qrSize, qrSize);
  } catch {}

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
      tbody.innerHTML = arr.map(u => `
        <tr>
          <td style="width:170px"><div id="uqr-${escapeAttr(u.id)}"></div></td>
          <td>${escapeHtml(u.id)}</td>
          <td>${escapeHtml(u.name)}</td>
          <td>${escapeHtml(u.role || "user")}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-success btn-dl-user" data-id="${escapeAttr(u.id)}" title="ダウンロード">
              <i class="bi bi-download"></i>
            </button>
          </td>
        </tr>
      `).join("");

      await ensureQRCode();
      for (const u of arr) {
        const el = document.getElementById(`uqr-${u.id}`); if (!el) continue;
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
    } catch { toast("ユーザーQRの読み込みに失敗しました。"); }
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
    } catch { toast("履歴の読み込みに失敗しました。"); }
  }

  /* -------------------- IO Scanner -------------------- */
  let IO_SCANNER = null;
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
            } catch { }
            raf = requestAnimationFrame(loop);
          };
          const stop = () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks()?.forEach(t => t.stop()); mount.innerHTML = ""; };
          loop();
          return { stop: async () => stop(), clear: () => { try { mount.innerHTML = ""; } catch { } } };
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
      } catch { }
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

  (function bindIO() {
    const btnStart = $("#btn-io-scan"), btnStop = $("#btn-io-stop"), area = $("#io-scan-area");
    if (!btnStart || !btnStop || !area) return;

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
    // Konfirmasi & biarkan user tentukan qty secara manual (item satuan)
    if (confirm("この商品を追加してもよろしいですか？")) {
      // Tidak auto-submit untuk item satuan (tetap sesuai flow lama)
      // (User bisa langsung tekan 登録)
    }
    return;
  }

  if (parsed.kind === "lot") {
    const { code, qty, lot } = parsed;
    $("#io-code").value = code;
    await findItemIntoIO(code);

    // Set jenis, unit, qty sesuai preferensi form saat itu
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
          $("#io-qty").value = "";                // bersihkan qty input
          await findItemIntoIO(code);             // refresh harga/stock
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
      try { await IO_SCANNER?.stop?.(); IO_SCANNER?.clear?.(); } catch { }
      area.innerHTML = "カメラ待機中…";
    });

    $("#btn-io-lookup")?.addEventListener("click", () => {
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
  })();

  async function findItemIntoIO(code) {
    try {
      let it = _ITEMS_CACHE.find(x => String(x.code) === String(code));
      if (!it) {
        const r = await api("itemByCode", { method: "POST", body: { code } }); it = r && r.ok ? r.item : null;
      }
      if (!it) return;
      $("#io-name").value = it.name || "";
      $("#io-price").value = it.price || 0;
      $("#io-stock").value = it.stock || 0;
    } catch (e) { console.warn(e); }
  }

  /* -------------------- Stocktake (棚卸) -------------------- */
  let SHELF_SCANNER = null;
  const ST = { rows: new Map() }; // code => {code,name,book,qty,diff}
  window.ST = ST;

 // === LOT QR: parser baru untuk ITEM/LOT ===
function parseScanText(txt) {
  const s = String(txt || "");
  // Format ringkas: ITEM|CODE
  if (/^ITEM\|/i.test(s)) {
    const code = (s.split("|")[1] || "").trim();
    return { kind: "item", code };
  }
  // Format ringkas: LOT|CODE|QTY|LOTID(opsional)
  if (/^LOT\|/i.test(s)) {
    const [, codeRaw, qtyRaw, lotRaw] = s.split("|");
    const code = String(codeRaw || "").trim();
    const qty  = Number(qtyRaw || 0) || 0;
    const lot  = (lotRaw || "").trim();
    if (code && qty > 0) return { kind: "lot", code, qty, lot };
  }
  // Format JSON
  try {
    const o = JSON.parse(s);
    if ((o.t === "item" || o.type === "item") && o.code) {
      return { kind: "item", code: String(o.code) };
    }
    if ((o.t === "lot" || o.type === "lot") && o.code && Number(o.qty || 0) > 0) {
      return { kind: "lot", code: String(o.code), qty: Number(o.qty), lot: String(o.lot || "") };
    }
  } catch {}
  return null;
}


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
// === LOT QR: helper increment qty di stocktake saat scan lot ===
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
          <div class="st-actions">
            ${isadmin ? `<button class="btn btn-outline-primary btn-st-adjust">Adjust</button>` : ""}
            ${isadmin ? `<button class="btn btn-outline-secondary btn-st-edit">Edit</button>` : ""}
          </div>
        </td>
      </tr>
    `).join("");

    tbody.oninput = (e) => {
      const tr = e.target.closest("tr"); if (!tr) return;
      if (!e.target.classList.contains("st-qty")) return;
      const code = tr.getAttribute("data-code"); const rec = ST.rows.get(code); if (!rec) return;
      rec.qty = Number(e.target.value || 0); rec.diff = rec.qty - rec.book;
      tr.children[5].textContent = fmt(rec.diff);
      tr.children[5].classList.toggle("fw-bold", rec.diff !== 0);
    };

    tbody.onclick = (e) => {
      const tr = e.target.closest("tr"); if (!tr) return; const code = tr.getAttribute("data-code"); const rec = ST.rows.get(code); if (!rec) return;
      if (e.target.closest(".btn-st-adjust")) { if (!isAdmin()) return toast("Akses ditolak (admin only)"); openAdjustModal(rec); }
      else if (e.target.closest(".btn-st-edit")) { if (!isAdmin()) return toast("Akses ditolak (admin only)"); openEditItem(code); }
    };
  }

  async function renderShelfRecap() {
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
      const tbM = $("#st-recap-monthly"); const tbY = $("#st-recap-yearly");
      if (tbM) {
        const rows = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `<tr><td>${k}</td><td class="text-end">${fmt(v.in)}</td><td class="text-end">${fmt(v.out)}</td></tr>`);
        tbM.innerHTML = rows.join("");
      }
      if (tbY) {
        const rows = [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `<tr><td>${k}</td><td class="text-end">${fmt(v.in)}</td><td class="text-end">${fmt(v.out)}</td></tr>`);
        tbY.innerHTML = rows.join("");
      }

      $("#st-recap-export-monthly")?.addEventListener("click", () => {
        const csv = ["month,in,out"].concat([...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, v.in, v.out].join(","))).join("\n");
        const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "stocktake_monthly.csv"; a.click(); URL.revokeObjectURL(url);
      }, { once: true });
      $("#st-recap-export-yearly")?.addEventListener("click", () => {
        const csv = ["year,in,out"].concat([...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, v.in, v.out].join(","))).join("\n");
        const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "stocktake_yearly.csv"; a.click(); URL.revokeObjectURL(url);
      }, { once: true });

    } catch (e) { console.warn(e); }
  }

  function openAdjustModal(rec) {
    const wrap = document.createElement("div");
    wrap.className = "modal fade";
    wrap.innerHTML = `
<div class="modal-dialog">
  <div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">Adjust 在庫</h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <div class="mb-2"><b>コード：</b>${escapeHtml(rec.code)}</div>
      <div class="mb-2"><b>名称：</b>${escapeHtml(rec.name)}</div>
      <div class="row g-3">
        <div class="col-md-6"><label class="form-label">帳簿</label><input class="form-control" value="${rec.book}" readonly></div>
        <div class="col-md-6"><label class="form-label">新しい在庫</label><input id="aj-new" type="number" class="form-control" value="${rec.qty || rec.book}"></div>
      </div>
      <div class="small text-muted mt-2">この操作は即時に在庫を上書きします（履歴は別管理）。</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-bs-dismiss="modal">キャンセル</button>
      <button class="btn btn-primary" id="aj-save">保存</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap); modal.show();

    $("#aj-save", wrap)?.addEventListener("click", async () => {
      try {
        const newStock = Number($("#aj-new", wrap).value || 0);
        const payload = { code: rec.code, name: rec.name, stock: newStock, overwrite: true };
        const r = await api("updateItem", { method: "POST", body: payload });
        if (r?.ok) {
          rec.book = newStock; rec.qty = newStock; rec.diff = 0;
          ST.rows.set(rec.code, rec); renderShelfTable();
          const idx = _ITEMS_CACHE.findIndex(x => String(x.code) === String(rec.code));
          if (idx >= 0) _ITEMS_CACHE[idx].stock = newStock;
          modal.hide(); wrap.remove(); toast("在庫を更新しました");
        } else toast(r?.error || "更新失敗");
      } catch (e) { toast("更新失敗: " + (e?.message || e)); }
    });

    wrap.addEventListener("hidden.bs.modal", () => wrap.remove(), { once: true });
  }

  (function bindShelf() {
    const btnStart = $("#btn-start-scan"), btnStop = $("#btn-stop-scan"), area = $("#scan-area");
    if (!btnStart || !btnStop || !area) return;

    btnStart.addEventListener("click", async () => {
      try {
        area.textContent = "カメラ起動中…";
        SHELF_SCANNER = await startBackCameraScan("scan-area", async (text) => {
  const p = parseScanText(String(text || ""));
  if (!p) return;

  if (p.kind === "item") {
    // Item: tetap seperti sebelumnya (set ke buku/qty eksisting), konfirmasi dahulu
    if (confirm("この商品を追加してもよろしいですか？")) {
      await addOrUpdateStocktake(p.code, ST.rows.get(p.code)?.qty ?? undefined);
    }
    return;
  }

  if (p.kind === "lot") {
    // Lot: increment +qtyPerBox per scan
    if (confirm("この商品を追加してもよろしいですか？")) {
      await addOrIncStocktake(p.code, Number(p.qty || 0));
    }
    return;
  }
});

      } catch (e) { toast(e?.message || String(e)); }
    });

    btnStop.addEventListener("click", async () => {
      try { await SHELF_SCANNER?.stop?.(); SHELF_SCANNER?.clear?.(); } catch { }
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
  })();

  /* -------------------- Export / Import wiring -------------------- */

  // Users print
  $("#btn-print-qr-users")?.addEventListener("click", () => window.print());

  // Users export/import
  $("#btn-users-export")?.addEventListener("click", async () => {
    try {
      const list = await api("users", { method: "GET" });
      const arr = Array.isArray(list) ? list : (list?.data || []);
      const csv = ["id,name,role"]
        .concat(arr.map(u => [u.id, (u.name || "").replace(/,/g, " "), (u.role || "user")].join(","))).join("\n");
      const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "users.csv"; a.click(); URL.revokeObjectURL(url);
    } catch { alert("エクスポート失敗"); }
  });
  $("#btn-users-import")?.addEventListener("click", () => {
    if (!isAdmin()) return alert("権限がありません（admin のみ）");
    $("#input-users-import")?.click();
  });
  $("#input-users-import")?.addEventListener("change", async (e) => {
    if (!isAdmin()) return alert("権限がありません（admin のみ）");
    const f = e.target.files?.[0]; if (!f) return;
    const text = await f.text(); const rows = text.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
    const start = rows[0]?.toLowerCase?.().startsWith("id") ? 1 : 0;
    let ok = 0, fail = 0;
    for (let i = start; i < rows.length; i++) {
      const [id, name, role] = rows[i].split(",").map(s => s?.trim());
      if (!id) { fail++; continue; }
      try {
        await api("upsertUser", { method: "POST", body: { id, name, role: (role || "user") } }); ok++;
      } catch { fail++; }
    }
    alert(`インポート完了：成功 ${ok} 件 / 失敗 ${fail} 件`); e.target.value = ""; renderUsers();
  });

  // Items export (CSV & Excel) — (dibiarkan ganda jika memang sudah ada tombol gandanya)
  $("#btn-items-export")?.addEventListener("click", async () => {
    try {
      const list = await api("items", { method: "GET" });
      const arr = Array.isArray(list) ? list : (list?.data || []);
      const csv = ["code,name,price,stock,min,location,img"]
        .concat(arr.map(i => [
          i.code,
          String(i.name || "").replace(/,/g, " "),
          Number(i.price || 0),
          Number(i.stock || 0),
          Number(i.min || 0),
          String(i.location || "").toUpperCase(),
          i.img || ""
        ].join(",")))
        .join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "items.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch { alert("エクスポート失敗"); }
  });

  $("#btn-items-xlsx")?.addEventListener("click", async () => {
    try {
      const list = await api("items", { method: "GET" });
      const arr = Array.isArray(list) ? list : (list?.data || []);
      const rows = arr.map(i => ({
        code: i.code,
        name: i.name || "",
        price: Number(i.price || 0),
        stock: Number(i.stock || 0),
        min: Number(i.min || 0),
        location: String(i.location || "").toUpperCase(),
        img: i.img || ""
      }));
      const ws = XLSX.utils.json_to_sheet(rows, { header: ["code","name","price","stock","min","location","img"] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "items");
      XLSX.writeFile(wb, "items.xlsx");
    } catch { alert("エクスポート失敗"); }
  });

  // Items export (CSV) + department
  $("#btn-items-export")?.addEventListener("click", async () => {
    try {
      const list = await api("items", { method: "GET" });
      const arr = Array.isArray(list) ? list : (list?.data || []);
      const csv = ["code,name,price,stock,min,location,department,img"]
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
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "items.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch { alert("エクスポート失敗"); }
  });

  // Items export (Excel) + department
  $("#btn-items-xlsx")?.addEventListener("click", async () => {
    try {
      const list = await api("items", { method: "GET" });
      const arr = Array.isArray(list) ? list : (list?.data || []);
      const rows = arr.map(i => ({
        code: i.code,
        name: i.name || "",
        price: Number(i.price || 0),
        stock: Number(i.stock || 0),
        min: Number(i.min || 0),
        location: String(i.location || "").toUpperCase(),
        department: i.department || "",
        img: i.img || ""
      }));
      const ws = XLSX.utils.json_to_sheet(rows, { header: ["code","name","price","stock","min","location","department","img"] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "items");
      XLSX.writeFile(wb, "items.xlsx");
    } catch { alert("エクスポート失敗"); }
  });

  // --- Print all item labels (grid, banyak per lembar) ---
  document.getElementById("btn-items-print-all")?.addEventListener("click", async () => {
    try {
      setLoading(true, "ラベルを生成中…");

      let arr = _ITEMS_CACHE && _ITEMS_CACHE.length
        ? _ITEMS_CACHE
        : (await api("items", { method: "GET" })) || [];
      if (!Array.isArray(arr)) arr = arr.data || [];

      const urls = [];
      for (const it of arr) { urls.push(await makeItemLabelDataURL(it)); }

      const w = window.open("", "_blank");
      const doc = w.document;
      doc.write(`<!doctype html><html><head><meta charset="utf-8">
        <title>Labels</title>
        <style>
          @page { size: A4; margin: 6mm; }
          html,body{margin:0;padding:0}
          .sheet{
            display:grid;
            grid-template-columns: repeat(auto-fill, minmax(90mm, 1fr));
            gap:6mm;
            align-items:start;
          }
          .label{ break-inside: avoid; page-break-inside: avoid; }
          .label img{ width:100%; height:auto; display:block; }
        </style>
      </head><body><div class="sheet"></div></body></html>`);

      const wrap = doc.querySelector(".sheet");
      urls.forEach(u => {
        const d = doc.createElement("div");
        d.className = "label";
        d.innerHTML = `<img src="${u}">`;
        wrap.appendChild(d);
      });

      const imgs = [...doc.images];
      let loaded = 0;
      const done = () => { if (++loaded >= imgs.length) { w.focus(); w.print(); } };
      if (imgs.length === 0) { w.focus(); w.print(); }
      else imgs.forEach(im => (im.complete ? done() : im.onload = done));
    } catch (e) {
      console.error(e);
      toast("印刷データの生成に失敗しました。");
    } finally {
      setLoading(false);
    }
  });

  // ---------- Items Reload & Auto-refresh ----------
  (function(){
    let itemsAutoTimer = null;
    let itemsAutoSec   = 0;

    function isItemsViewActive(){
      const v = document.getElementById("view-items");
      return v && !v.classList.contains("d-none");
    }

    async function reloadItemsSoft(){
      try {
        if (typeof window.renderItems === "function") {
          await window.renderItems();
        } else if (typeof window.loadItems === "function") {
          await window.loadItems();
        } else {
          location.reload();
          return;
        }
        if (isItemsViewActive() && typeof toast === "function") toast("更新しました");
      } catch (e){
        console.error(e);
        location.reload();
      }
    }

    document.getElementById("btn-items-reload")?.addEventListener("click", (e)=>{
      e.preventDefault();
      reloadItemsSoft();
    });

    document.querySelectorAll('[data-autorefresh]').forEach(el=>{
      el.addEventListener("click", ()=>{
        const sec = Number(el.getAttribute("data-autorefresh") || "0");
        itemsAutoSec = sec;
        if (itemsAutoTimer) { clearInterval(itemsAutoTimer); itemsAutoTimer = null; }
        const btn = document.getElementById("btn-items-auto");
        if (btn) btn.textContent = sec ? `Auto ${sec}s` : "Auto";
        if (!sec) return;
        itemsAutoTimer = setInterval(()=>{
          if (isItemsViewActive()) reloadItemsSoft();
        }, sec * 1000);
      });
    });

    window.addEventListener("beforeunload", ()=>{ if (itemsAutoTimer) clearInterval(itemsAutoTimer); });
  })();

  // Items import (CSV)
  $("#btn-items-import")?.addEventListener("click", () => $("#input-items-import")?.click());
  $("#input-items-import")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text(); const rows = text.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
    const start = rows[0]?.toLowerCase?.().includes("code") ? 1 : 0;
    let ok = 0, fail = 0;
    for (let i = start; i < rows.length; i++) {
      const cols = rows[i].split(",").map(s => s?.trim());
      const [code, name, price, stock, min, location, img, department] = [cols[0], cols[1], cols[2], cols[3], cols[4], cols[5], cols[6], cols[7]];
      if (!code) { fail++; continue; }
      try {
        await api("updateItem", {
          method: "POST", body: {
            code, name, price: Number(price || 0), stock: Number(stock || 0), min: Number(min || 0),
            location: (location || "").toUpperCase(), img, department: (department || "").trim(), overwrite: true
          }
        });
        ok++;
      } catch { fail++; }
    }
    alert(`インポート完了：成功 ${ok} 件 / 失敗 ${fail} 件`); e.target.value = ""; renderItems();
  });

  // IO export/import
  $("#btn-io-export")?.addEventListener("click", async () => {
    try {
      const raw = await api("history", { method: "GET" });
      const list = Array.isArray(raw) ? raw : (raw?.history || raw?.data || []);
      const recent = list.slice(-200);
      const csv = ["timestamp,userId,code,qty,unit,type,note"]
        .concat(recent.map(h => [
          h.timestamp || h.date || "", h.userId || "", h.code || "", h.qty || 0, h.unit || "", h.type || "", (h.note || "").replace(/,/g, " ")
        ].join(","))).join("\n");
      const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "io_history.csv"; a.click(); URL.revokeObjectURL(url);
    } catch { alert("エクスポート失敗"); }
  });
  $("#btn-io-import")?.addEventListener("click", () => $("#input-io-import")?.click());
  $("#input-io-import")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const text = await f.text(); const rows = text.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
    const start = rows[0]?.toLowerCase?.().includes("user") ? 1 : 0;
    let ok = 0, fail = 0;
    for (let i = start; i < rows.length; i++) {
      const [userId, code, qty, unit, type, note] = rows[i].split(",").map(s => s?.trim());
      if (!userId || !code) { fail++; continue; }
      try { await api("log", { method: "POST", body: { userId, code, qty: Number(qty || 0), unit, type, note } }); ok++; }
      catch { fail++; }
    }
    alert(`インポート完了：成功 ${ok} 件 / 失敗 ${fail} 件`); e.target.value = "";
  });

  // Stocktake export/import
  $("#st-export2")?.addEventListener("click", () => {
    const arr = [...(ST.rows?.values?.() || [])];
    const csv = ["code,name,book,qty,diff"]
      .concat(arr.map(r => [r.code, (r.name || "").replace(/,/g, " "), r.book, r.qty, r.diff].join(","))).join("\n");
    const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "stocktake.csv"; a.click(); URL.revokeObjectURL(url);
  });
  $("#st-import")?.addEventListener("click", () => $("#input-st-import")?.click());
  $("#input-st-import")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const text = await f.text(); const rows = text.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
    const start = rows[0]?.toLowerCase?.().includes("code") ? 1 : 0;
    for (let i = start; i < rows.length; i++) {
      const [code, qty] = rows[i].split(",").map(s => s?.trim());
      if (!code) continue; await addOrUpdateStocktake(code, Number(qty || 0));
    }
    e.target.value = ""; alert("インポート完了");
  });

  // History export
  $("#btn-history-export")?.addEventListener("click", async () => {
    try {
      const raw = await api("history", { method: "GET" });
      const list = Array.isArray(raw) ? raw : (raw?.history || raw?.data || []);
      const csv = ["timestamp,userId,userName,code,itemName,qty,unit,type,note"]
        .concat(list.map(h => [
          h.timestamp || h.date || "", h.userId || "", h.userName || "", h.code || "", (h.itemName || h.name || "").replace(/,/g, " "),
          h.qty || 0, h.unit || "", h.type || "", (h.note || "").replace(/,/g, " ")
        ].join(","))).join("\n");
      const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "history.csv"; a.click(); URL.revokeObjectURL(url);
    } catch { alert("エクスポート失敗"); }
  });

  /* -------------------- Boot -------------------- */
  window.addEventListener("DOMContentLoaded", () => {
    const logo = document.getElementById("brand-logo");
    if (logo && window.CONFIG && CONFIG.LOGO_URL) { logo.src = CONFIG.LOGO_URL; logo.alt = "logo"; logo.onerror = () => { logo.style.display = "none"; }; }

    const newItemBtn = $("#btn-open-new-item");
    const newUserBtn = $("#btn-open-new-user");
    if (newItemBtn) { newItemBtn.classList.toggle("d-none", !isAdmin()); newItemBtn.addEventListener("click", openNewItem); }
    if (newUserBtn) { newUserBtn.classList.toggle("d-none", !isAdmin()); newUserBtn.addEventListener("click", openNewUser); }

    renderDashboard();
    $("#btn-logout")?.addEventListener("click", logout);
  });

})();
