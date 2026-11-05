// Servidor de pruebas que imita a Supabase (auth, REST, RPC, storage, funciones) sobre el Postgres local.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
const PORT = 8765, BASE = 'http://127.0.0.1:' + PORT;
const pool = new pg.Pool({ host: '/var/tmp/soypg', port: 5499, user: 'postgres', database: process.env.BD || 'ui' });
const FOTOS = '/tmp/claude-0/-home-user-soytechno-pedidos/89fe1750-4e61-5c67-a70c-184704d27d34/scratchpad/e2e/fotos';
fs.mkdirSync(FOTOS, { recursive: true });
export const CALLBELL = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  if (String(url).startsWith('https://api.callbell.eu')) { CALLBELL.push(JSON.parse(opt.body)); fs.writeFileSync(FOTOS + '/../callbell.json', JSON.stringify(CALLBELL, null, 1)); return new Response(JSON.stringify({ message: { uuid: 'cb' + CALLBELL.length, status: 'enqueued' } })); }
  return realFetch(url, opt);
};
Object.assign(process.env, { SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: 'servicio', PROCESO_CLAVE: 'proc', INGRESO_CLAVE: 'ing', CALLBELL_API_KEY: 'cb', REMITENTES_PERMITIDOS: 'cashea.app', CLIENTE_URL: 'http://127.0.0.1:8123/repo-soytechno/produccion/cliente.html' });
const FN = { 'procesar-mensajes': await import('./procesar.ts'), 'admin-usuarios': await import('./usuarios.ts'), 'recibir-correo': await import('./recibir.ts') };

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub, email) => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.firma';
function quien(req) {
  const apikey = req.headers.apikey || '';
  const auth = (req.headers.authorization || '').replace(/^Bearer /i, '');
  if (auth === 'servicio') return { rol: 'service_role', claims: { role: 'service_role' } };
  if (auth.split('.').length === 3) { try { const c = JSON.parse(Buffer.from(auth.split('.')[1], 'base64url')); return { rol: 'authenticated', claims: c }; } catch { /* anónimo */ } }
  if (apikey === 'servicio') return { rol: 'service_role', claims: { role: 'service_role' } };
  return { rol: 'anon', claims: { role: 'anon' } };
}
async function como(q, sql, params) {
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query('set local role ' + q.rol); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(q.claims)]);
    const r = await c.query(sql, params); await c.query('commit'); return r;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const ident = s => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('identificador inválido ' + s); return s; };
