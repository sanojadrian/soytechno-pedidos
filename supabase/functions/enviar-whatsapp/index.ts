// Soytechno · Pedidos Cashea — envía los avisos de WhatsApp a través de Callbell.
//
// La clave de Callbell vive SOLO aquí, como secreto de Supabase (CALLBELL_API_KEY).
// Nunca va en el código de las páginas, que es público.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   CALLBELL_API_KEY        clave de la API de Callbell (obligatoria)
//   DEMO_TELEFONOS          números autorizados para la demo, separados por coma (obligatoria)
//   CALLBELL_CHANNEL_UUID   canal de WhatsApp en Callbell (si la cuenta tiene más de uno)
//   CALLBELL_TEMPLATE_UUID  plantilla aprobada para el primer mensaje (opcional)
//   CLIENTE_URL             dirección de la página del cliente (opcional)
//
// Seguridad de la demo: el texto de cada mensaje se arma aquí, a partir del pedido
// guardado, y solo se envía a los números de DEMO_TELEFONOS.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const CALLBELL = 'https://api.callbell.eu/v1/messages/send';
const TIPOS = ['enlace', 'lecheria', 'alternativas', 'despachado'];
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const env = (k: string): string => (typeof Deno !== 'undefined' ? Deno.env.get(k) : (globalThis as any).process?.env?.[k]) || '';

/** Teléfono venezolano a formato internacional: 0414-555-0123 → +584145550123. */
export function normalizar(t: string): string {
  let d = String(t || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '58' + d.slice(1);
  else if (d.length === 10 && d.startsWith('4')) d = '58' + d;
  return d.length >= 11 ? '+' + d : '';
}

export function autorizado(tel: string, lista: string): boolean {
  const n = normalizar(tel);
  return !!n && lista.split(',').map(normalizar).filter(Boolean).includes(n);
}

const nombre1 = (o: any): string => {
  const n = String(o?.cliente?.nombre || '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || '';
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
};
const dinero = (n: number): string => '$' + Number(n || 0).toFixed(2);

/** Fecha de llegada desde Lechería, en hora de Venezuela (UTC−4). Igual que en la página del cliente. */
export function etaLecheria(desde?: string): string {
  const d = new Date(new Date(desde || Date.now()).getTime() - 4 * 3600e3);
  const add = [4, 3, 2, 1, 7, 6, 5][d.getUTCDay()];
  const th = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add));
  const fr = new Date(th.getTime() + 864e5);
  return th.getUTCMonth() === fr.getUTCMonth()
    ? `jueves ${th.getUTCDate()} o viernes ${fr.getUTCDate()} de ${MES[fr.getUTCMonth()]}`
    : `jueves ${th.getUTCDate()} de ${MES[th.getUTCMonth()]} o viernes ${fr.getUTCDate()} de ${MES[fr.getUTCMonth()]}`;
}

/** Texto del mensaje según el momento del pedido. */
export function mensaje(o: any, tipo: string, enlace: string): string {
  const hola = nombre1(o) ? `Hola ${nombre1(o)}` : 'Hola';
  const ped = `#${o.code}`;
  if (tipo === 'enlace') {
    const ini = Number(o.ini_pct) ? ` Tu inicial es de ${dinero(o.ini_monto)} (${Number(o.ini_pct)}%).` : '';
    return `¡${hola}! 👋 Recibimos tu pedido Cashea ${ped}: ${o.producto}.${ini}\n\nElige cómo quieres recibirlo${Number(o.ini_pct) ? ' y reporta tu pago' : ''} aquí:\n${enlace}`;
  }
  if (tipo === 'lecheria') {
    return `${hola}, tu equipo del pedido ${ped} está en nuestra tienda de Lechería y llega a Caracas el ${etaLecheria(o?.ajuste?.solicitado_at)}.\n\nDinos si prefieres esperar o cambiarlo aquí:\n${enlace}`;
  }
  if (tipo === 'alternativas') {
    return `${hola}, el producto de tu pedido ${ped} no está disponible en este momento. Te preparamos otras opciones.\n\nElige la que prefieras aquí:\n${enlace}`;
  }
  // despachado
  const e = o.entrega || {};
  let como = 'ya salió hacia ti';
  if (String(e.metodo || '').startsWith('Pickup')) como = 'ya está listo para retirar en nuestra Tienda Chacao, Av. Andrés Galarraga';
  else if (e.metodo === 'MRW') como = `ya salió por MRW${e.guia ? ` con la guía ${e.guia}` : ''}`;
  else if (e.metodo === 'Ruta foránea') como = 'ya salió en nuestra ruta foránea';
  else if (e.metodo === 'Delivery') como = 'ya salió con nuestro delivery';
  return `¡Listo, ${nombre1(o) || 'cliente'}! Tu pedido ${ped} ${como}.\n\nPuedes ver el detalle aquí:\n${enlace}`;
}

