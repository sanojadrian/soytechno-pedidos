/* Datos de conexión al proyecto de Supabase DE PRODUCCIÓN (no el de la demo).
   Supabase → Project Settings → API: copia la Project URL y la clave «publishable».
   NUNCA pongas aquí la clave secreta ni la de Callbell. */
window.SOY_CONFIG = {
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseKey: 'sb_publishable_PEGA_AQUI_TU_CLAVE'
};

/* Datos del pago móvil de Soytechno que ve el cliente para pagar su inicial. */
window.SOY_CONFIG.pagoMovil = {
  banco: 'BNC',
  telefono: '0412-000-0000',   // ⚠ cambiar por el teléfono real del pago móvil
  rif: 'J-00000000-0'          // ⚠ cambiar por el RIF real
};
