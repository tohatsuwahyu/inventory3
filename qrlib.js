/* =========================================================
 * qrlib.js — helper ringan untuk QRCodeJS & cetak grid
 * Dependensi: qrcodejs (QRCode global)
 * =======================================================*/
(function(){
  "use strict";

  async function ensureQRCode(){
    if (window.QRCode) return;
    const tryLoad = (src)=>new Promise((res,rej)=>{
      const s=document.createElement("script"); s.src=src; s.async=true; s.onload=res; s.onerror=rej; document.head.appendChild(s);
    });
    const cdns=[
      "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js",
      "https://unpkg.com/qrcodejs@1.0.0/qrcode.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"
    ];
    for (const u of cdns){ try{ await tryLoad(u); if(window.QRCode) return; }catch{} }
    throw new Error("qrcodejs tidak tersedia");
  }

  async function toDataURL(text, size=256){
    await ensureQRCode();
    return await new Promise((resolve)=>{
      const tmp = document.createElement("div");
      Object.assign(tmp.style,{position:"fixed",left:"-9999px",top:"0",width:size+"px",height:size+"px"});
      document.body.appendChild(tmp);
      new QRCode(tmp,{text,width:size,height:size,correctLevel: QRCode.CorrectLevel.M});
      const pick = ()=>{
        const n = tmp.querySelector("img,canvas");
        if (!n) return "";
        try { return n.tagName==="IMG" ? n.src : n.toDataURL("image/png"); }
        catch { return ""; }
      };
      let tries=0;
      (function wait(){
        const url = pick();
        if (url || tries>=5){ tmp.remove(); resolve(url||""); return; }
        tries++; setTimeout(wait,30);
      })();
    });
  }

  async function mount(elOrSelector, text, size=128){
    await ensureQRCode();
    const el = (typeof elOrSelector==="string") ? document.querySelector(elOrSelector) : elOrSelector;
    if (!el) return;
    el.innerHTML = "";
    new QRCode(el,{text,width:size,height:size,correctLevel: QRCode.CorrectLevel.M});
  }

  // Cetak grid QR (gambar siap print)
  async function printImages(urls){
    const w = window.open("", "_blank");
    const doc = w.document;
    doc.write(`<!doctype html><html><head><meta charset="utf-8">
      <title>QR Print</title>
      <style>
        @page { size: A4; margin: 8mm; }
        html,body{margin:0;padding:0}
        .grid{ display:grid; grid-template-columns: repeat(auto-fill, minmax(40mm, 1fr)); gap:6mm; }
        .cell{ break-inside: avoid; }
        img{ width:100%; height:auto; display:block; }
      </style>
    </head><body><div class="grid"></div></body></html>`);
    const grid = doc.querySelector(".grid");
    urls.forEach(u => { const d=doc.createElement("div"); d.className="cell"; d.innerHTML=`<img src="${u}">`; grid.appendChild(d); });
    const imgs=[...doc.images]; let loaded=0; const done=()=>{ if(++loaded>=imgs.length) w.print(); };
    if (!imgs.length) w.print(); else imgs.forEach(i=> (i.complete?done(): i.onload=done));
  }

  // Builder: LOT grid (dipakai opsional)
  function buildLotGrid(el, lots){
    const host = (typeof el==="string") ? document.querySelector(el) : el;
    if (!host) return;
    host.innerHTML = "";
    lots.forEach(L=>{
      const cell = document.createElement("div"); cell.className="qr-cell"; cell.style.cssText="display:inline-block;margin:8px;text-align:center";
      const box  = document.createElement("div"); box.style.cssText="display:inline-block";
      cell.appendChild(box);
      new QRCode(box, { text: `LOT|${L.code}|${L.qtyPerBox||0}|${L.lotId||""}`, width:120, height:120 });
      const meta = document.createElement("div");
      meta.style.cssText="font:12px/1.4 system-ui, sans-serif; margin-top:6px";
      meta.innerHTML = `<div class="name" style="font-weight:600">${L.name||""}</div><div>${L.code}</div><div>箱:${L.qtyPerBox||0}pcs / ${L.lotId||"-"}</div>`;
      cell.appendChild(meta); host.appendChild(cell);
    });
  }

  window.QRPrint = { ensureQRCode, toDataURL, mount, printImages, buildLotGrid };
})();
