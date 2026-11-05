# Contexto del proyecto · Pedidos Cashea Soytechno

> Para cualquier sesión nueva de Claude: lee este archivo primero. Resume todo lo acordado hasta el 5 de noviembre de 2026.

## Quién y qué
- **Adrian Sanoja** propone a **Soytechno** automatizar sus pedidos de Cashea. Adrian no programa; Claude escribe el código.
- Soytechno recibe ~1.000 pedidos Cashea al día, más de 4.000 en temporada alta (~3 semanas). Hoy: correo → operadora copia y corrige el IVA → comanda por WhatsApp → asesor contacta al cliente por Callbell → grupo de WhatsApp del departamento → caja factura en Profit Plus 2K.

## Reglas del negocio acordadas
- **Entrega (elige el cliente):** Caracas → Delivery o Pickup (no MRW). Valencia, Los Teques, La Guaira, Guarenas, Guatire, San Antonio de los Altos → Ruta foránea, MRW o Pickup. Resto del país → MRW o Pickup. Pickup solo en **Tienda Chacao, Av. Andrés Galarraga**. El envío es **gratis**.
- **Cajas:** una por departamento (Delivery, Pickup, MRW, Ruta), varios cajeros con «Tomar siguiente», nunca dos con el mismo pedido.
- **Caja SIEMPRE verifica el pago móvil en BNC** (BNC no tiene API). La caja ve exactamente lo que factura: **total sin IVA (Subtotal de Cashea)** y el pago inicial con su %.
- **«No pude validar»** → panel de Asesores → el asesor corrige, o lo manda a Administración (aliado Cashea o transferencia), o cancela.
- **Despacho** es un área aparte; fotos obligatorias de **factura y equipo**; guía MRW obligatoria.
- **Traslados:** solo los de **Lechería** se informan al cliente (lo pedido hasta el miércoles llega jueves o viernes). Los internos de Caracas son silenciosos; si pasan de 24 h se avisa al cliente.
- **Ajuste:** sin stock u otra versión → alternativas que el cliente elige desde su enlace.
- **Productos a apagar:** ranking de agotados y de Lechería; el operador los apaga a mano en el portal de Cashea.
- **9 tiendas:** City Market, Blvr. de Sabana Grande, SAMBIL Chacao, Chacao, CCCT, Los Ilustres, La Vega, Catia, Lechería.
- Ventas **MIX** van a Stand-by (asesor). Tercero que recibe: nombre + cédula. Cancelación por falta de pago: manual. Reembolsos: Administración. Diferencias de precio: como decida el cliente. Pickup sin vencimiento.
- Sin cronómetros en los paneles. Estética: app con el logo blanco de Soytechno.
- Pendiente de confirmar: si delivery es solo en Caracas.

## Lo que existe
| Qué | Dónde |
|---|---|
| Código (demo + producción) | GitHub `sanojadrian/soytechno-pedidos` |
| Demo abierta (Supabase de la demo) | https://sanojadrian.github.io/soytechno-pedidos/ |
| Sistema de producción | carpeta `produccion/` + `supabase/produccion/` · instalación en `INSTALACION.md` |
| Herramientas del video y pruebas | carpeta `herramientas/` |
| Página interactiva para la dueña | https://claude.ai/artifact/NosNU8fin1kxpxaLskLisy |
| Resumen corto para la jefa | https://claude.ai/artifact/MufNADxTpSYA4kTkYiFLxH |
| Presentación (diapositivas) | https://claude.ai/artifact/7A4AfDUs1odMMsKBAagsCG |
| Especificación | https://claude.ai/artifact/3bd8QsaCqGT5bxcfNHjDrz |
| Propuesta formal (privada) | https://claude.ai/artifact/TqU71Qmc1x1wwtGVVbUVuQ |
| Manual por rol | https://claude.ai/artifact/Nd6q25fnwb8E8MoNcRDszt |
| Videos (horizontal y vertical, voz de Antonio) | enviados a Adrian; se regeneran con `herramientas/video/` |

## Propuesta comercial
- Precios, plazos y condiciones: en la propuesta formal privada de claude.ai (no se guardan en este repositorio, que es público).
- Plazo acordado: 8 semanas desde los accesos; piloto con una caja en la semana 4. No cambiar todas las cajas en plena temporada alta.

## Producción: estado técnico
- Base de datos con roles, acciones validadas en el servidor, historial que no se borra, enlace secreto del cliente en tabla aparte, cola de WhatsApp con reintentos, alertas.
- Funciones: `recibir-correo` (solo correos auténticos del dominio de Cashea), `procesar-mensajes` (Callbell), `admin-usuarios`.
- Probado: 96 comprobaciones de base de datos, prueba de carga (1 año de historial + 4.000 pedidos + 20 cajeros), pruebas de navegador por rol, revisión de seguridad independiente con todo lo confirmado corregido.
- **No probado contra cuentas reales** (Supabase, Callbell, Gmail): los campos de la API de Callbell están escritos de memoria; verificar en el piloto.

## Siguientes pasos
1. Adrian crea el proyecto de Supabase de producción y sigue `INSTALACION.md`.
2. Pasar a Claude: Project URL, clave publishable, datos del pago móvil (banco, teléfono, RIF) y el dominio de Cashea.
3. Soytechno: clave de API de Callbell (nueva, nunca por chat), plantilla de WhatsApp aprobada, acceso al Gmail de los pedidos, lista de usuarios, dominio propio (p. ej. `pedidos.soytechno.com`).
4. Piloto con una caja y `SOLO_TELEFONOS`; luego todas las cajas.

## Reglas de trabajo
- Nunca pegar claves (Callbell, secret de Supabase) en el chat ni en el código: van en los secretos de Supabase.
- No guardar datos reales de clientes en pruebas.
- Commits como «Adrian Sanoja» <sanojadrian@users.noreply.github.com>.
