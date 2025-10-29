/*************************************************
 * app_compat.js — Inventory Dashboard (no optional chaining)
 * Kompatibel untuk GitHub Pages / browser ketat.
 **************************************************/

// ==== Auth guard
var __saved = localStorage.getItem('currentUser');
if (!__saved) location.href = 'index.html';

// ==== State
var state = {
  currentUser: JSON.parse(__saved),
  items: [], users: [], history: [], monthly: [],
  scanner: null, ioScanner: null,
  stocktakeRows: [],
  filterText: '',
  currentDetailCode: null
};

// ==== DOM helpers
function $(sel, root){ return (root || document).querySelector(sel); }
function $all(sel, root){ return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function $on(sel, ev, fn){ var el=$(sel); if(el) el.addEventListener(ev, fn); }

// ==== Utils
function fmt(n){ return new Intl.NumberFormat('ja-JP').format(n==null?0:n); }
function isMobile(){ return window.innerWidth < 992; }
function safeFile(s){ return String(s||'').replace(/[\s\\/:*?"<>|]+/g,'_'); }
function parseTs(s){ if(!s) return null; var d=new Date(String(s).replace(' ','T')); return isNaN(+d)?null:d; }
function today(){ return new Date(); }
function setTitle(t){ var el=$('#page-title'); if(el) el.textContent=t; }

// ==== Logo (fallback id & url)
(function setBrand(){
  try{
    var ids=['#brand-logo','#logo','#logoImg'];
    var img=null; for(var i=0;i<ids.length;i++){ var x=$(ids[i]); if(x){ img=x; break; } }
    if(!img) return;
    var url=(window.CONFIG && CONFIG.LOGO_URL) || 'logo.png';
    if(!url) url='logo.png';
    img.alt='logo'; img.src=url;
  }catch(_){}
})();

// ==== View switcher
function showView(id, title){
  $all('main section').forEach(function(sec){
    var on = (sec.id===id);
    if(on) sec.classList.remove('d-none'); else sec.classList.add('d-none');
  });
  $all('aside nav a').forEach(function(a){
    a.classList.toggle('active', a.getAttribute('data-view')===id);
  });
  if(title) setTitle(title);
  if(isMobile()) openMenu(false);
}
function updateWho(){
  var u=state.currentUser;
  var el=$('#who'); if(el) el.textContent = u.name+'（'+u.id+'｜'+(u.role||'user')+'）';
}

// ==== Drawer (mobile)
function openMenu(open){
  var sb=$('#sb')||$('.sidebar');
  var bd=$('#sb-backdrop')||$('#backdrop');
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
  var el=$(sel); if(el) el.addEventListener('click', function(e){ e.preventDefault(); openMenu(true); });
});
var _bd=$('#sb-backdrop')||$('#backdrop'); if(_bd) _bd.addEventListener('click', function(){ openMenu(false); });
window.addEventListener('keydown', function(e){ if(e.key==='Escape') openMenu(false); });

// ==== API
function api(action, opt){
  opt=opt||{}; var method=opt.method||'GET'; var body=opt.body||null;
  if(!window.CONFIG || !CONFIG.BASE_URL){
    return Promise.reject(new Error('config.js belum diisi (BASE_URL)'));
  }
  var apikey=encodeURIComponent(CONFIG.API_KEY||'');
  var url=CONFIG.BASE_URL+'?action='+encodeURIComponent(action)+'&apikey='+apikey+'&_='+Date.now();

  if(method==='GET'){
    return fetch(url,{mode:'cors',cache:'no-cache'})
      .then(function(r){ if(!r.ok) throw new Error('['+r.status+'] '+r.statusText); return r.json(); });
  }
  return fetch(url,{
    method:'POST', mode:'cors',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify(Object.assign({}, body||{}, {apikey:CONFIG.API_KEY}))
  }).then(function(r){ if(!r.ok) throw new Error('['+r.status+'] '+r.statusText); return r.json(); });
}
function normArr(resp, key){
  if(Array.isArray(resp)) return resp;
  if(resp && Array.isArray(resp[key])) return resp[key];
  if(resp && resp.data && Array.isArray(resp.data)) return resp.data;
  return [];
}

// ==== Load all
function loadAll(){
  return Promise.all([
    api('items').catch(function(){return[]}),
    api('users').catch(function(){return[]}),
    api('history').catch(function(){return[]}),
    api('statsMonthlySeries').catch(function(){return[]})
  ]).then(function(r){
    state.items   = normArr(r[0],'items');
    state.users   = normArr(r[1],'users');
    state.history = normArr(r[2],'history');
    state.monthly = normArr(r[3],'series');

    renderMetrics();
    renderMonthlyChart();
    renderPieThisMonth();
    renderMovementsThisMonth();
    renderItems(); renderUsers(); renderHistory();

    if(state.currentDetailCode) openItemDetail(state.currentDetailCode);
  }).catch(function(err){
    alert('Gagal ambil data backend. Cek config.js/GAS.'); console.error(err);
  });
}

// ==== Dashboard
var monthlyChart, pieChart;

function renderMetrics(){
  var el1=$('#metric-total-items'); if(el1) el1.textContent = fmt(state.items.length);
  var el2=$('#metric-low-stock');  if(el2) el2.textContent  = fmt(state.items.filter(function(i){return Number(i.stock||0)<=Number(i.min||0)}).length);
  var el3=$('#metric-users');      if(el3) el3.textContent  = fmt(state.users.length);

  var now=today(), cutoff=new Date(now.getFullYear(),now.getMonth(),now.getDate()-30);
  var last30=state.history.filter(function(h){ var d=parseTs(h.timestamp); return d && d>=cutoff; });
  var el4=$('#metric-txn'); if(el4) el4.textContent = fmt(last30.length);
}

function renderMonthlyChart(){
  var el=$('#chart-monthly'); if(!el) return;
  if(monthlyChart && typeof monthlyChart.destroy==='function') monthlyChart.destroy();
  var labs=state.monthly.map(function(m){return m.month});
  var din = state.monthly.map(function(m){return m.in||0});
  var dout= state.monthly.map(function(m){return m.out||0});
  monthlyChart = new Chart(el,{ type:'bar',
    data:{ labels:labs, datasets:[{label:'IN',data:din},{label:'OUT',data:dout}] },
    options:{ responsive:true, scales:{y:{beginAtZero:true}}, plugins:{legend:{display:true}} }
  });
}

function renderPieThisMonth(){
  var el=$('#chart-pie'); if(!el) return;
  if(pieChart && typeof pieChart.destroy==='function') pieChart.destroy();
  var now=today(); var ym=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  var IN=0, OUT=0;
  state.history.forEach(function(h){
    var d=parseTs(h.timestamp); if(!d) return;
    var key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    if(key!==ym) return;
    var q=Number(h.qty||0); if(String(h.type)==='IN') IN+=q; else OUT+=q;
  });
  pieChart=new Chart(el,{type:'pie',data:{labels:['IN','OUT'],datasets:[{data:[IN,OUT]}]},
    options:{responsive:true,plugins:{legend:{position:'bottom'}}}});
}

function renderMovementsThisMonth(){
  var tb=$('#tbl-mov'); if(!tb) return; tb.innerHTML='';
  var now=today(); var ym=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  var map={};
  state.history.forEach(function(h){
    var d=parseTs(h.timestamp); if(!d) return;
    var key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); if(key!==ym) return;
    var code=String(h.code||''); if(!map[code]) map[code]={code:code,name:'',IN:0,OUT:0};
    var it=state.items.find(function(x){return String(x.code)===code}); if(it) map[code].name=it.name||map[code].name;
    var qty=Number(h.qty||0); if(String(h.type)==='IN') map[code].IN+=qty; else map[code].OUT+=qty;
  });
  var rows=Object.keys(map).map(function(k){return map[k]}).sort(function(a,b){return (b.IN+b.OUT)-(a.IN+a.OUT)});
  rows.forEach(function(r){
    var tr=document.createElement('tr');
    tr.innerHTML='<td>'+r.code+'</td><td>'+r.name+'</td>'
      +'<td class="text-end">'+fmt(r.IN)+'</td>'
      +'<td class="text-end">'+fmt(r.OUT)+'</td>'
      +'<td class="text-end">'+fmt(r.IN-r.OUT)+'</td>';
    tb.appendChild(tr);
  });
  var btn=$('#btn-export-mov');
  if(btn && !btn._wired){
    btn._wired=true;
    btn.addEventListener('click',function(){
      var head='code,name,IN,OUT,NET\n';
      var lines=rows.map(function(r){return [r.code,r.name,r.IN,r.OUT,(r.IN-r.OUT)].join(',')}).join('\n');
      var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='movements_this_month.csv'; a.click();
    });
  }
}

// ==== QR helpers
function itemQrText(code){ return 'ITEM|'+String(code||''); }
function userQrText(id){ return 'USER|'+String(id||''); }

// ==== Items list
function renderItems(){
  var tb=$('#tbl-items'); if(!tb) return; tb.innerHTML='';
  var term=String(state.filterText||'').trim().toLowerCase();
  var rows=state.items.filter(function(i){ return !term || String(i.name||'').toLowerCase().indexOf(term)>=0; });

  rows.forEach(function(i){
    var code=String(i.code||'');
    var qrId='qr-'+code.replace(/[^\w\-:.]/g,'_');
    var tr=document.createElement('tr'); tr.setAttribute('data-code',code);
    tr.innerHTML =
      '<td class="qr-cell"><div class="qrbox"><div id="'+qrId+'"></div><div class="caption">'+(i.name||'')+'（'+code+'）</div></div></td>'
      +'<td>'+code+'</td>'
      +'<td>'+(i.name||'')+'</td>'
      +'<td>'+(i.location||'')+'</td>'
      +'<td>'+(i.img?'<img class="thumb" src="'+i.img+'" alt="">':'')+'</td>'
      +'<td class="text-end">¥'+fmt(i.price||0)+'</td>'
      +'<td class="text-end">'+fmt(i.stock||0)+'</td>'
      +'<td class="text-end">'+fmt(i.min||0)+'</td>'
      +'<td class="text-end"><div class="btn-group btn-group-sm">'
      +  '<button class="btn btn-outline-secondary" data-act="detail"><i class="bi bi-search"></i></button>'
      +  '<button class="btn btn-outline-primary" data-act="edit"><i class="bi bi-pencil"></i></button>'
      +  '<button class="btn btn-outline-danger" data-act="del"><i class="bi bi-trash"></i></button>'
      +  '<button class="btn btn-outline-secondary" data-act="dl" data-code="'+qrId+'"><i class="bi bi-download"></i></button>'
      +'</div></td>';
    tb.appendChild(tr);

    var box=document.getElementById(qrId);
    if(box && typeof QRCode!=='undefined'){
      new QRCode(box,{ text:itemQrText(code), width:84, height:84, correctLevel:QRCode.CorrectLevel.M });
    }
  });

  // row click → detail
  $all('tbody#tbl-items tr', tb).forEach(function(tr){
    tr.addEventListener('click', function(e){
      var inBtn = e.target && e.target.closest ? e.target.closest('button') : null;
      if(inBtn) return;
      openItemDetail(tr.getAttribute('data-code'));
    });
  });

  // actions
  $all('button[data-act="dl"]', tb).forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      var tr=btn.closest('tr');
      var code=(tr && tr.children[1])?tr.children[1].textContent.trim():'';
      var name=(tr && tr.children[2])?tr.children[2].textContent.trim():'';
      var hid=btn.getAttribute('data-code');
      var holder=document.getElementById(hid);
      var canvas=holder?holder.querySelector('canvas'):null;
      var img=holder?holder.querySelector('img'):null;
      var dataUrl=(canvas&&canvas.toDataURL)?canvas.toDataURL('image/png'):(img?img.src:'');
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
      var code=b.closest('tr').getAttribute('data-code');
      if(!confirm('Delete item '+code+'?')) return;
      api('deleteItem',{method:'POST',body:{code:code}})
        .then(function(r){ if(r && r.ok){ return loadAll().then(function(){ alert('Deleted'); }); } alert((r&&r.error)||'failed'); })
        .catch(function(err){ alert(err && err.message || err); });
    });
  });
}

