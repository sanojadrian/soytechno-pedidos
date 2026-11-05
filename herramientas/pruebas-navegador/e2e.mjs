import assert from 'node:assert';
import pg from 'pg';
const URL = 'https://proyecto.supabase.co';
Object.assign(process.env, { SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', INGRESO_CLAVE: 'ing-123', PROCESO_CLAVE: 'proc-456', CALLBELL_API_KEY: 'cb-key', REMITENTES_PERMITIDOS: 'cashea.app', CLIENTE_URL: 'https://soytechno.github.io/pedidos/cliente.html' });
const db = new pg.Client({ host: '/var/tmp/soypg', port: 5499, user: 'postgres', database: process.env.BD || 'e2e' }); await db.connect();
async function comoServicio(sql, params) {
  await db.query('begin'); await db.query('set local role service_role'); await db.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}', true)");
  try { const r = await db.query(sql, params); await db.query('commit'); return r; } catch (e) { await db.query('rollback'); throw e; }
}
const CB = []; let cbFalla = false;
const recibir = await import('./recibir.ts'), procesar = await import('./procesar.ts');
globalThis.fetch = async (url, opt = {}) => {
  const u = new globalThis.URL(url), body = opt.body ? JSON.parse(opt.body) : null, J = (x, s = 200) => new Response(JSON.stringify(x), { status: s });
  try {
    if (u.host === 'api.callbell.eu') { CB.push(body); return cbFalla ? J({ error: 'caído' }, 500) : J({ message: { uuid: 'u' + CB.length, status: 'enqueued' } }); }
    if (u.pathname === '/functions/v1/procesar-mensajes') return procesar.manejar(new Request(url, opt));
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.split('/').pop(), ks = Object.keys(body);
      const r = await comoServicio(`select to_jsonb(public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(', ')})) as r`, ks.map(k => typeof body[k] === 'object' && body[k] !== null ? JSON.stringify(body[k]) : body[k]));
      return J(r.rows[0].r);
    }
    if (u.pathname === '/rest/v1/correos' && opt.method === 'POST') {
      const r = await comoServicio('insert into correos (mensaje_id, remitente, asunto, texto) values ($1,$2,$3,$4) on conflict (mensaje_id) do nothing returning *', [body.mensaje_id, body.remitente, body.asunto, body.texto]);
      return J(r.rows, 201);
    }
    if (u.pathname === '/rest/v1/correos' && opt.method === 'PATCH') {
      const id = Number(u.searchParams.get('id').slice(3)), ks = Object.keys(body);
      await comoServicio(`update correos set ${ks.map((k, i) => `${k} = $${i + 1}`).join(', ')} where id = ${id}`, ks.map(k => body[k])); return new Response(null, { status: 204 });
    }
    if (u.pathname === '/auth/v1/user') { const t = (opt.headers.Authorization || '').slice(7); return t === 'personal' ? J({ id: '11111111-1111-1111-1111-111111111111' }) : t === 'cualquiera' ? J({ id: '99999999-9999-9999-9999-999999999999' }) : J({}, 401); }
    if (u.pathname === '/rest/v1/perfiles') return J(u.searchParams.get('id') === 'eq.11111111-1111-1111-1111-111111111111' ? [{ activo: true }] : []);
  } catch (e) { return J({ message: e.message }, 400); }
  throw new Error('fetch no simulado: ' + url);
};
const EJEMPLO = 'Confirmación del pedido\n\nCódigo de identificación:\n241157548\n\nInformación de pagos\n\nNúmero de cuotas:\t6\nFecha primer pago:\t18/11/2026\nFecha último pago:\t27/01/2027\nInformación de Cliente\n\nMARÍA GONZÁLEZ\n+584145550123\n12345678\nmaria.prueba@correo.com\n\nResumen de pedido\n\nSAMSUNG GALAXY A16 4G 4GB/128GB SM-A165M/DS, LIGHT GREEN. CELULAR.\n\nPrecio:\t$220.00\nCantidad:\t1\nTotal:\t$220.00\nResumen\n\nSubtotal:\t$172.41\nIVA (16%):\t$27.59\n \nTotal:\t$200.00\nPago Inicial:\t$40.00 - 20%';
const enviar = (b0, clave = 'ing-123', b = { remitente: 'Cashea <no-reply@cashea.app>', autenticado: true, ...b0 }) => recibir.manejar(new Request(URL + '/functions/v1/recibir-correo', { method: 'POST', headers: { 'x-clave': clave, 'content-type': 'application/json' }, body: JSON.stringify(b) })).then(async r => ({ s: r.status, b: await r.json() }));

