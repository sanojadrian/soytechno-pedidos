// Grabación en movimiento de la app real con base de datos simulada.
const { chromium } = require('playwright');
const fs = require('fs');
const LAYOUT = process.argv[2] || 'h', V = LAYOUT === 'v';
const W = V ? 1080 : 1920, H = V ? 1920 : 1080;
const BASE = 'http://127.0.0.1:8123', REPO = BASE + '/repo-soytechno/';
const OUT = '/home/user/video/rec/' + LAYOUT + '/';
fs.mkdirSync(OUT, { recursive: true });
/* ---------- base de datos simulada ---------- */
const DB = new Map(), REFS = new Map(), PE = new Map();
let T0 = Date.now() - 3 * 3600e3;
const ts = (min) => new Date(T0 + min * 60e3).toISOString();
const now = () => new Date().toISOString();
function ord(code, o) {
  DB.set(code, Object.assign({ code, created_at: now(), updated_at: now(), st: 'caja', dept: 'Delivery', cliente: {}, producto: '', cantidad: 1, total: 0, ini_pct: 0, ini_monto: 0, cuotas: { n: 6 }, entrega: {}, pago: null, tag: '', tomado_por: null, fotos: {}, historial: [], ajuste: {}, tienda: null }, o));
}
const NOM = ['LUIS ROJAS', 'ANA PÉREZ', 'PEDRO SILVA', 'CARMEN DÍAZ', 'JORGE RAMÍREZ', 'ROSA MENDOZA', 'GABRIEL TORRES', 'VALENTINA RUIZ', 'ANDRÉS CASTILLO', 'DANIELA MORALES', 'JOSÉ HERRERA', 'MARIANA LÓPEZ', 'PAOLA RIVAS', 'MIGUEL SUÁREZ'];
const PRO = ['REDMI NOTE 14 8GB/256GB', 'TECNO SPARK 30 8GB/256GB', 'INFINIX HOT 50 8GB/256GB', 'MOTO G35 4GB/128GB', 'SAMSUNG GALAXY A06 4GB/64GB', 'REDMI 14C 4GB/128GB', 'MOTOROLA G86 POWER 8GB/256GB'];
function cli(i) { const n = NOM[i % NOM.length]; return { nombre: n + ' (PRUEBA)', telefono: '+58414555' + String(1000 + i * 37).slice(-4), cedula: String(14000000 + i * 211357), correo: n.split(' ')[0].toLowerCase() + '.prueba@correo.com' }; }
const ENT = { Delivery: { ciudad: 'Caracas', metodo: 'Delivery', detalle: 'Los Palos Grandes' }, Pickup: { ciudad: 'Caracas', metodo: 'Pickup · Tienda Chacao', detalle: '' }, MRW: { ciudad: 'Maracaibo', metodo: 'MRW', detalle: 'MRW Maracaibo · Centro' }, Ruta: { ciudad: 'Guarenas', metodo: 'Ruta foránea', detalle: '' } };
function seed() {
  DB.clear(); REFS.clear(); PE.clear(); let i = 0, c = 241157400;
  const add = (st, dept, extra) => { const k = i++; ord(String(c++), Object.assign({ st, dept, cliente: cli(k), producto: PRO[k % PRO.length], total: 150 + (k * 37) % 220, ini_pct: [20, 0, 30][k % 3], entrega: ENT[dept], created_at: ts(k), updated_at: ts(k), historial: [{ t: ts(k), e: 'Correo de Cashea leído' }] }, extra || {})); const o = DB.get(String(c - 1)); o.ini_monto = Math.round(o.total * o.ini_pct) / 100; if (o.ini_pct) o.pago = { banco: 'Banesco', telefono: '0414-555-' + (2000 + k), referencia: '00' + (4511000000 + k * 7919), fecha: '2026-11-04' }; };
  ['Delivery', 'Delivery', 'Delivery', 'Pickup', 'Pickup', 'MRW', 'MRW', 'MRW'].forEach(d => add('caja', d));
  add('caja', 'Ruta', { updated_at: new Date(Date.now() + 3600e3).toISOString() });
  add('despacho', 'Delivery'); add('despacho', 'MRW');
  add('despachado', 'MRW'); add('despachado', 'Delivery');
  add('noval', 'Delivery'); add('admin', 'MRW', { tag: 'Aliado Cashea' }); add('standby', 'Delivery', { producto: 'MIX', tag: 'MIX · para un asesor', entrega: {} });
  // historial de ajustes: traslado interno y productos agotados (para el ranking de «Productos a apagar»)
  add('traslado', 'Delivery', { producto: 'MOTO G35 4GB/128GB', ajuste: { motivo: 'Otra tienda', origen: 'CCCT', solicitado_at: ts(20) } });
  add('traslado', 'MRW', { producto: 'REDMI 14C 4GB/128GB', ajuste: { motivo: 'Otra tienda', origen: 'SAMBIL Chacao', solicitado_at: ts(25) } });
  ['INFINIX HOT 50 8GB/256GB AZUL', 'INFINIX HOT 50 8GB/256GB AZUL', 'INFINIX HOT 50 8GB/256GB AZUL', 'TECNO SPARK 30 8GB/256GB', 'TECNO SPARK 30 8GB/256GB', 'SAMSUNG GALAXY A06 4GB/64GB'].forEach((pr, j) => add('despachado', 'Delivery', { producto: pr, ajuste: { motivo: j % 3 === 2 ? 'Otra versión' : 'Sin stock' } }));
  add('despachado', 'Pickup', { producto: 'TECNO SPARK 30 8GB/256GB', ajuste: { motivo: 'Otra tienda', origen: 'Lechería', solicitado_at: ts(5) } });
  // pedidos de las escenas
  ord('241157612', { st: 'cliente', dept: null, cliente: { nombre: 'CARLOS PÉREZ (PRUEBA)', telefono: '+584245550188', cedula: '18765432', correo: 'carlos.prueba@correo.com' }, producto: 'REDMI NOTE 14 8GB/256GB', total: 206.03, ini_pct: 30, ini_monto: 71.70, created_at: ts(40), updated_at: ts(40), historial: [{ t: ts(40), e: 'Correo de Cashea leído' }] });
  ord('241157655', { st: 'tomado', tomado_por: 'Carla', dept: 'Pickup', cliente: { nombre: 'ANA TORRES (PRUEBA)', telefono: '+584125550177', cedula: '20111222', correo: 'ana.prueba@correo.com' }, producto: 'TECNO SPARK 30 8GB/256GB', total: 137.07, ini_pct: 0, ini_monto: 0, entrega: ENT.Pickup, created_at: ts(41), updated_at: ts(41), historial: [{ t: ts(41), e: 'Correo de Cashea leído' }] });
  ord('241157680', { st: 'ajuste', dept: 'Delivery', cliente: { nombre: 'LUIS MÁRQUEZ (PRUEBA)', telefono: '+584165550144', cedula: '16555444', correo: 'luis.prueba@correo.com' }, producto: 'INFINIX HOT 50 8GB/256GB AZUL', total: 145.69, ini_pct: 20, ini_monto: 33.80, entrega: ENT.Delivery, ajuste: { motivo: 'Sin stock', solicitado_at: now() }, created_at: ts(42), updated_at: ts(42), historial: [{ t: ts(42), e: 'Caja: sin stock' }] });
}
async function route(r) {
  const req = r.request(), u = new URL(req.url()), m = req.method(), one = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
  const J = (x, s) => r.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(x) });
  const p = u.pathname, body = () => JSON.parse(req.postData() || '{}');
  if (p.endsWith('/rpc/tomar_siguiente')) {
    const b = body(), l = [...DB.values()].filter(o => o.st === 'caja' && o.dept === b.p_dept).sort((a, c) => new Date(a.updated_at) - new Date(c.updated_at));
    if (!l.length) return J(null); const o = l[0];
    Object.assign(o, { st: 'tomado', tomado_por: b.p_cajero, updated_at: now() }); o.historial = o.historial.concat([{ t: now(), e: 'Tomado por ' + b.p_cajero }]); return J(o);
  }
  if (p.endsWith('/rpc/registrar_pago')) {
    const b = body(), ref = (b.p_pago || {}).referencia || '';
    if (ref) { const ot = REFS.get(ref); if (ot && ot !== b.p_code) return J('duplicada'); REFS.set(ref, b.p_code); }
    const o = DB.get(b.p_code);
    if (o && o.st === 'cliente') { Object.assign(o, { pago: ref ? b.p_pago : null, entrega: b.p_entrega, dept: b.p_dept, st: 'caja', updated_at: now() }); o.historial = o.historial.concat([{ t: now(), e: 'El cliente eligió ' + (b.p_entrega.metodo || '') + (ref ? ' y reportó su pago' : '') }]); }
    return J('ok');
  }
  if (p.includes('/rpc/')) return J(null);
  if (p.includes('/rest/v1/productos_estado')) { if (m === 'POST') { const b = [].concat(body()); b.forEach(x => PE.set(x.producto, x)); return J(one ? b[0] : b, 201); } return J([...PE.values()]); }
  if (p.includes('/rest/v1/pedidos')) {
    const ce = u.searchParams.get('code'), code = ce && ce.startsWith('eq.') ? decodeURIComponent(ce.slice(3)) : null;
    if (m === 'POST') { const b = body(); if (DB.has(b.code)) return J({ code: '23505', message: 'duplicate key' }, 409); ord(b.code, b); const o = DB.get(b.code); return J(one ? o : [o], 201); }
    if (m === 'PATCH') { const o = DB.get(code); Object.assign(o, body()); return J(one ? o : [o]); }
    if (code) { const o = DB.get(code); return J(one ? (o || null) : (o ? [o] : [])); }
    return J([...DB.values()].sort((a, c) => new Date(a.created_at) - new Date(c.created_at)));
  }
  return J({});
}

