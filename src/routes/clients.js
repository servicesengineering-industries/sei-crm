'use strict';
const { html, attrIf } = require('../html');
const F = require('../format');
const C = require('../cells');
const UI = require('../ui');
const { MODULES, OPT, RFQ_OPEN, sqlIn } = require('../modules');
const { canEdit } = require('../auth');
const { HttpError } = require('../http');
const { dateParams, likeParam, pager, PAGE_SIZE } = require('../crud');

// One row per client with everything needed to judge how the relationship stands.
// Open POs and money owed are added up once for all clients (grouped joins), not per client, so
// the client list stays quick as dispatches and payments pile up. `one` narrows both to the
// client in :cid for a single client's page.
const summarySql = (one) => `
SELECT c.*, u.name AS owner_name,
  COALESCE(od.open_orders, 0) AS open_orders, COALESCE(od.late_orders, 0) AS late_orders,
  COALESCE(m.unpaid_invoices, 0) AS unpaid_invoices, COALESCE(m.outstanding, 0) AS outstanding, COALESCE(m.overdue_amount, 0) AS overdue_amount,
  (SELECT MAX(occurred_on) FROM activities a WHERE a.client_id = c.id) AS last_contact,
  (SELECT COUNT(*) FROM contacts ct WHERE ct.client_id = c.id AND ct.active = 1) AS contact_count,
  (SELECT COUNT(*) FROM followups f WHERE f.client_id = c.id AND f.status = 'Open') AS open_followups,
  (SELECT COUNT(*) FROM followups f WHERE f.client_id = c.id AND f.status = 'Open' AND f.due_on < :t) AS overdue_followups,
  (SELECT COUNT(*) FROM rfqs r WHERE r.client_id = c.id AND r.status IN (${sqlIn(RFQ_OPEN)})) AS open_rfqs,
  (SELECT COUNT(*) FROM rfqs r WHERE r.client_id = c.id AND r.status IN ('Quoted', 'Negotiation') AND r.quoted_on <= :tm14) AS stale_quotes,
  (SELECT COUNT(*) FROM complaints q WHERE q.client_id = c.id AND q.status <> 'Closed') AS open_complaints,
  (SELECT COUNT(*) FROM complaints q WHERE q.client_id = c.id AND q.status <> 'Closed' AND q.severity = 'Critical') AS critical_complaints
FROM clients c LEFT JOIN users u ON u.id = c.owner_id
LEFT JOIN (
  SELECT o.client_id, COUNT(*) AS open_orders, COUNT(CASE WHEN o.due_on < :t THEN 1 END) AS late_orders
  FROM orders o
  LEFT JOIN (SELECT order_id, SUM(qty) AS sent FROM dispatches
             WHERE order_id IN (SELECT id FROM orders WHERE status = 'Open'${one ? ' AND client_id = :cid' : ''}) GROUP BY order_id) d ON d.order_id = o.id
  WHERE o.status = 'Open' AND o.qty - COALESCE(d.sent, 0) > 0${one ? ' AND o.client_id = :cid' : ''}
  GROUP BY o.client_id
) od ON od.client_id = c.id
LEFT JOIN (
  SELECT b.client_id, COUNT(*) AS unpaid_invoices, SUM(b.balance) AS outstanding, SUM(CASE WHEN b.due_on < :t THEN b.balance ELSE 0 END) AS overdue_amount
  FROM (SELECT i.client_id, i.due_on, ROUND(i.amount - COALESCE(p.paid, 0), 2) AS balance
        FROM invoices i
        LEFT JOIN (SELECT invoice_id, SUM(amount + COALESCE(deduction, 0)) AS paid FROM payments
                   ${one ? 'WHERE invoice_id IN (SELECT id FROM invoices WHERE client_id = :cid)' : ''} GROUP BY invoice_id) p ON p.invoice_id = i.id
        ${one ? 'WHERE i.client_id = :cid' : ''}) b
  WHERE b.balance > 0.5
  GROUP BY b.client_id
) m ON m.client_id = c.id${one ? ' WHERE c.id = :cid' : ''}`;
const SUMMARY_ALL = summarySql(false);
const SUMMARY_ONE = summarySql(true);

