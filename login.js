/* =========================================================
 * login.js — Login via USER+PIN atau QR
 * - Auto-load html5-qrcode bila belum ada
 * - Panggil GAS: action=login / loginById
 * - Cegah submit default agar tidak refresh halaman
 * - Simpan currentUser ke localStorage lalu redirect ke dashboard.html
 * ---------------------------------------------------------
 * Elemen yang diharapkan ada di index.html:
 *   #login-user  (input USER ID)
 *   #login-pin   (input PIN)
 *   #btn-login   (button login manual)
 *   #btn-qr      (button/anchor untuk toggle QR login)
 *   #qr-area     (div area kamera — opsional; dibuat otomatis jika tidak ada)
 * ---------------------------------------------------------
 * config.js harus menyediakan:
 *   window.CONFIG = { BASE_URL: '<GAS WebApp URL>', API_KEY: 'supersecret123' }
 * =======================================================*/

(function(){
  const qs  = (s, el=document)=>el.querySelector(s);

  // ---------- API wrapper (GAS) ----------
  async function api(action, {method='GET', body}={}){
    if(!window.CONFIG || !CONFIG.BASE_URL){
      throw new Error('config.js belum dimuat atau BASE_URL kosong');
    }
    const apikey = encodeURIComponent(CONFIG.API_KEY||'');
    const url = `${CONFIG.BASE_URL}?action=${encodeURIComponent(action)}&apikey=${apikey}&_=${Date.now()}`;

    if(method === 'GET'){
      const r = await fetch(url, { mode:'cors', cache:'no-cache' });
      if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
      return r.json();
    }else{
      const r = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type':'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...(body||{}), apikey: CONFIG.API_KEY })
      });
      if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
      return r.json();
    }
  }

  // ---------- Helpers ----------
  function toast(m){ alert(m); }

  // dynamic loader utk html5-qrcode
  function loadScriptOnce(src){
    return new Promise((res, rej)=>{
      if ([...document.scripts].some(s=>s.src.endsWith(src) || s.src===src)) return res();
      const s=document.createElement('script'); s.src=src; s.async=true;
      s.onload=res; s.onerror=()=>rej(new Error('Gagal memuat: '+src));
      document.head.appendChild(s);
    });
  }
  async function ensureHtml5(){
    if (window.Html5Qrcode) return;
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/minified/html5-qrcode.min.js');
    if (!window.Html5Qrcode) throw new Error('html5-qrcode tidak tersedia');
  }

  // ---------- Login manual ----------
  const $id  = qs('#login-user');
  const $pin = qs('#login-pin');
  const $btn = qs('#btn-login');

  // pastikan tombol tidak trigger submit form default
  $btn?.setAttribute('type','button');

  $btn?.addEventListener('click', async (e)=>{
    e.preventDefault();
    const id  = ($id?.value||'').trim();
    const pin = ($pin?.value||'').trim();
    if(!id){ return toast('ユーザーIDを入力してください。'); }
    try{
      const r = await api('login', { method:'POST', body:{ id, pass:pin }});
      if(!r || r.ok===false) return toast(r?.error || 'ログインに失敗しました。');
      localStorage.setItem('currentUser', JSON.stringify(r.user));
      location.href = 'dashboard.html';
    }catch(err){
      toast('ログインに失敗しました: '+(err?.message||err));
    }
  });

  // Enter key → klik login
  [$id,$pin].forEach(el=> el?.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ e.preventDefault(); $btn?.click(); }
  }));

  // ---------- Login via QR ----------
  let scanner=null;
  const $btnQR = qs('#btn-qr');
  let $area = qs('#qr-area');
  if(!$area){
    $area = document.createElement('div');
    $area.id = 'qr-area';
    document.body.appendChild($area);
  }
  Object.assign($area.style, {
    display:'none', width:'100%', maxWidth:'360px',
    aspectRatio:'4 / 3', margin:'12px auto',
    borderRadius:'12px', overflow:'hidden', background:'#0b0b0b10'
  });

  function parseQR(text){
    // USER|<ID>
    if(/^USER\|/i.test(text)){
      return { kind:'byId', id: text.split('|')[1]||'' };
    }
    // LOGIN|<ID>|<PIN>
    if(/^LOGIN\|/i.test(text)){
      const [,id,pin] = text.split('|');
      return { kind:'withPin', id:(id||''), pin:(pin||'') };
    }
    // JSON { type:"USER", id:"..." } / { type:"LOGIN", id:"...", pin:"..." }
    try{
      const o = JSON.parse(text);
      if((o.type==='USER'||o.t==='USER') && o.id)   return { kind:'byId',   id:String(o.id) };
      if((o.type==='LOGIN'||o.t==='LOGIN') && o.id) return { kind:'withPin', id:String(o.id), pin:String(o.pin||'') };
    }catch(_){}
    return null;
  }

  async function startQR(){
    try{
      await ensureHtml5();
      $area.style.display='block';

      const cfg = {
        fps: 12,
        qrbox: { width: 200, height: 200 },
        aspectRatio: 1.33,
        rememberLastUsedCamera: true,
        disableFlip: true,
        videoConstraints: {
          facingMode: { ideal:'environment' },
          width:  { ideal: 1280 },
          height: { ideal: 720 },
          focusMode: 'continuous'
        }
      };

      scanner = new Html5Qrcode('qr-area', { useBarCodeDetectorIfSupported:true });

      const onScan = async (txt)=>{
        const p = parseQR(txt);
        if(!p) return;                 // format tak dikenali → abaikan
        await stopQR();                // hentikan supaya tidak baca berulang
        try{
          let r;
          if(p.kind==='byId'){
            r = await api('loginById', { method:'POST', body:{ id:p.id }});
          }else{
            r = await api('login', { method:'POST', body:{ id:p.id, pass:p.pin }});
          }
          if(!r || r.ok===false) return toast(r?.error || 'ログインに失敗しました。');
          localStorage.setItem('currentUser', JSON.stringify(r.user));
          location.href = 'dashboard.html';
        }catch(err){
          toast('QRログイン失敗: '+(err?.message||err));
        }
      };

      // start → fallback deviceId
      try{
        await scanner.start({ facingMode:'environment' }, cfg, onScan);
      }catch(_){
        const cams = await Html5Qrcode.getCameras();
        const back = cams.find(c=>/back|rear|environment/i.test(c.label)) || cams.at(-1);
        await scanner.start({ deviceId:{ exact: back.id } }, cfg, onScan);
      }
    }catch(err){
      toast('QRログインを開始できませんでした: '+(err?.message||err));
      try{ await stopQR(); }catch{}
    }
  }

  async function stopQR(){
    try{ await scanner?.stop?.(); scanner?.clear?.(); }catch{}
    scanner = null;
    $area.style.display='none';
  }

  $btnQR?.addEventListener('click', (e)=>{
    e.preventDefault();
    if(scanner) stopQR(); else startQR();
  });
})();
