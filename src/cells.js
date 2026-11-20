'use strict';
// Small renderers used by list tables and pages. Every one returns escaped HTML.
const { html } = require('./html');
const F = require('./format');

const TONE = {
  Active: 'ok', Prospect: 'info', Dormant: 'muted', Lost: 'bad',
  New: 'info', Costing: 'info', Quoted: 'warn', Negotiation: 'warn', Won: 'ok', Regretted: 'muted', 'On hold': 'muted',
  Open: 'info', Closed: 'ok', Cancelled: 'muted', Done: 'ok',
  Minor: 'muted', Major: 'warn', Critical: 'bad',
  'Containment done': 'warn', 'Root cause found': 'warn', 'Action taken': 'info',
  Call: 'muted', Visit: 'info', Meeting: 'info', Email: 'muted', WhatsApp: 'muted', Note: 'muted',
};

const dash = html`<span class="dim">—</span>`;
const badge = (v, tone) => (v ? html`<span class="badge tone-${tone || TONE[v] || 'muted'}">${v}</span>` : dash);
const date = (v) => (v ? html`<span class="nowrap">${F.fmtDate(v)}</span>` : dash);

// A due date that turns amber when close and red when past, while `active`.
function due(v, active) {
  if (!v) return dash;
  const late = F.daysBetween(v, F.today());
  if (active && late > 0) {
    return html`<span class="nowrap tone-text-bad">${F.fmtDate(v)}<span class="sub">${F.plural(late, 'day')} late</span></span>`;
  }
  if (active && late >= -3) {
    const when = late === 0 ? 'today' : `in ${F.plural(-late, 'day')}`;
    return html`<span class="nowrap tone-text-warn">${F.fmtDate(v)}<span class="sub">${when}</span></span>`;
  }
  return date(v);
}

const money = (v) => (v == null ? dash : html`<span class="num">${F.money(v)}</span>`);
const money2 = (v) => (v == null ? dash : html`<span class="num">${F.money2(v)}</span>`);
const int = (v) => (v == null ? dash : html`<span class="num">${F.num(v)}</span>`);
const text = (v) => (v == null || v === '' ? dash : v);
const tel = (v) => (v ? html`<a class="nowrap" href="tel:${String(v).replace(/[^\d+]/g, '')}">${v}</a>` : dash);
// Plain addresses only: no ?, &, %, # or other characters that would add cc/body to a mailto link.
const EMAIL_RE = /^[^\s@?&%#/\\<>"'`,;:()[\]]+@[^\s@?&%#/\\<>"'`,;:()[\]]+\.[^\s@?&%#/\\<>"'`,;:()[\]]+$/;
const email = (v) => (v ? (EMAIL_RE.test(v) ? html`<a href="mailto:${v}">${v}</a>` : v) : dash);
const clip = (s, n = 80) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');

function withReturn(href, ctx) {
  if (!ctx) return href;
  const ret = ctx.url.pathname + ctx.url.search;
  return `${href}${href.includes('?') ? '&' : '?'}return=${encodeURIComponent(ret)}`;
}

const csrf = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.session.csrf}">`;
const client = (r) => html`<a href="/clients/${r.client_id}">${r.client_name}</a>`;
const edit = (key, r, label, sub, ctx) =>
  html`<a class="rowlink" href="${withReturn(`/${key}/${r.id}/edit`, ctx)}">${label || '(untitled)'}</a>${sub ? html`<span class="sub">${sub}</span>` : ''}`;

function doneButton(r, ctx) {
  return html`<form method="post" action="/followups/${r.id}/done" class="inline">${csrf(ctx)}<input type="hidden" name="return" value="${ctx.url.pathname + ctx.url.search}"><button type="submit" class="btn btn-sm">Done</button></form>`;
}

module.exports = { TONE, EMAIL_RE, dash, badge, date, due, money, money2, int, text, tel, email, clip, withReturn, csrf, client, edit, doneButton };
