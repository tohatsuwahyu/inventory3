/*************************************************
 * app.compat.js — Inventory Dashboard (no optional chaining, no trailing comma)
 **************************************************/

// === Auth guard
var saved = localStorage.getItem('currentUser');
if (!saved) location.href = 'index.html';

// === Global state
var state = {
  currentUser: JSON.parse(saved),
  items: [], users: [], history: [], monthly: [],
  scanner: null, ioScanner: null, stocktakeRows: [],
  filterText: '',
  currentDetailCode: null
};

// === Safe DOM helpers
function $(sel, root){ return (root || document).querySelector(sel); }
function $all(sel, root){ return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function $on(sel, ev, fn){ var el = $(sel); if (el) el.addEventListener(ev, fn); }
var qs = $; var qsa = $all;

// === small helpers
function fmt(n){ return new Intl.NumberFormat('ja-JP').format(n == null ? 0 : n); }
function isMobile(){ return window.innerWidth < 992; }
function today(){ return new Date(); }
function safeFile(s){ return String(s||'').replace(/[\s\\/:*?"<>|]+/g,'_'); }
function setTitle(t){ var el=$('#page-title'); if(el) el.textContent=t; }

// === Set brand logo (fallback id & url)
(function setBrand(){
  try{
    var candidates = ['#brand-logo', '#logo', '#logoImg'];
    var img = null; for (var i=0;i<candidates.length;i++){ var el=$(candidates[i]); if(el){ img=el; break; } }
    var url = (window.CONFIG && CONFIG.LOGO_URL) || 'logo.png';
    if (img){ img.alt='logo'; img.src = url; }
  }catch(_){}
})();

// === View switching
function showView(id, title){
  $all('main section').forEach(function(sec){
    var on = (sec.id===id);
    if (on) sec.classList.remove('d-none'); else sec.classList.add('d-none');
    if (on) sec.classList.add('active'); else sec.classList.remove('active');
  });
  $all('aside nav a').forEach(function(a){ a.classList.toggle('active', a.getAttribute('data-view')===id); });
  if (title) setTitle(title);
  if (isMobile()) openMenu(false);
}
function updateWho(){
  var u=state.currentUser; var el=$('#who');
  if(el) el.textContent = u.name + '（' + u.id + '｜' + (u.role||'user') + '）';
}

// === mobile drawer
function openMenu(open){
  var sb = $('#sb') || $('.sidebar');
  var bd = $('#sb-backdrop') || $('#backdrop');
  if(open){
    if(sb) sb.classList.add('show','open');
    if(bd) bd.classList.add('show');
    document.body.classList.add('overflow-hidden');
  }else{
    if(sb) sb.classList.remove('show','open');
    if(bd) bd.classList.remove('show');
    document.body.classList.remove('overflow-hidden');
  }
}
['#burger','#btn-menu'].forEach(function(sel){
  var el = $(sel); if (el) el.addEventListener('click', function(e){ e.preventDefault(); openMenu(true); });
});
var _bd = $('#sb-backdrop') || $('#backdrop');
if (_bd) _bd.addEventListener('click', function(){ openMenu(false); });
window.addEventListener('keydown', function(e){ if(e.key==='Escape') openMenu(false); });

// === API
function api(action, opt){
  opt = opt || {};
  var method = opt.method || 'GET';
  var body   = opt.body || null;

  if (!window.CONFIG || !CONFIG.BASE_URL){
    console.error('[API] config.js belum diisi');
    return Promise.reject(new Error('config.js belum diisi (BASE_URL kosong)'));
  }
  var apikey = encodeURIComponent(CONFIG.API_KEY || '');
  var url = CONFIG.BASE_URL + '?action=' + encodeURIComponent(action) + '&apikey=' + apikey + '&_=' + Date.now();

  if (method === 'GET'){
    return fetch(url, { mode:'cors', cache:'no-cache' })
      .then(function(r){ if(!r.ok) throw new Error('['+r.status+'] '+r.statusText); return r.json(); });
  }
  return fetch(url, {
    method:'POST', mode:'cors',
    headers:{ 'Content-Type':'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({}, body||{}, { apikey: CONFIG.API_KEY }))
  }).then(function(r){ if(!r.ok) throw new Error('['+r.status+'] '+r.statusText); return r.json(); });
}
function normArr(resp, key){
  if (Array.isArray(resp)) return resp;
  if (resp && Array.isArray(resp[key])) return resp[key];
  if (resp && resp.data && Array.isArray(resp.data)) return resp.data;
  return [];
}

// === LOAD ALL
function loadAll(){
  return Promise.all([
    api('items').catch(function(){ return []; }),
    api('users').catch(function(){ return []; }),
    api('history').catch(function(){ return []; }),
    api('statsMonthlySeries').catch(function(){ return []; })
  ]).then(function(arr){
    state.items   = normArr(arr[0], 'items');
    state.users   = normArr(arr[1], 'users');
    state.history = normArr(arr[2], 'history');
    state.monthly = normArr(arr[3], 'series');

    renderMetrics();
    renderMonthlyChart();
    renderPieThisMonth();
    renderMovementsThisMonth();
    renderItems(); renderUsers(); renderHistory();

    if (state.currentDetailCode) openItemDetail(state.currentDetailCode);
  }).catch(function(err){
    alert('Gagal ambil data dari backend.\nCek Console dan config.js / GAS.');
    console.error(err);
  });
}

// === charts & dashboard
function parseTs(s){ if(!s) return null; var d = new Date(String(s).replace(' ','T')); return isNaN(+d)?null:d; }

function renderMetrics(){
  var el1=$('#metric-total-items'); if(el1) el1.textContent = fmt(state.items.length);
  var el2=$('#metric-low-stock');  if(el2) el2.textContent  = fmt(state.items.filter(function(i){ return Number(i.stock||0)<=Number(i.min||0); }).length);
  var el3=$('#metric-users');      if(el3) el3.textContent  = fmt(state.users.length);
  var now = today();
  var cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
  var last30 = state.history.filter(function(h){ var d=parseTs(h.timestamp); return d && d >= cutoff; });
  var el4=$('#metric-txn'); if(el4) el4.textContent = fmt(last30.length);
}

var monthlyChart;
function renderMonthlyChart(){
  var el = $('#chart-monthly'); if(!el) return;
  if (monthlyChart && typeof monthlyChart.destroy==='function') monthlyChart.destroy();
  monthlyChart = new Chart(el, {
    type:'bar',
    data:{
      labels: state.monthly.map(function(m){ return m.month; }),
      datasets:[
        {label:'IN',  data: state.monthly.map(function(m){ return m.in||0; })},
        {label:'OUT', data: state.monthly.map(function(m){ return m.out||0; })}
      ]
    },
    options:{ responsive:true, scales:{ y:{ beginAtZero:true } }, plugins:{ legend:{ display:true } } }
  });
}

var pieChart;
function renderPieThisMonth(){
  var el = $('#chart-pie'); if(!el) return;
  if (pieChart && typeof pieChart.destroy==='function') pieChart.destroy();
  var now = today();
  var ym   = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  var IN=0, OUT=0;
  state.history.forEach(function(h){
    var d = parseTs(h.timestamp); if(!d) return;
    var key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    if(key!==ym) return;
    var qty = Number(h.qty||0);
    if(String(h.type)==='IN') IN += qty; else OUT += qty;
  });
  pieChart = new Chart(el, {
    type:'pie',
    data:{ labels:['IN','OUT'], datasets:[{ data:[IN, OUT] }] },
    options:{ responsive:true, plugins:{ legend:{ position:'bottom' } } }
  });
}

function renderMovementsThisMonth(){
  var tb = $('#tbl-mov'); if(!tb) return;
  tb.innerHTML = '';
  var now = today();
  var ym   = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  var byCode = new Map();
  state.history.forEach(function(h){
    var d = parseTs(h.timestamp); if(!d) return;
    var key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    if(key!==ym) return;
    var code = String(h.code||'');
    var item = byCode.get(code) || { code:code, name:'', IN:0, OUT:0 };
    var it = state.items.find(function(x){ return String(x.code)===code; });
    item.name = it && it.name ? it.name : item.name;
    var qty = Number(h.qty||0);
    if(String(h.type)==='IN') item.IN += qty; else item.OUT += qty;
    byCode.set(code, item);
  });
  var rows = Array.from(byCode.values()).sort(function(a,b){ return (b.IN + b.OUT) - (a.IN + a.OUT); });
  rows.forEach(function(r){
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>'+r.code+'</td><td>'+r.name+'</td>'
      + '<td class="text-end">'+fmt(r.IN)+'</td>'
      + '<td class="text-end">'+fmt(r.OUT)+'</td>'
      + '<td class="text-end">'+fmt(r.IN - r.OUT)+'</td>';
    tb.appendChild(tr);
  });
  var btn = $('#btn-export-mov');
  if (btn && !btn._wired){
    btn._wired = true;
    btn.addEventListener('click', function(){
      var head='code,name,IN,OUT,NET\n';
      var lines = rows.map(function(r){ return [r.code, r.name, r.IN, r.OUT, r.IN - r.OUT].join(','); }).join('\n');
      var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='movements_this_month.csv'; a.click();
    });
  }
}

/* === QR text === */
function itemQrText(code){ return 'ITEM|' + String(code||''); }
function userQrText(id){ return 'USER|' + String(id||''); }

/* === 商品一覧 (filter, 置場, action) === */
function renderItems(){
  var tb = $('#tbl-items'); if(!tb) return;
  tb.innerHTML = '';
  var term = String(state.filterText||'').trim().toLowerCase();
  var rows = state.items.filter(function(i){ return !term || String(i.name||'').toLowerCase().indexOf(term) >= 0; });

  rows.forEach(function(i){
    var codeStr = String(i.code||'');
    var hid = 'qr-' + codeStr.replace(/[^\w\-:.]/g,'_');
    var tr = document.createElement('tr');
    tr.setAttribute('data-code', codeStr);
    tr.innerHTML =
      '<td class="qr-cell"><div class="qrbox"><div id="'+hid+'"></div><div class="caption">'+(i.name||'')+'（'+codeStr+'）</div></div></td>'
      + '<td>'+codeStr+'</td>'
      + '<td>'+(i.name||'')+'</td>'
      + '<td>'+(i.location||'')+'</td>'
      + '<td>'+(i.img ? ('<img class="thumb" src="'+i.img+'" alt="">') : '')+'</td>'
      + '<td class="text-end">¥'+fmt(i.price||0)+'</td>'
      + '<td class="text-end">'+fmt(i.stock||0)+'</td>'
      + '<td class="text-end">'+fmt(i.min||0)+'</td>'
      + '<td class="text-end"><div class="btn-group btn-group-sm">'
      +   '<button class="btn btn-outline-secondary" data-act="detail"><i class="bi bi-search"></i></button>'
      +   '<button class="btn btn-outline-primary" data-act="edit"><i class="bi bi-pencil"></i></button>'
      +   '<button class="btn btn-outline-danger" data-act="del"><i class="bi bi-trash"></i></button>'
      +   '<button class="btn btn-outline-secondary" data-act="dl" data-code="'+hid+'"><i class="bi bi-download"></i></button>'
      + '</div></td>';
    tb.appendChild(tr);

    var holder = document.getElementById(hid);
    if (holder && typeof QRCode !== 'undefined') {
      new QRCode(holder, { text: itemQrText(codeStr), width:84, height:84, correctLevel: QRCode.CorrectLevel.M });
    }
  });

  // Klik baris → detail
  $all('tbody#tbl-items tr', tb).forEach(function(tr){
    tr.addEventListener('click', function(e){
      if (e.target.closest && e.target.closest('button')) return;
      var code = tr.getAttribute('data-code');
      openItemDetail(code);
    });
  });

  // Actions
  $all('button[data-act="dl"]', tb).forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      var tr = btn.closest('tr');
      var code = tr && tr.children[1] ? tr.children[1].textContent.trim() : '';
      var name = tr && tr.children[2] ? tr.children[2].textContent.trim() : '';
      var hid = btn.getAttribute('data-code');
      var holder = document.getElementById(hid);
      var canvas = holder ? holder.querySelector('canvas') : null;
      var img    = holder ? holder.querySelector('img') : null;
      var dataUrl = (canvas && canvas.toDataURL) ? canvas.toDataURL('image/png') : (img ? img.src : '');
      if(!dataUrl) return;
      var a=document.createElement('a'); a.href=dataUrl; a.download='QR_'+safeFile(code)+'_'+safeFile(name)+'.png'; a.click();
    });
  });
  $all('button[data-act="detail"]', tb).forEach(function(b){
    b.addEventListener('click', function(e){ e.stopPropagation(); openItemDetail(b.closest('tr').getAttribute('data-code')); });
  });
  $all('button[data-act="edit"]', tb).forEach(function(b){
    b.addEventListener('click', function(e){ e.stopPropagation(); openEditItem(b.closest('tr').getAttribute('data-code')); });
  });
  $all('button[data-act="del"]', tb).forEach(function(b){
    b.addEventListener('click', function(e){
      e.stopPropagation();
      var code = b.closest('tr').getAttribute('data-code');
      if (!confirm('Delete item '+code+'?')) return;
      api('deleteItem',{method:'POST',body:{code:code}})
        .then(function(r){ if(r && r.ok){ return loadAll().then(function(){ alert('Deleted'); }); } else { alert((r&&r.error)||'failed'); } })
        .catch(function(err){ alert(err && err.message || err); });
    });
  });
}

/* === Item Detail View === */
function openItemDetail(code){
  state.currentDetailCode = code;
  var item = state.items.find(function(i){ return String(i.code)===String(code); });
  if(!item){ alert('Item not found'); return; }
  showView('view-item-detail', '商品詳細');
  $('#det-code').textContent  = item.code||'';
  $('#det-name').textContent  = item.name||'';
  $('#det-loc').textContent   = item.location||'';
  $('#det-price').textContent = '¥'+fmt(item.price||0);
  $('#det-stock').textContent = fmt(item.stock||0);
  $('#det-min').textContent   = fmt(item.min||0);
  $('#det-lot').textContent   = item.lotSize? fmt(item.lotSize):'-';
  $('#det-bar').textContent   = item.barcode||'-';
  var img = $('#det-img'); if(img){ img.src = item.img||''; if(item.img){ img.classList.remove('d-none'); } else { img.classList.add('d-none'); } }

  // history by code
  var tb = $('#tbl-item-history'); tb.innerHTML='';
  var rows = state.history.filter(function(h){ return String(h.code)===String(code); }).slice().reverse();
  rows.forEach(function(h){
    var tr=document.createElement('tr');
    tr.innerHTML = '<td>'+(h.timestamp||'')+'</td><td>'+(h.userId||'')+'</td>'
      + '<td class="text-end">'+fmt(h.qty||0)+'</td><td>'+(h.unit||'')+'</td><td>'+(h.type||'')+'</td>'
      + '<td class="text-end"><button class="btn btn-sm btn-outline-primary" data-row="'+(h.rowNumber||'')+'"><i class="bi bi-pencil"></i></button></td>';
    tb.appendChild(tr);
  });
  $all('button', tb).forEach(function(btn){ btn.addEventListener('click', function(){ openEditHistory(btn.getAttribute('data-row')); }); });

  // export
  var detBtn = $('#btn-det-export');
  if (detBtn && !detBtn._wired){
    detBtn._wired = true;
    detBtn.addEventListener('click', function(){
      var head='timestamp,userId,code,qty,unit,type\n';
      var lines = rows.map(function(r){ return [r.timestamp,r.userId,r.code,r.qty,r.unit,r.type].join(','); }).join('\n');
      var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='history_'+safeFile(code)+'.csv'; a.click();
    });
  }
}

/* === Edit Item (reuse modal 新規) === */
function openEditItem(code){
  var it = state.items.find(function(i){ return String(i.code)===String(code); }); if(!it) return;
  var modal = new bootstrap.Modal('#dlg-new-item');
  $('#i-code').value  = it.code||'';
  $('#i-name').value  = it.name||'';
  $('#i-price').value = it.price||0;
  $('#i-stock').value = it.stock||0;
  $('#i-min').value   = it.min||0;
  $('#i-img').value   = it.img||'';
  $('#i-location').value = it.location||'';
  $('#i-lot').value      = it.lotSize||0;
  $('#i-barcode').value  = it.barcode||'';
  $('#i-overwrite-flag').value = '1';
  modal.show();
}

/* === Users / QR === */
function renderUsers(){
  var isAdmin = (state.currentUser.role === 'admin');
  var btnAdd = $('#btn-open-new-user'); if(btnAdd){ if(isAdmin) btnAdd.classList.remove('d-none'); else btnAdd.classList.add('d-none'); }
  var btnPrint = $('#btn-print-qr-users'); if(btnPrint){ if(isAdmin) btnPrint.classList.remove('d-none'); else btnPrint.classList.add('d-none'); }

  var tb = $('#tbl-userqr'); if(!tb) return;
  tb.innerHTML = '';
  var grid = $('#print-qr-users-grid'); if (grid) grid.innerHTML = '';

  var list = isAdmin ? state.users : state.users.filter(function(u){ return String(u.id) === String(state.currentUser.id); });

  list.forEach(function(u){
    var idStr = String(u.id||'');
    var holderId = 'uqr-' + idStr.replace(/[^\w\-:.]/g,'_');
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="qr-cell"><div class="qrbox"><div id="'+holderId+'"></div><div class="caption">'+(u.name||'')+'（'+(u.id||'')+'）</div></div></td>'
      + '<td>'+(u.id||'')+'</td><td>'+(u.name||'')+'</td><td>'+(u.role||'user')+'</td>'
      + '<td class="text-end"><button class="btn btn-sm btn-outline-secondary" data-act="dl" data-id="'+holderId+'" data-uid="'+idStr+'" data-name="'+safeFile(u.name||'')+'"><i class="bi bi-download"></i></button></td>';
    tb.appendChild(tr);

    var div = document.getElementById(holderId);
    if (div && typeof QRCode !== 'undefined') {
      new QRCode(div, { text: userQrText(idStr), width:84, height:84, correctLevel: QRCode.CorrectLevel.M });
    }

    if (grid){
      var card=document.createElement('div'); card.className='qr-card';
      var v=document.createElement('div'); v.id='p-'+holderId;
      var title=document.createElement('div'); title.className='title'; title.textContent=(u.name||'')+'（'+(u.id||'')+'｜'+(u.role||'user')+'）';
      card.appendChild(v); card.appendChild(title); grid.appendChild(card);
      if (typeof QRCode !== 'undefined') {
        new QRCode(v,{ text: userQrText(idStr), width:110, height:110, correctLevel:QRCode.CorrectLevel.M });
      }
    }
  });

  $all('button[data-act="dl"]', tb).forEach(function(btn){
    btn.addEventListener('click', function(){
      var hid = btn.getAttribute('data-id');
      var holder = document.getElementById(hid);
      var canvas = holder ? holder.querySelector('canvas') : null;
      var img    = holder ? holder.querySelector('img') : null;
      var dataUrl = (canvas && canvas.toDataURL) ? canvas.toDataURL('image/png') : (img ? img.src : '');
      if(!dataUrl) return;
      var code = btn.getAttribute('data-uid') || 'USER';
      var name = btn.getAttribute('data-name') || '';
      var a=document.createElement('a'); a.href=dataUrl; a.download='USER_'+safeFile(code)+'_'+safeFile(name)+'.png'; a.click();
    });
  });
}

/* === 履歴 === */
function renderHistory(){
  var tb=$('#tbl-history'); if(!tb) return; tb.innerHTML='';
  state.history.slice(-300).reverse().forEach(function(h){
    var tr=document.createElement('tr');
    tr.innerHTML='<td>'+(h.timestamp||'')+'</td><td>'+(h.userId||'')+'</td><td>'+(h.code||'')+'</td>'
      + '<td class="text-end">'+fmt(h.qty||0)+'</td><td>'+(h.unit||'')+'</td><td>'+(h.type||'')+'</td>'
      + '<td class="text-end"><button class="btn btn-sm btn-outline-primary" data-row="'+(h.rowNumber||'')+'"><i class="bi bi-pencil"></i></button></td>';
    tb.appendChild(tr);
  });
  $all('button', tb).forEach(function(btn){ btn.addEventListener('click', function(){ openEditHistory(btn.getAttribute('data-row')); }); });
}

/* === IO & Stocktake === */
function startBackCameraScan(mountId, onScan, boxSize){
  boxSize = boxSize || 300;
  var cfg = { fps:10, qrbox:{ width:boxSize, height:boxSize } };
  var scanner = new Html5Qrcode(mountId);
  return scanner.start({ facingMode:'environment' }, cfg, onScan)
    .then(function(){ return scanner; })
    .catch(function(){
      return Html5Qrcode.getCameras().then(function(cams){
        if(!cams || !cams.length) throw new Error('カメラが見つかりません');
        var back = cams.find(function(c){ return /back|rear|environment/i.test(c.label); }) || cams[cams.length-1] || cams[0];
        return scanner.start({ deviceId:{ exact: back.id } }, cfg, onScan).then(function(){ return scanner; });
      });
    });
}
function fillIoForm(it){
  $('#io-code').value  = it.code||''; $('#io-name').value  = it.name||'';
  $('#io-price').value = it.price||''; $('#io-stock').value = it.stock||'';
}
function startIoScan(){ 
  startBackCameraScan('io-scan-area', onScanIo
