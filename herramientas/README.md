# Herramientas (no forman parte del sistema)

## video/
Graba el video «en movimiento» usando la demo real con datos simulados y lo arma con voz y subtítulos.
- `rec.js` = `mockdb.part.js` + `email.part.js` + `rec.main.js` (grabador con Playwright: `node rec.js h` o `node rec.js v`).
- `build2.py h|v` arma el video final con la voz de `audio3/` (Antonio, ElevenLabs) y subtítulos.
- Necesita: un servidor local en el puerto 8123 que sirva la carpeta padre (`python3 -m http.server 8123`), Playwright y ffmpeg.
- Las rutas están escritas para la máquina original (`/home/user/video`); ajústalas si cambia la carpeta.

## pruebas-navegador/
Prueba de punta a punta del sistema de producción sin Supabase real.
- `shim.mjs` imita a Supabase (login, base de datos, funciones, fotos) sobre un PostgreSQL local.
- `e2e.mjs` prueba las funciones del servidor (correo → pedido → WhatsApp, correos falsos, reintentos).
- `usuarios.mjs` prueba la administración de usuarios.
- `ui.js` recorre el sistema en el navegador con cada rol.
- Requiere PostgreSQL 16, Node 22 (`npm install pg`) y Playwright. Ver `supabase/produccion/prueba/` para la base de datos.
