'use strict';
const { html, raw, attrIf } = require('./html');
const F = require('./format');
const C = require('./cells');
const { ROLES, isAdmin } = require('./auth');

const ASSET_V = '8';
// SEI's ring mark, from the brand.
const MARK = raw('<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 5.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z"/></svg>');
const FONT_PRELOAD = raw('<link rel="preload" href="/static/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/static/fonts/instrument-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>');

const NAV = [
  { href: '/', label: 'Dashboard', key: 'dashboard' },
  { href: '/clients', label: 'Clients', key: 'clients' },
  { href: '/contacts', label: 'Contacts', key: 'contacts' },
  { href: '/followups', label: 'Follow-ups', key: 'followups', count: 'followups', countTitle: 'Due today or overdue, assigned to you' },
  { href: '/activities', label: 'Activity log', key: 'activities' },
  { sep: 'Business' },
  { href: '/rfqs', label: 'RFQs & quotes', key: 'rfqs' },
  { href: '/orders', label: 'Orders & deliveries', key: 'orders', count: 'late', countTitle: 'Late POs' },
  { href: '/invoices', label: 'Invoices & dues', key: 'invoices', count: 'overdueInv', countTitle: 'Overdue invoices' },
  { href: '/complaints', label: 'Quality complaints', key: 'complaints', count: 'complaints', countTitle: 'Open complaints' },
];

function navCounts(ctx) {
  const t = F.today();
  const db = ctx.db;
  return {
    followups: db.get("SELECT COUNT(*) AS n FROM followups WHERE status = 'Open' AND due_on <= :t AND assigned_to = :u", { t, u: ctx.user.id }).n,
    late: db.get("SELECT COUNT(*) AS n FROM v_orders WHERE status = 'Open' AND pending > 0 AND due_on < :t", { t }).n,
    overdueInv: db.get('SELECT COUNT(*) AS n FROM v_invoices WHERE balance > 0.5 AND due_on < :t', { t }).n,
    complaints: db.get("SELECT COUNT(*) AS n FROM complaints WHERE status <> 'Closed'").n,
  };
}

function navItem(n, active, count) {
  const on = n.key === active;
  return html`<a class="nav-item${on ? ' is-active' : ''}" href="${n.href}"${attrIf(on, 'aria-current="page"')}><span>${n.label}</span>${count ? html`<span class="nav-count" title="${n.countTitle || ''}">${count}</span>` : ''}</a>`;
}

