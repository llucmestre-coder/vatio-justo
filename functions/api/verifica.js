// POST /api/verifica — comprova el codi i, només si és correcte, calcula la
// forquilla orientativa d'estalvi (PLA.md §«Eina estrella») i retorna el WhatsApp.
// El preu i el número no són mai al codi del navegador abans d'aquest pas.
// Secrets: WHATSAPP, BREVO_API_KEY, BREVO_SENDER. Bindings: CODIS (KV), LEADS (D1).

const MAX_INTENTS = 5;

// Magnitud de la pregunta 2 segons el tipus: factura de llum (€/mes) o superfície (m²).
const ESCALA = { solar: [30, 300], bateria: [30, 300], aerotermia: [50, 250], ambas: [50, 250] };
const VIVIENDA = ['inclinada', 'plana', 'adosado', 'piso'];
const CALEFACCION = ['gas', 'gasoleo', 'electrica', 'otra'];
const CUANDO = ['ya', 'meses', 'ano', 'mirando'];

// Valors inventats i orientatius (demo), IVA inclòs. Calibrats el 22/09/2026 amb
// les forquilles públiques del sector: 1.000–1.500 €/kWp, aerotèrmia 7.000–18.000 €.
const PREU_LLUM = 0.20;        // €/kWh comprat (energia + impostos)
const PREU_EXCEDENT = 0.07;    // €/kWh compensat
const PROD_KWP = 1450;         // kWh/any per kWp
const FV = { inclinada: 1, plana: 1.06, adosado: 1, piso: 1.15 };
const AERO = { gas: 1, gasoleo: 1.05, electrica: 1.25, otra: 1.1 };
const DESPESA_M2 = { gas: 12, gasoleo: 16, electrica: 20, otra: 13 };           // €/m² i any, calefacció + ACS
const ESTALVI_AERO = { gas: [0.45, 0.6], gasoleo: [0.55, 0.7], electrica: [0.6, 0.72], otra: [0.4, 0.6] };

const acota = (x, a, b) => Math.min(b, Math.max(a, x));
const mig = (x) => Math.round(x * 2) / 2;
const centenars = (x) => Math.round(x / 100) * 100;
const desenes = (x) => Math.round(x / 10) * 10;

function solar(kwp, vivienda, auto, bateria) {
  const f = FV[vivienda];
  let min = (1200 + 1000 * kwp) * f;
  let max = (1600 + 1250 * kwp) * f;
  if (bateria) { min += 3800; max += 5600; }
  const prod = kwp * PROD_KWP;
  const estalvi = (a) => prod * a * PREU_LLUM + prod * (1 - a) * PREU_EXCEDENT;
  return { kwp, placas: Math.ceil(kwp / 0.45 - 1e-9), min, max, estalviMin: estalvi(auto[0]), estalviMax: estalvi(auto[1]) };
}

function aerotermia(m2, vivienda, cal) {
  const a = AERO[cal] * (vivienda === 'piso' ? 1.08 : 1);
  const despesa = m2 * DESPESA_M2[cal];
  return {
    kw: acota(Math.round(m2 * 0.07), 5, 16),
    min: (4000 + 40 * m2) * a,
    max: (6000 + 60 * m2) * a,
    estalviMin: despesa * ESTALVI_AERO[cal][0],
    estalviMax: despesa * ESTALVI_AERO[cal][1],
  };
}

export function calcula(r) {
  const x = Number(r.mida);
  let d;
  if (r.tipo === 'solar' || r.tipo === 'bateria') {
    const consum = Math.max(1200, (x - 15) * 12 / PREU_LLUM);
    const kwp = acota(mig(consum * 0.9 / PROD_KWP), 2, 10);
    const bat = r.tipo === 'bateria';
    const extra = r.calefaccion === 'electrica' && !bat ? 0.1 : 0;
    d = solar(kwp, r.vivienda, bat ? [0.65, 0.8] : [0.45 + extra, 0.55 + extra], bat);
    d.bateria = bat;
  } else {
    const a = aerotermia(x, r.vivienda, r.calefaccion);
    d = { kw: a.kw, min: a.min, max: a.max, estalviMin: a.estalviMin, estalviMax: a.estalviMax };
    if (r.tipo === 'ambas') {
      const s = solar(acota(mig(x * 0.035 + 1.5), 3, 8), r.vivienda, [0.5, 0.6], false);
      d.kwp = s.kwp; d.placas = s.placas;
      d.min = (a.min + s.min) * 0.95; d.max = (a.max + s.max) * 0.95;
      d.estalviMin += s.estalviMin; d.estalviMax += s.estalviMax;
    }
  }
  const min = centenars(d.min), max = centenars(d.max);
  const estalviMin = desenes(d.estalviMin), estalviMax = desenes(d.estalviMax);
  return {
    min, max, estalviMin, estalviMax,
    retornMin: Math.max(1, Math.round(min / estalviMax)),
    retornMax: Math.max(1, Math.round(max / estalviMin)),
    kwp: d.kwp || null, placas: d.placas || null, kw: d.kw || null, bateria: !!d.bateria,
  };
}

