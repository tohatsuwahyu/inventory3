/* =========================================================
 * app.js — Inventory Dashboard (full)
 * - Koneksi GAS stabil (GET/POST + apikey)
 * - QR scanner kecil & fokus (BarcodeDetector → html5-qrcode)
 * - QR renderer pakai qrlib.js (dengan fallback ke CDN)
 * - Label item rapi (Gambar + QR + コード/商品名/置場)
 * - Burger menu mobile berfungsi
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
function updateWho(){ const u=state.currentUser; const el=qs('#who'); if(el) el.textContent=`${u.name}（${u.id}｜${u.role||'user'}）`; }

// ======= Sidebar / Burger Menu (FIXED) =======
function ensureBackdrop(){
  let bd = document.getElementById('sb-backdrop') || document.getElementById('backdrop');
  if(!bd){
    bd = document.createElement('div');
    bd.id = 'sb-backdrop';
    bd.className = 'offcanvas-backdrop fade';
    document.body.appendChild(bd);
  }
  return bd;
}
function getSidebar(){
  return document.getElementById('sb') || qs('.sidebar') || qs('aside[role="navigation"]') || qs('aside');
}
function openMenu(open){
  const sb = getSidebar();
  const bd = ensureBackdrop();
  if(!sb) return;
  if(open){
    sb.classList.add('show','open');
    bd.classList.add('show');
    document.body.classList.add('overflow-hidden');
  }else{
    sb.classList.remove('show','open');
    bd.classList.remove('show');
    document.body.classList.remove('overflow-hidden');
  }
}
function initBurger(){
  const openers = [
    '#burger','#btn-menu','[data-action="menu"]','.btn-burger','.js-menu-open'
  ];
  const closers = [
    '#sb-close','[data-action="close-menu"]','.js-menu-close'
  ];
  openers.forEach(sel=> qs(sel)?.addEventListener('click',(e)=>{ e.preventDefault(); openMenu(true); }));
  closers.forEach(sel=> qs(sel)?.addEventListener('click',(e)=>{ e.preventDefault(); openMenu(false); }));
  ensureBackdrop()?.addEventListener('click', ()=>openMenu(false));
  window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') openMenu(false); });
}

// ======= dynamic script loader =======
function loadScriptOnce(src){
  return new Promise((res, rej)=>{
    // hindari load ganda
    if ([...document.scripts].some(s=>s.src.endsWith(src) || s.src===src)) return res();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res; s.onerror = ()=>rej(new Error('load failed: '+src));
    document.head.appendChild(s);
  });
}

// ======= html5-qrcode loader =======
let html5qrcodeReady = !!window.Html5Qrcode;
async function ensureHtml5Qrcode(){
  if (window.Html5Qrcode) { html5qrcodeReady = true; return; }
  try { await loadScriptOnce('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/minified/html5-qrcode.min.js'); } catch {}
  if (!window.Html5Qrcode) {
    try { await loadScriptOnce('./vendor/html5-qrcode.min.js'); } catch {}
  }
  html5qrcodeReady = !!window.Html5Qrcode;
}

// ======= qrcode.js (qrlib.js) loader yang tahan banting =======
async function ensureQRCode(){
  if (window.QRCode) return;
  // coba lokal
  try { await loadScriptOnce('./qrlib.js'); } catch {}
  // fallback CDN
  if (!window.QRCode) {
    try { await loadScriptOnce('https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'); } catch {}
  }
}

// ======= Scanner start (kecil & fokus, guard constant) =======
async function startBackCameraScan(
  mountId,
  onScan,
  boxSize = (isMobile() ? 200 : 240)
){
  // batas tampilan (biar tidak memenuhi layar)
  const mount = document.getElementById(mountId);
  if (mount){
    mount.style.maxWidth = isMobile() ? '360px' : '420px';
    mount.style.margin   = '0 auto';
    mount.style.aspectRatio = '4 / 3';
    mount.style.position = 'relative';
  }

  // 1) Coba BarcodeDetector (akurat & ringan)
  if ('BarcodeDetector' in window) {
    try { return await startNativeDetector(mountId, onScan, boxSize); }
    catch (e) { console.warn('BarcodeDetector gagal, fallback ke html5-qrcode', e); }
  }

  // 2) Fallback html5-qrcode dengan konfigurasi yang “ketat”
  await ensureHtml5Qrcode();
  if (!window.Html5Qrcode) throw new Error('ライブラリ html5-qrcode を読み込めませんでした。');

  // hanya QR_CODE (lebih cepat daripada multi-format)
  const formatsOpt = (window.Html5QrcodeSupportedFormats && Html5QrcodeSupportedFormats.QR_CODE)
    ? { formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ] }
    : {};

  // Konfigurasi penting untuk akurasi
  const cfg = {
    fps: 12,                            // sedikit lebih tinggi
    qrbox: { width: boxSize, height: boxSize },  // kotak fokus kecil
    aspectRatio: 1.33,
    rememberLastUsedCamera: true,
    disableFlip: true,                  // JANGAN mirror; beberapa kamera terbalik
    // Paksa kamera belakang + resolusi/fokus yang bagus
    videoConstraints: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1280 },
      height: { ideal: 720 },
      // browser yang mendukung akan memakai ini:
      focusMode: 'continuous'          // continuous autofocus
    },
    ...formatsOpt
  };

  const scanner = new Html5Qrcode(mountId, { useBarCodeDetectorIfSupported: true });

  // start dengan facingMode (umum), jika gagal → pilih deviceId belakang
  try {
    await scanner.start({ facingMode: 'environment' }, cfg, txt => onScan(txt));
    return scanner;
  } catch (err1) {
    try {
      const cams = await Html5Qrcode.getCameras();
      if (!cams?.length) throw err1;
      const back = cams.find(c=>/back|rear|environment/i.test(c.label)) || cams.at(-1);
      await scanner.start({ deviceId: { exact: back.id } }, cfg, txt => onScan(txt));
      return scanner;
    } catch (err2) {
      await scanner?.stop?.(); scanner?.clear?.();
      throw new Error('カメラが見つかりません。権限/ネットワークをご確認ください。');
    }
  }
}


async function startNativeDetector(mountId, onScan, boxSize = 240){
  const mount = document.getElementById(mountId);
  mount.innerHTML = '';
  const video = document.createElement('video');
  video.setAttribute('playsinline','');
  video.style.width = '100%';
  video.style.maxWidth = boxSize + 'px';
  mount.appendChild(video);

  const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' }, audio:false });
  video.srcObject = stream; await video.play();

  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  let stopped = false, last = '';
  async function tick(){
    if (stopped) return;
    try {
      const codes = await detector.detect(video);
      const v = codes?.[0]?.rawValue || '';
      if (v && v !== last) { last = v; onScan(v); }
    } catch {}
    requestAnimationFrame(tick);
  }
  tick();

  function stop(){
    stopped = true;
    try { video.pause(); (stream.getTracks()||[]).forEach(t=>t.stop()); } catch {}
    mount.innerHTML = '';
  }
  return { stop, clear: ()=>{} };
}

// ======= API wrapper (GAS) =======
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
        method:'POST', mode:'cors',
        headers:{ 'Content-Type':'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...(body||{}), apikey: CONFIG.API_KEY })
      });
      if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
      return await r.json();
    }
  } finally { if(showLoading) loading(false); }
}
function normArr(r, key){ if(Array.isArray(r)) return r; if(r&&Array.isArray(r[key])) return r[key]; if(r&&r.data&&Array.isArray(r.data)) return r.data; return []; }

// ======= Load semua data =======
async function loadAll(){
  loading(true,'データ読込中…');
  try{
    const [items, users, history, monthly] = await Promise.all([
      api('items',{showLoading:false}),
      api('users',{showLoading:false}),
      api('history',{showLoading:false}),
      api('statsMonthlySeries',{showLoading:false}),
    ]);
    state.items = normArr(items,'items');
    state.users = normArr(users,'users');
    state.history = normArr(history,'history');
    state.monthly = normArr(monthly,'series');
    state.filteredItems = [...state.items];

    renderMetrics(); renderMonthlyChart(); renderPieThisMonth(); renderMovementsThisMonth();
    renderItems(); renderUsers(); renderHistory();
  }catch(e){
    alert('Gagal ambil data dari backend.\nPeriksa config.js / GAS.\nDetail: '+(e?.message||e));
    console.error(e);
  }finally{ loading(false); }
}

// ======= Dashboard widgets =======
function parseTs(s){ if(!s) return null; const d=new Date(s.replace(' ','T')); return isNaN(+d)?null:d; }
function renderMetrics(){
  qs('#metric-total-items')?.replaceChildren(document.createTextNode(fmt(state.items.length)));
  qs('#metric-low-stock')?.replaceChildren(document.createTextNode(fmt(state.items.filter(i=>Number(i.stock||0)<=Number(i.min||0)).length)));
  qs('#metric-users')?.replaceChildren(document.createTextNode(fmt(state.users.length)));
  const now = today(); const cutoff = new Date(now.getFullYear(),now.getMonth(),now.getDate()-30);
  const last30 = state.history.filter(h=>{ const d=parseTs(h.timestamp); return d && d>=cutoff; });
  qs('#metric-txn')?.replaceChildren(document.createTextNode(fmt(last30.length)));
}
let monthlyChart, pieChart;
function renderMonthlyChart(){
  const el=qs('#chart-monthly'); if(!el || !window.Chart) return;
  monthlyChart?.destroy?.();
  monthlyChart = new Chart(el,{ type:'bar',
    data:{ labels: state.monthly.map(m=>m.month),
      datasets:[
        { label:'IN',  data: state.monthly.map(m=>m.in||0),  backgroundColor:'rgba(37,99,235,.7)' },
        { label:'OUT', data: state.monthly.map(m=>m.out||0), backgroundColor:'rgba(239,68,68,.7)' }
      ]},
    options:{ responsive:true, scales:{ y:{ beginAtZero:true } }, plugins:{ legend:{ display:true } } }
  });
}
function renderPieThisMonth(){
  const el=qs('#chart-pie'); if(!el || !window.Chart) return;
  pieChart?.destroy?.();
  const now=today(); const ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  let IN=0, OUT=0;
  state.history.forEach(h=>{ const d=parseTs(h.timestamp); if(!d) return; const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; if(key!==ym) return;
    const q=Number(h.qty||0); if(String(h.type)==='IN') IN+=q; else OUT+=q; });
  pieChart = new Chart(el,{ type:'pie',
    data:{ labels:['IN','OUT'], datasets:[{ data:[IN,OUT], backgroundColor:['rgba(37,99,235,.8)','rgba(239,68,68,.8)'] }] },
    options:{ responsive:true, plugins:{ legend:{ position:'bottom' } } }
  });
}
function renderMovementsThisMonth(){
  const tb=qs('#tbl-mov'); if(!tb) return; tb.innerHTML='';
  const now=today(); const ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const byCode=new Map();
  state.history.forEach(h=>{
    const d=parseTs(h.timestamp); if(!d) return; const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; if(key!==ym) return;
    const code=String(h.code||''); const rec=byCode.get(code)||{code,name:'',IN:0,OUT:0};
    const it=state.items.find(x=>String(x.code)===code); rec.name=it?.name||rec.name;
    const q=Number(h.qty||0); if(String(h.type)==='IN') rec.IN+=q; else rec.OUT+=q; byCode.set(code,rec);
  });
  [...byCode.values()].sort((a,b)=> (b.IN+b.OUT)-(a.IN+a.OUT)).forEach(r=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${r.code}</td><td>${r.name}</td><td class="text-end">${fmt(r.IN)}</td><td class="text-end">${fmt(r.OUT)}</td><td class="text-end">${fmt(r.IN-r.OUT)}</td>`;
    tb.appendChild(tr);
  });
  qs('#btn-export-mov')?.addEventListener('click',()=>{
    loading(true,'CSVを生成中…');
    try{
      const head='code,name,IN,OUT,NET\n';
      const lines=[...byCode.values()].map(r=>[r.code,r.name,r.IN,r.OUT,r.IN-r.OUT].join(',')).join('\n');
      const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='movements_this_month.csv'; a.click();
    }finally{ loading(false); }
  },{once:true});
}

// ======= QR helpers =======
const itemQrText = (code)=>`ITEM|${String(code||'')}`;
const userQrText = (id)=>`USER|${String(id||'')}`;

// Buat QR → dataURL yang stabil (tunggu sampai jadi)
function generateQrDataUrl(text, size=160) {
  return new Promise(async (resolve, reject) => {
    try { await ensureQRCode(); } catch {}
    if (!window.QRCode) return reject(new Error('qrcode.js gagal dimuat'));

    const tmp = document.createElement('div');
    tmp.style.position='fixed'; tmp.style.left='-9999px'; tmp.style.top='-9999px';
    document.body.appendChild(tmp);

    new QRCode(tmp, { text, width:size, height:size, correctLevel: (window.QRCode?.CorrectLevel?.M || 1) });

    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      const img = tmp.querySelector('img');
      const cvs = tmp.querySelector('canvas');
      let url = '';
      if (cvs && cvs.toDataURL) url = cvs.toDataURL('image/png');
      else if (img && img.complete && img.naturalWidth) url = img.src;
      if (url) {
        clearInterval(timer);
        document.body.removeChild(tmp);
        resolve(url);
      } else if (tries > 40) {
        clearInterval(timer);
        document.body.removeChild(tmp);
        reject(new Error('QR timeout'));
      }
    }, 50);
  });
}

// ======= Items table + Label DL =======
async function renderItems(){
  const tb=qs('#tbl-items'); if(!tb) return; tb.innerHTML='';
  await ensureQRCode();

  const list = state.filteredItems.length ? state.filteredItems : state.items;
  list.forEach(i=>{
    const code=String(i.code||''); const hid=`qr-${code.replace(/[^\w\-:.]/g,'_')}`;
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td class="qr-cell"><div class="qrbox"><div id="${hid}"></div><div class="caption">${i.name||''}（${code}）</div></div></td>
      <td>${code}</td>
      <td class="item-name clickable text-decoration-underline" data-code="${code}" role="button">${i.name||''}</td>
      <td>${i.img?`<img class="thumb" src="${i.img}" alt="">`:''}</td>
      <td class="text-end">¥${fmt(i.price||0)}</td>
      <td class="text-end">${fmt(i.stock||0)}</td>
      <td class="text-end">${fmt(i.min||0)}</td>
      <td>${i.location||''}</td>
      <td class="text-end">
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-primary" data-act="edit" data-code="${code}" title="編集"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-outline-danger"  data-act="del"  data-code="${code}" title="削除"><i class="bi bi-trash"></i></button>
          <button class="btn btn-outline-secondary" data-act="detail" data-code="${code}" title="詳細"><i class="bi bi-search"></i></button>
          <button class="btn btn-outline-success" data-act="dl"   data-code="${code}" title="ラベルDL">DL</button>
        </div>
      </td>`;
    tb.appendChild(tr);

    const holder=document.getElementById(hid);
    if(holder && window.QRCode){
      holder.innerHTML='';
      new QRCode(holder,{ text:itemQrText(code), width:84, height:84, correctLevel:(window.QRCode?.CorrectLevel?.M || 1) });
    }
  });

  // Actions
  tb.querySelectorAll('button[data-act="dl"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const code=btn.getAttribute('data-code'); const it=state.items.find(x=>String(x.code)===String(code)); if(!it) return;
      loading(true,'ラベルを生成中…');
      try{
        const dataUrl=await makeItemLabelDataURL(it);
        const a=document.createElement('a'); a.href=dataUrl; a.download=`LABEL_${safeFile(it.code)}.png`; a.click();
      }finally{ loading(false); }
    });
  });
  tb.querySelectorAll('button[data-act="edit"]').forEach(btn=>btn.addEventListener('click',()=>openEditItem(btn.getAttribute('data-code'))));
  tb.querySelectorAll('button[data-act="del"]').forEach(btn=>btn.addEventListener('click',async()=>{
    const code=btn.getAttribute('data-code'); if(!confirm(`商品（${code}）を削除しますか？`)) return;
    try{ await api('deleteItem',{method:'POST',body:{code},loadingText:'削除中…'}); await loadAll(); }catch(e){ alert(e.message||e); }
  }));
  tb.querySelectorAll('button[data-act="detail"], td.item-name').forEach(el=>el.addEventListener('click',()=>openItemDetail(el.getAttribute('data-code'))));

  // Search (once)
  qs('#items-search')?.addEventListener('input',e=>{
    const q=String(e.target.value||'').toLowerCase();
    state.filteredItems=state.items.filter(i=>String(i.name||'').toLowerCase().includes(q));
    renderItems();
  },{once:true});
}

// ======= Users =======
async function renderUsers(){
  const btnAdd=qs('#btn-open-new-user'); const btnPrint=qs('#btn-print-qr-users');
  const admin=(state.currentUser.role==='admin'); if(admin){btnAdd?.classList.remove('d-none');btnPrint?.classList.remove('d-none');} else {btnAdd?.classList.add('d-none');btnPrint?.classList.add('d-none');}
  const tb=qs('#tbl-userqr'); if(!tb) return; tb.innerHTML='';
  await ensureQRCode();

  const list=admin?state.users:state.users.filter(u=>String(u.id)===String(state.currentUser.id));
  list.forEach(u=>{
    const id=String(u.id||''); const hid=`uqr-${id.replace(/[^\w\-:.]/g,'_')}`;
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td class="qr-cell"><div class="qrbox"><div id="${hid}"></div><div class="caption">${u.name||''}（${u.id||''}）</div></div></td>
      <td>${u.id||''}</td><td>${u.name||''}</td><td>${u.role||'user'}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-secondary" data-act="udl" data-id="${hid}" title="DL"><i class="bi bi-download"></i></button></td>`;
    tb.appendChild(tr);
    const div=document.getElementById(hid); if(div && window.QRCode){
      new QRCode(div,{ text:userQrText(id), width:84, height:84, correctLevel:(window.QRCode?.CorrectLevel?.M || 1) });
    }
  });

  tb.querySelectorAll('button[data-act="udl"]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const hid=btn.getAttribute('data-id'); const holder=document.getElementById(hid);
      const cvs=holder?.querySelector('canvas'); const img=holder?.querySelector('img');
      const dataUrl=cvs?.toDataURL?.('image/png') || img?.src || ''; if(!dataUrl) return;
      const a=document.createElement('a'); a.href=dataUrl; a.download='USER_QR.png'; a.click();
    });
  });
}

// ======= History =======
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
    btn.addEventListener('click',()=>{
      const row=btn.getAttribute('data-row'); const item=state.history.find(x=>String(x._row)===String(row)); if(!item) return;
      qs('#h-row').value=row; qs('#h-userId').value=item.userId||''; qs('#h-code').value=item.code||''; qs('#h-qty').value=item.qty||0; qs('#h-unit').value=item.unit||'pcs'; qs('#h-type').value=item.type||'IN'; qs('#h-note').value=item.note||'';
      new bootstrap.Modal('#dlg-edit-history').show();
    });
  });
}

// ======= IO (入出庫) Scan =======
function fillIoForm(it){ qs('#io-code').value=it.code||''; qs('#io-name').value=it.name||''; qs('#io-price').value=it.price||''; qs('#io-stock').value=it.stock||''; }
async function startIoScan(){ try{ loading(true,'カメラを起動中…'); state.ioScanner=await startBackCameraScan('io-scan-area',onScanIo,(isMobile()?200:240)); }catch(e){ alert('カメラが見つかりません: '+(e?.message||e)); }finally{ loading(false); } }
async function stopIoScan(){ try{ await state.ioScanner?.stop?.(); state.ioScanner?.clear?.(); }catch{} state.ioScanner=null; }
function onScanIo(text){
  try{
    let code=''; if(text.startsWith('ITEM|')) code=text.split('|')[1]||''; else { try{ const o=JSON.parse(text); code=o.code||''; }catch{} }
    if(code){ const it=state.items.find(x=>String(x.code)===String(code)) || {code,name:'',price:0,stock:0}; fillIoForm(it); qs('#io-qty').focus(); }
  }catch{}
}
async function lookupIo(){
  const code=qs('#io-code').value.trim(); if(!code) return;
  try{ const r=await api('itemByCode',{method:'POST',body:{code},loadingText:'照会中…'}); if(!r||r.ok===false) return alert(r?.error||'商品が見つかりません'); fillIoForm(r.item||{}); }
  catch(e){ alert(e.message||e); }
}

// ======= 棚卸 Scan =======
async function startScanner(){ try{ loading(true,'カメラを起動中…'); state.scanner=await startBackCameraScan('scan-area',onScanStocktake,(isMobile()?200:240)); }catch(e){ alert('カメラが見つかりません: '+(e?.message||e)); }finally{ loading(false); } }
async function stopScanner(){ try{ await state.scanner?.stop?.(); state.scanner?.clear?.(); }catch{} state.scanner=null; }
function onScanStocktake(text){
  try{
    let code=''; if(text.startsWith('ITEM|')) code=text.split('|')[1]||''; else { try{ const o=JSON.parse(text); code=o.code||''; }catch{} }
    if(code){ const it=state.items.find(x=>String(x.code)===String(code)); pushStocktake(code,it?.name||'',Number(it?.stock||0),Number(it?.stock||0)); }
  }catch{}
}
function pushStocktake(code,name,book,real){
  const diff=Number(real)-Number(book); state.stocktakeRows.unshift({code,name,book,real,diff});
  const tb=qs('#tbl-stocktake'); if(!tb) return; tb.innerHTML='';
  state.stocktakeRows.forEach(r=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${r.code}</td><td>${r.name}</td><td class="text-end">${fmt(r.book)}</td><td class="text-end">${fmt(r.real)}</td><td class="text-end">${fmt(r.diff)}</td>`; tb.appendChild(tr); });
}

// ======= Item detail =======
function openItemDetail(code){
  const it=state.items.find(x=>String(x.code)===String(code)); if(!it){ alert('商品が見つかりません'); return; }
  const host=qs('#card-item-detail'); const body=qs('#item-detail-body');
  const recent=state.history.filter(h=>String(h.code)===String(code)).slice(-20).reverse();
  body.innerHTML=`
    <div class="row g-3">
      <div class="col-md-4"><div class="p-3 border rounded">
        <div class="fw-semibold mb-2">${it.name||''}（${it.code}）</div>
        ${it.img?`<img src="${it.img}" class="img-fluid rounded mb-2">`:''}
        <div class="small text-muted">置場: ${it.location||'-'}</div>
        <div class="small text-muted">価格: ¥${fmt(it.price||0)}</div>
        <div class="small text-muted">在庫: ${fmt(it.stock||0)}</div>
        <div class="small text-muted">最小: ${fmt(it.min||0)}</div>
        <div class="small text-muted">ロット: ${it.lotQty||'-'} ${it.lotUnit||''}</div>
      </div></div>
      <div class="col-md-8"><div class="table-responsive">
        <table class="table table-sm align-middle">
          <thead><tr><th>日時</th><th>ユーザー</th><th class="text-end">数量</th><th>単位</th><th>種別</th></tr></thead>
          <tbody>${recent.map(h=>`<tr><td>${h.timestamp||''}</td><td>${h.userName||h.userId||''}</td><td class="text-end">${fmt(h.qty||0)}</td><td>${h.unit||''}</td><td>${h.type||''}</td></tr>`).join('')}</tbody>
        </table>
      </div></div>
    </div>`;
  host?.classList.remove('d-none'); qs('#btn-close-detail')?.addEventListener('click',()=>host.classList.add('d-none'),{once:true});
  showView('view-items','商品一覧');
}

// ======= Label generator (gambar + QR + teks rapi) =======
async function makeItemLabelDataURL(item){
  const W=760,H=260,pad=16,imgW=200,qrW=160;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const g=c.getContext('2d');

  // background & border
  g.fillStyle='#fff'; g.fillRect(0,0,W,H);
  g.strokeStyle='#000'; g.lineWidth=2; g.strokeRect(1,1,W-2,H-2);

  // slot gambar (kiri)
  const rx=pad,ry=pad,rw=imgW,rh=H-2*pad,r=18;
  roundRect(g,rx,ry,rw,rh,r,true,true,'#eaf1ff','#cbd5e1');

  // gambar part (jika ada), jika tidak tampil "画像"
  await drawImageIfAny(g, item.img, rx,ry,rw,rh,r);

  // QR (tengah)
  const qx=rx+rw+pad, qy=pad, qh=H-2*pad;
  try{
    const du = await generateQrDataUrl(`ITEM|${item.code}`, Math.min(qrW, qh));
    const qimg=new Image(); qimg.src=du;
    await imgLoaded(qimg); g.drawImage(qimg, qx, qy, qrW, qh);
  }catch{}

  // grid kanan
  const gridX=qx+qrW+pad, cellH=(H-2*pad)/3;
  g.strokeStyle='#000'; g.lineWidth=2;
  g.strokeRect(gridX,pad, W-gridX-pad, H-2*pad);
  for(let i=1;i<=2;i++){ const y=pad+cellH*i; g.beginPath(); g.moveTo(gridX,y); g.lineTo(W-pad,y); g.stroke(); }

  const labelX=gridX+12,valX=gridX+112;
  g.textAlign='left'; g.textBaseline='middle'; 
  g.fillStyle='#000'; g.font='18px "Noto Sans JP", system-ui';
  g.fillText('コード：', labelX, pad+cellH*0.5);
  g.fillText('商品名：', labelX, pad+cellH*1.5);
  g.fillText('置場：',   labelX, pad+cellH*2.5);

  g.font='bold 22px "Noto Sans JP", system-ui';
  fillTextMax(g, String(item.code||''), valX, pad+cellH*0.5, W-pad- valX);
  fillTextMax(g, String(item.name||''), valX, pad+cellH*1.5, W-pad- valX);
  g.font='bold 20px "Noto Sans JP", system-ui';
  fillTextMax(g, String(item.location||''), valX, pad+cellH*2.5, W-pad- valX);

  return c.toDataURL('image/png');

  // helpers
  function roundRect(ctx,x,y,w,h,r,fill,stroke,fillColor,border){ ctx.save(); ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
    if(fill){ctx.fillStyle=fillColor||'#eef';ctx.fill();}
    if(stroke){ctx.strokeStyle=border||'#000';ctx.stroke();}
    ctx.restore();
  }
  function imgLoaded(im){ return new Promise((res)=>{ im.onload=()=>res(); im.onerror=()=>res(); }); }
  async function drawImageIfAny(ctx, url, x,y,w,h,r){
    if(!url){
      ctx.save();
      ctx.fillStyle='#3B82F6'; ctx.font='bold 28px "Noto Sans JP", system-ui';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('画像', x+w/2, y+h/2);
      ctx.restore(); return;
    }
    try{
      const im=new Image(); im.crossOrigin='anonymous'; im.src=url;
      await imgLoaded(im);
      const s=Math.min(w/im.width,h/im.height);
      const iw=im.width*s, ih=im.height*s;
      const ix=x+(w-iw)/2, iy=y+(h-ih)/2;
      ctx.save(); // clip to rounded rect
      ctx.beginPath();
      ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
      ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
      ctx.clip();
      ctx.drawImage(im, ix, iy, iw, ih);
      ctx.restore();
    }catch{}
  }
  function fillTextMax(ctx, text, x, y, maxW){
    let t=text; while (ctx.measureText(t).width > maxW && t.length>0) t=t.slice(0,-1);
    if (t !== text && t.length>2) t=t.slice(0,-1)+'…';
    ctx.fillText(t, x, y);
  }
}

// ======= View switcher =======
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

// ======= Simple editors (placeholders for existing modals) =======
function openEditItem(code){
  const it=state.items.find(x=>String(x.code)===String(code));
  if(!it) return;
  qs('#e-code').value=it.code||'';
  qs('#e-name').value=it.name||'';
  qs('#e-price').value=it.price||0;
  qs('#e-stock').value=it.stock||0;
  qs('#e-min').value=it.min||0;
  qs('#e-img').value=it.img||'';
  qs('#e-location').value=it.location||'';
  qs('#e-lotUnit').value=it.lotUnit||'pcs';
  qs('#e-lotQty').value=it.lotQty||0;
  new bootstrap.Modal('#dlg-edit-item').show();
}
function nextItemCode(){
  const nums=state.items.map(i=>String(i.code||'')).map(c=>/^\d+$/.test(c)?Number(c):NaN).filter(n=>!isNaN(n));
  const max=nums.length?Math.max(...nums):0; const width=Math.max(4,...state.items.map(i=>String(i.code||'').length||0))||4;
  return String(max+1).padStart(width,'0');
}

// ======= DOM Ready =======
window.addEventListener('DOMContentLoaded', async ()=>{
  initBurger();
  updateWho();

  qsa('aside nav a').forEach(a=>a.addEventListener('click',()=>showView(a.getAttribute('data-view'),a.textContent.trim())));
  qs('#btn-logout')?.addEventListener('click',()=>{ localStorage.removeItem('currentUser'); location.href='index.html'; });

  // IO
  qs('#btn-io-scan')?.addEventListener('click',startIoScan);
  qs('#btn-io-stop')?.addEventListener('click',stopIoScan);
  qs('#btn-io-lookup')?.addEventListener('click',lookupIo);
  qs('#io-code')?.addEventListener('change',lookupIo);
  qs('#form-io')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const body={ userId:state.currentUser.id, code:qs('#io-code').value.trim(), qty:Number(qs('#io-qty').value||0), unit:qs('#io-unit').value, type:qs('#io-type').value };
    if(!body.code || !body.qty){ alert('コード/数量は必須'); return; }
    try{ await api('log',{method:'POST',body,loadingText:'登録中…'}); alert('登録しました'); await loadAll(); showView('view-history','履歴'); fillIoForm({code:'',name:'',price:'',stock:''}); qs('#io-qty').value=''; }
    catch(err){ alert('登録失敗: '+(err?.message||err)); }
  });

  // Stocktake
  qs('#btn-start-scan')?.addEventListener('click',startScanner);
  qs('#btn-stop-scan')?.addEventListener('click',stopScanner);
  qs('#st-add')?.addEventListener('click',e=>{ e.preventDefault(); const code=qs('#st-code').value.trim(); const real=Number(qs('#st-qty').value||0); if(!code) return; const it=state.items.find(x=>String(x.code)===String(code)); pushStocktake(code,it?.name||'',Number(it?.stock||0),real); });
  qs('#st-export')?.addEventListener('click',()=>{ loading(true,'CSVを生成中…'); try{ const head='code,name,book,real,diff\n'; const lines=state.stocktakeRows.map(r=>[r.code,r.name,r.book,r.real,r.diff].join(',')).join('\n'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='stocktake.csv'; a.click(); }finally{ loading(false); } });

  // Items exports & print-all
  qs('#btn-items-export')?.addEventListener('click',()=>{ loading(true,'CSVを生成中…'); try{ const head='code,name,price,stock,min,location,lotUnit,lotQty\n'; const lines=state.items.map(r=>[r.code,r.name,r.price,r.stock,r.min,r.location||'',r.lotUnit||'',r.lotQty||0].join(',')).join('\n'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='items.csv'; a.click(); }finally{ loading(false); } });
  qs('#btn-items-xlsx')?.addEventListener('click',()=>{ loading(true,'Excelを生成中…'); try{ const data=state.items.map(r=>({code:r.code,name:r.name,price:r.price,stock:r.stock,min:r.min,location:r.location,lotUnit:r.lotUnit,lotQty:r.lotQty})); const ws=XLSX.utils.json_to_sheet(data); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Items'); XLSX.writeFile(wb,'items.xlsx'); }finally{ loading(false); } });

  // PRINT ALL LABELS – fixed try/catch
  qs('#btn-items-print-all')?.addEventListener('click', async ()=>{
    if(!state.items.length) return;
    loading(true,'ラベルを準備中…');
    let w;
    try{
      w = window.open('','printlabels');
      const htmlHead = `
        <html><head><title>Labels</title>
        <style>
          @page{size:A4;margin:12mm}
          body{font-family:sans-serif}
          .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10mm}
          img{width:100%;page-break-inside:avoid;}
        </style></head><body><div class="grid">`;
      const htmlTail = `</div></body></html>`;

      w.document.write(htmlHead);
      for(const it of state.items){
        const du = await makeItemLabelDataURL(it);
        w.document.write(`<div><img src="${du}" /></div>`);
      }
      w.document.write(htmlTail);
      w.document.close(); w.focus(); w.print();
    }catch(err){
      alert('印刷の準備に失敗しました: '+(err?.message||err));
    }finally{
      loading(false);
    }
  });

  // Modals (jika ada di HTML)
  const modalItem=document.getElementById('dlg-new-item')?new bootstrap.Modal('#dlg-new-item'):null;
  qs('#btn-open-new-item')?.addEventListener('click',()=>{ qs('#i-code').value=nextItemCode(); qs('#i-name').value=''; qs('#i-price').value=0; qs('#i-stock').value=0; qs('#i-min').value=0; qs('#i-img').value=''; qs('#i-location').value=''; qs('#i-lotUnit').value='pcs'; qs('#i-lotQty').value=0; modalItem?.show(); });
  qs('#form-item')?.addEventListener('submit',async e=>{ e.preventDefault(); const body={ code:qs('#i-code').value.trim(), name:qs('#i-name').value.trim(), price:Number(qs('#i-price').value||0), stock:Number(qs('#i-stock').value||0), min:Number(qs('#i-min').value||0), img:qs('#i-img').value.trim(), location:qs('#i-location').value.trim(), lotUnit:qs('#i-lotUnit').value.trim()||'pcs', lotQty:Number(qs('#i-lotQty').value||0), overwrite:false }; if(!body.code||!body.name){ alert('コード/名称は必須'); return; } try{ await api('addItem',{method:'POST',body,loadingText:'登録中…'}); modalItem?.hide(); await loadAll(); showView('view-items','商品一覧'); }catch(err){ alert(err.message); } });

  const modalEditItem=document.getElementById('dlg-edit-item')?new bootstrap.Modal('#dlg-edit-item'):null;
  qs('#form-edit-item')?.addEventListener('submit',async e=>{ e.preventDefault(); const body={ code:qs('#e-code').value.trim(), name:qs('#e-name').value.trim(), price:Number(qs('#e-price').value||0), stock:Number(qs('#e-stock').value||0), min:Number(qs('#e-min').value||0), img:qs('#e-img').value.trim(), location:qs('#e-location').value.trim(), lotUnit:qs('#e-lotUnit').value.trim(), lotQty:Number(qs('#e-lotQty').value||0), overwrite:true }; try{ await api('updateItem',{method:'POST',body,loadingText:'保存中…'}); modalEditItem?.hide(); await loadAll(); }catch(err){ alert(err.message||err); } });

  const modalUser=document.getElementById('dlg-new-user')?new bootstrap.Modal('#dlg-new-user'):null;
  qs('#btn-open-new-user')?.addEventListener('click',()=>modalUser?.show());
  qs('#form-user')?.addEventListener('submit',async e=>{ e.preventDefault(); const body={ name:qs('#u-name').value.trim(), id:qs('#u-id').value.trim(), role:qs('#u-role').value, pin:qs('#u-pin').value.trim() }; try{ await api('addUser',{method:'POST',body,loadingText:'登録中…'}); modalUser?.hide(); await loadAll(); showView('view-users','ユーザー / QR'); }catch(err){ alert(err.message); } });

  // Init
  showView('view-dashboard','ダッシュボード');
  await loadAll();

  // Info jika qrlib belum siap (akan fallback CDN)
  if(typeof QRCode==='undefined'){
    console.warn('qrlib.js belum ter-load. Aplikasi akan mencoba memuat dari CDN otomatis saat dibutuhkan.');
  }
});