function clientFlags(r) {
  const out = [];
  if (r.overdue_amount > 0.5) out.push({ tone: 'bad', weight: 3, text: `${F.moneyShort(r.overdue_amount)} overdue` });
  if (r.late_orders) out.push({ tone: 'bad', weight: 3, text: F.plural(r.late_orders, 'late PO') });
  if (r.critical_complaints) out.push({ tone: 'bad', weight: 3, text: F.plural(r.critical_complaints, 'critical complaint') });
  else if (r.open_complaints) out.push({ tone: 'warn', weight: 2, text: F.plural(r.open_complaints, 'open complaint') });
  if (r.overdue_followups) out.push({ tone: 'bad', weight: 2, text: F.plural(r.overdue_followups, 'overdue follow-up') });
  if (r.stale_quotes) out.push({ tone: 'warn', weight: 1, text: `${F.plural(r.stale_quotes, 'quote')} to chase` });
  if (r.status === 'Active') {
    if (!r.last_contact) out.push({ tone: 'muted', weight: 0.5, text: 'No contact logged yet' });
    else {
      const d = F.daysBetween(r.last_contact, F.today());
      if (d > 30) out.push({ tone: 'warn', weight: 1, text: `No contact in ${d} days` });
    }
  }
  return out;
}

function clientSummaries(ctx, { where = '', params = {} } = {}) {
  const sql = params.cid != null ? SUMMARY_ONE : SUMMARY_ALL;
  const rows = ctx.db.all(`SELECT * FROM (${sql}) x${where ? ` WHERE ${where}` : ''} ORDER BY name`, { ...dateParams(), ...params });
  for (const r of rows) {
    r.flags = clientFlags(r);
    r.score = r.flags.reduce((s, f) => s + f.weight, 0);
  }
  return rows;
}

const byAttention = (a, b) => b.score - a.score || b.overdue_amount - a.overdue_amount || a.name.localeCompare(b.name);

// ---------- list ----------

