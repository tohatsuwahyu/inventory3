/* =========================================================
 * app.js — Inventory (GAS backend)
 * =======================================================*/
(function(){
  "use strict";

  /* ------------ Utils ------------ */
  const $  = (s,el=document)=>el.querySelector(s);
  const $$ = (s,el=document)=>[...el.querySelectorAll(s)];
  const fmt = (n)=> new Intl.NumberFormat('ja-JP').format(Number(n||0));
  const isMobile = ()=> /Android|iPhone|iPad/i.test(navigator.userAgent);
  const toast = (m)=> alert(m);

  function setLoading(show, text){
    const el = $('#global-loading'); if(!el) return;
    if(show){ el.classList.remove('d-none'); $('#loading-text').textContent = text||'読み込み中…'; }
    else { el.classList.add('d-none'); }
  }

  /* ------------ API (GAS) ------------ */
  async function api(action, { method='GET', body=null, silent=false }={}){
    if(!window.CONFIG || !CONFIG.BASE_URL) throw new Error('config.js BASE_URL belum di-set');
    const apikey = encodeURIComponent(CONFIG.API_KEY||'');
    const url = `${CONFIG.BASE_URL}?action=${encodeURIComponent(action)}&apikey=${apikey}&_=${Date.now()}`;
    if(!silent) setLoading(true);
    try{
      if(method==='GET'){
        const r = await fetch(url,{mode:'cors',cache:'no-cache'}); if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
        return await r.json();
      }
      const r = await fetch(url,{
        method:'POST', mode:'cors',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body: JSON.stringify({ ...(body||{}), apikey: CONFIG.API_KEY })
      });
      if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
      return await r.json();
    }catch(e){ throw e; } finally{ if(!silent) setLoading(false); }
  }

  /* ------------ Script loaders ------------ */
  function loadScriptOnce(src){
    return new Promise((resolve, reject)=>{
      if ([...document.scripts].some(s=>s.src===src || s.src.endsWith(src))) return resolve();
      const s=document.createElement('script'); s.src=src; s.async=true; s.crossOrigin='anonymous';
      s.onload=()=>resolve(); s.onerror=()=>reject(new Error('Gagal memuat: '+src));
      document.head.appendChild(s);
    });
  }
  async function ensureQRCode(){
    if (window.QRCode) return;
    const locals=['./qrlib.js','./qrcode.min.js','./vendor/qrcode.min.js'];
    for(const p of locals){ try{ await loadScriptOnce(p); if(window.QRCode) return; }catch(e){} }
    const cdn=['https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
               'https://unpkg.com/qrcodejs@1.0.0/qrcode.min.js',
               'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'];
    for(const u of cdn){ try{ await loadScriptOnce(u); if(window.QRCode) return; }catch(e){} }
    throw new Error('QRCode library tidak tersedia');
  }
  async function ensureHtml5Qrcode(){
    if (window.Html5Qrcode) return;
    const locals=['./html5-qrcode.min.js','./vendor/html5-qrcode.min.js'];
    for(const p of locals){ try{ await loadScriptOnce(p); if(window.Html5Qrcode) return; }catch(e){} }
    const cdn=['https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/minified/html5-qrcode.min.js',
               'https://unpkg.com/html5-qrcode@2.3.8/minified/html5-qrcode.min.js',
               'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js'];
    for(const u of cdn){ try{ await loadScriptOnce(u); if(window.Html5Qrcode) return; }catch(e){} }
    throw new Error('html5-qrcode tidak tersedia');
  }

  /* ------------ Auth mini ------------ */
  const getCurrentUser = ()=>{ try{return JSON.parse(localStorage.getItem('currentUser')||'null');}catch(e){return null;} };
  const setCurrentUser = (u)=> localStorage.setItem('currentUser', JSON.stringify(u||null));
  const logout = ()=>{ setCurrentUser(null); location.href='index.html'; };

  /* ------------ Dashboard ------------ */
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
      const low = items.filter(it => Number(it.stock||0) <= Number(it.min||0)).length;
      $('#metric-low-stock').textContent = low;
      $('#metric-users').textContent = users.length;
      $('#metric-txn').textContent = 0;

      const ctx1 = $('#chart-monthly');
      if (ctx1){
        chartLine?.destroy();
        chartLine = new Chart(ctx1, {
          type:'line',
          data:{
            labels: series.map(s=>s.month||''),
            datasets:[
              { label:'IN', data: series.map(s=>Number(s.in||0)), borderWidth:2 },
              { label:'OUT', data: series.map(s=>Number(s.out||0)), borderWidth:2 }
            ]
          },
          options:{ responsive:true, maintainAspectRatio:false }
        });
      }
      const ctx2 = $('#chart-pie');
      if (ctx2){
        chartPie?.destroy();
        const last = series.length ? series[series.length-1] : {in:0,out:0};
        chartPie = new Chart(ctx2, {
          type:'pie',
          data:{ labels:['IN','OUT'], datasets:[{ data:[Number(last.in||0), Number(last.out||0)] }] },
          options:{ responsive:true, maintainAspectRatio:false }
        });
      }
      $('#tbl-mov').innerHTML = '';
    }catch(e){
      console.error(e);
      toast('ダッシュボードの読み込みに失敗しました。');
    }
  }

  /* ------------ Items list + Edit + Label ------------ */
  let _ITEMS_CACHE = [];

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
  const escapeAttr = (s)=>escapeHtml(s);

  function tplItemRow(it){
    const qrid = `qr-${it.code}`;
    return `<tr>
      <td style="width:170px"><div id="${qrid}" class="d-inline-block"></div></td>
      <td>${escapeHtml(it.code)}</td>
      <td><a href="#" class="link-underline link-item" data-code="${escapeAttr(it.code)}">${escapeHtml(it.name)}</a></td>
      <td>${it.img ? `<img src="${escapeAttr(it.img)}" alt="" style="height:32px">` : ''}</td>
      <td class="text-end">¥${fmt(it.price)}</td>
      <td class="text-end">${fmt(it.stock)}</td>
      <td class="text-end">${fmt(it.min)}</td>
      <td>${escapeHtml(it.location||'')}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-primary btn-edit" data-code="${escapeAttr(it.code)}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-danger btn-del" data-code="${escapeAttr(it.code)}"><i class="bi bi-trash"></i></button>
        <button class="btn btn-sm btn-outline-success btn-dl" data-code="${escapeAttr(it.code)}">DL</button>
        <button class="btn btn-sm btn-outline-secondary btn-preview" data-code="${escapeAttr(it.code)}"><i class="bi bi-search"></i></button>
      </td>
    </tr>`;
  }

  async function renderItems(){
    try{
      const list = await api('items',{method:'GET'});
      _ITEMS_CACHE = list;
      const tbody = $('#tbl-items');
      tbody.innerHTML = list.map(tplItemRow).join('');

      await ensureQRCode();
      for(const it of list){
        const holder = document.getElementById(`qr-${it.code}`);
        if(!holder) continue;
        holder.innerHTML = '';
        new QRCode(holder, { text:`ITEM|${it.code}`, width:64, height:64, correctLevel: QRCode.CorrectLevel.M });
      }

      tbody.addEventListener('click', async (e)=>{
        const btn = e.target.closest('button'); if(!btn) return;
        const code = btn.getAttribute('data-code');
        if(btn.classList.contains('btn-edit')) openEditItem(code);
        else if(btn.classList.contains('btn-del')){
          if(!confirm('削除しますか？')) return;
          const r = await api('deleteItem',{method:'POST', body:{ code }});
          if(r?.ok) renderItems(); else toast(r?.error||'削除失敗');
        }else if(btn.classList.contains('btn-dl')){
          const it = _ITEMS_CACHE.find(x=>String(x.code)===String(code));
          const url = await makeItemLabelDataURL(it);
          const a=document.createElement('a'); a.href=url; a.download=`label_${it.code}.png`; a.click();
        }else if(btn.classList.contains('btn-preview')){
          const it = _ITEMS_CACHE.find(x=>String(x.code)===String(code));
          const url = await makeItemLabelDataURL(it);
          openPreview(url);
        }
      });

      $$('#tbl-items .link-item').forEach(a=>{
        a.addEventListener('click',(ev)=>{
          ev.preventDefault();
          const code=a.dataset.code;
          const it=_ITEMS_CACHE.find(x=>String(x.code)===String(code));
          showItemDetail(it);
        });
      });

      $('#items-search')?.addEventListener('input',(e)=>{
        const q=(e.target.value||'').toLowerCase();
        $$('#tbl-items tr').forEach(tr=>{
          const name=(tr.children[2]?.textContent||'').toLowerCase();
          tr.style.display = name.includes(q)?'':'none';
        });
      });
    }catch(e){ console.error(e); toast('商品一覧の読み込みに失敗しました。'); }
  }

  /* ---- Edit item modal ---- */
  function openEditItem(code){
    const it = _ITEMS_CACHE.find(x=>String(x.code)===String(code)); if(!it) return;
    const wrap=document.createElement('div'); wrap.className='modal fade';
    wrap.innerHTML=`
<div class="modal-dialog"><div class="modal-content">
  <div class="modal-header"><h5 class="modal-title">商品編集</h5>
    <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
  <div class="modal-body">
    <div class="row g-3">
      <div class="col-md-6"><label class="form-label">コード</label><input id="md-code" class="form-control" value="${escapeAttr(it.code)}" readonly></div>
      <div class="col-md-6"><label class="form-label">名称</label><input id="md-name" class="form-control" value="${escapeAttr(it.name)}"></div>
      <div class="col-md-4"><label class="form-label">価格</label><input id="md-price" type="number" class="form-control" value="${Number(it.price||0)}"></div>
      <div class="col-md-4"><label class="form-label">在庫</label><input id="md-stock" type="number" class="form-control" value="${Number(it.stock||0)}"></div>
      <div class="col-md-4"><label class="form-label">最小</label><input id="md-min" type="number" class="form-control" value="${Number(it.min||0)}"></div>
      <div class="col-md-8"><label class="form-label">画像URL</label><input id="md-img" class="form-control" value="${escapeAttr(it.img||'')}"></div>
      <div class="col-md-4"><label class="form-label">置場</label>
        <input id="md-location" class="form-control text-uppercase" value="${escapeAttr(it.location||'')}" placeholder="A-01-03">
      </div>
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-secondary" data-bs-dismiss="modal">閉じる</button>
    <button class="btn btn-primary" id="md-save">保存</button>
  </div>
</div></div>`;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap); modal.show();

    $('#md-location',wrap)?.addEventListener('input',(e)=>{
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g,'');
    });

    $('#md-save',wrap)?.addEventListener('click', async ()=>{
      try{
        const payload={
          code: $('#md-code',wrap).value,
          name: $('#md-name',wrap).value,
          price: Number($('#md-price',wrap).value||0),
          stock: Number($('#md-stock',wrap).value||0),
          min:   Number($('#md-min',wrap).value||0),
          img:   $('#md-img',wrap).value,
          location: ($('#md-location',wrap).value||'').toUpperCase().trim(),
          overwrite:true
        };
        const r=await api('updateItem',{method:'POST',body:payload});
        if(r?.ok){ modal.hide(); wrap.remove(); renderItems(); } else toast(r?.error||'保存失敗');
      }catch(e){ console.error(e); toast('保存失敗: '+(e?.message||e)); }
    });

    wrap.addEventListener('hidden.bs.modal',()=>wrap.remove(),{once:true});
  }

  function showItemDetail(it){
    const card=$('#card-item-detail'); if(!card) return;
    const body=$('#item-detail-body',card);
    body.innerHTML=`
      <div class="d-flex gap-3">
        <div style="width:160px;height:120px;background:#f3f6ff;border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden">
          ${it.img?`<img src="${escapeAttr(it.img)}" style="max-width:100%;max-height:100%">`:'<span class="text-primary">画像</span>'}
        </div>
        <div class="flex-1">
          <div><b>コード</b>：${escapeHtml(it.code)}</div>
          <div><b>名称</b>：${escapeHtml(it.name)}</div>
          <div><b>価格</b>：¥${fmt(it.price)}</div>
          <div><b>在庫</b>：${fmt(it.stock)}</div>
          <div><b>最小</b>：${fmt(it.min)}</div>
          <div><b>置場</b>：<span class="badge text-bg-light border">${escapeHtml(it.location||'')}</span></div>
        </div>
      </div>`;
    card.classList.remove('d-none');
    $('#btn-close-detail')?.addEventListener('click',()=>card.classList.add('d-none'),{once:true});
  }
  function openPreview(url){ const w=window.open('','_blank','width=900,height=600'); w.document.write(`<img src="${url}" style="max-width:100%">`); }

  /* ---- Label generator presisi ---- */
  async function makeItemLabelDataURL(item){
    const W=760,H=260,pad=16, imgW=200, gap=14;
    const qrBox=H-2*pad, qrSize=Math.min(180,qrBox), QUIET=10;
    const colQRW=qrSize+2*QUIET, gridX=pad+imgW+gap+colQRW+gap;

    const c=document.createElement('canvas'); c.width=W; c.height=H;
    const g=c.getContext('2d'); g.imageSmoothingEnabled=false;
    g.fillStyle='#fff'; g.fillRect(0,0,W,H);
    g.strokeStyle='#000'; g.lineWidth=2; g.strokeRect(1,1,W-2,H-2);

    const rx=pad, ry=pad, rw=imgW, rh=H-2*pad, r=18;
    roundRect(g,rx,ry,rw,rh,r,true,true,'#eaf1ff','#cbd5e1'); await drawImageIfAny(g,item.img,rx,ry,rw,rh,r);

    const qx = pad+imgW+gap+QUIET + Math.max(0,(qrBox-qrSize)/2);
    const qy = pad + Math.max(0,(qrBox-qrSize)/2);
    g.fillStyle='#fff'; g.fillRect(qx-QUIET,qy-QUIET, qrSize+2*QUIET, qrSize+2*QUIET);
    try{ const du=await generateQrDataUrl(`ITEM|${item.code}`,qrSize); const im=new Image(); im.src=du; await imgLoaded(im); g.drawImage(im,qx,qy,qrSize,qrSize);}catch(e){}

    const cellH=(H-2*pad)/3;
    g.strokeStyle='#000'; g.lineWidth=2;
    g.strokeRect(gridX,pad, W-gridX-pad, H-2*pad);
    for(let i=1;i<=2;i++){ const y=pad+cellH*i; g.beginPath(); g.moveTo(gridX,y); g.lineTo(W-pad,y); g.stroke(); }

    const labelX=gridX+12, valX=gridX+112, valMaxW=W-pad-valX-8;
    g.textAlign='left'; g.textBaseline='middle'; g.fillStyle='#000';
    g.font='18px "Noto Sans JP",system-ui';
    g.fillText('コード：', labelX, pad+cellH*0.5);
    g.fillText('商品名：', labelX, pad+cellH*1.5);
    g.fillText('置場：',   labelX, pad+cellH*2.5);

    g.font='bold 22px "Noto Sans JP",system-ui';
    drawSingleLineFit(g,String(item.code||''),valX,pad+cellH*0.5,valMaxW);
    drawWrapAuto(g,String(item.name||''),valX,pad+cellH*1.5,valMaxW,{maxLines:2,base:22,min:16,lineGap:4});
    g.font='bold 20px "Noto Sans JP",system-ui';
    drawSingleLineFit(g,String(item.location||'').toUpperCase(),valX,pad+cellH*2.5,valMaxW);

    return c.toDataURL('image/png');

    function roundRect(ctx,x,y,w,h,r,fill,stroke,fillColor,border){
      ctx.save(); ctx.beginPath();
      ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
      ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
      if(fill){ ctx.fillStyle=fillColor||'#eef'; ctx.fill(); }
      if(stroke){ ctx.strokeStyle=border||'#000'; ctx.stroke(); }
      ctx.restore();
    }
    function imgLoaded(im){ return new Promise(res=>{ im.onload=res; im.onerror=res; }); }
    async function drawImageIfAny(ctx,url,x,y,w,h,rr){
      if(!url){ ctx.save(); ctx.fillStyle='#3B82F6'; ctx.font='bold 28px "Noto Sans JP",system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('画像',x+w/2,y+h/2); ctx.restore(); return; }
      try{
        const im=new Image(); im.crossOrigin='anonymous'; im.src=url; await imgLoaded(im);
        const s=Math.min(w/im.width,h/im.height), iw=im.width*s, ih=im.height*s;
        const ix=x+(w-iw)/2, iy=y+(h-ih)/2;
        ctx.save(); ctx.beginPath();
        ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr); ctx.arcTo(x+w,y+h,x,y+h,rr);
        ctx.arcTo(x,y+h,x,y,rr); ctx.arcTo(x,y,x+w,y,rr); ctx.closePath(); ctx.clip();
        ctx.drawImage(im,ix,iy,iw,ih); ctx.restore();
      }catch(e){}
    }
    function drawSingleLineFit(ctx,text,x,y,maxW){
      let size=parseInt((ctx.font.match(/(\d+)px/)||[])[1]||22,10);
      const fam=ctx.font.split(' ').slice(1).join(' ');
      while(ctx.measureText(text).width>maxW && size>12){ size--; ctx.font=`bold ${size}px ${fam}`; }
      ctx.fillText(text,x,y);
    }
    function splitByWidth(ctx,text,maxW){
      const arr=[...String(text)]; const lines=[]; let buf='';
      for(const ch of arr){ const t=buf+ch; if(ctx.measureText(t).width<=maxW) buf=t; else { if(buf) lines.push(buf); buf=ch; } }
      if(buf) lines.push(buf); return lines;
    }
    function drawWrapAuto(ctx,text,x,centerY,maxW,opt){
      const base=opt.base||22, min=opt.min||16, gap=opt.lineGap||4, maxLines=opt.maxLines||2;
      const fam=ctx.font.split(' ').slice(1).join(' '); let size=base, lines;
      while(true){ ctx.font=`bold ${size}px ${fam}`; lines=splitByWidth(ctx,text,maxW); if(lines.length<=maxLines || size<=min) break; size--; }
      if(lines.length>maxLines){ lines=lines.slice(0,maxLines); let last=lines[lines.length-1]; while(ctx.measureText(last+'…').width>maxW && last.length>0) last=last.slice(0,-1); lines[lines.length-1]=last+'…'; }
      const totalH=lines.length*size+(lines.length-1)*gap; let y=centerY-totalH/2+size/2; for(const ln of lines){ ctx.fillText(ln,x,y); y+=size+gap; }
    }
  }
  async function generateQrDataUrl(text,size){
    await ensureQRCode();
    return await new Promise((resolve)=>{
      const tmp=document.createElement('div');
      new QRCode(tmp,{text,width:size,height:size,correctLevel:QRCode.CorrectLevel.M});
      setTimeout(()=>{ const img=tmp.querySelector('img')||tmp.querySelector('canvas'); let url=''; try{ url=img.tagName==='IMG'?img.src:img.toDataURL('image/png'); }catch(e){} tmp.remove(); resolve(url); },0);
    });
  }

  /* ------------ Users / QR ------------ */
  async function renderUsers(){
    try{
      const list = await api('users',{method:'GET'});
      const tbody = $('#tbl-userqr');
      tbody.innerHTML = list.map(u=>`
        <tr>
          <td style="width:170px"><div id="uqr-${escapeAttr(u.id)}"></div></td>
          <td>${escapeHtml(u.id)}</td>
          <td>${escapeHtml(u.name)}</td>
          <td>${escapeHtml(u.role||'user')}</td>
          <td class="text-end"><button class="btn btn-sm btn-outline-success btn-dl-user" data-id="${escapeAttr(u.id)}">DL</button></td>
        </tr>`).join('');
      await ensureQRCode();
      for(const u of list){
        const el=document.getElementById(`uqr-${u.id}`); if(!el) continue;
        el.innerHTML=''; new QRCode(el,{text:`USER|${u.id}`,width:64,height:64,correctLevel:QRCode.CorrectLevel.M});
      }
      tbody.addEventListener('click', async (e)=>{
        const b=e.target.closest('.btn-dl-user'); if(!b) return;
        const id=b.dataset.id; const url=await generateQrDataUrl(`USER|${id}`,300);
        const a=document.createElement('a'); a.href=url; a.download=`user_${id}.png`; a.click();
      });
    }catch(e){ console.error(e); toast('ユーザーQRの読み込みに失敗しました。'); }
  }

  /* ------------ History ------------ */
  async function renderHistory(){
    try{
      const list = await api('history',{method:'GET'});
      const tbody=$('#tbl-history'); const recent=list.slice(-400).reverse();
      tbody.innerHTML = recent.map(h=>`
        <tr>
          <td>${escapeHtml(h.timestamp)}</td>
          <td>${escapeHtml(h.userId)}</td>
          <td>${escapeHtml(h.userName||'')}</td>
          <td>${escapeHtml(h.code)}</td>
          <td>${escapeHtml(h.itemName||'')}</td>
          <td class="text-end">${fmt(h.qty)}</td>
          <td>${escapeHtml(h.unit)}</td>
          <td>${escapeHtml(h.type)}</td>
          <td>${escapeHtml(h.note||'')}</td>
          <td></td>
        </tr>`).join('');
    }catch(e){ console.error(e); toast('履歴の読み込みに失敗しました。'); }
  }

  /* ------------ IO (scan & log) ------------ */
  let IO_SCANNER=null;

  async function startBackCameraScan(mountId,onScan,boxSize=(isMobile()?170:190)){
    const mount=document.getElementById(mountId);
    if(mount){ mount.style.maxWidth=isMobile()?'340px':'400px'; mount.style.margin='0 auto'; mount.style.aspectRatio='4/3'; mount.style.position='relative'; }

    if('BarcodeDetector' in window){
      try{ return await startNativeDetector(mountId,onScan,boxSize); }catch(e){ console.warn('BarcodeDetector fallback',e); }
    }
    await ensureHtml5Qrcode(); if(!window.Html5Qrcode) throw new Error('html5-qrcode tidak tersedia');

    const cfg={
      fps:24, qrbox:{width:boxSize,height:boxSize}, aspectRatio:1.33,
      rememberLastUsedCamera:true, disableFlip:true,
      videoConstraints:{ facingMode:{ideal:'environment'}, width:{ideal:640}, height:{ideal:480}, focusMode:'continuous', exposureMode:'continuous' }
    };
    const scanner=new Html5Qrcode(mountId,{useBarCodeDetectorIfSupported:true});
    async function startWith(source){
      await scanner.start(source,cfg,txt=>onScan(txt));
      try{ await scanner.applyVideoConstraints({advanced:[{focusMode:'continuous'},{exposureMode:'continuous'},{zoom:2}]}).catch(()=>{}); }catch(e){}
      return scanner;
    }
    try{ return await startWith({facingMode:'environment'}); }
    catch(err1){
      try{
        const cams=await Html5Qrcode.getCameras(); if(!cams?.length) throw err1;
        const back=cams.find(c=>/back|rear|environment/i.test(c.label))||cams.at(-1);
        return await startWith({deviceId:{exact:back.id}});
      }catch(err2){ await scanner?.stop?.(); scanner?.clear?.(); throw new Error('カメラが見つかりません。権限/ネットワークをご確認ください。'); }
    }
  }
  async function startNativeDetector(mountId,onScan){
    const mount=document.getElementById(mountId); mount.innerHTML='';
    const video=document.createElement('video'); video.playsInline=true; video.autoplay=true; video.muted=true;
    video.style.width='100%'; video.style.height='100%'; video.style.objectFit='cover'; mount.appendChild(video);
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:640},height:{ideal:480}},audio:false});
    video.srcObject=stream;
    const detector=new BarcodeDetector({formats:['qr_code']});
    let raf=0; const scan=async()=>{ try{ const codes=await detector.detect(video); if(codes?.length){ const txt=codes[0].rawValue||''; if(txt){ cancelAnimationFrame(raf); stream.getTracks().forEach(t=>t.stop()); onScan(txt); return; } } }catch(e){} raf=requestAnimationFrame(scan); };
    raf=requestAnimationFrame(scan);
    return { stop:()=>{ cancelAnimationFrame(raf); stream.getTracks().forEach(t=>t.stop()); }, clear:()=>{ mount.innerHTML=''; } };
  }

  (function bindIO(){
    const btnStart=$('#btn-io-scan'), btnStop=$('#btn-io-stop'), area=$('#io-scan-area');
    if(!btnStart||!btnStop||!area) return;
    btnStart.addEventListener('click', async ()=>{
      try{
        area.textContent='カメラ起動中…';
        IO_SCANNER = await startBackCameraScan('io-scan-area',(text)=>{
          const code=(String(text||'').split('|')[1]||'').trim();
          if(code){ $('#io-code').value=code; findItemIntoIO(code); }
        });
      }catch(e){ toast(e?.message||String(e)); }
    });
    btnStop.addEventListener('click', async ()=>{ try{ await IO_SCANNER?.stop?.(); IO_SCANNER?.clear?.(); }catch(e){} area.innerHTML='カメラ待機中…'; });
    $('#btn-io-lookup')?.addEventListener('click',()=>{ const code=($('#io-code').value||'').trim(); if(code) findItemIntoIO(code); });
    $('#form-io')?.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const who=getCurrentUser(); if(!who) return toast('ログイン情報がありません。');
      const code=$('#io-code').value, qty=Number($('#io-qty').value||0), unit=$('#io-unit').value, type=$('#io-type').value;
      try{
        const r=await api('log',{method:'POST',body:{userId:who.id,code,qty,unit,type}});
        if(r?.ok){ toast('登録しました'); $('#io-qty').value=''; await findItemIntoIO(code); renderDashboard(); }
        else toast(r?.error||'登録失敗');
      }catch(e){ toast('登録失敗: '+(e?.message||e)); }
    });
  })();

  async function findItemIntoIO(code){
    try{
      let it = _ITEMS_CACHE.find(x=>String(x.code)===String(code));
      if(!it){ const r=await api('itemByCode',{method:'POST',body:{code}}); it=r?.ok?r.item:null; }
      if(!it) return;
      $('#io-name').value=it.name||''; $('#io-price').value=it.price||0; $('#io-stock').value=it.stock||0;
    }catch(e){ console.warn(e); }
  }

  /* ------------ History/Users tab auto render on click akan dipanggil dari nav fail-safe di HTML ------------ */

  /* ------------ Boot ------------ */
  window.addEventListener('DOMContentLoaded', ()=>{
    renderDashboard();
    $('#btn-logout')?.addEventListener('click', logout);
    // exposer untuk nav
    window.renderItems = renderItems;
    window.renderUsers = renderUsers;
    window.renderHistory = renderHistory;
  });
})();
