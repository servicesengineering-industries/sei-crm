(function () {
  'use strict';

  // Ask before destructive submits (forms carrying data-confirm).
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // Mobile menu: opening it moves focus into it; Escape or a tap outside closes it.
  var toggle = document.querySelector('[data-nav-toggle]');
  var side = document.getElementById('side');
  if (toggle && side) {
    var setOpen = function (open, refocus) {
      side.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        var first = side.querySelector('.nav a');
        if (first) first.focus();
      } else if (refocus) toggle.focus();
    };
    toggle.addEventListener('click', function () { setOpen(!side.classList.contains('open'), false); });
    document.addEventListener('click', function (e) {
      if (side.classList.contains('open') && !side.contains(e.target) && e.target !== toggle) setOpen(false, false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && side.classList.contains('open')) setOpen(false, true);
    });
  }

  // Wide screens: the menu strip moves sideways with its arrows, the mouse wheel or a touchpad swipe.
  var strip = side && side.querySelector('.nav');
  var arrows = document.querySelectorAll('.strip-arrow');
  if (strip && arrows.length) {
    var wide = window.matchMedia('(min-width: 901px)');
    var stripMax = function () { return strip.scrollWidth - strip.clientWidth; };
    var updateArrows = function () {
      arrows.forEach(function (b) {
        var back = Number(b.getAttribute('data-strip')) < 0;
        b.disabled = !wide.matches || stripMax() <= 1 || (back ? strip.scrollLeft <= 1 : strip.scrollLeft >= stripMax() - 1);
      });
    };
    arrows.forEach(function (b) {
      b.addEventListener('click', function () {
        strip.scrollBy({ left: Number(b.getAttribute('data-strip')) * strip.clientWidth * 0.8, behavior: 'smooth' });
      });
    });
    // An up/down wheel turn moves the strip sideways; a sideways touchpad swipe works by itself.
    strip.addEventListener('wheel', function (e) {
      if (!wide.matches || stripMax() <= 0 || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      e.preventDefault();
      strip.scrollBy({ left: e.deltaY, behavior: 'auto' });
    }, { passive: false });
    strip.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    // Start with the current page's item in the middle of the strip.
    var current = strip.querySelector('.is-active');
    if (current && wide.matches) {
      var at = current.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
      strip.scrollLeft = at - (strip.clientWidth - current.offsetWidth) / 2;
    }
    updateArrows();
  }

  // Phones: close the filter fold, unless a filter is in use, so the list shows first.
  if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) {
    document.querySelectorAll('details.ffold:not([data-active])').forEach(function (d) { d.open = false; });
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

  // New PO: choosing the RFQ it came from fills in the client, part, part no and rate, where they
  // are still empty. Nothing already typed is changed.
  document.querySelectorAll('form select[name=rfq_id]').forEach(function (s) {
    var f = s.form;
    if (!f || !f.elements.part_name) return;
    s.addEventListener('change', function () {
      var o = s.options[s.selectedIndex];
      if (!o || !o.value) return;
      var put = function (name, value) {
        var el = f.elements[name];
        if (el && !el.value && value) el.value = value;
      };
      var client = f.querySelector('select[data-client-select]');
      if (client && !client.value && o.getAttribute('data-client')) {
        client.value = o.getAttribute('data-client');
        client.dispatchEvent(new Event('change', { bubbles: true }));
      }
      put('part_name', o.getAttribute('data-part'));
      put('part_no', o.getAttribute('data-part-no'));
      put('unit_price', o.getAttribute('data-price'));
    });
  });

  // Filter dropdowns apply as soon as they are picked with a mouse or a finger. With the keyboard,
  // the arrow keys only move through the choices; Apply (or Enter in the search box) applies them.
  var byPointer = false;
  document.addEventListener('pointerdown', function () { byPointer = true; }, true);
  document.addEventListener('keydown', function () { byPointer = false; }, true);
  document.querySelectorAll('form[data-autosubmit] select').forEach(function (s) {
    s.addEventListener('change', function () { if (byPointer) s.form.submit(); });
  });

  // After a failed save, focus goes to the error summary, so a screen reader reads it first.
  var summary = document.querySelector('[data-focus]');
  if (summary) summary.focus();

  // Checklists: ask for a note on Not OK or on a reading outside its limits, and check the
  // photos before sending, so the phone catches it and no answer or photo is lost.
  function checkNote(item) {
    var note = item.querySelector('.cl-note');
    if (!note) return;
    var bad = false;
    var picked = item.querySelector('input[type=radio]:checked');
    if (picked) bad = picked.value === 'not_ok';
    var reading = item.querySelector('.cl-reading input');
    if (reading && reading.value.trim() !== '') {
      var n = Number(reading.value.replace(/,/g, ''));
      var min = item.getAttribute('data-min');
      var max = item.getAttribute('data-max');
      bad = !isNaN(n) && ((min !== null && n < Number(min)) || (max !== null && n > Number(max)));
    }
    note.required = bad;
  }
  function checkFiles(input) {
    var maxFiles = Number(input.getAttribute('data-max-files'));
    var maxBytes = Number(input.getAttribute('data-max-mb')) * 1024 * 1024;
    var msg = '';
    if (input.files.length > maxFiles) msg = 'Choose ' + maxFiles + ' files or fewer.';
    for (var i = 0; !msg && i < input.files.length; i++) {
      if (input.files[i].size > maxBytes) msg = input.files[i].name + ' is larger than ' + input.getAttribute('data-max-mb') + ' MB. Choose a smaller photo.';
    }
    input.setCustomValidity(msg);
    if (msg) input.reportValidity();
  }
  document.querySelectorAll('form.cl-form').forEach(function (f) {
    f.querySelectorAll('.cl-item').forEach(checkNote);
    var onChange = function (e) {
      var item = e.target.closest && e.target.closest('.cl-item');
      if (item) checkNote(item);
      if (e.target.matches && e.target.matches('input[type=file][data-max-files]')) checkFiles(e.target);
    };
    f.addEventListener('change', onChange);
    f.addEventListener('input', onChange);
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
