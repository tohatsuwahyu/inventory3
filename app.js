/* =========================================================
 * app.js — Inventory (GAS backend) — match dashboard.html
 * =======================================================*/
(function(){
  "use strict";

  // ---------- Helpers ----------
  const $  = (sel, el=document)=>el.querySelector(sel);
  const $$ = (sel, el=document)=>[...el.querySelectorAll(sel)];
  const fmt = (n)=> new Intl.NumberFormat('ja-JP').format(Number(n||0));
  const isMobile = ()=> /Android|iPhone|iPad/i.test(navigator.userAgent);
  const isAdmin  = ()=> (getCurrentUser()?.role||'').toLowerCase()==='admin';
  const toast = (m)=> alert(m);

  function setLoading(show, text){
    const el = $('#global-loading');
    if(!el) return;
    if(show){ el.classList.remove('d-none'); $('#loading-text').textContent = text||'読み込み中…'; }
    else { el.classList.add('d-none'); }
  }

  // ---------- API ----------
  async function api(action, { method='GET', body=null, silent=false }={}){
    if(!window.CONFIG || !CONFIG.BASE_URL){ throw new Error('config.js BASE_URL belum di-set'); }
    const apikey = encodeURIComponent(CONFIG.API_KEY||'');
    const url = `${CONFIG.BASE_URL}?action=${encodeURIComponent(action)}&apikey=${apikey}&_=${Date.now()}`;
    if(!silent) setLoading(true);
    try{
      const opt = method==='GET'
        ? { mode:'cors', cache:'no-cache' }
        : { method:'POST', mode:'cors', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify({ ...(body||{}), apikey: CONFIG.API_KEY }) };
      const r = await fetch(url, opt);
      if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
      return await r.json();
    }finally{ if(!silent) setLoading(false); }
  }

  // ---------- loaders ----------
  function loadScriptOnce(src){
    return new Promise((resolve, reject)=>{
      if ([...document.scripts].some(s=>s.src===src || s.src.endsWith(src))) return resolve();
      const s=document.createElement('script'); s.src=src; s.async=true; s.crossOrigin='anonymous';
      s.onload=resolve; s.onerror=()=>reject(new Error('Gagal memuat: '+src));
      document.head.appendChild(s);
    });
  }
  async function ensureQRCode(){
    if (window.QRCode) return;
    const locals = ['./qrlib.js','./qrcode.min.js','./vendor/qrcode.min.js'];
    for(const p of locals){ try{ await loadScriptOnce(p); if(window.QRCode) return; }catch{} }
    const cdns = [
      'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
      'https://unpkg.com/qrcodejs@1.0.0/qrcode.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
    ];
    for(const u of cdns){ try{ await loadScriptOnce(u); if(window.QRCode) return; }catch{} }
    throw new Error('QRCode library tidak tersedia');
  }
  async function ensureHtml5Qrcode(){
    if (window.Html5Qrcode) return;
    const locals = ['./html5-qrcode.min.js','./vendor/html5-qrcode.min.js'];
    for(const p of locals){ try{ await loadScriptOnce(p); if(window.Html5Qrcode) return; }catch{} }
    const cdns = [
      'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/minified/html5-qrcode.min.js',
      'https://unpkg.com/html5-qrcode@2.3.8/minified/html5-qrcode.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js'
    ];
    for(const u of cdns){ try{ await loadScriptOnce(u); if(window.Html5Qrcode) return; }catch{} }
    throw new Error('html5-qrcode tidak tersedia');
  }

  // ---------- Auth ----------
  function getCurrentUser(){ try{ return JSON.parse(localStorage.getItem('currentUser')||'null'); }catch{ return null; } }
  function setCurrentUser(u){ localStorage.setItem('currentUser', JSON.stringify(u||null)); }
  function logout(){ setCurrentUser(null); location.href='index.html'; }

  // ---------- Sidebar / Nav ----------
  (function navHandler(){
    const sb = $('#sb'), bd = $('#sb-backdrop');
    const burger = $('#burger'), btnMenu = $('#btn-menu');
    const closeSB = ()=>{ sb?.classList.remove('open'); bd?.classList.remove('show'); };
    const toggleSB= ()=>{ sb?.classList.toggle('open'); bd?.classList.toggle('show'); };
    [burger, btnMenu].forEach(el=> el && el.addEventListener('click', (e)=>{ e.preventDefault(); toggleSB(); }));
    document.addEventListener('click', (e)=>{
      const trg = e.target.closest('[data-burger], .btn-burger'); if(trg){ e.preventDefault(); toggleSB(); }
    });
    bd?.addEventListener('click', closeSB);

    // nav switching
    document.addEventListener('click', (e)=>{
      const a = e.target.closest('aside nav a[data-view]'); if(!a) return; e.preventDefault();
      $$('aside nav a').forEach(n=>n.classList.remove('active')); a.classList.add('active');
      $$('main section').forEach(s=>{ s.classList.add('d-none'); s.classList.remove('active'); });
      const id = a.getAttribute('data-view'); const sec = document.getElementById(id);
      if(sec){ sec.classList.remove('d-none'); sec.classList.add('active'); }
      $('#page-title').textContent = a.textContent.trim();
      closeSB();
      if(id==='view-items') renderItems();
      if(id==='view-users') renderUsers();
      if(id==='view-history') renderHistory();
      if(id==='view-shelf')  initStocktake(); // <— sesuai dashboard.html
    });
  })();

  // ---------- Dashboard ----------
  let chartLine=null, chartPie=null;
  async function renderDashboard(){
    const who = getCurrentUser();
    if (who) $('#who').textContent = `${who.name || who.id || 'user'} (${who.id} | ${who.role||'user'})`;
    try{
      const [itemsRaw, usersRaw, seriesRaw] = await Promise.all([
        api('items',{method:'GET'}).catch(()=>[]),
        api('users',{method:'GET'}).catch(()=>[]),
        api('statsMonthlySeries',{method:'GET'}).catch(()=>[])
      ]);
      const items  = Array.isArray(itemsRaw)  ? itemsRaw  : [];
      const users  = Array.isArray(usersRaw)  ? usersRaw  : [];
      const series = Array.isArray(seriesRaw) ? seriesRaw : [];
      $('#metric-total-items').textContent = items.length;
      $('#metric-low-stock').textContent   = items.filter(it => +it.stock<=+it.min).length;
      $('#metric-users').textContent       = users.length;

      const ctx1 = $('#chart-monthly'); if(ctx1){
        chartLine?.destroy();
        chartLine = new Chart(ctx1,{type:'line',data:{
          labels: series.map(s=>s.month||''), datasets:[
            {label:'IN',  data:series.map(s=>+s.in||0),  borderWidth:2},
            {label:'OUT', data:series.map(s=>+s.out||0), borderWidth:2}
          ]}, options:{responsive:true,maintainAspectRatio:false}});
      }
      const ctx2 = $('#chart-pie'); if(ctx2){
        chartPie?.destroy();
        const last=series.at(-1)||{in:0,out:0};
        chartPie=new Chart(ctx2,{type:'pie',data:{labels:['IN','OUT'],datasets:[{data:[+last.in||0,+last.out||0]}]},options:{responsive:true,maintainAspectRatio:false}});
      }
    }catch{ toast('ダッシュボードの読み込みに失敗しました。'); }
  }

  // ---------- Items + submenu + role guard ----------
  let _ITEMS_CACHE = [];
  function tplItemRow(it){
    const qrid = `qr-${it.code}`; const admin=isAdmin();
    const menu = `
      <div class="btn-group">
        <button class="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown">操作</button>
        <ul class="dropdown-menu dropdown-menu-end">
          ${ admin ? `<li><a class="dropdown-item act-edit"   data-code="${esc(it.code)}">編集</a></li>` : ``}
          ${ admin ? `<li><a class="dropdown-item act-adjust" data-code="${esc(it.code)}">在庫調整</a></li>` : ``}
          <li><a class="dropdown-item act-preview" data-code="${esc(it.code)}">プレビュー</a></li>
          <li><a class="dropdown-item act-dl"      data-code="${esc(it.code)}">ラベルDL</a></li>
        </ul>
      </div>`;
    return `<tr>
      <td style="width:110px"><div class="tbl-qr-box"><div id="${qrid}"></div></div></td>
      <td>${escHtml(it.code)}</td>
      <td><a href="#" class="link-underline link-item" data-code="${escHtml(it.code)}">${escHtml(it.name)}</a></td>
      <td>${it.img ? `<img src="${esc(it.img)}" style="height:32px">` : ''}</td>
      <td class="text-end">¥${fmt(it.price)}</td>
      <td class="text-end">${fmt(it.stock)}</td>
      <td class="text-end">${fmt(it.min)}</td>
      <td>${escHtml(it.location||'')}</td>
      <td class="text-end">${menu}</td>
    </tr>`;
  }
  async function renderItems(){
    try{
      const list = await api('items',{method:'GET'});
      _ITEMS_CACHE = Array.isArray(list) ? list : (Array.isArray(list?.data) ? list.data : []);
      const tb = $('#tbl-items'); tb.innerHTML = _ITEMS_CACHE.map(tplItemRow).join('');
      await ensureQRCode();
      for(const it of _ITEMS_CACHE){
        const holder = document.getElementById(`qr-${it.code}`); if(!holder) continue;
        holder.innerHTML=''; new QRCode(holder,{text:`ITEM|${it.code}`,width:64,height:64,correctLevel:QRCode.CorrectLevel.M});
      }

      // submenu
      tb.addEventListener('click', async (e)=>{
        const a = e.target.closest('.dropdown-item'); if(!a) return;
        const code=a.getAttribute('data-code');
        if(a.classList.contains('act-edit'  )){ if(!isAdmin()) return toast('アクセスが拒否されました（管理者のみ）'); openEditItem(code); }
        if(a.classList.contains('act-adjust')){ if(!isAdmin()) return toast('アクセスが拒否されました（管理者のみ）'); openAdjustModal(code); }
        if(a.classList.contains('act-dl'    )){ const it=_ITEMS_CACHE.find(x=>String(x.code)===String(code)); const url=await makeItemLabelDataURL(it); const d=document.createElement('a'); d.href=url; d.download=`label_${it.code}.png`; d.click(); }
        if(a.classList.contains('act-preview')){ const it=_ITEMS_CACHE.find(x=>String(x.code)===String(code)); const url=await makeItemLabelDataURL(it); openPreview(url); }
      });

      // link detail
      $$('#tbl-items .link-item').forEach(a=>{
        a.addEventListener('click',(ev)=>{ ev.preventDefault(); const code=a.getAttribute('data-code'); const it=_ITEMS_CACHE.find(x=>String(x.code)===String(code)); showItemDetail(it); });
      });

      // search (nama/kode/lokasi)
      $('#items-search')?.addEventListener('input',(e)=>{
        const q=(e.target.value||'').toLowerCase().trim();
        $$('#tbl-items tr').forEach(tr=>{
          const code=(tr.children[1]?.textContent||'').toLowerCase();
          const name=(tr.children[2]?.textContent||'').toLowerCase();
          const loc =(tr.children[7]?.textContent||'').toLowerCase();
          tr.style.display=(code.includes(q)||name.includes(q)||loc.includes(q))?'':'none';
        });
      });
    }catch{ toast('商品一覧の読み込みに失敗しました。'); }
  }
  function escHtml(s){ return String(s||'').replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;","&gt;":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
  const esc = (s)=>escHtml(s);

  // --- Edit (admin) ---
  function openEditItem(code){
    if(!isAdmin()) return toast('アクセスが拒否されました（管理者のみ）');
    const it=_ITEMS_CACHE.find(x=>String(x.code)===String(code)); if(!it) return;
    const wrap=document.createElement('div'); wrap.className='modal fade';
    wrap.innerHTML=`<div class="modal-dialog"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">商品編集</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body"><div class="row g-3">
        <div class="col-md-6"><label class="form-label">コード</label><input id="md-code" class="form-control" value="${esc(it.code)}" readonly></div>
        <div class="col-md-6"><label class="form-label">名称</label><input id="md-name" class="form-control" value="${esc(it.name)}"></div>
        <div class="col-md-4"><label class="form-label">価格</label><input id="md-price" type="number" class="form-control" value="${+it.price||0}"></div>
        <div class="col-md-4"><label class="form-label">在庫</label><input id="md-stock" type="number" class="form-control" value="${+it.stock||0}"></div>
        <div class="col-md-4"><label class="form-label">最小</label><input id="md-min" type="number" class="form-control" value="${+it.min||0}"></div>
        <div class="col-md-8"><label class="form-label">画像URL</label><input id="md-img" class="form-control" value="${esc(it.img||'')}"></div>
        <div class="col-md-4"><label class="form-label">置場</label><input id="md-location" class="form-control text-uppercase" value="${esc(it.location||'')}" placeholder="A-01-03"></div>
      </div></div>
      <div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">閉じる</button><button class="btn btn-primary" id="md-save">保存</button></div>
    </div></div>`;
    document.body.appendChild(wrap); const modal=new bootstrap.Modal(wrap); modal.show();
    $('#md-location',wrap)?.addEventListener('input',e=>{ e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g,''); });
    $('#md-save',wrap)?.addEventListener('click', async ()=>{
      try{
        const payload={ code:$('#md-code',wrap).value, name:$('#md-name',wrap).value, price:+$('#md-price',wrap).value||0, stock:+$('#md-stock',wrap).value||0, min:+$('#md-min',wrap).value||0, img:$('#md-img',wrap).value, location:($('#md-location',wrap).value||'').toUpperCase().trim(), overwrite:true };
        const r=await api('updateItem',{method:'POST', body:payload});
        if(r?.ok){ modal.hide(); wrap.remove(); renderItems(); } else toast(r?.error||'保存失敗');
      }catch(e){ toast('保存失敗: '+(e?.message||e)); }
    });
    wrap.addEventListener('hidden.bs.modal',()=>wrap.remove(),{once:true});
  }

  // --- Adjust (admin) ---
  function openAdjustModal(code){
    if(!isAdmin()) return toast('アクセスが拒否されました（管理者のみ）');
    const it=_ITEMS_CACHE.find(x=>String(x.code)===String(code)); if(!it) return;
    const wrap=document.createElement('div'); wrap.className='modal fade';
    wrap.innerHTML=`<div class="modal-dialog"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">在庫調整：${escHtml(it.name)} (${escHtml(it.code)})</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="mb-2">現在在庫：<b>${fmt(it.stock||0)}</b></div>
        <label class="form-label">新しい在庫数</label><input id="adj-qty" type="number" class="form-control" value="${+it.stock||0}">
        <label class="form-label mt-3">備考</label><input id="adj-note" class="form-control" placeholder="棚卸し調整 など">
      </div>
      <div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">閉じる</button><button class="btn btn-warning" id="adj-save">調整</button></div>
    </div></div>`;
    document.body.appendChild(wrap); const modal=new bootstrap.Modal(wrap); modal.show();
    $('#adj-save',wrap)?.addEventListener('click', async ()=>{
      const who=getCurrentUser();
      try{
        const newStock=+$('#adj-qty',wrap).value||0; const note=$('#adj-note',wrap).value||'Adjust';
        const r=await api('adjustStock',{method:'POST', body:{ code:it.code, newStock, userId: who?.id, note }});
        if(r?.ok){ toast('調整しました'); modal.hide(); wrap.remove(); renderItems(); renderDashboard(); }
        else toast(r?.error||'調整失敗');
      }catch(e){ toast('調整失敗: '+(e?.message||e)); }
    });
    wrap.addEventListener('hidden.bs.modal',()=>wrap.remove(),{once:true});
  }

  // --- Detail card ---
  function showItemDetail(it){
    const card = $('#card-item-detail'); if(!card) return;
    const body = $('#item-detail-body', card);
    body.innerHTML = `
      <div class="d-flex gap-3">
        <div style="width:160px;height:120px;background:#f3f6ff;border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden">
          ${it.img ? `<img src="${esc(it.img)}" style="max-width:100%;max-height:100%">` : '<span class="text-primary">画像</span>'}
        </div>
        <div class="flex-1">
          <div><b>コード</b>：${escHtml(it.code)}</div>
          <div><b>名称</b>：${escHtml(it.name)}</div>
          <div><b>価格</b>：¥${fmt(it.price)}</div>
          <div><b>在庫</b>：${fmt(it.stock)}</div>
          <div><b>最小</b>：${fmt(it.min)}</div>
          <div><b>置場</b>：<span class="badge text-bg-light border">${escHtml(it.location||'')}</span></div>
        </div>
      </div>`;
    card.classList.remove('d-none');
    $('#btn-close-detail')?.addEventListener('click', ()=> card.classList.add('d-none'), {once:true});
  }

  // --- Label generator (QR simetris) ---
  async function makeItemLabelDataURL(item){
    const W=760,H=260,pad=18, imgW=200,gap=16, QUIET=20, qrSize=156, gapQR=18;
    const c=document.createElement('canvas'); c.width=W; c.height=H;
    const g=c.getContext('2d'); g.imageSmoothingEnabled=false;
    g.fillStyle='#fff'; g.fillRect(0,0,W,H); g.strokeStyle='#000'; g.lineWidth=2; g.strokeRect(1,1,W-2,H-2);
    const rx=pad,ry=pad,rw=imgW,rh=H-2*pad,r=18;
    roundRect(g,rx,ry,rw,rh,r,true,true,'#eaf1ff','#cbd5e1'); await drawImageIfAny(g,item.img,rx,ry,rw,rh,r);
    const colStart=pad+imgW+gap, qrBoxH=H-2*pad, qy=pad+Math.max(0,(qrBoxH-qrSize)/2), qx=colStart+gapQR+QUIET;
    g.fillStyle='#fff'; g.fillRect(qx-QUIET,qy-QUIET,qrSize+2*QUIET,qrSize+2*QUIET);
    const du=await generateQrDataUrl(`ITEM|${item.code}`, qrSize); const im=new Image(); im.src=du; await imgLoaded(im); g.drawImage(im,qx,qy,qrSize,qrSize);
    const colQRW=qrSize+2*QUIET, gridX=colStart+gapQR+colQRW+gapQR, cellH=(H-2*pad)/3;
    g.strokeRect(gridX,pad,W-gridX-pad,H-2*pad); for(let i=1;i<=2;i++){ const y=pad+cellH*i; g.beginPath(); g.moveTo(gridX,y); g.lineTo(W-pad,y); g.stroke(); }
    const labelX=gridX+12, valX=gridX+112, valMaxW=W-pad-valX-8;
    g.textAlign='left'; g.textBaseline='middle'; g.fillStyle='#000'; g.font='18px "Noto Sans JP", system-ui';
    g.fillText('コード：', labelX, pad + cellH*0.5); g.fillText('商品名：', labelX, pad + cellH*1.5); g.fillText('置場：', labelX, pad + cellH*2.5);
    g.font='bold 22px "Noto Sans JP", system-ui'; drawSingleLineFit(g,String(item.code||''), valX, pad+cellH*0.5, valMaxW);
    drawWrapAuto(g,String(item.name||''), valX, pad+cellH*1.5, valMaxW, {maxLines:2,base:22,min:16,lineGap:4});
    g.font='bold 20px "Noto Sans JP", system-ui'; drawSingleLineFit(g,String(item.location||'').toUpperCase(), val