function json(dades, status = 200) {
  return new Response(JSON.stringify(dades), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const te = (obj, clau) => Object.prototype.hasOwnProperty.call(obj, clau);

export async function onRequestPost({ request, env, waitUntil }) {
  let dades;
  try { dades = await request.json(); } catch { return json({ ok: false, error: 'dades' }, 400); }

  const correu = String(dades.correu || '').trim().toLowerCase();
  const codi = String(dades.codi || '');
  const r = dades.respostes || {};
  if (!correu || !/^\d{6}$/.test(codi)) return json({ ok: false, error: 'codi' }, 400);

  const clau = 'codi:' + (await sha256(correu));
  const desat = await env.CODIS.get(clau, 'json');
  if (!desat || desat.caduca < Date.now()) return json({ ok: false, error: 'caducat' }, 400);
  if (desat.intents >= MAX_INTENTS) {
    await env.CODIS.delete(clau);
    return json({ ok: false, error: 'intents' }, 429);
  }

  if ((await sha256(codi + ':' + correu)) !== desat.hash) {
    desat.intents += 1;
    const queda = Math.max(60, Math.ceil((desat.caduca - Date.now()) / 1000));
    await env.CODIS.put(clau, JSON.stringify(desat), { expirationTtl: queda });
    return json({ ok: false, error: 'codi' }, 400);
  }

  const x = Number(r.mida);
  const escala = te(ESCALA, r.tipo) ? ESCALA[r.tipo] : null;
  if (!escala || !Number.isFinite(x) || x < escala[0] || x > escala[1] ||
      !VIVIENDA.includes(r.vivienda) || !CALEFACCION.includes(r.calefaccion) || !CUANDO.includes(r.cuando)) {
    return json({ ok: false, error: 'respostes' }, 400);
  }

  await env.CODIS.delete(clau); // un codi, una estimació

  const c = calcula(r);
  const idioma = ['es', 'ca', 'en'].includes(dades.idioma) ? dades.idioma : 'es';
  const solarTipus = r.tipo === 'solar' || r.tipo === 'bateria';

  // Contacte per al seguiment (D1). Si la base de dades falla, l'usuari veu igualment l'estimació.
  try {
    await env.LEADS.prepare(
      'INSERT INTO leads (correu, idioma, tipo, magnitud, vivienda, calefaccion, cuando, minim, maxim, estalvi_min, estalvi_max) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(correu, idioma, r.tipo, x, r.vivienda, r.calefaccion, r.cuando, c.min, c.max, c.estalviMin, c.estalviMax).run();
  } catch (e) {
    console.error('D1 leads:', e && e.message);
  }

  const euros = (n, loc) => n.toLocaleString(loc || 'es-ES', { useGrouping: 'always' }) + ' €';
  const magnitud = solarTipus ? x + ' €/mes de luz' : x + ' m²';
  const instal = [c.kwp ? c.kwp.toLocaleString('es-ES') + ' kWp · ' + c.placas + ' placas' : '', c.bateria ? 'batería' : '', c.kw ? 'bomba de ' + c.kw + ' kW' : ''].filter(Boolean).join(' · ');

  // Avís al negoci per correu (no bloqueja la resposta).
  const resum = [
    'Nuevo contacto desde la calculadora de Vatio Justo',
    '',
    'Correo: ' + correu,
    'Quiere: ' + NOMS.tipo[r.tipo] + ' · ' + magnitud,
    'Vivienda: ' + NOMS.vivienda[r.vivienda],
    'Calefacción hoy: ' + NOMS.calefaccion[r.calefaccion],
    'Cuándo: ' + NOMS.cuando[r.cuando],
    'Instalación estimada: ' + instal,
    'Precio mostrado: ' + euros(c.min) + ' – ' + euros(c.max),
    'Ahorro mostrado: ' + euros(c.estalviMin) + ' – ' + euros(c.estalviMax) + ' al año',
    'Idioma de la web: ' + idioma,
  ].join('\n');
  waitUntil(fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Calculadora Vatio Justo', email: env.BREVO_SENDER },
      to: [{ email: env.BREVO_SENDER }],
      replyTo: { email: correu },
      subject: 'Nuevo cálculo: ' + NOMS.tipo[r.tipo] + ' · ' + euros(c.min) + '–' + euros(c.max),
      textContent: resum,
    }),
  }).catch(() => {}));

  // Resum per a l'usuari, en l'idioma de la web (demo: text senzill; un negoci real el treballarà més).
  const t = RESUM[idioma];
  const e = (n) => euros(n, t.locale);
  const rang = e(c.min) + ' – ' + e(c.max);
  const estalvi = e(c.estalviMin) + ' – ' + e(c.estalviMax);
  const instalIdioma = [
    c.kwp ? c.kwp.toLocaleString(t.locale) + ' kWp · ' + c.placas + ' ' + t.placas : '',
    c.bateria ? t.bateria : '',
    c.kw ? t.bomba.replace('{kw}', c.kw) : '',
  ].filter(Boolean).join(' · ');
  const files = [
    [t.quiere, t.tipo[r.tipo]],
    [solarTipus ? t.factura : t.superficie, solarTipus ? x + ' ' + t.euroMes : x + ' m²'],
    [t.viviendaT, t.vivienda[r.vivienda]],
    [t.calefaccionT, t.calefaccion[r.calefaccion]],
    [t.instalacion, instalIdioma],
    [t.ahorro, estalvi + ' ' + t.alAno],
    [t.retorno, t.anos.replace('{a}', c.retornMin).replace('{b}', c.retornMax)],
  ];
  const missatgeWa = encodeURIComponent(t.wa
    .replace('{resum}', [t.tipo[r.tipo], files[1][1], t.vivienda[r.vivienda], t.calefaccion[r.calefaccion]].join(' · '))
    .replace('{instal}', instalIdioma).replace('{rang}', rang));
  const enllacWa = 'https://wa.me/' + String(env.WHATSAPP || '').replace(/\D/g, '') + '?text=' + missatgeWa;
  const html = `<div style="font-family:Arial,sans-serif;color:#141C27;max-width:520px;line-height:1.5">
  <p style="font-size:16px">${t.hola}</p>
  <p style="font-size:14px;color:#4E5A66;margin:18px 0 4px">${t.estimacio}</p>
  <p style="font-size:30px;font-weight:700;margin:0 0 6px">${rang}</p>
  <p style="font-size:13px;color:#4E5A66;margin:0 0 18px">${t.nota}</p>
  <table style="border-collapse:collapse;width:100%;font-size:15px">${files.map((f) =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #D6DADD;color:#4E5A66">${f[0]}</td><td style="padding:8px 0;border-bottom:1px solid #D6DADD;text-align:right;font-weight:600">${f[1]}</td></tr>`).join('')}</table>
  <p style="margin:24px 0"><a href="${enllacWa}" style="background:#1F8F4E;color:#fff;text-decoration:none;padding:12px 20px;border-radius:4px;font-weight:700;display:inline-block">${t.botoWa}</a></p>
  <p style="font-size:14px">${t.seguent}</p>
  <p style="font-size:14px;color:#4E5A66">Vatio Justo · 600 000 000</p></div>`;
  waitUntil(fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Vatio Justo', email: env.BREVO_SENDER },
      to: [{ email: correu }],
      subject: t.assumpte + ' · ' + rang,
      textContent: `${t.hola}\n\n${t.estimacio}: ${rang}\n${t.nota}\n\n${files.map((f) => f[0] + ': ' + f[1]).join('\n')}\n\n${t.botoWa}: ${enllacWa}\n\n${t.seguent}\n\nVatio Justo · 600 000 000`,
      htmlContent: html,
    }),
  }).catch(() => {}));

  return json({ ok: true, ...c, whatsapp: env.WHATSAPP });
}

const RESUM = {
  es: {
    locale: 'es-ES',
    assumpte: 'Tu estimación de ahorro',
    hola: 'Hola, este es el resumen de lo que has calculado en nuestra web.',
    estimacio: 'Precio orientativo de la instalación',
    nota: 'IVA incluido. Cifras orientativas con valores medios; el precio cerrado sale de la visita y de tus facturas de 12 meses.',
    quiere: 'Quieres', factura: 'Factura de luz', superficie: 'Superficie', euroMes: '€/mes',
    viviendaT: 'Vivienda', calefaccionT: 'Calefacción hoy', instalacion: 'Instalación', ahorro: 'Ahorro estimado', retorno: 'Se recupera en',
    alAno: 'al año', anos: 'entre {a} y {b} años', placas: 'placas', bateria: 'batería de 5 kWh', bomba: 'bomba de calor de {kw} kW',
    tipo: { solar: 'Placas solares', bateria: 'Placas con batería', aerotermia: 'Aerotermia', ambas: 'Placas y aerotermia' },
    vivienda: { inclinada: 'Casa con tejado inclinado', plana: 'Casa con cubierta plana', adosado: 'Adosado', piso: 'Piso' },
    calefaccion: { gas: 'Gas', gasoleo: 'Gasóleo', electrica: 'Eléctrica', otra: 'Otra' },
    botoWa: 'Hablar por WhatsApp',
    wa: 'Hola, he usado la calculadora de Vatio Justo: {resum}. Me sale {instal} por {rang}. ¿Cuándo podríais venir a verlo?',
    seguent: 'Si quieres seguir adelante, responde a este correo o escríbenos por WhatsApp y quedamos para la visita.',
  },
  ca: {
    locale: 'ca-ES',
    assumpte: 'La teva estimació d\'estalvi',
    hola: 'Hola, aquest és el resum del que has calculat a la nostra web.',
    estimacio: 'Preu orientatiu de la instal·lació',
    nota: 'IVA inclòs. Xifres orientatives amb valors mitjans; el preu tancat surt de la visita i de les teves factures de 12 mesos.',
    quiere: 'Vols', factura: 'Factura de llum', superficie: 'Superfície', euroMes: '€/mes',
    viviendaT: 'Habitatge', calefaccionT: 'Calefacció avui', instalacion: 'Instal·lació', ahorro: 'Estalvi estimat', retorno: 'Es recupera en',
    alAno: 'l\'any', anos: 'entre {a} i {b} anys', placas: 'plaques', bateria: 'bateria de 5 kWh', bomba: 'bomba de calor de {kw} kW',
    tipo: { solar: 'Plaques solars', bateria: 'Plaques amb bateria', aerotermia: 'Aerotèrmia', ambas: 'Plaques i aerotèrmia' },
    vivienda: { inclinada: 'Casa amb teulada inclinada', plana: 'Casa amb coberta plana', adosado: 'Adossat', piso: 'Pis' },
    calefaccion: { gas: 'Gas', gasoleo: 'Gasoil', electrica: 'Elèctrica', otra: 'Una altra' },
    botoWa: 'Parlar per WhatsApp',
    wa: 'Hola, he fet servir la calculadora de Vatio Justo: {resum}. Em surt {instal} per {rang}. Quan podríeu venir a veure-ho?',
    seguent: 'Si vols tirar endavant, respon aquest correu o escriu-nos per WhatsApp i quedem per a la visita.',
  },
  en: {
    locale: 'en-GB',
    assumpte: 'Your savings estimate',
    hola: 'Hi, here is the summary of what you calculated on our website.',
    estimacio: 'Rough price of the installation',
    nota: 'VAT included. Rough figures based on average values; the fixed price comes after the visit and 12 months of your bills.',
    quiere: 'You want', factura: 'Electricity bill', superficie: 'Floor area', euroMes: '€/month',
    viviendaT: 'Home', calefaccionT: 'Heating today', instalacion: 'Installation', ahorro: 'Estimated savings', retorno: 'Pays for itself in',
    alAno: 'a year', anos: '{a} to {b} years', placas: 'panels', bateria: '5 kWh battery', bomba: '{kw} kW heat pump',
    tipo: { solar: 'Solar panels', bateria: 'Panels with battery', aerotermia: 'Heat pump', ambas: 'Panels and heat pump' },
    vivienda: { inclinada: 'House with a pitched roof', plana: 'House with a flat roof', adosado: 'Terraced house', piso: 'Flat' },
    calefaccion: { gas: 'Gas', gasoleo: 'Heating oil', electrica: 'Electric', otra: 'Other' },
    botoWa: 'Chat on WhatsApp',
    wa: 'Hi, I used the Vatio Justo calculator: {resum}. It came out at {instal} for {rang}. When could you come and have a look?',
    seguent: 'If you want to go ahead, reply to this email or message us on WhatsApp and we\'ll arrange the visit.',
  },
};

const NOMS = {
  tipo: { solar: 'Placas solares', bateria: 'Placas con batería', aerotermia: 'Aerotermia', ambas: 'Placas y aerotermia' },
  vivienda: { inclinada: 'casa con tejado inclinado', plana: 'casa con cubierta plana', adosado: 'adosado', piso: 'piso' },
  calefaccion: { gas: 'gas', gasoleo: 'gasóleo', electrica: 'eléctrica', otra: 'otra' },
  cuando: { ya: 'cuanto antes', meses: 'en los próximos 3 meses', ano: 'este año', mirando: 'solo mirando' },
};

export function onRequest() {
  return json({ ok: false, error: 'metode' }, 405);
}
