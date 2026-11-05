// Soytechno · Pedidos Cashea — RECIBIR CORREO
//
// Recibe cada correo de Cashea (lo envía el script de Gmail de la carpeta
// integraciones/), lo guarda tal cual, lo lee y crea el pedido. Si no lo
// puede leer, el correo queda en la Bandeja como «revisar»: nunca se pierde.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   INGRESO_CLAVE    clave compartida con el script de Gmail (obligatoria)
//   PROCESO_CLAVE    clave para avisar a procesar-mensajes (obligatoria)
//   SERVICIO_CLAVE   la clave secreta del proyecto, solo si SUPABASE_SERVICE_ROLE_KEY no existe
// Ajuste: Enforce JWT verification = APAGADO (la protege INGRESO_CLAVE).

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-clave', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const env = (k: string): string => (typeof Deno !== 'undefined' ? Deno.env.get(k) : (globalThis as any).process?.env?.[k]) || '';
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function claveServicio(): string { return env('SERVICIO_CLAVE') || env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY'); }
function hdrServicio(extra: Record<string, string> = {}): Record<string, string> {
  const k = claveServicio();
  const h: Record<string, string> = { apikey: k, 'Content-Type': 'application/json', ...extra };
  if (!k.startsWith('sb_')) h.Authorization = `Bearer ${k}`;   // las claves nuevas (sb_secret_…) van solo en apikey
  return h;
}
async function rest(path: string, init: RequestInit & { prefer?: string } = {}) {
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, { ...init, headers: hdrServicio(init.prefer ? { Prefer: init.prefer } : {}) });
  const t = await r.text();
  let d: any = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  if (!r.ok) throw new Error((d && (d.message || d.error)) || `Error ${r.status}`);
  return d;
}

/* ---------- lector del correo de Cashea (mismo criterio que la demo) ---------- */
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function num(s: string | null | undefined): number {
  if (s == null) return NaN;
  let x = String(s).replace(/[^\d.,-]/g, '');
  if (x.includes('.') && x.includes(',')) x = x.lastIndexOf(',') > x.lastIndexOf('.') ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
  else if (x.includes(',')) x = x.replace(',', '.');
  return parseFloat(x);
}
export function leerCashea(txt: string) {
  const lines = String(txt || '').replace(/\r/g, '').replace(/ /g, ' ').split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const L = lines.map(norm);
  const idx = (lbl: string) => L.findIndex(l => l.startsWith(lbl));
  const after = (lbl: string): string | null => {
    const i = idx(lbl); if (i < 0) return null;
    const rest = lines[i].slice(lines[i].indexOf(':') > -1 ? lines[i].indexOf(':') + 1 : lbl.length).trim();
    return rest || lines[i + 1] || null;
  };
  const p: any = { errores: [] as string[] };
  p.code = (after('codigo de identificacion') || '').replace(/\D/g, '');
  p.cuotas = { n: parseInt(after('numero de cuotas') || '', 10) || null, primera: after('fecha primer pago'), ultima: after('fecha ultimo pago') };
  const ic = idx('informacion de cliente'), rp = idx('resumen de pedido');
  const cli = { nombre: '', telefono: '', cedula: '', correo: '' };
  if (ic > -1) {
    const end = rp > ic ? rp : Math.min(lines.length, ic + 6);
    lines.slice(ic + 1, end).forEach(l => {
      const d = l.replace(/\D/g, '');
      if (/@/.test(l) && !cli.correo) cli.correo = l;
      else if (/^[+\d][\d\s()-]+$/.test(l) && d.length >= 10 && !cli.telefono) cli.telefono = l;
      else if (/^[VEJve]?[-\s.]?[\d.]+$/.test(l) && d.length >= 6 && d.length <= 9 && !cli.cedula) cli.cedula = l;
      else if (!cli.nombre && /[a-zA-ZÀ-ÿ]/.test(l)) cli.nombre = l;
    });
  }
  p.cliente = cli;
  const prod: string[] = [];
  if (rp > -1) for (let i = rp + 1; i < lines.length; i++) {
    if (/^(precio|cantidad|total|subtotal|resumen|iva|pago inicial)/.test(L[i]) || lines[i].startsWith('@')) break;
    prod.push(lines[i]);
  }
  p.producto = prod.join(' ').trim();
  p.cantidad = parseInt(String(after('cantidad') || '1').replace(/\D/g, ''), 10) || 1;
  const val = (i: number) => { const t = lines[i].indexOf(':') > -1 ? lines[i].slice(lines[i].indexOf(':') + 1) : (lines[i + 1] || ''); const m = t.match(/[\d.,]+/); return m ? num(m[0]) : NaN; };
  const ult = (re: RegExp) => { let r = -1; L.forEach((l, i) => { if (re.test(l)) r = i; }); return r; };
  const si = ult(/^subtotal\b/), ii = ult(/^iva\b/), ti = ult(/^total\b/), pr = ult(/^precio\b/);
  p.total_cashea = ti > -1 ? val(ti) : NaN;
  p.iva = ii > -1 ? val(ii) : NaN;
  p.precio = pr > -1 ? val(pr) : NaN;
  p.iva_nota = '';
  if (si > -1) p.total = val(si);
  else if (p.total_cashea > 0 && p.iva >= 0) p.total = Math.round((p.total_cashea - p.iva) * 100) / 100;
  else if (p.total_cashea > 0) { p.total = Math.round(p.total_cashea / 1.16 * 100) / 100; p.iva_nota = 'IVA calculado al 16%: revisar'; }
  else p.total = NaN;
  const pi = idx('pago inicial');
  if (pi > -1) {
    const t = lines[pi].indexOf(':') > -1 ? lines[pi].slice(lines[pi].indexOf(':') + 1) : (lines[pi + 1] || '');
    const m = t.match(/\$\s*([\d.,]+)/), pc = t.match(/([\d.,]+)\s*%/);
    p.ini_monto = m ? num(m[1]) : 0;
    p.ini_pct = pc ? num(pc[1]) : (p.total_cashea ? Math.round(p.ini_monto / p.total_cashea * 100) : 0);
  } else { p.ini_monto = 0; p.ini_pct = 0; }
  p.mix = /\bmix\b/i.test(p.producto);
  p.cuotas = { ...p.cuotas, precio: p.precio, iva: p.iva, total_cashea: p.total_cashea };
  if (!p.code) p.errores.push('No encontré el código de identificación.');
  if (!p.producto) p.errores.push('No encontré el producto.');
  if (!(p.total > 0)) p.errores.push('No encontré el total.');
  if (!cli.telefono) p.errores.push('No encontré el teléfono del cliente.');
  return p;
}
export const esCorreoDePedido = (txt: string) => norm(txt).includes('codigo de identificacion');