// ==== Item Detail
function openItemDetail(code){
  state.currentDetailCode=code;
  var item=state.items.find(function(i){return String(i.code)===String(code)});
  if(!item){ alert('Item not found'); return; }
  showView('view-item-detail','商品詳細');
  $('#det-code').textContent=item.code||'';
  $('#det-name').textContent=item.name||'';
  $('#det-loc').textContent=item.location||'';
  $('#det-price').textContent='¥'+fmt(item.price||0);
  $('#det-stock').textContent=fmt(item.stock||0);
  $('#det-min').textContent=fmt(item.min||0);
  $('#det-lot').textContent=item.lotSize?fmt(item.lotSize):'-';
  $('#det-bar').textContent=item.barcode||'-';
  var img=$('#det-img'); if(img){ if(item.img){ img.src=item.img; img.classList.remove('d-none'); } else { img.classList.add('d-none'); } }

  var tb=$('#tbl-item-history'); tb.innerHTML='';
  var rows=state.history.filter(function(h){return String(h.code)===String(code)}).slice().reverse();
  rows.forEach(function(h){
    var tr=document.createElement('tr');
    tr.innerHTML='<td>'+(h.timestamp||'')+'</td><td>'+(h.userId||'')+'</td>'
      +'<td class="text-end">'+fmt(h.qty||0)+'</td><td>'+(h.unit||'')+'</td><td>'+(h.type||'')+'</td>'
      +'<td class="text-end"><button class="btn btn-sm btn-outline-primary" data-row="'+(h.rowNumber||'')+'"><i class="bi bi-pencil"></i></button></td>';
    tb.appendChild(tr);
  });
  $all('button', tb).forEach(function(btn){ btn.addEventListener('click', function(){ openEditHistory(btn.getAttribute('data-row')); }); });

  var detBtn=$('#btn-det-export');
  if(detBtn && !detBtn._wired){
    detBtn._wired=true;
    detBtn.addEventListener('click', function(){
      var head='timestamp,userId,code,qty,unit,type\n';
      var lines=rows.map(function(r){return [r.timestamp,r.userId,r.code,r.qty,r.unit,r.type].join(',')}).join('\n');
      var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='history_'+safeFile(code)+'.csv'; a.click();
    });
  }
}

