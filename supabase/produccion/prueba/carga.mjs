// Prueba de carga: un año de historial + un día de temporada alta (4.000 pedidos) + 20 cajeros a la vez.
// Uso: crear una base con stub_supabase.sql + schema.sql y correr: BD=nombre node carga.mjs (requiere npm install pg)
import pg from 'pg';
const BD = process.env.BD || 'carga';
const pool = new pg.Pool({ host: '/var/tmp/soypg', port: 5499, user: 'postgres', database: BD, max: 30 });
const t0 = () => performance.now();
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const ms = n => n.toFixed(1) + ' ms';
const DEPTS = [['Delivery', 'Caracas', 'Delivery', 'Av. Francisco de Miranda, Chacao', 0.30], ['Pickup', 'Caracas', 'Pickup · Tienda Chacao', '', 0.20], ['MRW', 'Maracaibo', 'MRW', 'MRW Maracaibo Centro', 0.35], ['Ruta', 'Valencia', 'Ruta foránea', '', 0.15]];
const elegir = i => { let x = (i * 7919 % 1000) / 1000, acc = 0; for (const d of DEPTS) { acc += d[4]; if (x < acc) return d; } return DEPTS[0]; };

async function como(c, rol, claims, sql, params) {
  await c.query('begin'); await c.query('set local role ' + rol); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
  try { const r = await c.query(sql, params); await c.query('commit'); return r; } catch (e) { await c.query('rollback'); throw e; }
}
async function enParalelo(n, total, fn) {
  let i = 0; const tiempos = [], errores = [];
  await Promise.all(Array.from({ length: n }, async () => {
    const c = await pool.connect();
    try { while (i < total) { const k = i++; const a = t0(); try { await fn(c, k); } catch (e) { errores.push(e.message); } tiempos.push(t0() - a); } } finally { c.release(); }
  }));
  return { tiempos, errores };
}
const hoyVE = "(now() at time zone 'America/Caracas')::date";

