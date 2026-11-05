-- ============================================================================
-- Soytechno · Pedidos Cashea — TAREAS AUTOMÁTICAS
-- Se corre DESPUÉS de publicar las funciones (ver INSTALACION.md).
--   1. Supabase → Integrations → activa «Cron» y «pg_net» (o Database → Extensions).
--   2. Reemplaza las dos líneas marcadas con ⚠ y corre este archivo en el SQL Editor.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ⚠ Dirección de tu proyecto (Project Settings → API → Project URL)
select vault.create_secret('https://TU-PROYECTO.supabase.co', 'url_proyecto')
 where not exists (select 1 from vault.secrets where name = 'url_proyecto');
-- ⚠ El mismo valor que pusiste en el secreto PROCESO_CLAVE de las funciones
select vault.create_secret('PEGA-AQUI-TU-PROCESO_CLAVE', 'proceso_clave')
 where not exists (select 1 from vault.secrets where name = 'proceso_clave');

-- Si ya existían, se reemplazan
select cron.unschedule(jobid) from cron.job where jobname in ('procesar-mensajes', 'revisar-alertas');

-- Cada minuto: enviar los WhatsApp pendientes y reintentar los fallidos
select cron.schedule('procesar-mensajes', '* * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'url_proyecto') || '/functions/v1/procesar-mensajes',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-clave', (select decrypted_secret from vault.decrypted_secrets where name = 'proceso_clave')),
    body    := '{}'::jsonb)
$$);

-- Cada 5 minutos: alertas (no entran correos, fallan los WhatsApp) y avisos de retraso
select cron.schedule('revisar-alertas', '*/5 * * * *', $$ select public.revisar_alertas() $$);

select jobname, schedule from cron.job order by jobname;
