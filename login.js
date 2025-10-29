/* ============================
 * login.js — QR & password login
 * ============================
 * Elemen yang diasumsikan ada di index.html:
 *  - input#login-user   → USER ID
 *  - input#login-pin    → PIN (boleh kosong jika loginById)
 *  - button#btn-login   → login biasa
 *  - button#btn-qr      → buka scanner QR
 *  - div#qr-area        → area kamera (boleh kosong; akan dibuat kalau tidak ada)
 *
 * QR yang diterima:
 *  - "USER|<ID>"          → loginById
 *  - {"type":"USER","id":"<ID>"}  → loginById
 *  - "LOGIN|<ID>|<PIN>"   → login(id+pin)
 */

(function(){
  const qs  = (s, el=document)=>el.querySelector(s);
  const fmt = (n)=>new Intl.NumberFormat('ja-JP').format(n??0);

  // ===== API ke GAS (samakan dengan app.js) =====
  async function api(action, {method='GET', body, showLoading=true}={}){
    if(!window.CONFIG || !CONFIG.BASE_URL) throw new Error('config.js belum diisi (BASE_URL)');
    const apikey = encodeURIComponent(CONFIG.API_KEY||'');
    const url = `${CONFIG.BASE_URL}?action=${encodeURIComponent(action)}&apikey=${apikey}&_=${Date.now()}`;
    if(method==='GET'){
      const r = await fetch(url, { mode:'cors', cache:'no-cache' });
      if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
      return r.json();
    }else{
      const r = await fetch(url, {
        method:'POST', mode:'cors',
        headers:{ 'Content-Type':'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...(body||{}), apikey: CONFIG.API_KEY })
      });
      if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
      return r.json();
    }
  }

  // ===== Utils =====
  function toast(msg){ alert(msg); }

  // ===== Login form normal =====
  const $id  = qs('#login-user');
  const $pin = qs('#login-pin');
  const $btn = qs('#btn-login');
  $btn?.addEventListener('click', async (e)=>{
    e.preventDefault();
    const id  = ($id?.value||'').trim();
    const pin = ($pin?.value||'').trim();
    if(!id){ return toast('ユーザーIDを入力してください。'); }
    try{
      const r = await api('login',{method:'POST', body:{ id, pass:pin }});
      if(!r || r.ok===false) return toast(r?.error || 'ログインに失敗しました。');
      localStorage.setItem('currentUser', JSON.stringify(r.user));
      location.href = 'dashboard.html';
    }catch(err){ toast(err?.message||String(err)); }
  });

  // ===== QR Login =====
  let scanner=null;
  const $btnQR = qs('#btn-qr');
  let $area = qs('#qr-area');
  if(!$area){
    $area = document.createElement('div');
    $area.id = 'qr-area';
    $area.style.display='none';
    document.body.appendChild($area);
  }

  // gaya area kamera biar kecil
  Object.assign($area.style, {
    width:'100%', maxWidth:'360px', aspectRatio:'4 / 3',
    margin:'12px auto', borderRadius:'12px', overflow:'hidden',
    background:'#0b0b0b10'
  });

  async function ensureHtml5(){
    if(window.Html5Qrcode) return;
    // sudah dimuat via <script> di HTML; ini hanya guard
    throw new Error('html5-qrcode tidak tersedia');
  }

  function parseQR(text){
    // 1) USER|ID
    if(/^USER\|/i.test(text)){
      const id = text.split('|')[1]||'';
      return { mode:'byId', id };
    }
    // 2) LOGIN|ID|PIN
    if(/^LOGIN\|/i.test(text)){
      const [, id, pin] = text.split('|');
      return { mode:'withPin', id:(id||''), pin:(pin||'') };
    }
    // 3) JSON
    try{
      const obj = JSON.parse(text);
      if((obj.type==='USER' || obj.t==='USER') && obj.id){
        return { mode:'byId', id:String(obj.id) };
      }
      if((obj.type==='LOGIN' || obj.t==='LOGIN') && obj.id){
        return { mode:'withPin', id:String(obj.id), pin:String(obj.pin||'') };
      }
    }catch(_){}
    return null;
  }

  async function startQR(){
    try{
      await ensureHtml5();
      $area.style.display='block';

      // set config agresif agar cepat baca
      const cfg = {
        fps: 12,
        qrbox: { width: 200, height: 200 },
        aspectRatio: 1.33,
        rememberLastUsedCamera: true,
        disableFlip: true,
        videoConstraints:{
          facingMode:{ ideal:'environment' },
          width:{ ideal:1280 }, height:{ ideal:720 },
          focusMode:'continuous'
        }
      };

      scanner = new Html5Qrcode('qr-area', { useBarCodeDetectorIfSupported:true });

      const onScan = async (txt)=>{
        try{
          const p = parseQR(txt);
          if(!p) return; // bukan format kita → abaikan & lanjut
          await stopQR(); // stop dulu biar tidak scan berulang

          if(p.mode==='byId'){
            const r = await api('loginById',{method:'POST', body:{ id:p.id }});
            if(!r || r.ok===false) return toast(r?.error || 'ログインに失敗しました。');
            localStorage.setItem('currentUser', JSON.stringify(r.user));
            location.href = 'dashboard.html';
          }else{
            const r = await api('login',{method:'POST', body:{ id:p.id, pass:p.pin }});
            if(!r || r.ok===false) return toast(r?.error || 'ログインに失敗しました。');
            localStorage.setItem('currentUser', JSON.stringify(r.user));
            location.href = 'dashboard.html';
          }
        }catch(err){ toast(err?.message||String(err)); }
      };

      // start facingMode → fallback deviceId
      try{
        await scanner.start({ facingMode:'environment' }, cfg, onScan);
      }catch(err1){
        const cams = await Html5Qrcode.getCameras();
        const back = cams.find(c=>/back|rear|environment/i.test(c.label)) || cams.at(-1);
        await scanner.start({ deviceId:{ exact:back.id } }, cfg, onScan);
      }
    }catch(err){
      toast('QRログインを開始できませんでした: '+(err?.message||err));
      try{ await stopQR(); }catch{}
    }
  }
  async function stopQR(){
    try{ await scanner?.stop?.(); scanner?.clear?.(); }catch{}
    $area.style.display='none';
    scanner = null;
  }

  $btnQR?.addEventListener('click', (e)=>{
    e.preventDefault();
    if(scanner) stopQR(); else startQR();
  });

  // Enter to submit
  [$id,$pin].forEach(el=>el?.addEventListener('keydown',e=>{
    if(e.key==='Enter'){ e.preventDefault(); $btn?.click(); }
  }));
})();