function listPage(ctx) {
  const q = ctx.query;
  const where = [];
  const params = {};
  const status = OPT.clientStatus.includes(q.status) ? q.status : '';
  const segment = OPT.segment.includes(q.segment) ? q.segment : '';
  if (status) { where.push('status = :status'); params.status = status; }
  if (segment) { where.push('segment = :segment'); params.segment = segment; }
  if (q.owner === 'me') { where.push('owner_id = :owner'); params.owner = ctx.user.id; }
  else if (/^\d+$/.test(q.owner || '')) { where.push('owner_id = :owner'); params.owner = Number(q.owner); }
  const text = String(q.q || '').trim().slice(0, 100);
  if (text) {
    where.push("(name LIKE :q ESCAPE '\\' OR city LIKE :q ESCAPE '\\' OR vendor_code LIKE :q ESCAPE '\\' OR gstin LIKE :q ESCAPE '\\')");
    params.q = likeParam(text);
  }
  let rows = clientSummaries(ctx, { where: where.join(' AND '), params });
  const sort = ['name', 'attention', 'outstanding'].includes(q.sort) ? q.sort : 'attention';
  if (sort === 'attention') rows.sort(byAttention);
  if (sort === 'outstanding') rows.sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name));
  if (q.attention === '1') rows = rows.filter((r) => r.score >= 1);
  // 100 a page, like every other list; the count and the sort still cover every client.
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(q.page, 10) || 1));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const range = pages > 1 ? ` · showing ${F.num((page - 1) * PAGE_SIZE + 1)}–${F.num((page - 1) * PAGE_SIZE + shown.length)}` : '';

  const users = ctx.db.all('SELECT id, name FROM users WHERE active = 1 ORDER BY name');
  const t = F.today();
  const cols = [
    { label: 'Client', render: (r) => html`<a class="rowlink" href="/clients/${r.id}">${r.name}</a><span class="sub">${[r.segment, r.city].filter(Boolean).join(' · ') || 'Segment not set'}</span>` },
    { label: 'Status', render: (r) => C.badge(r.status) },
    { label: 'Account manager', render: (r) => C.text(r.owner_name) },
    { label: 'Last contact', render: (r) => (r.last_contact ? html`<span class="${F.daysBetween(r.last_contact, t) > 30 ? 'tone-text-warn' : ''}">${F.relDays(r.last_contact)}</span>` : C.dash) },
    { label: 'Open RFQs', cls: 'r', render: (r) => r.open_rfqs || C.dash },
    { label: 'Open POs', cls: 'r', render: (r) => (r.open_orders ? html`${r.open_orders}${r.late_orders ? html`<span class="sub tone-text-bad">${r.late_orders} late</span>` : ''}` : C.dash) },
    { label: 'Outstanding', cls: 'r', render: (r) => (r.outstanding > 0.5 ? html`${C.money(r.outstanding)}${r.overdue_amount > 0.5 ? html`<span class="sub tone-text-bad">${F.money(r.overdue_amount)} overdue</span>` : ''}` : C.dash) },
    { label: 'Complaints', cls: 'r', render: (r) => r.open_complaints || C.dash },
    { label: 'Needs attention', render: (r) => UI.flags(r.flags) },
  ];
  const sel = (name, label, options, current) => html`<select name="${name}" aria-label="${label}">${options.map(([v, l]) => html`<option value="${v}"${attrIf(v === current, 'selected')}>${l}</option>`)}</select>`;
  const add = canEdit(ctx.user, MODULES.clients) ? UI.button('/clients/new', 'New client', 'primary') : '';
  const body = html`
${UI.pageHeader('Clients', 'Every client with what is open, owed, late or unhappy.', add)}
<div class="filterbar">
${UI.filterFold(text || status || segment || q.owner || q.attention, html`<form class="filters" method="get" action="/clients" data-autosubmit>
  <input type="search" name="q" value="${text}" placeholder="Search name, city, vendor code, GSTIN" aria-label="Search clients">
  ${sel('status', 'Status', [['', 'Status: all'], ...OPT.clientStatus.map((s) => [s, s])], status)}
  ${sel('segment', 'Segment', [['', 'Segment: all'], ...OPT.segment.map((s) => [s, s])], segment)}
  ${sel('owner', 'Account manager', [['', 'Account manager: anyone'], ['me', 'Account manager: me'], ...users.map((u) => [String(u.id), u.name])], q.owner || '')}
  ${sel('sort', 'Sort', [['attention', 'Sort: needs attention first'], ['name', 'Sort: name'], ['outstanding', 'Sort: most outstanding']], sort)}
  <label class="check-inline"><input type="checkbox" name="attention" value="1"${attrIf(q.attention === '1', 'checked')}> Needs attention only</label>
  <button class="btn btn-sm" type="submit">Apply</button>
  ${text || status || segment || q.owner || q.attention ? html`<a class="clear" href="/clients">Clear filters</a>` : ''}
</form>`)}
</div>
<p class="count">${F.plural(rows.length, 'client')}${range}</p>
${UI.table(cols, shown, { ctx, empty: 'No clients match these filters.' })}
${pager(ctx, page, pages)}
<p class="export"><a href="/clients.csv">Download all clients as CSV</a></p>`;
  ctx.page('Clients', body, { active: 'clients' });
}

// ---------- detail ----------

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'contacts', label: 'Contacts', count: (c) => c.contact_count },
  { key: 'rfqs', label: 'RFQs & quotes', count: (c) => c.open_rfqs },
  { key: 'orders', label: 'Orders & deliveries', count: (c) => c.open_orders },
  { key: 'invoices', label: 'Invoices & dues', count: (c) => c.unpaid_invoices },
  { key: 'complaints', label: 'Complaints', count: (c) => c.open_complaints },
  { key: 'details', label: 'Company details' },
];

function timelineList(items) {
  if (!items.length) return html`<p class="dim">Nothing logged yet. Use the form above after your next call or visit.</p>`;
  return html`<ol class="tl">${items.map((it) => {
    if (it.kind === 'event') {
      return html`<li class="tl-item tl-event"><div class="tl-day">${F.fmtDate(it.day)}</div><div><div class="tl-title">${it.user_name || 'Someone'} ${it.title}</div></div></li>`;
    }
    return html`<li class="tl-item"><div class="tl-day"><b>${F.fmtDate(it.day)}</b>${F.relDays(it.day)}</div><div>
<div class="tl-title">${C.badge(it.type)}<a class="rowlink" href="/activities/${it.id}/edit">${it.title}</a></div>
${it.notes ? html`<div class="tl-notes">${it.notes}</div>` : ''}
<div class="tl-meta">${[it.contact_name ? `With ${it.contact_name}` : null, it.user_name ? `logged by ${it.user_name}` : null].filter(Boolean).join(' · ')}</div>
</div></li>`;
  })}</ol>`;
}