function layout(ctx, { title, body, active }) {
  const u = ctx.user;
  const counts = navCounts(ctx);
  const flash = ctx.takeFlash();
  const items = NAV.map((n) => (n.sep ? html`<div class="nav-sep">${n.sep}</div>` : navItem(n, active, counts[n.count])));
  if (isAdmin(u)) items.push(html`<div class="nav-sep">Admin</div>`, navItem({ href: '/users', label: 'Users', key: 'users' }, active));
  const q = ctx.path === '/search' ? ctx.query.q || '' : '';
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · SEI CRM</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
${FONT_PRELOAD}
<link rel="stylesheet" href="/static/app.css?v=${ASSET_V}">
<script src="/static/app.js?v=${ASSET_V}" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="shell">
  <aside class="side" id="side">
    <a class="brand" href="/" aria-label="SEI Client CRM, dashboard">${MARK}<span class="brand-word">SEI</span><span class="brand-sub">Client CRM</span></a>
    <nav class="nav" aria-label="Main">${items}</nav>
    <div class="side-foot">${ctx.cfg.companyName}</div>
  </aside>
  <div class="main">
    <header class="top">
      <button class="nav-toggle" type="button" data-nav-toggle aria-controls="side" aria-label="Open menu">Menu</button>
      <form class="search" action="/search" method="get" role="search">
        <input type="search" name="q" value="${q}" placeholder="Search clients, people, phone, part, PO or invoice no" aria-label="Search">
      </form>
      <div class="me">
        <span class="me-who"><span class="me-name">${u.name}</span><span class="me-role">${ROLES[u.role] || u.role}</span></span>
        <a class="me-link" href="/account/password">Password</a>
        <form method="post" action="/logout" class="inline">${C.csrf(ctx)}<button class="linklike" type="submit">Sign out</button></form>
      </div>
    </header>
    ${ctx.cfg.demo ? html`<div class="demo-banner" role="note">Demo database. Every record here is made up for trying the app out.</div>` : ''}
    <main class="content" id="main">
      ${flash ? html`<div class="alert alert-${flash.type === 'error' ? 'error' : 'ok'}" role="status">${flash.msg}</div>` : ''}
      ${body}
    </main>
  </div>
</div>
</body>
</html>`;
}

const pageHeader = (title, sub, actions) => html`<div class="ph"><div class="ph-text"><h1>${title}</h1>${sub ? html`<p class="ph-sub">${sub}</p>` : ''}</div>${actions ? html`<div class="ph-actions">${actions}</div>` : ''}</div>`;
const button = (href, label, variant = '') => html`<a class="btn${variant ? ` btn-${variant}` : ''}" href="${href}">${label}</a>`;

function table(cols, rows, { ctx, empty = 'Nothing here yet.', rowClass } = {}) {
  if (!rows.length) return html`<div class="empty">${empty}</div>`;
  return html`<div class="table-wrap"><table class="grid">
<thead><tr>${cols.map((c) => html`<th scope="col" class="${c.cls || ''}">${c.label}</th>`)}</tr></thead>
<tbody>${rows.map((r) => html`<tr class="${rowClass ? rowClass(r) : ''}">${cols.map((c) => html`<td class="${c.cls || ''}">${c.render ? c.render(r, ctx) : C.text(r[c.key])}</td>`)}</tr>`)}</tbody>
</table></div>`;
}

function tile({ label, value, sub, tone = '', href }) {
  const inner = html`<span class="tile-label">${label}</span><span class="tile-value">${value}</span>${sub ? html`<span class="tile-sub ${tone ? `tone-text-${tone}` : ''}">${sub}</span>` : ''}`;
  return href ? html`<a class="tile" href="${href}">${inner}</a>` : html`<div class="tile">${inner}</div>`;
}

const flags = (list) => (list.length ? html`<div class="flags">${list.map((f) => html`<span class="flag tone-${f.tone}">${f.text}</span>`)}</div>` : html`<span class="dim">All clear</span>`);

// ---------- forms ----------

const FK_SQL = {
  client: 'SELECT id, name AS label, NULL AS client_id, NULL AS grp FROM clients ORDER BY name',
  user: "SELECT id, name || CASE WHEN active = 0 THEN ' (disabled)' ELSE '' END AS label, NULL AS client_id, NULL AS grp FROM users WHERE active = 1 OR id = :cur ORDER BY name",
  contact: `SELECT ct.id, ct.name || COALESCE(' – ' || ct.designation, '') AS label, ct.client_id, c.name AS grp
            FROM contacts ct JOIN clients c ON c.id = ct.client_id WHERE ct.active = 1 OR ct.id = :cur
            ORDER BY c.name, ct.is_primary DESC, ct.name`,
  rfq: `SELECT r.id, r.part_name || COALESCE(' (' || r.part_no || ')', '') || ' – ' || r.status AS label, r.client_id, c.name AS grp
        FROM rfqs r JOIN clients c ON c.id = r.client_id ORDER BY c.name, r.received_on DESC`,
  order: `SELECT o.id, o.po_no || ' – ' || o.part_name || ' (pending ' || o.pending || ')' AS label, o.client_id, c.name AS grp
          FROM v_orders o JOIN clients c ON c.id = o.client_id WHERE o.status = 'Open' OR o.id = :cur
          ORDER BY c.name, o.due_on`,
  orderAll: `SELECT o.id, o.po_no || ' – ' || o.part_name || CASE WHEN o.status = 'Open' THEN '' ELSE ' (' || o.status || ')' END AS label, o.client_id, c.name AS grp
             FROM v_orders o JOIN clients c ON c.id = o.client_id
             ORDER BY c.name, CASE WHEN o.status = 'Open' THEN 0 ELSE 1 END, o.po_date DESC`,
  invoice: `SELECT i.id, i.invoice_no || ' – balance ₹' || CAST(ROUND(i.balance) AS INTEGER) AS label, i.client_id, c.name AS grp
            FROM v_invoices i JOIN clients c ON c.id = i.client_id WHERE i.balance > 0.5 OR i.id = :cur
            ORDER BY c.name, i.invoice_date`,
};
const SCOPED = new Set(['contact', 'rfq', 'order', 'invoice']);

function fkSelect(ctx, f, id, value, disabled) {
  // Dispatches only go against open POs; an invoice can point at any PO, including a closed one.
  const sql = f.type === 'order' && !f.openOnly ? FK_SQL.orderAll : FK_SQL[f.type];
  const rows = ctx.db.all(sql, { cur: value == null || value === '' ? -1 : Number(value) });
  const opt = (r) => html`<option value="${r.id}"${r.client_id != null ? html` data-client="${r.client_id}"` : ''}${attrIf(String(r.id) === String(value ?? ''), 'selected')}>${r.label}</option>`;
  let body;
  if (rows.some((r) => r.grp)) {
    const groups = new Map();
    for (const r of rows) { if (!groups.has(r.grp)) groups.set(r.grp, []); groups.get(r.grp).push(r); }
    body = [...groups].map(([g, list]) => html`<optgroup label="${g}">${list.map(opt)}</optgroup>`);
  } else {
    body = rows.map(opt);
  }
  return html`<select id="${id}" name="${f.name}"${attrIf(f.required, 'required')}${attrIf(disabled, 'disabled')}${attrIf(f.type === 'client', 'data-client-select')}${attrIf(SCOPED.has(f.type), 'data-scoped')}><option value="">${f.required ? 'Choose…' : '—'}</option>${body}</select>`;
}

function control(ctx, f, id, value, disabled) {
  const v = value ?? '';
  const common = html` id="${id}" name="${f.name}"${attrIf(f.required, 'required')}${attrIf(disabled, 'disabled')}`;
  switch (f.type) {
    case 'textarea': return html`<textarea${common} rows="${f.rows || 3}">${v}</textarea>`;
    case 'select': return html`<select${common}><option value="">${f.required ? 'Choose…' : '—'}</option>${f.options.map((o) => html`<option${attrIf(o === v, 'selected')}>${o}</option>`)}</select>`;
    case 'client': case 'contact': case 'user': case 'rfq': case 'order': case 'invoice': return fkSelect(ctx, f, id, value, disabled);
    case 'date': return html`<input type="date"${common} value="${v}">`;
    case 'int': return html`<input type="number" inputmode="numeric" step="1" min="${f.min ?? 0}"${common} value="${v}">`;
    case 'money': case 'money2': return html`<input type="text" inputmode="decimal" class="num"${common} value="${v}" autocomplete="off">`;
    case 'email': return html`<input type="email"${common} value="${v}" autocomplete="off">`;
    case 'tel': return html`<input type="tel"${common} value="${v}" autocomplete="off">`;
    case 'url': return html`<input type="url"${common} value="${v}" placeholder="https://">`;
    default: return html`<input type="text"${common} value="${v}">`;
  }
}

function fieldRow(ctx, f, value, error, disabled) {
  const id = `f_${f.name}`;
  const wide = f.type === 'textarea' || f.wide;
  if (f.type === 'checkbox') {
    const on = value === 1 || value === '1' || value === true;
    return html`<div class="field field-check${wide ? ' wide' : ''}"><label><input type="checkbox" name="${f.name}" value="1"${attrIf(on, 'checked')}${attrIf(disabled, 'disabled')}> ${f.label}</label>${f.help ? html`<div class="help">${f.help}</div>` : ''}</div>`;
  }
  return html`<div class="field${wide ? ' wide' : ''}${error ? ' has-error' : ''}">
<label for="${id}">${f.label}${f.required ? html`<span class="req" aria-hidden="true"> *</span>` : ''}</label>
${control(ctx, f, id, value, disabled)}
${error ? html`<div class="err" role="alert">${error}</div>` : f.help ? html`<div class="help">${f.help}</div>` : ''}
</div>`;
}

function form(ctx, mod, { action, values, errors = {}, readonly, editing, returnTo, cancel, submit }) {
  const fields = mod.fields.filter((f) => !(editing && f.createOnly));
  const groups = [];
  let cur = null;
  for (const f of fields) {
    if (!cur || f.section) { cur = { title: f.section || null, fields: [] }; groups.push(cur); }
    cur.fields.push(f);
  }
  const errorCount = Object.keys(errors).length;
  return html`<form method="post" action="${action}" class="form">
${C.csrf(ctx)}
${returnTo ? html`<input type="hidden" name="return" value="${returnTo}">` : ''}
${errorCount ? html`<div class="alert alert-error" role="alert">Please fix the ${errorCount === 1 ? 'highlighted field' : `${errorCount} highlighted fields`}.</div>` : ''}
${groups.map((g) => html`<fieldset class="fs">${g.title ? html`<legend>${g.title}</legend>` : ''}<div class="fgrid">${g.fields.map((f) => fieldRow(ctx, f, values[f.name], errors[f.name], readonly))}</div></fieldset>`)}
${readonly ? '' : html`<div class="form-actions"><button class="btn btn-primary" type="submit">${submit}</button><a class="btn btn-quiet" href="${cancel}">Cancel</a></div>`}
</form>`;
}

// ---------- list filters ----------

function filterBar(ctx, mod, filters) {
  const viewLinks = (mod.views || []).map((v) => {
    const p = new URLSearchParams(ctx.url.search);
    p.set('view', v.key);
    return html`<a class="chip${filters.view === v.key ? ' is-active' : ''}" href="/${mod.key}?${p.toString()}">${v.label}</a>`;
  });
  const clients = ctx.db.all('SELECT id, name FROM clients ORDER BY name');
  const users = ctx.db.all('SELECT id, name FROM users WHERE active = 1 ORDER BY name');
  const selects = (mod.filters || []).map((f) => {
    const v = filters[f.name] || '';
    if (f.type === 'user') {
      return html`<select name="${f.name}" aria-label="${f.label}"><option value="">${f.label}: anyone</option>${f.mine ? html`<option value="me"${attrIf(v === 'me', 'selected')}>${f.label}: me</option>` : ''}${users.map((u) => html`<option value="${u.id}"${attrIf(String(u.id) === v, 'selected')}>${u.name}</option>`)}</select>`;
    }
    return html`<select name="${f.name}" aria-label="${f.label}"><option value="">${f.label}: all</option>${f.options.map((o) => html`<option${attrIf(o === v, 'selected')}>${o}</option>`)}</select>`;
  });
  const active = filters.q || filters.client || (mod.filters || []).some((f) => filters[f.name]);
  return html`<div class="filterbar">
${viewLinks.length ? html`<nav class="chips" aria-label="Views">${viewLinks}</nav>` : ''}
<form class="filters" method="get" action="/${mod.key}" data-autosubmit>
<input type="hidden" name="view" value="${filters.view}">
<input type="search" name="q" value="${filters.q}" placeholder="Search ${mod.plural.toLowerCase()}" aria-label="Search ${mod.plural}">
<select name="client" aria-label="Client"><option value="">All clients</option>${clients.map((c) => html`<option value="${c.id}"${attrIf(String(c.id) === filters.client, 'selected')}>${c.name}</option>`)}</select>
${selects}
<button class="btn btn-sm" type="submit">Apply</button>
${active ? html`<a class="clear" href="/${mod.key}?view=${filters.view}">Clear filters</a>` : ''}
</form>
</div>`;
}

module.exports = { ASSET_V, MARK, FONT_PRELOAD, layout, pageHeader, button, table, tile, flags, form, fieldRow, filterBar };
