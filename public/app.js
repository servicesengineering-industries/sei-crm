(function () {
  'use strict';

  // Ask before destructive submits (forms carrying data-confirm).
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // Mobile menu.
  var toggle = document.querySelector('[data-nav-toggle]');
  var side = document.getElementById('side');
  if (toggle && side) {
    toggle.addEventListener('click', function () {
      var open = side.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (side.classList.contains('open') && !side.contains(e.target) && e.target !== toggle) side.classList.remove('open');
    });
  }

  // Contact, RFQ, PO and invoice pickers only show the chosen client's records.
  function scope(form) {
    var clientSelect = form.querySelector('select[data-client-select]');
    if (!clientSelect) return;
    var id = clientSelect.value;
    form.querySelectorAll('select[data-scoped]').forEach(function (s) {
      s.querySelectorAll('option[data-client]').forEach(function (o) {
        var hide = !!id && o.getAttribute('data-client') !== id;
        o.hidden = hide;
        o.disabled = hide;
        if (hide && o.selected) s.value = '';
      });
      s.querySelectorAll('optgroup').forEach(function (g) {
        g.hidden = !Array.prototype.some.call(g.children, function (o) { return !o.hidden; });
      });
    });
  }
  document.querySelectorAll('form').forEach(function (f) {
    if (!f.querySelector('select[data-client-select]')) return;
    scope(f);
    f.addEventListener('change', function (e) {
      if (e.target.matches('select[data-client-select]')) scope(f);
    });
  });

  // Filter dropdowns apply as soon as they change.
  document.querySelectorAll('form[data-autosubmit] select').forEach(function (s) {
    s.addEventListener('change', function () { s.form.submit(); });
  });

  // Press / to jump to search.
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    var input = document.querySelector('.search input');
    if (input) { e.preventDefault(); input.focus(); }
  });
})();
