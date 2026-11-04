-- Soytechno · Pedidos Cashea (DEMO)
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.
-- AVISO: es una demo sin usuarios ni contraseñas. Usar solo datos de prueba.

create table if not exists public.pedidos (
  code        text primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  st          text not null default 'cliente',   -- cliente | standby | caja | tomado | noval | admin | despacho | despachado
  dept        text,                               -- Delivery | Pickup | MRW | Ruta
  cliente     jsonb not null default '{}'::jsonb, -- nombre, telefono, cedula, correo
  producto    text not null default '',
  cantidad    int  not null default 1,
  total       numeric(12,2) not null default 0,
  ini_pct     numeric(5,2)  not null default 0,
  ini_monto   numeric(12,2) not null default 0,
  cuotas      jsonb not null default '{}'::jsonb, -- n, primera, ultima
  entrega     jsonb not null default '{}'::jsonb, -- ciudad, metodo, detalle
  pago        jsonb,                              -- banco, telefono, referencia, fecha
  tag         text not null default '',
  tomado_por  text,
  fotos       jsonb not null default '{}'::jsonb, -- factura, equipo, empaque, entrega → url
  historial   jsonb not null default '[]'::jsonb
);

create table if not exists public.referencias (
  referencia text primary key,
  code       text not null,
  created_at timestamptz not null default now()
);

-- Toma el pedido más antiguo de una caja sin que dos cajeros reciban el mismo
create or replace function public.tomar_siguiente(p_dept text, p_cajero text)
returns public.pedidos language plpgsql security definer set search_path = public as $$
declare r public.pedidos;
begin
  select * into r from public.pedidos
   where st = 'caja' and dept = p_dept
   order by updated_at asc
   for update skip locked limit 1;
  if not found then return null; end if;
  update public.pedidos
     set st = 'tomado', tomado_por = p_cajero, updated_at = now(),
         historial = historial || jsonb_build_object('t', now(), 'e', 'Tomado por ' || p_cajero)
   where code = r.code returning * into r;
  return r;
end $$;

-- Registra el pago móvil del cliente; rechaza referencias ya usadas en otro pedido
create or replace function public.registrar_pago(p_code text, p_pago jsonb, p_entrega jsonb, p_dept text)
returns text language plpgsql security definer set search_path = public as $$
declare v_ref text := coalesce(p_pago->>'referencia', '');
declare v_otro text;
begin
  if v_ref <> '' then
    select code into v_otro from public.referencias where referencia = v_ref;
    if v_otro is not null and v_otro <> p_code then return 'duplicada'; end if;
    insert into public.referencias(referencia, code) values (v_ref, p_code) on conflict (referencia) do nothing;
  end if;
  update public.pedidos
     set pago = case when v_ref <> '' then p_pago else null end,
         entrega = p_entrega, dept = p_dept, st = 'caja', updated_at = now(),
         historial = historial || jsonb_build_object('t', now(), 'e', 'El cliente eligió ' || coalesce(p_entrega->>'metodo','') ||
           case when v_ref <> '' then ' y reportó su pago' else '' end)
   where code = p_code and st = 'cliente';
  return 'ok';
end $$;

-- Borra todo para empezar una demo limpia
create or replace function public.reiniciar_demo()
returns void language sql security definer set search_path = public as $$
  delete from public.referencias where true;
  delete from public.pedidos where true;
$$;

alter table public.pedidos enable row level security;
alter table public.referencias enable row level security;

drop policy if exists demo_pedidos_all on public.pedidos;
create policy demo_pedidos_all on public.pedidos for all to anon, authenticated using (true) with check (true);
drop policy if exists demo_refs_read on public.referencias;
create policy demo_refs_read on public.referencias for select to anon, authenticated using (true);

grant execute on function public.tomar_siguiente(text, text) to anon, authenticated;
grant execute on function public.registrar_pago(text, jsonb, jsonb, text) to anon, authenticated;
grant execute on function public.reiniciar_demo() to anon, authenticated;

-- Cambios en vivo
do $$ begin
  alter publication supabase_realtime add table public.pedidos;
exception when duplicate_object then null; end $$;

-- Fotos de despacho
insert into storage.buckets (id, name, public) values ('despacho', 'despacho', true)
on conflict (id) do nothing;
drop policy if exists demo_despacho_insert on storage.objects;
create policy demo_despacho_insert on storage.objects for insert to anon, authenticated with check (bucket_id = 'despacho');
drop policy if exists demo_despacho_read on storage.objects;
create policy demo_despacho_read on storage.objects for select to anon, authenticated using (bucket_id = 'despacho');
