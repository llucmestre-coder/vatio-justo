/* =========================================================================
   VATIO JUSTO — comportament
   - Sense JS o amb prefers-reduced-motion, tot el contingut es veu igual.
   - Textos escrits des del JS: sempre I18N.t amb la frase castellana literal,
     perquè el verificador i l'extractor d'idiomes els trobin.
   ========================================================================= */
(function () {
  'use strict';

  if (!window.I18N) window.I18N = { t: function (s) { return s; } };
  var redueix = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Menú mòbil ─────────────────────────────────────────────────────── */
  var obre = document.querySelector('.nav-obre');
  var nav = document.getElementById('nav');
  if (obre && nav) {
    var tanca = function () {
      obre.setAttribute('aria-expanded', 'false');
      nav.classList.remove('obert');
    };
    obre.addEventListener('click', function () {
      var obert = obre.getAttribute('aria-expanded') === 'true';
      obre.setAttribute('aria-expanded', String(!obert));
      nav.classList.toggle('obert', !obert);
    });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) tanca(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && obre.getAttribute('aria-expanded') === 'true') { tanca(); obre.focus(); }
    });
  }

  /* Pàgina actual al menú */
  var aqui = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach(function (a) {
    if (a.getAttribute('href') === aqui) a.setAttribute('aria-current', 'page');
  });

  /* ── Tu día en vatios: pestanyes + dibuix d'un sol tret ─────────────── */
  var grafic = document.querySelector('[data-grafic]');
  if (grafic) {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-tab]'));
    var tria = function (nom, enfoca) {
      tabs.forEach(function (t) {
        var si = t.getAttribute('data-tab') === nom;
        t.setAttribute('aria-selected', String(si));
        t.tabIndex = si ? 0 : -1;
        if (si && enfoca) t.focus();
      });
      grafic.querySelectorAll('[data-escenari]').forEach(function (g) {
        if (g.getAttribute('data-escenari') === nom) g.removeAttribute('hidden'); else g.setAttribute('hidden', '');
      });
      document.querySelectorAll('[data-escenari-text]').forEach(function (p) {
        p.hidden = p.getAttribute('data-escenari-text') !== nom;
      });
      grafic.querySelectorAll('[data-nomes]').forEach(function (li) {
        li.hidden = li.getAttribute('data-nomes') !== nom;
      });
    };
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { tria(t.getAttribute('data-tab')); });
      t.addEventListener('keydown', function (e) {
        var n = null;
        if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
        if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
        if (e.key === 'Home') n = 0;
        if (e.key === 'End') n = tabs.length - 1;
        if (n === null) return;
        e.preventDefault();
        tria(tabs[n].getAttribute('data-tab'), true);
      });
    });
    tria('sin');

    if (!redueix && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entrades) {
        entrades.forEach(function (e) {
          if (!e.isIntersecting) return;
          grafic.classList.add('vist');
          io.disconnect();
        });
      }, { rootMargin: '0px 0px -30% 0px' });
      io.observe(grafic);
    } else {
      grafic.classList.add('vist');
    }
  }

  /* ── Visor de fotos ─────────────────────────────────────────────────── */
  var visor = document.querySelector('[data-visor-dialog]');
  if (visor && typeof visor.showModal === 'function') {
    var vImg = visor.querySelector('img');
    var vText = visor.querySelector('p');
    var origen = null;
    document.querySelectorAll('[data-visor]').forEach(function (b) {
      b.addEventListener('click', function () {
        origen = b;
        vImg.src = b.getAttribute('data-visor');
        vImg.alt = b.querySelector('img') ? b.querySelector('img').alt : '';
        vText.textContent = b.getAttribute('data-visor-text') || '';
        visor.showModal();
      });
    });
    visor.querySelector('[data-visor-tanca]').addEventListener('click', function () { visor.close(); });
    visor.addEventListener('click', function (e) { if (e.target === visor) visor.close(); });
    visor.addEventListener('close', function () { if (origen) origen.focus(); });
  }

  /* ── Formulari de contacte (Formspree, enviament real) ──────────────── */
  var form = document.getElementById('form-contacto');
  if (form) {
    var estat = form.querySelector('.form-estat');
    var boto = form.querySelector('button[type="submit"]');
    var textBoto = boto ? boto.textContent : '';
    var mostra = function (tipus, missatge) {
      estat.hidden = false;
      estat.setAttribute('data-tipus', tipus);
      estat.textContent = missatge;
      estat.focus();
    };
    var marca = function (camp, error) {
      var caixa = camp.closest('.camp');
      var msg = caixa && caixa.querySelector('.camp-error');
      camp.setAttribute('aria-invalid', error ? 'true' : 'false');
      if (msg) msg.textContent = error || '';
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var nom = form.elements['nombre'];
      var correu = form.elements['email'];
      var missatge = form.elements['mensaje'];
      var errors = 0;
      marca(nom, nom.value.trim() ? '' : I18N.t('Escribe tu nombre.'));
      if (!nom.value.trim()) errors++;
      var correuOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correu.value.trim());
      marca(correu, correuOk ? '' : I18N.t('Escribe un correo válido.'));
      if (!correuOk) errors++;
      marca(missatge, missatge.value.trim() ? '' : I18N.t('Cuéntanos qué necesitas.'));
      if (!missatge.value.trim()) errors++;
      if (errors) {
        var primer = form.querySelector('[aria-invalid="true"]');
        if (primer) primer.focus();
        return;
      }

      boto.disabled = true;
      boto.textContent = I18N.t('Enviando…');
      fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' }
      }).then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        form.reset();
        mostra('ok', I18N.t('Recibido. Te contestamos hoy mismo o mañana por la mañana.'));
      }).catch(function () {
        mostra('error', I18N.t('No se ha podido enviar. Llámanos al 600 000 000 y te atendemos directamente.'));
      }).finally(function () {
        boto.disabled = false;
        boto.textContent = textBoto;
      });
    });
  }
})();
