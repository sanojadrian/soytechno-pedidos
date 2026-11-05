-- Prueba del flujo completo con cada rol. Uso: psql -f stub_supabase.sql, schema.sql y luego este archivo.
\set ON_ERROR_STOP 1
\set QUIET 1
-- usuarios de prueba
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-000000000001','sup@x'),('00000000-0000-0000-0000-000000000002','oper@x'),
 ('00000000-0000-0000-0000-000000000003','c1@x'),('00000000-0000-0000-0000-000000000004','c2@x'),
 ('00000000-0000-0000-0000-000000000005','c3@x'),('00000000-0000-0000-0000-000000000006','desp@x'),
 ('00000000-0000-0000-0000-000000000007','aj@x'),('00000000-0000-0000-0000-000000000008','ase@x'),
 ('00000000-0000-0000-0000-000000000009','adm@x'),('00000000-0000-0000-0000-000000000010','tie@x'),
 ('00000000-0000-0000-0000-000000000011','baja@x');
insert into perfiles (id, nombre, rol, dept, tienda, telefono, activo) values
 ('00000000-0000-0000-0000-000000000001','Sofía','supervisor',null,null,'04125550001',true),
 ('00000000-0000-0000-0000-000000000002','Olga','operador',null,null,null,true),
 ('00000000-0000-0000-0000-000000000003','Carla','cajero','MRW',null,null,true),
 ('00000000-0000-0000-0000-000000000004','Luis','cajero','MRW',null,null,true),
 ('00000000-0000-0000-0000-000000000005','Rosa','cajero','Delivery',null,null,true),
 ('00000000-0000-0000-0000-000000000006','Javier','despacho',null,null,null,true),
 ('00000000-0000-0000-0000-000000000007','Andrea','ajuste',null,null,null,true),
 ('00000000-0000-0000-0000-000000000008','Patricia','asesor',null,null,null,true),
 ('00000000-0000-0000-0000-000000000009','Daniel','admin',null,null,null,true),
 ('00000000-0000-0000-0000-000000000010','Ricardo','tienda',null,'CCCT',null,true),
 ('00000000-0000-0000-0000-000000000011','Exempleado','cajero','MRW',null,null,false);

create or replace function pg_temp.fallo(sql text, espera text) returns void language plpgsql as $f$
begin
  execute sql;
  raise exception 'DEBIÓ FALLAR: %', sql using errcode = 'XX999';
exception when sqlstate 'XX999' then raise;
  when others then
    if sqlerrm not ilike '%' || espera || '%' then raise exception 'Error inesperado en [%]: % (esperaba %)', sql, sqlerrm, espera; end if;
end $f$;
grant execute on function pg_temp.fallo(text, text) to anon, authenticated, service_role;
create or replace function pg_temp.igual(a anyelement, b anyelement, que text) returns void language plpgsql as $f$
begin if a is distinct from b then raise exception 'FALLA %: obtuve %, esperaba %', que, a, b; end if; end $f$;
grant execute on function pg_temp.igual(anyelement, anyelement, text) to anon, authenticated, service_role;

