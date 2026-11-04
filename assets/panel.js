/* Soytechno · Pedidos Cashea — panel de los departamentos */
(function () {
  'use strict';
  const { sb, listo, esc, money, hoyISO, fechaVE, hora, parseCashea, DEPTS, DN, ESTADO, pill, toast, comprimir, STORES, etaLecheria } = window.SOY;
  const $ = (s, r) => (r || document).querySelector(s);
  const app = $('#app');

  const P = new Map();               // code → pedido
  const PERSONAS = ['Carla', 'Luis', 'María', 'Rosa', 'Javier', 'Andrea', 'Patricia', 'Daniel', 'Ricardo', 'Supervisor'];
  let yo = 'Carla';
  try { yo = localStorage.getItem('soy-yo') || 'Carla'; } catch (e) { /* sin almacenamiento */ }
  const NAV = [
    ['Entrada', [['bandeja', 'Bandeja de correos']]],
    ['Cajas', DEPTS.map(d => ['caja-' + d, 'Caja ' + DN[d]])],
    ['Operación', [['despacho', 'Despacho'], ['ajuste', 'Ajuste'], ['apagar', 'Productos a apagar'], ['tiendas', 'Tiendas']]],
    ['Atención', [['asesores', 'Asesores'], ['admin', 'Administración']]],
    ['Control', [['super', 'Supervisión']]]
  ];
  const VISTAS = [].concat.apply([], NAV.map(g => g[1]));
  let vista = (location.hash || '').slice(1);
  if (!VISTAS.some(v => v[0] === vista)) vista = 'bandeja';
  const B = { txt: '', p: null, creado: null };
  const UI = { dfil: 'Todos', dsel: null, atab: 'noval', ssel: null, subiendo: {}, reset: false, conectado: false, otra: null, jtab: 'tras', tq: '', tienda: 'CCCT' };
  try { UI.tienda = localStorage.getItem('soy-tienda') || 'CCCT'; } catch (e) { /* sin almacenamiento */ }
  let pendiente = false;
  const WA = !!(window.SOY_CONFIG && window.SOY_CONFIG.whatsapp);   // avisos reales por WhatsApp (Callbell)
  const WAST = {};                                                   // code → último aviso de WhatsApp
  const AVISO = { enlace: 'enlace del pedido', lecheria: 'fecha de Lechería', alternativas: 'alternativas', despachado: 'pedido despachado' };

  const lista = f => Array.from(P.values()).filter(f).sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at));
  const cnt = f => lista(f).length;
  const clienteURL = code => new URL('cliente.html?c=' + encodeURIComponent(code), location.href).href;

  /* ---------- datos ---------- */
  async function cargar() {
    const { data, error } = await sb.from('pedidos').select('*').order('created_at', { ascending: true }).limit(1000);
    if (error) { toast('No pude leer la base de datos: ' + error.message); return; }
    P.clear(); data.forEach(r => P.set(r.code, r)); pintar();
  }
  function escuchar() {
    sb.channel('pedidos-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, ev => {
        if (ev.eventType === 'DELETE') { if (ev.old && ev.old.code) P.delete(ev.old.code); else return cargar(); }
        else P.set(ev.new.code, ev.new);
        pintar();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos_estado' }, ev => {
        if (ev.eventType === 'DELETE') { if (ev.old && ev.old.producto) PE.delete(ev.old.producto); }
        else PE.set(ev.new.producto, ev.new);
        pintar();
      })
      .subscribe(st => { UI.conectado = st === 'SUBSCRIBED'; if (st === 'SUBSCRIBED') cargarPE(); const l = $('.live'); if (l) { l.classList.toggle('off', !UI.conectado); l.lastChild.textContent = UI.conectado ? 'En vivo' : 'Reconectando…'; } if (st === 'SUBSCRIBED') cargar(); });
  }
  async function upd(code, patch, evento) {
    const o = P.get(code); if (!o) return null;
    const hist = (o.historial || []).concat(evento ? [{ t: new Date().toISOString(), e: evento + (yo ? ' · ' + yo : '') }] : []);
    const { data, error } = await sb.from('pedidos').update(Object.assign({}, patch, { updated_at: new Date().toISOString(), historial: hist })).eq('code', code).select().single();
    if (error) { toast('No se pudo guardar: ' + error.message); return null; }
    P.set(code, data); pintar(); return data;
  }

  /* ---------- piezas ---------- */
  const row = (o, extra, hl) => '<div class="row' + (hl ? ' hl' : '') + '"><span class="code">#' + esc(o.code) + '</span><span><b>' + esc(o.producto) + '</b><small>' + esc((o.cliente && o.cliente.nombre) || '') + (extra ? ' · ' + extra : '') + '</small></span>' + pill(o.st) + '</div>';
  const kv = pairs => '<dl class="kv">' + pairs.map(p => '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>').join('') + '</dl>';
  const empty = (t, s) => '<div class="empty"><b>' + t + '</b><span>' + s + '</span></div>';
  const entregaTxt = o => { const e = o.entrega || {}; return e.metodo ? esc(e.metodo) + (e.detalle ? ' · ' + esc(e.detalle) : '') + (e.ciudad && e.metodo !== 'Pickup · Tienda Chacao' ? ' · ' + esc(e.ciudad) : '') : '<span class="muted">Aún no la elige</span>'; };
  const aprobado = o => o.tag === 'Pago aprobado por Administración';

  function factura(o) {
    const c = o.cliente || {};
    const pago = aprobado(o) ? '<div class="paybox ok"><b>Pago aprobado por Administración</b><span>No hace falta verificarlo de nuevo.</span></div>'
      : o.pago ? '<div class="paybox"><b>Verifica este pago móvil en BNC</b>' + kv([['Monto', money(o.ini_monto) + ' · en Bs a tasa BCV'], ['Banco emisor', esc(o.pago.banco)], ['Teléfono', esc(o.pago.telefono)], ['Referencia', '<span class="mono">' + esc(o.pago.referencia) + '</span> · única ✓'], ['Fecha', esc(fechaVE(o.pago.fecha))]]) + '</div>'
      : '<div class="paybox ok"><b>Inicial 0%</b><span>No hay pago que verificar.</span></div>';
    return '<div class="card"><div class="c-head"><div><span class="eyebrow">Lo que vas a facturar</span><h2>Pedido Cashea #' + esc(o.code) + '</h2></div><div>' + (o.tag ? '<span class="pill p-cliente">' + esc(o.tag) + '</span>' : '') + '</div></div>'
      + '<div class="grid2"><div><h4>Cliente</h4>' + kv([['Nombre', esc(c.nombre)], ['Cédula', esc(c.cedula)], ['Teléfono', esc(c.telefono)], ['Correo', esc(c.correo)]]) + '</div><div><h4>Entrega</h4>' + kv([['Departamento', esc(DN[o.dept] || '')], ['Destino', entregaTxt(o)]]) + '</div></div>'
      + '<div class="table-scroll"><table class="mini"><thead><tr><th>Descripción</th><th>Cant.</th><th class="num">Total sin IVA</th></tr></thead><tbody><tr><td>' + esc(o.producto) + '</td><td>' + esc(o.cantidad) + '</td><td class="num">' + money(o.total) + '</td></tr><tr class="tot"><td>Total sin IVA</td><td></td><td class="num">' + money(o.total) + '</td></tr></tbody></table></div>'
      + '<div class="grid2"><div><h4>Cómo se paga</h4>' + kv([['Pago inicial', money(o.ini_monto) + ' · ' + Number(o.ini_pct) + '%'], ['Cuotas', esc((o.cuotas && o.cuotas.n) || '—')]]) + '</div><div>' + pago + '</div></div>'
      + '<div class="actbar"><button type="button" class="btn" data-act="facturar" data-c="' + esc(o.code) + '">' + (o.pago && !aprobado(o) ? 'Pago verificado en BNC · Facturar' : 'Facturar en Profit') + '</button>'
      + (o.pago && !aprobado(o) ? '<button type="button" class="btn ghost sm" data-act="noval" data-c="' + esc(o.code) + '">No pude validar</button>' : '')
      + cajaExtra(o) + '<button type="button" class="btn ghost sm" data-act="soltar" data-c="' + esc(o.code) + '">Devolver a la cola</button></div></div>';
  }

  /* ---------- vistas ---------- */
  const EJEMPLO = 'Confirmación del pedido\n\nCódigo de identificación:\n' + (Math.floor(Math.random() * 9e8) + 1e8) + '\n\nInformación de pagos\n\nNúmero de cuotas:\t6\nFecha primer pago:\t18/11/2026\nFecha último pago:\t27/01/2027\nInformación de Cliente\n\nMARÍA GONZÁLEZ (PRUEBA)\n+584145550123\n12345678\nmaria.prueba@correo.com\n\nResumen de pedido\n\nSAMSUNG GALAXY A16 4G 4GB/128GB SM-A165M/DS, LIGHT GREEN. CELULAR.\n\nPrecio:\t$220.00\nCantidad:\t1\nTotal:\t$220.00\nResumen\n\nSubtotal:\t$172.41\nIVA (16%):\t$27.59\n \nTotal:\t$200.00\nPago Inicial:\t$40.00 - 20%';

  function vBandeja() {
    const p = B.p;
    let der = '';
    if (B.creado) {
      const o = P.get(B.creado);
      if (o && o.st === 'standby') der = '<div class="card"><span class="eyebrow">Pedido MIX</span><h2>#' + esc(o.code) + ' va a Stand-by</h2><p>Es una venta MIX: el bot no le escribe al cliente. La atiende un asesor desde su panel.</p><div class="actbar"><button type="button" class="btn ghost sm" data-act="b-nuevo">Cargar otro correo</button></div></div>';
      else if (o) der = '<div class="card"><span class="eyebrow">Listo · pedido #' + esc(o.code) + '</span><h2>Así le llega al cliente</h2>'
        + '<div class="wa"><div class="msg">¡Hola ' + esc(((o.cliente && o.cliente.nombre) || '').split(' ')[0].toLowerCase().replace(/^./, x => x.toUpperCase())) + '! 👋 Recibimos tu pedido Cashea <b>#' + esc(o.code) + '</b>: ' + esc(o.producto) + '.' + (Number(o.ini_pct) ? ' Inicial ' + Number(o.ini_pct) + '%: <b>' + money(o.ini_monto) + '</b>.' : ' Sin inicial.') + '<br>Elige cómo recibirlo' + (Number(o.ini_pct) ? ' y paga tu inicial' : '') + ' aquí 👇</div></div>'
        + (WA ? '<div class="wa-send"><label for="wa-tel">WhatsApp del cliente</label><div class="linkbox"><input id="wa-tel" type="tel" inputmode="tel" value="' + esc((o.cliente && o.cliente.telefono) || '') + '"><button type="button" class="btn sm" data-act="wa-enviar" data-c="' + esc(o.code) + '">Enviar por WhatsApp</button></div>'
          + (WAST[o.code] ? '<p class="note ' + (WAST[o.code].ok ? 'wa-ok' : WAST[o.code].ok === false ? 'wa-bad' : '') + '" role="status">' + esc(WAST[o.code].txt) + '</p>' : '') + '<p class="note">Si no llega, el cliente también puede abrir su enlace con este código QR.</p></div>'
          : '<p class="note">En la demo, el cliente abre su enlace con este código QR (en el sistema real le llega por WhatsApp).</p>')
        + '<div class="qr"><div id="qr"></div><span class="mono" style="color:#10162B">Escanea con la cámara del teléfono</span></div>'
        + '<div class="linkbox"><span id="clink">' + esc(clienteURL(o.code)) + '</span><button type="button" class="btn ghost sm" data-act="copiar" data-t="clink">Copiar enlace</button></div>'
        + '<p>Estado ahora: ' + pill(o.st) + '</p><div class="actbar"><button type="button" class="btn ghost sm" data-act="b-nuevo">Cargar otro correo</button></div></div>';
    } else if (p) {
      const c = p.cliente;
      der = '<div class="ticket"><h4>COMANDA · LEÍDA DEL CORREO</h4>'
        + [['Pedido', '#' + p.code], ['Cliente', c.nombre], ['Cédula', c.cedula], ['Teléfono', c.telefono], ['Correo', c.correo], ['Producto', p.producto], ['Cantidad', p.cantidad], ['Total sin IVA', money(p.total) + (p.iva_nota ? ' · ' + p.iva_nota : '')], ['Pago inicial', money(p.ini_monto) + ' · ' + Number(p.ini_pct) + '%'], ['Cuotas', (p.cuotas.n || '—') + ' · ' + (p.cuotas.primera || '') + ' → ' + (p.cuotas.ultima || '')], ['Destino', p.mix ? 'Stand-by (venta MIX)' : 'Bot → cliente']].map(r => '<div class="trow"><span>' + r[0] + '</span><span>' + esc(r[1] || '—') + '</span></div>').join('')
        + (p.errores.length ? '<p class="err" style="margin-top:10px">' + p.errores.map(esc).join('<br>') + '</p>' : '')
        + '</div><div class="actbar"><button type="button" class="btn" data-act="b-crear"' + (p.errores.length && !p.code ? ' disabled' : '') + '>' + (p.mix ? 'Crear y enviar a Stand-by' : 'Crear pedido y avisar al cliente') + '</button><button type="button" class="btn ghost sm" data-act="b-nuevo">Cancelar</button></div>';
    } else der = empty('Pega un correo de Cashea', 'El sistema lo lee y arma la comanda sin copiar datos a mano.');
    const rec = lista(() => true).reverse().slice(0, 8);
    return '<div class="split"><div class="card"><span class="eyebrow">Correo de Cashea</span><div class="field"><label for="b-txt">Pega aquí el texto del correo</label><textarea id="b-txt" rows="14" placeholder="Código de identificación: …">' + esc(B.txt) + '</textarea></div><div class="actbar"><button type="button" class="btn" data-act="b-leer">Leer correo</button><button type="button" class="btn ghost sm" data-act="b-ej">Usar correo de prueba</button></div><p class="note">En el sistema final los correos se leen solos del buzón.</p></div><div style="display:grid;gap:16px">' + der + '</div></div>'
      + '<div class="pm"><div class="pm-h"><span>Últimos pedidos</span><span class="who">' + P.size + ' en total</span></div><div class="pm-b">' + (rec.length ? rec.map(o => row(o)).join('') : '<p class="muted">Todavía no hay pedidos.</p>') + '</div></div>';
  }

  function vCaja(d) {
    const mio = lista(o => o.dept === d && o.st === 'tomado' && o.tomado_por === yo)[0];
    const otros = lista(o => o.dept === d && o.st === 'tomado' && o.tomado_por !== yo);
    const q = lista(o => o.dept === d && o.st === 'caja');
    const fact = cnt(o => o.dept === d && (o.st === 'despacho' || o.st === 'despachado'));
    const stats = '<div class="stats"><div class="stat"><b>' + q.length + '</b><span>en cola</span></div><div class="stat"><b>' + (otros.length + (mio ? 1 : 0)) + '</b><span>atendiendo</span></div><div class="stat"><b>' + fact + '</b><span>facturados hoy</span></div></div>';
    const izq = '<div class="pm"><div class="pm-h"><span>Cola de Caja ' + DN[d] + '</span><span class="who">sin asignar</span></div><div class="pm-b"><button type="button" class="btn block" data-act="tomar" data-d="' + d + '"' + (mio || !q.length ? ' disabled' : '') + '>Tomar siguiente</button>'
      + (mio ? '<p class="note">Termina tu pedido actual para tomar otro.</p>' : '')
      + (q.length ? q.map(o => row(o, o.pago && !aprobado(o) ? 'pago móvil' : aprobado(o) ? 'aprobado' : 'inicial 0%')).join('') : '<p class="muted">No hay pedidos en cola.</p>')
      + (otros.length ? '<p class="note">' + otros.map(o => esc(o.tomado_por) + ' está atendiendo #' + esc(o.code)).join(' · ') + '</p>' : '')
      + '<p class="note">Cada pedido lo ve un solo cajero. Abre esta caja en otra pantalla con otro nombre y pruébalo.</p></div></div>';
    return stats + '<div class="split">' + izq + '<div>' + (mio ? factura(mio) : empty('Sin pedido en atención', 'Pulsa «Tomar siguiente» para atender el pedido más antiguo de la cola.')) + '</div></div>';
  }

  const SLOTS = [['factura', 'Factura'], ['equipo', 'Equipo'], ['empaque', 'Empaque'], ['entrega', 'Guía o entrega']];
  function vDespacho() {
    const l = lista(o => o.st === 'despacho' && (UI.dfil === 'Todos' || o.dept === UI.dfil));
    const sel = l.find(o => o.code === UI.dsel) || l[0];
    const chips = '<div class="actbar" style="border:0;padding:0">' + ['Todos'].concat(DEPTS).map(f => '<button type="button" class="btn sm ' + (f === UI.dfil ? '' : 'ghost') + '" data-act="dfil" data-f="' + f + '">' + (f === 'Todos' ? 'Todos' : DN[f]) + '</button>').join('') + '</div>';
    const izq = '<div class="pm"><div class="pm-h"><span>Facturados por despachar</span><span class="who">' + l.length + '</span></div><div class="pm-b">' + (l.length ? l.map(o => '<button type="button" class="rowbtn" data-act="dsel" data-c="' + esc(o.code) + '">' + row(o, DN[o.dept], sel && o.code === sel.code) + '</button>').join('') : '<p class="muted">Nada por despachar.</p>') + '</div></div>';
    let der = empty('Todo despachado', 'Cuando una caja factura, el pedido aparece aquí.');
    if (sel) {
      const f = sel.fotos || {}, n = SLOTS.filter(s => f[s[0]]).length, ok = f.factura && f.equipo;
      const slots = SLOTS.map(s => {
        const v = f[s[0]], up = UI.subiendo[sel.code + s[0]];
        return '<label class="ph-slot' + (v ? ' done' : '') + '">' + (v ? '<img src="' + esc(v) + '" alt="Foto de ' + s[1].toLowerCase() + '">' : '<span class="ph-in">' + (up ? 'Subiendo…' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Tomar foto') + '</span>')
          + '<span class="lbl2">' + s[1] + (v ? ' ✓' : '') + '</span><input type="file" accept="image/*" capture="environment" data-slot="' + s[0] + '" data-c="' + esc(sel.code) + '" aria-label="Foto de ' + s[1].toLowerCase() + '"></label>';
      }).join('');
      const extra = sel.dept === 'MRW' ? '<div class="field"><label for="d-guia">Número de guía MRW</label><input type="text" id="d-guia" placeholder="Ej.: 0123456789"></div>'
        : sel.dept === 'Delivery' ? '<div class="field"><label for="d-rut">Rutero</label><select id="d-rut"><option>Rutero 1 · Este</option><option>Rutero 2 · Centro</option><option>Rutero 3 · Oeste</option></select></div>'
          : sel.dept === 'Ruta' ? '<p class="muted">Sale en la ruta foránea hacia ' + esc((sel.entrega || {}).ciudad || '') + '.</p>' : '<p class="muted">Queda listo para retirar en Tienda Chacao.</p>';
      der = '<div class="card"><div class="c-head"><div><span class="eyebrow">Despacho · ' + esc(DN[sel.dept]) + '</span><h2>Pedido #' + esc(sel.code) + '</h2></div>' + pill(sel.st) + '</div>'
        + kv([['Cliente', esc((sel.cliente || {}).nombre) + ' · ' + esc((sel.cliente || {}).cedula)], ['Producto', esc(sel.producto)], ['Destino', entregaTxt(sel)]])
        + '<h4>Respaldo fotográfico · ' + n + ' de 4</h4><div class="photos">' + slots + '</div><p class="note">Toca un recuadro para tomar la foto con la cámara del teléfono. Factura y equipo son obligatorias. Las fotos quedan guardadas en el pedido.</p>'
        + extra + '<div class="actbar"><button type="button" class="btn" data-act="despachar" data-c="' + esc(sel.code) + '"' + (ok ? '' : ' disabled') + '>Marcar despachado</button></div></div>';
    }
    const hist = lista(o => o.st === 'despachado').reverse().slice(0, 6);
    const histHTML = '<div class="pm"><div class="pm-h"><span>Despachados</span><span class="who">con respaldo</span></div><div class="pm-b">' + (hist.length ? hist.map(o => row(o, Object.keys(o.fotos || {}).length + ' fotos') + '<div class="photos" style="grid-template-columns:repeat(auto-fill,minmax(70px,1fr))">' + SLOTS.filter(s => (o.fotos || {})[s[0]]).map(s => '<a href="' + esc(o.fotos[s[0]]) + '" target="_blank" rel="noopener" class="ph-slot done" style="aspect-ratio:1"><img src="' + esc(o.fotos[s[0]]) + '" alt="' + s[1] + '"></a>').join('') + '</div>').join('') : '<p class="muted">Aún no hay despachos.</p>') + '</div></div>';
    return chips + '<div class="split">' + izq + '<div>' + der + '</div></div>' + histHTML;
  }

  function vAsesores() {
    const nv = lista(o => o.st === 'noval'), sbs = lista(o => o.st === 'standby');
    const tabs = '<div class="actbar" style="border:0;padding:0"><button type="button" class="btn sm ' + (UI.atab === 'noval' ? '' : 'ghost') + '" data-act="atab" data-t="noval">Pagos no validados (' + nv.length + ')</button><button type="button" class="btn sm ' + (UI.atab === 'standby' ? '' : 'ghost') + '" data-act="atab" data-t="standby">Stand-by (' + sbs.length + ')</button></div>';
    if (UI.atab === 'standby') return tabs + (sbs.length ? sbs.map(o => '<div class="card"><div class="c-head"><div><span class="eyebrow">' + esc(o.tag || 'Stand-by') + '</span><h2>#' + esc(o.code) + ' · ' + esc(o.producto) + '</h2></div>' + pill(o.st) + '</div>' + kv([['Cliente', esc((o.cliente || {}).nombre) + ' · ' + esc((o.cliente || {}).telefono)], ['Total', money(o.total)]]) + '<p class="note">El bot no le escribe a este cliente. El asesor desglosa el MIX y, cuando esté listo, le envía su enlace para elegir la entrega.</p><div class="actbar"><button type="button" class="btn sm" data-act="mix" data-c="' + esc(o.code) + '">Desglosado · enviar enlace al cliente</button></div></div>').join('') : empty('Nada en Stand-by', 'Las ventas MIX llegan aquí sin pasar por el bot.'));
    return tabs + (nv.length ? nv.map(o => '<div class="card"><div class="c-head"><div><span class="eyebrow">Desde Caja ' + esc(DN[o.dept]) + '</span><h2>#' + esc(o.code) + ' · ' + esc((o.cliente || {}).nombre) + '</h2></div>' + pill(o.st) + '</div>'
      + kv([['Producto', esc(o.producto)], ['Pago reportado', o.pago ? money(o.ini_monto) + ' · ' + esc(o.pago.banco) + ' · ref. <span class="mono">' + esc(o.pago.referencia) + '</span>' : '—'], ['Teléfono', esc((o.cliente || {}).telefono)]])
      + '<div class="grid2"><div class="field"><label for="a-ref-' + esc(o.code) + '">Referencia corregida (si aplica)</label><input type="text" inputmode="numeric" id="a-ref-' + esc(o.code) + '"></div><div class="field"><label for="a-dest-' + esc(o.code) + '">¿A qué datos envió el pago?</label><input type="text" id="a-dest-' + esc(o.code) + '" placeholder="Ej.: Mercantil 0414-555-0199"></div></div>'
      + '<div class="actbar"><button type="button" class="btn sm" data-act="corregir" data-c="' + esc(o.code) + '">Corregir y devolver a caja</button><button type="button" class="btn ghost sm" data-act="aadmin" data-k="Aliado Cashea" data-c="' + esc(o.code) + '">A Administración: aliado Cashea</button><button type="button" class="btn ghost sm" data-act="aadmin" data-k="Transferencia" data-c="' + esc(o.code) + '">A Administración: transferencia</button></div></div>').join('')
      : empty('Sin pagos por revisar', 'Cuando una caja pulse «No pude validar», el pedido aparece aquí.'));
  }

  function vAdmin() {
    const l = lista(o => o.st === 'admin');
    return l.length ? l.map(o => '<div class="card"><div class="c-head"><div><span class="eyebrow">' + esc(o.tag) + '</span><h2>#' + esc(o.code) + ' · ' + esc((o.cliente || {}).nombre) + '</h2></div>' + pill(o.st) + '</div>'
      + kv([['Monto esperado', money(o.ini_monto)], ['Enviado a', esc((o.pago && o.pago.destino) || 'No indicado')], ['Banco emisor', esc(o.pago ? o.pago.banco : '—')], ['Referencia', '<span class="mono">' + esc(o.pago ? o.pago.referencia : '—') + '</span>'], ['Fecha', esc(o.pago ? fechaVE(o.pago.fecha) : '—')]])
      + '<div class="actbar"><button type="button" class="btn sm" data-act="aprobar" data-c="' + esc(o.code) + '">Aprobar</button><button type="button" class="btn ghost sm" data-act="rechazar" data-c="' + esc(o.code) + '">Rechazar</button></div></div>').join('')
      : empty('Nada por validar', 'Aquí llegan los pagos de aliados Cashea y las transferencias que envían los asesores.');
  }

  function vSuper() {
    const S = Object.keys(ESTADO).map(k => [ESTADO[k], cnt(o => o.st === k)]);
    const todos = lista(() => true).reverse();
    const sel = UI.ssel && P.get(UI.ssel);
    const det = sel ? '<div class="card"><div class="c-head"><div><span class="eyebrow">Recorrido</span><h2>#' + esc(sel.code) + '</h2></div>' + pill(sel.st) + '</div><ol class="steps">' + (sel.historial || []).map(h => '<li class="done"><span class="d">✓</span><span><b>' + esc(h.e) + '</b><small>' + hora(h.t) + '</small></span></li>').join('') + '</ol>'
      + (Object.keys(sel.fotos || {}).length ? '<div class="photos">' + Object.keys(sel.fotos).map(k => '<a class="ph-slot done" href="' + esc(sel.fotos[k]) + '" target="_blank" rel="noopener"><img src="' + esc(sel.fotos[k]) + '" alt="' + esc(k) + '"><span class="lbl2">' + esc(k) + '</span></a>').join('') + '</div>' : '') + '</div>' : '';
    return '<div class="stats">' + S.map(s => '<div class="stat"><b>' + s[1] + '</b><span>' + s[0] + '</span></div>').join('') + '</div>'
      + '<div class="split"><div class="pm"><div class="pm-h"><span>Cajas ahora</span><span class="who">en vivo</span></div><div class="pm-b"><table class="mini"><thead><tr><th>Caja</th><th>En cola</th><th class="num">Facturados</th></tr></thead><tbody>' + DEPTS.map(d => '<tr><td>' + DN[d] + '</td><td>' + cnt(o => o.dept === d && (o.st === 'caja' || o.st === 'tomado')) + '</td><td class="num">' + cnt(o => o.dept === d && (o.st === 'despacho' || o.st === 'despachado')) + '</td></tr>').join('') + '</tbody></table></div></div>' + (det || empty('Elige un pedido', 'Toca un pedido de la lista para ver su recorrido completo y sus fotos.')) + '</div>'
      + '<div class="pm"><div class="pm-h"><span>Todos los pedidos</span><span class="who">' + todos.length + '</span></div><div class="pm-b">' + (todos.length ? todos.map(o => '<button type="button" class="rowbtn" data-act="ssel" data-c="' + esc(o.code) + '">' + row(o, (o.dept ? DN[o.dept] + ' · ' : '') + hora(o.updated_at), UI.ssel === o.code) + '</button>').join('') : '<p class="muted">Todavía no hay pedidos.</p>') + '</div></div>'
      + '<div class="actbar"><button type="button" class="btn ' + (UI.reset ? 'danger' : 'ghost') + ' sm" data-act="reset">' + (UI.reset ? 'Confirmar: borrar todos los pedidos' : 'Reiniciar demo') + '</button>' + (UI.reset ? '<button type="button" class="btn ghost sm" data-act="reset-no">No borrar</button>' : '') + '</div>';
  }

  /* ---------- ajuste, productos a apagar, tiendas ---------- */
  const PE = new Map();   // producto → { apagado, por, cambiado_at }
  async function cargarPE() {
    const { data, error } = await sb.from('productos_estado').select('*');
    if (!error && data) { PE.clear(); data.forEach(r => PE.set(r.producto, r)); pintar(); }
  }
  const pm = (t, w, inner) => '<div class="pm"><div class="pm-h"><span>' + t + '</span><span class="who">' + (w || '') + '</span></div><div class="pm-b">' + inner + '</div></div>';
  const ORIGENES = ['Lechería'].concat(STORES.filter(s => s !== 'Chacao' && s !== 'Lechería'));
  const selTienda = (id, sel) => '<select id="' + id + '">' + ORIGENES.map(s => '<option' + (s === sel ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>';
  function cajaExtra(o) {
    if (UI.otra === o.code) return '<label class="who-sel" for="c-store">¿En qué tienda está?' + selTienda('c-store', 'Lechería') + '</label><button type="button" class="btn sm" data-act="otraok" data-c="' + esc(o.code) + '">Pedir traslado</button><button type="button" class="btn ghost sm" data-act="otracancel">Volver</button>';
    return '<button type="button" class="btn ghost sm" data-act="sinstock" data-c="' + esc(o.code) + '">Sin stock</button><button type="button" class="btn ghost sm" data-act="otra" data-c="' + esc(o.code) + '">Está en otra tienda</button><button type="button" class="btn ghost sm" data-act="version" data-c="' + esc(o.code) + '">Otra versión</button>';
  }
  function vAjuste() {
    const t = UI.jtab || 'tras';
    const tras = lista(o => o.st === 'traslado'), le = tras.filter(o => (o.ajuste || {}).origen === 'Lechería'), it = tras.filter(o => (o.ajuste || {}).origen !== 'Lechería');
    const pend = lista(o => o.st === 'ajuste' || o.st === 'espera');
    const tabs = '<div class="actbar" style="border:0;padding:0"><button type="button" class="btn sm ' + (t === 'tras' ? '' : 'ghost') + '" data-act="jtab" data-t="tras">Traslados (' + tras.length + ')</button><button type="button" class="btn sm ' + (t === 'stock' ? '' : 'ghost') + '" data-act="jtab" data-t="stock">Sin stock y otra versión (' + pend.length + ')</button></div>';
    if (t === 'tras') {
      const item = o => {
        const a = o.ajuste || {}, lech = a.origen === 'Lechería', tarde = !lech && a.solicitado_at && (Date.now() - new Date(a.solicitado_at).getTime()) > 864e5;
        return row(o, esc(a.origen) + ' → ' + (o.dept === 'Pickup' ? 'Tienda Chacao' : 'almacén') + ' · Caja ' + esc(DN[o.dept] || '') + (lech ? ' · llega el ' + etaLecheria(a.solicitado_at) : '') + (tarde ? ' · más de 24 h: avisar al cliente' : '') + (a.respuesta ? ' · el cliente eligió: ' + esc(a.respuesta) : ''))
          + '<div class="actbar" style="border:0;padding:0"><button type="button" class="btn sm" data-act="recibido" data-c="' + esc(o.code) + '">Recibido</button></div>';
      };
      return tabs + '<div class="grid2">' + pm('Desde Lechería', 'Corte: miércoles', '<p class="note">El cliente recibe aviso con la fecha. Lo que se pide hasta el miércoles llega a Caracas el jueves o viernes.</p>' + (le.map(item).join('') || '<p class="muted">Sin traslados.</p>'))
        + pm('Internos de Caracas', 'Mismo día', '<p class="note">El cliente no recibe aviso. Solo si pasan 24 horas sin llegar, se le avisa del retraso.</p>' + (it.map(item).join('') || '<p class="muted">Sin traslados.</p>')) + '</div>';
    }
    return tabs + (pend.length ? pend.map(o => {
      const a = o.ajuste || {}, c = esc(o.code);
      if (o.st === 'espera') return '<div class="card"><div class="c-head"><div><span class="eyebrow">' + esc(a.motivo || 'Ajuste') + '</span><h2>#' + c + ' · ' + esc(o.producto) + '</h2></div>' + pill(o.st) + '</div><p>Alternativas enviadas. El cliente elige desde su enlace y el pedido vuelve solo a la caja.</p><ul>' + (a.alternativas || []).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul><div class="grid2"><div class="qr"><div data-qr="' + esc(clienteURL(o.code)) + '"></div><span class="mono" style="color:#10162B">Enlace del cliente</span></div><div class="linkbox"><span id="l-' + c + '">' + esc(clienteURL(o.code)) + '</span><button type="button" class="btn ghost sm" data-act="copiar" data-t="l-' + c + '">Copiar enlace</button></div></div></div>';
      return '<div class="card"><div class="c-head"><div><span class="eyebrow">' + esc(a.motivo || 'Ajuste') + ' · desde Caja ' + esc(DN[o.dept] || '') + '</span><h2>#' + c + ' · ' + esc(o.producto) + '</h2></div>' + pill(o.st) + '</div>'
        + kv([['Cliente', esc((o.cliente || {}).nombre) + ' · ' + esc((o.cliente || {}).telefono)]])
        + '<div class="field"><label for="j-alt-' + c + '">Alternativas para ofrecer (una por línea)</label><textarea id="j-alt-' + c + '" rows="3">' + esc(o.producto) + ' · OTRO COLOR · mismo precio\nModelo superior · diferencia de $40</textarea><small>Escribe el nombre del producto como debe quedar en la comanda: si el cliente lo elige, reemplaza al original.</small></div>'
        + '<div class="actbar"><button type="button" class="btn sm" data-act="alt" data-c="' + c + '">Enviar alternativas al cliente</button><label class="who-sel" for="j-st-' + c + '">o pedir a' + selTienda('j-st-' + c, 'Lechería') + '</label><button type="button" class="btn ghost sm" data-act="jtras" data-c="' + c + '">Pedir traslado</button><button type="button" class="btn ghost sm" data-act="jcancel" data-c="' + c + '">Cancelar pedido</button></div></div>';
    }).join('') : empty('Nada pendiente', 'Cuando una caja marque «Sin stock» u «Otra versión», el pedido llega aquí.'));
  }
  function ranking() {
    const m = new Map();
    lista(o => o.ajuste && (o.ajuste.motivo || o.ajuste.origen)).forEach(o => {
      const a = o.ajuste, k = a.producto_original || o.producto, r = m.get(k) || { p: k, ag: 0, le: 0 };
      if (a.motivo === 'Sin stock' || a.motivo === 'Otra versión') r.ag++;
      if (a.origen === 'Lechería') r.le++;
      m.set(k, r);
    });
    return Array.from(m.values()).filter(r => r.ag + r.le > 0).sort((x, y) => (y.ag + y.le) - (x.ag + x.le));
  }
  function vApagar() {
    const rk = ranking(), mx = Math.max.apply(null, [1].concat(rk.map(r => r.ag + r.le)));
    const apag = Array.from(PE.values()).filter(x => x.apagado);
    const filas = rk.map((r, i) => {
      const e = PE.get(r.p), off = e && e.apagado;
      return '<tr><td class="mono">' + (i + 1) + '</td><td><b>' + esc(r.p) + '</b></td><td class="num">' + r.ag + '</td><td class="num">' + r.le + '</td><td><div class="rb"><i style="width:' + ((r.ag + r.le) / mx * 100) + '%"></i></div></td><td>' + (off ? '<span class="pill p-cancelado">Apagado · ' + esc(e.por || '') + '</span>' : '<button type="button" class="btn sm" data-act="apagar" data-p="' + encodeURIComponent(r.p) + '">Marcar apagado en Cashea</button>') + '</td></tr>';
    }).join('');
    return '<div class="stats"><div class="stat"><b>' + rk.filter(r => !(PE.get(r.p) || {}).apagado).length + '</b><span>sugeridos para apagar</span></div><div class="stat"><b>' + apag.length + '</b><span>apagados en Cashea</span></div></div>'
      + pm('Más agotados y desde Lechería', 'Se arma solo con lo que marcan las cajas', rk.length ? '<div class="table-scroll"><table class="mini"><thead><tr><th>#</th><th>Producto</th><th class="num">Agotado</th><th class="num">Lechería</th><th></th><th>Acción</th></tr></thead><tbody>' + filas + '</tbody></table></div><p class="note">El operador decide y lo apaga a mano en el portal de Cashea. Aquí queda registrado quién lo hizo y cuándo. En el sistema real, el ranking es de los últimos 30 días.</p>' : '<p class="muted">Todavía no hay productos agotados. Márcalos desde una caja con «Sin stock», «Otra versión» o «Está en otra tienda → Lechería».</p>')
      + pm('Apagados en Cashea', 'Para volver a encender cuando llegue mercancía', apag.length ? apag.map(x => '<div class="row"><span class="code">⏻</span><span><b>' + esc(x.producto) + '</b><small>Apagado por ' + esc(x.por || '') + ' · ' + hora(x.cambiado_at) + '</small></span><button type="button" class="btn sm" data-act="encender" data-p="' + encodeURIComponent(x.producto) + '">Llegó mercancía · encendido</button></div>').join('') : '<p class="muted">Ningún producto apagado.</p>');
  }
  function tRes() {
    const q = String(UI.tq || '').replace(/\D/g, '');
    if (q.length < 4) return '<p class="muted">Escribe al menos 4 números de la cédula.</p>';
    const r = lista(o => String((o.cliente || {}).cedula || '').replace(/\D/g, '').indexOf(q) > -1);
    if (!r.length) return '<p class="muted">No hay pedidos con esa cédula.</p>';
    return r.map(o => {
      const c = esc(o.code);
      if (o.st === 'tienda') return row(o, 'En SoyTechno ' + esc(o.tienda), o.tienda === UI.tienda) + (o.tienda === UI.tienda ? '<div class="actbar" style="border:0;padding:0"><button type="button" class="btn sm" data-act="entregar" data-c="' + c + '">Facturado y entregado</button></div>' : '');
      if (o.st === 'tomado') return row(o, esc(o.tomado_por) + ' lo está atendiendo en caja');
      if (['cliente', 'caja', 'despacho', 'ajuste', 'traslado', 'espera'].indexOf(o.st) > -1) return row(o, o.dept ? 'Hoy en ' + (o.st === 'despacho' ? 'Despacho' : 'Caja ' + esc(DN[o.dept])) : 'Sin entrega elegida') + '<div class="actbar" style="border:0;padding:0"><button type="button" class="btn sm" data-act="pasar" data-c="' + c + '">Pasar a mi tienda</button></div>';
      return row(o);
    }).join('');
  }
  function vTiendas() {
    const mios = lista(o => o.st === 'tienda' && o.tienda === UI.tienda);
    return '<div class="card"><label class="who-sel" for="mi-tienda">Esta tienda es<select id="mi-tienda">' + STORES.map(s => '<option' + (s === UI.tienda ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>'
      + '<div class="field"><label for="tq">Buscar pedido por cédula del cliente</label><input type="search" id="tq" inputmode="numeric" placeholder="Ej.: 12345678" value="' + esc(UI.tq) + '"></div><div id="tres" style="display:grid;gap:8px">' + tRes() + '</div>'
      + '<p class="note">Al pasarlo a tu tienda, el pedido sale de su caja y queda bloqueado allí: nunca se factura dos veces.</p></div>'
      + pm('Pedidos en SoyTechno ' + esc(UI.tienda), mios.length + '', mios.length ? mios.map(o => row(o) + '<div class="actbar" style="border:0;padding:0"><button type="button" class="btn sm" data-act="entregar" data-c="' + esc(o.code) + '">Facturado y entregado</button></div>').join('') : '<p class="muted">No hay pedidos pasados a esta tienda.</p>');
  }

  /* ---------- pintar ---------- */
  function badge(v) {
    if (v.indexOf('caja-') === 0) { const d = v.slice(5); return cnt(o => o.dept === d && (o.st === 'caja' || o.st === 'tomado')); }
    return { bandeja: cnt(o => o.st === 'cliente'), despacho: cnt(o => o.st === 'despacho'), asesores: cnt(o => o.st === 'noval' || o.st === 'standby'), admin: cnt(o => o.st === 'admin'), ajuste: cnt(o => ['ajuste', 'traslado', 'espera'].indexOf(o.st) > -1), apagar: ranking().filter(r => !(PE.get(r.p) || {}).apagado).length }[v];
  }
  function cuerpo() {
    if (vista.indexOf('caja-') === 0) return vCaja(vista.slice(5));
    return { bandeja: vBandeja, despacho: vDespacho, asesores: vAsesores, admin: vAdmin, super: vSuper, ajuste: vAjuste, apagar: vApagar, tiendas: vTiendas }[vista]();
  }
  function pintar() {
    const ae = document.activeElement;
    if (ae && app.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.type !== 'file' && ae.id !== 'yo') { pendiente = true; return; }
    pendiente = false;
    const titulo = (VISTAS.find(v => v[0] === vista) || ['', ''])[1], grupo = (NAV.find(g => g[1].some(v => v[0] === vista)) || [''])[0];
    app.innerHTML = '<aside class="side"><div class="logo"><img src="assets/logo-white.png" alt="Soytechno" width="165" height="22"><span>Pedidos Cashea · demo</span></div><nav class="nav" aria-label="Departamentos">'
      + NAV.map(g => '<p class="nav-g">' + g[0] + '</p>' + g[1].map(v => { const b = badge(v[0]); return '<button type="button" class="nav-i" data-act="ir" data-v="' + v[0] + '"' + (v[0] === vista ? ' aria-current="page"' : '') + '><span>' + v[1] + '</span>' + (b != null ? '<span class="bdg' + (b > 0 ? ' hot' : '') + '">' + b + '</span>' : '') + '</button>'; }).join('')).join('')
      + '</nav><div class="live' + (UI.conectado ? '' : ' off') + '"><i></i><span>' + (UI.conectado ? 'En vivo' : 'Conectando…') + '</span></div></aside>'
      + '<main class="main"><header class="top"><div><span class="eyebrow">' + grupo + '</span><h1>' + titulo + '</h1></div><label class="who-sel" for="yo">Estás como<select id="yo">' + PERSONAS.map(n => '<option' + (n === yo ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label></header><div class="body">' + cuerpo() + '</div></main>';
    const q = document.getElementById('qr');
    if (window.QRCode) document.querySelectorAll('[data-qr]').forEach(el => { try { new window.QRCode(el, { text: el.getAttribute('data-qr'), width: 160, height: 160, colorDark: '#10162B', colorLight: '#FFFFFF' }); } catch (x) { /* sin QR */ } });
    if (q && window.QRCode && B.creado) { q.innerHTML = ''; try { new window.QRCode(q, { text: clienteURL(B.creado), width: 220, height: 220, colorDark: '#10162B', colorLight: '#FFFFFF' }); } catch (e) { q.textContent = 'No pude generar el QR; usa el enlace.'; } }
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (pendiente) pintar(); }, 50));

  /* ---------- acciones ---------- */
  async function crear() {
    const p = B.p; if (!p || !p.code) return;
    const fila = { code: p.code, st: p.mix ? 'standby' : 'cliente', cliente: p.cliente, producto: p.producto, cantidad: p.cantidad, total: p.total || 0, ini_pct: p.ini_pct || 0, ini_monto: p.ini_monto || 0, cuotas: Object.assign({}, p.cuotas, { precio: p.precio, iva: p.iva, total_cashea: p.total_cashea }), tag: p.mix ? 'MIX · para un asesor' : '', historial: [{ t: new Date().toISOString(), e: 'Correo de Cashea leído' + (p.mix ? ' · venta MIX a Stand-by' : '') }] };
    const { data, error } = await sb.from('pedidos').insert(fila).select().single();
    if (error) {
      if (error.code === '23505') { B.creado = p.code; toast('Ese pedido ya estaba cargado. No se duplica.'); pintar(); return; }
      toast('No se pudo crear: ' + error.message); return;
    }
    P.set(data.code, data); B.creado = data.code; B.txt = ''; B.p = null; pintar();
    if (data.st === 'cliente') avisar(data.code, 'enlace');
  }

  /* Aviso por WhatsApp a través de la función enviar-whatsapp (la clave de Callbell vive en el servidor) */
  async function avisar(code, tipo, telefono) {
    if (!WA) return null;
    WAST[code] = { ok: null, txt: 'Enviando WhatsApp…' }; pintar();
    let r;
    try {
      const { data, error } = await sb.functions.invoke('enviar-whatsapp', { body: { code: code, tipo: tipo, telefono: telefono || undefined } });
      r = error ? { ok: false, detalle: 'no pude contactar el servicio de WhatsApp (' + error.message + ')' } : data;
    } catch (x) { r = { ok: false, detalle: x.message }; }
    const ok = !!(r && r.ok);
    WAST[code] = { ok: ok, txt: ok ? 'WhatsApp enviado a ' + r.to + ' · ' + AVISO[tipo] : 'No se envió el WhatsApp: ' + ((r && r.detalle) || 'error desconocido') };
    if (ok) await upd(code, {}, 'WhatsApp enviado al cliente: ' + AVISO[tipo]); else pintar();
    toast(WAST[code].txt);
    return r;
  }

  app.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const a = b.getAttribute('data-act'), c = b.getAttribute('data-c');
    switch (a) {
      case 'ir': vista = b.getAttribute('data-v'); history.replaceState(null, '', '#' + vista); UI.reset = false; pintar(); window.scrollTo(0, 0); break;
      case 'b-ej': B.txt = EJEMPLO.replace(/\n\d{9}\n/, '\n' + (Math.floor(Math.random() * 9e8) + 1e8) + '\n'); B.p = null; B.creado = null; pintar(); break;
      case 'b-leer': { const t = $('#b-txt'); B.txt = t ? t.value : B.txt; B.p = parseCashea(B.txt); B.creado = null; if (!B.p.code) toast('No encontré el código del pedido en ese texto.'); pintar(); break; }
      case 'b-crear': b.disabled = true; await crear(); break;
      case 'b-nuevo': B.txt = ''; B.p = null; B.creado = null; pintar(); break;
      case 'wa-enviar': {
        const o = P.get(c), inp = $('#wa-tel'), tel = inp ? inp.value.trim() : '';
        if (!o || !tel) { toast('Escribe el número de WhatsApp.'); break; }
        if (inp) inp.blur();
        b.disabled = true;
        if (tel !== ((o.cliente || {}).telefono || '')) await upd(c, { cliente: Object.assign({}, o.cliente, { telefono: tel }) }, 'Teléfono del cliente actualizado');
        await avisar(c, 'enlace', tel); break;
      }
      case 'copiar': { const el = document.getElementById(b.getAttribute('data-t')); if (!el) break; try { await navigator.clipboard.writeText(el.textContent); b.textContent = 'Copiado'; } catch (x) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Seleccionado'; } break; }
      case 'tomar': { b.disabled = true; const { data, error } = await sb.rpc('tomar_siguiente', { p_dept: b.getAttribute('data-d'), p_cajero: yo }); if (error) toast('Error: ' + error.message); else if (!data || !data.code) toast('No hay pedidos en cola.'); else { P.set(data.code, data); pintar(); } break; }
      case 'facturar': await upd(c, { st: 'despacho' }, 'Facturado en Profit'); toast('Facturado · pasó a Despacho'); break;
      case 'noval': await upd(c, { st: 'noval' }, 'Caja: no pude validar el pago'); toast('Enviado a Asesores · pago no validado'); break;
      case 'soltar': await upd(c, { st: 'caja', tomado_por: null }, 'Devuelto a la cola'); break;
      case 'dfil': UI.dfil = b.getAttribute('data-f'); UI.dsel = null; pintar(); break;
      case 'dsel': UI.dsel = c; pintar(); break;
      case 'despachar': {
        const o = P.get(c), ent = Object.assign({}, o.entrega || {});
        const g = $('#d-guia'), r = $('#d-rut'); if (g && g.value.trim()) ent.guia = g.value.trim(); if (r) ent.rutero = r.value;
        await upd(c, { st: 'despachado', entrega: ent }, 'Despachado con ' + Object.keys(o.fotos || {}).length + ' fotos' + (ent.guia ? ' · guía ' + ent.guia : '') + (ent.rutero ? ' · ' + ent.rutero : ''));
        toast('Despachado · respaldo guardado · el cliente lo ve en su enlace'); avisar(c, 'despachado'); break;
      }
      case 'atab': UI.atab = b.getAttribute('data-t'); pintar(); break;
      case 'corregir': {
        const o = P.get(c), ref = ($('#a-ref-' + CSS.escape(c)) || {}).value || '';
        const pago = Object.assign({}, o.pago || {}); if (ref.trim()) pago.referencia = ref.trim();
        await upd(c, { st: 'caja', tomado_por: null, pago: pago, tag: 'Datos corregidos por asesor' }, 'Asesor corrigió los datos del pago'); toast('Devuelto a Caja ' + DN[o.dept]); break;
      }
      case 'aadmin': {
        const o = P.get(c), dest = ($('#a-dest-' + CSS.escape(c)) || {}).value || '', k = b.getAttribute('data-k');
        const pago = Object.assign({}, o.pago || {}); if (dest.trim()) pago.destino = dest.trim();
        await upd(c, { st: 'admin', tag: k, pago: pago }, 'Asesor lo envió a Administración (' + k + ')'); toast('Enviado a Administración · ' + k); break;
      }
      case 'mix': await upd(c, { st: 'cliente', tag: 'MIX desglosado por asesor' }, 'Asesor desglosó el MIX y envió el enlace'); B.creado = c; vista = 'bandeja'; history.replaceState(null, '', '#bandeja'); pintar(); toast('Enlace listo para el cliente'); avisar(c, 'enlace'); break;
      case 'aprobar': await upd(c, { st: 'caja', tomado_por: null, tag: 'Pago aprobado por Administración' }, 'Administración aprobó el pago'); toast('Aprobado · volvió a la caja'); break;
      case 'rechazar': await upd(c, { st: 'noval', tag: 'Rechazado por Administración' }, 'Administración rechazó el pago'); toast('Rechazado · regresó a Asesores'); break;
      case 'ssel': UI.ssel = c; pintar(); break;
      case 'reset':
        if (!UI.reset) { UI.reset = true; pintar(); break; }
        { const { error } = await sb.rpc('reiniciar_demo'); UI.reset = false; if (error) toast('Error: ' + error.message); else { P.clear(); PE.clear(); B.creado = null; UI.ssel = null; pintar(); toast('Demo reiniciada'); } }
        break;
      case 'reset-no': UI.reset = false; pintar(); break;
      case 'sinstock': case 'version': { const m = a === 'sinstock' ? 'Sin stock' : 'Otra versión'; await upd(c, { st: 'ajuste', tomado_por: null, ajuste: Object.assign({}, P.get(c).ajuste, { motivo: m, solicitado_at: new Date().toISOString() }) }, 'Caja: ' + m.toLowerCase()); toast('Enviado a Ajuste · ' + m.toLowerCase()); break; }
      case 'otra': UI.otra = c; pintar(); break;
      case 'otracancel': UI.otra = null; pintar(); break;
      case 'otraok': case 'jtras': {
        const s = ($(a === 'otraok' ? '#c-store' : '#j-st-' + CSS.escape(c)) || {}).value || 'Lechería'; UI.otra = null;
        await upd(c, { st: 'traslado', tomado_por: null, ajuste: Object.assign({}, P.get(c).ajuste, { motivo: (P.get(c).ajuste || {}).motivo || 'Otra tienda', origen: s, solicitado_at: new Date().toISOString() }) }, 'Traslado pedido desde ' + s);
        toast(s === 'Lechería' ? 'Traslado desde Lechería · el cliente ve que llega el ' + etaLecheria() : 'Traslado interno desde ' + s + ' · mismo día · sin aviso al cliente');
        if (s === 'Lechería') avisar(c, 'lecheria'); break;
      }
      case 'jtab': UI.jtab = b.getAttribute('data-t'); pintar(); break;
      case 'recibido': await upd(c, { st: 'caja', tomado_por: null, tag: 'Traslado recibido' }, 'Traslado recibido'); toast('Recibido · volvió a Caja ' + (DN[(P.get(c) || {}).dept] || '')); break;
      case 'alt': {
        const ta = $('#j-alt-' + CSS.escape(c)), alts = (ta ? ta.value : '').split('\n').map(x => x.trim()).filter(Boolean);
        if (!alts.length) { toast('Escribe al menos una alternativa.'); break; }
        await upd(c, { st: 'espera', ajuste: Object.assign({}, P.get(c).ajuste, { alternativas: alts }) }, 'Ajuste envió alternativas al cliente'); toast('El cliente ya ve las alternativas en su enlace'); avisar(c, 'alternativas'); break;
      }
      case 'jcancel': await upd(c, { st: 'cancelado', tomado_por: null }, 'Pedido cancelado'); toast('Pedido cancelado'); break;
      case 'apagar': case 'encender': {
        const p = decodeURIComponent(b.getAttribute('data-p')), fila = { producto: p, apagado: a === 'apagar', por: yo, cambiado_at: new Date().toISOString() };
        const { error } = await sb.from('productos_estado').upsert(fila);
        if (error) toast('Error: ' + error.message); else { PE.set(p, fila); pintar(); toast(a === 'apagar' ? 'Registrado: ' + yo + ' lo apagó en Cashea' : 'Registrado: encendido de nuevo en Cashea'); }
        break;
      }
      case 'pasar': { const o = P.get(c); await upd(c, { st: 'tienda', tienda: UI.tienda, tomado_por: null }, 'Pasado a SoyTechno ' + UI.tienda + (o.dept ? ' (bloqueado en Caja ' + DN[o.dept] + ')' : '')); toast('Pasado a SoyTechno ' + UI.tienda); break; }
      case 'entregar': await upd(c, { st: 'entregado' }, 'Facturado y entregado en SoyTechno ' + ((P.get(c) || {}).tienda || '')); toast('Entregado en tienda'); break;
    }
  });
  app.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'yo') { yo = t.value; try { localStorage.setItem('soy-yo', yo); } catch (x) { /* nada */ } pintar(); return; }
    if (t.id === 'mi-tienda') { UI.tienda = t.value; try { localStorage.setItem('soy-tienda', UI.tienda); } catch (x) { /* nada */ } pintar(); return; }
    if (t.matches('input[type=file][data-slot]')) {
      const f = t.files && t.files[0], code = t.getAttribute('data-c'), slot = t.getAttribute('data-slot');
      if (!f) return;
      UI.subiendo[code + slot] = true; pintar();
      try {
        const blob = await comprimir(f), ruta = code + '/' + slot + '-' + Date.now() + '.jpg';
        const { error } = await sb.storage.from('despacho').upload(ruta, blob, { contentType: 'image/jpeg', upsert: true });
        if (error) throw error;
        const url = sb.storage.from('despacho').getPublicUrl(ruta).data.publicUrl;
        const o = P.get(code);
        await upd(code, { fotos: Object.assign({}, o.fotos || {}, { [slot]: url }) }, 'Foto de ' + slot + ' guardada');
      } catch (x) { toast('No se pudo subir la foto: ' + (x.message || x)); }
      UI.subiendo[code + slot] = false; pintar();
    }
  });
  app.addEventListener('input', e => { if (e.target.id === 'b-txt') B.txt = e.target.value; if (e.target.id === 'tq') { UI.tq = e.target.value; const r = $('#tres'); if (r) r.innerHTML = tRes(); } });
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VISTAS.some(x => x[0] === v)) { vista = v; pintar(); } });

  if (!listo) {
    app.innerHTML = '<main class="main"><div class="body"><div class="card"><span class="eyebrow">Falta configurar</span><h1>Conecta la base de datos</h1><p>Completa <span class="mono">assets/config.js</span> con la Project URL y la anon key de Supabase.</p></div></div></main>';
    return;
  }
  window.__soyRecargar = cargar; // permite forzar una recarga (pruebas y demos)
  pintar(); cargar(); escuchar();
})();