/** Cuerpo de la llamada a Callbell. */
export function cuerpoCallbell(o: any, tipo: string, to: string, enlace: string): Record<string, unknown> {
  const body: Record<string, unknown> = { to, from: 'whatsapp', type: 'text', content: { text: mensaje(o, tipo, enlace) } };
  if (env('CALLBELL_CHANNEL_UUID')) body.channel_uuid = env('CALLBELL_CHANNEL_UUID');
  if (tipo === 'enlace' && env('CALLBELL_TEMPLATE_UUID')) {
    body.template_uuid = env('CALLBELL_TEMPLATE_UUID');
    body.optin_contact = true;
    body.template_values = [nombre1(o) || 'cliente', String(o.code), enlace];
  }
  return body;
}

const json = (x: unknown) => new Response(JSON.stringify(x), { headers: { ...CORS, 'Content-Type': 'application/json' } });

export async function manejar(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, motivo: 'metodo', detalle: 'Usa POST.' });
  let p: any;
  try { p = await req.json(); } catch { return json({ ok: false, motivo: 'datos', detalle: 'Faltan los datos del aviso.' }); }
  const code = String(p?.code || '').trim(), tipo = String(p?.tipo || '');
  if (!code || !TIPOS.includes(tipo)) return json({ ok: false, motivo: 'datos', detalle: 'Pedido o tipo de aviso no válido.' });
  if (!env('CALLBELL_API_KEY')) return json({ ok: false, motivo: 'config', detalle: 'Falta el secreto CALLBELL_API_KEY en Supabase.' });

  // Leer el pedido guardado
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || req.headers.get('apikey') || env('SUPABASE_ANON_KEY');
  const r = await fetch(`${url}/rest/v1/pedidos?code=eq.${encodeURIComponent(code)}&select=*`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const filas = r.ok ? await r.json() : [];
  const o = filas[0];
  if (!o) return json({ ok: false, motivo: 'pedido', detalle: `No encontré el pedido #${code}.` });

  const to = normalizar(p?.telefono || o?.cliente?.telefono);
  if (!to) return json({ ok: false, motivo: 'telefono', detalle: 'El pedido no tiene un teléfono válido.' });
  if (!autorizado(to, env('DEMO_TELEFONOS'))) return json({ ok: false, motivo: 'no_autorizado', detalle: `El ${to} no está autorizado para la demo.` });

  const base = env('CLIENTE_URL') || 'https://sanojadrian.github.io/soytechno-pedidos/cliente.html?c=';
  const enlace = base + encodeURIComponent(code);
  const cb = await fetch(CALLBELL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('CALLBELL_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpoCallbell(o, tipo, to, enlace)),
  });
  const txt = await cb.text();
  let res: any = null; try { res = JSON.parse(txt); } catch { /* respuesta no JSON */ }
  if (!cb.ok) return json({ ok: false, motivo: 'callbell', status: cb.status, detalle: (res && (res.message || res.error)) || txt.slice(0, 300) });
  return json({ ok: true, to, tipo, uuid: res?.message?.uuid || null, estado: res?.message?.status || null });
}

if (typeof Deno !== 'undefined') Deno.serve(manejar);