/* ---------- función ---------- */
export async function manejar(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, detalle: 'Usa POST.' }, 405);
  if (!env('INGRESO_CLAVE') || req.headers.get('x-clave') !== env('INGRESO_CLAVE')) return json({ ok: false, detalle: 'Clave de ingreso incorrecta.' }, 401);

  let b: any;
  try { b = await req.json(); } catch { return json({ ok: false, detalle: 'Cuerpo no válido.' }, 400); }
  const texto = String(b?.texto || '').slice(0, 100000);
  if (!texto.trim()) return json({ ok: false, detalle: 'El correo viene vacío.' }, 400);
  const mensajeId = String(b?.mensaje_id || '').slice(0, 300) || null;

  // 1) Guardar el correo tal cual (si ya llegó antes, no se repite)
  const guardado = await rest('correos' + (mensajeId ? '?on_conflict=mensaje_id' : ''), {
    method: 'POST', prefer: 'return=representation,resolution=ignore-duplicates',
    body: JSON.stringify({ mensaje_id: mensajeId, remitente: String(b?.remitente || '').slice(0, 300), asunto: String(b?.asunto || '').slice(0, 500), texto }),
  });
  const correo = Array.isArray(guardado) ? guardado[0] : null;
  if (!correo) return json({ ok: true, estado: 'repetido', detalle: 'Ese correo ya se había recibido.' });

  const marcar = (estado: string, extra: Record<string, unknown> = {}) =>
    rest(`correos?id=eq.${correo.id}`, { method: 'PATCH', body: JSON.stringify({ estado, ...extra }) });

  // 2) ¿Es un correo de pedido?
  if (!esCorreoDePedido(texto)) { await marcar('ignorado', { detalle: 'No es un correo de pedido de Cashea.' }); return json({ ok: true, estado: 'ignorado' }); }

  // 3) Leerlo
  const p = leerCashea(texto);
  if (p.errores.length) { await marcar('revisar', { code: p.code || null, detalle: p.errores.join(' ') }); return json({ ok: true, estado: 'revisar', detalle: p.errores }); }

  // 4) Crear el pedido
  let r: any;
  try {
    r = await rest('rpc/ingresar_pedido', { method: 'POST', body: JSON.stringify({ p, p_correo_id: correo.id }) });
  } catch (e) {
    await marcar('revisar', { code: p.code, detalle: String((e as Error).message) });
    return json({ ok: true, estado: 'revisar', detalle: String((e as Error).message) });
  }
  await marcar(r.estado === 'creado' ? 'ok' : 'duplicado', { code: p.code, detalle: r.estado === 'creado' ? null : 'El pedido ya existía.' });

  // 5) Avisar a la cola de WhatsApp para que salga de inmediato (si falla, el cron lo envía en un minuto)
  if (r.estado === 'creado' && env('PROCESO_CLAVE')) {
    try { await fetch(`${env('SUPABASE_URL')}/functions/v1/procesar-mensajes`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-clave': env('PROCESO_CLAVE') }, body: '{}' }); } catch { /* el cron lo reintenta */ }
  }
  return json({ ok: true, estado: r.estado, code: p.code });
}

if (typeof Deno !== 'undefined') Deno.serve(manejar);