function quickLog(ctx, client, contacts) {
  const users = ctx.db.all('SELECT id, name FROM users WHERE active = 1 ORDER BY name');
  const ret = `/clients/${client.id}`;
  return html`<form method="post" action="/activities/new" class="card">
<div class="card-h"><h2>Log a call, visit or note</h2></div>
<div class="card-b">
${C.csrf(ctx)}
<input type="hidden" name="client_id" value="${client.id}">
<input type="hidden" name="return" value="${ret}">
<div class="fgrid fgrid-3">
  <div class="field"><label for="ql_type">Type</label><select id="ql_type" name="type">${OPT.activityType.map((o) => html`<option>${o}</option>`)}</select></div>
  <div class="field"><label for="ql_date">Date</label><input id="ql_date" type="date" name="occurred_on" value="${F.today()}" required></div>
  <div class="field"><label for="ql_contact">With</label><select id="ql_contact" name="contact_id"><option value="">—</option>${contacts.map((c) => html`<option value="${c.id}">${c.name}${c.designation ? ` – ${c.designation}` : ''}</option>`)}</select></div>
  <div class="field wide"><label for="ql_subject">Summary</label><input id="ql_subject" name="subject" required placeholder="For example: confirmed March schedule, asked for drawing rev C"></div>
  <div class="field wide"><label for="ql_notes">Details</label><textarea id="ql_notes" name="notes" rows="2"></textarea></div>
  <div class="field"><label for="ql_next">Next follow-up</label><input id="ql_next" name="next_title" placeholder="Optional"></div>
  <div class="field"><label for="ql_next_on">Follow-up date</label><input id="ql_next_on" type="date" name="next_on"></div>
  <div class="field"><label for="ql_assign">Assign to</label><select id="ql_assign" name="next_assigned">${users.map((u) => html`<option value="${u.id}"${attrIf(u.id === ctx.user.id, 'selected')}>${u.name}</option>`)}</select></div>
</div>
<div class="form-actions spaced"><button class="btn btn-primary" type="submit">Save to timeline</button></div>
</div>
</form>`;
}