// ==== Edit item (reuse 新規 modal)
function openEditItem(code){
  var it=state.items.find(function(i){return String(i.code)===String(code)}); if(!it) return;
  var modal=new bootstrap.Modal('#dlg-new-item');
  $('#i-code').value=it.code||''; $('#i-name').value=it.name||''; $('#i-price').value=it.price||0;
  $('#i-stock').value=it.stock||0; $('#i-min').value=it.min||0; $('#i-img').value=it.img||'';
  $('#i-location').value=it.location||''; $('#i-lot').value=it.lotSize||0; $('#i-barcode').value=it.barcode||'';
  $('#i-overwrite-flag').value='1';
  modal.show();
}

// ==== Users & QR
function renderUsers(){
  var isAdmin=(state.currentUser.role==='admin');
  var addBtn=$('#btn-open-new-user'); if(addBtn){ if(isAdmin) addBtn.classList.remove('d-none'); else addBtn.classList.add('d-none'); }
  var prBtn=$('#btn-print-qr-users'); if(prBtn){ if(isAdmin) prBtn.classList.remove('d-none'); else prBtn.classList.add('d-none'); }

  var tb=$('#tbl-userqr'); if(!tb) return; tb.innerHTML='';
  var grid=$('#print-qr-users-grid'); if(grid) grid.innerHTML='';

  var list=isAdmin?state.users:state.users.filter(function(u){return String(u.id)===String(state.currentUser.id)});

  list.forEach(function(u){
    var uid=String(u.id||''); var hid='uqr-'+uid.replace(/[^\w\-:.]/g,'_');
    var tr=document.createElement('tr');
    tr.innerHTML='<td class="qr-cell"><div class="qrbox"><div id="'+hid+'"></div><div class="caption">'+(u.name||'')+'（'+(u.id||'')+'）</div></div></td>'
      +'<td>'+(u.id||'')+'</td><td>'+(u.name||'')+'</td><td>'+(u.role||'user')+'</td>'
      +'<td class="text-end"><button class="btn btn-sm btn-outline-secondary" data-act="dl" data-id="'+hid+'" data-uid="'+uid+'" data-name="'+safeFile(u.name||'')+'"><i class="bi bi-download"></i></button></td>';
    tb.appendChild(tr);

    var div=document.getElementById(hid);
    if(div && typeof QRCode!=='undefined'){ new QRCode(div,{text:userQrText(uid),width:84,height:84,correctLevel:QRCode.CorrectLevel.M}); }

    if(grid){
      var card=document.createElement('div'); card.className='qr-card';
      var v=document.createElement('div'); v.id='p-'+hid;
      var title=document.createElement('div'); title.className='title'; title.textContent=(u.name||'')+'（'+(u.id||'')+'｜'+(u.role||'user')+'）';
      card.appendChild(v); card.appendChild(title); grid.appendChild(card);
      if(typeof QRCode!=='undefined'){ new QRCode(v,{text:userQrText(uid),width:110,height:110,correctLevel:QRCode.CorrectLevel.M}); }
    }
  });

  $all('button[data-act="dl"]', tb).forEach(function(btn){
    btn.addEventListener('click', function(){
      var hid=btn.getAttribute('data-id');
      var holder=document.getElementById(hid);
      var canvas=holder?holder.querySelector('canvas'):null;
      var img=holder?holder.querySelector('img'):null;
      var dataUrl=(canvas&&canvas.toDataURL)?canvas.toDataURL('image/png'):(img?img.src:'');
      if(!dataUrl) return;
      var code=btn.getAttribute('data-uid')||'USER';
      var name=btn.getAttribute('data-name')||'';
      var a=document.createElement('a'); a.href=dataUrl; a.download='USER_'+safeFile(code)+'_'+safeFile(name)+'.png'; a.click();
    });
  });
}

