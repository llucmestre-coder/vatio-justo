// GET /admin/leads.csv — exportació completa (protegida per _middleware.js).

const camp = (v) => {
  const s = String(v == null ? '' : v);
  // Evita que un full de càlcul interpreti fórmules injectades (=, +, -, @).
  const segur = /^[=+\-@]/.test(s) ? "'" + s : s;
  return /[",\n;]/.test(segur) ? '"' + segur.replace(/"/g, '""') + '"' : segur;
};

export async function onRequestGet({ env }) {
  const capcalera = ['id', 'creat', 'correu', 'idioma', 'tipo', 'magnitud', 'vivienda', 'calefaccion', 'cuando', 'minim', 'maxim', 'estalvi_min', 'estalvi_max', 'estat'];
  const { results } = await env.LEADS.prepare('SELECT ' + capcalera.join(', ') + ' FROM leads ORDER BY id DESC').all();
  const linies = [capcalera.join(',')].concat(results.map((l) => capcalera.map((c) => camp(l[c])).join(',')));
  return new Response('\uFEFF' + linies.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="vatio-justo-leads.csv"',
    },
  });
}
