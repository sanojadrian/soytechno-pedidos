-- ============================================================================
-- Soytechno · Pedidos Cashea — BASE DE DATOS DE PRODUCCIÓN
--
-- Se corre UNA vez en un proyecto de Supabase NUEVO (no en el de la demo):
--   Supabase → SQL Editor → pegar todo este archivo → Run.
-- Se puede volver a correr sin perder datos (crea solo lo que falta y
-- reemplaza las funciones).
--
-- Principios:
--   · Cada persona entra con su usuario y su rol. Nadie modifica pedidos
--     directamente: todo cambio pasa por funciones que validan rol y estado.
--   · El cliente solo ve su pedido con un enlace secreto (token), nunca con
--     el número de Cashea, y no ve cédula, teléfono ni datos de pago.
--   · El historial (eventos) no se puede editar ni borrar.
--   · Los WhatsApp salen de una cola con reintentos (tabla mensajes).
-- ============================================================================

-- ---------------------------------------------------------------- tablas ----

create table if not exists public.perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null,
  correo      text,
  rol         text not null check (rol in ('supervisor','operador','cajero','despacho','ajuste','asesor','admin','tienda')),
  dept        text check (dept in ('Delivery','Pickup','MRW','Ruta')),   -- solo cajeros
  tienda      text,                                                     -- solo rol tienda
  telefono    text,                                                     -- para alertas (supervisores)
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.pedidos (
  code          text primary key,                 -- código de identificación de Cashea
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  st            text not null default 'cliente' check (st in (
                  'cliente','standby','caja','tomado','noval','admin','despacho','despachado',
                  'ajuste','espera','traslado','tienda','entregado','cancelado')),
  dept          text check (dept in ('Delivery','Pickup','MRW','Ruta')),
  cliente       jsonb not null default '{}'::jsonb,   -- nombre, telefono, cedula, correo
  producto      text not null default '',
  cantidad      int  not null default 1,
  total         numeric(12,2) not null default 0,      -- total SIN IVA (subtotal de Cashea)
  ini_pct       numeric(5,2)  not null default 0,
  ini_monto     numeric(12,2) not null default 0,
  cuotas        jsonb not null default '{}'::jsonb,
  entrega       jsonb not null default '{}'::jsonb,   -- ciudad, metodo, detalle, guia, rutero
  pago          jsonb,                                -- banco, telefono, referencia, fecha, destino
  tag           text not null default '',
  mix           boolean not null default false,
  tomado_por    uuid references public.perfiles(id),
  tomado_nombre text,
  ajuste        jsonb not null default '{}'::jsonb,   -- motivo, origen, solicitado_at, alternativas, respuesta, producto_original
  tienda        text,
  fotos         jsonb not null default '{}'::jsonb,   -- slot → ruta en el bucket privado "despacho"
  correo_id     bigint
);
create index if not exists pedidos_st_idx       on public.pedidos (st);
create index if not exists pedidos_cola_idx     on public.pedidos (dept, st, created_at);
create index if not exists pedidos_creado_idx   on public.pedidos (created_at desc);
create index if not exists pedidos_cedula_idx   on public.pedidos ((cliente->>'cedula'));
create index if not exists pedidos_actualizado_idx on public.pedidos (updated_at desc);
create unique index if not exists pedidos_un_tomado_idx on public.pedidos (tomado_por) where st = 'tomado';
-- Búsquedas por parte de la cédula, el nombre o el número (Tiendas y Supervisión)
create extension if not exists pg_trgm with schema extensions;
create index if not exists pedidos_cedula_trgm  on public.pedidos using gin ((cliente->>'cedula') extensions.gin_trgm_ops);
create index if not exists pedidos_nombre_trgm  on public.pedidos using gin ((cliente->>'nombre') extensions.gin_trgm_ops);
create index if not exists pedidos_code_trgm    on public.pedidos using gin (code extensions.gin_trgm_ops);

-- Enlace secreto del cliente. Ningún usuario lo lee directo: solo las funciones del servidor.
create table if not exists public.pedidos_token (
  code   text primary key references public.pedidos(code) on delete cascade,
  token  text not null unique default replace(gen_random_uuid()::text, '-', '')
);
-- Migración: versiones anteriores guardaban el token dentro de pedidos
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pedidos' and column_name = 'token') then
    execute 'insert into public.pedidos_token (code, token) select code, token from public.pedidos on conflict do nothing';
    execute 'alter table public.pedidos drop column token';
  end if;
end $$;

create table if not exists public.eventos (
  id          bigserial primary key,
  code        text not null references public.pedidos(code) on delete cascade,
  t           timestamptz not null default now(),
  e           text not null,
  por         uuid,
  por_nombre  text not null default 'Sistema'
);
create index if not exists eventos_code_idx on public.eventos (code, t);
create index if not exists eventos_t_idx on public.eventos (t);

create table if not exists public.referencias (
  banco       text not null,
  referencia  text not null,
  code        text not null references public.pedidos(code) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (banco, referencia)
);
create index if not exists referencias_ref_idx on public.referencias (referencia);

create table if not exists public.correos (
  id           bigserial primary key,
  recibido_at  timestamptz not null default now(),
  mensaje_id   text unique,
  remitente    text,
  asunto       text,
  texto        text not null,
  estado       text not null default 'nuevo' check (estado in ('nuevo','ok','duplicado','revisar','ignorado')),
  code         text,
  detalle      text
);
create index if not exists correos_estado_idx on public.correos (estado, recibido_at desc);

create table if not exists public.mensajes (
  id               bigserial primary key,
  code             text references public.pedidos(code) on delete cascade,
  tipo             text not null check (tipo in ('enlace','lecheria','alternativas','despachado','retraso','alerta')),
  para             text,          -- solo alertas: teléfono destino
  texto            text,          -- solo alertas: texto listo
  estado           text not null default 'pendiente' check (estado in ('pendiente','enviando','enviado','error','omitido')),
  intentos         int not null default 0,
  detalle          text,
  uuid_callbell    text,
  created_at       timestamptz not null default now(),
  actualizado_at   timestamptz not null default now(),
  proximo_intento  timestamptz not null default now()
);
create index if not exists mensajes_cola_idx on public.mensajes (estado, proximo_intento);
create index if not exists mensajes_code_idx on public.mensajes (code);

create table if not exists public.alertas (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  tipo        text not null,
  texto       text not null,
  clave       text unique,        -- evita repetir la misma alerta
  resuelta    boolean not null default false
);

create table if not exists public.productos_estado (
  producto     text primary key,
  apagado      boolean not null default false,
  por_nombre   text,
  cambiado_at  timestamptz not null default now()
);

-- -------------------------------------------------------------- utilidades ---