function overviewTab(ctx, c) {
  const db = ctx.db;
  const contacts = db.all('SELECT * FROM contacts WHERE client_id = :id AND active = 1 ORDER BY is_primary DESC, name', { id: c.id });
  const followups = db.all(`SELECT f.*, u.name AS assigned_name, ct.name AS contact_name FROM followups f
                            LEFT JOIN users u ON u.id = f.assigned_to LEFT JOIN contacts ct ON ct.id = f.contact_id
                            WHERE f.client_id = :id AND f.status = 'Open' ORDER BY f.due_on`, { id: c.id });
  // Activities carry a local date; audit times are UTC, so convert those to the local day before merging.
  const acts = db.all(`SELECT a.id, a.occurred_on AS day, a.created_at AS at, a.type, a.subject AS title, a.notes,
                              u.name AS user_name, ct.name AS contact_name
                       FROM activities a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN contacts ct ON ct.id = a.contact_id
                       WHERE a.client_id = :id ORDER BY a.occurred_on DESC, a.id DESC LIMIT 80`, { id: c.id });
  const events = db.all(`SELECT l.id, l.at, l.entity AS type, l.summary AS title, u.name AS user_name
                         FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
                         WHERE l.client_id = :id AND NOT (l.entity = 'activities' AND l.action = 'created') ORDER BY l.at DESC, l.id DESC LIMIT 80`, { id: c.id });
  const timeline = [
    ...acts.map((a) => ({ ...a, kind: 'activity' })),
    ...events.map((e) => ({ ...e, kind: 'event', day: F.localDay(e.at) })),
  ].sort((a, b) => (a.day === b.day ? (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) : a.day < b.day ? 1 : -1)).slice(0, 80);
  const canLog = canEdit(ctx.user, MODULES.activities);
  const canFollow = canEdit(ctx.user, MODULES.followups);
  const ret = encodeURIComponent(`/clients/${c.id}`);
  const fuList = followups.length
    ? html`<ul class="list">${followups.map((f) => html`<li><div class="grow"><a class="who" href="/followups/${f.id}/edit?return=${ret}">${f.title}</a><span class="sub">${C.due(f.due_on, true)}${f.assigned_name ? ` · ${f.assigned_name}` : ''}${f.contact_name ? ` · with ${f.contact_name}` : ''}</span></div>${canFollow ? C.doneButton(f, ctx) : ''}</li>`)}</ul>`
    : html`<p class="dim">No open follow-ups.</p>`;
  const contactList = contacts.length
    ? html`<ul class="list">${contacts.slice(0, 8).map((p) => html`<li><div class="grow">
<a class="who" href="/contacts/${p.id}/edit?return=${ret}">${p.name}</a>${p.is_primary ? html` ${C.badge('Key contact', 'info')}` : ''}
<span class="sub">${[p.designation, p.department, p.location].filter(Boolean).join(' · ') || 'No designation'}</span>
<div class="contact-lines">${p.mobile ? C.tel(p.mobile) : ''}${p.phone ? C.tel(p.phone) : ''}${p.email ? C.email(p.email) : ''}</div>
</div></li>`)}</ul>`
    : html`<p class="dim">No contacts yet. Add the purchase, quality and accounts people you deal with.</p>`;
  return html`<div class="cols">
<div>
  ${canLog ? quickLog(ctx, c, contacts) : ''}
  <section class="card"><div class="card-h"><h2>Timeline</h2><a href="/activities?client=${c.id}">Full activity log</a></div><div class="card-b">${timelineList(timeline)}</div></section>
</div>
<div>
  <section class="card"><div class="card-h"><h2>Open follow-ups</h2>${canFollow ? UI.button(`/followups/new?client_id=${c.id}&return=${ret}`, 'Add', 'sm') : ''}</div><div class="card-b">${fuList}</div></section>
  <section class="card"><div class="card-h"><h2>Contacts</h2><a href="/clients/${c.id}?tab=contacts">All ${c.contact_count}</a></div><div class="card-b">${contactList}</div></section>
</div>
</div>`;
}

function moduleTab(ctx, c, key) {
  const mod = MODULES[key];
  const rows = ctx.db.all(`SELECT * FROM (${mod.listSql}) x WHERE client_id = :cid ORDER BY ${mod.order} LIMIT 500`, { cid: c.id });
  const cols = mod.columns.filter((col) => !col.client);
  const ret = encodeURIComponent(`/clients/${c.id}?tab=${key}`);
  const add = canEdit(ctx.user, mod) ? UI.button(`/${key}/new?client_id=${c.id}&return=${ret}`, `Add ${mod.singular}`, 'primary') : '';
  return html`<div class="tab-actions"><a class="btn btn-quiet" href="/${key}?client=${c.id}&view=all">Open in ${mod.plural}</a>${add}</div>
${UI.table(cols, rows, { ctx, empty: `Nothing here for ${c.name} yet.` })}`;
}

function detailsTab(ctx, c) {
  const mod = MODULES.clients;
  const show = (f) => {
    const v = c[f.name];
    if (v == null || v === '') return C.dash;
    if (f.name === 'owner_id') return c.owner_name;
    if (f.type === 'url') return html`<a href="${v}" rel="noopener noreferrer" target="_blank">${v}</a>`;
    if (f.name === 'payment_terms_days') return `${v} days`;
    return v;
  };
  const del = ctx.user.role === 'admin'
    ? html`<form method="post" action="/clients/${c.id}/delete" class="danger-zone" data-confirm="Delete ${c.name}? This cannot be undone.">${C.csrf(ctx)}<button class="btn btn-danger btn-sm" type="submit">Delete client</button><span class="help"> Only possible while the client has no linked records.</span></form>`
    : '';
  return html`<section class="card"><div class="card-h"><h2>Company details</h2>${canEdit(ctx.user, mod) ? UI.button(`/clients/${c.id}/edit`, 'Edit', 'sm') : ''}</div>
<div class="card-b"><dl class="dl">${mod.fields.map((f) => html`<dt>${f.label}</dt><dd>${show(f)}</dd>`)}
<dt>Added</dt><dd>${F.fmtDateTime(c.created_at)}</dd></dl>${del}</div></section>`;
}

