/*************************************************
 * app.js — Inventory Dashboard (Local-scan + Label DL + UI tidy)
 **************************************************/

// === Auth guard
const saved = localStorage.getItem('currentUser');
if (!saved) location.href = 'index.html';

const state = {
  currentUser: JSON.parse(saved),
  items: [], users: [], history: [], monthly: [],
  scanner: null, ioScanner: null, stocktakeRows: [],
  filteredItems: []
};

// === helpers
const qs  = (s, el=document)=>el.querySelector(s);
const qsa = (s, el=document)=>[...el.querySelectorAll(s)];
const fmt = (n)=>new Intl.NumberFormat('ja-JP').format(n ?? 0);
const isMobile = ()=> window.innerWidth < 992;
const today = ()=> new Date();
const safeFile = (s)=> String(s||'').replace(/[\s\\/:*?"<>|]+/g,'_');

// === Global loading
let loadingCount = 0;
function loading(on, text='読み込み中…'){
  const host = qs('#global-loading'); if(!host) return;
  const label = qs('#loading-text'); if(label && text) label.textContent = text;
  if(on){ loadingCount++; host.classList.remove('d-none'); }
  else { loadingCount = Math.max(0, loadingCount-1); if(loadingCount===0) host.classList.add('d-none'); }
}

// === Brand
(function setBrand(){ try{
  const url = (window.CONFIG && CONFIG.LOGO_URL) || './assets/tsh.png';
  const img = qs('#brand-logo'); if(img) img.src = url;
}catch(_){}})();

function setTitle(t){ const el=qs('#page-title'); if(el) el.textContent=t; }
function showView(id, title){
  qsa('main section').forEach(sec=>{
    const on = (sec.id===id);
    sec.classList.toggle('d-none', !on);
    requestAnimationFrame(()=>sec.classList.toggle('active', on));
  });
  qsa('aside nav a').forEach(a=>a.classList.toggle('active', a.getAttribute('data-view')===id));
  if (title) setTitle(title);
  if (isMobile()) openMenu(false);
}
function updateWho(){ const u=state.currentUser; const el=qs('#who'); if(el) el.textContent=`${u.name}（${u.id}｜${u.role||'user'}）`; }

// === mobile drawer
function openMenu(open){
  const sb = qs('#sb') || qs('.sidebar');
  const bd = qs('#sb-backdrop') || qs('#backdrop');
  if(open){ sb?.classList.add('show','open'); bd?.classList.add('show'); document.body.classList.add('overflow-hidden'); }
  else{ sb?.classList.remove('show','open'); bd?.classList.remove('show'); document.body.classList.remove('overflow-hidden'); }
}
['#burger','#btn-menu'].forEach(id=>{ qs(id)?.addEventListener('click', (e)=>{ e.preventDefault(); openMenu(true); }); });
(qs('#sb-backdrop')||qs('#backdrop'))?.addEventListener('click', ()=>openMenu(false));
window.addEventListener('keydown', e=>{ if(e.key==='Escape') openMenu(false); });

// === html5-qrcode loader (prioritas lokal)
let html5qrcodeReady = false;
function loadScriptOnce(src){
  return new Promise((res, rej)=>{
    const tag = document.createElement('script');
    tag.src = src; tag.async = true; tag.onload = ()=>res(); tag.onerror=()=>rej(new Error('load failed: '+src));
    document.head.appendChild(tag);
  });
}
async function ensureHtml5Qrcode(){
  if (html5qrcodeReady && window.Html5Qrcode) return;
  if (window.Html5Qrcode){ html5qrcodeReady = true; return; }

  // urutan: lokal -> jsDelivr -> unpkg
  try{
    loading(true,'カメラ機能を読み込み中…');
    // kalau <script src="vendor/html5-qrcode.min.js"> sudah ada, window.Html5Qrcode akan terdefinisi
    if (!window.Html5Qrcode){
      try { await loadScriptOnce('./vendor/html5-qrcode.min.js'); } catch(_){}
    }
    if (!window.Html5Qrcode){
      try { await loadScriptOnce('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.10/minified/html5-qrcode.min.js'); } catch(_){}
    }
    if (!window.Html5Qrcode){
      try { await loadScriptOnce('https://unpkg.com/html5-qrcode@2.3.10/minified/html5-qrcode.min.js'); } catch(_){}
    }
  } finally { loading(false); }

  if(window.Html5Qrcode) html5qrcodeReady = true;
}

// === API
async function api(action, {method='GET', body, showLoading=true, loadingText='通信中…'}={}){
  if(!window.CONFIG || !CONFIG.BASE_URL) throw new Error('config.js belum diisi (BASE_URL kosong)');
  const apikey = encodeURIComponent(CONFIG.API_KEY||'');
  const url = `${CONFIG.BASE_URL}?action=${encodeURIComponent(action)}&apikey=${apikey}&_=${Date.now()}`;

  try{
    if(showLoading) loading(true, loadingText);
    if(method==='GET'){
      const r = await fetch(url, { mode:'cors', cache:'no-cache' });
      if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
      return await r.json();
    } else {
      const r = await fetch(url, {
        method:'POST',
        mode:'cors',
        headers:{ 'Content-Type':'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...(body||{}), apikey: CONFIG.API_KEY })
      });
      if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
      return await r.json();
    }
  } finally {
    if(showLoading) loading(false);
  }
}
function normArr(resp, key){
  if (Array.isArray(resp)) return resp;
  if (resp && Array.isArray(resp[key])) return resp[key];
  if (resp && resp.data && Array.isArray(resp.data)) return resp.data;
  return [];
}

// === LOAD ALL
async function loadAll(){
  loading(true, 'データ読込中…');
  try{
    const [items, users, history, monthly] = await Promise.all([
      api('items',  {showLoading:false}),
      api('users',  {showLoading:false}),
      api('history',{showLoading:false}),
      api('statsMonthlySeries',{showLoading:false}),
    ]);
    state.items   = normArr(items,   'items');
    state.users   = normArr(users,   'users');
    state.history = normArr(history, 'history');
    state.monthly = normArr(monthly, 'series');
    state.filteredItems = [...state.items];

    renderMetrics();
    renderMonthlyChart();
    renderPieThisMonth();
    renderMovementsThisMonth();
    renderItems(); renderUsers(); renderHistory();
  }catch(err){
    alert('Gagal ambil data dari backend.\nPeriksa config.js / deployment GAS.\nDetail: '+(err?.message||err));
    console.error(err);
  }finally{
    loading(false);
  }
}

// === Charts & metrics
function parseTs(s){ if(!s) return null; const p = s.replace(' ','T'); const d = new Date(p); return isNaN(+d) ? null : d; }
function renderMetrics(){
  qs('#metric-total-items').textContent = fmt(state.items.length);
  qs('#metric-low-stock').textContent  = fmt(state.items.filter(i=>Number(i.stock||0)<=Number(i.min||0)).length);
  qs('#metric-users').textContent      = fmt(state.users.length);
  const now = today();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
  const last30 = state.history.filter(h=>{ const d = parseTs(h.timestamp); return d && d >= cutoff; });
  qs('#metric-txn').textContent = fmt(last30.length);
}
let monthlyChart, pieChart;
function renderMonthlyChart(){
  const el = qs('#chart-monthly'); if(!el) return;
  monthlyChart?.destroy?.();
  monthlyChart = new Chart(el, { type:'bar',
    data:{ labels: state.monthly.map(m=>m.month), datasets:[ {label:'IN',data: state.monthly.map(m=>m.in||0)}, {label:'OUT',data: state.monthly.map(m=>m.out||0)} ] },
    options:{ responsive:true, scales:{ y:{ beginAtZero:true } }, plugins:{ legend:{ display:true } } }
  });
}
function renderPieThisMonth(){
  const el = qs('#chart-pie'); if(!el) return;
  pieChart?.destroy?.();
  const now = today(); const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  let IN=0, OUT=0;
  state.history.forEach(h=>{ const d = parseTs(h.timestamp); if(!d) return; const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; if(key!==ym) return;
    const qty = Number(h.qty||0); if(String(h.type)==='IN') IN += qty; else OUT += qty; });
  pieChart = new Chart(el, { type:'pie', data:{ labels:['IN','OUT'], datasets:[{ data:[IN, OUT] }] }, options:{ responsive:true, plugins:{ legend:{ position:'bottom' } } } });
}
function renderMovementsThisMonth(){
  const tb = qs('#tbl-mov'); if(!tb) return; tb.innerHTML = '';
  const now = today(); const ym   = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const byCode = new Map();
  state.history.forEach(h=>{
    const d = parseTs(h.timestamp); if(!d) return; const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; if(key!==ym) return;
    const code = String(h.code||''); const item = byCode.get(code) || { code, name:'', IN:0, OUT:0 };
    const it = state.items.find(x=>String(x.code)===code); item.name = it?.name || item.name;
    const qty = Number(h.qty||0); if(String(h.type)==='IN') item.IN += qty; else item.OUT += qty; byCode.set(code, item);
  });
  [...byCode.values()].sort((a,b)=> (b.IN + b.OUT) - (a.IN + a.OUT)).forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.code}</td><td>${r.name}</td><td class="text-end">${fmt(r.IN)}</td><td class="text-end">${fmt(r.OUT)}</td><td class="text-end">${fmt(r.IN - r.OUT)}</td>`;
    tb.appendChild(tr);
  });
  qs('#btn-export-mov')?.addEventListener('click', ()=>{
    loading(true, 'CSVを生成中…');
    try{
      const head='code,name,IN,OUT,NET\n';
      const lines = [...byCode.values()].map(r=>[r.code, r.name, r.IN, r.OUT, r.IN - r.OUT].join(',')).join('\n');
      const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='movements_this_month.csv'; a.click();
    } finally { loading(false); }
  }, { once:true });
}

/* === QR text === */
const itemQrText = (code)=>`ITEM|${String(code||'')}`;
const userQrText = (id)=>`USER|${String(id||'')}`;

/* === Items table + actions === */
function renderItems(){
  const tb = qs('#tbl-items'); if(!tb) return; tb.innerHTML = '';
  const list = state.filteredItems.length ? state.filteredItems : state.items;

  list.forEach(i=>{
    const codeStr = String(i.code||'');
    const idHolder = `qr-${codeStr.replace(/[^\w\-:.]/g,'_')}`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="qr-cell"><div class="qrbox"><div id="${idHolder}"></div><div class="caption">${i.name||''}（${codeStr}）</div></div></td>
      <td>${codeStr}</td>
      <td class="item-name clickable text-decoration-underline" data-code="${codeStr}" role="button">${i.name||''}</td>
      <td>${i.img ? `<img class="thumb" src="${i.img}" alt="">` : ''}</td>
      <td class="text-end">¥${fmt(i.price||0)}</td>
      <td class="text-end">${fmt(i.stock||0)}</td>
      <td class="text-end">${fmt(i.min||0)}</td>
      <td>${i.location||''}</td>
      <td class="text-end">
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-primary" data-act="edit" data-code="${codeStr}">✏️</button>
          <button class="btn btn-outline-danger"  data-act="del"  data-code="${codeStr}">🗑️</button>
          <button class="btn btn-outline-secondary" data-act="detail" data-code="${codeStr}">🔍</button>
          <!-- DL sekarang unduh LABEL -->
          <button class="btn btn-outline-success" data-act="dl"   data-code="${codeStr}">DL</button>
        </div>
      </td>`;
    tb.appendChild(tr);

    const holder = document.getElementById(idHolder);
    if (holder && typeof QRCode !== 'undefined') {
      holder.innerHTML = '';
      new QRCode(holder, { text: itemQrText(codeStr), width:84, height:84, correctLevel: QRCode.CorrectLevel.M });
    }
  });

  // DL = download label per item (PNG)
  tb.querySelectorAll('button[data-act="dl"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const code = btn.getAttribute('data-code');
      const item = state.items.find(x=>String(x.code)===String(code));
      if(!item) return;
      loading(true,'ラベルを生成中…');
      try{
        const dataUrl = await makeItemLabelDataURL(item);
        const a=document.createElement('a'); a.href=dataUrl; a.download=`LABEL_${safeFile(item.code)}.png`; a.click();
      } finally { loading(false); }
    });
  });

  // Edit/Delete/Detail
  tb.querySelectorAll('button[data-act="edit"]').forEach(btn=>{
    btn.addEventListener('click', ()=> openEditItem(btn.getAttribute('data-code')));
  });
  tb.querySelectorAll('button[data-act="del"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const code = btn.getAttribute('data-code');
      if(!confirm(`商品（${code}）を削除しますか？`)) return;
      try{
        await api('deleteItem',{ method:'POST', body:{ code }, loadingText:'削除中…' });
        await loadAll();
      }catch(e){ alert(e.message||e); }
    });
  });
  tb.querySelectorAll('button[data-act="detail"], td.item-name').forEach(el=>{
    el.addEventListener('click', ()=> openItemDetail(el.getAttribute('data-code')));
  });

  // Filter (once)
  qs('#items-search')?.addEventListener('input', (e)=>{
    const q = String(e.target.value||'').toLowerCase();
    state.filteredItems = state.items.filter(i=> String(i.name||'').toLowerCase().includes(q));
    renderItems();
  }, { once:true });
}

