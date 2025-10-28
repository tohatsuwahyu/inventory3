/*************************************************
 * app.js — Inventory Dashboard (pro upgrade)
 **************************************************/

// === Auth guard
const saved = localStorage.getItem('currentUser');
if (!saved) location.href = 'index.html';

const state = {
  currentUser: JSON.parse(saved),
  items: [], users: [], history: [], monthly: [],
  scanner: null, ioScanner: null, stocktakeRows: [],
  filterText: '',
  currentDetailCode: null
};

// === tiny helpers
const qs  = (s, el=document)=>el.querySelector(s);
const qsa = (s, el=document)=>[...el.querySelectorAll(s)];
const fmt = (n)=>new Intl.NumberFormat('ja-JP').format(n ?? 0);
const isMobile = ()=> window.innerWidth < 992;
const today = ()=> new Date();
const safeFile = (s)=> String(s||'').replace(/[\s\\/:*?"<>|]+/g,'_');
function setTitle(t){ const el=qs('#page-title'); if(el) el.textContent=t; }

// brand logo
(function setBrand(){ try{
  const url = (window.CONFIG && CONFIG.LOGO_URL) || './assets/tsh.png';
  const img = qs('#brand-logo'); if(img) img.src = url;
}catch(_){}})();

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
['#burger','#btn-menu'].forEach(id=>{
  qs(id)?.addEventListener('click', (e)=>{ e.preventDefault(); openMenu(true); });
});
(qs('#sb-backdrop')||qs('#backdrop'))?.addEventListener('click', ()=>openMenu(false));
window.addEventListener('keydown', e=>{ if(e.key==='Escape') openMenu(false); });

// === API
async function api(action, {method='GET', body}={}){
  if(!window.CONFIG || !CONFIG.BASE_URL){
    console.error('[API] config.js belum diisi');
    throw new Error('config.js belum diisi (BASE_URL kosong)');
  }
  const apikey = encodeURIComponent(CONFIG.API_KEY||'');
  const url = `${CONFIG.BASE_URL}?action=${encodeURIComponent(action)}&apikey=${apikey}&_=${Date.now()}`;

  try{
    if(method==='GET'){
      const r = await fetch(url, { mode:'cors', cache:'no-cache' });
      if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
      return await r.json();
    }
    const r = await fetch(url, {
      method:'POST',
      mode:'cors',
      headers:{ 'Content-Type':'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...(body||{}), apikey: CONFIG.API_KEY })
    });
    if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
    return await r.json();
  }catch(err){
    console.error(`[API ERROR] ${action}:`, err);
    throw err;
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
  try{
    const [items, users, history, monthly] = await Promise.all([
      api('items').catch(()=>[]),
      api('users').catch(()=>[]),
      api('history').catch(()=>[]),
      api('statsMonthlySeries').catch(()=>[]),
    ]);
    state.items   = normArr(items,   'items');
    state.users   = normArr(users,   'users');
    state.history = normArr(history, 'history');
    state.monthly = normArr(monthly, 'series');

    renderMetrics();
    renderMonthlyChart();
    renderPieThisMonth();
    renderMovementsThisMonth();
    renderItems(); renderUsers(); renderHistory();

    // bila sedang lihat detail item, refresh view-nya
    if (state.currentDetailCode) openItemDetail(state.currentDetailCode);
  }catch(err){
    alert('Gagal ambil data dari backend.\nCek Console dan config.js / GAS.');
  }
}

// === charts & dashboard
function parseTs(s){ if(!s) return null; const d=new Date(s.replace(' ','T')); return isNaN(+d)?null:d; }

function renderMetrics(){
  qs('#metric-total-items').textContent = fmt(state.items.length);
  qs('#metric-low-stock').textContent  = fmt(state.items.filter(i=>Number(i.stock||0)<=Number(i.min||0)).length);
  qs('#metric-users').textContent      = fmt(state.users.length);
  const now = today();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
  const last30 = state.history.filter(h=>{ const d=parseTs(h.timestamp); return d && d >= cutoff; });
  qs('#metric-txn').textContent = fmt(last30.length);
}

let monthlyChart;
function renderMonthlyChart(){
  const el = qs('#chart-monthly'); if(!el) return;
  monthlyChart?.destroy?.();
  monthlyChart = new Chart(el, {
    type:'bar',
    data:{ labels: state.monthly.map(m=>m.month),
      datasets:[
        {label:'IN',  data: state.monthly.map(m=>m.in||0)},
        {label:'OUT', data: state.monthly.map(m=>m.out||0)}
      ]},
    options:{ responsive:true, scales:{ y:{ beginAtZero:true } }, plugins:{ legend:{ display:true } } }
  });
}

let pieChart;
function renderPieThisMonth(){
  const el = qs('#chart-pie'); if(!el) return;
  pieChart?.destroy?.();
  const now = today();
  const ym   = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  let IN=0, OUT=0;
  state.history.forEach(h=>{
    const d = parseTs(h.timestamp); if(!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if(key!==ym) return;
    const qty = Number(h.qty||0);
    if(String(h.type)==='IN') IN += qty; else OUT += qty;
  });
  pieChart = new Chart(el, { type:'pie', data:{ labels:['IN','OUT'], datasets:[{ data:[IN, OUT] }] },
    options:{ responsive:true, plugins:{ legend:{ position:'bottom' } } } );
}

function renderMovementsThisMonth(){
  const tb = qs('#tbl-mov'); if(!tb) return;
  tb.innerHTML = '';
  const now = today();
  const ym   = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const byCode = new Map();
  state.history.forEach(h=>{
    const d = parseTs(h.timestamp); if(!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if(key!==ym) return;
    const code = String(h.code||'');
    const item = byCode.get(code) || { code, name:'', IN:0, OUT:0 };
    const it = state.items.find(x=>String(x.code)===code);
    item.name = it?.name || item.name;
    const qty = Number(h.qty||0);
    if(String(h.type)==='IN') item.IN += qty; else item.OUT += qty;
    byCode.set(code, item);
  });
  const rows = [...byCode.values()].sort((a,b)=> (b.IN + b.OUT) - (a.IN + a.OUT));
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.code}</td><td>${r.name}</td>
      <td class="text-end">${fmt(r.IN)}</td><td class="text-end">${fmt(r.OUT)}</td><td class="text-end">${fmt(r.IN - r.OUT)}</td>`;
    tb.appendChild(tr);
  });
  qs('#btn-export-mov')?.addEventListener('click', ()=>{
    const head='code,name,IN,OUT,NET\n';
    const lines = rows.map(r=>[r.code, r.name, r.IN, r.OUT, r.IN - r.OUT].join(',')).join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='movements_this_month.csv'; a.click();
  }, { once:true });
}

/* === QR text === */
const itemQrText = (code)=>`ITEM|${String(code||'')}`;
const userQrText = (id)=>`USER|${String(id||'')}`;

/* === 商品一覧 (dengan filter, 置場, action) === */
function renderItems(){
  const tb = qs('#tbl-items'); if(!tb) return;
  tb.innerHTML = '';
  const term = state.filterText.trim().toLowerCase();
  const rows = state.items.filter(i=> !term || String(i.name||'').toLowerCase().includes(term) );

  rows.forEach(i=>{
    const codeStr = String(i.code||'');
    const hid = `qr-${codeStr.replace(/[^\w\-:.]/g,'_')}`;
    const tr = document.createElement('tr');
    tr.setAttribute('data-code', codeStr);
    tr.innerHTML = `
      <td class="qr-cell">
        <div class="qrbox"><div id="${hid}"></div><div class="caption">${i.name||''}（${codeStr}）</div></div>
      </td>
      <td>${codeStr}</td>
      <td>${i.name||''}</td>
      <td>${i.location||''}</td>
      <td>${i.img ? `<img class="thumb" src="${i.img}" alt="">` : ''}</td>
      <td class="text-end">¥${fmt(i.price||0)}</td>
      <td class="text-end">${fmt(i.stock||0)}</td>
      <td class="text-end">${fmt(i.min||0)}</td>
      <td class="text-end">
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-secondary" data-act="detail"><i class="bi bi-search"></i></button>
          <button class="btn btn-outline-primary" data-act="edit"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-outline-danger" data-act="del"><i class="bi bi-trash"></i></button>
          <button class="btn btn-outline-secondary" data-act="dl" data-code="${hid}"><i class="bi bi-download"></i></button>
        </div>
      </td>`;
    tb.appendChild(tr);

    const holder = document.getElementById(hid);
    if (holder && typeof QRCode !== 'undefined') {
      new QRCode(holder, { text: itemQrText(codeStr), width:84, height:84, correctLevel: QRCode.CorrectLevel.M });
    }
  });

  // Klik baris → detail
  tb.querySelectorAll('tr').forEach(tr=>{
    tr.addEventListener('click', (e)=>{
      if (e.target.closest('button')) return; // biarkan tombol bekerja
      const code = tr.getAttribute('data-code');
      openItemDetail(code);
    });
  });

  // Actions
  tb.querySelectorAll('button[data-act="dl"]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const tr = btn.closest('tr');
      const code = tr?.children?.[1]?.textContent?.trim() || '';
      const name = tr?.children?.[2]?.textContent?.trim() || '';
      const hid = btn.getAttribute('data-code');
      const holder = document.getElementById(hid);
      const canvas = holder?.querySelector('canvas');
      const img    = holder?.querySelector('img');
      const dataUrl = canvas?.toDataURL?.('image/png') || img?.src || '';
      if(!dataUrl) return;
      const a=document.createElement('a'); a.href=dataUrl; a.download=`QR_${safeFile(code)}_${safeFile(name)}.png`; a.click();
    });
  });
  tb.querySelectorAll('button[data-act="detail"]').forEach(b=>b.addEventListener('click', (e)=>{
    e.stopPropagation(); openItemDetail(b.closest('tr').getAttribute('data-code'));
  }));
  tb.querySelectorAll('button[data-act="edit"]').forEach(b=>b.addEventListener('click', (e)=>{
    e.stopPropagation(); openEditItem(b.closest('tr').getAttribute('data-code'));
  }));
  tb.querySelectorAll('button[data-act="del"]').forEach(b=>b.addEventListener('click', async (e)=>{
    e.stopPropagation();
    const code = b.closest('tr').getAttribute('data-code');
    if (!confirm(`Delete item ${code}?`)) return;
    try{ const r=await api('deleteItem',{method:'POST',body:{code}}); if(r?.ok) { await loadAll(); alert('Deleted'); } else alert(r?.error||'failed'); }
    catch(err){ alert(err?.message||err); }
  }));
}

/* === Item Detail View === */
function openItemDetail(code){
  state.currentDetailCode = code;
  const item = state.items.find(i=>String(i.code)===String(code));
  if(!item){ alert('Item not found'); return; }
  showView('view-item-detail', '商品詳細');
  qs('#det-code').textContent = item.code||'';
  qs('#det-name').textContent = item.name||'';
  qs('#det-loc').textContent  = item.location||'';
  qs('#det-price').textContent= '¥'+fmt(item.price||0);
  qs('#det-stock').textContent= fmt(item.stock||0);
  qs('#det-min').textContent  = fmt(item.min||0);
  qs('#det-lot').textContent  = item.lotSize? fmt(item.lotSize):'-';
  qs('#det-bar').textContent  = item.barcode||'-';
  const img = qs('#det-img'); img.src = item.img||''; img.classList.toggle('d-none', !item.img);

  // render history by code
  const tb = qs('#tbl-item-history'); tb.innerHTML='';
  const rows = state.history.filter(h=>String(h.code)===String(code)).slice().reverse();
  rows.forEach(h=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${h.timestamp||''}</td><td>${h.userId||''}</td><td class="text-end">${fmt(h.qty||0)}</td><td>${h.unit||''}</td><td>${h.type||''}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-primary" data-row="${h.rowNumber||''}"><i class="bi bi-pencil"></i></button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll('button').forEach(btn=>btn.addEventListener('click', ()=>openEditHistory(btn.getAttribute('data-row'))));

  // export
  qs('#btn-det-export')?.addEventListener('click', ()=>{
    const head='timestamp,userId,code,qty,unit,type\n';
    const lines = rows.map(r=>[r.timestamp,r.userId,r.code,r.qty,r.unit,r.type].join(',')).join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download=`history_${safeFile(code)}.csv`; a.click();
  }, { once:true });
}

/* === Edit Item (reuse modal 新規) === */
function openEditItem(code){
  const it = state.items.find(i=>String(i.code)===String(code)); if(!it) return;
  const modal = new bootstrap.Modal('#dlg-new-item');
  qs('#i-code').value  = it.code||'';
  qs('#i-name').value  = it.name||'';
  qs('#i-price').value = it.price||0;
  qs('#i-stock').value = it.stock||0;
  qs('#i-min').value   = it.min||0;
  qs('#i-img').value   = it.img||'';
  qs('#i-location').value = it.location||'';
  qs('#i-lot').value      = it.lotSize||0;
  qs('#i-barcode').value  = it.barcode||'';
  qs('#i-overwrite-flag').value = '1';
  modal.show();
}

/* === Users / QR (unchanged except admin toggles) === */
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
      <td>${u.id||''}</td>
      <td>${u.name||''}</td>
      <td>${u.role||'user'}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-secondary" data-act="dl" data-id="${holderId}" data-uid="${idStr}" data-name="${safeFile(u.name||'')}"><i class="bi bi-download"></i></button></td>`;
    tb.appendChild(tr);

    const div = document.getElementById(holderId);
    if (div && typeof QRCode !== 'undefined') {
      new QRCode(div, { text: userQrText(idStr), width:84, height:84, correctLevel: QRCode.CorrectLevel.M });
    }

    const card=document.createElement('div'); card.className='qr-card';
    const v=document.createElement('div'); v.id=`p-${holderId}`;
    const title=document.createElement('div'); title.className='title'; title.textContent=`${u.name||''}（${u.id||''}｜${u.role||'user'}）`;
    card.appendChild(v); card.appendChild(title); grid?.appendChild(card);
    if (typeof QRCode !== 'undefined') {
      new QRCode(v,{ text: userQrText(idStr), width:110, height:110, correctLevel:QRCode.CorrectLevel.M });
    }
  });

  tb.querySelectorAll('button[data-act="dl"]').forEach(btn=>{
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

/* === 履歴 (dengan Edit) === */
function renderHistory(){
  const tb=qs('#tbl-history'); if(!tb) return; tb.innerHTML='';
  state.history.slice(-300).reverse().forEach(h=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${h.timestamp||''}</td><td>${h.userId||''}</td><td>${h.code||''}</td>
      <td class="text-end">${fmt(h.qty||0)}</td><td>${h.unit||''}</td><td>${h.type||''}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-primary" data-row="${h.rowNumber||''}"><i class="bi bi-pencil"></i></button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll('button').forEach(btn=>btn.addEventListener('click', ()=>openEditHistory(btn.getAttribute('data-row'))));
}

/* === IO & Stocktake === */
async function startBackCameraScan(mountId, onScan, boxSize=300){
  const cfg = { fps:10, qrbox:{ width:boxSize, height:boxSize } };
  const scanner = new Html5Qrcode(mountId);
  try{ await scanner.start({ facingMode:'environment' }, cfg, onScan); return scanner; }catch(_){}
  const cams = await Html5Qrcode.getCameras();
  if(!cams || !cams.length) throw new Error('カメラが見つかりません');
  const back = cams.find(c=>/back|rear|environment/i.test(c.label)) || cams[cams.length-1] || cams[0];
  await scanner.start({ deviceId:{ exact: back.id } }, cfg, onScan); return scanner;
}
function fillIoForm(it){
  qs('#io-code').value=it.code||''; qs('#io-name').value=it.name||'';
  qs('#io-price').value=it.price||''; qs('#io-stock').value=it.stock||'';
}
async function startIoScan(){ try{ state.ioScanner=await startBackCameraScan('io-scan-area', onScanIo, (isMobile()?240:300)); }catch(e){ alert('カメラが見つかりません: '+(e?.message||e)) } }
async function stopIoScan(){ try{ await state.ioScanner?.stop(); state.ioScanner?.clear(); }catch(_){ } state.ioScanner=null; }
function onScanIo(text){
  try{
    let code='';
    if(text.startsWith('ITEM|')) code=text.split('|')[1]||'';
    else { try{ const o=JSON.parse(text); code=o.code||''; }catch(_){ } }
    if(code){
      const it=state.items.find(x=>String(x.code)===String(code));
      if (it) fillIoForm(it);
      qs('#io-qty')?.focus();
    }
  }catch(_){ }
}
async function startScanner(){ try{ state.scanner=await startBackCameraScan('scan-area', onScanStocktake, (isMobile()?240:300)); }catch(e){ alert('カメラが見つかりません: '+(e?.message||e)) } }
async function stopScanner(){ try{ await state.scanner?.stop(); state.scanner?.clear(); }catch(_){ } state.scanner=null; }
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

/* === EDIT HISTORY modal === */
function openEditHistory(rowNumber){
  const h = state.history.find(x=>String(x.rowNumber)===String(rowNumber));
  if(!h){ alert('History not found'); return; }
  const m = new bootstrap.Modal('#dlg-edit-history');
  qs('#eh-row').value = h.rowNumber||'';
  qs('#eh-code').value= h.code||'';
  qs('#eh-qty').value = h.qty||0;
  qs('#eh-unit').value= h.unit||'pcs';
  qs('#eh-type').value= h.type||'IN';
  m.show();
}
async function submitEditHistory(e){
  e.preventDefault();
  const body = {
    rowNumber: Number(qs('#eh-row').value),
    code     : qs('#eh-code').value.trim(),
    qty      : Number(qs('#eh-qty').value||0),
    unit     : qs('#eh-unit').value,
    type     : qs('#eh-type').value
  };
  try{
    const r = await api('updateHistory',{method:'POST', body});
    if (r?.ok===false) return alert(r.error||'エラー');
    alert('更新しました'); await loadAll();
    if (state.currentDetailCode) openItemDetail(state.currentDetailCode);
  }catch(err){ alert(err?.message||err); }
}

/* === events === */
window.addEventListener('DOMContentLoaded', async ()=>{
  updateWho();

  // nav
  qsa('aside nav a').forEach(a=>a.addEventListener('click',()=>showView(a.getAttribute('data-view'), a.textContent.trim())));

  // logout
  qs('#btn-logout')?.addEventListener('click',()=>{ localStorage.removeItem('currentUser'); location.href='index.html'; });

  // 入出庫 lookup
  qs('#btn-io-lookup')?.addEventListener('click', async ()=>{
    const code = qs('#io-code').value.trim(); if(!code) return;
    try{
      // prefer backend (single item fresh)
      const r = await api('itemByCode',{method:'POST', body:{ code }});
      if (r?.ok && r.item) fillIoForm(r.item);
      else {
        const it = state.items.find(x=>String(x.code)===String(code));
        if (it) fillIoForm(it); else alert('Item not found');
      }
    }catch(_){
      const it = state.items.find(x=>String(x.code)===String(code));
      if (it) fillIoForm(it); else alert('Item not found');
    }
  });
  qs('#io-code')?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); qs('#btn-io-lookup')?.click(); } });

  // IO form submit
  qs('#form-io')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const body={ userId:state.currentUser.id, code:qs('#io-code').value.trim(), qty:Number(qs('#io-qty').value||0), unit:qs('#io-unit').value, type:qs('#io-type').value };
    if(!body.code || !body.qty){ alert('コード/数量は必須'); return; }
    try{ const r=await api('log',{method:'POST',body}); if(r && r.ok===false) return alert(r.error||'エラー'); alert('登録しました'); await loadAll(); showView('view-history','履歴'); fillIoForm({code:'',name:'',price:'',stock:''}); qs('#io-qty').value=''; }catch(err){ alert('登録失敗: '+(err?.message||err)); }
  });

  // Stocktake
  qs('#btn-start-scan')?.addEventListener('click', startScanner);
  qs('#btn-stop-scan')?.addEventListener('click', stopScanner);
  qs('#st-add')?.addEventListener('click', (e)=>{ e.preventDefault(); const code=qs('#st-code').value.trim(); const real=Number(qs('#st-qty').value||0); if(!code) return; const it=state.items.find(x=>String(x.code)===String(code)); pushStocktake(code, it?.name||'', Number(it?.stock||0), real); });
  qs('#st-export')?.addEventListener('click', ()=>{
    const head='code,name,book,real,diff\n';
    const lines=state.stocktakeRows.map(r=>[r.code,r.name,r.book,r.real,r.diff].join(',')).join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='stocktake.csv'; a.click();
  });

  // 商品一覧: filter
  qs('#items-filter')?.addEventListener('input', (e)=>{ state.filterText = e.target.value; renderItems(); });

  // Items export CSV/XLSX (tetap)
  qs('#btn-items-export')?.addEventListener('click', ()=>{
    const head='code,name,location,price,stock,min,lotSize,barcode\n';
    const lines=state.items.map(r=>[r.code,r.name,r.location||'',r.price,r.stock,r.min,r.lotSize||0,r.barcode||''].join(',')).join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='items.csv'; a.click();
  });
  qs('#btn-items-xlsx')?.addEventListener('click', ()=>{
    const data = state.items.map(r=>({ code:r.code, name:r.name, location:r.location||'', price:r.price, stock:r.stock, min:r.min, lotSize:r.lotSize||0, barcode:r.barcode||'' }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Items'); XLSX.writeFile(wb, 'items.xlsx');
  }, { once:true });

  // Modal 新規 / update
  const modalItemEl = document.getElementById('dlg-new-item');
  const modalItem   = modalItemEl ? new bootstrap.Modal(modalItemEl) : null;
  qs('#btn-open-new-item')?.addEventListener('click', ()=>{
    qs('#i-code').value  = nextItemCode();
    qs('#i-name').value  = '';
    qs('#i-price').value = 0;
    qs('#i-stock').value = 0;
    qs('#i-min').value   = 0;
    qs('#i-img').value   = '';
    qs('#i-location').value = '';
    qs('#i-lot').value      = 0;
    qs('#i-barcode').value  = '';
    qs('#i-overwrite-flag').value = '';
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
      lotSize:Number(qs('#i-lot').value||0),
      barcode:qs('#i-barcode').value.trim(),
      overwrite: !!qs('#i-overwrite-flag').value
    };
    if(!body.code || !body.name){ alert('コード/名称は必須'); return; }
    try{
      const action = body.overwrite ? 'updateItem' : 'addItem';
      const r=await api(action,{method:'POST',body});
      if(r && r.ok===false) throw new Error(r.error||'登録失敗');
      modalItem?.hide(); await loadAll(); showView('view-items','商品一覧');
    }catch(err){ alert(err.message); }
  });
  qs('#btn-item-makeqr')?.addEventListener('click', ()=>{
    const i={ code:qs('#i-code').value.trim(), name:qs('#i-name').value.trim(), price:Number(qs('#i-price').value||0) };
    const tmp=document.createElement('div'); if(typeof QRCode!=='undefined'){ new QRCode(tmp,{ text:itemQrText(i.code), width:240, height:240, correctLevel:QRCode.CorrectLevel.M }); }
    const canvas=tmp.querySelector('canvas'); const dataUrl=canvas?canvas.toDataURL('image/png'):''; const w=window.open('','qrprev','width=420,height=520');
    w.document.write(`<div style="padding:20px;text-align:center;font-family:sans-serif"><img src="${dataUrl}" style="width:240px;height:240px"/><div style="margin-top:8px">${i.name}（${i.code}） ¥${fmt(i.price||0)}</div></div>`); tmp.remove();
  });

  // Modal User (unchanged)
  const modalUserEl = document.getElementById('dlg-new-user');
  const modalUser   = modalUserEl ? new bootstrap.Modal(modalUserEl) : null;
  qs('#btn-open-new-user')?.addEventListener('click', ()=>modalUser?.show());
  qs('#form-user')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const body={ name:qs('#u-name').value.trim(), id:qs('#u-id').value.trim(), role:qs('#u-role').value, pin:qs('#u-pin').value.trim() };
    try{ const r=await api('addUser',{method:'POST',body}); if(r && r.ok===false) throw new Error(r.error||'エラー'); modalUser?.hide(); await loadAll(); showView('view-users','ユーザー / QR'); }catch(err){ alert(err.message); }
  });
  qs('#btn-print-qr-users')?.addEventListener('click', ()=>{ qs('#print-qr-users').classList.remove('d-none'); window.print(); qs('#print-qr-users').classList.add('d-none'); });

  // Edit History submit
  qs('#form-edit-history')?.addEventListener('submit', submitEditHistory);

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
