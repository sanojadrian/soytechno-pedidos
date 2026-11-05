# Instalación del sistema de producción

Guía paso a paso para dejar operando el sistema de pedidos Cashea de Soytechno.
No hace falta programar: todo se hace copiando y pegando en páginas web.
Tiempo estimado: unas 2 horas la primera vez.

> La **demo** (carpeta raíz) y la **producción** (carpeta `produccion/`) son sistemas separados,
> con bases de datos separadas. La demo puede seguir funcionando para presentaciones.

---

## Qué necesitas antes de empezar

| Qué | Para qué | Quién lo da |
|---|---|---|
| Un proyecto **nuevo** de Supabase (ideal: a nombre de Soytechno) | Base de datos, usuarios, fotos y funciones | Lo creas tú o Soytechno te invita |
| La clave de API de **Callbell** | Enviar los WhatsApp | Soytechno (nunca por chat) |
| Acceso a la cuenta de **Gmail** que recibe los correos de Cashea | Leer los pedidos solos | Soytechno |
| Datos del **pago móvil**: banco, teléfono y RIF | Que el cliente sepa a dónde pagar | Soytechno |
| La lista de **personas con su rol** | Crear los usuarios | Soytechno |

Plan recomendado de Supabase: **Pro** (US$25/mes). El plan gratis se pausa si no se usa una semana y no tiene respaldos.

---

## Paso 1 · Crear el proyecto de Supabase

1. Entra a https://supabase.com/dashboard → **New project**.
2. Nombre: `soytechno-produccion`. Región: **East US (North Virginia)**, la más cercana a Venezuela.
3. Guarda la contraseña de la base de datos en un lugar seguro.

Después de crearlo, en **Authentication → Sign In / Providers** apaga **Allow new users to sign up**.
Así nadie puede crearse una cuenta por su cuenta: los usuarios solo los crea Supervisión.

## Paso 2 · Crear la base de datos

1. En el proyecto: **SQL Editor** → **New query**.
2. Abre el archivo [`supabase/produccion/schema.sql`](supabase/produccion/schema.sql), copia **todo** y pégalo.
3. Pulsa **Run**. Debe terminar sin errores en rojo.

## Paso 3 · Crear tu usuario de Supervisión

1. **Authentication → Users → Add user → Create new user**.
   Pon tu correo y una clave. Marca **Auto Confirm User**.
2. Vuelve al **SQL Editor** y corre esto, cambiando tus datos:

```sql
insert into perfiles (id, nombre, correo, rol, telefono)
select id, 'Adrian Sanoja', email, 'supervisor', '0412-258-3143'
from auth.users where email = 'TU-CORREO@ejemplo.com';
```

Los demás usuarios los creas después desde el panel, en **Usuarios**.

## Paso 4 · Publicar las 3 funciones del servidor

Para **cada una** de estas funciones:

1. **Edge Functions → Deploy a new function → Via Editor**.
2. Escribe el **nombre exacto**.
3. Borra el código de ejemplo, pega el contenido del archivo y pulsa **Deploy**.
4. Entra a la función → **Details** → apaga **Enforce JWT verification** → **Save**.

| Nombre exacto | Archivo |
|---|---|
| `recibir-correo` | [`supabase/produccion/functions/recibir-correo/index.ts`](supabase/produccion/functions/recibir-correo/index.ts) |
| `procesar-mensajes` | [`supabase/produccion/functions/procesar-mensajes/index.ts`](supabase/produccion/functions/procesar-mensajes/index.ts) |
| `admin-usuarios` | [`supabase/produccion/functions/admin-usuarios/index.ts`](supabase/produccion/functions/admin-usuarios/index.ts) |

## Paso 5 · Guardar los secretos

**Edge Functions → Secrets → Add new secret**. Estos valores **nunca** van en el código ni en un chat.

| Nombre | Valor |
|---|---|
| `CALLBELL_API_KEY` | La clave de la API de Callbell |
| `INGRESO_CLAVE` | Inventa una clave larga (30 letras y números al azar). La usa el script de Gmail. |
| `PROCESO_CLAVE` | Otra clave larga distinta. La usa la tarea automática. |
| `REMITENTES_PERMITIDOS` | El dominio desde el que escribe Cashea, por ejemplo `cashea.app`. Solo los correos de ese dominio crean pedidos. Para verlo: abre un correo real de Cashea → ⋮ → «Mostrar original» → línea «From». |
| `CLIENTE_URL` | La dirección de la página del cliente, terminada en `cliente.html` (ver paso 7) |
| `SOLO_TELEFONOS` | **Durante el piloto**: tus números de prueba separados por coma. Bórralo para operar con todos los clientes. |
| `CALLBELL_CHANNEL_UUID` | Opcional: solo si Callbell tiene más de un canal de WhatsApp |
| `CALLBELL_TEMPLATE_UUID` | Recomendado: el identificador de la plantilla aprobada (paso 9) |

Si al probar ves el error *«No tienes permiso»* o *401* en las funciones, agrega también
`SERVICIO_CLAVE` con la clave **secret** de **Project Settings → API Keys**.

## Paso 6 · Activar las tareas automáticas

1. **Integrations** → activa **Cron**. **Database → Extensions** → activa **pg_net**.
2. Abre [`supabase/produccion/cron.sql`](supabase/produccion/cron.sql), cambia las dos líneas marcadas con ⚠
   (la dirección de tu proyecto y tu `PROCESO_CLAVE`), pégalo en el **SQL Editor** y pulsa **Run**.