/* === Users === */
function renderUsers(){
  const btnAdd = qs('#btn-open-new-user');
  const btnPrint = qs('#btn-print-qr-users');
  const isAdmin = (state.currentUser.role === 'admin');
  if (isAdmin) btnAdd?.classList.remove('d-none'); else btnAdd?.classList.add('d-none');
  if (isAdmin) btnPrint?.classList.remove('d-none'); else btnPrint?.classList.add('d-none');

  const tb = qs('#tbl-userqr'); if(!tb) return;
  tb.innerHTML = '';
  const grid = qs('#print-qr-users-grid'); if (grid) grid.innerHTML = '';

  const list = isAdmin ? state.users : state.users.filter(u=> String(u.id) === String(state.currentUser.id));

  list.forEach(u=>{
    const idStr = String(u.id||'');
    const holderId = `uqr-${idStr.replace(/[^\w\-:.]/g,'_')}`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="qr-cell"><div class="qrbox"><div id="${holderId}"></div><div class="caption">${u.name||''}（${u.id||''}）</div></div></td>
      <td>${u.id||''}</td><td>${u.name||''}</td><td>${u.role||'user'}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-secondary" data-act="udl" data-id="${holderId}" data-uid="${idStr}" data-name="${safeFile(u.name||'')}"><i class="bi bi-download"></i></button></td>`;
    tb.appendChild(tr);

    const div = document.getElementById(holderId);
    if (div && typeof QRCode !== 'undefined') {
      new QRCode(div, { text: userQrText(idStr), width:84, height:84, correctLevel: QRCode.CorrectLevel.M });
    }
  });

  tb.querySelectorAll('button[data-act="udl"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const hid = btn.getAttribute('data-id');
      const holder = document.getElementById(hid);
      const canvas = holder?.querySelector('canvas');
      const img    = holder?.querySelector('img');
      const dataUrl = canvas?.toDataURL?.('image/png') || img?.src || '';
      if(!dataUrl) return;
      const code = btn.getAttribute('data-uid') || 'USER';
      const name = btn.getAttribute('data-name') || '';
      const a=document.createElement('a'); a.href=dataUrl; a.download=`USER_${safeFile(code)}_${safeFile(name)}.png`; a.click();
    });
  });
}

