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