Con esto, cada minuto se envían los WhatsApp pendientes y cada 5 minutos se revisan las alertas.

## Paso 7 · Conectar la página

Edita [`produccion/assets/config.js`](produccion/assets/config.js) con:

- la **Project URL** y la clave **publishable** (Project Settings → API Keys). La publishable puede ir en la página; la secret nunca.
- los datos reales del **pago móvil** (banco, teléfono y RIF).

Si me pasas la Project URL, la clave publishable y los datos del pago móvil, lo hago yo.

**Dónde publicarla (importante para la seguridad):** la producción debe tener **su propia dirección**,
no la misma de la demo. Lo recomendado es un subdominio de Soytechno, por ejemplo `pedidos.soytechno.com`
(lo configura quien maneja el dominio de Soytechno; yo te preparo los pasos). Mientras tanto se puede probar en
`https://sanojadrian.github.io/soytechno-pedidos/produccion/`, pero no se debe operar ahí con clientes reales:
comparte dirección con la demo, que es abierta.

## Paso 8 · Conectar el Gmail que recibe los pedidos

Sigue las instrucciones al inicio de [`integraciones/gmail-apps-script.gs`](integraciones/gmail-apps-script.gs).
En resumen: script.google.com → nuevo proyecto → pegar → poner `URL_FUNCION`, `INGRESO_CLAVE` y `DOMINIOS_CASHEA` → ejecutar **instalar**.

El script solo envía al sistema los correos **del dominio de Cashea que Gmail comprobó como auténticos**.
Un correo falso, o uno reenviado a mano, no crea pedidos: queda en la Bandeja como «revisar».
Lo hace alguien con acceso a esa cuenta de Gmail; la contraseña no se comparte con nadie.

Si Soytechno usa **Outlook** en vez de Gmail, avísame y preparo la alternativa.

## Paso 9 · Plantilla de WhatsApp en Callbell

WhatsApp solo deja escribir primero a un cliente con una **plantilla aprobada por Meta**. Créala en Callbell
(categoría *Utilidad*) con este texto y envíala a aprobación:

> ¡Hola {{1}}! Recibimos tu pedido Cashea #{{2}}. Elige cómo quieres recibirlo y reporta tu pago aquí: {{3}}

Cuando esté aprobada, copia su identificador al secreto `CALLBELL_TEMPLATE_UUID`.
Los demás avisos (Lechería, alternativas, despacho) llegan cuando la conversación ya está abierta.

## Paso 10 · Prueba piloto

1. Con `SOLO_TELEFONOS` puesto, espera el primer correo real de Cashea (o haz una compra de prueba con tu teléfono).
   Un correo reenviado no sirve para la prueba: el sistema lo rechaza a propósito por seguridad.
   Para probar sin esperar, carga un correo a mano en **Bandeja** con tu teléfono.
2. En un minuto aparece el pedido y te llega el WhatsApp.
3. Haz el recorrido completo: cliente → caja → despacho. Revisa **Supervisión → buscar el pedido**.
4. Crea los usuarios reales en **Usuarios** y empieza con **una sola caja** (por ejemplo MRW).
5. Cuando todo esté bien, borra `SOLO_TELEFONOS` y suma las demás cajas.

---

## Si algo falla (plan de contingencia)

- El panel **Supervisión → Exportar abiertos** descarga la cola del día en Excel.
- Ese día se vuelve al proceso por WhatsApp de siempre. Ningún pedido se pierde: todos quedan guardados.
- Los WhatsApp que fallan se reintentan solos 3 veces. Los que no salen quedan marcados en el recorrido del pedido.

## Qué queda fuera (por ahora)

- **Profit Plus**: la caja sigue facturando en Profit como hoy.
- **BNC**: no ofrece conexión para verificar pagos; la caja lo verifica.
- **Oficinas MRW**: el cliente escribe la oficina. Se puede cargar la lista oficial más adelante.
- **Cashea**: los pedidos se leen del correo. Si Cashea ofrece API, se puede conectar después.

## Seguridad

- Cada persona entra con su usuario; nadie modifica pedidos directo en la base: todo pasa por funciones que validan rol y estado.
- El enlace del cliente es secreto y no lo ve el personal salvo quien atiende clientes (operador, asesores, ajuste, supervisión).
- Solo crean pedidos los correos auténticos de Cashea. Si llega otro correo con el mismo número de pedido y otro cliente, salta una alerta.
- Las referencias de pago se comparan sin ceros a la izquierda y con la lista de bancos, para que no se puedan reutilizar.
- Las fotos son privadas, solo JPG de hasta 5 MB, y tienen que existir para poder marcarlas.
- El Excel exportado neutraliza fórmulas.
- Las páginas solo cargan código propio y la librería de Supabase verificada por su huella.
- Un pedido de **inicial 0%** no tiene pago que verificar: si llega algo raro, confírmalo en el portal de Cashea antes de facturar.

## Pruebas incluidas

- `supabase/produccion/prueba/flujo.sql`: 96 comprobaciones de la base de datos con cada rol
  (permisos, un pedido por cajero, referencias repetidas, fotos obligatorias, cola de WhatsApp, alertas, correos falsos).
- `supabase/produccion/prueba/carga.mjs`: prueba de carga con un año de historial, 4.000 pedidos y 20 cajeros a la vez.
