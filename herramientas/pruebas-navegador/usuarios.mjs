import assert from 'node:assert';
Object.assign(process.env, { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'eyJ.legacy' });
const calls = []; const SUP='11111111-1111-1111-1111-111111111111', CAJ='22222222-2222-2222-2222-222222222222', SUP2='33333333-3333-3333-3333-333333333333';
const PERF = { [SUP]: { rol: 'supervisor', activo: true }, [CAJ]: { rol: 'cajero', activo: true }, [SUP2]: { rol: 'supervisor', activo: true } };
const TOK = { sup: SUP, caj: CAJ };
let otrosSup = [];
globalThis.fetch = async (url, opt = {}) => {
  const u = new URL(url), J = (x, s = 200) => new Response(JSON.stringify(x), { status: s }); calls.push([opt.method || 'GET', u.pathname + u.search, opt.headers]);
  if (u.pathname === '/auth/v1/user') { const t = TOK[(opt.headers.Authorization || '').slice(7)]; return t ? J({ id: t }) : J({}, 401); }
  if (u.pathname === '/rest/v1/perfiles' && u.searchParams.get('rol')) return J(otrosSup);
  if (u.pathname === '/rest/v1/perfiles' && (!opt.method || opt.method === 'GET')) { const id = (u.searchParams.get('id') || '').slice(3); return J(id ? (PERF[id] ? [PERF[id]] : []) : [{ nombre: 'X' }]); }
  if (u.pathname === '/auth/v1/admin/users' && opt.method === 'POST') { const b = JSON.parse(opt.body); return b.email === 'existe@x.com' ? J({ msg: 'A user with this email address has already been registered' }, 422) : J({ id: 'nuevo' }); }
  return new Response(null, { status: 204 });
};
const m = await import('./usuarios.ts');
const call = (tok, b) => m.manejar(new Request('https://p/x', { method: 'POST', headers: tok ? { authorization: 'Bearer ' + tok } : {}, body: JSON.stringify(b) })).then(async r => ({ s: r.status, b: await r.json() }));
assert.equal((await call(null, { accion: 'listar' })).s, 403);
assert.equal((await call('caj', { accion: 'listar' })).s, 403); console.log('✓ solo Supervisión');
assert.equal((await call('sup', { accion: 'listar' })).b.ok, true);
let r = await call('sup', { accion: 'crear', correo: 'rosa@soytechno.com', clave: '12345678', nombre: 'Rosa', rol: 'cajero' }); assert.equal(r.b.detalle, 'Elige la caja del cajero.');
r = await call('sup', { accion: 'crear', correo: 'rosa@soytechno.com', clave: '123', nombre: 'Rosa', rol: 'cajero', dept: 'MRW' }); assert.match(r.b.detalle, /8 caracteres/);
r = await call('sup', { accion: 'crear', correo: 'rosa@soytechno.com', clave: '12345678', nombre: 'Rosa', rol: 'cajero', dept: 'MRW' }); assert.equal(r.b.ok, true, JSON.stringify(r.b));
const perfil = calls.find(c => c[0] === 'POST' && c[1] === '/rest/v1/perfiles'); assert.ok(perfil); console.log('✓ crea usuario y perfil');
r = await call('sup', { accion: 'crear', correo: 'existe@x.com', clave: '12345678', nombre: 'X', rol: 'asesor' }); assert.equal(r.b.detalle, 'Ya existe un usuario con ese correo.'); console.log('✓ correo repetido explicado');
r = await call('sup', { accion: 'desactivar', id: SUP.toUpperCase() }); assert.match(r.b.detalle, /a ti mismo/); console.log('✓ no se da de baja a sí mismo (ni escribiendo su id en mayúsculas)');
r = await call('sup', { accion: 'desactivar', id: SUP2 }); assert.match(r.b.detalle, /al menos un supervisor/); console.log('✓ no se puede dejar el sistema sin supervisores');
r = await call('sup', { accion: 'desactivar', id: '../../admin' }); assert.equal(r.b.detalle, 'Usuario no válido.');
r = await call('sup', { accion: 'desactivar', id: CAJ }); assert.equal(r.b.ok, true);
assert.ok(calls.some(c => c[0] === 'PUT' && c[1] === '/auth/v1/admin/users/' + CAJ)); console.log('✓ baja bloquea el acceso');
assert.ok(calls.every(c => !c[2] || c[2].apikey)); console.log('USUARIOS OK');