-- ===== 1. Correos que entran (servidor) =====
set role service_role; select null from set_config('request.jwt.claims', '{"role":"service_role"}', false) x;
select pg_temp.igual(ingresar_pedido('{"code":"1001","producto":"SAMSUNG A16","total":172.41,"ini_pct":20,"ini_monto":40,"cliente":{"nombre":"MARÍA GONZÁLEZ","telefono":"+584145550123","cedula":"12345678"}}') ->> 'estado', 'creado', 'crear 1001');
select pg_temp.igual(ingresar_pedido('{"code":"1002","producto":"REDMI 14C","total":120,"ini_pct":0,"ini_monto":0,"cliente":{"nombre":"PEDRO PÉREZ","telefono":"04145550124","cedula":"22333444"}}') ->> 'estado', 'creado', 'crear 1002');
select pg_temp.igual(ingresar_pedido('{"code":"1003","producto":"COMBO MIX","total":300,"mix":true,"cliente":{"nombre":"ANA","telefono":"04145550125"}}') ->> 'estado', 'creado', 'crear 1003 MIX');
select pg_temp.igual(ingresar_pedido('{"code":"1004","producto":"TECNO SPARK","total":150,"ini_pct":30,"ini_monto":51.7,"cliente":{"nombre":"CARLOS","telefono":"04245550188"}}') ->> 'estado', 'creado', 'crear 1004');
select pg_temp.igual(ingresar_pedido('{"code":"1001","producto":"SAMSUNG A16","total":172.41,"cliente":{"telefono":"+584145550123","cedula":"12345678"}}') ->> 'estado', 'duplicado', 'no duplica');
select pg_temp.fallo($$select ingresar_pedido('{"code":"1009","producto":"X","total":0,"cliente":{"telefono":"04140000000"}}')$$, 'total');
select pg_temp.igual(ingresar_pedido('{"code":"1001","producto":"SAMSUNG A16","total":172.41,"cliente":{"nombre":"ATACANTE","telefono":"+15550001111","cedula":"999"}}') ->> 'estado', 'conflicto', 'mismo pedido con otro cliente: conflicto');
select pg_temp.igual(ingresar_pedido('{"code":"1001","producto":"SAMSUNG A16","total":172.41,"cliente":{"nombre":"MARÍA","telefono":"0414-555-0123","cedula":"12345678"}}') ->> 'estado', 'duplicado', 'mismo cliente con otro formato: duplicado normal');
reset role;
select pg_temp.igual((select st from pedidos where code='1003'), 'standby', 'MIX va a stand-by');
select pg_temp.igual((select count(*) from mensajes where tipo='enlace')::int, 3, 'enlaces en cola (no el MIX)');
select pg_temp.igual((select count(*) from eventos)::int, 5, 'eventos de ingreso (incluye la alerta de conflicto)');
select pg_temp.igual((select count(*) from alertas where tipo='conflicto')::int, 1, 'alerta de conflicto');
select pg_temp.igual(length((select token from pedidos_token where code='1001')), 32, 'token largo');

-- ===== 2. Cliente (anónimo) =====
set role anon; select null from set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.fallo('select * from pedidos', 'permission denied');
select pg_temp.fallo($$select accion('1001','facturar')$$, 'permission denied');
reset role;
select token as t1 from pedidos_token where code='1001' \gset
select token as t2 from pedidos_token where code='1002' \gset
select token as t4 from pedidos_token where code='1004' \gset
set role anon; select null from set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.igual(cliente_ver(:'t1') ->> 'nombre', 'María', 'nombre corto');
select pg_temp.igual(cliente_ver(:'t1') ? 'cliente', false, 'no expone datos personales');
select pg_temp.igual(cliente_ver('1001'), null::jsonb, 'el número de Cashea no abre el pedido');
select pg_temp.igual(cliente_enviar(:'t1', '{"ciudad":"Caracas","metodo":"MRW","detalle":"x"}', '{}'), 'metodo_invalido', 'MRW no en Caracas');
select pg_temp.igual(cliente_enviar(:'t1', '{"ciudad":"Valencia","metodo":"MRW","detalle":"MRW Valencia Centro"}', '{"banco":"Banesco","referencia":"12","telefono":"04145550123","fecha":"2026-11-05"}'), 'pago_incompleto', 'referencia corta');
select pg_temp.igual(cliente_enviar(:'t1', '{"ciudad":"Valencia","metodo":"MRW","detalle":"MRW Valencia Centro"}', jsonb_build_object('banco','Banco de Venezuela','referencia','004598120377','telefono','0414-555-0123','fecha',(now() at time zone 'America/Caracas')::date)), 'ok', 'cliente envía 1001');
select pg_temp.igual(cliente_enviar(:'t1', '{"ciudad":"Valencia","metodo":"MRW","detalle":"x"}', '{}'), 'ya_enviado', 'no reenvía');
select pg_temp.igual(cliente_enviar(:'t2', '{"ciudad":"Caracas","metodo":"Delivery","detalle":"corto"}', '{}'), 'falta_direccion', 'dirección');
select pg_temp.igual(cliente_enviar(:'t2', '{"ciudad":"Caracas","metodo":"Delivery","detalle":"Av. Francisco de Miranda, Los Palos Grandes"}', '{}'), 'ok', 'cliente envía 1002 sin inicial');
select pg_temp.igual(cliente_enviar(:'t4', '{"ciudad":"Maracaibo","metodo":"MRW","detalle":"MRW Maracaibo"}', jsonb_build_object('banco','Banco de Venezuela','referencia','004598120377','telefono','04245550188','fecha',(now() at time zone 'America/Caracas')::date)), 'duplicada', 'referencia repetida bloqueada');
select pg_temp.igual(cliente_enviar(:'t4', '{"ciudad":"Maracaibo","metodo":"MRW","detalle":"MRW Maracaibo"}', jsonb_build_object('banco','Banco de Venezuela','referencia','4598120377','telefono','04245550188','fecha',(now() at time zone 'America/Caracas')::date)), 'duplicada', 'misma referencia sin ceros: bloqueada');
select pg_temp.igual(cliente_enviar(:'t4', '{"ciudad":"Maracaibo","metodo":"MRW","detalle":"MRW Maracaibo"}', jsonb_build_object('banco','banco de venezuela','referencia','004598120377','telefono','04245550188','fecha',(now() at time zone 'America/Caracas')::date)), 'pago_incompleto', 'banco inventado: rechazado');
select pg_temp.igual(cliente_enviar(:'t4', '{"ciudad":"Maracaibo","metodo":"MRW","detalle":"MRW Maracaibo"}', jsonb_build_object('banco','Banesco','referencia','004598120377','telefono','04245550188','fecha',(now() at time zone 'America/Caracas')::date)), 'ok', 'misma ref otro banco pasa con aviso');
reset role;
select pg_temp.igual((select dept from pedidos where code='1001'), 'MRW', 'dept MRW');
select pg_temp.igual((select tag from pedidos where code='1004') like 'Referencia repetida%', true, 'aviso de ref en otro banco');