(async () => {
  const db = await pool.connect();
  console.log('== 1. Historial de un año (400.000 pedidos despachados) ==');
  let a = t0();
  await db.query(`
    alter table pedidos disable trigger pedidos_avisos;
    insert into pedidos (code, created_at, updated_at, st, dept, cliente, producto, total, ini_pct, ini_monto, entrega, fotos, ajuste)
    select (100000000 + g)::text, now() - make_interval(days => 2 + (g % 363)), now() - make_interval(days => 2 + (g % 363)),
           case when g % 50 = 0 then 'cancelado' else 'despachado' end,
           (array['Delivery','Pickup','MRW','Ruta'])[1 + g % 4],
           jsonb_build_object('nombre', 'CLIENTE ' || g, 'telefono', '+58414' || lpad((g % 9999999)::text, 7, '0'), 'cedula', (10000000 + g)::text),
           (array['REDMI NOTE 14','TECNO SPARK 30','INFINIX HOT 50','MOTO G35','SAMSUNG A06'])[1 + g % 5], 150 + g % 200, 20, 40,
           '{"metodo":"MRW"}', '{"factura":"x/f.jpg","equipo":"x/e.jpg"}',
           case when g % 40 = 0 then '{"motivo":"Sin stock"}'::jsonb else '{}'::jsonb end
      from generate_series(1, 400000) g;
    insert into eventos (code, t, e, por_nombre)
    select p.code, p.created_at + make_interval(mins => k * 20), (array['Correo de Cashea leído','El cliente eligió MRW','Tomado en Caja MRW','Facturado en Profit','Despachado con 2 fotos','WhatsApp enviado al cliente (despachado)'])[k], 'Hist'
      from pedidos p, generate_series(1, 6) k where p.code::bigint between 100000001 and 100400000;
    insert into mensajes (code, tipo, estado, created_at, actualizado_at) select code, 'enlace', 'enviado', created_at, created_at from pedidos where code::bigint between 100000001 and 100400000;
    alter table pedidos enable trigger pedidos_avisos;
    analyze;`);
  const tam = (await db.query("select pg_size_pretty(pg_database_size(current_database())) s, (select count(*) from eventos) ev")).rows[0];
  console.log(`   listo en ${(t0() - a) / 1000 | 0} s · base de ${tam.s} · ${tam.ev} eventos`);

  console.log('\n== 2. Entran 4.000 correos de Cashea (8 a la vez) ==');
  let r = await enParalelo(8, 4000, (c, k) => como(c, 'service_role', { role: 'service_role' }, 'select ingresar_pedido($1::jsonb)', [JSON.stringify({ code: String(500000000 + k), producto: 'SAMSUNG GALAXY A16 4GB/128GB', total: 172.41, ini_pct: k % 10 < 7 ? 20 : 0, ini_monto: k % 10 < 7 ? 40 : 0, cliente: { nombre: 'CLIENTE HOY ' + k, telefono: '0414' + String(1000000 + k), cedula: String(20000000 + k) } })]));
  console.log(`   ${r.tiempos.length} correos · p50 ${ms(pct(r.tiempos, .5))} · p95 ${ms(pct(r.tiempos, .95))} · errores ${r.errores.length}`);

  console.log('\n== 3. 3.600 clientes eligen entrega y pagan (20 a la vez) ==');
  const tokens = (await db.query("select code, token, ini_pct from pedidos where code::bigint >= 500000000 order by code")).rows;
  r = await enParalelo(20, 3600, (c, k) => {
    const p = tokens[k], d = elegir(k), conPago = Number(p.ini_pct) > 0;
    const ref = k % 100 === 5 ? String(9000000000 + k - 1) : String(9000000000 + k);   // 1% intenta repetir la referencia del pedido anterior (ambos con inicial)
    return como(c, 'anon', { role: 'anon' }, `select cliente_enviar($1, $2::jsonb, $3::jsonb) r`, [p.token, JSON.stringify({ ciudad: d[1], metodo: d[2], detalle: d[3] }), JSON.stringify(conPago ? { banco: 'Banesco', telefono: '04145550000', referencia: ref, fecha: new Date().toISOString().slice(0, 10) } : {})]);
  });
  const res3 = (await db.query("select st, count(*) n from pedidos where code::bigint >= 500000000 group by st order by st")).rows;
  const tipos = {}; r.errores.forEach(e => { tipos[e] = (tipos[e] || 0) + 1; }); if (r.errores.length) console.log("   ERRORES:", JSON.stringify(tipos));
  console.log(`   p50 ${ms(pct(r.tiempos, .5))} · p95 ${ms(pct(r.tiempos, .95))} · errores ${r.errores.length} · estados: ${res3.map(x => x.st + ' ' + x.n).join(', ')}`);

  console.log('\n== 4. 20 cajeros a la vez (5 por caja) vacían las colas ==');
  const cajeros = [];
  for (const [i, d] of DEPTS.entries()) for (let j = 0; j < 5; j++) {
    const id = `00000000-0000-0000-${String(i).padStart(4, '0')}-${String(j).padStart(12, '0')}`;
    await db.query('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [id, `c${i}${j}@x`]);
    await db.query("insert into perfiles (id, nombre, rol, dept) values ($1, $2, 'cajero', $3) on conflict do nothing", [id, 'Cajero ' + d[0] + ' ' + j, d[0]]);
    cajeros.push({ id, dept: d[0] });
  }
  const tomar = [], fact = [], vacios = { n: 0 }; let atendidos = 0;
  a = t0();
  await Promise.all(cajeros.map(async cj => {
    const c = await pool.connect(), claims = { role: 'authenticated', sub: cj.id };
    try {
      for (;;) {
        let s = t0();
        const o = (await como(c, 'authenticated', claims, 'select (tomar_siguiente($1)).code', [cj.dept])).rows[0].code;
        tomar.push(t0() - s);
        if (!o) { vacios.n++; break; }
        s = t0();
        await como(c, 'authenticated', claims, "select accion($1, $2)", [o, atendidos % 20 === 0 ? 'noval' : 'facturar']);
        fact.push(t0() - s); atendidos++;
      }
    } finally { c.release(); }
  }));
  const dur = (t0() - a) / 1000;
  console.log(`   ${atendidos} pedidos atendidos en ${dur.toFixed(1)} s (${(atendidos / dur).toFixed(0)} por segundo entre todos)`);
  console.log(`   «Tomar siguiente» p50 ${ms(pct(tomar, .5))} · p95 ${ms(pct(tomar, .95))} · «Facturar» p50 ${ms(pct(fact, .5))} · p95 ${ms(pct(fact, .95))}`);

  console.log('\n== 5. Integridad ==');
  const dobles = (await db.query("select count(*) n from (select code from eventos where e like 'Tomado en Caja%' and code::bigint >= 500000000 group by code having count(*) > 1) x")).rows[0].n;
  const factDobles = (await db.query("select count(*) n from (select code from eventos where e like 'Facturado%' and code::bigint >= 500000000 group by code having count(*) > 1) x")).rows[0].n;
  const quedan = (await db.query("select count(*) n from pedidos where st in ('caja','tomado') and code::bigint >= 500000000")).rows[0].n;
  const refsDup = (await db.query("select count(*) n from (select referencia from referencias group by banco, referencia having count(*) > 1) x")).rows[0].n;
  const bloqueadas = (await db.query("select count(*) n from pedidos where st = 'cliente' and ini_pct > 0 and code::bigint between 500000000 and 500003599 and (code::bigint - 500000000) % 100 = 5")).rows[0].n;
  console.log(`   pedidos tomados por dos cajeros: ${dobles} · facturados dos veces: ${factDobles} · quedaron en cola: ${quedan}`);
  console.log(`   referencias repetidas guardadas: ${refsDup} · intentos de pago repetido bloqueados: ${bloqueadas}`);

  console.log('\n== 6. Velocidad de las pantallas con todo el historial ==');
  const sup = '00000000-0000-0000-9999-000000000001';
  await db.query("insert into auth.users (id, email) values ($1,'sup@x') on conflict do nothing", [sup]);
  await db.query("insert into perfiles (id, nombre, rol) values ($1,'Sup','supervisor') on conflict do nothing", [sup]);
  const claims = { role: 'authenticated', sub: sup }, desde = new Date(Date.now() - 48 * 3600e3).toISOString();
  const medir = async (nombre, sql, params, veces = 5) => { const ts = []; let n; for (let i = 0; i < veces; i++) { const s = t0(); const q = await como(db, 'authenticated', claims, sql, params); ts.push(t0() - s); n = q.rowCount; } console.log(`   ${nombre.padEnd(46)} ${ms(pct(ts, .5)).padStart(10)}  (${n} filas)`); return pct(ts, .5); };
  const T = {};
  T.panel = await medir('Panel: pedidos activos y de 48 h', "select * from pedidos where (st not in ('despachado','entregado','cancelado') or updated_at >= $1) order by created_at limit 5000", [desde]);
  T.resumen = await medir('Supervisión: resumen del día', 'select resumen_hoy()', []);
  T.ranking = await medir('Productos a apagar (30 días)', 'select * from ranking_agotados(30)', []);
  T.buscar = await medir('Buscar por cédula', "select * from pedidos where cliente->>'cedula' ilike '%2000123%' order by created_at desc limit 20", []);
  T.detalle = await medir('Recorrido de un pedido', "select * from eventos where code = '100123456' order by t", []);
  T.cliente = await medir('Cliente abre su enlace', 'select cliente_ver($1)', [tokens[10].token]);
  const m0 = t0(); const lote = await como(db, 'service_role', { role: 'service_role' }, 'select jsonb_array_length(tomar_mensajes(100)) n', []);
  console.log(`   ${'Cola de WhatsApp: tomar 100 avisos'.padEnd(46)} ${ms(t0() - m0).padStart(10)}  (${lote.rows[0].n} avisos)`);
  console.log('\nRESUMEN_JSON ' + JSON.stringify(T));
  db.release(); await pool.end();
})().catch(e => { console.error('FALLÓ', e); process.exit(1); });
