const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:800,height:600}});
await p.goto('http://127.0.0.1:8123/video/fotos.html');
for(const id of ['factura','equipo','empaque','guia']){await p.evaluate(id=>{document.querySelectorAll('.s').forEach(s=>s.classList.toggle('hide',s.id!==id))},id);await p.screenshot({path:'fotos/'+id+'.jpg',type:'jpeg',quality:85});}
await b.close();})();
