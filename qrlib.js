window.QRPrint = {
  buildItemGrid(el, items){
    el.innerHTML='';
    items.forEach(i=>{
      const cell = document.createElement('div'); cell.className='qr-cell';
      const box = document.createElement('div'); box.className='box'; cell.appendChild(box);
      new QRCode(box,{ text: JSON.stringify({t:'item',code:i.code,name:i.name,price:i.price}), width:120, height:120 });
      const meta = document.createElement('div'); meta.innerHTML = `<div class="name">${i.name}</div><div>${i.code}</div><div>¥${i.price||'-'}</div>`;
      cell.appendChild(meta); el.appendChild(cell);
    });
  },
  buildUserGrid(el, users){
    el.innerHTML='';
    users.forEach(u=>{
      const cell = document.createElement('div'); cell.className='qr-cell';
      const box = document.createElement('div'); box.className='box'; cell.appendChild(box);
      new QRCode(box,{ text: JSON.stringify({t:'user',id:u.id,name:u.name}), width:120, height:120 });
      const meta = document.createElement('div'); meta.innerHTML = `<div class="name">${u.name}</div><div>${u.id}</div>`;
      cell.appendChild(meta); el.appendChild(cell);
    });
  }
};
