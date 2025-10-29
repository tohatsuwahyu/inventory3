/* =========================================================
 * login.js — Login USER+PIN & QR (versi cepat)
 * - Auto-load html5-qrcode (lokal + 3 CDN fallback)
 * - Scan lebih cepat: 640x480, fps 24, qrbox kecil, autofocus/autoexposure
 * - Manual login panggil GAS: action=login
 * - QR login: USER|<id>  atau  LOGIN|<id>|<pin>  atau JSON setara
 * =======================================================*/
(function(){
  const qs = (s, el=document)=>el.querySelector(s);

  /* ---------- GAS API ---------- */
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
    if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
    return r.json();
  }

  /* ---------- Helpers ---------- */
  function toast(m){ alert(m); }
  function loadScriptOnce(src){
    return new Promise((resolve,reject)=>{
      if ([...document.scripts].some(s=>s.src===src || s.src.endsWith(src))) return resolve();
      const s=document.createElement('script');
      s.src=src; s.async=true; s.crossOrigin='anonymous';
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
      'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js'
    ];
    for(const u of cdns){ try{ await loadScriptOnce(u); if(window.Html5Qrcode) return; }catch{} }
    throw new Error('html5-qrcode tidak tersedia');
  }

  /* ---------- Manual login ---------- */
  const $id=qs('#login-user'), $pin=qs('#login-pin'), $btn=qs('#btn-login');
  $btn?.setAttribute('type','button');
  $btn?.addEventListener('click', async (e)=>{
    e.preventDefault();
    const id=($id?.value||'').trim(), pin=($pin?.value||'').trim();
    if(!id) return toast('ユーザーIDを入力してください。');
    try{
      const r=await api('login',{method:'POST',body:{id,pass:pin}});
      if(!r || r.ok===false) return toast(r?.error||'ログインに失敗しました。');
      localStorage.setItem('currentUser', JSON.stringify(r.user));
      location.href='dashboard.html';
    }catch(err){ toast('ログイン失敗: '+(err?.message||err)); }
  });
  [$id,$pin].forEach(el=>el?.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $btn?.click(); }}));

  /* ---------- QR login (versi cepat) ---------- */
  let scanner=null;
  const $btnQR = qs('#btn-qr');
  const $area  = (()=>{
    let a = qs('#qr-area');
    if(!a){ a=document.createElement('div'); a.id='qr-area'; document.body.appendChild(a); }
    Object.assign(a.style,{
      display:'none', width:'100%', maxWidth:'400px', aspectRatio:'4 / 3',
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

  async function startQR(){
    try{
      await ensureHtml5();
      $area.style.display='block';

      // ——— setting cepat: fps tinggi + resolusi 640x480 + kotak kecil
      const cfg = {
        fps: 24,
        qrbox: { width: (innerWidth<480? 160:180), height: (innerWidth<480? 160:180) },
        aspectRatio: 1.33,
        rememberLastUsedCamera: true,
        disableFlip: true,
        videoConstraints:{
          facingMode:{ ideal:'environment' },
          width:{ ideal:640 }, height:{ ideal:480 },
          focusMode:'continuous', exposureMode:'continuous'
        }
      };

      scanner = new Html5Qrcode('qr-area', { useBarCodeDetectorIfSupported:true });

      const onScan = async (txt)=>{
        const p = parseQR(txt);
        if(!p) return;                // bukan format kita → abaikan
        await stopQR();               // hentikan agar tak dobel
        try{
          const r = (p.kind==='byId')
            ? await api('loginById',{method:'POST',body:{id:p.id}})
            : await api('login',{method:'POST',body:{id:p.id,pass:p.pin}});
          if(!r || r.ok===false) return toast(r?.error||'ログインに失敗しました。');
          localStorage.setItem('currentUser', JSON.stringify(r.user));
          location.href='dashboard.html';
        }catch(err){ toast('QRログイン失敗: '+(err?.message||err)); }
      };

      async function startWith(source){
        await scanner.start(source, cfg, onScan);
        // dorong autofocus/autoexposure/zoom (jika didukung)
        try{
          await scanner.applyVideoConstraints({
            advanced: [{focusMode:'continuous'},{exposureMode:'continuous'},{zoom:2}]
          }).catch(()=>{});
        }catch{}
        return scanner;
      }

      try{
        await startWith({ facingMode:'environment' });
      }catch(_){
        const cams = await Html5Qrcode.getCameras();
        const back = cams.find(c=>/back|rear|environment/i.test(c.label)) || cams.at(-1);
        await startWith({ deviceId:{ exact: back.id } });
      }
    }catch(err){
      toast('QRログインを開始できませんでした: '+(err?.message||err));
      try{ await stopQR(); }catch{}
    }
  }
  async function stopQR(){ try{ await scanner?.stop?.(); scanner?.clear?.(); }catch{} scanner=null; $area.style.display='none'; }

  $btnQR?.addEventListener('click',e=>{ e.preventDefault(); (scanner? stopQR(): startQR()); });
})();