/* === History === */
function renderHistory(){
  const tb=qs('#tbl-history'); if(!tb) return; tb.innerHTML='';
  state.history.slice(-400).reverse().forEach(h=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${h.timestamp||''}</td>
      <td>${h.userId||''}</td>
      <td>${h.userName||''}</td>
      <td>${h.code||''}</td>
      <td>${h.itemName||''}</td>
      <td class="text-end">${fmt(h.qty||0)}</td>
      <td>${h.unit||''}</td>
      <td>${h.type||''}</td>
      <td>${h.note||''}</td>
      <td><button class="btn btn-sm btn-outline-primary" data-act="hedit" data-row="${h._row||''}">✏️</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll('button[data-act="hedit"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const row = btn.getAttribute('data-row');
      const item = state.history.find(x=>String(x._row)===String(row));
      if(!item) return;
      qs('#h-row').value = row;
      qs('#h-userId').value = item.userId||'';
      qs('#h-code').value = item.code||'';
      qs('#h-qty').value = item.qty||0;
      qs('#h-unit').value = item.unit||'pcs';
      qs('#h-type').value = item.type||'IN';
      qs('#h-note').value = item.note||'';
      new bootstrap.Modal('#dlg-edit-history').show();
    });
  });
}

/* ====== Scanner adaptor ====== */
async function startBackCameraScan(mountId, onScan, boxSize=300){
  await ensureHtml5Qrcode();
  // 1) html5-qrcode jika ada
  if (window.Html5Qrcode) {
    const cfg = { fps:10, qrbox:{ width:boxSize, height:boxSize } };
    const scanner = new Html5Qrcode(mountId);
    try{
      loading(true, 'カメラを起動中…');
      await scanner.start({ facingMode:'environment' }, cfg, onScan);
      return scanner;
    }catch(err1){
      try{
        const cams = await Html5Qrcode.getCameras();
        if(!cams || !cams.length) throw err1;
        const back = cams.find(c=>/back|rear|environment/i.test(c.label)) || cams.at(-1);
        await scanner.start({ deviceId:{ exact: back.id } }, cfg, onScan);
        return scanner;
      }catch(err2){
        await scanner?.stop?.(); scanner?.clear?.();
        console.warn('html5-qrcode gagal, fallback BarcodeDetector', err2);
        return startNativeDetector(mountId, onScan, boxSize);
      }finally{ loading(false); }
    }
  }
  // 2) Native fallback
  return startNativeDetector(mountId, onScan, boxSize);
}
async function startNativeDetector(mountId, onScan, boxSize=300){
  if (!('BarcodeDetector' in window)) {
    throw new Error('スキャナライブラリが読み込めません（ネットワーク規制の可能性）。Chromeの更新またはローカルライブラリを有効化してください。');
  }
  const mount = document.getElementById(mountId);
  mount.innerHTML = '';
  const video = document.createElement('video');
  video.setAttribute('playsinline','');
  video.style.width = '100%';
  video.style.maxWidth = boxSize+'px';
  mount.appendChild(video);

  const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' }, audio:false });
  video.srcObject = stream; await video.play();

  const detector = new BarcodeDetector({ formats: ['qr_code','code_128','code_39','ean_13','ean_8'] });
  let stopped = false, last = '';

  async function tick(){
    if (stopped) return;
    try{
      const codes = await detector.detect(video);
      const first = codes?.[0]?.rawValue || '';
      if (first && first !== last){
        last = first;
        onScan(first);
      }
    }catch(_){}
    requestAnimationFrame(tick);
  }
  tick();

  function stop(){
    stopped = true;
    video.pause();
    (stream.getTracks()||[]).forEach(t=>t.stop());
    mount.innerHTML = '';
  }
  return { stop, clear: ()=>{} };
}