-- ===== 3. Cajas =====
set role authenticated;
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000003"}', false);
select pg_temp.fallo($$select tomar_siguiente('Delivery')$$, 'no es tu caja');
select pg_temp.igual((tomar_siguiente('MRW')).code, '1001', 'Carla toma el más antiguo');
select pg_temp.igual((tomar_siguiente('MRW')).code, '1001', 'uno a la vez');
select pg_temp.fallo($$update pedidos set st='despachado' where code='1001'$$, 'permission denied');
select pg_temp.fallo($$delete from eventos$$, 'permission denied');
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000004"}', false);
select pg_temp.igual((tomar_siguiente('MRW')).code, '1004', 'Luis recibe otro pedido');
select pg_temp.fallo($$select accion('1001','facturar')$$, 'lo atiende Carla');
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000011"}', false);
select pg_temp.fallo($$select tomar_siguiente('MRW')$$, 'no está activo');
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000003"}', false);
select pg_temp.igual((accion('1001','facturar')).st, 'despacho', 'Carla factura');
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000004"}', false);
select pg_temp.igual((accion('1004','noval')).st, 'noval', 'Luis no pudo validar');

select pg_temp.fallo($$select * from pedidos_token$$, 'permission denied');
select pg_temp.fallo($$select enlace_cliente('1001')$$, 'No tienes permiso');
select pg_temp.fallo($$select reenviar_aviso('1001','despachado')$$, 'No tienes permiso');
-- ===== 4. Despacho =====
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000006"}', false);
select pg_temp.fallo($$select accion('1001','despachar','{"guia":"123"}')$$, 'fotos obligatorias');
select pg_temp.fallo($$select accion('1001','foto','{"slot":"factura","ruta":"9999/x.jpg"}')$$, 'Ruta de foto');
select pg_temp.fallo($$select accion('1001','foto','{"slot":"factura","ruta":"1004/../1001/factura-1.jpg"}')$$, 'Ruta de foto');
select pg_temp.fallo($$select accion('1001','foto','{"slot":"factura","ruta":"1001/factura-1.jpg"}')$$, 'no terminó de subir');
reset role; insert into storage.objects (bucket_id, name) values ('despacho','1001/factura-1.jpg'), ('despacho','1001/equipo-1.jpg'); set role authenticated;
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000006"}', false);
select pg_temp.igual((accion('1001','foto','{"slot":"factura","ruta":"1001/factura-1.jpg"}')).fotos ? 'factura', true, 'foto factura');
select pg_temp.igual((accion('1001','foto','{"slot":"equipo","ruta":"1001/equipo-1.jpg"}')).fotos ? 'equipo', true, 'foto equipo');
select pg_temp.fallo($$select accion('1001','despachar','{}')$$, 'guía de MRW');
select pg_temp.igual((accion('1001','despachar','{"guia":"MRW-555"}')).st, 'despachado', 'despachado');
select pg_temp.fallo($$select accion('1004','facturar')$$, 'ya no está en tu caja');

