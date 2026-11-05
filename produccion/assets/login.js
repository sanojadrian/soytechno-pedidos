/* Soytechno · Pedidos Cashea — entrada (producción) */
(function () {
  const { sb, listo } = window.SOY;
  const f = document.getElementById('f'), err = document.getElementById('err'), btn = document.getElementById('btn');
  const decir = m => { err.textContent = m; err.hidden = !m; };
  if (!listo) { decir('Falta configurar la conexión en assets/config.js.'); btn.disabled = true; return; }
  sb.auth.getSession().then(({ data }) => { if (data.session) location.replace('panel.html'); });
  f.addEventListener('submit', async e => {
    e.preventDefault(); decir('');
    const correo = document.getElementById('correo').value.trim(), clave = document.getElementById('clave').value;
    if (!correo || !clave) return decir('Escribe tu correo y tu clave.');
    btn.disabled = true; btn.textContent = 'Entrando…';
    const { data, error } = await sb.auth.signInWithPassword({ email: correo, password: clave });
    if (error) { btn.disabled = false; btn.textContent = 'Entrar'; return decir(/invalid/i.test(error.message) ? 'Correo o clave incorrectos.' : /banned/i.test(error.message) ? 'Tu usuario está dado de baja. Habla con Supervisión.' : 'No pude entrar: ' + error.message); }
    const { data: p } = await sb.from('perfiles').select('activo').eq('id', data.user.id).maybeSingle();
    if (!p || !p.activo) { await sb.auth.signOut(); btn.disabled = false; btn.textContent = 'Entrar'; return decir('Tu usuario no tiene acceso. Habla con Supervisión.'); }
    location.replace('panel.html');
  });
})();