// ==== History
function renderHistory(){
  var tb=$('#tbl-history'); if(!tb) return; tb.innerHTML='';
  state.history.slice(-300).reverse().forEach(function(h){
    var tr=document.createElement('tr');
    tr.innerHTML='<td>'+(h.timestamp||'')+'</td><td>'+(h.userId||'')+'</td><td>'+(h.code||'')+'</td>'
      +'<td class="text-end">'+fmt(h.qty||0)+'</td><td>'+(h.unit||'')+'</td><td>'+(h.type||'')+'</td>'
      +'<td class="text-end"><button class="btn btn-sm btn-outline-primary" data-row="'+(h.rowNumber||'')+'"><i class="bi bi-pencil"></i></button></td>';
    tb.appendChild(tr);
  });
  $all('button', tb).forEach(function(btn){ btn.addEventListener('click', function(){ openEditHistory(btn.getAttribute('data-row')); }); });
}

// ==== Scanner helpers
function startBackCameraScan(mountId, onScan, boxSize){
  boxSize=boxSize||300;
  var cfg={fps:10, qrbox:{width:boxSize, height:boxSize}};
  var scanner=new Html5Qrcode(mountId);
  return scanner.start({facingMode:'environment'}, cfg, onScan)
    .then(function(){ return scanner; })
    .catch(function(){
      return Html5Qrcode.getCameras().then(function(cams){
        if(!cams||!cams.length) throw new Error('カメラが見つかりません');
        var back=cams.find(function(c){return /back|rear|environment/i.test(c.label)}) || cams[cams.length-1] || cams[0];
        return scanner.start({deviceId:{exact:back.id}}, cfg, onScan).then(function(){return scanner;});
      });
    });
}

