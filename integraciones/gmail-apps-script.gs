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
 *       URL_FUNCION   = https://TU-PROYECTO.supabase.co/functions/v1/recibir-correo
 *       INGRESO_CLAVE = (el mismo valor del secreto INGRESO_CLAVE en Supabase)
 *  3. Arriba elige la función «instalar» y pulsa Ejecutar. Acepta los permisos.
 *  4. Listo: cada correo procesado queda con la etiqueta «pedidos-sistema».
 *
 * Para probar sin esperar: elige «revisarCorreos» y pulsa Ejecutar.
 */

// Correos que se envían al sistema. Si Cashea usa un remitente fijo, puedes
// agregarlo, por ejemplo: 'from:notificaciones@cashea.app "Código de identificación" ...'
var BUSQUEDA = '"Código de identificación" newer_than:3d -label:pedidos-sistema';
var ETIQUETA = 'pedidos-sistema';
var ETIQUETA_ERROR = 'pedidos-sistema-error';

function revisarCorreos() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('URL_FUNCION'), clave = props.getProperty('INGRESO_CLAVE');
  if (!url || !clave) throw new Error('Faltan URL_FUNCION o INGRESO_CLAVE en las propiedades del script.');
  var ok = GmailApp.getUserLabelByName(ETIQUETA) || GmailApp.createLabel(ETIQUETA);
  var mal = GmailApp.getUserLabelByName(ETIQUETA_ERROR) || GmailApp.createLabel(ETIQUETA_ERROR);
  var hilos = GmailApp.search(BUSQUEDA, 0, 50);
  hilos.forEach(function (hilo) {
    var todoBien = true;
    hilo.getMessages().forEach(function (m) {
      var r = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-clave': clave },
        payload: JSON.stringify({ mensaje_id: m.getId(), remitente: m.getFrom(), asunto: m.getSubject(), texto: m.getPlainBody() })
      });
      if (r.getResponseCode() !== 200) { todoBien = false; console.error('Correo ' + m.getId() + ': ' + r.getResponseCode() + ' ' + r.getContentText()); }
    });
    hilo.addLabel(todoBien ? ok : mal);
  });
}

function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'revisarCorreos') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('revisarCorreos').timeBased().everyMinutes(1).create();
  revisarCorreos();
}
