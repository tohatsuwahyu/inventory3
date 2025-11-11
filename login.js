/* =========================================================
 * login.js — Login USER+PIN & QR (fast scan, mobile-safe)
 * =======================================================*/
(function(){
  "use strict";
  const qs = (s, el=document)=>el.querySelector(s);
  const isPhone = /Android|iPhone|iPad/i.test(navigator.userAgent);

  /* CSS anti overlay/tap miss */
  (function injectTapCss(){
    const css = `
      #qr-area{ position:relative; z-index:1; }
      #global-loading{ pointer-events:none !important; }
      button, a, input, label{ touch-action:manipulation; -webkit-tap-highlight-color:transparent; }
      .html5-qrcode-element{ display:none !important; }
    `.trim();
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  })();

  // ==== Lightweight loading overlay khusus halaman login ====
  function ensureLoading(){
    let el = document.getElementById('global-loading');
    if(!el){
      el = document.createElement('div');
      el.id = 'global-loading';
      el.className = 'd-none';
      el.innerHTML = `
        <div class="box" style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:16px 18px;background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 8px 26px rgba(15,23,42,.06)">
          <div class="spinner" style="width:28px;height:28px;border-radius:50%;border:3px solid #cbd5e1;border-top-color:#2563eb;animation:spin 1s linear infinite"></div>
          <div id="loading-text" class="text" style="font-size:.95rem;color:#475569">読み込み中…</div>
        </div>`;
      Object.assign(el.style, {position:'fixed', inset:'0', background:'rgba(255,255,255,.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:'2000'});
      const kf = document.createElement('style'); kf.textContent='@keyframes spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(kf);
      document.body.appendChild(el);
    }
    return el;
  }
  function setLoading(show, text){
    const el = ensureLoading();
    const boxText = document.getElementById('loading-text');
    if(show){
      el.classList.remove('d-none');
      if(boxText) boxText.textContent = text || '読み込み中…';
    }else{
      el.classList.add('d-none');
    }
  }

  /* API */
  async function api(action, {method='GET', body}={}){
    if(!window.CONFIG || !CONFIG.BASE_URL) throw new Error('config.js belum ter-load / BASE_URL kosong');
    const apikey = encodeURIComponent(CONFIG.API_KEY||'');
    const url = `${CONFIG.BASE_URL}?action=${encodeURIComponent(action)}&apikey=${apikey}&_=${Date.now()}`;
    if(method==='GET'){
      const r = await fetch(url,{mode:'cors',cache:'no-cache'}); if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
      return r.json();
    }
    const r = await fetch(url,{
      method:'POST', mode:'cors',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({ ...(body||{}), apikey: CONFIG.API_KEY })
    });
    if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`); return r.json();
  }

  function toast(m){ alert(m); }
  function loadScriptOnce(src){
    return new Promise((resolve,reject)=>{
      if ([...document.scripts].some(s=>s.src===src || s.src.endsWith(src))) return resolve();
      const s=document.createElement('script'); s.src=src; s.async=true; s.crossOrigin='anonymous';
      s.onload=()=>resolve(); s.onerror=()=>reject(new Error('gagal memuat: '+src));
      document.head.appendChild(s);
    });
  }
  async function ensureHtml5(){
    if (window.Html5Qrcode) return;
    const locals=['./vendor/html5-qrcode.min.js','./html5-qrcode.min.js'];
    for(const p of locals){ try{ await loadScriptOnce(p); if(window.Html5Qrcode) return; }catch{} }
    const cdns=[
      'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/minified/html5-qrcode.min.js',
      'https://unpkg.com/html5-qrcode@2.3.8/minified/html5-qrcode.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/minified/html5-qrcode.min.js'
    ];
    for(const u of cdns){ try{ await loadScriptOnce(u); if(window.Html5Qrcode) return; }catch{} }
    throw new Error('html5-qrcode tidak tersedia');
  }

  /* Tap binding aman */
  function bindTap(el, handler){
    if(!el) return;
    let locked=false;
    const wrap=(e)=>{ if(locked){ e.preventDefault(); return; } locked=true; setTimeout(()=>locked=false,350); e.preventDefault(); handler(e); };
    el.addEventListener('click', wrap, false);
    el.addEventListener('touchend', wrap, { passive:false });
  }

  /* Manual login */
  const $id=qs('#login-user'), $pin=qs('#login-pin'), $btn=qs('#btn-login');
  $btn?.setAttribute('type','button');
  bindTap($btn, async ()=>{
    const id=($id?.value||'').trim(), pin=($pin?.value||'').trim();
    if(!id) return toast('ユーザーIDを入力してください。');
    try{
      setLoading(true, 'ログイン中…');
      const r=await api('login',{method:'POST',body:{id,pass:pin}});
      if(!r || r.ok===false){ setLoading(false); return toast(r?.error||'ログインに失敗しました。'); }
      localStorage.setItem('currentUser', JSON.stringify(r.user));
      setLoading(true, 'ダッシュボードへ移動中…');
      location.href='dashboard.html';
    }catch(err){ setLoading(false); toast('ログイン失敗: '+(err?.message||err)); }
  });
  [$id,$pin].forEach(el=>el?.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $btn?.click(); }}));

  /* QR login */
  let scanner=null, nativeRunner=null, stream=null;
  const $btnQR   = qs('#btn-qr');
  const $btnQR2  = qs('#btn-qr-alt');
  const $area  = (()=>{
    let a = qs('#qr-area');
    if(!a){ a=document.createElement('div'); a.id='qr-area'; document.body.appendChild(a); }
    Object.assign(a.style,{
      display:'none', width:'100%', maxWidth:'420px', aspectRatio:'4 / 3',
      margin:'12px auto', borderRadius:'12px', overflow:'hidden', background:'#0b0b0b10'
    });
    return a;
  })();

  function parseQR(text){
    if(/^USER\|/i.test(text))  return {kind:'byId',   id:(text.split('|')[1]||'')};
    if(/^LOGIN\|/i.test(text)){ const [,id,pin]=text.split('|'); return {kind:'withPin', id:(id||''), pin:(pin||'')}; }
    try{
      const o=JSON.parse(text);
      if((o.type==='USER'||o.t==='USER') && o.id)   return {kind:'byId',   id:String(o.id)};
      if((o.type==='LOGIN'||o.t==='LOGIN') && o.id) return {kind:'withPin', id:String(o.id), pin:String(o.pin||'')};
    }catch(_){}
    return null;
  }

  async function onScan(txt){
    const p = parseQR(String(txt||'')); if(!p) return;
    await stopQR();
    try{
      setLoading(true, 'QRでログイン中…');
      const r = (p.kind==='byId')
        ? await api('loginById',{method:'POST',body:{id:p.id}})
        : await api('login',{method:'POST',body:{id:p.id,pass:p.pin}});
      if(!r || r.ok===false){ setLoading(false); return toast(r?.error||'ログインに失敗しました。'); }
      localStorage.setItem('currentUser', JSON.stringify(r.user));
      setLoading(true, 'ダッシュボードへ移動中…');
      location.href='dashboard.html';
    }catch(err){ setLoading(false); toast('QRログイン失敗: '+(err?.message||err)); }
  }

  async function startNative(){
    if(!('BarcodeDetector' in window)) return false;
    try{
      $area.style.display='block'; $area.style.pointerEvents='auto';
      const video=document.createElement('video'); Object.assign(video,{ playsInline:true, autoplay:true, muted:true });
      Object.assign(video.style,{ width:'100%', height:'100%', objectFit:'cover' });
      $area.innerHTML=''; $area.appendChild(video);

      const devs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
      const back = devs.find(d=>/back|rear|environment/i.test(d.label)) || devs.at(-1);

      stream = await navigator.mediaDevices.getUserMedia({
        video:{ deviceId: back ? { exact: back.deviceId } : { ideal:'environment' },
          width:{ ideal:1280 }, height:{ ideal:720 }, focusMode:'continuous', exposureMode:'continuous' },
        audio:false
      });
      video.srcObject=stream;

      // beri waktu autofocus/exposure lock
      await new Promise(r=>setTimeout(r, 500));

      const det = new BarcodeDetector({ formats:['qr_code'] });
      let raf=0, stopped=false;
      const loop = async ()=>{
        if(stopped) return;
        try{
          const codes = await det.detect(video);
          if(codes?.length){ const txt = codes[0].rawValue || ''; if(txt){ stop(); await onScan(txt); return; } }
        }catch(_){}
        raf = requestAnimationFrame(loop);
      };
      const stop = ()=>{ stopped=true; cancelAnimationFrame(raf); try{stream?.getTracks()?.forEach(t=>t.stop());}catch{} stream=null; $area.innerHTML=''; };
      loop(); nativeRunner = { stop, clear:()=>{ try{$area.innerHTML='';}catch{} } };
      return true;
    }catch(_){ try{ nativeRunner?.stop?.(); nativeRunner?.clear?.(); }catch{} return false; }
  }

  async function startQR(){
    if(await startNative()) return;
    try{
      await ensureHtml5(); $area.style.display='block'; $area.style.pointerEvents='auto';
      const cfg = {
        fps: 30,
        qrbox:{ width: isPhone? 220 : 240, height: isPhone? 220 : 240 },
        aspectRatio: 1.33,
        rememberLastUsedCamera:true,
        disableFlip:true,
        videoConstraints:{ facingMode:{ ideal:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 }, focusMode:'continuous', exposureMode:'continuous' }
      };
      scanner = new Html5Qrcode('qr-area', { useBarCodeDetectorIfSupported:true });
      async function startWith(source){
        await scanner.start(source, cfg, onScan);
        // jeda kecil untuk autofocus lalu set zoom/constraints
        await new Promise(r=>setTimeout(r, 600));
        try{
          await scanner.applyVideoConstraints({ advanced:[{focusMode:'continuous'},{exposureMode:'continuous'},{zoom:3}] }).catch(()=>{});
        }catch(_){}
        return scanner;
      }
      try{ await startWith({ facingMode:'environment' }); }
      catch(_){
        const cams = await Html5Qrcode.getCameras();
        const back = cams.find(c=>/back|rear|environment/i.test(c.label)) || cams.at(-1);
        await startWith({ deviceId:{ exact: back.id } });
      }
    }catch(err){
      toast('QRログインを開始できませんでした: '+(err?.message||err));
      try{ await stopQR(); }catch{}
    }
  }
  async function stopQR(){
    try{ await scanner?.stop?.(); scanner?.clear?.(); }catch{}
    try{ nativeRunner?.stop?.(); nativeRunner?.clear?.(); }catch{}
    scanner=null; nativeRunner=null; if($area){ $area.style.display='none'; $area.style.pointerEvents='none'; }
  }

  bindTap($btnQR,  ()=>{ (scanner || nativeRunner) ? stopQR() : startQR(); });
  bindTap($btnQR2, ()=>{ (scanner || nativeRunner) ? stopQR() : startQR(); });

})();


// === PATCH: audit log on login success ===
async function _auditLoginSuccess(user){
  try{ await api('log',{ method:'POST', body:{ userId: (user?.id||''), type:'LOGIN', note:'login success' } }); }catch(_){}
}
document.addEventListener('login-success', (e)=> _auditLoginSuccess(e.detail));