/* ====== IO scan hooks ====== */
function fillIoForm(it){ qs('#io-code').value=it.code||''; qs('#io-name').value=it.name||''; qs('#io-price').value=it.price||''; qs('#io-stock').value=it.stock||''; }
async function startIoScan(){
  try{
    loading(true, 'カメラを起動中…');
    state.ioScanner = await startBackCameraScan('io-scan-area', onScanIo, (isMobile()?240:300));
  }catch(e){
    alert('カメラが見つかりません: '+(e?.message||e));
  }finally{ loading(false); }
}
async function stopIoScan(){ try{ await state.ioScanner?.stop?.(); state.ioScanner?.clear?.(); }catch(_){ } state.ioScanner=null; }
function onScanIo(text){
  try{
    let code='';
    if(text.startsWith('ITEM|')) code=text.split('|')[1]||'';
    else { try{ const o=JSON.parse(text); code=o.code||''; }catch(_){ } }
    if(code){
      const it=state.items.find(x=>String(x.code)===String(code)) || {code, name:'', price:0, stock:0};
      fillIoForm(it); qs('#io-qty').focus();
    }
  }catch(_){ }
}
async function lookupIo(){
  const code = qs('#io-code').value.trim();
  if(!code) return;
  try{
    const r = await api('itemByCode',{ method:'POST', body:{ code }, loadingText:'照会中…' });
    if(!r || r.ok===false) return alert(r?.error || '商品が見つかりません');
    fillIoForm(r.item || {});
  }catch(e){ alert(e.message||e); }
}

