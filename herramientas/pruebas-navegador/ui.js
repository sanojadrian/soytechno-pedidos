// Prueba en navegador del sistema de producción contra la base local (vía shim.mjs).
const { chromium } = require('playwright');
const fs = require('fs');
const { Client } = require('pg');
const WEB = 'http://127.0.0.1:8123/repo-soytechno/produccion/';
const SHIM = 'http://127.0.0.1:8765';
const OUT = __dirname + '/shots/'; fs.mkdirSync(OUT, { recursive: true });
const LIB = '/home/user/video/lib/';
const EJEMPLO = fs.readFileSync(__dirname + '/ejemplo.txt', 'utf8');
const ok = m => console.log('✓ ' + m);

(async () => {
  const db = new Client({ host: '/var/tmp/soypg', port: 5499, user: 'postgres', database: process.env.BD || 'ui' }); await db.connect();
  const b = await chromium.launch();
  const errs = [];
  async function ctx(nombre, mobile) {
    const c = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } : { viewport: { width: 1400, height: 950 } });
    await c.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ path: LIB + r.request().url().split('/').pop().split('?')[0], contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
    // Supabase "real" (https://proyecto.supabase.co) redirigido al servidor de pruebas: la política de seguridad queda intacta
    await c.route('https://proyecto.supabase.co/**', async r => { try { const resp = await r.fetch({ url: r.request().url().replace('https://proyecto.supabase.co', SHIM) }); await r.fulfill({ response: resp, headers: { ...resp.headers(), 'access-control-allow-origin': '*' } }); } catch (e) { await r.abort(); } });
    await c.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await c.route('**/assets/config.js*', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync('/home/user/repo-soytechno/produccion/assets/config.js', 'utf8').replace('https://TU-PROYECTO.supabase.co', 'https://proyecto.supabase.co').replace('sb_publishable_PEGA_AQUI_TU_CLAVE', 'sb_publishable_test').replace("'0412-000-0000'", "'0412-111-2233'").replace("'J-00000000-0'", "'J-12345678-9'") }));
    const p = await c.newPage(); p.on('pageerror', e => errs.push(nombre + ': ' + e.message));
    p.on('console', m => { if ((m.type() === 'error' || /Content Security Policy|integrity/i.test(m.text())) && !/realtime|websocket|WebSocket|fonts\.g|status of 400/.test(m.text())) errs.push(nombre + ' consola: ' + m.text()); });
    return p;
  }
  async function entrar(p, correo) {
    await p.goto(WEB + 'index.html'); await p.fill('#correo', correo); await p.fill('#clave', 'clave1234'); await p.click('#btn');
    await p.waitForURL(/panel\.html/); await p.waitForSelector('.nav-i'); await p.waitForTimeout(500);
  }
  const navs = async p => (await p.$$eval('.nav-i span:first-child', els => els.map(e => e.textContent)));

  // 1) Entra un correo de Cashea (como lo haría el script de Gmail)
  const r = await fetch(SHIM + '/functions/v1/recibir-correo', { method: 'POST', headers: { 'x-clave': 'ing', 'content-type': 'application/json' }, body: JSON.stringify({ mensaje_id: 'g1', remitente: 'Cashea <no-reply@cashea.app>', autenticado: true, asunto: 'Confirmación del pedido', texto: EJEMPLO }) }).then(r => r.json());
  if (r.estado !== 'creado') throw new Error('correo: ' + JSON.stringify(r)); ok('correo de Cashea → pedido creado');
  const cb = JSON.parse(fs.readFileSync(__dirname + '/callbell.json', 'utf8'));
  const link = cb[cb.length - 1].content.text.match(/http\S+/)[0]; ok('WhatsApp con enlace: ' + link.slice(0, 80) + '…');

  // 2) Clave incorrecta
  let p = await ctx('login');
  await p.goto(WEB + 'index.html'); await p.fill('#correo', 'carla@soytechno.com'); await p.fill('#clave', 'mala'); await p.click('#btn');
  await p.waitForSelector('#err:not([hidden])'); ok('login con clave mala: «' + await p.textContent('#err') + '»');
  await p.screenshot({ path: OUT + '1-login.png' });

  // 3) El cliente abre su enlace en el teléfono, elige y paga
  const cl = await ctx('cliente', true);
  await cl.goto(link); await cl.waitForSelector('#ciudad');
  await cl.selectOption('#ciudad', 'Valencia'); await cl.check('input[value="mrw"]');
  await cl.fill('#of', 'MRW Valencia · Av. Bolívar Norte');
  await cl.fill('#tel', '0414-555-0123'); await cl.fill('#ref', '004598120377');
  await cl.screenshot({ path: OUT + '2-cliente-form.png', fullPage: true });
  await cl.click('button[type=submit]'); await cl.waitForSelector('.steps'); ok('cliente eligió MRW y reportó su pago');
  await cl.screenshot({ path: OUT + '3-cliente-seguimiento.png', fullPage: true });
  const bad = await ctx('cliente-malo', true); await bad.goto(WEB + 'cliente.html?t=241157548'); await bad.waitForTimeout(800);
  ok('enlace con el número de Cashea no abre nada: «' + (await bad.textContent('#cl-body')).trim().slice(0, 40) + '…»');

  // 4) Carla (Caja MRW) solo ve su caja, toma y factura
  const caja = await ctx('carla'); await entrar(caja, 'carla@soytechno.com');
  const nCaja = await navs(caja); if (nCaja.join() !== 'Caja MRW') throw new Error('menú cajero: ' + nCaja); ok('cajera solo ve: ' + nCaja.join(', '));
  await caja.goto(WEB + 'panel.html#super'); await caja.waitForTimeout(800);
  if ((await caja.textContent('h1')) !== 'Caja MRW') throw new Error('cajero entró a supervisión'); ok('cajera no puede abrir Supervisión');
  await caja.click('[data-act="tomar"]'); await caja.waitForSelector('[data-act="facturar"]');
  await caja.screenshot({ path: OUT + '4-caja.png' });
  await caja.click('[data-act="facturar"]'); await caja.waitForTimeout(700); ok('Carla facturó');

  // 5) Javier (Despacho) sube fotos y despacha
  const des = await ctx('javier'); await entrar(des, 'javier@soytechno.com');
  await des.waitForSelector('[data-slot="factura"]');
  await des.setInputFiles('[data-slot="factura"]', '/home/user/video/fotos/factura.jpg'); await des.waitForSelector('.ph-slot.done img[src]', { timeout: 10000 });
  await des.setInputFiles('[data-slot="equipo"]', '/home/user/video/fotos/equipo.jpg'); await des.waitForFunction(() => document.querySelectorAll('.ph-slot.done img[src]').length >= 2, null, { timeout: 10000 });
  ok('2 fotos privadas subidas y visibles');
  await des.click('[data-act="despachar"]'); await des.waitForTimeout(700);
  const t1 = await des.textContent('#toast'); if (!/guía/i.test(t1)) throw new Error('debió pedir guía: ' + t1); ok('sin guía MRW no despacha: «' + t1 + '»');
  await des.fill('#d-guia', '0123456789'); await des.click('[data-act="despachar"]'); await des.waitForTimeout(1500);
  await des.screenshot({ path: OUT + '5-despacho.png' });
  const st = (await db.query("select st from pedidos where code='241157548'")).rows[0].st; if (st !== 'despachado') throw new Error('estado ' + st); ok('despachado');
  const cb2 = JSON.parse(fs.readFileSync(__dirname + '/callbell.json', 'utf8')); ok('WhatsApp de despacho: «' + cb2[cb2.length - 1].content.text.split('\n')[0] + '»');

  // 6) Sofía (Supervisión) ve el recorrido y crea un usuario
  const sup = await ctx('sofia'); await entrar(sup, 'sofia@soytechno.com');
  ok('supervisora ve: ' + (await navs(sup)).join(', '));
  await sup.click('[data-act="ir"][data-v="super"]'); await sup.waitForTimeout(800);
  await sup.fill('#sq', '241157548'); await sup.waitForTimeout(900);
  await sup.click('[data-act="ssel"][data-c="241157548"]'); await sup.waitForSelector('.msgs'); await sup.waitForTimeout(800);
  const pasos = await sup.$$eval('.card .steps li b', els => els.map(e => e.textContent)); ok('recorrido: ' + pasos.join(' → '));
  await sup.click('[data-act="enlace"][data-c="241157548"]'); await sup.waitForTimeout(600);
  const enl = await sup.textContent('#l-241157548'); if (!/cliente\.html\?t=[0-9a-f]{32}/.test(enl)) throw new Error('enlace: ' + enl); ok('Supervisión obtiene el enlace del cliente cuando lo pide');
  await sup.screenshot({ path: OUT + '6-supervision.png', fullPage: true });
  await sup.click('[data-act="ir"][data-v="usuarios"]'); await sup.waitForSelector('#un-n');
  await sup.fill('#un-n', 'Luis'); await sup.fill('#un-c', 'luis@soytechno.com'); await sup.fill('#un-k', 'clave1234'); await sup.selectOption('#un-r', 'cajero'); await sup.selectOption('#un-d', 'Delivery');
  await sup.click('[data-act="u-crear"]'); await sup.waitForTimeout(1200);
  if (!(await sup.textContent('.users')).includes('Luis')) throw new Error('usuario no creado'); ok('Sofía creó a Luis (Caja Delivery)');
  await sup.screenshot({ path: OUT + '7-usuarios.png', fullPage: true });
  const luis = await ctx('luis'); await entrar(luis, 'luis@soytechno.com'); ok('Luis entra y ve: ' + (await navs(luis)).join(', '));

  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'Sin errores de página');
  await b.close(); await db.end();
})().catch(e => { console.error('FALLÓ:', e.message); process.exit(1); });