// ==== 入出庫
function fillIoForm(it){
  $('#io-code').value=it.code||''; $('#io-name').value=it.name||'';
  $('#io-price').value=it.price||''; $('#io-stock').value=it.stock||'';
}
function startIoScan(){
  startBackCameraScan('io-scan-area', onScanIo, (isMobile()?240:300))
    .then(function(sc){ state.ioScanner=sc; })
    .catch(function(e){ alert('カメラが見つかりません: '+(e&&e.message||e)); });
}
function stopIoScan(){
  var sc=state.ioScanner; if(!sc) return;
  sc.stop().then(function(){ sc.clear(); state.ioScanner=null; }).catch(function(){ state.ioScanner=null; });
}
function onScanIo(text){
  try{
    var code='';
    if(text.indexOf('ITEM|')===0) code=text.split('|')[1]||'';
    else { try{ var o=JSON.parse(text); code=o.code||''; }catch(_){ } }
    if(code){
      var it=state.items.find(function(x){return String(x.code)===String(code)});
      if(it) fillIoForm(it);
      var q=$('#io-qty'); if(q) q.focus();
    }
  }catch(_){}
}

// ==== 棚卸
function startScanner(){
  startBackCameraScan('scan-area', onScanStocktake, (isMobile()?240:300))
    .then(function(sc){ state.scanner=sc; })
    .catch(function(e){ alert('カメラが見つかりません: '+(e&&e.message||e)); });
}
function stopScanner(){
  var sc=state.scanner; if(!sc) return;
  sc.stop().then(function(){ sc.clear(); state.scanner=null; }).catch(function(){ state.scanner=null; });
}
function onScanStocktake(text){
  try{
    var code='';
    if(text.indexOf('ITEM|')===0) code=text.split('|')[1]||'';
    else { try{ var o=JSON.parse(text); code=o.code||''; }catch(_){ } }
    if(code){
      var it=state.items.find(function(x){return String(x.code)===String(code)});
      var book=Number(it&&it.stock||0);
      var name=it&&it.name||'';
      pushStocktake(code, name, book, book);
    }
  }catch(_){}
}
function pushStocktake(code,name,book,real){
  var diff=Number(real)-Number(book);
  state.stocktakeRows.unshift({code:code,name:name,book:book,real:real,diff:diff});
  var tb=$('#tbl-stocktake'); if(!tb) return; tb.innerHTML='';
  state.stocktakeRows.forEach(function(r){
    var tr=document.createElement('tr');
    tr.innerHTML='<td>'+r.code+'</td><td>'+r.name+'</td>'
      +'<td class="text-end">'+fmt(r.book)+'</td>'
      +'<td class="text-end">'+fmt(r.real)+'</td>'
      +'<td class="text-end">'+fmt(r.diff)+'</td>';
    tb.appendChild(tr);
  });
}