function col(s) { const m = s.match(/^([a-z_]+)(?:->>([a-z_]+))?$/); if (!m) throw new Error('columna ' + s); return m[2] ? `${ident(m[1])} ->> '${m[2]}'` : ident(m[1]); }
function cond(k, v, P) {
  const neg = v.startsWith('not.'); if (neg) v = v.slice(4);
  const i = v.indexOf('.'), op = v.slice(0, i), x = v.slice(i + 1), c = col(k);
  let s;
  if (op === 'eq') { P.push(x); s = `${c}::text = $${P.length}`; }
  else if (op === 'gte') { P.push(x); s = `${c} >= $${P.length}`; }
  else if (op === 'ilike') { P.push(x.replace(/\*/g, '%')); s = `${c}::text ilike $${P.length}`; }
  else if (op === 'in') { P.push(x.replace(/^\(|\)$/g, '').split(',')); s = `${c}::text = any($${P.length})`; }
  else if (op === 'is') s = `${c} is ${x === 'null' ? 'null' : x}`;
  else throw new Error('operador ' + op);
  return neg ? `not (${s})` : s;
}
function partirOr(s) { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }
function where(u, P) {
  const w = [];
  for (const [k, v] of u.searchParams) {
    if (['select', 'order', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or') { w.push('(' + partirOr(v.replace(/^\(|\)$/g, '')).map(t => { const j = t.indexOf('.'); return cond(t.slice(0, j), t.slice(j + 1), P); }).join(' or ') + ')'); continue; }
    w.push(cond(k, v, P));
  }
  return w.length ? ' where ' + w.join(' and ') : '';
}
const leer = req => new Promise(r => { const ch = []; req.on('data', d => ch.push(d)); req.on('end', () => r(Buffer.concat(ch))); });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
function enviar(res, s, body, h = {}) { res.writeHead(s, { 'content-type': 'application/json', ...CORS, ...h }); res.end(body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body)); }
const errPg = (res, e) => enviar(res, /permission denied/.test(e.message) ? 403 : 400, { message: e.message, code: e.code || 'P0001', details: null, hint: null });

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return enviar(res, 200, '');
  const u = new URL(req.url, BASE), raw = await leer(req), body = raw.length && /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw.toString()) : null, q = quien(req);
  try {
    // ---- auth ----
    if (u.pathname === '/auth/v1/token') {
      const r = await pool.query('select id, email from auth.users where email = $1', [String(body.email || '').toLowerCase()]);
      if (!r.rows[0] || body.password !== 'clave1234') return enviar(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
      const us = r.rows[0], t = jwt(us.id, us.email);
      return enviar(res, 200, { access_token: t, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + us.id, user: { id: us.id, email: us.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
    }
    if (u.pathname === '/auth/v1/user') { if (q.rol !== 'authenticated') return enviar(res, 401, { msg: 'no' }); return enviar(res, 200, { id: q.claims.sub, email: q.claims.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }); }
    if (u.pathname === '/auth/v1/logout') return enviar(res, 204, null);
    if (u.pathname === '/auth/v1/admin/users' && req.method === 'POST') {
      if (q.rol !== 'service_role') return enviar(res, 401, {});
      const ex = await pool.query('select 1 from auth.users where email=$1', [body.email]); if (ex.rowCount) return enviar(res, 422, { msg: 'A user with this email address has already been registered' });
      const r = await pool.query('insert into auth.users (email) values ($1) returning id', [body.email]); return enviar(res, 200, { id: r.rows[0].id, email: body.email });
    }
    if (u.pathname.startsWith('/auth/v1/admin/users/')) return enviar(res, 200, { id: u.pathname.split('/').pop() });
    // ---- funciones ----
    if (u.pathname.startsWith('/functions/v1/')) {
      const f = FN[u.pathname.split('/').pop()]; if (!f) return enviar(res, 404, {});
      const r = await f.manejar(new Request(BASE + u.pathname, { method: req.method, headers: { authorization: req.headers.authorization || '', 'x-clave': req.headers['x-clave'] || '', 'content-type': 'application/json' }, body: raw.length ? raw : '{}' }));
      return enviar(res, r.status, await r.text());
    }
    // ---- storage ----
    if (u.pathname.startsWith('/storage/v1/object/sign/despacho') && req.method === 'POST') return enviar(res, 200, body.paths.map(p => ({ path: p, signedURL: '/object/public-test/' + p + '?token=x', error: null })));
    if (u.pathname.startsWith('/storage/v1/object/public-test/')) { const f = path.join(FOTOS, u.pathname.split('/public-test/')[1].replace(/\//g, '_')); if (!fs.existsSync(f)) return enviar(res, 404, {}); res.writeHead(200, { 'content-type': 'image/jpeg', ...CORS }); return res.end(fs.readFileSync(f)); }
    if (u.pathname.startsWith('/storage/v1/object/despacho/') && req.method === 'POST') {
      const ruta = decodeURIComponent(u.pathname.split('/object/despacho/')[1]);
      await como(q, "insert into storage.objects (bucket_id, name) values ('despacho', $1)", [ruta]);
      fs.writeFileSync(path.join(FOTOS, ruta.replace(/\//g, '_')), raw);
      return enviar(res, 200, { Key: 'despacho/' + ruta, Id: ruta });
    }
    // ---- RPC ----
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = ident(u.pathname.split('/').pop()), ks = Object.keys(body || {});
      const set = (await pool.query("select proretset from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [fn])).rows[0];
      if (!set) return enviar(res, 404, { message: 'función no existe' });
      const args = ks.map((k, i) => `${ident(k)} => $${i + 1}`).join(', '), vals = ks.map(k => body[k] !== null && typeof body[k] === 'object' ? JSON.stringify(body[k]) : body[k]);
      const sql = set.proretset ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as r from public.${fn}(${args}) r` : `select to_jsonb(public.${fn}(${args})) as r`;
      const r = await como(q, sql, vals);
      return enviar(res, 200, JSON.stringify(r.rows[0].r));
    }
    // ---- tablas ----
    const m = u.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (m) {
      const t = ident(m[1]), P = [];
      if (req.method === 'GET') {
        const sel = (u.searchParams.get('select') || '*').split(',').map(s => s === '*' ? '*' : col(s)).join(', ');
        let sql = `select ${sel} from public.${t}` + where(u, P);
        const ord = u.searchParams.get('order'); if (ord) sql += ' order by ' + ord.split(',').map(o => { const [c, d] = o.split('.'); return col(c) + (d === 'desc' ? ' desc' : ''); }).join(', ');
        if (u.searchParams.get('limit')) sql += ' limit ' + Number(u.searchParams.get('limit'));
        const r = await como(q, `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as r from (${sql}) x`, P);
        const rows = r.rows[0].r;
        if (/vnd\.pgrst\.object/.test(req.headers.accept || '')) return rows.length === 1 ? enviar(res, 200, rows[0]) : enviar(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains ' + rows.length + ' rows' });
        return enviar(res, 200, rows);
      }
      if (req.method === 'POST') {
        const ks = Object.keys(body), vals = ks.map(k => body[k] !== null && typeof body[k] === 'object' ? JSON.stringify(body[k]) : body[k]);
        const r = await como(q, `insert into public.${t} (${ks.map(ident).join(',')}) values (${ks.map((_, i) => '$' + (i + 1)).join(',')})` + (u.searchParams.get('on_conflict') ? ` on conflict (${ident(u.searchParams.get('on_conflict'))}) do nothing` : '') + ' returning *', vals);
        return enviar(res, 201, r.rows);
      }
      if (req.method === 'PATCH') {
        const ks = Object.keys(body); ks.forEach(k => P.push(body[k] !== null && typeof body[k] === 'object' ? JSON.stringify(body[k]) : body[k]));
        const r = await como(q, `update public.${t} set ${ks.map((k, i) => ident(k) + ' = $' + (i + 1)).join(', ')}` + where(u, P) + ' returning *', P);
        return enviar(res, 200, r.rows);
      }
    }
    if (u.pathname.startsWith('/realtime/')) { res.writeHead(400); return res.end(); }
    enviar(res, 404, { message: 'no simulado: ' + req.method + ' ' + u.pathname });
  } catch (e) { errPg(res, e); }
}).listen(PORT, () => console.log('shim listo en ' + BASE));