function detailPage(ctx) {
  const id = Number(ctx.params.id);
  const [c] = clientSummaries(ctx, { where: 'id = :cid', params: { cid: id } });
  if (!c) throw new HttpError(404, "That client doesn't exist. It may have been deleted.");
  const tab = TABS.some((t) => t.key === ctx.query.tab) ? ctx.query.tab : 'overview';
  const facts = [c.segment, c.vendor_code ? `Vendor code ${c.vendor_code}` : null, c.payment_terms_days != null ? `${c.payment_terms_days}-day payment terms` : null, c.owner_name ? `Account manager: ${c.owner_name}` : 'No account manager set'].filter(Boolean).join(' · ');
  const actions = canEdit(ctx.user, MODULES.clients) ? UI.button(`/clients/${c.id}/edit`, 'Edit client') : '';
  const lastDays = c.last_contact ? F.daysBetween(c.last_contact, F.today()) : null;
  const tiles = html`<div class="tiles">
${UI.tile({ label: 'Outstanding', value: F.moneyShort(c.outstanding), sub: c.overdue_amount > 0.5 ? `${F.money(c.overdue_amount)} overdue` : 'Nothing overdue', tone: c.overdue_amount > 0.5 ? 'bad' : 'ok', href: `/clients/${c.id}?tab=invoices` })}
${UI.tile({ label: 'Open POs', value: c.open_orders, sub: c.late_orders ? `${c.late_orders} late` : 'None late', tone: c.late_orders ? 'bad' : 'ok', href: `/clients/${c.id}?tab=orders` })}
${UI.tile({ label: 'Open RFQs', value: c.open_rfqs, sub: c.stale_quotes ? `${F.plural(c.stale_quotes, 'quote')} to chase` : 'None waiting on the client', tone: c.stale_quotes ? 'warn' : '', href: `/clients/${c.id}?tab=rfqs` })}
${UI.tile({ label: 'Open complaints', value: c.open_complaints, sub: c.critical_complaints ? `${c.critical_complaints} critical` : c.open_complaints ? 'None critical' : 'None open', tone: c.critical_complaints ? 'bad' : c.open_complaints ? 'warn' : 'ok', href: `/clients/${c.id}?tab=complaints` })}
${UI.tile({ label: 'Last contact', value: c.last_contact ? F.relDays(c.last_contact) : 'None yet', sub: c.last_contact ? F.fmtDate(c.last_contact) : 'Log a call or visit below', tone: lastDays == null ? '' : lastDays > 30 ? 'warn' : '', href: `/clients/${c.id}` })}
</div>`;
  const tabs = html`<nav class="tabs" aria-label="Client sections">${TABS.map((t) => {
    const n = t.count ? t.count(c) : 0;
    return html`<a class="tab${t.key === tab ? ' is-active' : ''}" href="/clients/${c.id}${t.key === 'overview' ? '' : `?tab=${t.key}`}"${attrIf(t.key === tab, 'aria-current="page"')}>${t.label}${n ? html`<span class="tab-n">${n}</span>` : ''}</a>`;
  })}</nav>`;
  let content;
  if (tab === 'overview') content = overviewTab(ctx, c);
  else if (tab === 'details') content = detailsTab(ctx, c);
  else content = moduleTab(ctx, c, tab);
  const body = html`
<p class="crumbs"><a href="/clients">← All clients</a></p>
${UI.pageHeader(html`${c.name} ${C.badge(c.status)}`, facts, actions)}
${c.flags.length ? html`<div class="flag-row">${UI.flags(c.flags)}</div>` : ''}
${tiles}
${tabs}
${content}`;
  ctx.page(c.name, body, { active: 'clients' });
}

function register(router) {
  router.on('GET', '/clients', listPage);
  router.on('GET', '/clients/:id', detailPage);
}

module.exports = { register, clientSummaries, clientFlags, byAttention };
