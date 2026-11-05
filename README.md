# Soytechno · Pedidos Cashea

Este repositorio tiene dos sistemas separados:

- **Demo** (carpeta raíz): para presentaciones. Sin usuarios ni contraseñas; solo datos de prueba.
- **Producción** (carpeta `produccion/` y `supabase/produccion/`): el sistema para operar, con usuario por persona,
  roles, enlace secreto para cada cliente, WhatsApp por Callbell, lectura automática del correo, fotos privadas,
  historial que no se puede borrar y alertas. **Cómo instalarlo: [INSTALACION.md](INSTALACION.md).**

## Demo

- `index.html` — portada de la demo
- `panel.html` — app del equipo (bandeja de correos, cajas, despacho, asesores, administración, supervisión)
- `cliente.html?c=CÓDIGO` — página que abre el cliente (sin login)
- `supabase/schema.sql` — tablas, funciones y permisos (pegar en Supabase → SQL Editor → Run)
- `assets/config.js` — Project URL y anon key de Supabase

**Demo sin usuarios ni contraseñas: usar solo datos de prueba.**

## WhatsApp real con Callbell (opcional para la demo)

El panel puede enviar avisos reales de WhatsApp a través de Callbell: el enlace del pedido, la fecha de Lechería, las alternativas y el despacho.
La clave de Callbell **nunca** va en este repositorio: vive solo como secreto de Supabase.

1. **Publicar la función.** Supabase → Edge Functions → *Deploy a new function* → *Via Editor*.
   Nombre: `enviar-whatsapp`. Pega el contenido de `supabase/functions/enviar-whatsapp/index.ts` y pulsa *Deploy*.
2. **Quitar la verificación JWT.** En la función → *Details* → apaga *Enforce JWT verification* (la página usa la clave publishable, que no es un JWT).
3. **Secretos.** Edge Functions → *Secrets*:
   - `CALLBELL_API_KEY` — la clave de la API de Callbell.
   - `DEMO_TELEFONOS` — los números que pueden recibir mensajes en la demo, separados por coma. Ejemplo: `0412-258-3143,0414-000-0000`.
   - `CALLBELL_CHANNEL_UUID` — solo si la cuenta de Callbell tiene más de un canal.
   - `CALLBELL_TEMPLATE_UUID` — opcional: plantilla aprobada para el primer mensaje. Variables: `{{1}}` nombre, `{{2}}` número de pedido, `{{3}}` enlace.
4. **Activar en la página.** En `assets/config.js`, cambia `whatsapp: false` por `whatsapp: true`.

Sin plantilla aprobada, WhatsApp solo deja escribir a quien le haya escrito al número en las últimas 24 horas.
Para la demo: desde el teléfono que va a recibir, envía un "Hola" al WhatsApp de Soytechno antes de empezar.