-- ¿La llamada viene del servidor (funciones Edge con la clave secreta)?
create or replace function public.es_servicio() returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('role', true), '') = 'service_role'
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      -- el SQL Editor de Supabase (administrador de la base de datos)
      or (coalesce(current_setting('role', true), 'none') = 'none' and session_user in ('postgres', 'supabase_admin'))
$$;

create or replace function public.mi_perfil() returns public.perfiles
language sql stable security definer set search_path = public as $$
  select * from public.perfiles where id = auth.uid() and activo
$$;

create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select rol from public.perfiles where id = auth.uid() and activo), '')
$$;

create or replace function public.es_personal() returns boolean
language sql stable security definer set search_path = public as $$
  select public.mi_rol() <> ''
$$;

-- El supervisor puede hacer todo lo que hace cualquier rol
create or replace function public.tiene_rol(variadic roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mi_rol() = 'supervisor' or public.mi_rol() = any(roles)
$$;

create or replace function public.fallar(msg text) returns void
language plpgsql as $$ begin raise exception using message = msg, errcode = 'P0001'; end $$;

create or replace function public.registrar(p_code text, p_e text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.perfiles := public.mi_perfil();
begin
  insert into public.eventos (code, e, por, por_nombre)
  values (p_code, p_e, v.id, coalesce(v.nombre, case when public.es_servicio() then 'Sistema' else 'Cliente' end));
end $$;

create or replace function public.tocar_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists pedidos_updated_at on public.pedidos;
create trigger pedidos_updated_at before update on public.pedidos
for each row execute function public.tocar_updated_at();

-- Bancos aceptados en el pago móvil (la misma lista que ve el cliente)
create or replace function public.banco_valido(p text) returns boolean
language sql immutable as $$
  select p in ('Banco de Venezuela','Banesco','Mercantil','Provincial','BNC','Bancamiga','Banco del Tesoro','Bicentenario',
               'BFC Banco Fondo Común','Banco Plaza','Bancaribe','Banco Exterior','Banplus','Banco Activo','100% Banco',
               'Sofitasa','Banco Caroní','Venezolano de Crédito','Bancrecer','Mi Banco','Otro')
$$;
-- Referencia comparable: solo dígitos y sin ceros a la izquierda (004598 = 4598)
create or replace function public.ref_norm(p text) returns text
language sql immutable as $$
  select coalesce(nullif(ltrim(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '0'), ''), '0')
$$;

-- Departamento según el método de entrega
create or replace function public.dept_de(p_metodo text) returns text
language sql immutable as $$
  select case
    when p_metodo = 'Delivery' then 'Delivery'
    when p_metodo like 'Pickup%' then 'Pickup'
    when p_metodo = 'MRW' then 'MRW'
    when p_metodo = 'Ruta foránea' then 'Ruta'
  end
$$;

-- Reglas de entrega por ciudad (las mismas que ve el cliente)
create or replace function public.metodo_permitido(p_ciudad text, p_metodo text) returns boolean
language sql immutable as $$
  select case
    when p_ciudad = 'Caracas' then p_metodo in ('Delivery', 'Pickup · Tienda Chacao')
    when p_ciudad in ('Valencia','Los Teques','La Guaira','Guarenas','Guatire','San Antonio de los Altos')
      then p_metodo in ('Ruta foránea', 'MRW', 'Pickup · Tienda Chacao')
    when coalesce(p_ciudad, '') <> '' then p_metodo in ('MRW', 'Pickup · Tienda Chacao')
    else false
  end
$$;

-- --------------------------------------------------------- avisos (cola) ---

-- Cada cambio de estado que el cliente debe saber deja un WhatsApp en la cola
create or replace function public.encolar_avisos() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tipo text;
begin
  if tg_op = 'INSERT' then
    if new.st = 'cliente' then v_tipo := 'enlace'; end if;
  elsif new.st is distinct from old.st then
    v_tipo := case
      when new.st = 'cliente' then 'enlace'
      when new.st = 'traslado' and coalesce(new.ajuste ->> 'origen', '') = 'Lechería' then 'lecheria'
      when new.st = 'espera' then 'alternativas'
      when new.st = 'despachado' then 'despachado'
    end;
  end if;
  if v_tipo is not null then
    insert into public.mensajes (code, tipo) values (new.code, v_tipo);
  end if;
  return new;
end $$;
drop trigger if exists pedidos_avisos on public.pedidos;
create trigger pedidos_avisos after insert or update on public.pedidos
for each row execute function public.encolar_avisos();

-- ---------------------------------------------------- ingreso de correos ---

-- Crea un pedido leído de un correo. Lo usa la función recibir-correo
-- (servidor) y también el operador cuando carga un correo a mano.
create or replace function public.ingresar_pedido(p jsonb, p_correo_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := regexp_replace(coalesce(p ->> 'code', ''), '\D', '', 'g');
  v_mix  boolean := coalesce((p ->> 'mix')::boolean, false);
  v_row  public.pedidos;
begin
  if not (public.es_servicio() or public.tiene_rol('operador')) then
    perform public.fallar('No tienes permiso para crear pedidos.');
  end if;
  if v_code = '' then perform public.fallar('El correo no trae código de identificación.'); end if;
  if coalesce(p ->> 'producto', '') = '' then perform public.fallar('El correo no trae el producto.'); end if;
  if coalesce((p ->> 'total')::numeric, 0) <= 0 then perform public.fallar('El correo no trae el total.'); end if;
  if coalesce(p #>> '{cliente,telefono}', '') = '' then perform public.fallar('El correo no trae el teléfono del cliente.'); end if;

  insert into public.pedidos (code, st, cliente, producto, cantidad, total, ini_pct, ini_monto, cuotas, tag, mix, correo_id)
  values (
    v_code,
    case when v_mix then 'standby' else 'cliente' end,
    coalesce(p -> 'cliente', '{}'::jsonb),
    p ->> 'producto',
    greatest(coalesce((p ->> 'cantidad')::int, 1), 1),
    (p ->> 'total')::numeric,
    coalesce((p ->> 'ini_pct')::numeric, 0),
    coalesce((p ->> 'ini_monto')::numeric, 0),
    coalesce(p -> 'cuotas', '{}'::jsonb),
    case when v_mix then 'MIX · para un asesor' when coalesce(p ->> 'iva_nota', '') <> '' then p ->> 'iva_nota' else '' end,
    v_mix,
    p_correo_id
  )
  on conflict (code) do nothing
  returning * into v_row;

  if v_row.code is null then
    select * into v_row from public.pedidos where code = v_code;
    if right(regexp_replace(coalesce(v_row.cliente ->> 'telefono', ''), '\D', '', 'g'), 10) <> right(regexp_replace(coalesce(p #>> '{cliente,telefono}', ''), '\D', '', 'g'), 10)
       or regexp_replace(coalesce(v_row.cliente ->> 'cedula', ''), '\D', '', 'g') <> regexp_replace(coalesce(p #>> '{cliente,cedula}', ''), '\D', '', 'g') then
      insert into public.alertas (tipo, texto, clave)
      values ('conflicto', 'Llegó otro correo del pedido #' || v_code || ' con datos de cliente distintos. Confirma en el portal de Cashea cuál es el verdadero.', 'conflicto ' || v_code)
      on conflict (clave) do nothing;
      perform public.registrar(v_code, 'Alerta: llegó otro correo de este pedido con datos de cliente distintos');
      return jsonb_build_object('estado', 'conflicto', 'code', v_code);
    end if;
    return jsonb_build_object('estado', 'duplicado', 'code', v_code);
  end if;
  insert into public.pedidos_token (code) values (v_code);
  perform public.registrar(v_code, 'Correo de Cashea leído' || case when v_mix then ' · venta MIX a Stand-by' else '' end);
  return jsonb_build_object('estado', 'creado', 'code', v_code, 'st', v_row.st);
end $$;

-- ------------------------------------------------------------- cajas ------

-- Entrega al cajero el pedido más antiguo de su caja. Dos cajeros nunca
-- reciben el mismo, y cada cajero atiende uno a la vez.
create or replace function public.tomar_siguiente(p_dept text)
returns public.pedidos language plpgsql security definer set search_path = public as $$
declare
  v public.perfiles := public.mi_perfil();
  r public.pedidos;
begin
  if v.id is null then perform public.fallar('Tu usuario no está activo.'); end if;
  if not (v.rol = 'supervisor' or (v.rol = 'cajero' and v.dept = p_dept)) then
    perform public.fallar('Esta no es tu caja.');
  end if;
  perform pg_advisory_xact_lock(hashtext('tomar:' || v.id::text));   -- dos clics a la vez no toman dos pedidos
  select * into r from public.pedidos where st = 'tomado' and tomado_por = v.id limit 1;
  if found then return r; end if;
  select * into r from public.pedidos
   where st = 'caja' and dept = p_dept
   order by created_at
   for update skip locked limit 1;
  if not found then return null; end if;
  update public.pedidos set st = 'tomado', tomado_por = v.id, tomado_nombre = v.nombre
   where code = r.code returning * into r;
  perform public.registrar(r.code, 'Tomado en Caja ' || p_dept);
  return r;
end $$;

-- ¿Referencia libre? ok | duplicada (mismo banco, otro pedido) | otro_banco
create or replace function public.estado_referencia(p_banco text, p_ref text, p_code text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.referencias where banco = p_banco and referencia = public.ref_norm(p_ref) and code <> p_code) then 'duplicada'
    when exists (select 1 from public.referencias where referencia = public.ref_norm(p_ref) and banco <> p_banco and code <> p_code) then 'otro_banco'
    else 'ok'
  end
$$;

-- ------------------------------------------------- acciones del personal ---

-- Todas las acciones del panel pasan por aquí: valida rol y estado,
-- aplica el cambio y deja el evento en el historial.
create or replace function public.accion(p_code text, p_accion text, p_datos jsonb default '{}'::jsonb)
returns public.pedidos language plpgsql security definer set search_path = public as $$
declare
  v    public.perfiles := public.mi_perfil();
  o    public.pedidos;
  sup  boolean;
  e    text;
  txt  text;
  arr  jsonb;
  ref  text;
  est  text := 'ok';
begin
  if v.id is null then perform public.fallar('Tu usuario no está activo.'); end if;
  sup := v.rol = 'supervisor';
  select * into o from public.pedidos where code = p_code for update;
  if not found then perform public.fallar('No encontré el pedido #' || p_code || '.'); end if;

  case p_accion

  -- ── caja ──
  when 'facturar', 'noval', 'soltar', 'sinstock', 'version' then
    if o.st <> 'tomado' then perform public.fallar('Este pedido ya no está en tu caja.'); end if;
    if not (sup or (v.rol = 'cajero' and o.tomado_por = v.id)) then perform public.fallar('Este pedido lo atiende ' || coalesce(o.tomado_nombre, 'otra persona') || '.'); end if;
    if p_accion = 'facturar' then
      update public.pedidos set st = 'despacho' where code = p_code;
      e := 'Facturado en Profit' || case when o.pago is not null and o.tag <> 'Pago aprobado por Administración' then ' · pago verificado en BNC' else '' end;
    elsif p_accion = 'noval' then
      update public.pedidos set st = 'noval', tomado_por = null, tomado_nombre = null where code = p_code;
      e := 'Caja: no pude validar el pago';
    elsif p_accion = 'soltar' then
      update public.pedidos set st = 'caja', tomado_por = null, tomado_nombre = null where code = p_code;
      e := 'Devuelto a la cola';
    else
      txt := case when p_accion = 'sinstock' then 'Sin stock' else 'Otra versión' end;
      update public.pedidos set st = 'ajuste', tomado_por = null, tomado_nombre = null,
        ajuste = o.ajuste || jsonb_build_object('motivo', txt, 'solicitado_at', now(), 'producto_original', o.producto)
       where code = p_code;
      e := 'Caja: ' || lower(txt);
    end if;

  when 'traslado' then
    txt := trim(coalesce(p_datos ->> 'origen', ''));
    if txt = '' then perform public.fallar('Indica la tienda de origen.'); end if;
    if o.st = 'tomado' then
      if not (sup or (v.rol = 'cajero' and o.tomado_por = v.id)) then perform public.fallar('Este pedido lo atiende otra persona.'); end if;
    elsif o.st = 'ajuste' then
      if not public.tiene_rol('ajuste') then perform public.fallar('Solo Ajuste puede pedir este traslado.'); end if;
    else
      perform public.fallar('Este pedido no se puede trasladar ahora.');
    end if;
    update public.pedidos set st = 'traslado', tomado_por = null, tomado_nombre = null,
      ajuste = (o.ajuste || jsonb_build_object('motivo', coalesce(o.ajuste ->> 'motivo', 'Otra tienda'), 'origen', txt,
                                               'solicitado_at', now(), 'producto_original', coalesce(o.ajuste ->> 'producto_original', o.producto)))
               - 'respuesta' - 'retraso_avisado' - 'alternativas'
     where code = p_code;
    e := 'Traslado pedido desde ' || txt;

  -- ── ajuste ──
  when 'recibido' then
    if not public.tiene_rol('ajuste') then perform public.fallar('Solo Ajuste marca los traslados recibidos.'); end if;
    if o.st <> 'traslado' then perform public.fallar('Este pedido no está en traslado.'); end if;
    update public.pedidos set st = 'caja', tag = 'Traslado recibido' where code = p_code;
    e := 'Traslado recibido desde ' || coalesce(o.ajuste ->> 'origen', '');

  when 'alternativas' then
    if not public.tiene_rol('ajuste') then perform public.fallar('Solo Ajuste envía alternativas.'); end if;
    if o.st <> 'ajuste' then perform public.fallar('Este pedido no está en Ajuste.'); end if;
    select coalesce(jsonb_agg(to_jsonb(trim(x))), '[]'::jsonb) into arr
      from jsonb_array_elements_text(coalesce(p_datos -> 'alternativas', '[]'::jsonb)) x where trim(x) <> '';
    if jsonb_array_length(arr) = 0 then perform public.fallar('Escribe al menos una alternativa.'); end if;
    if jsonb_array_length(arr) > 5 then perform public.fallar('Ofrece como máximo 5 alternativas.'); end if;
    update public.pedidos set st = 'espera', ajuste = (o.ajuste || jsonb_build_object('alternativas', arr)) - 'respuesta' where code = p_code;
    e := 'Ajuste envió ' || jsonb_array_length(arr) || ' alternativa(s) al cliente';

  when 'cancelar' then
    if not public.tiene_rol('ajuste', 'asesor', 'admin') then perform public.fallar('No tienes permiso para cancelar pedidos.'); end if;
    if o.st not in ('cliente', 'standby', 'noval', 'admin', 'ajuste', 'espera', 'traslado') then
      perform public.fallar('Este pedido ya no se puede cancelar desde aquí.');
    end if;
    update public.pedidos set st = 'cancelado', tomado_por = null, tomado_nombre = null where code = p_code;
    e := 'Pedido cancelado' || coalesce(' · ' || nullif(trim(p_datos ->> 'motivo'), ''), '');

  -- ── asesores ──
  when 'corregir' then
    if not public.tiene_rol('asesor') then perform public.fallar('Solo los asesores corrigen pagos.'); end if;
    if o.st <> 'noval' then perform public.fallar('Este pedido no está en pagos no validados.'); end if;
    ref := regexp_replace(coalesce(p_datos ->> 'referencia', ''), '\D', '', 'g');
    if ref <> '' then
      if length(ref) < 6 then perform public.fallar('La referencia debe tener al menos 6 dígitos.'); end if;
      est := public.estado_referencia(coalesce(o.pago ->> 'banco', ''), ref, p_code);
      if est = 'duplicada' then perform public.fallar('Esa referencia ya está registrada en otro pedido.'); end if;
      delete from public.referencias where code = p_code;
      insert into public.referencias (banco, referencia, code) values (coalesce(o.pago ->> 'banco', ''), public.ref_norm(ref), p_code)
      on conflict (banco, referencia) do nothing;
      if not exists (select 1 from public.referencias where banco = coalesce(o.pago ->> 'banco', '') and referencia = public.ref_norm(ref) and code = p_code) then
        perform public.fallar('Esa referencia ya está registrada en otro pedido.');
      end if;
    end if;
    update public.pedidos set st = 'caja',
      pago = coalesce(o.pago, '{}'::jsonb) || case when ref <> '' then jsonb_build_object('referencia', ref) else '{}'::jsonb end,
      tag = case when est = 'otro_banco' then 'Referencia repetida en otro banco: revisar con cuidado' else 'Datos corregidos por asesor' end
     where code = p_code;
    e := 'Asesor corrigió los datos del pago' || case when ref <> '' then ' (ref. ' || ref || ')' else '' end;

  when 'a_admin' then
    if not public.tiene_rol('asesor') then perform public.fallar('Solo los asesores envían a Administración.'); end if;
    if o.st <> 'noval' then perform public.fallar('Este pedido no está en pagos no validados.'); end if;
    txt := coalesce(p_datos ->> 'tipo', '');
    if txt not in ('Aliado Cashea', 'Transferencia') then perform public.fallar('Tipo de validación no válido.'); end if;
    update public.pedidos set st = 'admin', tag = txt,
      pago = coalesce(o.pago, '{}'::jsonb) || case when coalesce(trim(p_datos ->> 'destino'), '') <> '' then jsonb_build_object('destino', trim(p_datos ->> 'destino')) else '{}'::jsonb end
     where code = p_code;
    e := 'Asesor lo envió a Administración (' || txt || ')';

  when 'mix_listo' then
    if not public.tiene_rol('asesor') then perform public.fallar('Solo los asesores atienden Stand-by.'); end if;
    if o.st <> 'standby' then perform public.fallar('Este pedido no está en Stand-by.'); end if;
    update public.pedidos set st = 'cliente', tag = 'Revisado por asesor' where code = p_code;
    e := 'Asesor lo revisó y se le envió el enlace al cliente';

  when 'telefono' then
    if not public.tiene_rol('asesor', 'operador') then perform public.fallar('No tienes permiso para cambiar el teléfono.'); end if;
    if o.st not in ('cliente', 'standby', 'noval') then perform public.fallar('El teléfono solo se cambia antes de facturar.'); end if;
    txt := trim(coalesce(p_datos ->> 'telefono', ''));
    if length(regexp_replace(txt, '\D', '', 'g')) < 10 then perform public.fallar('Escribe un teléfono válido.'); end if;
    update public.pedidos set cliente = o.cliente || jsonb_build_object('telefono', txt) where code = p_code;
    e := 'Teléfono del cliente actualizado';

  -- ── administración ──
  when 'aprobar', 'rechazar' then
    if not public.tiene_rol('admin') then perform public.fallar('Solo Administración valida estos pagos.'); end if;
    if o.st <> 'admin' then perform public.fallar('Este pedido no está en Administración.'); end if;
    if p_accion = 'aprobar' then
      update public.pedidos set st = 'caja', tag = 'Pago aprobado por Administración' where code = p_code;
      e := 'Administración aprobó el pago';
    else
      update public.pedidos set st = 'noval', tag = 'Rechazado por Administración' where code = p_code;
      e := 'Administración rechazó el pago' || coalesce(' · ' || nullif(trim(p_datos ->> 'motivo'), ''), '');
    end if;

  -- ── despacho ──
  when 'foto' then
    if not public.tiene_rol('despacho') then perform public.fallar('Solo Despacho sube fotos.'); end if;
    if o.st <> 'despacho' then perform public.fallar('Este pedido no está en Despacho.'); end if;
    txt := coalesce(p_datos ->> 'slot', '');
    if txt not in ('factura', 'equipo', 'empaque', 'entrega') then perform public.fallar('Tipo de foto no válido.'); end if;
    if coalesce(p_datos ->> 'ruta', '') !~ ('^' || p_code || '/' || txt || '-[0-9]+\.jpg$') then perform public.fallar('Ruta de foto no válida.'); end if;
    if not exists (select 1 from storage.objects where bucket_id = 'despacho' and name = p_datos ->> 'ruta') then
      perform public.fallar('La foto no terminó de subir. Tómala de nuevo.');
    end if;
    update public.pedidos set fotos = o.fotos || jsonb_build_object(txt, p_datos ->> 'ruta') where code = p_code;
    e := 'Foto de ' || txt || ' guardada';

  when 'despachar' then
    if not public.tiene_rol('despacho') then perform public.fallar('Solo Despacho marca despachado.'); end if;
    if o.st <> 'despacho' then perform public.fallar('Este pedido no está en Despacho.'); end if;
    if not (o.fotos ? 'factura' and o.fotos ? 'equipo') then perform public.fallar('Faltan las fotos obligatorias: factura y equipo.'); end if;
    if o.dept = 'MRW' and coalesce(trim(p_datos ->> 'guia'), '') = '' then perform public.fallar('Escribe el número de guía de MRW.'); end if;
    update public.pedidos set st = 'despachado',
      entrega = o.entrega || jsonb_strip_nulls(jsonb_build_object('guia', nullif(trim(p_datos ->> 'guia'), ''), 'rutero', nullif(trim(p_datos ->> 'rutero'), '')))
     where code = p_code;
    e := 'Despachado con ' || (select count(*) from jsonb_object_keys(o.fotos)) || ' fotos'
         || coalesce(' · guía ' || nullif(trim(p_datos ->> 'guia'), ''), '') || coalesce(' · ' || nullif(trim(p_datos ->> 'rutero'), ''), '');

  -- ── tiendas ──
  when 'pasar_tienda' then
    if not (v.rol = 'tienda' or sup) then perform public.fallar('Solo las tiendas pueden tomar pedidos.'); end if;
    txt := coalesce(nullif(v.tienda, ''), p_datos ->> 'tienda');
    if coalesce(txt, '') = '' then perform public.fallar('Tu usuario no tiene tienda asignada.'); end if;
    if o.st not in ('cliente', 'caja', 'ajuste', 'traslado', 'espera') then
      perform public.fallar(case when o.st = 'tomado' then o.tomado_nombre || ' lo está atendiendo en caja.' else 'Este pedido ya no se puede pasar a una tienda.' end);
    end if;
    update public.pedidos set st = 'tienda', tienda = txt, tomado_por = null, tomado_nombre = null where code = p_code;
    e := 'Pasado a SoyTechno ' || txt || coalesce(' (sale de Caja ' || o.dept || ')', '');

  when 'entregar' then
    if not (v.rol = 'tienda' or sup) then perform public.fallar('Solo las tiendas entregan.'); end if;
    if o.st <> 'tienda' then perform public.fallar('Este pedido no está en una tienda.'); end if;
    if v.rol = 'tienda' and o.tienda is distinct from v.tienda then perform public.fallar('Este pedido está en SoyTechno ' || o.tienda || '.'); end if;
    update public.pedidos set st = 'entregado' where code = p_code;
    e := 'Facturado y entregado en SoyTechno ' || coalesce(o.tienda, '');

  -- ── supervisión ──
  when 'liberar' then
    if not sup then perform public.fallar('Solo Supervisión puede liberar pedidos.'); end if;
    if o.st <> 'tomado' then perform public.fallar('Este pedido no está tomado.'); end if;
    update public.pedidos set st = 'caja', tomado_por = null, tomado_nombre = null where code = p_code;
    e := 'Liberado por Supervisión (lo tenía ' || coalesce(o.tomado_nombre, '') || ')';

  else
    perform public.fallar('Acción no válida.');
  end case;

  perform public.registrar(p_code, e);
  select * into o from public.pedidos where code = p_code;
  return o;
end $$;

-- Volver a enviar un WhatsApp al cliente
create or replace function public.reenviar_aviso(p_code text, p_tipo text default 'enlace') returns void
language plpgsql security definer set search_path = public as $$
declare o public.pedidos;
begin
  if not public.tiene_rol('operador', 'asesor', 'ajuste') then perform public.fallar('No tienes permiso para reenviar avisos.'); end if;
  select * into o from public.pedidos where code = p_code;
  if not found then perform public.fallar('No encontré el pedido.'); end if;
  if not (   (p_tipo = 'enlace' and o.st = 'cliente')
          or (p_tipo = 'lecheria' and o.st = 'traslado' and o.ajuste ->> 'origen' = 'Lechería')
          or (p_tipo = 'alternativas' and o.st = 'espera')
          or (p_tipo = 'despachado' and o.st = 'despachado')) then
    perform public.fallar('Ese aviso no corresponde al estado actual del pedido.');
  end if;
  if (select count(*) from public.eventos where code = p_code and e like 'WhatsApp reenviado%' and t > now() - interval '24 hours') >= 3 then
    perform public.fallar('Ya se reenvió 3 veces hoy. Escríbele al cliente desde Callbell.');
  end if;
  insert into public.mensajes (code, tipo) values (p_code, p_tipo);
  perform public.registrar(p_code, 'WhatsApp reenviado (' || p_tipo || ')');
end $$;

-- Enlace del cliente, solo para los roles que atienden clientes
create or replace function public.enlace_cliente(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not public.tiene_rol('operador', 'asesor', 'ajuste') then perform public.fallar('No tienes permiso para ver el enlace del cliente.'); end if;
  select token into v from public.pedidos_token where code = p_code;
  return v;
end $$;

-- Productos a apagar en Cashea
create or replace function public.marcar_producto(p_producto text, p_apagado boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v public.perfiles := public.mi_perfil();
begin
  if not public.tiene_rol('operador', 'ajuste') then perform public.fallar('No tienes permiso.'); end if;
  insert into public.productos_estado (producto, apagado, por_nombre, cambiado_at)
  values (p_producto, p_apagado, v.nombre, now())
  on conflict (producto) do update set apagado = excluded.apagado, por_nombre = excluded.por_nombre, cambiado_at = now();
end $$;

create or replace function public.ranking_agotados(p_dias int default 30)
returns table (producto text, agotado bigint, lecheria bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(ajuste ->> 'producto_original', p.producto) as producto,
         count(*) filter (where ajuste ->> 'motivo' in ('Sin stock', 'Otra versión')) as agotado,
         count(*) filter (where ajuste ->> 'origen' = 'Lechería') as lecheria
    from public.pedidos p
   where public.es_personal()
     and created_at > now() - make_interval(days => greatest(p_dias, 1))
     and (ajuste ? 'motivo' or ajuste ? 'origen')
   group by 1
  having count(*) filter (where ajuste ->> 'motivo' in ('Sin stock', 'Otra versión') or ajuste ->> 'origen' = 'Lechería') > 0
   order by 2 + 3 desc, 1
$$;

-- Resumen del día para Supervisión (hora de Venezuela)
create or replace function public.resumen_hoy() returns jsonb
language sql stable security definer set search_path = public as $$
  with hoy as (select (date_trunc('day', now() at time zone 'America/Caracas') at time zone 'America/Caracas') as desde)
  select case when not public.es_personal() then null else jsonb_build_object(
    'recibidos',   (select count(*) from public.pedidos, hoy where created_at >= hoy.desde),
    'facturados',  (select count(distinct code) from public.eventos, hoy where t >= hoy.desde and e like 'Facturado en Profit%'),
    'despachados', (select count(distinct code) from public.eventos, hoy where t >= hoy.desde and e like 'Despachado%'),
    'whatsapp_ok', (select count(*) from public.mensajes, hoy where actualizado_at >= hoy.desde and estado = 'enviado'),
    'whatsapp_error', (select count(*) from public.mensajes, hoy where actualizado_at >= hoy.desde and estado = 'error'),
    'correos_revisar', (select count(*) from public.correos where estado = 'revisar'),
    'por_caja', (select coalesce(jsonb_object_agg(d, jsonb_build_object(
         'cola', (select count(*) from public.pedidos where dept = d and st = 'caja'),
         'atendiendo', (select count(*) from public.pedidos where dept = d and st = 'tomado'),
         'facturados', (select count(distinct ev.code) from public.eventos ev join public.pedidos pp on pp.code = ev.code, hoy
                         where pp.dept = d and ev.t >= hoy.desde and ev.e like 'Facturado en Profit%'))), '{}'::jsonb)
       from unnest(array['Delivery','Pickup','MRW','Ruta']) d)
  ) end
$$;

-- ----------------------------------------------------------- cliente ------

-- Lo que ve el cliente con su enlace secreto. Sin cédula, teléfono ni pago.
create or replace function public.cliente_ver(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', code, 'st', st, 'producto', producto, 'cantidad', cantidad,
    'ini_pct', ini_pct, 'ini_monto', ini_monto, 'cuotas', cuotas ->> 'n',
    'nombre', initcap(split_part(regexp_replace(coalesce(cliente ->> 'nombre', ''), '\(.*?\)', '', 'g'), ' ', 1)),
    'entrega', entrega, 'tienda', tienda, 'pago_reportado', pago is not null,
    'ajuste', jsonb_strip_nulls(jsonb_build_object(
       'motivo', ajuste ->> 'motivo', 'origen', ajuste ->> 'origen', 'solicitado_at', ajuste ->> 'solicitado_at',
       'alternativas', ajuste -> 'alternativas', 'respuesta', ajuste ->> 'respuesta'))
  )
  from public.pedidos where code = (select t.code from public.pedidos_token t where t.token = p_token and length(p_token) >= 24)
$$;

-- El cliente elige su entrega y reporta su pago móvil
create or replace function public.cliente_enviar(p_token text, p_entrega jsonb, p_pago jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  o      public.pedidos;
  v_met  text := coalesce(p_entrega ->> 'metodo', '');
  v_ciu  text := coalesce(p_entrega ->> 'ciudad', '');
  v_det  text := left(trim(coalesce(p_entrega ->> 'detalle', '')), 300);
  v_ref  text := regexp_replace(coalesce(p_pago ->> 'referencia', ''), '\D', '', 'g');
  v_ban  text := left(trim(coalesce(p_pago ->> 'banco', '')), 60);
  v_fec  date;
  v_est  text := 'ok';
begin
  select * into o from public.pedidos where code = (select t.code from public.pedidos_token t where t.token = p_token and length(p_token) >= 24) for update;
  if not found then return 'no_existe'; end if;
  if o.st <> 'cliente' then return 'ya_enviado'; end if;
  if not public.metodo_permitido(v_ciu, v_met) then return 'metodo_invalido'; end if;
  if v_met = 'MRW' and v_det = '' then return 'falta_oficina'; end if;
  if v_met = 'Delivery' and length(v_det) < 8 then return 'falta_direccion'; end if;

  if o.ini_pct > 0 then
    if not public.banco_valido(v_ban) or length(v_ref) < 6 or length(v_ref) > 20 then return 'pago_incompleto'; end if;
    if length(regexp_replace(coalesce(p_pago ->> 'telefono', ''), '\D', '', 'g')) < 10 then return 'pago_incompleto'; end if;
    begin v_fec := (p_pago ->> 'fecha')::date; exception when others then return 'pago_incompleto'; end;
    if v_fec is null or v_fec > (now() at time zone 'America/Caracas')::date or v_fec < (now() at time zone 'America/Caracas')::date - 7 then
      return 'fecha_invalida';
    end if;
    v_est := public.estado_referencia(v_ban, v_ref, o.code);
    if v_est = 'duplicada' then return 'duplicada'; end if;
    delete from public.referencias where code = o.code;
    -- Si otro cliente registra la misma referencia en el mismo instante, gana el primero
    insert into public.referencias (banco, referencia, code) values (v_ban, public.ref_norm(v_ref), o.code)
    on conflict (banco, referencia) do nothing;
    if not exists (select 1 from public.referencias where banco = v_ban and referencia = public.ref_norm(v_ref) and code = o.code) then
      return 'duplicada';
    end if;
  end if;

  update public.pedidos set
    st = 'caja', dept = public.dept_de(v_met),
    entrega = jsonb_build_object('ciudad', v_ciu, 'metodo', v_met, 'detalle', v_det),
    pago = case when o.ini_pct > 0 then jsonb_build_object('banco', v_ban, 'telefono', left(trim(p_pago ->> 'telefono'), 20),
                                                          'referencia', v_ref, 'fecha', v_fec) else null end,
    tag = case when v_est = 'otro_banco' then 'Referencia repetida en otro banco: revisar con cuidado' else o.tag end
  where code = o.code;
  perform public.registrar(o.code, 'El cliente eligió ' || v_met || case when o.ini_pct > 0 then ' y reportó su pago' else '' end);
  return 'ok';
end $$;

-- Respuestas del cliente: alternativas de Ajuste o espera de Lechería
create or replace function public.cliente_responder(p_token text, p_tipo text, p_valor text)
returns text language plpgsql security definer set search_path = public as $$
declare o public.pedidos; v_alt text;
begin
  select * into o from public.pedidos where code = (select t.code from public.pedidos_token t where t.token = p_token and length(p_token) >= 24) for update;
  if not found then return 'no_existe'; end if;

  if p_tipo = 'alternativa' then
    if o.st <> 'espera' then return 'ya_respondido'; end if;
    if p_valor = 'cancelar' then
      update public.pedidos set st = 'cancelado', ajuste = o.ajuste || '{"respuesta":"Cancelar"}' where code = o.code;
      perform public.registrar(o.code, 'El cliente canceló el pedido');
      return 'ok';
    end if;
    v_alt := o.ajuste -> 'alternativas' ->> (case when p_valor ~ '^\d{1,2}$' then p_valor::int end);
    if v_alt is null then return 'opcion_invalida'; end if;
    update public.pedidos set st = 'caja', producto = v_alt, tag = 'El cliente eligió otra opción',
      ajuste = o.ajuste || jsonb_build_object('respuesta', v_alt, 'producto_original', coalesce(o.ajuste ->> 'producto_original', o.producto))
     where code = o.code;
    perform public.registrar(o.code, 'El cliente eligió: ' || v_alt);
    return 'ok';

  elsif p_tipo = 'lecheria' then
    if o.st <> 'traslado' or coalesce(o.ajuste ->> 'origen', '') <> 'Lechería' or o.ajuste ? 'respuesta' then return 'ya_respondido'; end if;
    if p_valor = 'esperar' then
      update public.pedidos set ajuste = o.ajuste || '{"respuesta":"Esperar"}' where code = o.code;
      perform public.registrar(o.code, 'El cliente decidió esperar el traslado');
    elsif p_valor = 'otro' then
      update public.pedidos set st = 'standby', tag = 'Cliente quiere otro modelo', ajuste = o.ajuste || '{"respuesta":"Otro modelo"}' where code = o.code;
      perform public.registrar(o.code, 'El cliente pidió otro modelo');
    elsif p_valor = 'cancelar' then
      update public.pedidos set st = 'cancelado', ajuste = o.ajuste || '{"respuesta":"Cancelar"}' where code = o.code;
      perform public.registrar(o.code, 'El cliente canceló el pedido');
    else
      return 'opcion_invalida';
    end if;
    return 'ok';
  end if;
  return 'opcion_invalida';
end $$;

-- ------------------------------------------- cola de WhatsApp (servidor) ---

-- Entrega a la función procesar-mensajes los avisos pendientes, con los datos
-- del pedido necesarios para redactarlos.
create or replace function public.tomar_mensajes(p_n int default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.es_servicio() then perform public.fallar('Solo el servidor procesa mensajes.'); end if;
  update public.mensajes set estado = 'pendiente', actualizado_at = now()
   where estado = 'enviando' and actualizado_at < now() - interval '5 minutes';
  with sel as (
    select id from public.mensajes
     where estado = 'pendiente' and proximo_intento <= now()
     order by id for update skip locked limit greatest(p_n, 1)
  ), upd as (
    update public.mensajes m set estado = 'enviando', intentos = intentos + 1, actualizado_at = now()
      from sel where m.id = sel.id returning m.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'tipo', u.tipo, 'para', u.para, 'texto', u.texto, 'intentos', u.intentos,
    'pedido', case when p.code is null then null else jsonb_build_object(
      'code', p.code, 'token', t.token, 'st', p.st, 'producto', p.producto, 'ini_pct', p.ini_pct, 'ini_monto', p.ini_monto,
      'cliente', p.cliente, 'entrega', p.entrega, 'ajuste', p.ajuste, 'tienda', p.tienda) end) order by u.id), '[]'::jsonb)
  into r
  from upd u left join public.pedidos p on p.code = u.code left join public.pedidos_token t on t.code = u.code;
  return r;
end $$;

create or replace function public.resultado_mensaje(p_id bigint, p_ok boolean, p_detalle text default null, p_uuid text default null, p_omitir boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare m public.mensajes;
begin
  if not public.es_servicio() then perform public.fallar('Solo el servidor procesa mensajes.'); end if;
  select * into m from public.mensajes where id = p_id;
  if not found then return; end if;
  if p_ok then
    update public.mensajes set estado = 'enviado', detalle = p_detalle, uuid_callbell = p_uuid, actualizado_at = now() where id = p_id;
    if m.code is not null then
      insert into public.eventos (code, e, por_nombre) values (m.code, 'WhatsApp enviado al cliente (' || m.tipo || ')', 'Sistema');
    end if;
  elsif p_omitir or m.intentos >= 3 then
    update public.mensajes set estado = case when p_omitir then 'omitido' else 'error' end, detalle = p_detalle, actualizado_at = now() where id = p_id;
    if m.code is not null and not p_omitir then
      insert into public.eventos (code, e, por_nombre) values (m.code, 'No se pudo enviar el WhatsApp (' || m.tipo || '): ' || coalesce(p_detalle, ''), 'Sistema');
    end if;
  else
    update public.mensajes set estado = 'pendiente', detalle = p_detalle, actualizado_at = now(),
           proximo_intento = now() + make_interval(mins => m.intentos * m.intentos) where id = p_id;
  end if;
end $$;

-- ------------------------------------------------------------- alertas ----

-- Corre cada 5 minutos (ver cron.sql). Avisa a Supervisión por el panel y
-- por WhatsApp cuando algo se detiene.
create or replace function public.revisar_alertas() returns int
language plpgsql security definer set search_path = public as $$
declare
  ahora   timestamp := now() at time zone 'America/Caracas';
  laboral boolean := extract(isodow from ahora) between 1 and 6 and extract(hour from ahora) between 8 and 19;
  n       int := 0;
  r       record;
  hora    text := to_char(ahora, 'YYYY-MM-DD HH24');
begin
  -- Solo la ejecutan el servidor y el cron (ver permisos al final)

  -- 1) No entran correos de Cashea en horario laboral
  if laboral and not exists (select 1 from public.correos where recibido_at > now() - interval '30 minutes')
     and exists (select 1 from public.correos) then
    insert into public.alertas (tipo, texto, clave)
    values ('sin_correos', 'No entra ningún correo de Cashea desde hace más de 30 minutos. Revisa el reenvío del buzón.', 'sin_correos ' || hora)
    on conflict (clave) do nothing;
    if found then n := n + 1; end if;
  end if;

  -- 2) Fallan los WhatsApp
  if (select count(*) from public.mensajes where estado = 'error' and actualizado_at > now() - interval '30 minutes') >= 5 then
    insert into public.alertas (tipo, texto, clave)
    values ('whatsapp', 'Están fallando los WhatsApp a los clientes (5 o más en 30 minutos). Revisa Callbell.', 'whatsapp ' || hora)
    on conflict (clave) do nothing;
    if found then n := n + 1; end if;
  end if;

  -- 3) Correos que el sistema no pudo leer
  if exists (select 1 from public.correos where estado = 'revisar' and recibido_at > now() - interval '1 hour') then
    insert into public.alertas (tipo, texto, clave)
    values ('correo_revisar', 'Hay correos de Cashea que el sistema no pudo leer. Revisa la Bandeja.', 'correo_revisar ' || hora)
    on conflict (clave) do nothing;
    if found then n := n + 1; end if;
  end if;

  -- 4) Traslados internos con más de 24 horas: se avisa al cliente una sola vez
  for r in select code from public.pedidos
            where st = 'traslado' and coalesce(ajuste ->> 'origen', '') <> 'Lechería'
              and (ajuste ->> 'solicitado_at')::timestamptz < now() - interval '24 hours'
              and not ajuste ? 'retraso_avisado' loop
    update public.pedidos set ajuste = ajuste || jsonb_build_object('retraso_avisado', now()) where code = r.code;
    insert into public.mensajes (code, tipo) values (r.code, 'retraso');
    insert into public.eventos (code, e, por_nombre) values (r.code, 'Traslado con más de 24 horas: se avisa al cliente', 'Sistema');
  end loop;

  -- Las alertas nuevas también van por WhatsApp a los supervisores con teléfono
  insert into public.mensajes (tipo, para, texto)
  select 'alerta', s.telefono, 'Alerta Pedidos Cashea: ' || a.texto
    from public.alertas a cross join public.perfiles s
   where a.created_at > now() - interval '1 minute' and not a.resuelta
     and s.rol = 'supervisor' and s.activo and coalesce(s.telefono, '') <> '';
  return n;
end $$;

create or replace function public.resolver_alerta(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.tiene_rol('operador') then perform public.fallar('No tienes permiso.'); end if;
  update public.alertas set resuelta = true where id = p_id;
end $$;

-- El operador cierra un correo que el sistema no pudo leer: lo cargó a mano o lo descarta
create or replace function public.resolver_correo(p_id bigint, p_estado text, p_code text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.perfiles := public.mi_perfil();
begin
  if not public.tiene_rol('operador') then perform public.fallar('No tienes permiso.'); end if;
  if p_estado not in ('ok', 'ignorado') then perform public.fallar('Estado no válido.'); end if;
  update public.correos set estado = p_estado, code = coalesce(nullif(p_code, ''), code),
         detalle = case when p_estado = 'ok' then 'Cargado a mano por ' else 'Descartado por ' end || v.nombre
   where id = p_id and estado = 'revisar';
end $$;

-- ------------------------------------------------- seguridad (RLS) -------

alter table public.perfiles         enable row level security;
alter table public.pedidos          enable row level security;
alter table public.eventos          enable row level security;
alter table public.referencias      enable row level security;
alter table public.correos          enable row level security;
alter table public.mensajes         enable row level security;
alter table public.alertas          enable row level security;
alter table public.productos_estado enable row level security;
alter table public.pedidos_token    enable row level security;

-- Nadie escribe directo en las tablas: todo pasa por las funciones de arriba.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
revoke all on public.pedidos_token from authenticated;
-- Lo que se cree en el futuro tampoco queda abierto por defecto
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

drop policy if exists perfiles_ver on public.perfiles;
create policy perfiles_ver on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or (select public.mi_rol()) = 'supervisor');

drop policy if exists pedidos_ver on public.pedidos;
create policy pedidos_ver on public.pedidos for select to authenticated using ((select public.es_personal()));

drop policy if exists eventos_ver on public.eventos;
create policy eventos_ver on public.eventos for select to authenticated using ((select public.es_personal()));

drop policy if exists referencias_ver on public.referencias;
create policy referencias_ver on public.referencias for select to authenticated using ((select public.tiene_rol('cajero', 'asesor', 'admin')));

drop policy if exists correos_ver on public.correos;
create policy correos_ver on public.correos for select to authenticated using ((select public.tiene_rol('operador')));

drop policy if exists mensajes_ver on public.mensajes;
create policy mensajes_ver on public.mensajes for select to authenticated using ((select public.es_personal()));

drop policy if exists alertas_ver on public.alertas;
create policy alertas_ver on public.alertas for select to authenticated using ((select public.tiene_rol('operador')));

drop policy if exists productos_ver on public.productos_estado;
create policy productos_ver on public.productos_estado for select to authenticated using ((select public.es_personal()));

-- Funciones: nadie las ejecuta salvo las que se habilitan aquí.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function public.es_servicio()                          to anon, authenticated;
grant execute on function public.mi_perfil()                            to authenticated;
grant execute on function public.mi_rol()                               to authenticated;
grant execute on function public.es_personal()                          to authenticated;
grant execute on function public.tiene_rol(text[])                      to authenticated;
grant execute on function public.ingresar_pedido(jsonb, bigint)         to authenticated;
grant execute on function public.tomar_siguiente(text)                  to authenticated;
grant execute on function public.accion(text, text, jsonb)              to authenticated;
grant execute on function public.reenviar_aviso(text, text)             to authenticated;
grant execute on function public.enlace_cliente(text)                   to authenticated;
grant execute on function public.marcar_producto(text, boolean)         to authenticated;
grant execute on function public.ranking_agotados(int)                  to authenticated;
grant execute on function public.resumen_hoy()                          to authenticated;
grant execute on function public.resolver_alerta(bigint)                to authenticated;
grant execute on function public.resolver_correo(bigint, text, text)    to authenticated;
grant execute on function public.cliente_ver(text)                      to anon, authenticated;
grant execute on function public.cliente_enviar(text, jsonb, jsonb)     to anon, authenticated;
grant execute on function public.cliente_responder(text, text, text)    to anon, authenticated;

-- ------------------------------------------------------- tiempo real ------
do $$ begin alter publication supabase_realtime add table public.pedidos;          exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.alertas;          exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.productos_estado; exception when duplicate_object then null; end $$;

-- ------------------------------------------- fotos de despacho (privadas) ---
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('despacho', 'despacho', false, 5242880, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

drop policy if exists despacho_subir on storage.objects;
create policy despacho_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'despacho' and (select public.tiene_rol('despacho'))
              and name ~ '^[0-9]+/(factura|equipo|empaque|entrega)-[0-9]+\.jpg$');
drop policy if exists despacho_ver on storage.objects;
create policy despacho_ver on storage.objects for select to authenticated
  using (bucket_id = 'despacho' and (select public.es_personal()));

notify pgrst, 'reload schema';
