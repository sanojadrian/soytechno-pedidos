/* Soytechno · Pedidos Cashea — página del cliente */
(function () {
  'use strict';
  const { sb, listo, esc, money, hoyISO, CIUDADES, METODOS, opciones, oficinas, DN, toast } = window.SOY;
  const $ = s => document.querySelector(s);
  const root = $('#cl');
  const code = new URLSearchParams(location.search).get('c') || '';
  let O = null;
  const F = { ciudad: '', metodo: '', oficina: '', q: '', direccion: '', banco: 'Banco de Venezuela', telefono: '', referencia: '', fecha: hoyISO(), intento: false, error: '', enviando: false };

  const nombre1 = () => (((O && O.cliente && O.cliente.nombre) || '').split(' ')[0] || '').toLowerCase().replace(/^./, c => c.toUpperCase());

  function validar() {
    const e = {};
    if (!F.ciudad) e.ciudad = 'Elige tu ciudad.';
    else if (!F.metodo) e.metodo = 'Elige cómo quieres recibirlo.';
    if (F.metodo === 'mrw' && !F.oficina) e.oficina = 'Elige una oficina MRW.';
    if (F.metodo === 'delivery' && F.direccion.trim().length < 8) e.direccion = 'Escribe tu dirección completa.';
    if (Number(O.ini_pct) > 0) {
      if (!/^0(412|414|416|422|424|426)-?\d{3}-?\d{4}$/.test(F.telefono.trim())) e.telefono = 'Usa el formato 0414-555-0123.';
      if (!/^\d{8,20}$/.test(F.referencia.trim())) e.referencia = 'Escribe la referencia completa (mínimo 8 dígitos).';
      if (!F.fecha) e.fecha = 'Indica la fecha del pago.';
    }
    return e;
  }
  const err = (k, e) => F.intento && e[k] ? '<span class="err">' + e[k] + '</span>' : '';
  const ofHTML = () => { const q = F.q.trim().toLowerCase(), l = oficinas(F.ciudad).filter(o => o.toLowerCase().includes(q)); return l.length ? l.map(o => '<label class="opt"><input type="radio" name="of" value="' + esc(o) + '"' + (o === F.oficina ? ' checked' : '') + '><span>' + esc(o) + '</span></label>').join('') : '<p class="muted">Sin resultados.</p>'; };

  function formulario() {
    const e = validar(), ini = Number(O.ini_pct) > 0;
    let h = '<p>¡Hola ' + esc(nombre1()) + '! 👋 Para despachar tu pedido necesitamos dos datos.</p>';
    h += '<form id="f" novalidate style="display:grid;gap:18px">';
    h += '<div class="field"><label for="ciudad">1. ¿En qué ciudad estás?</label><select id="ciudad"><option value="">Elige tu ciudad</option>' + CIUDADES.map(c => '<option' + (c === F.ciudad ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>' + err('ciudad', e) + '</div>';
    if (F.ciudad) {
      h += '<fieldset class="field"><legend>2. ¿Cómo lo quieres recibir?</legend><div class="opts">' + opciones(F.ciudad).map(m => '<label class="opt"><input type="radio" name="metodo" value="' + m + '"' + (m === F.metodo ? ' checked' : '') + '><span><b>' + METODOS[m].nombre + '</b><small>' + METODOS[m].desc(F.ciudad) + '</small></span><span class="free">Gratis</span></label>').join('') + '</div>' + err('metodo', e) + '</fieldset>';
      if (F.metodo === 'mrw') h += '<div class="field"><label for="q">Busca tu oficina MRW</label><input type="search" id="q" placeholder="Ej.: Centro, Bolívar…" value="' + esc(F.q) + '"><div class="offices" id="ofs">' + ofHTML() + '</div><small>Lista de ejemplo para la demo.</small>' + err('oficina', e) + '</div>';
      if (F.metodo === 'delivery') h += '<div class="field"><label for="dir">Dirección de entrega en Caracas</label><textarea id="dir" rows="3">' + esc(F.direccion) + '</textarea>' + err('direccion', e) + '</div>';
      if (F.metodo === 'pickup') h += '<div class="info"><b>Tienda Chacao</b><br>Av. Andrés Galarraga, área de pickup. Te avisamos cuando esté listo para retirar.</div>';
      if (F.metodo === 'ruta') h += '<div class="info"><b>Ruta foránea · ' + esc(F.ciudad) + '</b><br>Te escribimos para coordinar el día de entrega.</div>';
    }
    if (ini) {
      h += '<div class="amount"><span>3. Paga tu inicial (' + Number(O.ini_pct) + '%)</span><b>' + money(O.ini_monto) + '</b><small>Pago móvil a Soytechno · BNC · en Bs a tasa BCV del día</small></div>';
      h += '<div class="field"><label for="banco">Banco desde donde pagaste</label><select id="banco">' + ['Banco de Venezuela', 'Banesco', 'Mercantil', 'Provincial', 'BNC', 'Bancamiga', 'Otro'].map(b => '<option' + (b === F.banco ? ' selected' : '') + '>' + b + '</option>').join('') + '</select></div>';
      h += '<div class="field"><label for="tel">Teléfono asociado al banco</label><input type="tel" id="tel" inputmode="tel" placeholder="0414-555-0123" value="' + esc(F.telefono) + '">' + err('telefono', e) + '</div>';
      h += '<div class="field"><label for="ref">Referencia completa</label><input type="text" id="ref" inputmode="numeric" placeholder="Ej.: 004598120377" value="' + esc(F.referencia) + '"><small>Todos los dígitos, no solo los últimos 6.</small>' + err('referencia', e) + '</div>';
      h += '<div class="field"><label for="fecha">Fecha del pago</label><input type="date" id="fecha" value="' + esc(F.fecha) + '">' + err('fecha', e) + '</div>';
    }
    if (F.error) h += '<p class="err">' + esc(F.error) + '</p>';
    h += '<button class="btn block" type="submit"' + (F.enviando ? ' disabled' : '') + '>' + (F.enviando ? 'Enviando…' : ini ? 'Enviar pago y confirmar' : 'Confirmar pedido') + '</button></form>';
    return h;
  }

  function seguimiento() {
    const st = O.st, e = O.entrega || {};
    const pasos = [['Pedido recibido', 'Cashea nos confirmó tu compra'], ['Entrega elegida', e.metodo ? esc(e.metodo) + (e.detalle ? ' · ' + esc(e.detalle) : '') : ''], ['Verificando y facturando', 'Nuestra caja revisa tu pedido'], ['Despachado', '']];
    const orden = { cliente: 0, standby: 0, caja: 2, tomado: 2, noval: 2, admin: 2, despacho: 2, despachado: 3 };
    let ahora = orden[st] != null ? orden[st] : 0;
    if (st === 'despacho') pasos[2][1] = 'Facturado · preparando el envío';
    let nota = '';
    if (st === 'noval' || st === 'admin') nota = '<div class="info">Estamos revisando tu pago. Si hace falta algún dato, te escribimos por WhatsApp.</div>';
    if (st === 'despachado') {
      if (e.metodo === 'MRW') nota = '<div class="info">📦 Tu pedido salió por MRW' + (e.guia ? ' con la guía <b>' + esc(e.guia) + '</b>' : '') + '. La guía también te llega por correo. El envío tarda de 2 a 3 días hábiles.</div>';
      else if (e.metodo === 'Delivery') nota = '<div class="info">🛵 Tu delivery va en camino. Te llegará un correo con los datos de tu rutero.</div>';
      else if (e.metodo && e.metodo.indexOf('Pickup') === 0) nota = '<div class="info">🏬 Tu pedido está listo para retirar en Tienda Chacao, Av. Andrés Galarraga.</div>';
      else nota = '<div class="info">🚚 Tu pedido salió en la ruta foránea hacia ' + esc(e.ciudad || '') + '.</div>';
    } else if (e.metodo === 'MRW') nota = nota || '<div class="info">Cuando despachemos, la guía de MRW te llegará por correo. El envío tarda de 2 a 3 días hábiles.</div>';
    else if (e.metodo === 'Delivery') nota = nota || '<div class="info">Cuando despachemos, te llegará un correo con los datos de tu rutero.</div>';
    return '<p>¡Gracias, ' + esc(nombre1()) + '! Así va tu pedido. Esta pantalla se actualiza sola.</p><ol class="steps">' + pasos.map((p, i) => '<li class="' + (i < ahora || (i === ahora && st === 'despachado') ? 'done' : i === ahora ? 'now' : '') + '"><span class="d">' + (i < ahora || st === 'despachado' && i === ahora ? '✓' : i + 1) + '</span><span><b>' + p[0] + '</b><small>' + p[1] + '</small></span></li>').join('') + '</ol>' + nota;
  }

  function pintar(foco) {
    if (!O) return;
    const resumen = '<div class="sum"><span class="eyebrow">Pedido Cashea #' + esc(O.code) + '</span><b>' + esc(O.producto) + '</b><span class="muted">' + (Number(O.ini_pct) ? 'Inicial ' + Number(O.ini_pct) + '%: ' + money(O.ini_monto) : 'Sin inicial') + '</span></div>';
    let cuerpo;
    if (O.st === 'cliente') cuerpo = formulario();
    else if (O.st === 'standby') cuerpo = '<div class="info">Tu asesor te contactará por WhatsApp para confirmar los detalles de tu compra.</div>';
    else cuerpo = seguimiento();
    $('#cl-body').innerHTML = resumen + cuerpo;
    if (foco) { const el = document.getElementById(foco); if (el) el.focus(); }
  }

  async function cargar() {
    const { data, error } = await sb.from('pedidos').select('*').eq('code', code).maybeSingle();
    if (error || !data) { $('#cl-body').innerHTML = '<div class="info"><b>No encontramos ese pedido.</b><br>Revisa el enlace que te enviamos.</div>'; return; }
    O = data; pintar();
  }

  root.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'ciudad') { F.ciudad = t.value; if (!opciones(F.ciudad).includes(F.metodo)) F.metodo = ''; F.oficina = ''; F.q = ''; pintar(); }
    else if (t.name === 'metodo') { F.metodo = t.value; pintar(); }
    else if (t.name === 'of') F.oficina = t.value;
    else if (t.id === 'banco') F.banco = t.value;
    else if (t.id === 'fecha') F.fecha = t.value;
  });
  root.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'tel') F.telefono = t.value; else if (t.id === 'ref') F.referencia = t.value; else if (t.id === 'dir') F.direccion = t.value;
    else if (t.id === 'q') { F.q = t.value; const o = $('#ofs'); if (o) o.innerHTML = ofHTML(); }
  });
  root.addEventListener('submit', async e => {
    if (e.target.id !== 'f') return;
    e.preventDefault(); F.intento = true; F.error = '';
    const v = validar();
    if (Object.keys(v).length) { pintar(); const x = document.querySelector('.err'); if (x) x.scrollIntoView({ block: 'center' }); return; }
    const m = METODOS[F.metodo];
    const entrega = { ciudad: F.ciudad, metodo: F.metodo === 'pickup' ? 'Pickup · Tienda Chacao' : m.nombre, detalle: F.metodo === 'mrw' ? F.oficina : F.metodo === 'delivery' ? F.direccion.trim() : '' };
    const pago = Number(O.ini_pct) > 0 ? { banco: F.banco, telefono: F.telefono.trim(), referencia: F.referencia.trim(), fecha: F.fecha } : {};
    F.enviando = true; pintar();
    const { data, error } = await sb.rpc('registrar_pago', { p_code: O.code, p_pago: pago, p_entrega: entrega, p_dept: m.dept });
    F.enviando = false;
    if (error) { F.error = 'No pudimos enviar tus datos. Intenta de nuevo.'; pintar(); return; }
    if (data === 'duplicada') { F.error = 'Esa referencia ya está registrada en otro pedido. Revisa el número; si el problema sigue, un asesor te escribirá.'; pintar('ref'); return; }
    toast('¡Listo! Recibimos tus datos.');
    await cargar();
  });

  if (!listo) { $('#cl-body').innerHTML = '<div class="info">Esta demo todavía no está conectada a su base de datos.</div>'; return; }
  if (!code) { $('#cl-body').innerHTML = '<div class="info">Falta el número de pedido en el enlace.</div>'; return; }
  cargar();
  sb.channel('pedido-' + code)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos', filter: 'code=eq.' + code }, ev => {
      const prev = O && O.st; O = ev.new;
      const ae = document.activeElement;
      if (O.st === 'cliente' && prev === 'cliente' && ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
      pintar();
    })
    .subscribe();
})();