let r = await enviar({ mensaje_id: 'm1', texto: EJEMPLO }, 'mala'); assert.equal(r.s, 401); console.log('✓ clave incorrecta rechazada');
r = await enviar({ mensaje_id: 'm1', asunto: 'Confirmación', texto: EJEMPLO });
assert.equal(r.b.estado, 'creado', JSON.stringify(r.b)); console.log('✓ correo → pedido creado');
const p = (await db.query("select p.*, t.token from pedidos p join pedidos_token t using (code) where code='241157548'")).rows[0];
assert.equal(Number(p.total), 172.41); assert.equal(Number(p.ini_pct), 20); assert.equal(Number(p.ini_monto), 40); console.log('✓ total sin IVA 172,41 · inicial 20% $40');
assert.equal(CB.length, 1); assert.equal(CB[0].to, '+584145550123'); assert.ok(CB[0].content.text.includes('cliente.html?t=' + p.token)); console.log('✓ WhatsApp enviado al instante con enlace secreto');
console.log('   →', CB[0].content.text.replace(/\n/g, ' | '));
assert.equal((await db.query("select estado from mensajes where code='241157548'")).rows[0].estado, 'enviado');
assert.equal((await db.query("select estado from correos where mensaje_id='m1'")).rows[0].estado, 'ok');
r = await enviar({ mensaje_id: 'm1', texto: EJEMPLO }); assert.equal(r.b.estado, 'repetido'); console.log('✓ mismo correo dos veces: no se repite');
r = await enviar({ mensaje_id: 'm2', texto: EJEMPLO }); assert.equal(r.b.estado, 'duplicado'); assert.equal(CB.length, 1); console.log('✓ mismo pedido en otro correo: no se duplica ni se reenvía WhatsApp');
r = await enviar({ mensaje_id: 'f1', remitente: 'Cashea <no-reply@cashea-pedidos.com>', texto: EJEMPLO.replace('241157548', '666000001') }); assert.equal(r.b.estado, 'revisar'); console.log('✓ remitente que no es Cashea: no crea pedido');
r = await enviar({ mensaje_id: 'f2', autenticado: false, texto: EJEMPLO.replace('241157548', '666000002') }); assert.equal(r.b.estado, 'revisar'); console.log('✓ correo con remitente falsificado (sin DKIM/DMARC): no crea pedido');
r = await enviar({ mensaje_id: 'f3', texto: EJEMPLO.replace('+584145550123', '+15550001111') }); assert.equal(r.b.estado, 'conflicto'); assert.equal(CB.length, 1); console.log('✓ mismo pedido con otro teléfono: alerta, sin WhatsApp');
assert.equal(Number((await db.query("select count(*) n from pedidos where code like '666%'")).rows[0].n), 0);
r = await enviar({ mensaje_id: 'm3', texto: 'Hola, promoción de Cashea' }); assert.equal(r.b.estado, 'ignorado'); console.log('✓ correo que no es pedido: ignorado');
r = await enviar({ mensaje_id: 'm4', texto: EJEMPLO.replace('241157548', '241157549').replace('+584145550123\n', '') }); assert.equal(r.b.estado, 'revisar'); console.log('✓ correo incompleto: queda para revisar →', r.b.detalle.join(' '));
process.env.SOLO_TELEFONOS = '0412-258-3143';
r = await enviar({ mensaje_id: 'm5', texto: EJEMPLO.replace('241157548', '241157550') }); assert.equal(r.b.estado, 'creado'); assert.equal(CB.length, 1);
assert.equal((await db.query("select estado from mensajes where code='241157550'")).rows[0].estado, 'omitido'); console.log('✓ piloto: número no autorizado se omite');
delete process.env.SOLO_TELEFONOS;
cbFalla = true;
r = await enviar({ mensaje_id: 'm6', texto: EJEMPLO.replace('241157548', '241157551') });
const m = (await db.query("select * from mensajes where code='241157551'")).rows[0]; assert.equal(m.estado, 'pendiente'); assert.equal(m.intentos, 1); console.log('✓ Callbell caído: queda pendiente para reintentar');
cbFalla = false; await db.query("update mensajes set proximo_intento = now() where code='241157551'");
const pr = await procesar.manejar(new Request(URL + '/functions/v1/procesar-mensajes', { method: 'POST', headers: { 'x-clave': 'proc-456' } }));
assert.equal((await pr.json()).enviados, 1); console.log('✓ reintento enviado cuando Callbell vuelve');
assert.equal((await procesar.manejar(new Request(URL + '/x', { method: 'POST' }))).status, 401);
assert.equal((await procesar.manejar(new Request(URL + '/x', { method: 'POST', headers: { authorization: 'Bearer cualquiera' } }))).status, 401);
assert.equal((await procesar.manejar(new Request(URL + '/x', { method: 'POST', headers: { authorization: 'Bearer personal' } }))).status, 200); console.log('✓ procesar-mensajes solo con clave o personal activo (un usuario cualquiera no)');
const o = { code: '1', token: 'tok', producto: 'X', cliente: { nombre: 'ANA PÉREZ' }, entrega: { metodo: 'Pickup · Tienda Chacao' }, ajuste: { solicitado_at: '2026-11-05T15:00:00Z' } };
for (const t of ['lecheria', 'alternativas', 'retraso', 'despachado']) console.log('   ' + t + ':', procesar.texto(t, o, 'L').split('\n')[0]);
console.log('\nE2E OK'); await db.end();
