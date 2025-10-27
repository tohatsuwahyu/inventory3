/*************************************************
qsa('aside nav a').forEach(a=>a.addEventListener('click',()=>showView(a.getAttribute('data-view'), a.textContent.trim())));


// logout
qs('#btn-logout')?.addEventListener('click',()=>{ localStorage.removeItem('currentUser'); location.href='index.html'; });


// IO form
qs('#btn-io-scan')?.addEventListener('click', startIoScan);
qs('#btn-io-stop')?.addEventListener('click', stopIoScan);
qs('#form-io')?.addEventListener('submit', async (e)=>{
e.preventDefault();
const body={ userId:state.currentUser.id, code:qs('#io-code').value.trim(), qty:Number(qs('#io-qty').value||0), unit:qs('#io-unit').value, type:qs('#io-type').value };
if(!body.code || !body.qty){ alert('コード/数量は必須'); return; }
try{ const r=await api('log',{method:'POST',body}); if(r && r.ok===false) return alert(r.error||'エラー'); alert('登録しました'); await loadAll(); showView('view-history','履歴'); fillIoForm({code:'',name:'',price:'',stock:''}); qs('#io-qty').value=''; }catch(err){ alert('登録失敗: '+(err?.message||err)); }
});


// Stocktake
qs('#btn-start-scan')?.addEventListener('click', startScanner);
qs('#btn-stop-scan')?.addEventListener('click', stopScanner);
qs('#st-add')?.addEventListener('click', (e)=>{ e.preventDefault(); const code=qs('#st-code').value.trim(); const real=Number(qs('#st-qty').value||0); if(!code) return; const it=state.items.find(x=>String(x.code)===String(code)); pushStocktake(code, it?.name||'', Number(it?.stock||0), real); });
qs('#st-export')?.addEventListener('click', ()=>{
const head='code,name,book,real,diff\n';
const lines=state.stocktakeRows.map(r=>[r.code,r.name,r.book,r.real,r.diff].join(',')).join('\n');
const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='stocktake.csv'; a.click();
});


// Items export CSV
qs('#btn-items-export')?.addEventListener('click', ()=>{
const head='code,name,price,stock,min\n';
const lines=state.items.map(r=>[r.code,r.name,r.price,r.stock,r.min].join(',')).join('\n');
const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+lines],{type:'text/csv'})); a.download='items.csv'; a.click();
});


// Modal Item
const modalItemEl = document.getElementById('dlg-new-item');
const modalItem = modalItemEl ? new bootstrap.Modal(modalItemEl) : null;
qs('#btn-open-new-item')?.addEventListener('click', ()=>{
qs('#i-code').value = nextItemCode();
qs('#i-name').value = '';
qs('#i-price').value = 0;
qs('#i-stock').value = 0;
qs('#i-min').value = 0;
qs('#i-img').value = '';
modalItem?.show();
});
qs('#form-item')?.addEventListener('submit', async (e)=>{
e.preventDefault();
const body={ code:qs('#i-code').value.trim(), name:qs('#i-name').value.trim(), price:Number(qs('#i-price').value||0), stock:Number(qs('#i-stock').value||0), min:Number(qs('#i-min').value||0), img:qs('#i-img').value.trim(), overwrite:false };
if(!body.code || !body.name){ alert('コード/名称は必須'); return; }
try{ const r=await api('addItem',{method:'POST',body}); if(r && r.ok===false) throw new Error(r.error||'登録失敗'); modalItem?.hide(); await loadAll(); showView('view-items','商品一覧'); }catch(err){ alert(err.message); }
});
qs('#btn-item-makeqr')?.addEventListener('click', ()=>{
const i={ code:qs('#i-code').value.trim(), name:qs('#i-name').value.trim(), price:Number(qs('#i-price').value||0) };
const tmp=document.createElement('div'); if(typeof QRCode!=='undefined'){ new QRCode(tmp,{ text:itemQrText(i.code), width:240, height:240, correctLevel:QRCode.CorrectLevel.M }); }
const canvas=tmp.querySelector('canvas'); const dataUrl=canvas?canvas.toDataURL('image/png'):''; const w=window.open('','qrprev','width=420,height=520');
w.document.write(`<div style="padding:20px;text-align:center;font-family:sans-serif"><img src="${dataUrl}" style="width:240px;height:240px"/><div style="margin-top:8px">${i.name}（${i.code}） ¥${fmt(i.price||0)}</div></div>`); tmp.remove();
});


// Modal User
const modalUserEl = document.getElementById('dlg-new-user');
const modalUser = modalUserEl ? new bootstrap.Modal(modalUserEl) : null;
qs('#btn-open-new-user')?.addEventListener('click', ()=>modalUser?.show());
qs('#form-user')?.addEventListener('submit', async (e)=>{
e.preventDefault();
const body={ name:qs('#u-name').value.trim(), id:qs('#u-id').value.trim(), role:qs('#u-role').value, pin:qs('#u-pin').value.trim() };
try{ const r=await api('addUser',{method:'POST',body}); if(r && r.ok===false) throw new Error(r.error||'エラー'); modalUser?.hide(); await loadAll(); showView('view-users','ユーザー / QR'); }catch(err){ alert(err.message); }
});
qs('#btn-print-qr-users')?.addEventListener('click', ()=>{ qs('#print-qr-users').classList.remove('d-none'); window.print(); qs('#print-qr-users').classList.add('d-none'); });


// init
showView('view-dashboard','ダッシュボード');
await loadAll();
});


// === util
function nextItemCode(){
const nums=state.items.map(i=>String(i.code||'')).map(c=>/^\d+$/.test(c)?Number(c):NaN).filter(n=>!isNaN(n));
const max=nums.length?Math.max(...nums):0;
const width=Math.max(4, ...state.items.map(i=>String(i.code||'').length||0)) || 4;
return String(max+1).padStart(width,'0');
}
