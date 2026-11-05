/* Soytechno · Pedidos Cashea — utilidades compartidas (producción) */
(function (g) {
  'use strict';

  const CFG = g.SOY_CONFIG || {};
  const listo = !!(CFG.supabaseUrl && CFG.supabaseKey && g.supabase && !/TU-PROYECTO|PEGA_AQUI/.test(CFG.supabaseUrl + CFG.supabaseKey));
  const sb = listo ? g.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true }, realtime: { params: { eventsPerSecond: 10 } } }) : null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$' + Number(n || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  const fechaVE = v => v ? String(v).split('-').reverse().join('/') : '';
  const hora = t => new Date(t).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });
  const fechaHora = t => new Date(t).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });

  function num(s) {
    if (s == null) return NaN;
    let x = String(s).replace(/[^\d.,-]/g, '');
    if (x.includes('.') && x.includes(',')) {
      x = x.lastIndexOf(',') > x.lastIndexOf('.') ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
    } else if (x.includes(',')) x = x.replace(',', '.');
    return parseFloat(x);
  }

  /* Lee el texto de un correo de Cashea y devuelve el pedido */
  function parseCashea(txt) {
    const lines = String(txt || '').replace(/\r/g, '').replace(/ /g, ' ').split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const L = lines.map(norm);
    const idx = lbl => L.findIndex(l => l.startsWith(lbl));
    const after = lbl => {
      const i = idx(lbl); if (i < 0) return null;
      const rest = lines[i].slice(lines[i].indexOf(':') > -1 ? lines[i].indexOf(':') + 1 : lbl.length).trim();
      return rest || lines[i + 1] || null;
    };
    const p = { errores: [] };
    const codigo = (after('codigo de identificacion') || '').replace(/\D/g, '');
    p.code = codigo;
    p.cuotas = { n: parseInt(after('numero de cuotas'), 10) || null, primera: after('fecha primer pago'), ultima: after('fecha ultimo pago') };

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

    let prod = [];
    if (rp > -1) {
      for (let i = rp + 1; i < lines.length; i++) {
        if (/^(precio|cantidad|total|subtotal|resumen|iva|pago inicial)/.test(L[i]) || lines[i].startsWith('@')) break;
        prod.push(lines[i]);
      }
    }
    p.producto = prod.join(' ').trim();
    const cant = after('cantidad');
    p.cantidad = parseInt(String(cant || '1').replace(/\D/g, ''), 10) || 1;
    const val = i => { const t = lines[i].indexOf(':') > -1 ? lines[i].slice(lines[i].indexOf(':') + 1) : (lines[i + 1] || ''); const m = t.match(/[\d.,]+/); return m ? num(m[0]) : NaN; };
    const ult = re => { let r = -1; L.forEach((l, i) => { if (re.test(l)) r = i; }); return r; };
    const si = ult(/^subtotal\b/), ii = ult(/^iva\b/), ti = ult(/^total\b/), pr = ult(/^precio\b/);
    p.total_cashea = ti > -1 ? val(ti) : NaN;   // total con IVA (lo que paga el cliente)
    p.iva = ii > -1 ? val(ii) : NaN;
    p.precio = pr > -1 ? val(pr) : NaN;
    p.iva_nota = '';
    if (si > -1) p.total = val(si);              // total sin IVA = Subtotal
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

    if (!p.code) p.errores.push('No encontré el código de identificación.');
    if (!p.producto) p.errores.push('No encontré el producto.');
    if (!(p.total > 0)) p.errores.push('No encontré el total.');
    if (!cli.telefono) p.errores.push('No encontré el teléfono del cliente.');
    return p;
  }

  const ZONA = ['Valencia', 'Los Teques', 'La Guaira', 'Guarenas', 'Guatire', 'San Antonio de los Altos'];
  const CIUDADES = ['Caracas'].concat(ZONA, ['Barcelona', 'Barquisimeto', 'Coro', 'Cumaná', 'Lechería', 'Maracaibo', 'Maracay', 'Maturín', 'Mérida', 'Puerto La Cruz', 'Puerto Ordaz', 'Punto Fijo', 'San Cristóbal', 'Valera']);
  const METODOS = {
    delivery: { nombre: 'Delivery', dept: 'Delivery', desc: () => 'Te lo llevamos a tu dirección' },
    pickup: { nombre: 'Pickup · Tienda Chacao', dept: 'Pickup', desc: () => 'Retiras en la Av. Andrés Galarraga, Chacao' },
    mrw: { nombre: 'MRW', dept: 'MRW', desc: () => 'Retiras en la oficina MRW que elijas' },
    ruta: { nombre: 'Ruta foránea', dept: 'Ruta', desc: c => 'Nuestra ruta te lo lleva en ' + c }
  };
  const opciones = c => c === 'Caracas' ? ['delivery', 'pickup'] : ZONA.includes(c) ? ['ruta', 'mrw', 'pickup'] : ['mrw', 'pickup'];
  const DEPTS = ['Delivery', 'Pickup', 'MRW', 'Ruta'];
  const DN = { Delivery: 'Delivery', Pickup: 'Pickup Chacao', MRW: 'MRW', Ruta: 'Ruta foránea' };
  const ESTADO = {
    cliente: 'Esperando al cliente', standby: 'Stand-by · asesor', caja: 'En cola de caja', tomado: 'En caja',
    noval: 'Pago no validado', admin: 'Validación manual', despacho: 'Facturado · por despachar', despachado: 'Despachado',
    ajuste: 'En Ajuste', espera: 'Esperando al cliente', traslado: 'Traslado', tienda: 'En otra tienda', entregado: 'Entregado en tienda', cancelado: 'Cancelado'
  };
  const STORES = ['City Market', 'Blvr. de Sabana Grande', 'SAMBIL Chacao', 'Chacao', 'CCCT', 'Los Ilustres', 'La Vega', 'Catia', 'Lechería'];
  const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  /* Traslados de Lechería: lo pedido hasta el miércoles llega a Caracas el jueves o viernes de esa semana */
  function etaLecheria(desde) {
    const d = new Date(new Date(desde || Date.now()).getTime() - 4 * 3600e3), add = [4, 3, 2, 1, 7, 6, 5][d.getUTCDay()];   // hora de Venezuela
    const th = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add)), fr = new Date(th.getTime() + 864e5);
    return th.getUTCMonth() === fr.getUTCMonth() ? 'jueves ' + th.getUTCDate() + ' o viernes ' + fr.getUTCDate() + ' de ' + MES[fr.getUTCMonth()] : 'jueves ' + th.getUTCDate() + ' de ' + MES[th.getUTCMonth()] + ' o viernes ' + fr.getUTCDate() + ' de ' + MES[fr.getUTCMonth()];
  }
  const pill = st => '<span class="pill p-' + esc(st) + '">' + esc(ESTADO[st] || st) + '</span>';

  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3200);
  }

  /* Reduce una foto antes de subirla (máx. 1600 px, JPEG) */
  function comprimir(file) {
    return new Promise((res) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => res(b || file), 'image/jpeg', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); res(file); };
      img.src = url;
    });
  }

  /* Fotos privadas: enlaces temporales (1 hora) con caché */
  const URLS = new Map();
  async function firmar(rutas) {
    const faltan = Array.from(new Set(rutas.filter(r => r && !URLS.has(r))));
    if (faltan.length && sb) {
      const { data } = await sb.storage.from('despacho').createSignedUrls(faltan, 3600);
      (data || []).forEach(d => { if (d.signedUrl) URLS.set(d.path, d.signedUrl); });
    }
    return URLS;
  }
  /* Rellena las imágenes <img data-ruta="..."> con su enlace firmado */
  async function pintarFotos(raiz) {
    const imgs = Array.from((raiz || document).querySelectorAll('img[data-ruta]:not([src])'));
    if (!imgs.length) return;
    await firmar(imgs.map(i => i.getAttribute('data-ruta')));
    imgs.forEach(i => { const u = URLS.get(i.getAttribute('data-ruta')); if (u) { i.src = u; const a = i.closest('a[data-ruta]'); if (a) a.href = u; } });
  }
  const ROLES = { supervisor: 'Supervisión', operador: 'Operador', cajero: 'Caja', despacho: 'Despacho', ajuste: 'Ajuste', asesor: 'Asesor', admin: 'Administración', tienda: 'Tienda' };

  g.SOY = { sb, listo, esc, money, norm, num, hoyISO, fechaVE, hora, fechaHora, parseCashea, ZONA, CIUDADES, METODOS, opciones, DEPTS, DN, ESTADO, pill, toast, comprimir, STORES, etaLecheria, firmar, pintarFotos, ROLES };
})(window);
