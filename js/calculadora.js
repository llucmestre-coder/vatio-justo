/* =========================================================================
   VATIO JUSTO — calculadora d'estalvi (PLA.md §«Eina estrella»)
   Adaptada de <skill web-demo>/assets/eina-estrella/js/calculadora.js.
   - Una pregunta per pantalla; en tocar una opció avança sola.
   - El preu NO és al client: el retorna /api/verifica després de validar
     el codi que /api/codi envia al correu (fase D, Pages Functions).
   - Textos escrits des del JS: sempre passen per I18N.t amb la frase dins.
   ========================================================================= */
(function () {
  'use strict';

  if (!window.I18N) window.I18N = { t: function (s) { return s; } };
  var arrel = document.getElementById('calc');
  if (!arrel) return;

  /* El número de WhatsApp NO és aquí (repo públic): arriba a la resposta de
     /api/verifica, un cop validat el codi. */
  /* Clau pública del widget Turnstile «vatio-justo calculadora» (vatio-justo.pages.dev
     i localhost). La secreta és un secret de Pages. */
  var TURNSTILE_SITEKEY = '0x4AAAAAAE_XbXoeIskorEUx';

  var PREGUNTES = ['tipo', 'mida', 'vivienda', 'calefaccion', 'cuando'];
  var PASSOS = PREGUNTES.concat(['correu', 'codi', 'resultat']);
  var DESAT = 'vatiojusto-calculadora';
  var redueix = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var $ = function (sel, dins) { return (dins || arrel).querySelector(sel); };
  var $$ = function (sel, dins) { return Array.prototype.slice.call((dins || arrel).querySelectorAll(sel)); };

  var estat = llegeix() || { pas: 0, respostes: {}, correu: '', resultat: null };

  /* Només es recupera on s'havia quedat si es recarrega la pàgina. Arribant-hi
     des de qualsevol botó o enllaç, la calculadora comença de zero. */
  function llegeix() {
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (!nav || nav.type !== 'reload') {
      try { sessionStorage.removeItem(DESAT); } catch (e) { /* res */ }
      return null;
    }
    try { return JSON.parse(sessionStorage.getItem(DESAT)); } catch (e) { return null; }
  }
  function desa() {
    try { sessionStorage.setItem(DESAT, JSON.stringify(estat)); } catch (e) { /* sense emmagatzematge: continua igual */ }
  }

  /* Tipus preseleccionat des de la home: calculadora.html?tipo=solar */
  var params = new URLSearchParams(location.search);
  var tipoUrl = params.get('tipo');
  if (tipoUrl && /^(solar|bateria|aerotermia|ambas)$/.test(tipoUrl) && !estat.respostes.tipo) {
    var boto = $('[data-pas="tipo"] .calc-op[data-valor="' + tipoUrl + '"]');
    if (boto) { estat.respostes.tipo = { valor: tipoUrl }; estat.pas = 1; }
  }

  /* ── Pintar un pas ─────────────────────────────────────────────────── */
  function pantalla(nom) { return $('.calc-pas[data-pas="' + nom + '"]'); }

  function mostra(index, enrere) {
    index = Math.max(0, Math.min(index, PASSOS.length - 1));
    // Sense resultat verificat no es pot anar al pas del resultat.
    if (PASSOS[index] === 'resultat' && !estat.resultat) index = PASSOS.indexOf('correu');
    // Sense totes les respostes no es pot passar de les preguntes.
    for (var i = 0; i < PREGUNTES.length && i < index; i++) {
      if (!estat.respostes[PREGUNTES[i]]) { index = i; break; }
    }
    estat.pas = index;
    desa();

    var nom = PASSOS[index];
    $$('.calc-pas').forEach(function (s) { s.hidden = s.getAttribute('data-pas') !== nom; });
    var actual = pantalla(nom);
    actual.classList.remove('entra', 'entra-enrere');
    if (!redueix) { void actual.offsetWidth; actual.classList.add(enrere ? 'entra-enrere' : 'entra'); }

    if (nom === 'mida') preparaSlider();
    marcaEscollides(actual);

    var fetes = Math.min(index, PREGUNTES.length);
    $('.calc-progres i').style.transform = 'scaleX(' + (fetes / PREGUNTES.length) + ')';
    $('.calc-progres').setAttribute('aria-valuenow', String(fetes));
    $('[data-calc-num]').textContent = String(Math.min(index + 1, PREGUNTES.length));
    $('.calc-comptador').hidden = index >= PREGUNTES.length;
    $('[data-calc-enrere]').hidden = index === 0 || nom === 'resultat';
    // Al resultat, el resum ja surt sota el preu: fora la capçalera i els xips.
    $('.calc-cap').hidden = nom === 'resultat';
    $('[data-calc-resum]').hidden = nom === 'resultat';

    pintaResum();
    if (nom === 'correu') preparaCaptcha();
    if (nom === 'codi') { $('[data-calc-correu]').textContent = estat.correu; $('.calc-codi input').focus(); }
    if (nom === 'resultat') pintaResultat();

    var titol = actual.querySelector('[tabindex="-1"]');
    if (titol && nom !== 'codi') titol.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: redueix ? 'auto' : 'smooth' });
  }

  function etiqueta(pregunta) {
    var r = estat.respostes[pregunta];
    if (!r) return '';
    if (pregunta === 'mida') return format(Number(r.valor), escala().unitat);
    var dins = pantalla(pregunta);
    var op = dins.querySelector('.calc-op[data-valor="' + r.valor + '"] .calc-op-nom');
    return op ? op.textContent.trim() : r.valor;
  }

  function marcaEscollides(seccio) {
    var pregunta = seccio.getAttribute('data-pas');
    var r = estat.respostes[pregunta];
    $$('.calc-op', seccio).forEach(function (b) {
      b.setAttribute('aria-pressed', r && b.getAttribute('data-valor') === r.valor ? 'true' : 'false');
    });
  }

  function pintaResum() {
    var llista = $('[data-calc-resum]');
    llista.innerHTML = '';
    PREGUNTES.forEach(function (p, i) {
      if (!estat.respostes[p] || i >= estat.pas) return;
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = etiqueta(p);
      b.setAttribute('aria-label', I18N.t('Cambiar esta respuesta') + ': ' + etiqueta(p));
      b.addEventListener('click', function () { mostra(i, true); });
      li.appendChild(b);
      llista.appendChild(li);
    });
  }

  /* ── Respondre: un clic i avança ───────────────────────────────────── */
  PREGUNTES.forEach(function (pregunta, i) {
    pantalla(pregunta).addEventListener('click', function (e) {
      var b = e.target.closest('.calc-op');
      if (!b) return;
      var abans = estat.respostes[pregunta] && estat.respostes[pregunta].valor;
      estat.respostes[pregunta] = { valor: b.getAttribute('data-valor') };
      // Canviar el tipus invalida la mida (els trams són diferents).
      if (pregunta === 'tipo' && abans && abans !== estat.respostes.tipo.valor) delete estat.respostes.mida;
      estat.resultat = null;
      marcaEscollides(pantalla(pregunta));
      setTimeout(function () { mostra(i + 1); }, redueix ? 0 : 220);
    });
  });

  /* ── Magnitud: factura de llum (plaques) o superfície (aerotèrmia) ──
     L'escala depèn del tipus. Els dos títols són a l'HTML; se n'ensenya un.
     No avança sol en deixar-lo anar (seria massa brusc): «Continuar» o Enter. */
  var ESCALA = {
    solar: { min: 30, max: 300, pas: 5, inici: 90, unitat: 'euro' },
    bateria: { min: 30, max: 300, pas: 5, inici: 110, unitat: 'euro' },
    aerotermia: { min: 50, max: 250, pas: 5, inici: 110, unitat: 'm2' },
    ambas: { min: 50, max: 250, pas: 5, inici: 120, unitat: 'm2' }
  };
  function escala() { return ESCALA[estat.respostes.tipo.valor]; }
  function format(v, unitat) {
    var n = v.toLocaleString((window.I18N && window.I18N.bcp) || 'es-ES');
    return unitat === 'euro' ? I18N.t('{n} € al mes', { n: n }) : n + ' m²';
  }
  var slider = $('#calc-metres');
  function pintaMetres() {
    var e = escala();
    var v = Number(slider.value);
    $('[data-calc-m2-num]').textContent = v.toLocaleString((window.I18N && window.I18N.bcp) || 'es-ES');
    slider.setAttribute('aria-valuetext', format(v, e.unitat));
    slider.style.setProperty('--pct', ((v - e.min) / (e.max - e.min) * 100) + '%');
  }
  function preparaSlider() {
    var e = escala();
    var mida = pantalla('mida');
    $$('[data-unitat]', mida).forEach(function (el) { el.hidden = el.getAttribute('data-unitat') !== e.unitat; });
    slider.setAttribute('aria-label', e.unitat === 'euro' ? I18N.t('Factura de luz al mes, en euros') : I18N.t('Superficie de la vivienda, en metros cuadrados'));
    slider.min = String(e.min);
    slider.max = String(e.max);
    slider.step = String(e.pas);
    var desat = estat.respostes.mida ? Number(estat.respostes.mida.valor) : NaN;
    slider.value = String(desat >= e.min && desat <= e.max ? desat : e.inici);
    $('[data-calc-min]').textContent = format(e.min, e.unitat);
    $('[data-calc-max]').textContent = format(e.max, e.unitat);
    pintaMetres();
  }
  function confirmaMetres() {
    estat.respostes.mida = { valor: String(slider.value) };
    estat.resultat = null;
    mostra(PREGUNTES.indexOf('mida') + 1);
  }
  slider.addEventListener('input', pintaMetres);
  slider.addEventListener('keydown', function (e) { if (e.key === 'Enter') confirmaMetres(); });
  $('[data-calc-continua]').addEventListener('click', confirmaMetres);

  /* Teclat: 1–4 trien opció a les preguntes. */
  document.addEventListener('keydown', function (e) {
    if (e.target.closest('input, textarea, select')) return;
    var nom = PASSOS[estat.pas];
    if (PREGUNTES.indexOf(nom) < 0 || !/^[1-4]$/.test(e.key)) return;
    var visibles = $$('.calc-op', pantalla(nom)).filter(function (b) { return !b.closest('[hidden]'); });
    var b = visibles[Number(e.key) - 1];
    if (b) b.click();
  });

  $('[data-calc-enrere]').addEventListener('click', function () { mostra(estat.pas - 1, true); });

  /* ── Correu + captcha ──────────────────────────────────────────────── */
  var widget = null;
  function preparaCaptcha() {
    if (widget !== null) return;
    var render = function () {
      if (!window.turnstile || widget !== null) return;
      widget = window.turnstile.render('#calc-turnstile', {
        sitekey: TURNSTILE_SITEKEY,
        language: document.documentElement.lang || 'es',
        appearance: 'interaction-only'
      });
    };
    if (window.turnstile) return render();
    window.vatioJustoTurnstile = render;
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=vatioJustoTurnstile';
    s.async = true;
    document.head.appendChild(s);
  }

  function error(seccio, text) {
    var p = $('[data-calc-error]', pantalla(seccio));
    p.textContent = text || '';
  }

  function envia(url, dades) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(dades)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; j.ok = r.ok && j.ok !== false; return j; });
    });
  }

  function respostesPerEnviar() {
    var out = {};
    PREGUNTES.forEach(function (p) { out[p] = estat.respostes[p].valor; });
    return out;
  }

  var formCorreu = $('[data-calc-form-correu]');
  formCorreu.addEventListener('submit', function (e) {
    e.preventDefault();
    var camp = formCorreu.elements.email;
    var correu = camp.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correu)) {
      camp.setAttribute('aria-invalid', 'true');
      camp.focus();
      return error('correu', I18N.t('Escribe un correo válido, por ejemplo nombre@gmail.com.'));
    }
    camp.setAttribute('aria-invalid', 'false');
    var token = window.turnstile && widget !== null ? window.turnstile.getResponse(widget) : '';
    if (!token) return error('correu', I18N.t('Espera un momento a que termine la comprobación de seguridad y vuelve a pulsar.'));

    var boto = formCorreu.querySelector('button[type="submit"]');
    var text = boto.textContent;
    boto.disabled = true;
    boto.textContent = I18N.t('Enviando…');
    error('correu', '');
    envia('/api/codi', { correu: correu, token: token, idioma: document.documentElement.lang || 'es' })
      .then(function (j) {
        if (j.ok) {
          estat.correu = correu;
          mostra(PASSOS.indexOf('codi'));
          compteEnrere();
        } else if (j.status === 429) {
          error('correu', I18N.t('Has pedido demasiados códigos. Espera unos minutos y vuelve a intentarlo.'));
        } else if (j.error === 'captcha') {
          error('correu', I18N.t('No hemos podido confirmar que no eres un robot. Vuelve a intentarlo.'));
        } else {
          error('correu', I18N.t('No hemos podido enviar el código. Inténtalo de nuevo en unos minutos.'));
        }
      })
      .catch(function () { error('correu', I18N.t('No hemos podido enviar el código. Inténtalo de nuevo en unos minutos.')); })
      .finally(function () {
        boto.disabled = false;
        boto.textContent = text;
        if (window.turnstile && widget !== null) window.turnstile.reset(widget);
      });
  });

  /* ── Codi de 6 xifres ─────────────────────────────────────────────── */
  var caselles = $$('.calc-codi input');
  function codi() { return caselles.map(function (c) { return c.value; }).join(''); }
  function omple(xifres) {
    xifres = xifres.replace(/\D/g, '').slice(0, 6);
    caselles.forEach(function (c, i) { c.value = xifres[i] || ''; });
    var seguent = caselles[Math.min(xifres.length, 5)];
    if (seguent) seguent.focus();
    if (xifres.length === 6) verifica();
  }
  caselles.forEach(function (c, i) {
    c.addEventListener('input', function () {
      if (c.value.length > 1) return omple(c.value);  // enganxat o autocompletat del mòbil
      c.value = c.value.replace(/\D/g, '');
      if (c.value && caselles[i + 1]) caselles[i + 1].focus();
      if (codi().length === 6) verifica();
    });
    c.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && !c.value && caselles[i - 1]) caselles[i - 1].focus();
    });
    c.addEventListener('paste', function (e) {
      e.preventDefault();
      omple((e.clipboardData || window.clipboardData).getData('text'));
    });
  });

  var verificant = false;
  function verifica() {
    if (verificant) return;
    verificant = true;
    error('codi', '');
    envia('/api/verifica', { correu: estat.correu, codi: codi(), respostes: respostesPerEnviar(), idioma: document.documentElement.lang || 'es' })
      .then(function (j) {
        if (j.ok && typeof j.min === 'number' && typeof j.max === 'number') {
          estat.resultat = {
            min: j.min, max: j.max, estalviMin: j.estalviMin, estalviMax: j.estalviMax,
            retornMin: j.retornMin, retornMax: j.retornMax, kwp: j.kwp, placas: j.placas, kw: j.kw, bateria: !!j.bateria,
            wa: String(j.whatsapp || '').replace(/\D/g, '') };
          mostra(PASSOS.indexOf('resultat'));
        } else {
          omple('');
          if (j.error === 'caducat') error('codi', I18N.t('El código ha caducado. Pide uno nuevo.'));
          else if (j.status === 429) error('codi', I18N.t('Demasiados intentos. Pide un código nuevo.'));
          else error('codi', I18N.t('El código no es correcto. Revísalo y vuelve a escribirlo.'));
        }
      })
      .catch(function () { error('codi', I18N.t('No hemos podido comprobar el código. Inténtalo de nuevo.')); })
      .finally(function () { verificant = false; });
  }

  var reenvia = $('[data-calc-reenvia]');
  var rellotge = null;
  function compteEnrere() {
    var s = 30;
    reenvia.disabled = true;
    clearInterval(rellotge);
    rellotge = setInterval(function () {
      s--;
      if (s <= 0) { clearInterval(rellotge); reenvia.disabled = false; }
    }, 1000);
  }
  reenvia.addEventListener('click', function () { mostra(PASSOS.indexOf('correu'), true); });
  $('[data-calc-canvia-correu]').addEventListener('click', function () { mostra(PASSOS.indexOf('correu'), true); });

  /* ── Resultat i WhatsApp ───────────────────────────────────────────── */
  function euros(n) {
    return n.toLocaleString((window.I18N && window.I18N.bcp) || 'es-ES', { maximumFractionDigits: 0, useGrouping: 'always' }) + ' €';
  }

  function instalacio(r) {
    var parts = [];
    var bcp = (window.I18N && window.I18N.bcp) || 'es-ES';
    if (r.kwp) parts.push(I18N.t('{kwp} kWp, {n} placas', { kwp: r.kwp.toLocaleString(bcp), n: r.placas }));
    if (r.bateria) parts.push(I18N.t('batería de 5 kWh'));
    if (r.kw) parts.push(I18N.t('bomba de calor de {kw} kW', { kw: r.kw }));
    return parts.join(' + ');
  }

  function pintaResultat() {
    var r = estat.resultat;
    var rang = euros(r.min) + ' – ' + euros(r.max);
    $('[data-calc-preu]').textContent = rang;
    $('[data-calc-instal]').textContent = instalacio(r);
    $('[data-calc-estalvi]').textContent = euros(r.estalviMin) + ' – ' + euros(r.estalviMax);
    $('[data-calc-retorn]').textContent = I18N.t('entre {a} y {b} años', { a: r.retornMin, b: r.retornMax });
    $('[data-calc-avis-piso]').hidden = estat.respostes.vivienda.valor !== 'piso';

    var llista = $('[data-calc-resultat-resum]');
    llista.innerHTML = '';
    var resum = PREGUNTES.map(function (p) { return etiqueta(p); });
    resum.forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = t;
      llista.appendChild(li);
    });

    var missatge = I18N.t('Hola, he usado la calculadora de Vatio Justo: {resumen}. Me sale {instalacion} por {rango}. ¿Cuándo podríais venir a verlo?')
      .replace('{resumen}', resum.slice(0, 4).join(' · '))
      .replace('{instalacion}', instalacio(r))
      .replace('{rango}', rang);
    var wa = $('[data-calc-wa]');
    wa.hidden = !r.wa;
    wa.href = 'https://wa.me/' + r.wa + '?text=' + encodeURIComponent(missatge);
  }

  $('[data-calc-reinicia]').addEventListener('click', function () {
    estat = { pas: 0, respostes: {}, correu: estat.correu, resultat: null };
    mostra(0, true);
  });

  mostra(estat.pas);
})();