-- ===== 5. Asesor y Administración =====
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000008"}', false);
select pg_temp.igual((accion('1004','a_admin','{"tipo":"Transferencia","destino":"Mercantil 0414"}')).st, 'admin', 'a admin');
select pg_temp.igual((accion('1003','mix_listo')).st, 'cliente', 'MIX revisado');
select pg_temp.igual(length(enlace_cliente('1003')), 32, 'asesor ve el enlace');
select pg_temp.fallo($$select reenviar_aviso('1003','despachado')$$, 'no corresponde');
select reenviar_aviso('1003','enlace'); select reenviar_aviso('1003','enlace'); select reenviar_aviso('1003','enlace');
select pg_temp.fallo($$select reenviar_aviso('1003','enlace')$$, '3 veces');
select pg_temp.fallo($$select accion('1001','telefono','{"telefono":"04149999999"}')$$, 'antes de facturar');
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000009"}', false);
select pg_temp.igual((accion('1004','aprobar')).tag, 'Pago aprobado por Administración', 'admin aprueba');

-- ===== 6. Ajuste: sin stock + alternativas =====
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000005"}', false);
select pg_temp.igual((tomar_siguiente('Delivery')).code, '1002', 'Rosa toma 1002');
select pg_temp.igual((accion('1002','sinstock')).st, 'ajuste', 'sin stock');
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000007"}', false);
select pg_temp.fallo($$select accion('1002','alternativas','{"alternativas":["  "]}')$$, 'al menos una');
select pg_temp.igual((accion('1002','alternativas','{"alternativas":["REDMI 14C AZUL","REDMI NOTE 14"]}')).st, 'espera', 'alternativas enviadas');
reset role;
set role anon; select null from set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.igual(cliente_responder(:'t2', 'alternativa', 'x'), 'opcion_invalida', 'opción inválida');
select pg_temp.igual(cliente_responder(:'t2', 'alternativa', '1'), 'ok', 'cliente elige');
select pg_temp.igual(cliente_responder(:'t2', 'alternativa', '0'), 'ya_respondido', 'no responde dos veces');
reset role;
select pg_temp.igual((select producto from pedidos where code='1002'), 'REDMI NOTE 14', 'producto reemplazado');
select pg_temp.igual((select ajuste->>'producto_original' from pedidos where code='1002'), 'REDMI 14C', 'guarda el original');

-- ===== 7. Lechería =====
set role authenticated;
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000005"}', false);
select pg_temp.igual((tomar_siguiente('Delivery')).code, '1002', 'Rosa lo retoma');
select pg_temp.igual((accion('1002','traslado','{"origen":"Lechería"}')).st, 'traslado', 'traslado Lechería');
reset role;
set role anon; select null from set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.igual(cliente_responder(:'t2', 'lecheria', 'esperar'), 'ok', 'cliente espera');
select pg_temp.igual(cliente_responder(:'t2', 'lecheria', 'cancelar'), 'ya_respondido', 'no cambia después');
reset role;
set role authenticated;
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000007"}', false);
select pg_temp.igual((accion('1002','recibido')).st, 'caja', 'traslado recibido');

-- ===== 8. Tienda =====
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000010"}', false);
select pg_temp.igual((accion('1002','pasar_tienda')).tienda, 'CCCT', 'pasado a CCCT');
select pg_temp.igual((accion('1002','entregar')).st, 'entregado', 'entregado');
select pg_temp.fallo($$select accion('1001','cancelar')$$, 'permiso');

