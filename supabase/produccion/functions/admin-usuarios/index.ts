// Soytechno · Pedidos Cashea — ADMINISTRAR USUARIOS
//
// Solo Supervisión. Crea usuarios con su rol, cambia datos, cambia claves y
// da de baja (la persona deja de poder entrar, pero su historial se conserva).
//
// Secretos: SERVICIO_CLAVE solo si SUPABASE_SERVICE_ROLE_KEY no existe.
// Ajuste: Enforce JWT verification = APAGADO (valida al supervisor por dentro).

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const ROLES = ['supervisor', 'operador', 'cajero', 'despacho', 'ajuste', 'asesor', 'admin', 'tienda'];
const DEPTS = ['Delivery', 'Pickup', 'MRW', 'Ruta'];
const env = (k: string): string => (typeof Deno !== 'undefined' ? Deno.env.get(k) : (globalThis as any).process?.env?.[k]) || '';
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function claveServicio(): string { return env('SERVICIO_CLAVE') || env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY'); }
function hdr(extra: Record<string, string> = {}): Record<string, string> {
  const k = claveServicio();
  const h: Record<string, string> = { apikey: k, 'Content-Type': 'application/json', ...extra };
  if (!k.startsWith('sb_')) h.Authorization = `Bearer ${k}`;
  return h;
}
async function llamar(path: string, init: RequestInit & { prefer?: string } = {}) {
  const r = await fetch(`${env('SUPABASE_URL')}${path}`, { ...init, headers: hdr(init.prefer ? { Prefer: init.prefer } : {}) });
  const t = await r.text();
  let d: any = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  if (!r.ok) throw new Error(traducir((d && (d.msg || d.message || d.error_description || d.error)) || `Error ${r.status}`));
  return d;
}
function traducir(m: string): string {
  if (/already been registered|already exists/i.test(m)) return 'Ya existe un usuario con ese correo.';
  if (/password/i.test(m) && /least|short|weak/i.test(m)) return 'La clave es muy corta: usa al menos 8 caracteres.';
  if (/email/i.test(m) && /invalid/i.test(m)) return 'El correo no es válido.';
  return m;
}

export function validarPerfil(d: any, parcial = false): string | null {
  if (!parcial || d.nombre !== undefined) { if (!String(d.nombre || '').trim()) return 'Escribe el nombre.'; }
  if (!parcial || d.rol !== undefined) { if (!ROLES.includes(d.rol)) return 'Rol no válido.'; }
  if (d.rol === 'cajero' && !DEPTS.includes(d.dept)) return 'Elige la caja del cajero.';
  if (d.rol === 'tienda' && !String(d.tienda || '').trim()) return 'Elige la tienda.';
  return null;
}
const limpio = (d: any) => ({
  nombre: String(d.nombre || '').trim().slice(0, 80),
  rol: d.rol,
  dept: d.rol === 'cajero' ? d.dept : null,
  tienda: d.rol === 'tienda' ? String(d.tienda || '').trim() : null,
  telefono: String(d.telefono || '').trim() || null,
});

async function esSupervisor(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: claveServicio(), Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  const p = await llamar(`/rest/v1/perfiles?id=eq.${u.id}&select=rol,activo`);
  return p && p[0] && p[0].activo && p[0].rol === 'supervisor' ? u.id : null;
}

export async function manejar(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const yo = await esSupervisor(req);
  if (!yo) return json({ ok: false, detalle: 'Solo Supervisión puede administrar usuarios.' }, 403);
  let b: any; try { b = await req.json(); } catch { return json({ ok: false, detalle: 'Datos no válidos.' }, 400); }

  try {
    switch (b?.accion) {
      case 'listar': {
        const perfiles = await llamar('/rest/v1/perfiles?select=*&order=rol,nombre');
        return json({ ok: true, usuarios: perfiles });
      }
      case 'crear': {
        const err = validarPerfil(b); if (err) return json({ ok: false, detalle: err }, 400);
        const correo = String(b.correo || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return json({ ok: false, detalle: 'El correo no es válido.' }, 400);
        if (String(b.clave || '').length < 8) return json({ ok: false, detalle: 'La clave debe tener al menos 8 caracteres.' }, 400);
        const u = await llamar('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: correo, password: b.clave, email_confirm: true }) });
        try {
          await llamar('/rest/v1/perfiles', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ id: u.id, correo, activo: true, ...limpio(b) }) });
        } catch (e) {
          await llamar(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' }).catch(() => {});
          throw e;
        }
        return json({ ok: true, id: u.id });
      }
      case 'editar': {
        if (!b.id) return json({ ok: false, detalle: 'Falta el usuario.' }, 400);
        const err = validarPerfil(b); if (err) return json({ ok: false, detalle: err }, 400);
        if (b.id === yo && b.rol !== 'supervisor') return json({ ok: false, detalle: 'No puedes quitarte a ti mismo el rol de supervisor.' }, 400);
        await llamar(`/rest/v1/perfiles?id=eq.${encodeURIComponent(b.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(limpio(b)) });
        return json({ ok: true });
      }
      case 'clave': {
        if (String(b.clave || '').length < 8) return json({ ok: false, detalle: 'La clave debe tener al menos 8 caracteres.' }, 400);
        await llamar(`/auth/v1/admin/users/${encodeURIComponent(b.id)}`, { method: 'PUT', body: JSON.stringify({ password: b.clave }) });
        return json({ ok: true });
      }
      case 'activar': case 'desactivar': {
        const activo = b.accion === 'activar';
        if (b.id === yo && !activo) return json({ ok: false, detalle: 'No puedes darte de baja a ti mismo.' }, 400);
        await llamar(`/auth/v1/admin/users/${encodeURIComponent(b.id)}`, { method: 'PUT', body: JSON.stringify({ ban_duration: activo ? 'none' : '876000h' }) });
        await llamar(`/rest/v1/perfiles?id=eq.${encodeURIComponent(b.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ activo }) });
        return json({ ok: true });
      }
    }
    return json({ ok: false, detalle: 'Acción no válida.' }, 400);
  } catch (e) {
    return json({ ok: false, detalle: (e as Error).message }, 400);
  }
}

if (typeof Deno !== 'undefined') Deno.serve(manejar);
