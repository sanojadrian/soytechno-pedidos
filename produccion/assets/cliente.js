/* Soytechno · Pedidos Cashea — página del cliente (producción) */
(function () {
  'use strict';
  const { sb, listo, esc, money, hoyISO, CIUDADES, METODOS, opciones, toast, etaLecheria } = window.SOY;
  const PM = (window.SOY_CONFIG || {}).pagoMovil || {};
  const $ = s => document.querySelector(s);
  const root = $('#cl');
  const token = new URLSearchParams(location.search).get('t') || '';
  let O = null;
  const F = { ciudad: '', metodo: '', oficina: '', direccion: '', banco: 'Banco de Venezuela', telefono: '', referencia: '', fecha: hoyISO(), intento: false, error: '', enviando: false };

  const nombre1 = () => (O && O.nombre) || '';

  function validar() {
    const e = {};
    if (!F.ciudad) e.ciudad = 'Elige tu ciudad.';
    else if (!F.metodo) e.metodo = 'Elige cómo quieres recibirlo.';
    if (F.metodo === 'mrw' && F.oficina.trim().length < 4) e.oficina = 'Escribe la oficina MRW donde quieres retirar.';
    if (F.metodo === 'delivery' && F.direccion.trim().length < 8) e.direccion = 'Escribe tu dirección completa.';
    if (Number(O.ini_pct) > 0) {
      if (!/^0(412|414|416|422|424|426)-?\d{3}-?\d{4}$/.test(F.telefono.trim())) e.telefono = 'Usa el formato 0414-555-0123.';
      if (!/^\d{6,20}$/.test(F.referencia.trim())) e.referencia = 'Escribe la referencia completa (solo números).';
      if (!F.fecha) e.fecha = 'Indica la fecha del pago.';
      else if (F.fecha > hoyISO()) e.fecha = 'La fecha no puede ser futura.';
    }
    return e;
  }
  const err = (k, e) => F.intento && e[k] ? '<span class="err">' + e[k] + '</span>' : '';

  function formulario() {
    const e = validar(), ini = Number(O.ini_pct) > 0;
    let h = '<p>¡Hola ' + esc(nombre1()) + '! 👋 Para despachar tu pedido necesitamos dos datos.</p>';
    h += '<form id="f" novalidate style="display:grid;gap:18px">';
    h += '<div class="field"><label for="ciudad">1. ¿En qué ciudad estás?</label><select id="ciudad"><option value="">Elige tu ciudad</option>' + CIUDADES.map(c => '<option' + (c === F.ciudad ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>' + err('ciudad', e) + '</div>';
    if (F.ciudad) {
      h += '<fieldset class="field"><legend>2. ¿Cómo lo quieres recibir?</legend><div class="opts">' + opciones(F.ciudad).map(m => '<label class="opt"><input type="radio" name="metodo" value="' + m + '"' + (m === F.metodo ? ' checked' : '') + '><span><b>' + METODOS[m].nombre + '</b><small>' + METODOS[m].desc(F.ciudad) + '</small></span><span class="free">Gratis</span></label>').join('') + '</div>' + err('metodo', e) + '</fieldset>';
      if (F.metodo === 'mrw') h += '<div class="field"><label for="of">Oficina MRW donde quieres retirar</label><input type="text" id="of" placeholder="Ej.: MRW ' + esc(F.ciudad) + ' · Av. Bolívar" value="' + esc(F.oficina) + '"><small>Escribe el nombre o la dirección de la oficina.</small>' + err('oficina', e) + '</div>';
      if (F.metodo === 'delivery') h += '<div class="field"><label for="dir">Dirección de entrega en Caracas</label><textarea id="dir" rows="3">' + esc(F.direccion) + '</textarea>' + err('direccion', e) + '</div>';
      if (F.metodo === 'pickup') h += '<div class="info"><b>Tienda Chacao</b><br>Av. Andrés Galarraga, área de pickup. Te avisamos cuando esté listo para retirar.</div>';
      if (F.metodo === 'ruta') h += '<div class="info"><b>Ruta foránea · ' + esc(F.ciudad) + '</b><br>Te escribimos para coordinar el día de entrega.</div>';
    }
    if (ini) {
      h += '<div class="amount"><span>3. Paga tu inicial (' + Number(O.ini_pct) + '%)</span><b>' + money(O.ini_monto) + '</b><small>Pago móvil a Soytechno · en Bs a tasa BCV del día</small></div>';
      h += '<div class="info"><b>Datos del pago móvil</b><br>Banco: ' + esc(PM.banco || '') + '<br>Teléfono: <span class="mono">' + esc(PM.telefono || '') + '</span><br>RIF: <span class="mono">' + esc(PM.rif || '') + '</span></div>';
      h += '<div class="field"><label for="banco">Banco desde donde pagaste</label><select id="banco">' + ['Banco de Venezuela', 'Banesco', 'Mercantil', 'Provincial', 'BNC', 'Bancamiga', 'Banco del Tesoro', 'Bicentenario', 'BFC Banco Fondo Común', 'Banco Plaza', 'Bancaribe', 'Banco Exterior', 'Banplus', 'Banco Activo', '100% Banco', 'Sofitasa', 'Banco Caroní', 'Venezolano de Crédito', 'Bancrecer', 'Mi Banco', 'Otro'].map(b => '<option' + (b === F.banco ? ' selected' : '') + '>' + b + '</option>').join('') + '</select></div>';
      h += '<div class="field"><label for="tel">Teléfono asociado al banco</label><input type="tel" id="tel" inputmode="tel" placeholder="0414-555-0123" value="' + esc(F.telefono) + '">' + err('telefono', e) + '</div>';
      h += '<div class="field"><label for="ref">Referencia completa</label><input type="text" id="ref" inputmode="numeric" placeholder="Ej.: 004598120377" value="' + esc(F.referencia) + '"><small>Todos los dígitos, no solo los últimos 6.</small>' + err('referencia', e) + '</div>';
      h += '<div class="field"><label for="fecha">Fecha del pago</label><input type="date" id="fecha" max="' + hoyISO() + '" value="' + esc(F.fecha) + '">' + err('fecha', e) + '</div>';
    }
    if (F.error) h += '<p class="err">' + esc(F.error) + '</p>';
    h += '<button class="btn block" type="submit"' + (F.enviando ? ' disabled' : '') + '>' + (F.enviando ? 'Enviando…' : ini ? 'Enviar pago y confirmar' : 'Confirmar pedido') + '</button></form>';
    return h;
  }

  function seguimiento() {
    const st = O.st, e = O.entrega || {};
    const pasos = [['Pedido recibido', 'Cashea nos confirmó tu compra'], ['Entrega elegida', e.metodo ? esc(e.metodo) + (e.detalle ? ' · ' + esc(e.detalle) : '') : ''], ['Verificando y facturando', 'Nuestra caja revisa tu pedido'], ['Despachado', '']];
    const orden = { cliente: 0, standby: 1, caja: 2, tomado: 2, noval: 2, admin: 2, despacho: 2, despachado: 3, ajuste: 2, traslado: 2, espera: 2, tienda: 2, entregado: 3 };
    const fin = st === 'despachado' || st === 'entregado';
    if (st === 'entregado') pasos[3][0] = 'Entregado';
    let ahora = orden[st] != null ? orden[st] : 0;
    if (st === 'despacho') pasos[2][1] = 'Facturado · preparando el envío';
    let nota = '';
    if (st === 'noval' || st === 'admin') nota = '<div class="info">Estamos revisando tu pago. Si hace falta algún dato, te escribimos por WhatsApp.</div>';
    if (st === 'traslado' && (O.ajuste || {}).origen === 'Lechería') nota = '<div class="info">📦 Tu equipo viene de nuestra tienda de Lechería. Llega a Caracas el ' + etaLecheria(O.ajuste.solicitado_at) + '.</div>';
    if (st === 'tienda') nota = '<div class="info">🏬 Tu pedido te espera en SoyTechno ' + esc(O.tienda || '') + '.</div>';
    if (st === 'entregado') nota = '<div class="info">✅ Entregado en SoyTechno ' + esc(O.tienda || '') + '. ¡Gracias por tu compra!</div>';
    if (st === 'despachado') {
      if (e.metodo === 'MRW') nota = '<div class="info">📦 Tu pedido salió por MRW' + (e.guia ? ' con la guía <b>' + esc(e.guia) + '</b>' : '') + '. La guía también te llega por correo. El envío tarda de 2 a 3 días hábiles.</div>';
      else if (e.metodo === 'Delivery') nota = '<div class="info">🛵 Tu delivery va en camino. Te llegará un correo con los datos de tu rutero.</div>';
      else if (e.metodo && e.metodo.indexOf('Pickup') === 0) nota = '<div class="info">🏬 Tu pedido está listo para retirar en Tienda Chacao, Av. Andrés Galarraga.</div>';
      else nota = '<div class="info">🚚 Tu pedido salió en la ruta foránea hacia ' + esc(e.ciudad || '') + '.</div>';
    } else if (e.metodo === 'MRW') nota = nota || '<div class="info">Cuando despachemos, la guía de MRW te llegará por correo. El envío tarda de 2 a 3 días hábiles.</div>';
    else if (e.metodo === 'Delivery') nota = nota || '<div class="info">Cuando despachemos, te llegará un correo con los datos de tu rutero.</div>';
    return '<p>¡Gracias, ' + esc(nombre1()) + '! Así va tu pedido. Esta pantalla se actualiza sola.</p><ol class="steps">' + pasos.map((p, i) => '<li class="' + (i < ahora || (i === ahora && fin) ? 'done' : i === ahora ? 'now' : '') + '"><span class="d">' + (i < ahora || fin && i === ahora ? '✓' : i + 1) + '</span><span><b>' + p[0] + '</b><small>' + p[1] + '</small></span></li>').join('') + '</ol>' + nota;
  }

  function pintar(foco) {
    if (!O) return;
    const resumen = '<div class="sum"><span class="eyebrow">Pedido Cashea #' + esc(O.code) + '</span><b>' + esc(O.producto) + '</b><span class="muted">' + (Number(O.ini_pct) ? 'Inicial ' + Number(O.ini_pct) + '%: ' + money(O.ini_monto) : 'Sin inicial') + '</span></div>';
    let cuerpo;
    if (O.st === 'cliente') cuerpo = formulario();
    else if (O.st === 'standby') cuerpo = '<div class="info">Tu asesor te contactará por WhatsApp para confirmar los detalles de tu compra.</div>';
    else if (O.st === 'espera') cuerpo = '<p>Hola ' + esc(nombre1()) + ' 👋 El producto que compraste no está disponible. Elige una opción:</p><div class="opts">' + ((O.ajuste || {}).alternativas || []).map((a, i) => '<button type="button" class="opt" data-alt="' + i + '"><span><b>' + esc(a) + '</b></span></button>').join('') + '<button type="button" class="opt" data-alt="cancelar"><span><b>Cancelar el pedido</b></span></button></div>';
    else if (O.st === 'traslado' && (O.ajuste || {}).origen === 'Lechería' && !(O.ajuste || {}).respuesta) cuerpo = '<p>Hola ' + esc(nombre1()) + ' 👋 Tu equipo está en nuestra tienda de Lechería. Llega a Caracas el <b>' + etaLecheria(O.ajuste.solicitado_at) + '</b>. ¿Qué prefieres?</p><div class="opts"><button type="button" class="opt" data-lech="esperar"><span><b>Esperar</b><small>Te avisamos cuando llegue</small></span></button><button type="button" class="opt" data-lech="otro"><span><b>Cambiar por otro modelo</b><small>Un asesor te escribe</small></span></button><button type="button" class="opt" data-lech="cancelar"><span><b>Cancelar el pedido</b></span></button></div>';
    else if (O.st === 'cancelado') cuerpo = '<div class="info"><b>Tu pedido fue cancelado.</b><br>Si pagaste inicial, Administración te contactará para el reembolso.</div>';
    else cuerpo = seguimiento();
    $('#cl-body').innerHTML = resumen + cuerpo;
    if (foco) { const el = document.getElementById(foco); if (el) el.focus(); }
  }

  async function cargar() {
    const { data, error } = await sb.rpc('cliente_ver', { p_token: token });
    if (error) { if (!O) $('#cl-body').innerHTML = '<div class="info"><b>No pudimos cargar tu pedido.</b><br>Revisa tu conexión e intenta de nuevo.</div>'; return; }
    if (!data) { $('#cl-body').innerHTML = '<div class="info"><b>No encontramos ese pedido.</b><br>Revisa el enlace que te enviamos por WhatsApp.</div>'; return; }
    const prev = O && O.st; O = data;
    const ae = document.activeElement;
    if (prev && O.st === 'cliente' && prev === 'cliente' && ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
    pintar();
  }

  async function responder(tipo, valor) {
    const { data, error } = await sb.rpc('cliente_responder', { p_token: token, p_tipo: tipo, p_valor: valor });
    if (error) { toast('No pudimos guardar tu respuesta. Intenta de nuevo.'); return; }
    if (data === 'ya_respondido') toast('Ya habíamos recibido tu respuesta.');
    else if (data !== 'ok') toast('No pudimos guardar tu respuesta. Intenta de nuevo.');
    else toast('¡Listo! Recibimos tu respuesta.');
    await cargar();
  }
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-alt],[data-lech]'); if (!b || !O) return;
    b.disabled = true;
    if (b.hasAttribute('data-alt')) return responder('alternativa', b.getAttribute('data-alt'));
    return responder('lecheria', b.getAttribute('data-lech'));
  });
  root.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'ciudad') { F.ciudad = t.value; if (!opciones(F.ciudad).includes(F.metodo)) F.metodo = ''; pintar(); }
    else if (t.name === 'metodo') { F.metodo = t.value; pintar(); }
    else if (t.id === 'banco') F.banco = t.value;
    else if (t.id === 'fecha') F.fecha = t.value;
  });
  root.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'tel') F.telefono = t.value; else if (t.id === 'ref') F.referencia = t.value; else if (t.id === 'dir') F.direccion = t.value; else if (t.id === 'of') F.oficina = t.value;
  });
  root.addEventListener('submit', async e => {
    if (e.target.id !== 'f') return;
    e.preventDefault(); F.intento = true; F.error = '';
    const v = validar();
    if (Object.keys(v).length) { pintar(); const x = document.querySelector('.err'); if (x) x.scrollIntoView({ block: 'center' }); return; }
    const m = METODOS[F.metodo];
    const entrega = { ciudad: F.ciudad, metodo: m.nombre, detalle: F.metodo === 'mrw' ? F.oficina.trim() : F.metodo === 'delivery' ? F.direccion.trim() : '' };
    const pago = Number(O.ini_pct) > 0 ? { banco: F.banco, telefono: F.telefono.trim(), referencia: F.referencia.trim(), fecha: F.fecha } : {};
    F.enviando = true; pintar();
    const { data, error } = await sb.rpc('cliente_enviar', { p_token: token, p_entrega: entrega, p_pago: pago });
    F.enviando = false;
    if (error) { F.error = 'No pudimos enviar tus datos. Revisa tu conexión e intenta de nuevo.'; pintar(); return; }
    const MSG = {
      duplicada: 'Esa referencia ya está registrada en otro pedido. Revisa el número; si el problema sigue, un asesor te escribirá.',
      pago_incompleto: 'Revisa los datos del pago: banco, teléfono y referencia completa.',
      fecha_invalida: 'La fecha del pago debe ser de los últimos 7 días.',
      metodo_invalido: 'Esa forma de entrega no está disponible en tu ciudad.',
      falta_oficina: 'Escribe la oficina MRW.', falta_direccion: 'Escribe tu dirección completa.',
      ya_enviado: 'Ya habíamos recibido tus datos.', no_existe: 'No encontramos este pedido.'
    };
    if (data !== 'ok') { F.error = MSG[data] || 'No pudimos enviar tus datos. Intenta de nuevo.'; if (data === 'ya_enviado') { await cargar(); return; } pintar(data === 'duplicada' ? 'ref' : null); return; }
    toast('¡Listo! Recibimos tus datos.');
    await cargar();
  });

  if (!listo) { $('#cl-body').innerHTML = '<div class="info">Esta página todavía no está configurada.</div>'; return; }
  if (token.length < 24) { $('#cl-body').innerHTML = '<div class="info"><b>Este enlace no está completo.</b><br>Ábrelo directamente desde el mensaje de WhatsApp que te enviamos.</div>'; return; }
  window.__soyRecargar = cargar;
  cargar();
  // Se actualiza sola cada 20 segundos mientras la página esté a la vista
  setInterval(() => { if (!document.hidden && O && ['despachado', 'entregado', 'cancelado'].indexOf(O.st) < 0) cargar(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cargar(); });
})();
