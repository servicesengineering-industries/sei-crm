'use strict';
// Tagged template that escapes every interpolated value unless it is already SafeHtml.
// Arrays are joined, null/undefined/booleans render as nothing.

class SafeHtml {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);

function render(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

const raw = (s) => new SafeHtml(String(s));
const attrIf = (cond, attr) => (cond ? raw(` ${attr}`) : '');

module.exports = { html, raw, esc, attrIf, SafeHtml };
