/* Soytechno · Pedidos Cashea — panel del equipo (producción)
   Cada persona entra con su usuario y ve solo las pantallas de su rol.
   Ningún cambio se escribe directo en la base: todo pasa por funciones del servidor
   que validan el rol y el estado del pedido (ver supabase/produccion/schema.sql). */
(async function () {
  'use strict';
  const { sb, listo, esc, money, fechaVE, hora, fechaHora, parseCashea, DEPTS, DN, ESTADO, pill, toast, comprimir, STORES, etaLecheria, pintarFotos, ROLES } = window.SOY;
  const $ = (s, r) => (r || document).querySelector(s);
  const app = $('#app');

  if (!listo) { app.innerHTML = '<main class="main"><div class="body"><div class="card"><span class="eyebrow">Falta configurar</span><h1>Conecta la base de datos</h1><p>Completa <span class="mono">assets/config.js</span> con la Project URL y la clave publishable de Supabase.</p></div></div></main>'; return; }
  const { data: ses } = await sb.auth.getSession();
  if (!ses.session) { location.replace('index.html'); return; }
  const { data: yo } = await sb.from('perfiles').select('*').eq('id', ses.session.user.id).maybeSingle();
  if (!yo || !yo.activo) { await sb.auth.signOut(); location.replace('index.html'); return; }
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.replace('index.html'); });
  const SUP = yo.rol === 'supervisor';

  /* ---------- menú según el rol ---------- */
  const TODO = [
    ['Entrada', [['bandeja', 'Bandeja de correos']]],
    ['Cajas', DEPTS.map(d => ['caja-' + d, 'Caja ' + DN[d]])],
    ['Operación', [['despacho', 'Despacho'], ['ajuste', 'Ajuste'], ['apagar', 'Productos a apagar'], ['tiendas', 'Tiendas']]],
    ['Atención', [['asesores', 'Asesores'], ['admin', 'Administración']]],
    ['Control', [['super', 'Supervisión'], ['usuarios', 'Usuarios']]]
  ];
  const PUEDE = { operador: ['bandeja', 'apagar', 'super'], cajero: ['caja-' + yo.dept], despacho: ['despacho'], ajuste: ['ajuste', 'apagar'], asesor: ['asesores'], admin: ['admin'], tienda: ['tiendas'] };
  const permitido = v => SUP || (PUEDE[yo.rol] || []).indexOf(v) > -1;
  const NAV = TODO.map(g => [g[0], g[1].filter(v => permitido(v[0]))]).filter(g => g[1].length);
  const VISTAS = [].concat.apply([], NAV.map(g => g[1]));
  let vista = (location.hash || '').slice(1);
  if (!VISTAS.some(v => v[0] === vista)) vista = VISTAS[0][0];

  /* ---------- estado ---------- */
  const P = new Map();            // pedidos activos y de las últimas 48 h
  const PE = new Map();           // productos apagados
  const X = { correos: [], alertas: [], res: null, rank: [], usuarios: null, det: null, buscar: [], tres: [] };
  const B = { txt: '', p: null, correoId: null, creado: null };
  const UI = { dfil: 'Todos', dsel: null, atab: 'noval', jtab: 'tras', ssel: null, sq: '', tq: '', tienda: yo.tienda || 'CCCT', otra: null, subiendo: {}, conectado: false, uEdit: null, uClave: null };
  let pendiente = false;

  const lista = f => Array.from(P.values()).filter(f).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const cnt = f => lista(f).length;
  const clienteURL = token => new URL('cliente.html?t=' + encodeURIComponent(token), location.href).href;
  const horasDesde = t => (Date.now() - new Date(t).getTime()) / 36e5;

  /* ---------- datos ---------- */
  async function cargar() {
    const desde = new Date(Date.now() - 48 * 3600e3).toISOString();
    const { data, error } = await sb.from('pedidos').select('*').or('st.not.in.(despachado,entregado,cancelado),updated_at.gte.' + desde).order('created_at').limit(5000);
    if (error) { toast('No pude leer los pedidos: ' + error.message); return; }
    P.clear(); data.forEach(r => P.set(r.code, r)); pintar();
  }
  async function cargarExtras() {
    const tareas = [];
    if (SUP || yo.rol === 'operador') {
      tareas.push(sb.from('correos').select('id,recibido_at,asunto,texto,detalle,code').eq('estado', 'revisar').order('recibido_at', { ascending: false }).limit(50).then(r => { if (!r.error) X.correos = r.data; }));
      tareas.push(sb.from('alertas').select('*').eq('resuelta', false).order('created_at', { ascending: false }).limit(20).then(r => { if (!r.error) X.alertas = r.data; }));
    }
    if (vista === 'super' || vista.indexOf('caja-') === 0) tareas.push(sb.rpc('resumen_hoy').then(r => { if (!r.error) X.res = r.data; }));
    if (vista === 'apagar') {
      tareas.push(sb.rpc('ranking_agotados', { p_dias: 30 }).then(r => { if (!r.error) X.rank = r.data || []; }));
      tareas.push(sb.from('productos_estado').select('*').then(r => { if (!r.error) { PE.clear(); r.data.forEach(x => PE.set(x.producto, x)); } }));
    }
    if (vista === 'usuarios') tareas.push(cargarUsuarios());
    await Promise.all(tareas); pintar();
  }
  async function cargarDetalle(code) {
    const [o, ev, ms] = await Promise.all([
      P.get(code) ? Promise.resolve({ data: P.get(code) }) : sb.from('pedidos').select('*').eq('code', code).maybeSingle(),
      sb.from('eventos').select('*').eq('code', code).order('t'),
      sb.from('mensajes').select('*').eq('code', code).order('id')
    ]);
    X.det = o.data ? { o: o.data, ev: ev.data || [], ms: ms.data || [] } : null; pintar();
  }
  // Con muchos pedidos por minuto, se redibuja como máximo unas 4 veces por segundo
  let pintarPend = null;
  const pintarLuego = () => { if (!pintarPend) pintarPend = setTimeout(() => { pintarPend = null; pintar(); }, 250); };
  function escuchar() {
    // Un cajero solo recibe los cambios de su caja: menos tráfico y menos costo de tiempo real
    const filtro = yo.rol === 'cajero' && yo.dept ? { filter: 'dept=eq.' + yo.dept } : {};
    sb.channel('panel')
      .on('postgres_changes', Object.assign({ event: '*', schema: 'public', table: 'pedidos' }, filtro), ev => {
        if (ev.eventType === 'DELETE') P.delete(ev.old.code); else P.set(ev.new.code, ev.new);
        if (X.det && ev.new && X.det.o.code === ev.new.code) cargarDetalle(ev.new.code); else pintarLuego();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alertas' }, () => cargarExtras())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos_estado' }, ev => { if (ev.new && ev.new.producto) PE.set(ev.new.producto, ev.new); pintarLuego(); })
      .subscribe(st => { const antes = UI.conectado; UI.conectado = st === 'SUBSCRIBED'; if (UI.conectado && !antes) { cargar(); cargarExtras(); } const l = $('.live'); if (l) { l.classList.toggle('off', !UI.conectado); l.lastChild.textContent = UI.conectado ? 'En vivo' : 'Reconectando…'; } });
  }
  const empujarAvisos = () => sb.functions.invoke('procesar-mensajes', { body: {} }).catch(() => {});
  const AVISAN = ['despachar', 'alternativas', 'traslado', 'mix_listo'];
  async function act(code, accion, datos, okMsg) {
    const { data, error } = await sb.rpc('accion', { p_code: code, p_accion: accion, p_datos: datos || {} });
    if (error) { toast(error.message); return null; }
    P.set(data.code, data); pintar();
    if (okMsg) toast(okMsg);
    if (AVISAN.indexOf(accion) > -1) empujarAvisos();
    if (X.det && X.det.o.code === code) cargarDetalle(code);
    return data;
  }

  /* ---------- piezas ---------- */
  const row = (o, extra, hl) => '<div class="row' + (hl ? ' hl' : '') + '"><span class="code">#' + esc(o.code) + '</span><span><b>' + esc(o.producto) + '</b><small>' + esc((o.cliente && o.cliente.nombre) || '') + (extra ? ' · ' + extra : '') + '</small></span>' + pill(o.st) + '</div>';
  const kv = pairs => '<dl class="kv">' + pairs.map(p => '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>').join('') + '</dl>';
  const empty = (t, s) => '<div class="empty"><b>' + t + '</b><span>' + s + '</span></div>';
  const pm = (t, w, inner) => '<div class="pm"><div class="pm-h"><span>' + t + '</span><span class="who">' + (w || '') + '</span></div><div class="pm-b">' + inner + '</div></div>';
  const entregaTxt = o => { const e = o.entrega || {}; return e.metodo ? esc(e.metodo) + (e.detalle ? ' · ' + esc(e.detalle) : '') + (e.ciudad && e.metodo !== 'Pickup · Tienda Chacao' ? ' · ' + esc(e.ciudad) : '') + (e.guia ? ' · guía ' + esc(e.guia) : '') : '<span class="muted">Aún no la elige</span>'; };
  const aprobado = o => o.tag === 'Pago aprobado por Administración';
  const ORIGENES = ['Lechería'].concat(STORES.filter(s => s !== 'Chacao' && s !== 'Lechería'));
  const selTienda = (id, sel) => '<select id="' + id + '">' + ORIGENES.map(s => '<option' + (s === sel ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>';
  const SLOTS = [['factura', 'Factura'], ['equipo', 'Equipo'], ['empaque', 'Empaque'], ['entrega', 'Guía o entrega']];
  const foto = (ruta, alt, extra) => '<a class="ph-slot done" data-ruta="' + esc(ruta) + '" target="_blank" rel="noopener"' + (extra || '') + '><img data-ruta="' + esc(ruta) + '" alt="' + esc(alt) + '"><span class="lbl2">' + esc(alt) + '</span></a>';
  // El enlace secreto del cliente se pide al servidor solo cuando alguien lo necesita
  const PUEDE_ENLACE = SUP || ['operador', 'asesor', 'ajuste'].indexOf(yo.rol) > -1;
  const enlaceCliente = o => !PUEDE_ENLACE ? '' : '<div class="linkbox"><span id="l-' + esc(o.code) + '" class="muted">Enlace del cliente</span><button type="button" class="btn ghost sm" data-act="enlace" data-c="' + esc(o.code) + '">Copiar enlace</button><button type="button" class="btn ghost sm" data-act="reenviar" data-c="' + esc(o.code) + '">Reenviar WhatsApp</button></div>';

  /* ---------- Bandeja (operador) ---------- */
  function vBandeja() {
    const p = B.p;
    let der = empty('Los correos de Cashea entran solos', 'Aquí solo cargas a mano los que el sistema no pudo leer, o un correo que llegó por otra vía.');
    if (B.creado) {
      const o = P.get(B.creado);
      der = '<div class="card"><span class="eyebrow">Listo · pedido #' + esc(B.creado) + '</span><h2>' + (o && o.st === 'standby' ? 'Venta MIX: pasó a Stand-by' : 'El cliente recibe su WhatsApp') + '</h2>'
        + (o && o.st !== 'standby' ? '<p>El mensaje con su enlace sale solo en segundos. Si hace falta, puedes copiar el enlace o reenviarlo.</p>' + enlaceCliente(o) : '<p>Un asesor la revisa desde su panel antes de escribirle al cliente.</p>')
        + '<div class="actbar"><button type="button" class="btn ghost sm" data-act="b-nuevo">Cargar otro correo</button></div></div>';
    } else if (p) {
      const c = p.cliente;
      der = '<div class="ticket"><h4>COMANDA · LEÍDA DEL CORREO</h4>'
        + [['Pedido', '#' + p.code], ['Cliente', c.nombre], ['Cédula', c.cedula], ['Teléfono', c.telefono], ['Correo', c.correo], ['Producto', p.producto], ['Cantidad', p.cantidad], ['Total sin IVA', money(p.total) + (p.iva_nota ? ' · ' + p.iva_nota : '')], ['Pago inicial', money(p.ini_monto) + ' · ' + Number(p.ini_pct) + '%'], ['Cuotas', (p.cuotas.n || '—') + ' · ' + (p.cuotas.primera || '') + ' → ' + (p.cuotas.ultima || '')], ['Destino', p.mix ? 'Stand-by (venta MIX)' : 'WhatsApp al cliente']].map(r => '<div class="trow"><span>' + r[0] + '</span><span>' + esc(r[1] || '—') + '</span></div>').join('')
        + (p.errores.length ? '<p class="err" style="margin-top:10px">' + p.errores.map(esc).join('<br>') + '</p>' : '')
        + '</div><div class="actbar"><button type="button" class="btn" data-act="b-crear"' + (p.errores.length ? ' disabled' : '') + '>' + (p.mix ? 'Crear y enviar a Stand-by' : 'Crear pedido y avisar al cliente') + '</button><button type="button" class="btn ghost sm" data-act="b-nuevo">Cancelar</button></div>'
        + (p.errores.length ? '<p class="note">Corrige el texto del correo a la izquierda y vuelve a pulsar «Leer correo».</p>' : '');
    }
    const revisar = X.correos.length ? X.correos.map(c => '<div class="card"><div class="c-head"><div><span class="eyebrow">' + fechaHora(c.recibido_at) + '</span><h3>' + esc(c.asunto || 'Correo sin asunto') + '</h3></div></div><p class="err">' + esc(c.detalle || '') + '</p><pre class="correo-txt">' + esc(c.texto) + '</pre><div class="actbar"><button type="button" class="btn sm" data-act="c-cargar" data-id="' + c.id + '">Cargar a mano</button><button type="button" class="btn ghost sm" data-act="c-descartar" data-id="' + c.id + '">No es un pedido · descartar</button></div></div>').join('')
      : '<p class="muted">Ninguno. Todos los correos se leyeron bien.</p>';
    const esperando = lista(o => o.st === 'cliente').reverse().slice(0, 30);
    return '<div class="split"><div class="card"><span class="eyebrow">Cargar un correo a mano</span>' + (B.correoId ? '<p class="note">Cargando el correo que el sistema no pudo leer. Al crearlo, se marca como resuelto.</p>' : '') + '<div class="field"><label for="b-txt">Texto del correo de Cashea</label><textarea id="b-txt" rows="14" placeholder="Código de identificación: …">' + esc(B.txt) + '</textarea></div><div class="actbar"><button type="button" class="btn" data-act="b-leer">Leer correo</button></div></div><div style="display:grid;gap:16px">' + der + '</div></div>'
      + pm('Correos que el sistema no pudo leer', X.correos.length + '', revisar)
      + pm('Esperando respuesta del cliente', esperando.length + '', esperando.length ? esperando.map(o => row(o, 'hace ' + Math.floor(horasDesde(o.created_at)) + ' h')).join('') : '<p class="muted">Ningún cliente pendiente.</p>');
  }

  /* ---------- Cajas ---------- */
  function factura(o) {
    const c = o.cliente || {};
    const pago = aprobado(o) ? '<div class="paybox ok"><b>Pago aprobado por Administración</b><span>No hace falta verificarlo de nuevo.</span></div>'
      : o.pago ? '<div class="paybox"><b>Verifica este pago móvil en BNC</b>' + kv([['Monto', money(o.ini_monto) + ' · en Bs a tasa BCV'], ['Banco emisor', esc(o.pago.banco)], ['Teléfono', esc(o.pago.telefono)], ['Referencia', '<span class="mono">' + esc(o.pago.referencia) + '</span>'], ['Fecha', esc(fechaVE(o.pago.fecha))]]) + '</div>'
        : '<div class="paybox ok"><b>Inicial 0%</b><span>No hay pago que verificar.</span></div>';
    return '<div class="card"><div class="c-head"><div><span class="eyebrow">Lo que vas a facturar</span><h2>Pedido Cashea #' + esc(o.code) + '</h2></div><div>' + (o.tag ? '<span class="pill p-cliente">' + esc(o.tag) + '</span>' : '') + '</div></div>'
      + '<div class="grid2"><div><h4>Cliente</h4>' + kv([['Nombre', esc(c.nombre)], ['Cédula', esc(c.cedula)], ['Teléfono', esc(c.telefono)], ['Correo', esc(c.correo)]]) + '</div><div><h4>Entrega</h4>' + kv([['Departamento', esc(DN[o.dept] || '')], ['Destino', entregaTxt(o)]]) + '</div></div>'
      + '<div class="table-scroll"><table class="mini"><thead><tr><th>Descripción</th><th>Cant.</th><th class="num">Total sin IVA</th></tr></thead><tbody><tr><td>' + esc(o.producto) + '</td><td>' + esc(o.cantidad) + '</td><td class="num">' + money(o.total) + '</td></tr><tr class="tot"><td>Total sin IVA</td><td></td><td class="num">' + money(o.total) + '</td></tr></tbody></table></div>'
      + '<div class="grid2"><div><h4>Cómo se paga</h4>' + kv([['Pago inicial', money(o.ini_monto) + ' · ' + Number(o.ini_pct) + '%'], ['Cuotas', esc((o.cuotas && o.cuotas.n) || '—')]]) + '</div><div>' + pago + '</div></div>'
      + '<div class="actbar"><button type="button" class="btn" data-act="facturar" data-c="' + esc(o.code) + '">' + (o.pago && !aprobado(o) ? 'Pago verificado en BNC · Facturar' : 'Facturado en Profit') + '</button>'
      + (o.pago && !aprobado(o) ? '<button type="button" class="btn ghost sm" data-act="noval" data-c="' + esc(o.code) + '">No pude validar</button>' : '')
      + cajaExtra(o) + '<button type="button" class="btn ghost sm" data-act="soltar" data-c="' + esc(o.code) + '">Devolver a la cola</button></div></div>';
  }
  function cajaExtra(o) {
    if (UI.otra === o.code) return '<label class="who-sel" for="c-store">¿En qué tienda está?' + selTienda('c-store', 'Lechería') + '</label><button type="button" class="btn sm" data-act="otraok" data-c="' + esc(o.code) + '">Pedir traslado</button><button type="button" class="btn ghost sm" data-act="otracancel">Volver</button>';
    return '<button type="button" class="btn ghost sm" data-act="sinstock" data-c="' + esc(o.code) + '">Sin stock</button><button type="button" class="btn ghost sm" data-act="otra" data-c="' + esc(o.code) + '">Está en otra tienda</button><button type="button" class="btn ghost sm" data-act="version" data-c="' + esc(o.code) + '">Otra versión</button>';
  }
  function vCaja(d) {
    const mio = lista(o => o.dept === d && o.st === 'tomado' && o.tomado_por === yo.id)[0];
    const otros = lista(o => o.dept === d && o.st === 'tomado' && o.tomado_por !== yo.id);
    const q = lista(o => o.dept === d && o.st === 'caja');
    const fact = X.res && X.res.por_caja && X.res.por_caja[d] ? X.res.por_caja[d].facturados : '—';
    const stats = '<div class="stats"><div class="stat"><b>' + q.length + '</b><span>en cola</span></div><div class="stat"><b>' + (otros.length + (mio ? 1 : 0)) + '</b><span>atendiendo</span></div><div class="stat"><b>' + fact + '</b><span>facturados hoy</span></div></div>';
    const izq = '<div class="pm"><div class="pm-h"><span>Cola de Caja ' + DN[d] + '</span><span class="who">del más antiguo al más nuevo</span></div><div class="pm-b"><button type="button" class="btn block" data-act="tomar" data-d="' + d + '"' + (mio || !q.length ? ' disabled' : '') + '>Tomar siguiente</button>'
      + (mio ? '<p class="note">Termina tu pedido actual para tomar otro.</p>' : '')
      + (q.length ? q.slice(0, 40).map(o => row(o, o.pago && !aprobado(o) ? 'pago móvil' : aprobado(o) ? 'aprobado' : 'inicial 0%')).join('') + (q.length > 40 ? '<p class="note">y ' + (q.length - 40) + ' más…</p>' : '') : '<p class="muted">No hay pedidos en cola.</p>')
      + (otros.length ? '<p class="note">' + otros.map(o => esc(o.tomado_nombre) + ' atiende #' + esc(o.code)).join(' · ') + '</p>' : '') + '</div></div>';
    return stats + '<div class="split">' + izq + '<div>' + (mio ? factura(mio) : empty('Sin pedido en atención', 'Pulsa «Tomar siguiente» para atender el pedido más antiguo de la cola.')) + '</div></div>';
  }

  /* ---------- Despacho ---------- */
  function vDespacho() {
    const l = lista(o => o.st === 'despacho' && (UI.dfil === 'Todos' || o.dept === UI.dfil));
    const sel = l.find(o => o.code === UI.dsel) || l[0];
    const chips = '<div class="actbar" style="border:0;padding:0">' + ['Todos'].concat(DEPTS).map(f => '<button type="button" class="btn sm ' + (f === UI.dfil ? '' : 'ghost') + '" data-act="dfil" data-f="' + f + '">' + (f === 'Todos' ? 'Todos' : DN[f]) + '</button>').join('') + '</div>';
    const izq = pm('Facturados por despachar', l.length + '', l.length ? l.map(o => '<button type="button" class="rowbtn" data-act="dsel" data-c="' + esc(o.code) + '">' + row(o, DN[o.dept], sel && o.code === sel.code) + '</button>').join('') : '<p class="muted">Nada por despachar.</p>');
    let der = empty('Todo despachado', 'Cuando una caja factura, el pedido aparece aquí.');
    if (sel) {
      const f = sel.fotos || {}, n = SLOTS.filter(s => f[s[0]]).length, ok = f.factura && f.equipo;
      const slots = SLOTS.map(s => {
        const v = f[s[0]], up = UI.subiendo[sel.code + s[0]];
        return '<label class="ph-slot' + (v ? ' done' : '') + '">' + (v ? '<img data-ruta="' + esc(v) + '" alt="Foto de ' + s[1].toLowerCase() + '">' : '<span class="ph-in">' + (up ? 'Subiendo…' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Tomar foto') + '</span>')
          + '<span class="lbl2">' + s[1] + (v ? ' ✓' : (s[0] === 'factura' || s[0] === 'equipo' ? ' *' : '')) + '</span><input type="file" accept="image/*" capture="environment" data-slot="' + s[0] + '" data-c="' + esc(sel.code) + '" aria-label="Foto de ' + s[1].toLowerCase() + '"></label>';
      }).join('');
      const extra = sel.dept === 'MRW' ? '<div class="field"><label for="d-guia">Número de guía MRW *</label><input type="text" id="d-guia" inputmode="numeric" placeholder="Ej.: 0123456789"></div>'
        : sel.dept === 'Delivery' ? '<div class="field"><label for="d-rut">Rutero</label><input type="text" id="d-rut" placeholder="Nombre del rutero"></div>'
          : sel.dept === 'Ruta' ? '<p class="muted">Sale en la ruta foránea hacia ' + esc((sel.entrega || {}).ciudad || '') + '.</p>' : '<p class="muted">Queda listo para retirar en Tienda Chacao.</p>';
      der = '<div class="card"><div class="c-head"><div><span class="eyebrow">Despacho · ' + esc(DN[sel.dept]) + '</span><h2>Pedido #' + esc(sel.code) + '</h2></div>' + pill(sel.st) + '</div>'
        + kv([['Cliente', esc((sel.cliente || {}).nombre) + ' · ' + esc((sel.cliente || {}).cedula)], ['Producto', esc(sel.producto)], ['Destino', entregaTxt(sel)], ['Facturó', esc(sel.tomado_nombre || '—')]])
        + '<h4>Respaldo fotográfico · ' + n + ' de 4</h4><div class="photos">' + slots + '</div><p class="note">* Obligatorias: factura y equipo. Toca un recuadro para tomar la foto con la cámara del teléfono.</p>'
        + extra + '<div class="actbar"><button type="button" class="btn" data-act="despachar" data-c="' + esc(sel.code) + '"' + (ok ? '' : ' disabled') + '>Marcar despachado</button></div></div>';
    }
    const hist = lista(o => o.st === 'despachado').reverse().slice(0, 8);
    const histHTML = pm('Despachados recientes', 'con respaldo', hist.length ? hist.map(o => row(o, Object.keys(o.fotos || {}).length + ' fotos') + '<div class="photos" style="grid-template-columns:repeat(auto-fill,minmax(70px,1fr))">' + SLOTS.filter(s => (o.fotos || {})[s[0]]).map(s => foto(o.fotos[s[0]], s[1], ' style="aspect-ratio:1"')).join('') + '</div>').join('') : '<p class="muted">Aún no hay despachos.</p>');
    return chips + '<div class="split">' + izq + '<div>' + der + '</div></div>' + histHTML;
  }

  /* ---------- Asesores ---------- */
  function vAsesores() {
    const nv = lista(o => o.st === 'noval'), sbs = lista(o => o.st === 'standby'), sr = lista(o => o.st === 'cliente' && horasDesde(o.created_at) >= 2);
    const tab = (k, t, n) => '<button type="button" class="btn sm ' + (UI.atab === k ? '' : 'ghost') + '" data-act="atab" data-t="' + k + '">' + t + ' (' + n + ')</button>';
    const tabs = '<div class="actbar" style="border:0;padding:0">' + tab('noval', 'Pagos no validados', nv.length) + tab('standby', 'Stand-by', sbs.length) + tab('sinresp', 'Clientes sin responder', sr.length) + '</div>';
    const cancelar = c => '<button type="button" class="btn ghost sm" data-act="cancelar" data-c="' + c + '">Cancelar pedido</button>';
    if (UI.atab === 'standby') return tabs + (sbs.length ? sbs.map(o => { const c = esc(o.code); return '<div class="card"><div class="c-head"><div><span class="eyebrow">' + esc(o.tag || 'Stand-by') + '</span><h2>#' + c + ' · ' + esc(o.producto) + '</h2></div>' + pill(o.st) + '</div>' + kv([['Cliente', esc((o.cliente || {}).nombre) + ' · ' + esc((o.cliente || {}).telefono)], ['Total sin IVA', money(o.total)], ['Inicial', money(o.ini_monto) + ' · ' + Number(o.ini_pct) + '%']]) + '<p class="note">El sistema no le escribe a este cliente hasta que un asesor lo revise. Al pulsar el botón, le llega su enlace por WhatsApp.</p><div class="actbar"><button type="button" class="btn sm" data-act="mix_listo" data-c="' + c + '">Revisado · enviar enlace al cliente</button>' + cancelar(c) + '</div></div>'; }).join('') : empty('Nada en Stand-by', 'Las ventas MIX y los clientes que piden otro modelo llegan aquí.'));
    if (UI.atab === 'sinresp') return tabs + '<p class="note">Clientes que recibieron su enlace hace más de 2 horas y todavía no eligen la entrega. Puedes corregir el teléfono y reenviar el WhatsApp.</p>' + (sr.length ? sr.map(o => { const c = esc(o.code); return '<div class="card"><div class="c-head"><div><span class="eyebrow">Hace ' + Math.floor(horasDesde(o.created_at)) + ' h</span><h2>#' + c + ' · ' + esc((o.cliente || {}).nombre) + '</h2></div>' + pill(o.st) + '</div>' + kv([['Producto', esc(o.producto)]]) + '<div class="field"><label for="tel-' + c + '">Teléfono del cliente</label><div class="linkbox"><input type="tel" id="tel-' + c + '" value="' + esc((o.cliente || {}).telefono) + '"><button type="button" class="btn sm" data-act="tel" data-c="' + c + '">Guardar y reenviar</button></div></div>' + enlaceCliente(o) + '<div class="actbar">' + cancelar(c) + '</div></div>'; }).join('') : empty('Todos respondieron', 'Aquí aparecen los clientes que no eligen su entrega después de 2 horas.'));
    return tabs + (nv.length ? nv.map(o => { const c = esc(o.code); return '<div class="card"><div class="c-head"><div><span class="eyebrow">Desde Caja ' + esc(DN[o.dept]) + '</span><h2>#' + c + ' · ' + esc((o.cliente || {}).nombre) + '</h2></div>' + pill(o.st) + '</div>'
      + kv([['Producto', esc(o.producto)], ['Pago reportado', o.pago ? money(o.ini_monto) + ' · ' + esc(o.pago.banco) + ' · ref. <span class="mono">' + esc(o.pago.referencia) + '</span> · ' + esc(fechaVE(o.pago.fecha)) : '—'], ['Teléfono', esc((o.cliente || {}).telefono)], ['Nota', esc(o.tag || '—')]])
      + '<div class="grid2"><div class="field"><label for="a-ref-' + c + '">Referencia corregida (si aplica)</label><input type="text" inputmode="numeric" id="a-ref-' + c + '"></div><div class="field"><label for="a-dest-' + c + '">¿A qué datos envió el pago?</label><input type="text" id="a-dest-' + c + '" placeholder="Ej.: Mercantil 0414-555-0199"></div></div>'
      + '<div class="actbar"><button type="button" class="btn sm" data-act="corregir" data-c="' + c + '">Corregir y devolver a caja</button><button type="button" class="btn ghost sm" data-act="a_admin" data-k="Aliado Cashea" data-c="' + c + '">A Administración: aliado Cashea</button><button type="button" class="btn ghost sm" data-act="a_admin" data-k="Transferencia" data-c="' + c + '">A Administración: transferencia</button>' + cancelar(c) + '</div></div>'; }).join('')
      : empty('Sin pagos por revisar', 'Cuando una caja pulse «No pude validar», el pedido aparece aquí.'));
  }

  /* ---------- Administración ---------- */
  function vAdmin() {
    const l = lista(o => o.st === 'admin');
    return l.length ? l.map(o => '<div class="card"><div class="c-head"><div><span class="eyebrow">' + esc(o.tag) + '</span><h2>#' + esc(o.code) + ' · ' + esc((o.cliente || {}).nombre) + '</h2></div>' + pill(o.st) + '</div>'
      + kv([['Monto esperado', money(o.ini_monto) + ' · en Bs a tasa BCV'], ['Enviado a', esc((o.pago && o.pago.destino) || 'No indicado')], ['Banco emisor', esc(o.pago ? o.pago.banco : '—')], ['Referencia', '<span class="mono">' + esc(o.pago ? o.pago.referencia : '—') + '</span>'], ['Fecha', esc(o.pago ? fechaVE(o.pago.fecha) : '—')]])
      + '<div class="actbar"><button type="button" class="btn sm" data-act="aprobar" data-c="' + esc(o.code) + '">Aprobar · vuelve a caja</button><button type="button" class="btn ghost sm" data-act="rechazar" data-c="' + esc(o.code) + '">Rechazar · vuelve al asesor</button></div></div>').join('')
      : empty('Nada por validar', 'Aquí llegan los pagos de aliados Cashea y las transferencias que envían los asesores.');
  }

  /* ---------- Ajuste ---------- */
  function vAjuste() {
    const t = UI.jtab;
    const tras = lista(o => o.st === 'traslado'), le = tras.filter(o => (o.ajuste || {}).origen === 'Lechería'), it = tras.filter(o => (o.ajuste || {}).origen !== 'Lechería');
    const pend = lista(o => o.st === 'ajuste' || o.st === 'espera');
    const tabs = '<div class="actbar" style="border:0;padding:0"><button type="button" class="btn sm ' + (t === 'tras' ? '' : 'ghost') + '" data-act="jtab" data-t="tras">Traslados (' + tras.length + ')</button><button type="button" class="btn sm ' + (t === 'stock' ? '' : 'ghost') + '" data-act="jtab" data-t="stock">Sin stock y otra versión (' + pend.length + ')</button></div>';
    if (t === 'tras') {
      const item = o => {
        const a = o.ajuste || {}, lech = a.origen === 'Lechería', tarde = !lech && a.solicitado_at && horasDesde(a.solicitado_at) > 24;
        return row(o, esc(a.origen) + ' → ' + (o.dept === 'Pickup' ? 'Tienda Chacao' : 'almacén') + ' · Caja ' + esc(DN[o.dept] || '') + (lech ? ' · llega el ' + etaLecheria(a.solicitado_at) : '') + (tarde ? ' · más de 24 h: el cliente ya fue avisado' : '') + (a.respuesta ? ' · el cliente eligió: ' + esc(a.respuesta) : ''))
          + '<div class="actbar" style="border:0;padding:0"><button type="button" class="btn sm" data-act="recibido" data-c="' + esc(o.code) + '">Recibido · vuelve a caja</button></div>';
      };
      return tabs + '<div class="grid2">' + pm('Desde Lechería', 'Corte: miércoles', '<p class="note">El cliente recibe la fecha por WhatsApp. Lo que se pide hasta el miércoles llega a Caracas el jueves o viernes.</p>' + (le.map(item).join('') || '<p class="muted">Sin traslados.</p>'))
        + pm('Internos de Caracas', 'Mismo día', '<p class="note">El cliente no recibe aviso. Si pasan 24 horas sin llegar, el sistema le avisa del retraso.</p>' + (it.map(item).join('') || '<p class="muted">Sin traslados.</p>')) + '</div>';
    }
    return tabs + (pend.length ? pend.map(o => {
      const a = o.ajuste || {}, c = esc(o.code);
      if (o.st === 'espera') return '<div class="card"><div class="c-head"><div><span class="eyebrow">' + esc(a.motivo || 'Ajuste') + '</span><h2>#' + c + ' · ' + esc(o.producto) + '</h2></div>' + pill(o.st) + '</div><p>Alternativas enviadas por WhatsApp. El cliente elige desde su enlace y el pedido vuelve solo a la caja.</p><ul>' + (a.alternativas || []).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' + enlaceCliente(o) + '<div class="actbar"><button type="button" class="btn ghost sm" data-act="cancelar" data-c="' + c + '">Cancelar pedido</button></div></div>';
      return '<div class="card"><div class="c-head"><div><span class="eyebrow">' + esc(a.motivo || 'Ajuste') + ' · desde Caja ' + esc(DN[o.dept] || '') + '</span><h2>#' + c + ' · ' + esc(o.producto) + '</h2></div>' + pill(o.st) + '</div>'
        + kv([['Cliente', esc((o.cliente || {}).nombre) + ' · ' + esc((o.cliente || {}).telefono)], ['Total sin IVA', money(o.total)]])
        + '<div class="field"><label for="j-alt-' + c + '">Alternativas para ofrecer (una por línea, máximo 5)</label><textarea id="j-alt-' + c + '" rows="3" placeholder="' + esc(o.producto) + ' · OTRO COLOR · mismo precio"></textarea><small>Escribe el producto como debe quedar en la comanda: si el cliente lo elige, reemplaza al original. Si cambia el precio, indícalo.</small></div>'
        + '<div class="actbar"><button type="button" class="btn sm" data-act="alternativas" data-c="' + c + '">Enviar alternativas al cliente</button><label class="who-sel" for="j-st-' + c + '">o pedir a' + selTienda('j-st-' + c, 'Lechería') + '</label><button type="button" class="btn ghost sm" data-act="jtras" data-c="' + c + '">Pedir traslado</button><button type="button" class="btn ghost sm" data-act="cancelar" data-c="' + c + '">Cancelar pedido</button></div></div>';
    }).join('') : empty('Nada pendiente', 'Cuando una caja marque «Sin stock» u «Otra versión», el pedido llega aquí.'));
  }

  /* ---------- Productos a apagar ---------- */
  function vApagar() {
    const rk = X.rank, mx = Math.max.apply(null, [1].concat(rk.map(r => Number(r.agotado) + Number(r.lecheria))));
    const apag = Array.from(PE.values()).filter(x => x.apagado);
    const filas = rk.map((r, i) => {
      const e = PE.get(r.producto), off = e && e.apagado, tot = Number(r.agotado) + Number(r.lecheria);
      return '<tr><td class="mono">' + (i + 1) + '</td><td><b>' + esc(r.producto) + '</b></td><td class="num">' + r.agotado + '</td><td class="num">' + r.lecheria + '</td><td><div class="rb"><i style="width:' + (tot / mx * 100) + '%"></i></div></td><td>' + (off ? '<span class="pill p-cancelado">Apagado · ' + esc(e.por_nombre || '') + '</span>' : '<button type="button" class="btn sm" data-act="apagar" data-p="' + encodeURIComponent(r.producto) + '">Marcar apagado en Cashea</button>') + '</td></tr>';
    }).join('');
    return '<div class="stats"><div class="stat"><b>' + rk.filter(r => !(PE.get(r.producto) || {}).apagado).length + '</b><span>sugeridos para apagar</span></div><div class="stat"><b>' + apag.length + '</b><span>apagados en Cashea</span></div></div>'
      + pm('Más agotados y desde Lechería · últimos 30 días', 'lo marcan las cajas', rk.length ? '<div class="table-scroll"><table class="mini"><thead><tr><th>#</th><th>Producto</th><th class="num">Agotado</th><th class="num">Lechería</th><th></th><th>Acción</th></tr></thead><tbody>' + filas + '</tbody></table></div><p class="note">El operador decide y lo apaga a mano en el portal de Cashea. Aquí queda registrado quién lo hizo y cuándo.</p>' : '<p class="muted">No hay productos agotados en los últimos 30 días.</p>')
      + pm('Apagados en Cashea', 'para volver a encender cuando llegue mercancía', apag.length ? apag.map(x => '<div class="row"><span class="code">⏻</span><span><b>' + esc(x.producto) + '</b><small>Apagado por ' + esc(x.por_nombre || '') + ' · ' + fechaHora(x.cambiado_at) + '</small></span><button type="button" class="btn sm" data-act="encender" data-p="' + encodeURIComponent(x.producto) + '">Llegó mercancía · encendido</button></div>').join('') : '<p class="muted">Ningún producto apagado.</p>');
  }

  /* ---------- Tiendas ---------- */
  let tTimer = null;
  async function buscarTienda() {
    const q = String(UI.tq || '').replace(/\D/g, '');
    if (q.length < 4) { X.tres = null; pintarTres(); return; }
    const { data, error } = await sb.from('pedidos').select('*').or('code.eq.' + q + ',cliente->>cedula.ilike.*' + q + '*').order('created_at', { ascending: false }).limit(20);
    X.tres = error ? [] : data; pintarTres();
  }
  function tRes() {
    if (X.tres == null) return '<p class="muted">Escribe al menos 4 números de la cédula o el número del pedido.</p>';
    if (!X.tres.length) return '<p class="muted">No hay pedidos con esa cédula o número.</p>';
    return X.tres.map(o => {
      const c = esc(o.code);
      if (o.st === 'tienda') return row(o, 'En SoyTechno ' + esc(o.tienda), o.tienda === UI.tienda) + (o.tienda === UI.tienda ? '<div class="actbar" style="border:0;padding:0"><button type="button" class="btn sm" data-act="entregar" data-c="' + c + '">Facturado y entregado</button></div>' : '');
      if (o.st === 'tomado') return row(o, esc(o.tomado_nombre) + ' lo está atendiendo en caja');
      if (['cliente', 'caja', 'ajuste', 'traslado', 'espera'].indexOf(o.st) > -1) return row(o, o.dept ? 'Hoy en Caja ' + esc(DN[o.dept]) : 'Sin entrega elegida') + '<div class="actbar" style="border:0;padding:0"><button type="button" class="btn sm" data-act="pasar" data-c="' + c + '">Pasar a mi tienda</button></div>';
      return row(o);
    }).join('');
  }
  const pintarTres = () => { const r = $('#tres'); if (r) r.innerHTML = tRes(); };
  function vTiendas() {
    const mios = lista(o => o.st === 'tienda' && o.tienda === UI.tienda);
    return '<div class="card">' + (SUP ? '<label class="who-sel" for="mi-tienda">Tienda<select id="mi-tienda">' + STORES.map(s => '<option' + (s === UI.tienda ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>' : '<span class="eyebrow">SoyTechno ' + esc(UI.tienda) + '</span>')
      + '<div class="field"><label for="tq">Buscar por cédula del cliente o número de pedido</label><input type="search" id="tq" inputmode="numeric" placeholder="Ej.: 12345678" value="' + esc(UI.tq) + '"></div><div id="tres" style="display:grid;gap:8px">' + tRes() + '</div>'
      + '<p class="note">Al pasarlo a tu tienda, el pedido sale de su caja y queda bloqueado aquí: nunca se factura dos veces.</p></div>'
      + pm('Pedidos en SoyTechno ' + esc(UI.tienda), mios.length + '', mios.length ? mios.map(o => row(o) + '<div class="actbar" style="border:0;padding:0"><button type="button" class="btn sm" data-act="entregar" data-c="' + esc(o.code) + '">Facturado y entregado</button></div>').join('') : '<p class="muted">No hay pedidos pasados a esta tienda.</p>');
  }

  /* ---------- Supervisión ---------- */
  let sTimer = null;
  async function buscarSuper() {
    const q = String(UI.sq || '').trim();
    if (q.length < 3) { X.buscar = []; pintar(); return; }
    const d = q.replace(/\D/g, ''), txt = q.replace(/[^\p{L}\s]/gu, '').trim();
    const ors = [];
    if (d.length >= 3) ors.push('code.ilike.*' + d + '*', 'cliente->>cedula.ilike.*' + d + '*');
    if (txt.length >= 3) ors.push('cliente->>nombre.ilike.*' + txt + '*');
    if (!ors.length) return;
    const { data } = await sb.from('pedidos').select('*').or(ors.join(',')).order('created_at', { ascending: false }).limit(30);
    X.buscar = data || []; pintar();
  }
  function vSuper() {
    const R = X.res || {};
    const st = (n, t) => '<div class="stat"><b>' + (n == null ? '—' : n) + '</b><span>' + t + '</span></div>';
    const alertas = X.alertas.map(a => '<div class="alerta"><span><b>⚠ ' + esc(a.texto) + '</b> · ' + fechaHora(a.created_at) + '</span><button type="button" class="btn ghost sm" data-act="resolver-alerta" data-id="' + a.id + '">Resuelta</button></div>').join('');
    const cajas = '<table class="mini"><thead><tr><th>Caja</th><th class="num">En cola</th><th class="num">Atendiendo</th><th class="num">Facturados hoy</th></tr></thead><tbody>' + DEPTS.map(d => { const c = (R.por_caja || {})[d] || {}; return '<tr><td>' + DN[d] + '</td><td class="num">' + (c.cola == null ? '—' : c.cola) + '</td><td class="num">' + (c.atendiendo == null ? '—' : c.atendiendo) + '</td><td class="num">' + (c.facturados == null ? '—' : c.facturados) + '</td></tr>'; }).join('') + '</tbody></table>';
    const porEstado = Object.keys(ESTADO).map(k => [k, cnt(o => o.st === k)]).filter(x => x[1] > 0 && ['despachado', 'entregado', 'cancelado'].indexOf(x[0]) < 0);
    const tomados = lista(o => o.st === 'tomado');
    const d = X.det;
    let det = empty('Busca un pedido', 'Por número, cédula o nombre del cliente, o toca uno de la lista.');
    if (d) {
      const o = d.o, fotos = Object.keys(o.fotos || {});
      det = '<div class="card"><div class="c-head"><div><span class="eyebrow">Recorrido</span><h2>#' + esc(o.code) + '</h2></div>' + pill(o.st) + '</div>'
        + kv([['Cliente', esc((o.cliente || {}).nombre) + ' · ' + esc((o.cliente || {}).cedula) + ' · ' + esc((o.cliente || {}).telefono)], ['Producto', esc(o.producto) + ' · ' + money(o.total) + ' sin IVA'], ['Inicial', money(o.ini_monto) + ' · ' + Number(o.ini_pct) + '%'], ['Entrega', entregaTxt(o)], ['Nota', esc(o.tag || '—')]])
        + '<ol class="steps">' + d.ev.map(h => '<li class="done"><span class="d">✓</span><span><b>' + esc(h.e) + '</b><small>' + fechaHora(h.t) + ' · ' + esc(h.por_nombre) + '</small></span></li>').join('') + '</ol>'
        + (d.ms.length ? '<h4>WhatsApp al cliente</h4><div class="msgs">' + d.ms.map(m => '<div><span class="pill p-' + esc(m.estado) + '">' + esc(m.estado) + '</span> ' + esc(m.tipo) + ' · ' + fechaHora(m.created_at) + (m.detalle && m.estado !== 'enviado' ? ' · <span class="muted">' + esc(m.detalle) + '</span>' : '') + '</div>').join('') + '</div>' : '')
        + (fotos.length ? '<h4>Fotos</h4><div class="photos">' + fotos.map(k => foto(o.fotos[k], k)).join('') + '</div>' : '')
        + enlaceCliente(o)
        + (o.st === 'tomado' && SUP ? '<div class="actbar"><button type="button" class="btn ghost sm" data-act="liberar" data-c="' + esc(o.code) + '">Liberar: devolver a la cola (lo tiene ' + esc(o.tomado_nombre) + ')</button></div>' : '') + '</div>';
    }
    const lst = (UI.sq.trim().length >= 3 ? X.buscar : lista(() => true).reverse().slice(0, 40));
    return (alertas ? '<div style="display:grid;gap:8px">' + alertas + '</div>' : '')
      + '<div class="stats">' + st(R.recibidos, 'recibidos hoy') + st(R.facturados, 'facturados hoy') + st(R.despachados, 'despachados hoy') + st(R.whatsapp_ok, 'WhatsApp enviados hoy') + st(R.whatsapp_error, 'WhatsApp con error hoy') + st(R.correos_revisar, 'correos por revisar') + '</div>'
      + '<div class="grid2">' + pm('Cajas ahora', 'en vivo', cajas) + pm('Pedidos abiertos por estado', '', porEstado.length ? '<table class="mini"><tbody>' + porEstado.map(x => '<tr><td>' + pill(x[0]) + '</td><td class="num">' + x[1] + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">Ninguno.</p>') + '</div>'
      + (tomados.length ? pm('En caja ahora', tomados.length + '', tomados.map(o => '<button type="button" class="rowbtn" data-act="ssel" data-c="' + esc(o.code) + '">' + row(o, esc(o.tomado_nombre) + ' · Caja ' + DN[o.dept]) + '</button>').join('')) : '')
      + '<div class="split"><div class="pm"><div class="pm-h"><span>Pedidos</span><span class="who"><button type="button" class="btn ghost sm" data-act="exportar">Exportar abiertos (Excel)</button></span></div><div class="pm-b"><div class="field"><label for="sq">Buscar por número, cédula o nombre</label><input type="search" id="sq" value="' + esc(UI.sq) + '" placeholder="Ej.: 241157548, 12345678 o María"></div>'
      + (lst.length ? lst.map(o => '<button type="button" class="rowbtn" data-act="ssel" data-c="' + esc(o.code) + '">' + row(o, (o.dept ? DN[o.dept] + ' · ' : '') + fechaHora(o.updated_at), d && d.o.code === o.code) + '</button>').join('') : '<p class="muted">Sin resultados.</p>') + '</div></div>' + det + '</div>';
  }
  function exportar() {
    const cols = [['Pedido', o => o.code], ['Estado', o => ESTADO[o.st] || o.st], ['Caja', o => DN[o.dept] || ''], ['Cliente', o => (o.cliente || {}).nombre], ['Cédula', o => (o.cliente || {}).cedula], ['Teléfono', o => (o.cliente || {}).telefono], ['Producto', o => o.producto], ['Total sin IVA', o => o.total], ['Inicial %', o => o.ini_pct], ['Inicial $', o => o.ini_monto], ['Entrega', o => [(o.entrega || {}).metodo, (o.entrega || {}).detalle, (o.entrega || {}).ciudad].filter(Boolean).join(' · ')], ['Referencia', o => (o.pago || {}).referencia], ['Atiende', o => o.tomado_nombre], ['Creado', o => fechaHora(o.created_at)], ['Actualizado', o => fechaHora(o.updated_at)]];
    // Neutraliza fórmulas (=, +, -, @) para que nadie meta código en el Excel desde un pedido
    const cel = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const filas = lista(o => ['despachado', 'entregado', 'cancelado'].indexOf(o.st) < 0);
    const csv = '﻿' + [cols.map(c => c[0]).join(';')].concat(filas.map(o => cols.map(c => cel(c[1](o))).join(';'))).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'pedidos-abiertos-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    toast(filas.length + ' pedidos exportados');
  }

  /* ---------- Usuarios (Supervisión) ---------- */
  async function fnUsuarios(body) {
    const { data, error } = await sb.functions.invoke('admin-usuarios', { body: body });
    if (error) { let m = error.message; try { const j = await error.context.json(); m = j.detalle || m; } catch (x) { /* sin detalle */ } return { ok: false, detalle: m }; }
    return data;
  }
  async function cargarUsuarios() { const r = await fnUsuarios({ accion: 'listar' }); X.usuarios = r && r.ok ? r.usuarios : []; if (!r || !r.ok) toast('No pude cargar los usuarios: ' + ((r && r.detalle) || '')); }
  const selRol = (id, v) => '<select id="' + id + '">' + Object.keys(ROLES).map(r => '<option value="' + r + '"' + (r === v ? ' selected' : '') + '>' + ROLES[r] + '</option>').join('') + '</select>';
  const selDept = (id, v) => '<select id="' + id + '"><option value="">— caja —</option>' + DEPTS.map(d => '<option value="' + d + '"' + (d === v ? ' selected' : '') + '>' + DN[d] + '</option>').join('') + '</select>';
  const selStore = (id, v) => '<select id="' + id + '"><option value="">— tienda —</option>' + STORES.map(s => '<option' + (s === v ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>';
  function vUsuarios() {
    if (X.usuarios == null) return '<p class="muted">Cargando usuarios…</p>';
    const filas = X.usuarios.map(u => {
      const id = esc(u.id);
      if (UI.uEdit === u.id) return '<tr><td colspan="5"><div class="grid3"><div class="field"><label for="ue-n">Nombre</label><input type="text" id="ue-n" value="' + esc(u.nombre) + '"></div><div class="field"><label for="ue-r">Rol</label>' + selRol('ue-r', u.rol) + '</div><div class="field"><label for="ue-t">Teléfono (alertas)</label><input type="tel" id="ue-t" value="' + esc(u.telefono || '') + '"></div><div class="field"><label for="ue-d">Caja (si es cajero)</label>' + selDept('ue-d', u.dept) + '</div><div class="field"><label for="ue-s">Tienda (si es tienda)</label>' + selStore('ue-s', u.tienda) + '</div></div><div class="actbar"><button type="button" class="btn sm" data-act="u-guardar" data-id="' + id + '">Guardar</button><button type="button" class="btn ghost sm" data-act="u-cancelar">Cancelar</button></div></td></tr>';
      if (UI.uClave === u.id) return '<tr><td colspan="5"><div class="linkbox"><input type="text" id="uc-c" placeholder="Nueva clave (mínimo 8)" autocomplete="off"><button type="button" class="btn sm" data-act="u-clave-ok" data-id="' + id + '">Cambiar clave de ' + esc(u.nombre) + '</button><button type="button" class="btn ghost sm" data-act="u-cancelar">Cancelar</button></div></td></tr>';
      return '<tr class="' + (u.activo ? '' : 'off') + '"><td><b>' + esc(u.nombre) + '</b><br><small class="muted">' + esc(u.correo || '') + '</small></td><td>' + esc(ROLES[u.rol] || u.rol) + (u.dept ? ' · ' + esc(DN[u.dept]) : '') + (u.tienda ? ' · ' + esc(u.tienda) : '') + '</td><td>' + (u.activo ? 'Activo' : 'De baja') + '</td><td>' + esc(u.telefono || '') + '</td><td><div class="acts"><button type="button" class="btn ghost sm" data-act="u-editar" data-id="' + id + '">Editar</button><button type="button" class="btn ghost sm" data-act="u-clave" data-id="' + id + '">Clave</button><button type="button" class="btn ghost sm" data-act="' + (u.activo ? 'u-baja' : 'u-alta') + '" data-id="' + id + '">' + (u.activo ? 'Dar de baja' : 'Reactivar') + '</button></div></td></tr>';
    }).join('');
    return '<div class="card"><span class="eyebrow">Nuevo usuario</span><div class="grid3"><div class="field"><label for="un-n">Nombre</label><input type="text" id="un-n"></div><div class="field"><label for="un-c">Correo</label><input type="email" id="un-c" autocomplete="off"></div><div class="field"><label for="un-k">Clave inicial (mínimo 8)</label><input type="text" id="un-k" autocomplete="off"></div><div class="field"><label for="un-r">Rol</label>' + selRol('un-r', 'cajero') + '</div><div class="field"><label for="un-d">Caja (si es cajero)</label>' + selDept('un-d', '') + '</div><div class="field"><label for="un-s">Tienda (si es tienda)</label>' + selStore('un-s', '') + '</div><div class="field"><label for="un-t">Teléfono (solo supervisores, para alertas)</label><input type="tel" id="un-t"></div></div><div class="actbar"><button type="button" class="btn" data-act="u-crear">Crear usuario</button></div><p class="note">Entrégale el correo y la clave a la persona. Al dar de baja a alguien, deja de poder entrar pero su historial se conserva.</p></div>'
      + pm('Usuarios', X.usuarios.length + '', '<div class="table-scroll"><table class="mini users"><thead><tr><th>Persona</th><th>Rol</th><th>Estado</th><th>Teléfono</th><th></th></tr></thead><tbody>' + filas + '</tbody></table></div>');
  }
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

  /* ---------- pintar ---------- */
  function badge(v) {
    if (v.indexOf('caja-') === 0) { const d = v.slice(5); return cnt(o => o.dept === d && (o.st === 'caja' || o.st === 'tomado')); }
    return { bandeja: X.correos.length, despacho: cnt(o => o.st === 'despacho'), asesores: cnt(o => o.st === 'noval' || o.st === 'standby'), admin: cnt(o => o.st === 'admin'), ajuste: cnt(o => ['ajuste', 'traslado', 'espera'].indexOf(o.st) > -1), super: X.alertas.length || null }[v];
  }
  function cuerpo() {
    if (vista.indexOf('caja-') === 0) return vCaja(vista.slice(5));
    return { bandeja: vBandeja, despacho: vDespacho, asesores: vAsesores, admin: vAdmin, super: vSuper, ajuste: vAjuste, apagar: vApagar, tiendas: vTiendas, usuarios: vUsuarios }[vista]();
  }
  function pintar() {
    const ae = document.activeElement;
    if (ae && app.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.type !== 'file' && ae.id !== 'sq' && ae.id !== 'tq') { pendiente = true; return; }
    pendiente = false;
    const foco = ae && (ae.id === 'sq' || ae.id === 'tq') ? ae.id : null;
    const titulo = (VISTAS.find(v => v[0] === vista) || ['', ''])[1], grupo = (NAV.find(g => g[1].some(v => v[0] === vista)) || [''])[0];
    app.innerHTML = '<aside class="side"><div class="logo"><img src="assets/logo-white.png" alt="Soytechno" width="165" height="22"><span>Pedidos Cashea</span></div><nav class="nav" aria-label="Pantallas">'
      + NAV.map(g => '<p class="nav-g">' + g[0] + '</p>' + g[1].map(v => { const b = badge(v[0]); return '<button type="button" class="nav-i" data-act="ir" data-v="' + v[0] + '"' + (v[0] === vista ? ' aria-current="page"' : '') + '><span>' + v[1] + '</span>' + (b != null ? '<span class="bdg' + (b > 0 ? ' hot' : '') + '">' + b + '</span>' : '') + '</button>'; }).join('')).join('')
      + '</nav><div class="live' + (UI.conectado ? '' : ' off') + '"><i></i><span>' + (UI.conectado ? 'En vivo' : 'Conectando…') + '</span></div></aside>'
      + '<main class="main"><header class="top"><div><span class="eyebrow">' + grupo + '</span><h1>' + titulo + '</h1></div><div class="yo"><span><b>' + esc(yo.nombre) + '</b><small>' + esc(ROLES[yo.rol] || yo.rol) + (yo.dept ? ' · ' + esc(DN[yo.dept]) : '') + (yo.tienda ? ' · ' + esc(yo.tienda) : '') + '</small></span><button type="button" class="btn ghost sm" data-act="salir">Salir</button></div></header><div class="body">' + cuerpo() + '</div></main>';
    pintarFotos(app);
    if (foco) { const el = document.getElementById(foco); if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (x) { /* search */ } } }
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (pendiente) pintar(); }, 50));

  /* ---------- acciones ---------- */
  app.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const a = b.getAttribute('data-act'), c = b.getAttribute('data-c'), id = b.getAttribute('data-id');
    switch (a) {
      case 'ir': vista = b.getAttribute('data-v'); history.replaceState(null, '', '#' + vista); X.det = null; pintar(); cargarExtras(); window.scrollTo(0, 0); break;
      case 'salir': await sb.auth.signOut(); location.replace('index.html'); break;
      case 'copiar': { const el = document.getElementById(b.getAttribute('data-t')); if (!el) break; try { await navigator.clipboard.writeText(el.textContent); b.textContent = 'Copiado'; } catch (x) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Seleccionado'; } break; }
      case 'reenviar': {
        b.disabled = true;
        const o = P.get(c) || (X.det && X.det.o) || {}, tipo = { espera: 'alternativas', traslado: 'lecheria', despachado: 'despachado' }[o.st] || 'enlace';
        const { error } = await sb.rpc('reenviar_aviso', { p_code: c, p_tipo: tipo }); if (error) toast(error.message); else { toast('WhatsApp en camino'); empujarAvisos(); } b.disabled = false; break;
      }
      case 'enlace': {
        const { data, error } = await sb.rpc('enlace_cliente', { p_code: c });
        if (error || !data) { toast(error ? error.message : 'Este pedido no tiene enlace.'); break; }
        const url = clienteURL(data), el = document.getElementById('l-' + c); if (el) { el.textContent = url; el.classList.remove('muted'); }
        try { await navigator.clipboard.writeText(url); b.textContent = 'Copiado'; } catch (x) { if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } b.textContent = 'Seleccionado'; }
        break;
      }
      // bandeja
      case 'b-leer': { B.txt = val('b-txt'); B.p = parseCashea(B.txt); B.creado = null; if (!B.p.code) toast('No encontré el código del pedido en ese texto.'); pintar(); break; }
      case 'b-nuevo': B.txt = ''; B.p = null; B.creado = null; B.correoId = null; pintar(); break;
      case 'b-crear': {
        b.disabled = true;
        const { data, error } = await sb.rpc('ingresar_pedido', { p: B.p, p_correo_id: B.correoId });
        if (error) { toast(error.message); b.disabled = false; break; }
        if (B.correoId) { await sb.rpc('resolver_correo', { p_id: B.correoId, p_estado: 'ok', p_code: data.code }); X.correos = X.correos.filter(x => x.id !== B.correoId); }
        toast(data.estado === 'duplicado' ? 'Ese pedido ya estaba cargado. No se duplica.' : 'Pedido creado');
        B.creado = data.code; B.txt = ''; B.p = null; B.correoId = null;
        await cargar(); empujarAvisos(); break;
      }
      case 'c-cargar': { const co = X.correos.find(x => String(x.id) === id); if (co) { B.txt = co.texto; B.correoId = co.id; B.p = parseCashea(co.texto); B.creado = null; pintar(); window.scrollTo(0, 0); } break; }
      case 'c-descartar': { const { error } = await sb.rpc('resolver_correo', { p_id: Number(id), p_estado: 'ignorado', p_code: null }); if (error) toast(error.message); else { X.correos = X.correos.filter(x => String(x.id) !== id); pintar(); toast('Correo descartado'); } break; }
      // cajas
      case 'tomar': { b.disabled = true; const { data, error } = await sb.rpc('tomar_siguiente', { p_dept: b.getAttribute('data-d') }); if (error) toast(error.message); else if (!data || !data.code) toast('No hay pedidos en cola.'); else { P.set(data.code, data); pintar(); } break; }
      case 'facturar': await act(c, 'facturar', {}, 'Facturado · pasó a Despacho'); break;
      case 'noval': await act(c, 'noval', {}, 'Enviado a Asesores · pago no validado'); break;
      case 'soltar': await act(c, 'soltar', {}, 'Devuelto a la cola'); break;
      case 'sinstock': await act(c, 'sinstock', {}, 'Enviado a Ajuste · sin stock'); break;
      case 'version': await act(c, 'version', {}, 'Enviado a Ajuste · otra versión'); break;
      case 'otra': UI.otra = c; pintar(); break;
      case 'otracancel': UI.otra = null; pintar(); break;
      case 'otraok': case 'jtras': {
        const s = val(a === 'otraok' ? 'c-store' : 'j-st-' + c) || 'Lechería'; UI.otra = null;
        await act(c, 'traslado', { origen: s }, s === 'Lechería' ? 'Traslado desde Lechería · el cliente recibe la fecha por WhatsApp' : 'Traslado interno desde ' + s + ' · sin aviso al cliente'); break;
      }
      // despacho
      case 'dfil': UI.dfil = b.getAttribute('data-f'); UI.dsel = null; pintar(); break;
      case 'dsel': UI.dsel = c; pintar(); break;
      case 'despachar': await act(c, 'despachar', { guia: val('d-guia'), rutero: val('d-rut') }, 'Despachado · el cliente recibe su aviso'); break;
      // asesores y administración
      case 'atab': UI.atab = b.getAttribute('data-t'); pintar(); break;
      case 'corregir': await act(c, 'corregir', { referencia: val('a-ref-' + c) }, 'Devuelto a la caja'); break;
      case 'a_admin': await act(c, 'a_admin', { tipo: b.getAttribute('data-k'), destino: val('a-dest-' + c) }, 'Enviado a Administración'); break;
      case 'mix_listo': await act(c, 'mix_listo', {}, 'El cliente recibe su enlace por WhatsApp'); break;
      case 'tel': { const r = await act(c, 'telefono', { telefono: val('tel-' + c) }, null); if (r) { await sb.rpc('reenviar_aviso', { p_code: c, p_tipo: 'enlace' }); empujarAvisos(); toast('Teléfono guardado · WhatsApp en camino'); } break; }
      case 'cancelar': {
        if (b.getAttribute('data-ok') !== '1') { b.setAttribute('data-ok', '1'); b.textContent = 'Confirmar cancelación'; b.classList.add('danger'); break; }
        await act(c, 'cancelar', {}, 'Pedido cancelado'); break;
      }
      case 'aprobar': await act(c, 'aprobar', {}, 'Aprobado · volvió a la caja'); break;
      case 'rechazar': await act(c, 'rechazar', {}, 'Rechazado · volvió al asesor'); break;
      // ajuste
      case 'jtab': UI.jtab = b.getAttribute('data-t'); pintar(); break;
      case 'recibido': await act(c, 'recibido', {}, 'Recibido · volvió a la caja'); break;
      case 'alternativas': { const alts = val('j-alt-' + c).split('\n').map(x => x.trim()).filter(Boolean); if (!alts.length) { toast('Escribe al menos una alternativa.'); break; } await act(c, 'alternativas', { alternativas: alts }, 'El cliente recibe las alternativas por WhatsApp'); break; }
      case 'apagar': case 'encender': { const p = decodeURIComponent(b.getAttribute('data-p')); const { error } = await sb.rpc('marcar_producto', { p_producto: p, p_apagado: a === 'apagar' }); if (error) toast(error.message); else { PE.set(p, { producto: p, apagado: a === 'apagar', por_nombre: yo.nombre, cambiado_at: new Date().toISOString() }); pintar(); toast(a === 'apagar' ? 'Registrado: apagado en Cashea' : 'Registrado: encendido de nuevo'); } break; }
      // tiendas
      case 'pasar': { const r = await act(c, 'pasar_tienda', { tienda: UI.tienda }, 'Pasado a SoyTechno ' + UI.tienda); if (r) buscarTienda(); break; }
      case 'entregar': { const r = await act(c, 'entregar', {}, 'Entregado en tienda'); if (r) buscarTienda(); break; }
      // supervisión
      case 'ssel': UI.ssel = c; cargarDetalle(c); break;
      case 'liberar': await act(c, 'liberar', {}, 'Devuelto a la cola de su caja'); break;
      case 'exportar': exportar(); break;
      case 'resolver-alerta': { const { error } = await sb.rpc('resolver_alerta', { p_id: Number(id) }); if (error) toast(error.message); else { X.alertas = X.alertas.filter(x => String(x.id) !== id); pintar(); } break; }
      // usuarios
      case 'u-crear': {
        const body = { accion: 'crear', nombre: val('un-n'), correo: val('un-c'), clave: val('un-k'), rol: val('un-r'), dept: val('un-d') || null, tienda: val('un-s') || null, telefono: val('un-t') };
        b.disabled = true; const r = await fnUsuarios(body); b.disabled = false;
        if (!r || !r.ok) { toast((r && r.detalle) || 'No se pudo crear.'); break; }
        toast('Usuario creado: ' + body.correo); await cargarUsuarios(); pintar(); break;
      }
      case 'u-editar': UI.uEdit = id; UI.uClave = null; pintar(); break;
      case 'u-clave': UI.uClave = id; UI.uEdit = null; pintar(); break;
      case 'u-cancelar': UI.uEdit = null; UI.uClave = null; pintar(); break;
      case 'u-guardar': { const r = await fnUsuarios({ accion: 'editar', id: id, nombre: val('ue-n'), rol: val('ue-r'), dept: val('ue-d') || null, tienda: val('ue-s') || null, telefono: val('ue-t') }); if (!r || !r.ok) { toast((r && r.detalle) || 'No se pudo guardar.'); break; } UI.uEdit = null; toast('Guardado'); await cargarUsuarios(); pintar(); break; }
      case 'u-clave-ok': { const r = await fnUsuarios({ accion: 'clave', id: id, clave: val('uc-c') }); if (!r || !r.ok) { toast((r && r.detalle) || 'No se pudo cambiar.'); break; } UI.uClave = null; toast('Clave cambiada'); pintar(); break; }
      case 'u-baja': case 'u-alta': { const r = await fnUsuarios({ accion: a === 'u-baja' ? 'desactivar' : 'activar', id: id }); if (!r || !r.ok) { toast((r && r.detalle) || 'No se pudo cambiar.'); break; } toast(a === 'u-baja' ? 'Dado de baja: ya no puede entrar' : 'Reactivado'); await cargarUsuarios(); pintar(); break; }
    }
  });
  app.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'mi-tienda') { UI.tienda = t.value; X.tres = null; pintar(); return; }
    if (t.matches('input[type=file][data-slot]')) {
      const f = t.files && t.files[0], code = t.getAttribute('data-c'), slot = t.getAttribute('data-slot');
      if (!f) return;
      UI.subiendo[code + slot] = true; t.blur(); pintar();
      try {
        const blob = await comprimir(f), ruta = code + '/' + slot + '-' + Date.now() + '.jpg';
        const { error } = await sb.storage.from('despacho').upload(ruta, blob, { contentType: 'image/jpeg', upsert: false });
        if (error) throw error;
        await act(code, 'foto', { slot: slot, ruta: ruta }, 'Foto de ' + slot + ' guardada');
      } catch (x) { toast('No se pudo subir la foto: ' + (x.message || x) + '. Revisa la conexión e intenta de nuevo.'); }
      UI.subiendo[code + slot] = false; pintar();
    }
  });
  app.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'b-txt') B.txt = t.value;
    if (t.id === 'tq') { UI.tq = t.value; clearTimeout(tTimer); tTimer = setTimeout(buscarTienda, 400); }
    if (t.id === 'sq') { UI.sq = t.value; clearTimeout(sTimer); sTimer = setTimeout(buscarSuper, 400); }
  });
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VISTAS.some(x => x[0] === v)) { vista = v; pintar(); cargarExtras(); } });
  setInterval(() => { if (!document.hidden) cargarExtras(); }, 60000);

  window.__soyRecargar = cargar;
  pintar(); cargar(); cargarExtras(); escuchar();
})();