const EMAIL = `Confirmación del pedido

Código de identificación:
241157548

Información de pagos

Número de cuotas:\t6
Fecha primer pago:\t18/11/2026
Fecha último pago:\t27/01/2027
Información de Cliente

MARÍA GONZÁLEZ (PRUEBA)
+584145550123
12345678
maria.prueba@correo.com

Resumen de pedido

SAMSUNG GALAXY A16 4G 4GB/128GB SM-A165M/DS, LIGHT GREEN. CELULAR.

Precio:\t$220.00
Cantidad:\t1
Total:\t$220.00
Resumen

Subtotal:\t$172.41
IVA (16%):\t$27.59

Total:\t$200.00
Pago Inicial:\t$40.00 - 20%`;

/* ---------- grabación en movimiento (screencast) ---------- */
(async () => {
  seed();
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const LIB = '/home/user/video/lib/';
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: LIB + r.request().url().split('/').pop().split('?')[0], contentType: 'application/javascript' }));
  await ctx.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ path: LIB + 'qrcode.min.js', contentType: 'application/javascript' }));
  await ctx.route('**/*.supabase.co/**', route);
  const errs = [];
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/video/stage2.html?layout=' + LAYOUT);
  await page.waitForTimeout(800);
  const fr = n => page.frame({ name: n });
  const wait = ms => page.waitForTimeout(ms);
  const setStage = o => page.evaluate(o => window.stage.set(o), o);
  async function load(n, url) {
    const f = fr(n); const [u0, h0] = url.split('#');
    await f.goto(u0 + (u0.includes('?') ? '&' : '?') + 'r=' + Date.now() + (h0 ? '#' + h0 : ''));
    await f.waitForLoadState('load');
    await f.addStyleTag({ content: '.live{display:none!important}' }).catch(() => {});
    await wait(900);
  }
  const reload = n => fr(n).evaluate(() => window.__soyRecargar && window.__soyRecargar()).then(() => wait(450));
  async function to(n, sel, o) {
    o = o || {};
    const l = fr(n).locator(sel).first();
    await l.evaluate(e => e.scrollIntoView({ behavior: 'smooth', block: 'nearest' })).catch(() => {});
    await wait(o.settle || 380);
    const bx = await l.boundingBox(); if (!bx) throw new Error('sin caja: ' + sel);
    await page.evaluate(([x, y, ms]) => window.stage.move(x, y, ms), [bx.x + bx.width / 2, bx.y + Math.min(bx.height / 2, 40), o.ms || 650]);
    if (o.click) { await wait(160); await page.evaluate(() => window.stage.tap()); await wait(90); await l.click({ force: true }); await wait(o.after || 380); }
    return l;
  }
  async function type(n, sel, text, delay) { const l = await to(n, sel, { click: true, after: 120 }); await l.pressSequentially(text, { delay: delay || 45 }); await wait(200); }
  async function pick(n, sel, val) { const l = await to(n, sel); await wait(160); await page.evaluate(() => window.stage.tap()); await wait(150); await l.selectOption(val); await wait(450); }
  async function cover(n, url) { await page.evaluate(() => window.stage.cover(true)); await wait(260); await load(n, url); await page.evaluate(() => window.stage.cover(false)); await wait(300); }

  // captura de cuadros
  const cdp = await ctx.newCDPSession(page);
  let rec = null;
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (!rec) return;
    const f = rec.dir + '/f' + String(rec.frames.length).padStart(5, '0') + '.jpg';
    fs.writeFileSync(f, Buffer.from(data, 'base64')); rec.frames.push({ f, t: metadata.timestamp });
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  // un pixel que late para que siempre haya cuadros
  await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:0;top:0;width:2px;height:2px;z-index:99;background:#0A1030'; document.body.appendChild(d); let k = 0; setInterval(() => { d.style.opacity = (k++ % 2) ? '0.98' : '1'; }, 33); });
  const scenes = [];
  async function scene(n, fn) {
    const dir = OUT + 'r' + String(n).padStart(2, '0'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    rec = { dir, frames: [] }; const t0 = Date.now() / 1000;
    await fn(); await wait(350);
    const r = rec; rec = null; const t1 = Date.now() / 1000;
    const lines = ['ffconcat version 1.0'];
    r.frames.forEach((fm, i) => { const nx = i < r.frames.length - 1 ? r.frames[i + 1].t : t1; lines.push('file ' + fm.f, 'duration ' + Math.max(0.001, nx - fm.t).toFixed(4)); });
    lines.push('file ' + r.frames[r.frames.length - 1].f);
    fs.writeFileSync(dir + '/list.txt', lines.join('\n'));
    scenes.push({ scene: n, list: dir + '/list.txt', dur: t1 - r.frames[0].t, frames: r.frames.length });
    console.log('escena', n, (t1 - r.frames[0].t).toFixed(1) + 's', r.frames.length, 'cuadros');
  }
  const H1 = '241157548';
  try {
    // preparación
    await load('panel', REPO + 'panel.html#bandeja');
    await load('cliente', BASE + '/video/wa2.html');
    await fr('cardf').goto(BASE + '/video/card2.html?layout=' + LAYOUT + '&k=hoy');
    await setStage({ mode: 'card' }); await wait(300);
    await fr('cardf').goto(BASE + '/video/card2.html?layout=' + LAYOUT + '&k=hoy');

    await scene(1, async () => { await wait(4300); await fr('cardf').evaluate(() => window.show('dolor')); await wait(4700); await fr('cardf').evaluate(() => window.show('titulo')); await wait(3300); });

    await scene(2, async () => {
      await setStage({ mode: 'laptop', n: 1, chip: 'Llega el correo de Cashea' }); await wait(500);
      await to('panel', '.nav-i[data-v="bandeja"]', { click: true });
      await to('panel', '#b-txt', { click: true, after: 200 }); await fr('panel').fill('#b-txt', EMAIL); await wait(450);
      await to('panel', '[data-act="b-leer"]', { click: true, after: 600 });
      await to('panel', '.ticket', { ms: 900 }); await wait(700);
    });

    await scene(3, async () => {
      await setStage({ mode: 'both', n: 2, chip: 'El cliente recibe su enlace' }); await wait(300);
      await to('panel', '[data-act="b-crear"]', { click: true, after: 300 });
      const p = fr('cliente').evaluate(() => window.mostrar());
      await to('panel', '#qr', { ms: 900 }); await p; await wait(300);
    });

    await scene(4, async () => {
      await setStage({ mode: 'phone', n: 3, chip: 'El cliente elige y paga', h: 'Elige su entrega desde el teléfono', p: 'Solo ve las opciones de su ciudad. Si tiene inicial, reporta su pago móvil en campos guiados.' }); await wait(300);
      await to('cliente', '.btn', { click: true, after: 100 });
      await cover('cliente', REPO + 'cliente.html?c=' + H1);
      await pick('cliente', '#ciudad', 'Valencia');
      await to('cliente', 'input[value="ruta"]', { click: true });
      await type('cliente', '#tel', '0414-555-0123', 35);
      await type('cliente', '#ref', '004598120377', 35);
      await to('cliente', 'button[type=submit]', { click: true, after: 900 });
    });

    await reload('panel');
    await scene(5, async () => {
      await setStage({ mode: 'both', n: 4, chip: 'Caja verifica y factura' }); await wait(300);
      await to('panel', '.nav-i[data-v="caja-Ruta"]', { click: true, after: 500 });
      await to('panel', '[data-act="tomar"]', { click: true, after: 700 });
      await to('panel', '.paybox', { ms: 800 }); await wait(500);
      await to('panel', '[data-act="facturar"]', { click: true, after: 400 });
      await reload('cliente');
      await to('cliente', '.steps', { ms: 800 }); await wait(500);
    });

    // preparar el pedido del intento de fraude
    await load('cliente', REPO + 'cliente.html?c=241157612');
    await fr('cliente').selectOption('#ciudad', 'Valencia'); await wait(300); await fr('cliente').check('input[value="ruta"]'); await wait(300);
    await fr('cliente').fill('#tel', '0424-555-0188');
    await scene(6, async () => {
      await setStage({ mode: 'phone', n: 5, chip: 'Pagos repetidos: bloqueados', h: 'Un pago, un pedido', p: 'Si alguien usa una referencia que ya existe, el sistema la bloquea.' }); await wait(300);
      await type('cliente', '#ref', '004598120377', 30);
      await to('cliente', 'button[type=submit]', { click: true, after: 500 });
      await to('cliente', '.err >> nth=-1', { ms: 600 }); await wait(500);
    });

    await load('cliente', REPO + 'cliente.html?c=241157655');
    await reload('panel');
    await scene(7, async () => {
      await setStage({ mode: 'both', n: 6, chip: 'Ajuste: equipo en otra tienda' }); await wait(300);
      await to('panel', '.nav-i[data-v="caja-Pickup"]', { click: true, after: 450 });
      await to('panel', '[data-act="otra"]', { click: true, after: 300 });
      await pick('panel', '#c-store', 'Lechería');
      await to('panel', '[data-act="otraok"]', { click: true, after: 300 });
      await reload('cliente');
      await to('cliente', '.opts', { ms: 700 }); await wait(500);
      await to('cliente', '[data-lech="esperar"]', { click: true, after: 400 });
      await to('panel', '.nav-i[data-v="ajuste"]', { click: true, after: 450 });
      await to('panel', '.grid2 > .pm >> nth=0', { ms: 800 }); await wait(1300);
      await to('panel', '.grid2 > .pm >> nth=1', { ms: 900 }); await wait(1800);
    });

    await scene(8, async () => {
      await setStage({ mode: 'both', n: 7, chip: 'Ajuste: producto agotado' }); await wait(300);
      await to('panel', '[data-act="jtab"][data-t="stock"]', { click: true, after: 450 });
      await to('panel', '[id^="j-alt-"]', { ms: 800 }); await wait(500);
      await to('panel', '[data-act="alt"]', { click: true, after: 300 });
      await cover('cliente', REPO + 'cliente.html?c=241157680');
      await to('cliente', '[data-alt="0"]', { click: true, after: 500 });
      await to('panel', '.nav-i[data-v="apagar"]', { click: true, after: 500 });
      await to('panel', 'table.mini tbody tr >> nth=0', { ms: 800 }); await wait(900);
      await to('panel', '[data-act="apagar"] >> nth=0', { click: true, after: 700 });
    });

    const H0 = DB.get(H1);
    H0.fotos = { factura: BASE + '/video/fotos/factura.jpg', equipo: BASE + '/video/fotos/equipo.jpg', empaque: BASE + '/video/fotos/empaque.jpg', entrega: BASE + '/video/fotos/guia.jpg' };
    H0.historial = H0.historial.concat(['factura', 'equipo', 'empaque', 'entrega'].map(k => ({ t: now(), e: 'Foto de ' + k + ' guardada · Javier' })));
    await reload('panel');
    await load('cliente', REPO + 'cliente.html?c=' + H1);
    await scene(9, async () => {
      await setStage({ mode: 'both', n: 8, chip: 'Despacho con fotos de respaldo' }); await wait(300);
      await to('panel', '.nav-i[data-v="despacho"]', { click: true, after: 400 });
      await to('panel', '[data-act="dsel"][data-c="' + H1 + '"]', { click: true, after: 400 });
      await to('panel', '.photos', { ms: 700 }); await wait(400);
      await to('panel', '[data-act="despachar"]', { click: true, after: 300 });
      await reload('cliente');
      await to('cliente', '.info', { ms: 700 }); await wait(400);
    });

    await scene(10, async () => {
      await setStage({ mode: 'laptop', n: 9, chip: 'Supervisión en vivo' }); await wait(300);
      await to('panel', '.nav-i[data-v="super"]', { click: true, after: 500 });
      await to('panel', '[data-act="ssel"][data-c="' + H1 + '"]', { click: true, after: 500 });
      await to('panel', '.steps', { ms: 800 }); await wait(300);
      await to('panel', '.steps li >> nth=-1', { ms: 900 }); await wait(500);
    });

    await fr('cardf').goto(BASE + '/video/card2.html?layout=' + LAYOUT + '&k=beneficios');
    await scene(11, async () => {
      await setStage({ mode: 'card' }); await fr('cardf').evaluate(() => window.show('beneficios')); await wait(4300);
      await fr('cardf').evaluate(() => window.show('cierre')); await wait(4300);
    });
  } catch (e) { await page.screenshot({ path: OUT + 'FAIL.png' }); console.log('errs', JSON.stringify(errs)); throw e; }
  fs.writeFileSync(OUT + 'scenes.json', JSON.stringify(scenes, null, 1));
  console.log('listo', scenes.length, 'escenas · errores:', JSON.stringify(errs));
  await cdp.send('Page.stopScreencast').catch(() => {});
  await b.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
