'use strict';
// End-to-end check against a throwaway database: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const F = require('../src/format');

class Agent {
  constructor(base) { this.base = base; this.jar = {}; }
  async req(method, p, form) {
    const headers = { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    let body;
    if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const res = await fetch(this.base + p, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      if (/Max-Age=0/i.test(c)) delete this.jar[pair.slice(0, i)];
      else this.jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
    return { status: res.status, location: res.headers.get('location'), text: await res.text(), headers: res.headers };
  }
  get(p) { return this.req('GET', p); }
  post(p, form) { return this.req('POST', p, form); }
}
const csrfOf = (text) => /name="_csrf" value="([^"]+)"/.exec(text)[1];

async function login(agent, email, password) {
  const page = await agent.get('/login');
  return agent.post('/login', { _csrf: csrfOf(page.text), email, password, next: '' });
}

test('SEI CRM end to end', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sei-crm-test-'));
  const cfg = { ...loadConfig([]), demo: false, dataDir: dir, dbPath: path.join(dir, 'crm.db'), adminEmail: 'admin@test.local', port: 0 };
  const app = createApp(cfg);
  const server = http.createServer(app.handle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.close(); app.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const admin = new Agent(base);
  const firstLogin = fs.readFileSync(path.join(dir, 'first-login.txt'), 'utf8');
  const tempPw = /Password: (\S+)/.exec(firstLogin)[1];

  await t.test('seeds SEI customers and redirects anonymous users to sign in', async () => {
    assert.equal(app.db.get('SELECT COUNT(*) AS n FROM clients').n, 16);
    const r = await admin.get('/clients');
    assert.equal(r.status, 303);
    assert.match(r.location, /^\/login\?next=/);
  });

  await t.test('wrong password is refused', async () => {
    const r = await login(new Agent(base), 'admin@test.local', 'not-the-password');
    assert.equal(r.status, 401);
  });

  await t.test('first sign-in forces a password change', async () => {
    const r = await login(admin, 'admin@test.local', tempPw);
    assert.equal(r.status, 303);
    assert.equal(r.location, '/account/password');
    const blocked = await admin.get('/clients');
    assert.equal(blocked.location, '/account/password');
    const page = await admin.get('/account/password');
    const saved = await admin.post('/account/password', { _csrf: csrfOf(page.text), current: tempPw, password: 'a-long-new-password', confirm: 'a-long-new-password' });
    assert.equal(saved.location, '/');
    assert.equal(fs.existsSync(path.join(dir, 'first-login.txt')), false, 'first-login file removed');
  });

  let csrf;
  let clientId;
  await t.test('dashboard and client list render', async () => {
    const dash = await admin.get('/');
    assert.equal(dash.status, 200);
    assert.match(dash.text, /Clients needing attention/);
    assert.match(dash.headers.get('content-security-policy'), /default-src 'self'/);
    csrf = csrfOf(dash.text);
    const list = await admin.get('/clients');
    assert.match(list.text, /Maruti Suzuki/);
    assert.match(list.text, /CNH Industrial/);
  });

  await t.test('POST without CSRF token is rejected', async () => {
    const r = await admin.post('/clients/new', { name: 'No Token Ltd', status: 'Active' });
    assert.equal(r.status, 403);
  });

  await t.test('create a client; names are escaped', async () => {
    const r = await admin.post('/clients/new', { _csrf: csrf, name: 'Test <script>alert(1)</script> Motors', status: 'Prospect', payment_terms_days: '45' });
    assert.equal(r.status, 303);
    clientId = Number(/\/clients\/(\d+)/.exec(r.location)[1]);
    const page = await admin.get(`/clients/${clientId}`);
    assert.equal(page.status, 200);
    assert.ok(!page.text.includes('<script>alert(1)</script>'));
    assert.match(page.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  await t.test('validation errors re-render the form', async () => {
    const r = await admin.post('/contacts/new', { _csrf: csrf, client_id: String(clientId), name: '', email: 'not-an-email' });
    assert.equal(r.status, 422);
    assert.match(r.text, /Enter an email address/);
  });

  let contactId;
  await t.test('add a contact and log an activity with a follow-up', async () => {
    const c = await admin.post('/contacts/new', { _csrf: csrf, client_id: String(clientId), name: 'Asha Rao', designation: 'Purchase Manager', mobile: '+91 98100 12345', email: 'asha@example.com', is_primary: '1', active: '1' });
    assert.equal(c.status, 303);
    contactId = app.db.get('SELECT id FROM contacts WHERE name = :n', { n: 'Asha Rao' }).id;
    const a = await admin.post('/activities/new', {
      _csrf: csrf, client_id: String(clientId), contact_id: String(contactId), type: 'Visit', occurred_on: F.today(),
      subject: 'Plant visit, discussed new bracket', next_title: 'Send quote for bracket', next_on: F.addDays(F.today(), -1), return: `/clients/${clientId}`,
    });
    assert.equal(a.status, 303);
    assert.equal(a.location, `/clients/${clientId}`);
    const page = await admin.get(`/clients/${clientId}`);
    assert.match(page.text, /Plant visit, discussed new bracket/);
    assert.match(page.text, /Send quote for bracket/);
    assert.match(page.text, /1 overdue follow-up/);
    const search = await admin.get('/search?q=9810012345');
    assert.match(search.text, /Asha Rao/);
  });

  await t.test('a contact from another client is refused', async () => {
    const other = app.db.get("SELECT id FROM clients WHERE name = 'Maruti Suzuki'").id;
    const r = await admin.post('/activities/new', { _csrf: csrf, client_id: String(other), contact_id: String(contactId), type: 'Call', occurred_on: F.today(), subject: 'x' });
    assert.equal(r.status, 422);
    assert.match(r.text, /belongs to a different client/);
  });

  await t.test('orders, dispatches, invoices and payments add up', async () => {
    await admin.post('/orders/new', { _csrf: csrf, client_id: String(clientId), po_no: 'PO-77', po_date: F.today(), part_name: 'Bracket', qty: '1000', unit_price: '25.50', due_on: F.addDays(F.today(), -2), status: 'Open' });
    const order = app.db.get("SELECT * FROM v_orders WHERE po_no = 'PO-77'");
    await admin.post('/dispatches/new', { _csrf: csrf, order_id: String(order.id), dispatched_on: F.today(), qty: '400', invoice_no: 'INV-1' });
    const after = app.db.get('SELECT * FROM v_orders WHERE id = :id', { id: order.id });
    assert.equal(after.dispatched, 400);
    assert.equal(after.pending, 600);
    const late = await admin.get('/orders?view=late');
    assert.match(late.text, /PO-77/);

    await admin.post('/invoices/new', { _csrf: csrf, client_id: String(clientId), invoice_no: 'INV-1', invoice_date: F.addDays(F.today(), -60), amount: '1,20,000' });
    const inv = app.db.get("SELECT * FROM v_invoices WHERE invoice_no = 'INV-1'");
    assert.equal(inv.amount, 120000);
    assert.equal(inv.due_on, F.addDays(F.today(), -15), 'due date from 45-day terms');
    await admin.post('/payments/new', { _csrf: csrf, invoice_id: String(inv.id), received_on: F.today(), amount: '100000', deduction: '2000', mode: 'NEFT / RTGS' });
    const paid = app.db.get('SELECT balance FROM v_invoices WHERE id = :id', { id: inv.id });
    assert.equal(paid.balance, 18000);
    const page = await admin.get(`/clients/${clientId}`);
    assert.match(page.text, /1 late PO/);
    assert.match(page.text, /overdue/);
    const csv = await admin.get('/invoices.csv?view=all');
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.text, /INV-1/);
  });

  await t.test('complaints close with a date', async () => {
    await admin.post('/complaints/new', { _csrf: csrf, client_id: String(clientId), received_on: F.today(), severity: 'Critical', defect: 'Burr on edge', status: 'Open' });
    const q = app.db.get("SELECT * FROM complaints WHERE defect = 'Burr on edge'");
    const dash = await admin.get('/');
    assert.match(dash.text, /1 critical/);
    await admin.post(`/complaints/${q.id}/edit`, { _csrf: csrf, client_id: String(clientId), received_on: q.received_on, severity: 'Critical', defect: 'Burr on edge', status: 'Closed' });
    assert.equal(app.db.get('SELECT closed_on FROM complaints WHERE id = :id', { id: q.id }).closed_on, F.today());
  });

  await t.test('a view-only user cannot change anything', async () => {
    const created = await admin.post('/users/new', { _csrf: csrf, name: 'Viewer', email: 'viewer@test.local', role: 'viewer' });
    const pw = /class="temp-pw">([^<]+)</.exec(created.text)[1];
    const viewer = new Agent(base);
    await login(viewer, 'viewer@test.local', pw);
    const page = await viewer.get('/account/password');
    await viewer.post('/account/password', { _csrf: csrfOf(page.text), current: pw, password: 'viewer-password-1', confirm: 'viewer-password-1' });
    const dash = await viewer.get('/');
    assert.equal(dash.status, 200);
    const r = await viewer.post('/clients/new', { _csrf: csrfOf(dash.text), name: 'Should Fail', status: 'Active' });
    assert.equal(r.status, 403);
    const users = await viewer.get('/users');
    assert.equal(users.status, 403);
  });

  await t.test('a malformed request target gets 400 and the server keeps running', async () => {
    const status = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: server.address().port, path: '//a:99999', method: 'GET' }, (res) => { res.resume(); resolve(res.statusCode); });
      r.on('error', reject);
      r.end();
    });
    assert.equal(status, 400);
    assert.equal((await admin.get('/healthz')).status, 200);
  });

  await t.test('sign-in never redirects off-site', async () => {
    const a = new Agent(base);
    const page = await a.get('/login');
    const r = await a.post('/login', { _csrf: csrfOf(page.text), email: 'admin@test.local', password: 'a-long-new-password', next: '/\t/evil.example' });
    assert.equal(r.location, '/');
  });

  await t.test('editing a done follow-up keeps its done date', async () => {
    const f = app.db.get("SELECT * FROM followups WHERE title = 'Send quote for bracket'");
    app.db.run("UPDATE followups SET status = 'Done', done_on = '2026-01-05' WHERE id = :id", { id: f.id });
    await admin.post(`/followups/${f.id}/edit`, { _csrf: csrf, client_id: String(f.client_id), title: f.title, due_on: f.due_on, status: 'Done', notes: 'edited later' });
    assert.equal(app.db.get('SELECT done_on FROM followups WHERE id = :id', { id: f.id }).done_on, '2026-01-05');
  });

  await t.test('over-allocation, impossible dates and duplicates are refused', async () => {
    const inv = app.db.get("SELECT id FROM invoices WHERE invoice_no = 'INV-1'");
    const pay = await admin.post('/payments/new', { _csrf: csrf, invoice_id: String(inv.id), received_on: F.today(), amount: '50000' });
    assert.equal(pay.status, 422);
    assert.match(pay.text, /still due on this invoice/);
    const order = app.db.get("SELECT id FROM orders WHERE po_no = 'PO-77'");
    const dis = await admin.post('/dispatches/new', { _csrf: csrf, order_id: String(order.id), dispatched_on: F.today(), qty: '700' });
    assert.equal(dis.status, 422);
    assert.match(dis.text, /Only 600 pcs are still pending/);
    const bad = await admin.post('/invoices/new', { _csrf: csrf, client_id: String(clientId), invoice_no: 'INV-2', invoice_date: '2026-02-31', amount: '100' });
    assert.equal(bad.status, 422);
    assert.match(bad.text, /date doesn’t exist/);
    const dup = await admin.post('/invoices/new', { _csrf: csrf, client_id: String(clientId), invoice_no: 'inv-1', invoice_date: F.today(), amount: '100' });
    assert.equal(dup.status, 422);
    assert.match(dup.text, /already entered/);
  });

  await t.test('records with linked records cannot change client or be deleted', async () => {
    const order = app.db.get("SELECT * FROM orders WHERE po_no = 'PO-77'");
    const other = app.db.get("SELECT id FROM clients WHERE name = 'Maruti Suzuki'").id;
    const move = await admin.post(`/orders/${order.id}/edit`, { _csrf: csrf, client_id: String(other), po_no: order.po_no, part_name: order.part_name, qty: String(order.qty), status: 'Open' });
    assert.equal(move.status, 422);
    assert.match(move.text, /can’t move to another client/);
    const del = await admin.post(`/orders/${order.id}/delete`, { _csrf: csrf });
    assert.equal(del.location, `/orders/${order.id}/edit`);
    assert.ok(app.db.get('SELECT id FROM orders WHERE id = :id', { id: order.id }));
  });

  await t.test('an unticked box stays unticked when an edit fails validation', async () => {
    const c = app.db.get("SELECT * FROM contacts WHERE name = 'Asha Rao'");
    const r = await admin.post(`/contacts/${c.id}/edit`, { _csrf: csrf, client_id: String(c.client_id), name: c.name, email: 'bad', is_primary: '1' });
    assert.equal(r.status, 422);
    assert.match(r.text, /name="active" value="1">/);
  });

  await t.test('CSV keeps phone numbers intact and filters clients by id', async () => {
    const csv = await admin.get('/contacts.csv?view=all');
    assert.match(csv.text, /"=""\+91 98100 12345"""/);
    const one = await admin.get(`/clients.csv?client=${clientId}`);
    assert.equal(one.status, 200);
  });

  await t.test('static files and fonts are served; paths cannot escape', async () => {
    const font = await admin.get('/static/fonts/inter-latin-wght-normal.woff2');
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/woff2');
    const bad = await admin.get('/static/..%2Fserver.js');
    assert.equal(bad.status, 404);
  });
});