/* === Stocktake scan === */
async function startScanner(){
  try{
    loading(true, 'カメラを起動中…');
    state.scanner=await startBackCameraScan('scan-area', onScanStocktake, (isMobile()?240:300));
  }catch(e){
    alert('カメラが見つかりません: '+(e?.message||e));
  }finally{ loading(false); }
}
async function stopScanner(){ try{ await state.scanner?.stop?.(); state.scanner?.clear?.(); }catch(_){ } state.scanner=null; }
function onScanStocktake(text){
  try{
    let code='';
    if(text.startsWith('ITEM|')) code=text.split('|')[1]||'';
    else { try{ const o=JSON.parse(text); code=o.code||''; }catch(_){ } }
    if(code){
      const it=state.items.find(x=>String(x.code)===String(code));
      pushStocktake(code, it?.name||'', Number(it?.stock||0), Number(it?.stock||0));
    }
  }catch(_){}
}
function pushStocktake(code,name,book,real){
  const diff=Number(real)-Number(book);
  state.stocktakeRows.unshift({code,name,book,real,diff});
  const tb=qs('#tbl-stocktake'); if(!tb) return; tb.innerHTML='';
  state.stocktakeRows.forEach(r=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${r.code}</td><td>${r.name}</td>
      <td class="text-end">${fmt(r.book)}</td>
      <td class="text-end">${fmt(r.real)}</td>
      <td class="text-end">${fmt(r.diff)}</td>`;
    tb.appendChild(tr);
  });
}

/* === Item detail & edit === */
function openItemDetail(code){
  const it = state.items.find(x=>String(x.code)===String(code));
  if(!it){ alert('商品が見つかりません'); return; }
  const host = qs('#card-item-detail'); const body=qs('#item-detail-body');
  const recent = state.history.filter(h=>String(h.code)===String(code)).slice(-20).reverse();
  body.innerHTML = `
    <div class="row g-3">
      <div class="col-md-4">
        <div class="p-3 border rounded">
          <div class="fw-semibold mb-2">${it.name||''}（${it.code}）</div>
          ${it.img? `<img src="${it.img}" class="img-fluid rounded mb-2">` : ''}
          <div class="small text-muted">置場: ${it.location||'-'}</div>
          <div class="small text-muted">価格: ¥${fmt(it.price||0)}</div>
          <div class="small text-muted">在庫: ${fmt(it.stock||0)}</div>
          <div class="small text-muted">最小: ${fmt(it.min||0)}</div>
          <div class="small text-muted">ロット: ${it.lotQty||'-'} ${it.lotUnit||''}</div>
        </div>
      </div>
      <div class="col-md-8">
        <div class="table-responsive">
          <table class="table table-sm align-middle">
            <thead><tr><th>日時</th><th>ユーザー</th><th class="text-end">数量</th><th>単位</th><th>種別</th></tr></thead>
            <tbody>
              ${recent.map(h=>`<tr><td>${h.timestamp||''}</td><td>${h.userName||h.userId||''}</td><td class="text-end">${fmt(h.qty||0)}</td><td>${h.unit||''}</td><td>${h.type||''}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  host.classList.remove('d-none');
  qs('#btn-close-detail')?.addEventListener('click', ()=> host.classList.add('d-none'), { once:true });
  showView('view-items','商品一覧');
}

/* === Label generator (sesuai template + gambar part jika ada) === */
function makeItemLabelCanvas(item){
  // ukuran kanvas (ratio ~3:1). Nanti discale saat print.
  const W = 720, H = 240;
  const pad = 12;
  const leftW = 180;  // blok gambar
  const qrW   = 160;  // QR
  const gridX = leftW + qrW + 3*pad; // awal kolom kanan

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  // background & border luar
  g.fillStyle = '#fff'; g.fillRect(0,0,W,H);
  g.lineWidth = 2; g.strokeStyle = '#000'; g.strokeRect(1,1,W-2,H-2);

  // --------- blok kiri: gambar (rounded) ----------
  const rx = pad, ry = pad, rw = leftW, rh = H - 2*pad, r = 24;
  roundRect(g, rx, ry, rw, rh, r, false, true);
  g.fillStyle = '#3B82F6';
  roundRect(g, rx, ry, rw, rh, r, true, false);

  // jika ada item.img, timpa placeholder dengan gambar ter-scale
  if (item.img){
    const im = new Image(); im.crossOrigin = 'anonymous'; im.src = item.img;
    im.onload = ()=>{
      // fit contain di area rounded
      const scale = Math.min(rw/im.width, rh/im.height);
      const iw = im.width*scale, ih = im.height*scale;
      const ix = rx + (rw - iw)/2, iy = ry + (rh - ih)/2;
      // clip rounded
      g.save(); makeRoundPath(g, rx, ry, rw, rh, r); g.clip();
      g.drawImage(im, ix, iy, iw, ih);
      g.restore();
    };
  } else {
    g.fillStyle = '#fff';
    g.font = 'bold 28px "Noto Sans JP", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('映像', rx + rw/2, ry + rh/2);
  }

  // --------- QR di tengah ----------
  const qx = rx + rw + pad, qy = pad;
  const qh = H - 2*pad;
  const tmp = document.createElement('div');
  if (typeof QRCode !== 'undefined'){
    new QRCode(tmp, { text: `ITEM|${item.code}`, width: qrW, height: qh, correctLevel: QRCode.CorrectLevel.M });
    const img = tmp.querySelector('img') || tmp.querySelector('canvas');
    const dataUrl = img?.src || img?.toDataURL?.('image/png') || '';
    const qimg = new Image(); qimg.src = dataUrl;
    qimg.onload = ()=> g.drawImage(qimg, qx, qy, qrW, qh);
  }

  // --------- grid kanan (3 baris) ----------
  const cellH = (H - 2*pad)/3;
  g.lineWidth = 2; g.strokeStyle = '#000';
  // garis vertikal kiri grid
  g.beginPath(); g.moveTo(gridX-pad/2, pad); g.lineTo(gridX-pad/2, H-pad); g.stroke();
  // garis pembatas baris
  for(let i=1;i<=2;i++){
    const y = pad + cellH*i;
    g.beginPath(); g.moveTo(gridX-pad/2, y); g.lineTo(W-pad, y); g.stroke();
  }
  // kotak luar grid
  g.strokeRect(gridX-pad/2, pad, W - gridX - pad/2, H - 2*pad);

  // label dan nilai
  g.fillStyle = '#000';
  g.font = '20px "Noto Sans JP", system-ui, sans-serif';
  const labelX = gridX + 10; const valX = gridX + 120;
  const y1 = pad + cellH/2, y2 = pad + cellH*1.5, y3 = pad + cellH*2.5;

  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText('コード：', labelX, y1);
  g.fillText('商品名：', labelX, y2);
  g.fillText('置場：',  labelX, y3);

  g.font = 'bold 22px "Noto Sans JP", system-ui, sans-serif';
  // pastikan teks tidak keluar: sederhana, potong jika panjang
  const tCode = String(item.code||'');
  const tName = ellip(String(item.name||''), 18);
  const tLoc  = ellip(String(item.location||''), 18);
  g.fillText(tCode, valX, y1);
  g.fillText(tName, valX, y2);
  g.fillText(tLoc,  valX, y3);

  return c;

  function ellip(s, max){ return s.length>max ? s.slice(0,max-1)+'…' : s; }
  function roundRect(ctx, x, y, w, h, r, fill, stroke){
    ctx.beginPath(); makeRoundPath(ctx, x,y,w,h,r); ctx.closePath();
    if (fill) ctx.fill(); if (stroke) ctx.stroke();
  }
  function makeRoundPath(ctx, x, y, w, h, r){
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y, x+w,y+h, r);
    ctx.arcTo(x+w,y+h, x, y+h, r);
    ctx.arcTo(x,y+h, x, y, r);
    ctx.arcTo(x,y, x+w, y, r);
  }
}

/* Membuat dataURL label (tunggu gambar/QR selesai) */
function makeItemLabelDataURL(item){
  return new Promise((resolve)=>{
    const c = makeItemLabelCanvas(item);
    // beri sedikit waktu untuk gambar/QR onload (simple way)
    setTimeout(()=> resolve(c.toDataURL('image/png')), 200);
  });
}

/* === DOMContentLoaded === */
window.addEventListener('DOMContentLoaded', async ()=>{
  updateWho();
  qsa('aside nav a').forEach(a=>a.addEventListener('click',()=>showView(a.getAttribute('data-view'), a.textContent.trim())));
  qs('#btn-logout')?.addEventListener('click',()=>{ localStorage.removeItem('currentUser'); location.href='index.html'; });

  // IO form
  qs('#btn-io-scan')?.addEventListener('click', startIoScan);
  qs('#btn-io-stop')?.addEventListener('click', stopIoScan);
  qs('#btn-io-lookup')?.addEventListener('click', lookupIo);
  qs('#io-code')?.addEventListener('change', lookupIo);
  qs('#form-io')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const body={ userId:state.currentUser.id, code:qs('#io-code').value.trim(), qty:Number(qs('#io-qty').value||0), unit:qs('#io-unit').value, type:qs('#io-type').value };
    if(!body.code || !body.qty){ alert('コード/数量は必須'); return; }
    try{
      await api('log',{method:'POST',body, loadingText:'登録中…'});
      alert('登録しました');
      await loadAll(); showView('view-history','履歴');
      fillIoForm({code:'',name:'',price:'',stock:''}); qs('#io-qty').value='';
    }catch(err){ alert('登録失敗: '+(err?.message||err)); }
  });

  // Stocktake
  qs('#btn-start-scan')?.addEventListener('click', startScanner);
  qs('#btn-stop-scan')?.addEventListener('click', stopScanner);

  // Export items
  qs('#btn-items-export')?.addEventListener('click', ()=>{
    loading(true, 'CSVを生成中…');
    try{
      const head='code,name,price,stock,min,location,lotUnit,lotQty\n';
      const lines=state.items.map(r=>[r.code,r.name,r.price,r.stock,r.min,r.location||'',r.lotUnit||'',r.lotQty||0].join(',')).join('\n');
      const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='items.csv'; a.click();
    } finally { loading(false); }
  });

  // Print semua label (A4 grid 2 kolom)
  qs('#btn-items-print-all')?.addEventListener('click', ()=>{
    if(!state.items.length) return;
    loading(true,'ラベルを準備中…');
    try{
      const grid = document.createElement('div');
      grid.style.display='grid'; grid.style.gridTemplateColumns='repeat(2, 1fr)'; grid.style.gap='10mm';

      state.items.forEach(it=>{
        const c = makeItemLabelCanvas(it);
        const img = new Image(); img.src = c.toDataURL('image/png'); img.style.width='100%';
        const cell = document.createElement('div'); cell.appendChild(img);
        grid.appendChild(cell);
      });

      const w = window.open('', 'printlabels');
      w.document.write(`<html><head><title>Labels</title>
        <style>@page{ size:A4; margin:12mm } body{font-family:sans-serif}
        .grid{ display:grid; grid-template-columns:repeat(2,1fr); gap:10mm }
        img{ width:100%; page-break-inside:avoid; }</style></head><body>
        <div class="grid">${grid.innerHTML}</div></body></html>`);
      w.document.close(); w.focus(); w.print();
    } finally { loading(false); }
  });

  // Modal Item (new)
  const modalItem   = document.getElementById('dlg-new-item') ? new bootstrap.Modal('#dlg-new-item') : null;
  qs('#btn-open-new-item')?.addEventListener('click', ()=>{
    qs('#i-code').value  = nextItemCode();
    qs('#i-name').value  = '';
    qs('#i-price').value = 0;
    qs('#i-stock').value = 0;
    qs('#i-min').value   = 0;
    qs('#i-img').value   = '';
    qs('#i-location').value = '';
    qs('#i-lotUnit').value  = 'pcs';
    qs('#i-lotQty').value   = 0;
    modalItem?.show();
  });
  qs('#form-item')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const body={
      code:qs('#i-code').value.trim(),
      name:qs('#i-name').value.trim(),
      price:Number(qs('#i-price').value||0),
      stock:Number(qs('#i-stock').value||0),
      min:Number(qs('#i-min').value||0),
      img:qs('#i-img').value.trim(),
      location:qs('#i-location').value.trim(),
      lotUnit:qs('#i-lotUnit').value.trim()||'pcs',
      lotQty:Number(qs('#i-lotQty').value||0),
      overwrite:false
    };
    if(!body.code || !body.name){ alert('コード/名称は必須'); return; }
    try{
      await api('addItem',{method:'POST',body, loadingText:'登録中…'});
      modalItem?.hide(); await loadAll(); showView('view-items','商品一覧');
    }catch(err){ alert(err.message); }
  });

  // Modal Item (edit)
  const modalEditItem = document.getElementById('dlg-edit-item') ? new bootstrap.Modal('#dlg-edit-item') : null;
  qs('#form-edit-item')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const body={
      code:qs('#e-code').value.trim(),
      name:qs('#e-name').value.trim(),
      price:Number(qs('#e-price').value||0),
      stock:Number(qs('#e-stock').value||0),
      min:Number(qs('#e-min').value||0),
      img:qs('#e-img').value.trim(),
      location:qs('#e-location').value.trim(),
      lotUnit:qs('#e-lotUnit').value.trim(),
      lotQty:Number(qs('#e-lotQty').value||0),
      overwrite:true
    };
    try{
      await api('updateItem',{method:'POST',body, loadingText:'保存中…'});
      modalEditItem?.hide(); await loadAll();
    }catch(err){ alert(err.message||err); }
  });

  // Modal User
  const modalUser   = document.getElementById('dlg-new-user') ? new bootstrap.Modal('#dlg-new-user') : null;
  qs('#btn-open-new-user')?.addEventListener('click', ()=>modalUser?.show());
  qs('#form-user')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const body={ name:qs('#u-name').value.trim(), id:qs('#u-id').value.trim(), role:qs('#u-role').value, pin:qs('#u-pin').value.trim() };
    try{ await api('addUser',{method:'POST',body, loadingText:'登録中…'}); modalUser?.hide(); await loadAll(); showView('view-users','ユーザー / QR'); }catch(err){ alert(err.message); }
  });

  // init
  showView('view-dashboard','ダッシュボード');
  await loadAll();
});

// === util
function nextItemCode(){
  const nums=state.items.map(i=>String(i.code||'')).map(c=>/^\d+$/.test(c)?Number(c):NaN).filter(n=>!isNaN(n));
  const max=nums.length?Math.max(...nums):0;
  const width=Math.max(4, ...state.items.map(i=>String(i.code||'').length||0)) || 4;
  return String(max+1).padStart(width,'0');
}
