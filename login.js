// ===== Helpers =====
const $ = (sel, el=document)=>el.querySelector(sel);

function showLoading(on, text){
  const el = document.getElementById('global-loading');
  const t  = document.getElementById('loading-text');
  if (!el) return;
  if (text) t.textContent = text;
  el.classList.toggle('d-none', !on);
}

// ===== API (sesuai Code.gs) =====
async function api(action, {method='GET', body} = {}){
  if (!CONFIG || !CONFIG.BASE_URL) throw new Error('BASE_URL not set in config.js');
  const apikey = encodeURIComponent(CONFIG.API_KEY || '');
  const url    = `${CONFIG.BASE_URL}?action=${encodeURIComponent(action)}&apikey=${apikey}`;

  if (method === 'GET'){
    const r = await fetch(url);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  // Penting: text/plain dan apikey ikut di body
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...(body||{}), apikey: CONFIG.API_KEY })
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ===== Login (ID+PIN) =====
async function handleLogin(e){
  e?.preventDefault?.();
  const id   = $('#login-id').value.trim();
  const pass = $('#login-pin').value.trim();
  if (!id){ alert('ユーザーIDを入力してください'); return; }

  try{
    showLoading(true, 'ログインしています…');
    const res = await api('login', { method:'POST', body:{ id, pass } });
    if (!res || res.ok === false){
      alert(res?.error || 'ログインに失敗しました');
      return;
    }
    localStorage.setItem('currentUser', JSON.stringify(res.user));
    location.href = 'dashboard.html';
  }catch(err){
    alert(String(err.message || err));
  }finally{
    showLoading(false);
  }
}
$('#form-login')?.addEventListener('submit', handleLogin);

// ===== QR Login =====
let qrScanner = null;
let qrBusy = false;        // <<< hanya dideklarasikan SEKALI

function openQr(){
  const modal = new bootstrap.Modal('#dlg-qr');
  modal.show();

  const start = async ()=>{
    if (!window.Html5Qrcode){
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
      s.onload = begin;
      document.body.appendChild(s);
    }else begin();
  };

  const begin = async ()=>{
    try{
      const cfg = { fps:10, qrbox:{ width:260, height:260 } };
      qrScanner = new Html5Qrcode('qr-login-area');

      // 1) coba kamera belakang by facingMode
      try{
        await qrScanner.start({ facingMode: "environment" }, cfg, onScanQr);
        return;
      }catch(_){ /* fallback */ }

      // 2) fallback pilih kamera belakang dari daftar
      const cams = await Html5Qrcode.getCameras();
      if (!cams || !cams.length) throw new Error('カメラが見つかりません');
      const back = cams.find(c => /back|rear|environment/i.test(c.label)) || cams[cams.length-1] || cams[0];
      await qrScanner.start({ deviceId:{ exact: back.id } }, cfg, onScanQr);
    }catch(e){
      alert('カメラ起動に失敗しました: ' + (e?.message||e));
    }
  };

  setTimeout(start, 150);
}

async function onScanQr(text){
  if (qrBusy) return;

  // ambil ID dari QR
  let userId = '';
  if (text.startsWith('USER|')) userId = text.split('|')[1] || '';
  else {
    try{ const o = JSON.parse(text); if (o.t === 'user') userId = o.id || ''; }catch(_){}
  }
  if (!userId) return;

  qrBusy = true;
  try{
    try{ await qrScanner?.stop(); qrScanner?.clear(); }catch(_){}
    qrScanner = null;

    showLoading(true, 'ログインしています…');

    // GET untuk loginById (hindari preflight/CORS)
    const base = CONFIG.BASE_URL;
    const qs = new URLSearchParams({
      action: 'loginById',
      id: userId,
      apikey: CONFIG.API_KEY || ''
    });
    const r = await fetch(`${base}?${qs.toString()}`);
    if (!r.ok){
      const txt = await r.text().catch(()=>r.statusText);
      throw new Error(`GAS error: ${r.status} ${txt}`);
    }
    const res = await r.json();
    if (!res || res.ok === false) throw new Error(res?.error || 'QRログインに失敗しました');

    localStorage.setItem('currentUser', JSON.stringify(res.user));
    location.href = 'dashboard.html';
  }catch(err){
    alert(`Failed to fetch (QR): ${err?.message || err}\n\nBASE_URL(/exec)・API_KEY・WebApp権限をご確認ください。`);
  }finally{
    showLoading(false);
    qrBusy = false;
  }
}

document.getElementById('link-qr')?.addEventListener('click', (e)=>{ e.preventDefault(); openQr(); });
document.getElementById('btn-qr')?.addEventListener('click', openQr);

// ===== Brand init ringan (fallback) =====
(function initBrand(){
  try{
    const url = (window.CONFIG && (CONFIG.LOGO_URL||'./assets/tsh.png')) || './assets/tsh.png';
    const img = document.getElementById('brand-logo'); if(img) img.src = url;
  }catch(_){}
})();







