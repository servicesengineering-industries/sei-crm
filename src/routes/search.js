'use strict';
const { html } = require('../html');
const F = require('../format');
const C = require('../cells');
const UI = require('../ui');
const { likeParam } = require('../crud');

function search(ctx) {
  const q = String(ctx.query.q || '').trim().slice(0, 100);
  if (q.length < 2) {
    return ctx.page('Search', html`${UI.pageHeader('Search', 'Type at least two letters or digits in the search box above.')}`);
  }
  const db = ctx.db;
  const like = likeParam(q);
  const digits = q.replace(/\D/g, '');
  const phone = digits.length >= 4 ? `%${digits}%` : '__no_phone_search__';
  const strip = (col) => `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${col}, ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '')`;
  const L = (col) => `${col} LIKE :q ESCAPE '\\'`;

  const clients = db.all(`SELECT id, name, segment, city, status FROM clients WHERE ${L('name')} OR ${L('vendor_code')} OR ${L('city')} OR ${L('gstin')} ORDER BY name LIMIT 20`, { q: like });
  const contacts = db.all(`SELECT ct.*, c.name AS client_name FROM contacts ct JOIN clients c ON c.id = ct.client_id
                           WHERE ${L('ct.name')} OR ${L('ct.email')} OR ${L('ct.designation')} OR ${L('ct.mobile')} OR ${L('ct.phone')}
                              OR ${strip('ct.mobile')} LIKE :p OR ${strip('ct.phone')} LIKE :p
                           ORDER BY ct.active DESC, ct.name LIMIT 30`, { q: like, p: phone });
  const rfqs = db.all(`SELECT r.*, c.name AS client_name FROM rfqs r JOIN clients c ON c.id = r.client_id
                       WHERE ${L('r.part_name')} OR ${L('r.part_no')} OR ${L('r.rfq_ref')} OR ${L('r.quote_no')} ORDER BY r.received_on DESC LIMIT 20`, { q: like });
  const orders = db.all(`SELECT o.*, c.name AS client_name FROM v_orders o JOIN clients c ON c.id = o.client_id
                         WHERE ${L('o.po_no')} OR ${L('o.part_name')} OR ${L('o.part_no')} ORDER BY o.po_date DESC LIMIT 20`, { q: like });
  const invoices = db.all(`SELECT i.*, c.name AS client_name FROM v_invoices i JOIN clients c ON c.id = i.client_id
                           WHERE ${L('i.invoice_no')} ORDER BY i.invoice_date DESC LIMIT 20`, { q: like });
  const complaints = db.all(`SELECT q.*, c.name AS client_name FROM complaints q JOIN clients c ON c.id = q.client_id
                             WHERE ${L('q.complaint_ref')} OR ${L('q.defect')} OR ${L('q.part_no')} OR ${L('q.part_name')} ORDER BY q.received_on DESC LIMIT 20`, { q: like });

  const total = clients.length + contacts.length + rfqs.length + orders.length + invoices.length + complaints.length;
  const group = (title, rows, cols) => (rows.length ? html`<section class="search-group"><h2>${title}</h2>${UI.table(cols, rows, { ctx })}</section>` : '');
  const body = html`
${UI.pageHeader(`Results for “${q}”`, total ? F.plural(total, 'match', 'matches') : 'Nothing found. Try part of a name, a phone number, a part no, or a PO or invoice number.')}
${group('Clients', clients, [
    { label: 'Client', render: (r) => html`<a class="rowlink" href="/clients/${r.id}">${r.name}</a><span class="sub">${[r.segment, r.city].filter(Boolean).join(' · ')}</span>` },
    { label: 'Status', render: (r) => C.badge(r.status) },
  ])}
${group('People', contacts, [
    { label: 'Name', render: (r) => C.edit('contacts', r, r.name, [r.designation, r.department].filter(Boolean).join(' · '), ctx) },
    { label: 'Client', render: (r) => C.client(r) },
    { label: 'Mobile', render: (r) => C.tel(r.mobile) },
    { label: 'Office phone', render: (r) => C.tel(r.phone) },
    { label: 'Email', render: (r) => C.email(r.email) },
  ])}
${group('RFQs & quotes', rfqs, [
    { label: 'Part', render: (r) => C.edit('rfqs', r, r.part_name, r.part_no, ctx) },
    { label: 'Client', render: (r) => C.client(r) },
    { label: 'Status', render: (r) => C.badge(r.status) },
    { label: 'Received', render: (r) => C.date(r.received_on) },
  ])}
${group('Orders', orders, [
    { label: 'PO', render: (r) => C.edit('orders', r, r.po_no, r.part_name, ctx) },
    { label: 'Client', render: (r) => C.client(r) },
    { label: 'Pending', cls: 'r', render: (r) => C.int(r.pending) },
    { label: 'Due', render: (r) => C.due(r.due_on, r.status === 'Open' && r.pending > 0) },
  ])}
${group('Invoices', invoices, [
    { label: 'Invoice', render: (r) => C.edit('invoices', r, r.invoice_no, null, ctx) },
    { label: 'Client', render: (r) => C.client(r) },
    { label: 'Balance', cls: 'r', render: (r) => (r.balance > 0.5 ? C.money(r.balance) : C.badge('Paid', 'ok')) },
    { label: 'Due', render: (r) => C.due(r.due_on, r.balance > 0.5) },
  ])}
${group('Quality complaints', complaints, [
    { label: 'Complaint', render: (r) => C.edit('complaints', r, C.clip(r.defect, 70), r.complaint_ref, ctx) },
    { label: 'Client', render: (r) => C.client(r) },
    { label: 'Severity', render: (r) => C.badge(r.severity) },
    { label: 'Status', render: (r) => C.badge(r.status) },
  ])}`;
  ctx.page('Search', body);
}

function register(router) {
  router.on('GET', '/search', search);
}

module.exports = { register };
