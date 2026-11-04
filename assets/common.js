/* Soytechno · Pedidos Cashea — utilidades compartidas */
(function (g) {
  'use strict';

  const CFG = g.SOY_CONFIG || {};
  const listo = !!(CFG.supabaseUrl && CFG.supabaseKey && g.supabase);
  const sb = listo ? g.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { realtime: { params: { eventsPerSecond: 10 } } }) : null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$' + Number(n || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hoyISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const fechaVE = v => v ? String(v).split('-').reverse().join('/') : '';
  const hora = t => new Date(t).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

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
        if (/^(cantidad|total|pago inicial)/.test(L[i]) || lines[i].startsWith('@')) break;
        prod.push(lines[i]);
      }
    }
    p.producto = prod.join(' ').trim();
    const cant = after('cantidad');
    p.cantidad = parseInt(String(cant || '1').replace(/\D/g, ''), 10) || 1;
    const ti = L.findIndex(l => /^total\b/.test(l));
    p.total = ti > -1 ? num((lines[ti].split(':')[1] || lines[ti + 1] || '').match(/[\d.,]+/)?.[0]) : NaN;
    const pi = idx('pago inicial');
    if (pi > -1) {
      const t = lines[pi].indexOf(':') > -1 ? lines[pi].slice(lines[pi].indexOf(':') + 1) : (lines[pi + 1] || '');
      const m = t.match(/\$\s*([\d.,]+)/), pc = t.match(/([\d.,]+)\s*%/);
      p.ini_monto = m ? num(m[1]) : 0;
      p.ini_pct = pc ? num(pc[1]) : (p.total ? Math.round(p.ini_monto / p.total * 100) : 0);
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
  const oficinas = c => ['Centro', 'Norte', 'Sur', 'Este', 'Oeste', 'Av. Bolívar', 'Zona Industrial', 'C.C. Principal', 'Terminal'].map(z => 'MRW ' + c + ' · ' + z);
  const DEPTS = ['Delivery', 'Pickup', 'MRW', 'Ruta'];
  const DN = { Delivery: 'Delivery', Pickup: 'Pickup Chacao', MRW: 'MRW', Ruta: 'Ruta foránea' };
  const ESTADO = {
    cliente: 'Esperando al cliente', standby: 'Stand-by · asesor', caja: 'En cola de caja', tomado: 'En caja',
    noval: 'Pago no validado', admin: 'Validación manual', despacho: 'Facturado · por despachar', despachado: 'Despachado'
  };
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

  g.SOY = { sb, listo, esc, money, norm, num, hoyISO, fechaVE, hora, parseCashea, ZONA, CIUDADES, METODOS, opciones, oficinas, DEPTS, DN, ESTADO, pill, toast, comprimir };
})(window);
