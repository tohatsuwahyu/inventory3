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
    const url = `${CONFIG.BASE_URL}?action=${encodeURIComponent(action)}&key=${apikey}`;
    const opt = { method, headers: { "Content-Type": "application/json" } };
    if (method !== "GET" && body) opt.body = JSON.stringify(body);
    try {
      if (!silent) setLoading(true);
      const r = await fetch(url, opt);
      const t = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
      try { return JSON.parse(t); } catch { return t; }
    } catch (e) {
      if (!silent) toast(e?.message || String(e));
      throw e;
    } finally { if (!silent) setLoading(false); }
  }

  function isAdmin() { try { return (window.SESSION?.role || "").toLowerCase() === "admin"; } catch { return false; } }
  function escapeHtml(s) { return String(s || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
  function escapeAttr(s) { return String(s || "").replace(/"/g, "&quot;"); }

  /* QR helpers (sudah ada di proyek) */
  async function ensureQRCode() {
    if (window.QRCode) return;
    await new Promise((res, rej) => {
      const sc = document.createElement("script");
      sc.src = "qrlib.js"; sc.onload = res; sc.onerror = () => rej(new Error("QR lib load error"));
      document.head.appendChild(sc);
    });
  }
  async function generateQrDataUrl(text, size = 512) {
    await ensureQRCode();
    return await new Promise((resolve) => {
      const wrap = document.createElement("div");
      new QRCode(wrap, { text, width: size, height: size, correctLevel: QRCode.CorrectLevel.M });
      setTimeout(() => {
        const img = wrap.querySelector("img,canvas");
        if (img && img.toDataURL) resolve(img.toDataURL("image/png"));
        else if (img && img.src) resolve(img.src);
        else resolve("");
      }, 50);
    });
  }

  /* -------------------- Auth -------------------- */
  async function saveSession(sess) {
    try { localStorage.setItem("inv.session", JSON.stringify(sess || {})); } catch { }
    window.SESSION = sess || {};
    $("#user-name") && ($("#user-name").textContent = sess?.name || "");
    $("#user-role") && ($("#user-role").textContent = (sess?.role || "").toUpperCase());
    const adminOnlyEls = $$(".admin-only");
    adminOnlyEls.forEach(el => el.classList.toggle("d-none", !isAdmin()));
  }
  function loadSession() {
    try { return JSON.parse(localStorage.getItem("inv.session") || "{}"); } catch { return {}; }
  }
  function logout() { saveSession({}); location.href = "index.html"; }

  /* -------------------- Items cache -------------------- */
  let _ITEMS_CACHE = [];
  async function refreshItemsCache() {
    try {
      const res = await api("items", { method: "GET" });
      _ITEMS_CACHE = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    } catch (e) { console.warn(e); }
  }

  /* -------------------- UI Bindings (Dashboard) -------------------- */
  function bindNav() {
    $$(".app-nav .nav-link").forEach(a => {
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        const target = a.getAttribute("href") || a.dataset.target || "";
        if (!target.startsWith("#")) return;
        $$(".app-view").forEach(v => v.classList.add("d-none"));
        $(target)?.classList.remove("d-none");
        $$(".app-nav .nav-link").forEach(x => x.classList.remove("active"));
        a.classList.add("active");
      });
    });
  }

  /* -------------------- Camera Scan (shared) -------------------- */
  async function startBackCameraScan(elId, onText) {
    await ensureQRCode(); // reuse loader; scanner sudah dimuat di halaman
    const area = document.getElementById(elId);
    if (!area) throw new Error("scan area not found");

    if (window.BarcodeDetector) {
      const detector = new BarcodeDetector({ formats: ["qr_code", "code_128", "ean_13", "ean_8"] });
      const v = document.createElement("video"); v.playsInline = true; v.autoplay = true; v.muted = true;
      area.innerHTML = ""; area.appendChild(v);
      const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      v.srcObject = st;

      let alive = true;
      const loop = async () => {
        if (!alive) return;
        try {
          const img = await createImageBitmap(v);
          const codes = await detector.detect(img);
          if (codes?.length) {
            const raw = codes[0].rawValue || "";
            if (raw) { await onText(raw); }
          }
        } catch { }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);

      return {
        stop: async () => { alive = false; st.getTracks().forEach(t => t.stop()); },
        clear: () => { area.textContent = "カメラ待機中…"; }
      };
    } else if (window.Html5Qrcode) {
      const html5Qrcode = new Html5Qrcode(elId);
      const startWith = (cfg) => html5Qrcode.start(cfg, { fps: 10, qrbox: 250, aspectRatio: 1.0 },
        (txt) => onText(txt), (err) => { });
      const cams = await Html5Qrcode.getCameras();
      if (!cams?.length) throw new Error("カメラが見つかりません。権限をご確認ください。");
      const back = cams.find(c => /back|rear|environment/i.test(c.label)) || cams.at(-1);
      return await startWith({ deviceId: { exact: back.id } });
    }
  }

  /* -------------------- 入出庫 (IO) -------------------- */
  let IO_SCANNER = null;

  function findItemIntoIO(code) {
    try {
      const it = _ITEMS_CACHE.find(x => String(x.code) === String(code));
      if (it) {
        $("#io-name").value = it.name || "";
        $("#io-price").value = it.price || 0;
        $("#io-stock").value = it.stock || 0;
      }
    } catch { }
  }

  (function bindIO() {
    const btnStart = $("#btn-io-scan"), btnStop = $("#btn-io-stop"), area = $("#io-scan-area");
    if (!btnStart || !btnStop || !area) return;

    btnStart.addEventListener("click", async () => {
      try {
        area.textContent = "カメラ起動中…";
        IO_SCANNER = await startBackCameraScan("io-scan-area", (text) => {
          const code = (String(text || "").split("|")[1] || "").trim();
          if (code) { $("#io-code").value = code; findItemIntoIO(code); }
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
      try {
        const code = ($("#io-code").value || "").trim();
        const qty = Number($("#io-qty").value || 0);
        const mode = ($("#io-mode").value || "in").toLowerCase();
        if (!code || !qty) return toast("コード/数量を確認してください");
        const r = await api("io", { method: "POST", body: { code, qty, mode } });
        if (r?.ok) { toast("登録しました"); $("#io-qty").value = ""; await refreshItemsCache(); findItemIntoIO(code); }
        else toast(r?.error || "失敗");
      } catch (e2) { toast(e2?.message || String(e2)); }
    });
  })();

  /* -------------------- Stocktake (棚卸) -------------------- */
  let SHELF_SCANNER = null;
  const ST = { rows: new Map() }; // code => {code,name,department,book,qty,diff}
  window.ST = ST;

  // === PARSER BARCODE DITINGKATKAN: dukung LOT|CODE|SIZE & ITEM|CODE & JSON
  function parseScanText(txt) {
    const raw = String(txt || "").trim();

    // LOT|<CODE>|<SIZE>
    if (/^LOT\|/i.test(raw)) {
      const parts = raw.split("|");
      const code = (parts[1] || "").trim();
      const size = Number(parts[2] || 0) || 0;
      if (code && size > 0) return { kind: "lot", code, size };
      if (code) return { kind: "lot", code, size: 1 };
    }

    // ITEM|<CODE>
    if (/^ITEM\|/i.test(raw)) {
      const code = (raw.split("|")[1] || "").trim();
      if (code) return { kind: "item", code };
    }

    // JSON { t:'lot'|'item', code, size? }
    try {
      const o = JSON.parse(raw);
      if ((o.t === "lot" || o.type === "lot") && o.code) {
        return { kind: "lot", code: String(o.code), size: Number(o.size || 1) || 1 };
      }
      if ((o.t === "item" || o.type === "item") && o.code) {
        return { kind: "item", code: String(o.code) };
      }
    } catch { }

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

  // Tambahan: penambahan kuantitas incremental untuk LOT-scan dengan konfirmasi
  async function addStocktakeIncrement(code, addQty) {
    if (!code || !addQty) return;
    // Ambil atau fetch item
    let item = _ITEMS_CACHE.find(x => String(x.code) === String(code));
    if (!item) {
      try { const r = await api("itemByCode", { method: "POST", body: { code } }); if (r?.ok) item = r.item; } catch {}
    }
    if (!item) return toast("アイテムが見つかりません: " + code);

    // Existing record if any
    let rec = ST.rows.get(code);
    if (!rec) {
      const book = Number(item.stock || 0);
      const qty  = 0;
      rec = { code, name: item.name, department: (item.department || ""), book, qty, diff: qty - book };
    }

    // Konfirmasi (日本語)
    const confirmMsg = `箱バーコードを追加しますか？\n\nコード: ${code}\n加算数量: +${addQty} 個`;
    if (!window.confirm(confirmMsg)) return;

    rec.qty  = Number(rec.qty || 0) + Number(addQty || 0);
    rec.diff = rec.qty - Number(rec.book || 0);

    ST.rows.set(code, rec);
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
        <td class="text-end">
          <input type="number" class="form-control form-control-sm text-end st-qty" value="${r.qty}" />
        </td>
        <td class="text-end ${r.diff !== 0 ? "fw-bold" : ""}">${fmt(r.diff)}</td>
        <td class="text-end">
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-secondary btn-st-adjust ${isadmin ? "" : "d-none"}">Adjust</button>
            <button class="btn btn-outline-secondary btn-st-edit ${isadmin ? "" : "d-none"}">Edit</button>
          </div>
        </td>
      </tr>
    `).join("");

    const summary = $("#st-summary");
    const total = arr.reduce((a, b) => a + Number(b.diff || 0), 0);
    if (summary) summary.textContent = `差異合計: ${fmt(total)}`;

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

  async function openAdjustModal(rec) {
    // ... (isi modal adjust yang sudah ada di proyek Anda)
    // (Kode lengkap asli tetap dipertahankan di file Anda)
  }

  async function openEditItem(code) {
    // ... (modal edit item existing)
  }

  async function renderShelfRecap() {
    try {
      const raw = await api("history", { method: "GET" });
      // ... (existing)
    } catch (e) { console.warn(e); }
  }

  (function bindShelf() {
    const btnStart = $("#btn-start-scan"), btnStop = $("#btn-stop-scan"), area = $("#scan-area");
    if (!btnStart || !btnStop || !area) return;

    btnStart.addEventListener("click", async () => {
      try {
        area.textContent = "カメラ起動中…";
        SHELF_SCANNER = await startBackCameraScan("scan-area", async (text) => {
          const parsed = parseScanText(String(text || ""));
          if (!parsed) return;

          if (parsed.kind === "lot") {
            await addStocktakeIncrement(parsed.code, parsed.size || 1);
          } else if (parsed.kind === "item") {
            const code = parsed.code;
            const currentQty = ST.rows.get(code)?.qty ?? undefined;
            const it = _ITEMS_CACHE.find(x => String(x.code) === String(code));
            const name = it?.name ? `（${it.name}）` : "";
            if (!window.confirm(`このアイテムを追加しますか？\n\nコード: ${code}${name}`)) return;
            await addOrUpdateStocktake(code, currentQty);
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

    $("#st-add")?.addEventListener("click", async () => {
      const code = ($("#st-code").value || "").trim();
      const qty = Number($("#st-qty").value || 0);
      if (!code) return toast("コードを入力してください");
      if (Number.isFinite(qty) && qty >= 0) {
        const it = _ITEMS_CACHE.find(x => String(x.code) === String(code));
        const name = it?.name ? `（${it.name}）` : "";
        if (!window.confirm(`このアイテムを追加しますか？\n\nコード: ${code}${name}\n実在: ${qty} 個`)) return;
        await addOrUpdateStocktake(code, qty);
        $("#st-code").value = ""; $("#st-qty").value = "";
      }
    });

    $("#st-clear")?.addEventListener("click", () => {
      if (confirm("棚卸表をクリアしますか？")) { ST.rows.clear(); renderShelfTable(); }
    });

    $("#st-finalize")?.addEventListener("click", async () => {
      const arr = [...ST.rows.values()];
      if (!arr.length) return toast("データがありません");
      if (!confirm("確定して在庫を更新しますか？")) return;
      try {
        const r = await api("stocktakeFinalize", { method: "POST", body: { rows: arr } });
        if (r?.ok) { toast("在庫を更新しました"); await refreshItemsCache(); ST.rows.clear(); renderShelfTable(); }
        else toast(r?.error || "失敗");
      } catch (e) { toast(e?.message || String(e)); }
    });

    $("#st-export")?.addEventListener("click", async () => {
      try {
        const arr = [...ST.rows.values()];
        const csv = ["code,name,department,book,qty,diff"].concat(arr.map(r => [r.code, r.name, r.department || "", r.book, r.qty, r.diff].join(","))).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "stocktake.csv"; a.click(); URL.revokeObjectURL(url);
      } catch { toast("エクスポート失敗"); }
    });

    $("#st-import")?.addEventListener("click", () => $("#input-st-import")?.click());
    $("#input-st-import")?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      const t = await f.text();
      const lines = t.trim().split(/\r?\n/).slice(1);
      lines.forEach((row) => {
        const [code,, , , qty] = row.split(",");
        if (code) ST.rows.set(code, { code, name: (_ITEMS_CACHE.find(x => String(x.code) === String(code))?.name || ""), department:"", book:0, qty:Number(qty||0), diff:Number(qty||0) });
      });
      renderShelfTable();
      e.target.value = "";
    });

    $("#st-save")?.addEventListener("click", () => {
      try {
        const arr = [...ST.rows.values()];
        localStorage.setItem("inv.st.draft", JSON.stringify(arr));
        toast("下書き保存しました");
      } catch { }
    });

    $("#st-load")?.addEventListener("click", () => {
      try {
        const arr = JSON.parse(localStorage.getItem("inv.st.draft") || "[]");
        ST.rows.clear();
        (arr||[]).forEach(r => ST.rows.set(r.code, r));
        renderShelfTable();
        toast("読込完了");
      } catch { }
    });
  })();

  /* -------- Lot QR Generator (箱バーコード) -------- */
  (function bindLotGenerator(){
    const btn = document.getElementById('st-open-lotgen');
    if (!btn) return;

    btn.addEventListener('click', async ()=>{
      try{
        // Pastikan daftar items tersedia utk datalist
        if (!_ITEMS_CACHE.length) {
          try {
            const list = await api("items", { method: "GET" });
            _ITEMS_CACHE = Array.isArray(list) ? list : (Array.isArray(list?.data) ? list.data : []);
          } catch {}
        }
        const dl = document.getElementById('lotgen-codes');
        if (dl) {
          dl.innerHTML = _ITEMS_CACHE.map(i=>`<option value="${i.code}">${(i.name||'').replace(/</g,'&lt;')}</option>`).join('');
        }

        const modalEl = document.getElementById('lotgenModal');
        if (!modalEl) return;
        const modal = new bootstrap.Modal(modalEl);
        modal.show();

        const inputCode = document.getElementById('lotgen-code');
        const inputSize = document.getElementById('lotgen-size');
        const preview   = document.getElementById('lotgen-preview');
        const btnDL     = document.getElementById('lotgen-dl');

        async function renderQR(){
          const code = (inputCode?.value||'').trim();
          const size = Number(inputSize?.value||0) || 0;
          if (preview) preview.innerHTML = '';
          if (!code || size<=0) return;
          await ensureQRCode();
          new QRCode(preview, { text: `LOT|${code}|${size}`, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
        }

        inputCode?.addEventListener('input', renderQR);
        inputSize?.addEventListener('input', renderQR);
        await renderQR();

        btnDL?.addEventListener('click', async ()=>{
          const code = (inputCode?.value||'').trim();
          const size = Number(inputSize?.value||0) || 0;
          if (!code || size<=0) return;
          const url = await generateQrDataUrl(`LOT|${code}|${size}`, 600);
          const a = document.createElement('a'); a.href = url; a.download = `LOT_${code}_x${size}.png`; a.click();
        }, { once:true });

        modalEl.addEventListener('hidden.bs.modal', ()=>{
          if (preview) preview.innerHTML = '';
        }, { once:true });

      }catch(e){
        toast(e?.message || String(e));
      }
    });
  })();

  /* -------------------- Boot -------------------- */
  window.addEventListener("DOMContentLoaded", () => {
    const logo = document.getElementById("brand-logo");
    if (logo && window.CONFIG && CONFIG.LOGO_URL) { logo.src = CONFIG.LOGO_URL; logo.alt = "logo"; logo.onerror = () => { logo.style.display = "none"; }; }

    const sess = loadSession(); saveSession(sess);
    bindNav();
    refreshItemsCache();

    const newItemBtn = $("#btn-open-new-item");
    const newUserBtn = $("#btn-open-new-user");
    if (newItemBtn) { newItemBtn.classList.toggle("d-none", !isAdmin()); newItemBtn.addEventListener("click", openNewItem); }
    if (newUserBtn) { newUserBtn.classList.toggle("d-none", !isAdmin()); newUserBtn.addEventListener("click", openNewUser); }

    renderDashboard?.();
    $("#btn-logout")?.addEventListener("click", logout);
  });

})();
