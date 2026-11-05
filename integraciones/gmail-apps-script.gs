/**
 * Soytechno · Pedidos Cashea — LECTOR DEL BUZÓN DE GMAIL
 *
 * Revisa cada minuto el buzón donde llegan los correos de Cashea y envía cada
 * uno al sistema. No comparte la contraseña del correo con nadie: corre dentro
 * de la propia cuenta de Gmail de Soytechno.
 *
 * INSTALACIÓN (una sola vez, con la cuenta de Gmail que recibe los pedidos):
 *  1. Entra a https://script.google.com → Nuevo proyecto → borra todo y pega este archivo.
 *  2. Engranaje «Configuración del proyecto» → Propiedades del script → Agregar:
 *       URL_FUNCION     = https://TU-PROYECTO.supabase.co/functions/v1/recibir-correo
 *       INGRESO_CLAVE   = (el mismo valor del secreto INGRESO_CLAVE en Supabase)
 *       DOMINIOS_CASHEA = el dominio desde el que escribe Cashea, por ejemplo: cashea.app
 *         (Para verlo: abre un correo real de Cashea → ⋮ → «Mostrar original» → línea «From:»)
 *
 * SEGURIDAD: solo se envían al sistema los correos de ese dominio que Gmail comprobó
 * como auténticos (DKIM/DMARC). Un correo falso o reenviado a mano no crea pedidos:
 * queda en la Bandeja como «revisar».
 *  3. Arriba elige la función «instalar» y pulsa Ejecutar. Acepta los permisos.
 *  4. Listo: cada correo procesado queda con la etiqueta «pedidos-sistema».
 *
 * Para probar sin esperar: elige «revisarCorreos» y pulsa Ejecutar.
 */

var BUSQUEDA_BASE = '"Código de identificación" newer_than:3d -label:pedidos-sistema';
var ETIQUETA = 'pedidos-sistema';
var ETIQUETA_ERROR = 'pedidos-sistema-error';

function revisarCorreos() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('URL_FUNCION'), clave = props.getProperty('INGRESO_CLAVE');
  var dominios = String(props.getProperty('DOMINIOS_CASHEA') || '').toLowerCase().split(',').map(function (d) { return d.trim(); }).filter(String);
  if (!url || !clave || !dominios.length) throw new Error('Faltan URL_FUNCION, INGRESO_CLAVE o DOMINIOS_CASHEA en las propiedades del script.');
  var BUSQUEDA = 'from:(' + dominios.join(' OR ') + ') ' + BUSQUEDA_BASE;
  var ok = GmailApp.getUserLabelByName(ETIQUETA) || GmailApp.createLabel(ETIQUETA);
  var mal = GmailApp.getUserLabelByName(ETIQUETA_ERROR) || GmailApp.createLabel(ETIQUETA_ERROR);
  var hilos = GmailApp.search(BUSQUEDA, 0, 50);
  hilos.forEach(function (hilo) {
    var todoBien = true;
    hilo.getMessages().forEach(function (m) {
      var r = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-clave': clave },
        payload: JSON.stringify({ mensaje_id: m.getId(), remitente: m.getFrom(), asunto: m.getSubject(), texto: m.getPlainBody(), autenticado: autenticado(m, dominios) })
      });
      if (r.getResponseCode() !== 200) { todoBien = false; console.error('Correo ' + m.getId() + ': ' + r.getResponseCode() + ' ' + r.getContentText()); }
    });
    hilo.addLabel(todoBien ? ok : mal);
  });
}

/** ¿Gmail comprobó que el correo viene de verdad de uno de esos dominios? (DMARC o DKIM) */
function autenticado(m, dominios) {
  var crudo = m.getRawContent(), fin = crudo.search(/\r?\n\r?\n/);
  var cab = (fin > 0 ? crudo.slice(0, fin) : crudo).replace(/\r?\n[ \t]+/g, ' ');   // une las líneas de cabecera partidas
  // Solo vale la PRIMERA cabecera de resultados: la agrega Gmail al recibir el correo.
  // Las que vengan más abajo pudo escribirlas el remitente y no se toman en cuenta.
  var primera = cab.split(/\r?\n/).filter(function (l) { return /^Authentication-Results:/i.test(l); })[0] || '';
  if (!/^Authentication-Results:\s*mx\.google\.com/i.test(primera)) return false;
  var res = primera.toLowerCase();
  return dominios.some(function (d) {
    var e = d.replace(/\./g, '\\.');
    var dmarc = new RegExp('dmarc=pass[^;]*header\\.from=([a-z0-9.-]+\\.)?' + e + '(?=[\\s;)]|$)').test(res);
    var dkim = new RegExp('dkim=pass[^;]*header\\.(i=[^;\\s]*@|d=)([a-z0-9.-]+\\.)?' + e + '(?=[\\s;)]|$)').test(res);
    return dmarc || dkim;
  });
}

function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'revisarCorreos') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('revisarCorreos').timeBased().everyMinutes(1).create();
  revisarCorreos();
}
