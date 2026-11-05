// Soytechno · Pedidos Cashea — PROCESAR MENSAJES (WhatsApp por Callbell)
//
// Envía los avisos que la base de datos deja en la cola (tabla mensajes):
// enlace del pedido, fecha de Lechería, alternativas, despacho, retrasos y
// alertas a Supervisión. Reintenta 3 veces. La llaman el cron (cada minuto),
// recibir-correo y el panel después de cada acción.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   CALLBELL_API_KEY        clave de la API de Callbell (obligatoria)
//   PROCESO_CLAVE           clave del cron y de recibir-correo (obligatoria)
//   CLIENTE_URL             dirección de la página del cliente, terminada en "cliente.html" (obligatoria)
//   CALLBELL_CHANNEL_UUID   canal de WhatsApp, si la cuenta tiene más de uno
//   CALLBELL_TEMPLATE_UUID  plantilla aprobada para el primer mensaje (recomendada)
//   SOLO_TELEFONOS          PILOTO: si existe, solo se envía a estos números (separados por coma)
//   SERVICIO_CLAVE          la clave secreta del proyecto, solo si SUPABASE_SERVICE_ROLE_KEY no existe
// Ajuste: Enforce JWT verification = APAGADO (valida la clave o el usuario por dentro).

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-clave', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const CALLBELL = 'https://api.callbell.eu/v1/messages/send';
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const env = (k: string): string => (typeof Deno !== 'undefined' ? Deno.env.get(k) : (globalThis as any).process?.env?.[k]) || '';
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function claveServicio(): string { return env('SERVICIO_CLAVE') || env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY'); }
function hdrServicio(): Record<string, string> {
  const k = claveServicio();
  const h: Record<string, string> = { apikey: k, 'Content-Type': 'application/json' };
  if (!k.startsWith('sb_')) h.Authorization = `Bearer ${k}`;
  return h;
}
async function rpc(nombre: string, args: unknown) {
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${nombre}`, { method: 'POST', headers: hdrServicio(), body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${nombre}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

/** Comparación en tiempo constante para claves compartidas */
function claveIgual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** ¿Quién llama? El cron o recibir-correo (x-clave) o una persona ACTIVA del personal. */
async function autorizado(req: Request): Promise<boolean> {
  if (claveIgual(req.headers.get('x-clave') || '', env('PROCESO_CLAVE'))) return true;
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return false;
  const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: claveServicio(), Authorization: auth } });
  if (!r.ok) return false;
  const u = await r.json();
  if (!/^[0-9a-f-]{36}$/i.test(String(u?.id || ''))) return false;
  const p = await fetch(`${env('SUPABASE_URL')}/rest/v1/perfiles?id=eq.${u.id}&select=activo`, { headers: hdrServicio() });
  const f = p.ok ? await p.json() : [];
  return !!(f[0] && f[0].activo);
}

/* ---------- textos ---------- */
export function normalizar(t: string): string {
  let d = String(t || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '58' + d.slice(1);
  else if (d.length === 10 && d.startsWith('4')) d = '58' + d;
  return d.length >= 11 ? '+' + d : '';
}
const nombre1 = (o: any): string => {
  const n = String(o?.cliente?.nombre || '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || '';
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
};
const dinero = (n: number): string => '$' + Number(n || 0).toFixed(2);
export function etaLecheria(desde?: string): string {
  const d = new Date(new Date(desde || Date.now()).getTime() - 4 * 3600e3);   // hora de Venezuela
  const th = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + [4, 3, 2, 1, 7, 6, 5][d.getUTCDay()]));
  const fr = new Date(th.getTime() + 864e5);
  return th.getUTCMonth() === fr.getUTCMonth()
    ? `jueves ${th.getUTCDate()} o viernes ${fr.getUTCDate()} de ${MES[fr.getUTCMonth()]}`
    : `jueves ${th.getUTCDate()} de ${MES[th.getUTCMonth()]} o viernes ${fr.getUTCDate()} de ${MES[fr.getUTCMonth()]}`;
}
export function enlaceDe(o: any): string {
  const base = env('CLIENTE_URL') || '';
  return base + (base.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(o.token);
}
export function texto(tipo: string, o: any, link: string): string {
  const hola = nombre1(o) ? `Hola ${nombre1(o)}` : 'Hola';
  const ped = `#${o.code}`;
  switch (tipo) {
    case 'enlace': {
      const ini = Number(o.ini_pct) ? ` Tu inicial es de ${dinero(o.ini_monto)} (${Number(o.ini_pct)}%).` : '';
      return `¡${hola}! 👋 Recibimos tu pedido Cashea ${ped}: ${String(o.producto || '').replace(/[.\s]+$/, '')}.${ini}\n\nElige cómo quieres recibirlo${Number(o.ini_pct) ? ' y reporta tu pago' : ''} aquí:\n${link}`;
    }
    case 'lecheria':
      return `${hola}, tu equipo del pedido ${ped} está en nuestra tienda de Lechería y llega a Caracas el ${etaLecheria(o?.ajuste?.solicitado_at)}.\n\nDinos si prefieres esperar o cambiarlo aquí:\n${link}`;
    case 'alternativas':
      return `${hola}, el producto de tu pedido ${ped} no está disponible en este momento. Te preparamos otras opciones.\n\nElige la que prefieras aquí:\n${link}`;
    case 'retraso':
      return `${hola}, tu pedido ${ped} está tardando un poco más de lo previsto porque lo estamos trayendo de otra tienda. Te avisamos apenas salga.\n\nPuedes ver el estado aquí:\n${link}`;
    case 'despachado': {
      const e = o.entrega || {};
      let como = 'ya salió hacia ti';
      if (String(e.metodo || '').startsWith('Pickup')) como = 'ya está listo para retirar en nuestra Tienda Chacao, Av. Andrés Galarraga';
      else if (e.metodo === 'MRW') como = `ya salió por MRW${e.guia ? ` con la guía ${e.guia}` : ''}`;
      else if (e.metodo === 'Ruta foránea') como = 'ya salió en nuestra ruta foránea';
      else if (e.metodo === 'Delivery') como = 'ya salió con nuestro delivery';
      return `¡Listo, ${nombre1(o) || 'cliente'}! Tu pedido ${ped} ${como}.\n\nPuedes ver el detalle aquí:\n${link}`;
    }
  }
  return '';
}
export function cuerpoCallbell(m: any): { to: string; body: Record<string, unknown> } | { omitir: string } {
  const o = m.pedido;
  const to = normalizar(m.tipo === 'alerta' ? m.para : o?.cliente?.telefono);
  if (!to) return { omitir: 'Sin teléfono válido.' };
  const solo = env('SOLO_TELEFONOS');
  if (solo && !solo.split(',').map(normalizar).includes(to)) return { omitir: `Piloto: ${to} no está en SOLO_TELEFONOS.` };
  if (m.tipo !== 'alerta' && (!o || !o.token)) return { omitir: 'Pedido no encontrado.' };
  const link = m.tipo === 'alerta' ? '' : enlaceDe(o);
  const msg = m.tipo === 'alerta' ? String(m.texto || '') : texto(m.tipo, o, link);
  if (!msg) return { omitir: 'Tipo de mensaje desconocido.' };
  const body: Record<string, unknown> = { to, from: 'whatsapp', type: 'text', content: { text: msg } };
  if (env('CALLBELL_CHANNEL_UUID')) body.channel_uuid = env('CALLBELL_CHANNEL_UUID');
  if (m.tipo === 'enlace' && env('CALLBELL_TEMPLATE_UUID')) {
    body.template_uuid = env('CALLBELL_TEMPLATE_UUID');
    body.optin_contact = true;
    body.template_values = [nombre1(o) || 'cliente', String(o.code), link];
  }
  return { to, body };
}

/* ---------- función ---------- */
export async function manejar(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!(await autorizado(req))) return json({ ok: false, detalle: 'No autorizado.' }, 401);
  if (!env('CALLBELL_API_KEY')) return json({ ok: false, detalle: 'Falta el secreto CALLBELL_API_KEY.' }, 500);
  if (!env('CLIENTE_URL')) return json({ ok: false, detalle: 'Falta el secreto CLIENTE_URL.' }, 500);

  const res = { enviados: 0, fallidos: 0, omitidos: 0 };
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const lote: any[] = await rpc('tomar_mensajes', { p_n: 20 });
    if (!lote || !lote.length) break;
    for (const m of lote) {
      const c = cuerpoCallbell(m);
      if ('omitir' in c) { await rpc('resultado_mensaje', { p_id: m.id, p_ok: false, p_detalle: c.omitir, p_omitir: true }); res.omitidos++; continue; }
      try {
        const r = await fetch(CALLBELL, { method: 'POST', headers: { Authorization: `Bearer ${env('CALLBELL_API_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(c.body) });
        const t = await r.text();
        let d: any = null; try { d = JSON.parse(t); } catch { /* no es JSON */ }
        if (r.ok) { await rpc('resultado_mensaje', { p_id: m.id, p_ok: true, p_detalle: d?.message?.status || null, p_uuid: d?.message?.uuid || null }); res.enviados++; }
        else { await rpc('resultado_mensaje', { p_id: m.id, p_ok: false, p_detalle: `Callbell ${r.status}: ${(d && (d.message || d.error)) || t.slice(0, 200)}` }); res.fallidos++; }
      } catch (e) {
        await rpc('resultado_mensaje', { p_id: m.id, p_ok: false, p_detalle: 'Sin conexión con Callbell: ' + (e as Error).message }); res.fallidos++;
      }
    }
  }
  return json({ ok: true, ...res });
}

if (typeof Deno !== 'undefined') Deno.serve(manejar);
