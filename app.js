/* =========================================================
 * app.js — Inventory (GAS backend) + BOX BARCODE feature
 * =======================================================*/
(function () {
  "use strict";

  /* -------------------- Helpers -------------------- */
  const $  = (sel, el=document)=> el.querySelector(sel);
  const $$ = (sel, el=document)=> [...el.querySelectorAll(sel)];
  const fmt = (n)=> new Intl.NumberFormat('ja-JP').format(Number(n||0));
  const isMobile = ()=> /Android|iPhone|iPad/i.test(navigator.userAgent);
  function toast(msg){ alert(msg); }
  function setLoading(show, text){
    const el = $('#global-loading'); if(!el) return;
    if(show){ el.classList.remove('d-none'); $('#loading-text').textContent = text||'読み込み中…'; }
    else el.classList.add('d-none');
  }
  function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }
  function escapeAttr(s){ return escapeHtml(s).replace(/"/g, "&quot;"); }

  // qrlib.js harus menyediakan QRCode
  async function generateQrDataUrl(text, size=256){
    if(!window.QRCode) throw new Error('qrlib.js (QRCode) belum dimuat');
    return await new Promise((resolve)=>{
      const tmp = document.createElement('div');
      const qr = new QRCode(tmp, { text, width:size, height:size, correctLevel: QRCode.CorrectLevel.M });
      setTimeout(()=>{
        const img = tmp.querySelector('img') || tmp.querySelector('canvas');
        if(!img){ resolve(""); return; }
        resolve(img.toDataURL ? img.toDataURL() : (img.src || ""));
      }, 10);
    });
  }

  /* -------------------- API -------------------- */
  async function api(action, { method='GET', body=null, silent=false } = {}) {
    if (!window.CONFIG || !CONFIG.BASE_URL) { throw new Error('config.js BASE_URL belum di-set'); }
    const apikey = encodeURIComponent(CONFIG.API_KEY || "");
    const url = `${CONFIG.BASE_URL}?action=${encodeURIComponent(action)}&key=${apikey}`;
    const opt = { method, headers: { 'Content-Type': 'application/json' }, mode: 'cors' };
    if (body) opt.body = JSON.stringify(body);

    try {
      if (!silent) setLoading(true, '読み込み中…');
      const res = await fetch(url, opt);
      const json = await res.json();
      if (!res.ok || json?.error) { throw new Error(json?.error || res.statusText); }
      return json;
    } finally {
      if (!silent) setLoading(false);
    }
  }

  /* -------------------- Auth stub -------------------- */
  function getCurrentUser(){
    try { return JSON.parse(localStorage.getItem('AUTH_USER')||"") || null; }
    catch { return null; }
  }

  /* -------------------- State -------------------- */
  let _ITEMS_CACHE = [];
  const ST = { rows: new Map() }; // code -> { book, qty }

  /* =====================================================
   * 商品一覧 — RENDER (tambah tombol "箱バーコード")
   * ===================================================*/
  function tplItemRow(it){
    const qrid = `qr-${it.code}`;
    return `<tr data-code="${escapeAttr(it.code)}">
      <td style="width:110px">
        <div class="tbl-qr-box"><div id="${qrid}" class="d-inline-block"></div></div>
      </td>
      <td>${escapeHtml(it.code)}</td>
      <td><a href="#" class="link-underline link-item" data-code="${escapeAttr(it.code)}">${escapeHtml(it.name)}</a></td>
      <td>${it.img ? `<img src="${escapeAttr(it.img)}" alt="" style="height:32px">` : ""}</td>
      <td class="text-end">¥${fmt(it.price)}</td>
      <td class="text-end">${fmt(it.stock)}</td>
      <td class="text-end">${fmt(it.min)}</td>
      <td>${escapeHtml(it.department||"")}</td>
      <td>${escapeHtml(it.location||"")}</td>
      <td>
        <div class="act-grid">
          <button class="btn btn-sm btn-primary btn-edit" data-code="${escapeAttr(it.code)}" title="編集"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-danger btn-del" data-code="${escapeAttr(it.code)}" title="削除"><i class="bi bi-trash"></i></button>
          <button class="btn btn-sm btn-outline-success btn-dl" data-code="${escapeAttr(it.code)}" title="ダウンロード"><i class="bi bi-download"></i></button>
          <button class="btn btn-sm btn-outline-secondary btn-preview" data-code="${escapeAttr(it.code)}" title="プレビュー"><i class="bi bi-search"></i></button>
          <button class="btn btn-sm btn-outline-primary btn-boxcode" data-code="${escapeAttr(it.code)}" title="箱バーコード"><i class="bi bi-qr-code"></i></button>
        </div>
      </td>
    </tr>`;
  }

  async function renderItems(list){
    const tbody = $('#tbl-items tbody'); if(!tbody) return;
    tbody.innerHTML = list.map(tplItemRow).join("");

    // render QR item (satuan)
    for(const it of list){
      const el = document.getElementById(`qr-${it.code}`);
      if(el){
        const url = await generateQrDataUrl(`ITEM|${it.code}`, 96);
        el.innerHTML = `<img src="${url}" alt="qr" width="96" height="96">`;
      }
    }

    // click delegation
    tbody.onclick = async (ev)=>{
      const btn = ev.target.closest('button'); if(!btn) return;
      const code = btn.dataset.code;
      if     (btn.classList.contains('btn-edit'))     openEdit(code);
      else if(btn.classList.contains('btn-del'))      delItem(code);
      else if(btn.classList.contains('btn-dl'))       downloadItem(code);
      else if(btn.classList.contains('btn-preview'))  openPreview(code);
      else if(btn.classList.contains('btn-boxcode')) {
        const it = _ITEMS_CACHE.find(x=> String(x.code)===String(code));
        if(!it) return; openBoxBarcodeModal(it);
      }
    };
  }

  // Placeholder sesuai proyek Anda (agar tidak error)
  function openEdit(code){ console.log('openEdit', code); }
  function delItem(code){ console.log('delItem', code); }
  function downloadItem(code){ console.log('downloadItem', code); }
  function openPreview(code){ console.log('openPreview', code); }

  /* =====================================================
   * 箱バーコード — modal & generator
   * ===================================================*/
  async function makeBoxBarcodeDataURL(code, pcsPerBox, size=300){
    const text = `BOX|${code}|${pcsPerBox}`;
    return await generateQrDataUrl(text, size);
  }

  function openBoxBarcodeModal(item){
    const wrap = document.createElement("div");
    wrap.className = "modal fade";
    wrap.innerHTML = `
<div class="modal-dialog">
  <div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">箱バーコード（${escapeHtml(item.code)}）</h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label">1箱あたりの数量（pcs）</label>
          <input id="bx-lot" type="number" class="form-control" value="10" min="1">
        </div>
        <div class="col-md-6">
          <label class="form-label">枚数（ステッカー数）</label>
          <input id="bx-cnt" type="number" class="form-control" value="1" min="1" max="100">
        </div>
        <div class="col-12"><div id="bx-preview" class="d-flex flex-wrap gap-2"></div></div>
        <div class="small text-muted">※ エンコード形式：<code>BOX|${escapeHtml(item.code)}|&lt;pcs&gt;</code>（QR）</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline-secondary" id="bx-make">プレビュー</button>
      <button class="btn btn-primary" id="bx-dl">ダウンロード</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap); modal.show();

    async function buildPreview(){
      const pcs = Math.max(1, Number($("#bx-lot", wrap).value || 0));
      const cnt = Math.max(1, Math.min(100, Number($("#bx-cnt", wrap).value || 1)));
      const holder = $("#bx-preview", wrap); holder.innerHTML = "";
      for (let i=0;i<cnt;i++){
        const url = await makeBoxBarcodeDataURL(item.code, pcs, 220);
        const a = document.createElement("a");
        a.href = url; a.target="_blank"; a.className="border rounded p-2 d-inline-block";
        a.title = `BOX|${item.code}|${pcs}`;
        a.innerHTML = `<img src="${url}" alt="" style="width:160px;height:160px;display:block">`+
                      `<div class="small text-center mt-1">${escapeHtml(item.name||"")}</div>`+
                      `<div class="small text-center text-muted">BOX ${pcs} pcs</div>`;
        holder.appendChild(a);
      }
    }

    $("#bx-make", wrap)?.addEventListener("click", (e)=>{ e.preventDefault(); buildPreview(); });
    $("#bx-dl",   wrap)?.addEventListener("click", async (e)=>{
      e.preventDefault();
      const pcs = Math.max(1, Number($("#bx-lot", wrap).value || 0));
      const cnt = Math.max(1, Math.min(100, Number($("#bx-cnt", wrap).value || 1)));
      for (let i=0;i<cnt;i++){
        const url = await makeBoxBarcodeDataURL(item.code, pcs, 600);
        const a = document.createElement("a"); a.href = url; a.download = `BOX_${item.code}_${pcs}pcs_${i+1}.png`; a.click();
      }
    });

    wrap.addEventListener("shown.bs.modal", buildPreview, { once:true });
    wrap.addEventListener("hidden.bs.modal", ()=>wrap.remove(), { once:true });
  }

  /* =====================================================
   * スキャン処理 — parser & LOT adder
   * ===================================================*/
  function parseScanText(txt) {
    const s = String(txt||"").trim();
    if (/^ITEM\|/i.test(s)) return { kind:"item", code:(s.split("|")[1]||"").trim() };
    if (/^BOX\|/i.test(s))  return { kind:"box",  code:(s.split("|")[1]||"").trim(), lot:Number(s.split("|")[2]||0) || 0 };
    try {
      const o = JSON.parse(s);
      if ((o.t === "item" || o.type === "item") && o.code) return { kind:"item", code:String(o.code) };
      if ((o.t === "box"  || o.type === "box")  && o.code) return { kind:"box",  code:String(o.code), lot:Number(o.lot||o.size||o.qty||0) || 0 };
    } catch {}
    return { kind:"", code:"" };
  }

  async function addLotScan(code, lot){
    if (!code || !lot || lot<=0) return;
    if (!confirm("この商品を追加してもよろしいですか？")) return;

    const curr = ST.rows.get(code);
    const base = (curr && (typeof curr.qty==='number' ? curr.qty : curr.book)) || 0;
    const newQty = Number(base) + Number(lot);

    await addOrUpdateStocktake(code, newQty);

    try{
      const who = getCurrentUser();
      await api("log", { method:"POST", body:{
        userId: who?.id || who?.name || "unknown",
        code, qty: Number(lot), unit: "pcs", type: "LOT",
        note: `BOX SCAN size=${lot}`
      }});
    }catch(e){ console.warn("log LOT gagal:", e); }
  }

  /* -------------------- Stocktake helpers (stub aman) -------------------- */
  async function addOrUpdateStocktake(code, qty){
    const cur = ST.rows.get(code) || { book:0, qty:0 };
    const next = { book: cur.book||0, qty: (typeof qty==='number' ? qty : cur.qty||0) };
    ST.rows.set(code, next);
    console.log('Stocktake set', code, next);
    // TODO: panggil re-render tabel 棚卸 milik Anda kalau ada.
  }

  /* =====================================================
   * Pemindai kamera (BarcodeDetector)
   * ===================================================*/
  async function startBackCameraScan(areaId, onRead) {
    const area = document.getElementById(areaId);
    if (!area) throw new Error('scan area not found');

    area.innerHTML = '';
    const video = document.createElement('video');
    video.playsInline = true;
    video.autoplay = true;
    video.muted = true;
    video.style.width = '100%';
    video.style.borderRadius = '12px';
    area.appendChild(video);

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    video.srcObject = stream;

    let detector = null;
    if ('BarcodeDetector' in window) {
      const formats = ['qr_code', 'code_128', 'ean_13', 'ean_8', 'code_39', 'upc_a', 'upc_e'];
      detector = new window.BarcodeDetector({ formats });
    } else {
      console.warn('BarcodeDetector tidak tersedia; gunakan Chrome/Edge/Android terbaru.');
    }

    let last = 0, lock = false, rafId = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    async function loop() {
      rafId = requestAnimationFrame(loop);
      if (!detector || lock) return;
      if (video.readyState < 2) return;

      const now = Date.now();
      if (now - last < 250) return;
      last = now;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      try {
        const bitmap = await createImageBitmap(canvas);
        const codes = await detector.detect(bitmap);
        if (codes && codes.length) {
          lock = true;
          const raw = (codes[0].rawValue || '').trim();
          await onRead(raw);
          setTimeout(()=>{ lock = false; }, 800);
        }
      } catch (e) {}
    }
    rafId = requestAnimationFrame(loop);

    return {
      stop() {
        cancelAnimationFrame(rafId);
        stream.getTracks().forEach(t => t.stop());
        area.innerHTML = '';
      }
    };
  }

  /* =====================================================
   * Bind untuk menu 棚卸 (jika ada #scan-area di halaman)
   * ===================================================*/
  async function bindShelfScan(){
    try{
      const scanner = await startBackCameraScan("scan-area", async (text)=>{
        const p = parseScanText(String(text||""));
        if(!p || !p.kind) return;
        if(p.kind === "item"){
          await addOrUpdateStocktake(p.code, ST.rows.get(p.code)?.qty ?? undefined);
        }else if(p.kind === "box"){
          await addLotScan(p.code, p.lot||0);
        }
      });
      window.SHELF_SCANNER = scanner;
    }catch(e){
      console.error('bindShelfScan failed', e);
    }
  }

  /* =====================================================
   * Boot
   * ===================================================*/
  async function boot(){
    // Load items
    try{
      const data = await api('items', { method:'GET' });
      _ITEMS_CACHE = Array.isArray(data?.items) ? data.items : [];
    }catch(e){
      console.warn('Gagal load items, gunakan cache kosong:', e);
      _ITEMS_CACHE = [];
    }
    // Render daftar items (untuk halaman 商品一覧)
    renderItems(_ITEMS_CACHE);

    // Aktifkan scanner jika halaman memiliki #scan-area (menu 棚卸)
    if(document.getElementById('scan-area')){ bindShelfScan(); }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  }else{
    boot();
  }
})();