-- ===== 9. Supervisión =====
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}', false);
select pg_temp.igual((resumen_hoy() ->> 'recibidos')::int, 4, 'resumen: recibidos');
select pg_temp.igual((resumen_hoy() ->> 'despachados')::int, 1, 'resumen: despachados');
select pg_temp.igual((select count(*) from perfiles)::int, 11, 'supervisor ve perfiles');
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000003"}', false);
select pg_temp.igual((select count(*) from perfiles)::int, 1, 'cajero solo se ve a sí mismo');
reset role; insert into correos (texto, estado) values ('correo de prueba', 'ok'); set role authenticated;
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000003"}', false);
select pg_temp.igual((select count(*) from correos)::int, 0, 'cajero no ve correos');
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000002"}', false);
select pg_temp.igual((select count(*) from correos)::int, 1, 'operador ve correos');
reset role; update correos set estado = 'revisar'; set role authenticated;
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000002"}', false);
select resolver_correo((select id from correos limit 1), 'ok', '1001');
select pg_temp.igual((select detalle from correos limit 1), 'Cargado a mano por Olga', 'operador resuelve correo');

-- ===== 10. Ranking de agotados =====
select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000007"}', false);
select pg_temp.igual((select agotado + lecheria from ranking_agotados(30) where producto = 'REDMI 14C')::int, 2, 'ranking cuenta agotado + Lechería');
select marcar_producto('REDMI 14C', true);
reset role;

-- ===== 11. Cola de WhatsApp (servidor) =====
select pg_temp.igual((select string_agg(tipo, ',' order by id) from mensajes), 'enlace,enlace,enlace,despachado,enlace,enlace,enlace,enlace,alternativas,lecheria', 'avisos en cola');
set role service_role; select null from set_config('request.jwt.claims', '{"role":"service_role"}', false) x;
select jsonb_array_length(tomar_mensajes(3)) = 3;
select pg_temp.igual(jsonb_array_length(tomar_mensajes(10)), 7, 'el resto');
select pg_temp.igual(jsonb_array_length(tomar_mensajes(10)), 0, 'nada se entrega dos veces');
select resultado_mensaje(1, true, null, 'uuid-1');
select resultado_mensaje(2, false, 'Callbell 500');
reset role;
select pg_temp.igual((select estado from mensajes where id=2), 'pendiente', 'reintento programado');
update mensajes set proximo_intento = now() where id = 2;
set role service_role; select null from set_config('request.jwt.claims', '{"role":"service_role"}', false) x;
select tomar_mensajes(1) is not null; select resultado_mensaje(2, false, 'Callbell 500');
reset role; update mensajes set proximo_intento = now() where id = 2;
set role service_role; select null from set_config('request.jwt.claims', '{"role":"service_role"}', false) x;
select tomar_mensajes(1) is not null; select resultado_mensaje(2, false, 'Callbell 500');
reset role;
select pg_temp.igual((select estado from mensajes where id=2), 'error', 'tras 3 intentos queda en error');
set role authenticated; select null from set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000003"}', false);
select pg_temp.fallo($$select tomar_mensajes(1)$$, 'permission denied');
reset role;

-- ===== 12. Alertas y retrasos (como el SQL Editor: sin usuario) =====
select null from set_config('request.jwt.claims', '', false);
update correos set recibido_at = now() - interval '2 hours';
select ingresar_pedido('{"code":"1005","producto":"MOTO G35","total":100,"cliente":{"nombre":"LUIS","telefono":"04145550199"}}') is not null;
update pedidos set st='traslado', dept='Delivery', ajuste='{"origen":"CCCT","solicitado_at":"2026-01-01T10:00:00Z"}' where code='1005';
select revisar_alertas() >= 0;
select pg_temp.igual((select count(*) from mensajes where tipo='retraso' and code='1005')::int, 1, 'aviso de retraso');
select revisar_alertas() >= 0;
select pg_temp.igual((select count(*) from mensajes where tipo='retraso' and code='1005')::int, 1, 'retraso se avisa una sola vez');
select 'TODAS LAS PRUEBAS PASARON' as resultado;
