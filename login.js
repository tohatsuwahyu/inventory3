<!-- index.html sudah memanggil login.js, cukup letakkan file ini di root yang sama -->
<script>
// ===== Util dasar =====
const qs  = (s, el=document)=>el.querySelector(s);
const fmt = (n)=>new Intl.NumberFormat('ja-JP').format(n ?? 0);

// Loading overlay (pakai elemen yang sudah ada di index.html)
let loadingCount = 0;
function loading(on, text='読み込み中…'){
  const host = qs('#global-loading'); if(!host) return;
  const label = qs('#loading-text'); if(label && text) label.textContent = text;
  if(on){ loadingCount++; host.classList.remove('d-none'); }
  else { loadingCount = Math.max(0, loadingCount-1); if(loadingCount===0) host.classList.add('d-none'); }
}

// API helper (sesuai config.js)
async function api(action, {method='GET', body, showLoading=true, loadingText='通信中…'}={}){
  if(!window.CONFIG || !CONFIG.BASE_URL) throw new Error('config.js belum diisi (BASE_URL kosong)');
  const apikey = encodeURIComponent(CONFIG.API_KEY||'');
  const url = `${CONFIG.BASE_URL}?action=${encodeURIComponent(action)}&apikey=${apikey}&_=${Date.now()}`;
  try{
    if(showLoading) loading(true, loadingText);
    if(method==='GET'){
      const r = await fetch(url, { mode:'cors', cache:'no-cache' });
      if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
      return await r.json();
    } else {
      const r = await fetch(url, {
        method:'POST', mode:'cors',
        headers:{ 'Content-Type':'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...(body||{}), apikey: CONFIG.API_KEY })
      });
      if(!r.ok) throw new Error(`[${r.status}] ${r.statusText}`);
      return await r.json();
    }
  } finally { if(showLoading) loading(false); }
}

// ====== LOGIN via form ======
window.addEventListener('DOMContentLoaded', ()=>{
  const form = qs('#form-login');
  if(form){
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const id  = String(qs('#login-id').value||'').trim();
      const pin = String(qs('#login-pin').value||'').trim();
      if(!id){ alert('ユーザーID を入力してください'); return; }
      try{
        const r = await api('login',{ method:'POST', body:{ id, pass:pin }, loadingText:'ログイン中…' });
        if(!r || r.ok===false) return alert(r?.error||'ログイン失敗');
        localStorage.setItem('currentUser', JSON.stringify(r.user||{ id, name:id, role:'user' }));
        location.href = 'dashboard.html';
      }catch(err){
        alert('ログイン失敗: '+(err?.message||err));
      }
    });
  }
});

// ====== LOGIN via QR ======
// Mengikuti pola pemuatan html5-qrcode seperti di app.js agar stabil
let html5qrcodeReady = !!window.Html5Qrcode;
function loadScriptOnce(src){
  return new Promise((res, rej)=>{
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res; s.onerror = ()=>rej(new Error('load failed: '+src));
    document.head.appendChild(s);
  });
}
async function ensureHtml5Qrcode(){
  if (window.Html5Qrcode) { html5qrcodeReady = true; return; }
  try { await loadScriptOnce('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/minified/html5-qrcode.min.js'); } catch {}
  if (!window.Html5Qrcode) {
    try { await loadScriptOnce('./vendor/html5-qrcode.min.js'); } catch {}
  }
  html5qrcodeReady = !!window.Html5Qrcode;
}

let qrModal, scanner;
async function openQrLogin(){
  const mountId = 'qr-login-area';
  await ensureHtml5Qrcode();
  if(!window.Html5Qrcode){ alert('スキャナライブラリが読み込めません。'); return; }

  const mount = document.getElementById(mountId);
  if(!mount){ alert('QRエリアが見つかりません'); return; }
  mount.innerHTML = '';

  // buka modal Bootstrap
  qrModal = new bootstrap.Modal('#dlg-qr', { backdrop:'static' });
  qrModal.show();

  const cfg = {
    fps: 12,
    qrbox: { width: 280, height: 280 },
    rememberLastUsedCamera: true,
    aspectRatio: 1.33,
    formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ]
  };
  scanner = new Html5Qrcode(mountId, { useBarCodeDetectorIfSupported: true });

  try{
    await scanner.start(
      { facingMode: 'environment' },
      cfg,
      async (txt)=>{
        try{
          // Format dukungan: "USER|<id>" atau JSON {t:'user', id:'...'}
          let id = '';
          if(txt.startsWith('USER|')) id = txt.split('|')[1]||'';
          else { try{ const o = JSON.parse(txt); if(o && (o.t==='user' || o.type==='user')) id = o.id||o.userId||''; }catch{} }
          if(!id) return;

          await scanner.stop(); scanner.clear();
          qrModal.hide();

          const r = await api('loginById',{ method:'POST', body:{ id }, loadingText:'ログイン中…' });
          if(!r || r.ok===false) return alert(r?.error||'ユーザーが見つかりません');
          localStorage.setItem('currentUser', JSON.stringify(r.user));
          location.href = 'dashboard.html';
        }catch(e){
          alert(e?.message||e);
        }
      },
      (_)=>{}
    );
  }catch(err){
    try{ await scanner?.stop?.(); scanner?.clear?.(); }catch{}
    alert('カメラ起動に失敗しました: '+(err?.message||err));
  }
}

// Hubungkan tombolnya
document.getElementById('btn-qr')?.addEventListener('click', openQrLogin);
document.getElementById('link-qr')?.addEventListener('click', (e)=>{ e.preventDefault(); openQrLogin(); });
</script>