// ==== Edit History
function openEditHistory(rowNumber){
  var h=state.history.find(function(x){return String(x.rowNumber)===String(rowNumber)});
  if(!h){ alert('History not found'); return; }
  var m=new bootstrap.Modal('#dlg-edit-history');
  $('#eh-row').value=h.rowNumber||''; $('#eh-code').value=h.code||'';
  $('#eh-qty').value=h.qty||0; $('#eh-unit').value=h.unit||'pcs'; $('#eh-type').value=h.type||'IN';
  m.show();
}
function submitEditHistory(e){
  e.preventDefault();
  var body={
    rowNumber:Number($('#eh-row').value),
    code:$('#eh-code').value.trim(),
    qty:Number($('#eh-qty').value||0),
    unit:$('#eh-unit').value,
    type:$('#eh-type').value
  };
  api('updateHistory',{method:'POST',body:body}).then(function(r){
    if(r && r.ok===false) return alert(r.error||'エラー');
    alert('更新しました'); return loadAll().then(function(){ if(state.currentDetailCode) openItemDetail(state.currentDetailCode); });
  }).catch(function(err){ alert(err&&err.message||err); });
}

// ==== Events boot
window.addEventListener('DOMContentLoaded', function(){
  updateWho();

  // nav
  $all('aside nav a').forEach(function(a){
    a.addEventListener('click', function(){ showView(a.getAttribute('data-view'), a.textContent.trim()); });
  });

  // logout
  $on('#btn-logout','click', function(){ localStorage.removeItem('currentUser'); location.href='index.html'; });

  // 入出庫 lookup
  $on('#btn-io-lookup','click', function(){
    var code=$('#io-code').value.trim(); if(!code) return;
    api('itemByCode',{method:'POST',body:{code:code}}).then(function(r){
      if(r && r.ok && r.item) fillIoForm(r.item);
      else{
        var it=state.items.find(function(x){return String(x.code)===String(code)});
        if(it) fillIoForm(it); else alert('Item not found');
      }
    }).catch(function(){
      var it=state.items.find(function(x){return String(x.code)===String(code)});
      if(it) fillIoForm(it); else alert('Item not found');
    });
  });
  $on('#io-code','keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); var b=$('#btn-io-lookup'); if(b) b.click(); } });

  // 入出庫 submit
  $on('#form-io','submit', function(e){
    e.preventDefault();
    var body={
      userId:state.currentUser.id,
      code:$('#io-code').value.trim(),
      qty:Number($('#io-qty').value||0),
      unit:$('#io-unit').value,
      type:$('#io-type').value
    };
    if(!body.code || !body.qty){ alert('コード/数量は必須'); return; }
    api('log',{method:'POST',body:body}).then(function(r){
      if(r && r.ok===false) return alert(r.error||'エラー');
      alert('登録しました');
      return loadAll().then(function(){
        showView('view-history','履歴');
        fillIoForm({code:'',name:'',price:'',stock:''}); $('#io-qty').value='';
      });
    }).catch(function(err){ alert('登録失敗: '+(err&&err.message||err)); });
  });

  // Stocktake
  $on('#btn-start-scan','click', startScanner);
  $on('#btn-stop-scan','click', stopScanner);
  $on('#st-add','click', function(e){
    e.preventDefault();
    var code=$('#st-code').value.trim(); var real=Number($('#st-qty').value||0);
    if(!code) return;
    var it=state.items.find(function(x){return String(x.code)===String(code)});
    pushStocktake(code, it&&it.name||'', Number(it&&it.stock||0), real);
  });
  $on('#st-export','click', function(){
    var head='code,name,book,real,diff\n';
    var lines=state.stocktakeRows.map(function(r){return [r.code,r.name,r.book,r.real,r.diff].join(',')}).join('\n');
    var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='stocktake.csv'; a.click();
  });

  // Items filter & export
  $on('#items-filter','input', function(e){ state.filterText=e.target.value; renderItems(); });
  $on('#btn-items-export','click', function(){
    var head='code,name,location,price,stock,min,lotSize,barcode\n';
    var lines=state.items.map(function(r){return [r.code,r.name,r.location||'',r.price,r.stock,r.min,r.lotSize||0,r.barcode||''].join(',')}).join('\n');
    var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='items.csv'; a.click();
  });
  $on('#btn-items-xlsx','click', function(){
    var data=state.items.map(function(r){return {code:r.code,name:r.name,location:r.location||'',price:r.price,stock:r.stock,min:r.min,lotSize:r.lotSize||0,barcode:r.barcode||''};});
    var ws=XLSX.utils.json_to_sheet(data); var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Items'); XLSX.writeFile(wb,'items.xlsx');
  });

  // Modal 新規 item
  var itemModalEl=document.getElementById('dlg-new-item');
  var itemModal=itemModalEl? new bootstrap.Modal(itemModalEl):null;

  $on('#btn-open-new-item','click', function(){
    $('#i-code').value=nextItemCode();
    $('#i-name').value=''; $('#i-price').value=0; $('#i-stock').value=0; $('#i-min').value=0;
    $('#i-img').value=''; $('#i-location').value=''; $('#i-lot').value=0; $('#i-barcode').value='';
    $('#i-overwrite-flag').value='';
    if(itemModal) itemModal.show();
  });

  $on('#form-item','submit', function(e){
    e.preventDefault();
    var body={
      code:$('#i-code').value.trim(),
      name:$('#i-name').value.trim(),
      price:Number($('#i-price').value||0),
      stock:Number($('#i-stock').value||0),
      min:Number($('#i-min').value||0),
      img:$('#i-img').value.trim(),
      location:$('#i-location').value.trim(),
      lotSize:Number($('#i-lot').value||0),
      barcode:$('#i-barcode').value.trim(),
      overwrite: !!$('#i-overwrite-flag').value
    };
    if(!body.code || !body.name){ alert('コード/名称は必須'); return; }
    var act = body.overwrite ? 'updateItem' : 'addItem';
    api(act,{method:'POST',body:body}).then(function(r){
      if(r && r.ok===false) throw new Error(r.error||'登録失敗');
      if(itemModal) itemModal.hide();
      return loadAll().then(function(){ showView('view-items','商品一覧'); });
    }).catch(function(err){ alert(err&&err.message||err); });
  });

  // QR preview (tanpa document.write html panjang)
  $on('#btn-item-makeqr','click', function(){
    var code=$('#i-code').value.trim();
    var name=$('#i-name').value.trim();
    var price=Number($('#i-price').value||0);
    var holder=document.createElement('div');
    if(typeof QRCode!=='undefined'){ new QRCode(holder,{text:itemQrText(code),width:240,height:240,correctLevel:QRCode.CorrectLevel.M}); }
    var canvas=holder.querySelector('canvas'); var dataUrl=canvas?canvas.toDataURL('image/png'):'';
    var w=window.open('','qrprev','width=420,height=520');
    var img=document.createElement('img'); img.src=dataUrl; img.style.width='240px'; img.style.height='240px';
    var cap=document.createElement('div'); cap.textContent=name+'（'+code+'） ¥'+fmt(price); cap.style.marginTop='8px';
    var wrap=w.document.createElement('div'); wrap.style.padding='20px'; wrap.style.textAlign='center'; wrap.style.fontFamily='system-ui, sans-serif';
    wrap.appendChild(img); wrap.appendChild(cap); w.document.body.appendChild(wrap);
    holder.remove();
  });

  // Modal user
  var userModalEl=document.getElementById('dlg-new-user');
  var userModal=userModalEl? new bootstrap.Modal(userModalEl):null;
  $on('#btn-open-new-user','click', function(){ if(userModal) userModal.show(); });
  $on('#form-user','submit', function(e){
    e.preventDefault();
    var body={ name:$('#u-name').value.trim(), id:$('#u-id').value.trim(), role:$('#u-role').value, pin:$('#u-pin').value.trim() };
    api('addUser',{method:'POST',body:body}).then(function(r){
      if(r && r.ok===false) throw new Error(r.error||'エラー');
      if(userModal) userModal.hide();
      return loadAll().then(function(){ showView('view-users','ユーザー / QR'); });
    }).catch(function(err){ alert(err&&err.message||err); });
  });
  $on('#btn-print-qr-users','click', function(){ var p=$('#print-qr-users'); if(p){ p.classList.remove('d-none'); window.print(); p.classList.add('d-none'); } });

  // Edit history submit
  $on('#form-edit-history','submit', submitEditHistory);

  // boot
  showView('view-dashboard','ダッシュボード');
  loadAll();
});

// ==== Util
function nextItemCode(){
  var nums=state.items.map(function(i){ return String(i.code||''); })
    .map(function(c){ return (/^\d+$/).test(c)?Number(c):NaN; })
    .filter(function(n){ return !isNaN(n); });
  var max=nums.length?Math.max.apply(Math, nums):0;
  var width=state.items.reduce(function(m,i){ var l=String(i.code||'').length||0; return Math.max(m,l); },4);
  if(width<4) width=4;
  return String(max+1).padStart(width,'0');
}

// expose for onclick in HTML
window.startIoScan = startIoScan;
window.stopIoScan  = stopIoScan;
window.startScanner = startScanner;
window.stopScanner  = stopScanner;
