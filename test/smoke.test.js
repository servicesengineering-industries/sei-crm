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
    if (form instanceof FormData) body = form; // fetch sets the multipart boundary itself
    else if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
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
  // A form with file uploads: files are [{ name, data, type }].
  upload(p, fields, files = []) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of files) fd.append('files', new Blob([f.data], { type: f.type }), f.name);
    return this.req('POST', p, fd);
  }
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
    await admin.post('/orders/new', { _csrf: csrf, client_id: String(clientId), po_no: 'PO-77', po_date: F.addDays(F.today(), -30), part_name: 'Bracket', qty: '1000', unit_price: '25.50', due_on: F.addDays(F.today(), -2), status: 'Open' });
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
    await admin.post(`/complaints/${q.id}/edit`, { _csrf: csrf, client_id: String(clientId), received_on: q.received_on, severity: 'Critical', defect: 'Burr on edge', status: 'Closed', root_cause: 'Worn punch', corrective_action: 'Punch changed; added to PM' });
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

  await t.test('weekly planning: each machine gets its PM planned for the week, once', async () => {
    const ws = F.weekOf(F.today());
    const r = await admin.post('/assets/new', { _csrf: csrf, code: 'pp-01', name: 'Power press 200 T', asset_type: 'Machine', status: 'Running', pm_frequency: 'Weekly', pm_day: 'Saturday', pm_checklist: 'Clutch air pressure: 5–6 kg/cm² (gauge)' });
    assert.equal(r.status, 303);
    const a = app.db.get("SELECT * FROM assets WHERE code = 'PP-01'");
    assert.ok(a, 'code saved in capitals');
    const noChecks = await admin.post('/assets/new', { _csrf: csrf, code: 'DIE-1', name: 'Blanking die', asset_type: 'Tool / die', status: 'Running', pm_frequency: 'Monthly' });
    assert.equal(noChecks.status, 422);
    const dup = await admin.post('/assets/new', { _csrf: csrf, code: 'PP-01', name: 'Another', asset_type: 'Machine', status: 'Running' });
    assert.equal(dup.status, 422);
    assert.match(dup.text, /already has this code/);

    await admin.post('/planning/pm', { _csrf: csrf, week: ws });
    const tasks = app.db.all('SELECT * FROM pm_tasks WHERE asset_id = :a', { a: a.id });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].planned_on, F.addDays(ws, 5), 'planned on its PM day, Saturday');
    assert.match(tasks[0].checklist, /Clutch air pressure/);
    await admin.post('/planning/pm', { _csrf: csrf, week: ws });
    assert.equal(app.db.get('SELECT COUNT(*) AS n FROM pm_tasks WHERE asset_id = :a', { a: a.id }).n, 1, 'not planned twice');
    // Next week can be planned while this week's PM is still open: it counts from that planned day.
    const nextWs = F.addDays(ws, 7);
    if (tasks[0].planned_on >= F.today()) {
      await admin.post('/planning/pm', { _csrf: csrf, week: nextWs });
      const next = app.db.get('SELECT * FROM pm_tasks WHERE asset_id = :a AND week_start = :w', { a: a.id, w: nextWs });
      assert.ok(next, 'next week planned ahead');
      assert.equal(next.planned_on, F.addDays(nextWs, 5));
      app.db.run('DELETE FROM pm_tasks WHERE id = :id', { id: next.id });
    }

    const done = await admin.post(`/pm_tasks/${tasks[0].id}/done`, { _csrf: csrf, return: '/planning' });
    assert.equal(done.location, '/planning');
    const after = app.db.get('SELECT * FROM v_assets WHERE id = :id', { id: a.id });
    assert.equal(after.last_done_on, F.today());
    assert.equal(after.next_pm_on, F.addDays(F.today(), 7));
    const page = await admin.get(`/planning?week=${ws}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Week planner/);
    assert.match(page.text, /PP-01/);
    const machine = await admin.get(`/assets/${a.id}/edit`);
    assert.match(machine.text, /PM <b>weekly<\/b>/, 'the machine page shows its own PM plan and history');
  });

  await t.test('weekly sales plan counts that week’s dispatches as actual', async () => {
    const ws = F.weekOf(F.today());
    const order = app.db.get("SELECT id FROM orders WHERE po_no = 'PO-77'");
    const r = await admin.post('/sales_plans/new', { _csrf: csrf, week_start: F.today(), client_id: String(clientId), order_id: String(order.id), part_name: 'Bracket', planned_qty: '500' });
    assert.equal(r.status, 303);
    assert.equal(r.location, '/sales_plans');
    const sp = app.db.get('SELECT * FROM v_sales_plans WHERE order_id = :o', { o: order.id });
    assert.equal(sp.week_start, ws, 'saved against the Monday');
    assert.equal(sp.rate, 25.5, 'rate taken from the PO');
    assert.equal(sp.actual_qty, 400, 'the 400 pcs dispatched today');
    const dup = await admin.post('/sales_plans/new', { _csrf: csrf, week_start: ws, client_id: String(clientId), order_id: String(order.id), part_name: 'bracket', planned_qty: '10' });
    assert.equal(dup.status, 422);
    // A second line for the same part without a PO doesn't count the PO line's dispatches again.
    const loose = await admin.post('/sales_plans/new', { _csrf: csrf, week_start: ws, client_id: String(clientId), part_name: 'Bracket', planned_qty: '100' });
    assert.equal(loose.status, 303);
    assert.equal(app.db.get('SELECT actual_qty FROM v_sales_plans WHERE order_id IS NULL AND client_id = :c AND week_start = :w', { c: clientId, w: ws }).actual_qty, 0);
    assert.equal(app.db.get('SELECT actual_qty FROM v_sales_plans WHERE order_id = :o', { o: order.id }).actual_qty, 400);
  });

  await t.test('purchase, payment and petty cash plans', async () => {
    const s = await admin.post('/suppliers/new', { _csrf: csrf, name: 'Test Steel', category: 'Raw material – steel', payment_terms_days: '30', active: '1' });
    assert.equal(s.status, 303);
    const sup = app.db.get("SELECT id FROM suppliers WHERE name = 'Test Steel'").id;
    const noSup = await admin.post('/purchase_plans/new', { _csrf: csrf, item: 'CRCA sheet', category: 'Raw material', qty: '2,500', unit: 'kg', rate: '68', required_by: F.today(), status: 'PO placed' });
    assert.equal(noSup.status, 422);
    await admin.post('/purchase_plans/new', { _csrf: csrf, item: 'CRCA sheet', category: 'Raw material', qty: '2,500', unit: 'kg', rate: '68', required_by: F.today(), status: 'Received', supplier_id: String(sup) });
    const p = app.db.get("SELECT * FROM purchase_plans WHERE item = 'CRCA sheet'");
    assert.equal(p.qty, 2500);
    assert.equal(p.received_qty, 2500);
    assert.equal(p.received_on, F.today());

    const pay = await admin.post('/payment_plans/new', { _csrf: csrf, category: 'Supplier bill', amount: '1000', plan_date: F.today(), priority: 'Normal', status: 'Planned' });
    assert.equal(pay.status, 422);
    assert.match(pay.text, /Say who is being paid/);
    await admin.post('/payment_plans/new', { _csrf: csrf, category: 'Supplier bill', supplier_id: String(sup), bill_date: F.addDays(F.today(), -10), amount: '1,70,000', plan_date: F.today(), priority: 'Must pay', status: 'Paid' });
    const pp = app.db.get('SELECT * FROM payment_plans WHERE supplier_id = :s', { s: sup });
    assert.equal(pp.payee, 'Test Steel');
    assert.equal(pp.paid_amount, 170000);
    assert.equal(pp.due_on, F.addDays(F.today(), 20), 'bill due from the supplier’s credit days');

    const upiTopUp = await admin.post('/petty_cash/new', { _csrf: csrf, entry_type: 'Cash top-up', plan_date: F.today(), description: 'Cash for the box', mode: 'UPI', planned_amount: '5000', status: 'Paid' });
    assert.equal(upiTopUp.status, 422);
    await admin.post('/petty_cash/new', { _csrf: csrf, entry_type: 'Cash top-up', plan_date: F.today(), description: 'Cash for the box', mode: 'Cash', planned_amount: '5000', status: 'Paid' });
    await admin.post('/petty_cash/new', { _csrf: csrf, entry_type: 'Expense', head: 'Tea & refreshments', plan_date: F.today(), description: 'Tea', mode: 'Cash', planned_amount: '600', status: 'Paid' });
    const noRef = await admin.post('/petty_cash/new', { _csrf: csrf, entry_type: 'Expense', head: 'Courier & postage', plan_date: F.today(), description: 'Courier', mode: 'UPI', planned_amount: '300', status: 'Paid' });
    assert.equal(noRef.status, 422, 'a UPI payment needs its reference');
    const list = await admin.get('/petty_cash');
    assert.match(list.text, /₹4,400<\/b> cash in the box now/);

    const xl = await fetch(`${base}/planning.xlsx?week=${F.today()}`, { headers: { cookie: Object.entries(admin.jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
    assert.equal(xl.status, 200);
    assert.match(xl.headers.get('content-type'), /spreadsheetml/);
    const bytes = Buffer.from(await xl.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), 'PK', 'a zip file');
  });

  await t.test('production role changes production plans but not payments', async () => {
    const created = await admin.post('/users/new', { _csrf: csrf, name: 'Prod User', email: 'prod@test.local', role: 'production' });
    const pw = /class="temp-pw">([^<]+)</.exec(created.text)[1];
    const u = new Agent(base);
    await login(u, 'prod@test.local', pw);
    const page = await u.get('/account/password');
    await u.post('/account/password', { _csrf: csrfOf(page.text), current: pw, password: 'the press shop runs late', confirm: 'the press shop runs late' });
    const tok = csrfOf((await u.get('/production_plans')).text);
    const ok = await u.post('/production_plans/new', { _csrf: tok, plan_date: F.today(), part_name: 'Lever', planned_qty: '1000', status: 'Planned', produced_qty: '900', shortfall_reason: 'Material shortage' });
    assert.equal(ok.status, 303);
    assert.equal(app.db.get("SELECT status FROM production_plans WHERE part_name = 'Lever'").status, 'Short', 'status follows the produced quantity');
    const no = await u.post('/payment_plans/new', { _csrf: tok, category: 'Rent', payee: 'Landlord', amount: '1', plan_date: F.today(), priority: 'Normal', status: 'Planned' });
    assert.equal(no.status, 403);
  });

  await t.test('department heads give jobs in their department; the person doing it posts progress', async () => {
    const signIn = async (name, email, role, department, isHead, newPw) => {
      const made = await admin.post('/users/new', { _csrf: csrf, name, email, role, department, ...(isHead ? { is_head: '1' } : {}) });
      const pw = /class="temp-pw">([^<]+)</.exec(made.text)[1];
      const a = new Agent(base);
      await login(a, email, pw);
      const page = await a.get('/account/password');
      await a.post('/account/password', { _csrf: csrfOf(page.text), current: pw, password: newPw, confirm: newPw });
      return a;
    };
    const noDept = await admin.post('/users/new', { _csrf: csrf, name: 'Headless', email: 'headless@test.local', role: 'sales', is_head: '1' });
    assert.equal(noDept.status, 422, 'a head needs a department');
    const head = await signIn('Prod Head', 'head@test.local', 'production', 'Production', true, 'presses run all night');
    const fitter = await signIn('Fitter One', 'fitter@test.local', 'viewer', 'Production', false, 'grease the gibs weekly');
    const fitterId = app.db.get('SELECT id FROM users WHERE email = :e', { e: 'fitter@test.local' }).id;
    const salesId = app.db.get('SELECT id FROM users WHERE email = :e', { e: 'prod@test.local' }).id; // the production-role user from an earlier test, no department
    const headTok = csrfOf((await head.get('/jobs')).text);

    const ok = await head.post('/jobs/new', { _csrf: headTok, title: 'Change clutch lining', department: 'Production', assigned_to: String(fitterId), priority: 'High', due_on: F.addDays(F.today(), 2), status: 'To do' });
    assert.equal(ok.status, 303);
    const job = app.db.get("SELECT * FROM jobs WHERE title = 'Change clutch lining'");
    assert.equal(job.assigned_by, app.db.get('SELECT id FROM users WHERE email = :e', { e: 'head@test.local' }).id);
    const otherDept = await head.post('/jobs/new', { _csrf: headTok, title: 'Sell more', department: 'Sales', assigned_to: String(fitterId), priority: 'Normal', status: 'To do' });
    assert.equal(otherDept.status, 422);
    assert.match(otherDept.text, /You can give jobs in Production only/);
    const notInDept = await head.post('/jobs/new', { _csrf: headTok, title: 'Count stock', department: 'Production', assigned_to: String(salesId), priority: 'Normal', status: 'To do' });
    assert.equal(notInDept.status, 422);
    assert.match(notInDept.text, /is not in Production/);

    const fitterTok = csrfOf((await fitter.get('/jobs')).text);
    const mine = await fitter.get('/jobs');
    assert.match(mine.text, /Change clutch lining/, 'shows under My jobs');
    assert.equal((await fitter.post('/jobs/new', { _csrf: fitterTok, title: 'x', department: 'Production', assigned_to: String(fitterId), priority: 'Normal', status: 'To do' })).status, 403);
    assert.equal((await fitter.post(`/jobs/${job.id}/edit`, { _csrf: fitterTok, title: 'Renamed', department: 'Production', assigned_to: String(fitterId), priority: 'Low', status: 'To do' })).status, 403);
    const cancel = await fitter.post(`/jobs/${job.id}/update`, { _csrf: fitterTok, status: 'Cancelled' });
    assert.equal(cancel.status, 303);
    assert.equal(app.db.get('SELECT status FROM jobs WHERE id = :id', { id: job.id }).status, 'To do', 'the person doing it cannot cancel it');
    const done = await fitter.post(`/jobs/${job.id}/update`, { _csrf: fitterTok, status: 'Done', note: 'Fitted and trial run OK' });
    assert.equal(done.status, 303);
    const after = app.db.get('SELECT status, done_on FROM jobs WHERE id = :id', { id: job.id });
    assert.equal(after.status, 'Done');
    assert.equal(after.done_on, F.today());
    assert.equal(app.db.get('SELECT COUNT(*) AS n FROM job_updates WHERE job_id = :id', { id: job.id }).n, 2, 'given, then done');
    const page = await head.get(`/jobs/${job.id}/edit`);
    assert.match(page.text, /Fitted and trial run OK/);
  });

  await t.test('company checklist: fill in, evidence, sign-off, compliance, standard sets and scorecards', async () => {
    const CL = require('../src/checklists');
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const signIn = async (name, email, department, isHead, newPw) => {
      const made = await admin.post('/users/new', { _csrf: csrf, name, email, role: 'viewer', department, ...(isHead ? { is_head: '1' } : {}) });
      const pw = /class="temp-pw">([^<]+)</.exec(made.text)[1];
      const a = new Agent(base);
      await login(a, email, pw);
      const page = await a.get('/account/password');
      await a.post('/account/password', { _csrf: csrfOf(page.text), current: pw, password: newPw, confirm: newPw });
      return a;
    };
    const qhead = await signIn('Quality Head', 'qhead@test.local', 'Quality', true, 'gauges never lie today');
    const inspector = await signIn('Inspector One', 'inspector@test.local', 'Quality', false, 'measure twice cut once');
    const idOf = (email) => app.db.get('SELECT id FROM users WHERE email = :e', { e: email }).id;
    const inspectorId = idOf('inspector@test.local');
    const qheadId = idOf('qhead@test.local');
    const runStatus = (id) => app.db.get('SELECT status FROM checklist_runs WHERE id = :id', { id }).status;

    // A head sets up checklists for their own department only; today's copy appears at once.
    const hTok = csrfOf((await qhead.get('/checklists')).text);
    const otherDept = await qhead.post('/checklists/new', { _csrf: hTok, title: 'Sales round', department: 'Sales', frequency: 'Daily', items_text: 'Anything' });
    assert.equal(otherDept.status, 422);
    const made = await qhead.post('/checklists/new', {
      _csrf: hTok, title: 'Gauge check', department: 'Quality', assignee_id: String(inspectorId), frequency: 'Daily', needs_approval: '1', active: '1',
      items_text: '1. Gauges clean\n- Air pressure [5-6 kg/cm²]\nDiesel level [litres]\n',
    });
    assert.equal(made.status, 303);
    const run = app.db.get("SELECT r.* FROM checklist_runs r JOIN checklists c ON c.id = r.checklist_id WHERE c.title = 'Gauge check' AND r.due_on = :t", { t: F.today() });
    assert.ok(run, 'today’s copy is made');
    const answers = app.db.all('SELECT * FROM checklist_answers WHERE run_id = :id ORDER BY position', { id: run.id });
    assert.deepEqual(answers.map((a) => [a.text, a.kind, a.min, a.max, a.unit]), [
      ['Gauges clean', 'check', null, null, null], ['Air pressure', 'reading', 5, 6, 'kg/cm²'], ['Diesel level', 'reading', null, null, 'litres'],
    ]);

    // The person it is given to fills it in: every item needs an answer, and a problem needs a note.
    assert.match((await inspector.get('/my-checklists')).text, /Gauge check/);
    const page = await inspector.get(`/checklist_runs/${run.id}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /enctype="multipart\/form-data"/);
    const iTok = csrfOf(page.text);
    const [a1, a2, a3] = answers;
    const submit = (fields, files) => inspector.upload(`/checklist_runs/${run.id}/submit`, { _csrf: iTok, ...fields }, files);
    const missing = await submit({ [`a_${a1.id}`]: 'ok', [`a_${a2.id}`]: '5.5' });
    assert.equal(missing.status, 422);
    assert.match(missing.text, /Enter the reading/);
    const noNote = await submit({ [`a_${a1.id}`]: 'not_ok', [`a_${a2.id}`]: '4.2', [`a_${a3.id}`]: '120' });
    assert.equal(noNote.status, 422);
    assert.match(noNote.text, /Say what is wrong/);
    assert.match(noNote.text, /Outside the limits/);
    const good = { [`a_${a1.id}`]: 'ok', [`a_${a2.id}`]: '4.2', [`n_${a2.id}`]: 'Regulator reset', [`a_${a3.id}`]: '1,200', remarks: 'Fine after the reset' };
    const notPhoto = await submit(good, [{ name: 'notes.png', data: Buffer.from('just text'), type: 'image/png' }]);
    assert.equal(notPhoto.status, 422, 'files are checked by their content, not their name');
    assert.match(notPhoto.text, /a photo \(JPG, PNG, WebP\) or a PDF/);
    assert.equal(runStatus(run.id), 'Open', 'nothing saved');
    const sent = await submit(good, [{ name: 'gauge.png', data: PNG, type: 'image/png' }]);
    assert.equal(sent.status, 303);
    const after = app.db.get('SELECT * FROM checklist_runs WHERE id = :id', { id: run.id });
    assert.equal(after.status, 'Submitted');
    assert.equal(after.issues, 1, 'the low air pressure counts as a problem');
    assert.equal(app.db.get('SELECT value FROM checklist_answers WHERE id = :id', { id: a3.id }).value, '1200');
    const file = app.db.get("SELECT * FROM attachments WHERE entity = 'checklist_runs' AND entity_id = :id", { id: run.id });
    assert.equal(file.mime, 'image/png');
    assert.ok(fs.existsSync(path.join(dir, 'uploads', file.stored)));
    const img = await qhead.get(`/attachments/${file.id}`);
    assert.equal(img.status, 200);
    assert.match(img.headers.get('content-type'), /^image\/png/);
    assert.equal((await new Agent(base).get(`/attachments/${file.id}`)).status, 303, 'files only for people signed in');

    // The head signs off or sends it back with a remark; nobody signs off their own checklist.
    const approvals = await qhead.get('/approvals');
    assert.match(approvals.text, /Gauge check/);
    assert.equal((await inspector.post(`/checklist_runs/${run.id}/review`, { _csrf: iTok, decision: 'approve' })).status, 403);
    await qhead.post(`/checklist_runs/${run.id}/review`, { _csrf: hTok, decision: 'return' });
    assert.equal(runStatus(run.id), 'Submitted', 'sending back needs a remark');
    await qhead.post(`/checklist_runs/${run.id}/review`, { _csrf: hTok, decision: 'return', note: 'Add a photo of the regulator' });
    assert.equal(runStatus(run.id), 'Returned');
    assert.match((await inspector.get(`/checklist_runs/${run.id}`)).text, /Add a photo of the regulator/);
    assert.equal((await submit(good)).status, 303);
    assert.equal(runStatus(run.id), 'Submitted');
    await qhead.post(`/checklist_runs/${run.id}/review`, { _csrf: hTok, decision: 'approve' });
    const signed = app.db.get('SELECT * FROM checklist_runs WHERE id = :id', { id: run.id });
    assert.equal(signed.status, 'Approved');
    assert.equal(signed.reviewed_by, qheadId);
    assert.equal(CL.canReviewRun({ id: qheadId, role: 'viewer', is_head: 1, department: 'Quality' }, { department: 'Quality', submitted_by: qheadId }), false);

    // Compliance: the standard dates load once; marking one done files it and moves the due date on.
    const count = (table) => app.db.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
    assert.equal((await admin.post('/compliance_items/standard', { _csrf: csrf })).status, 303);
    assert.equal(count('compliance_items'), CL.STANDARD_COMPLIANCE.length);
    await admin.post('/compliance_items/standard', { _csrf: csrf });
    assert.equal(count('compliance_items'), CL.STANDARD_COMPLIANCE.length, 'not added twice');
    const gst = app.db.get("SELECT * FROM compliance_items WHERE title LIKE 'GSTR-1%'");
    await admin.upload(`/compliance_items/${gst.id}/done`, { _csrf: csrf, done_on: F.today(), next_due: gst.due_on });
    assert.equal(count('compliance_filings'), 0, 'the next due date must be later');
    const next = CL.nextDue('Monthly', gst.due_on);
    const filed = await admin.upload(`/compliance_items/${gst.id}/done`, { _csrf: csrf, done_on: F.today(), reference: 'ARN 123', amount: '1,234', next_due: next },
      [{ name: 'ack.pdf', data: Buffer.from('%PDF-1.4\n%%EOF\n'), type: 'application/pdf' }]);
    assert.equal(filed.status, 303);
    assert.equal(app.db.get('SELECT due_on FROM compliance_items WHERE id = :id', { id: gst.id }).due_on, next);
    const filing = app.db.get('SELECT * FROM compliance_filings WHERE item_id = :id', { id: gst.id });
    assert.equal(filing.period_due_on, gst.due_on);
    assert.equal(filing.amount, 1234);
    assert.equal(app.db.get("SELECT mime FROM attachments WHERE entity = 'compliance_filings' AND entity_id = :id", { id: filing.id }).mime, 'application/pdf');
    assert.match((await admin.get(`/compliance_items/${gst.id}/edit`)).text, /Ref ARN 123/);

    // The standard checklists load once too.
    const before = count('checklists');
    await admin.post('/checklists/standard', { _csrf: csrf });
    assert.equal(count('checklists'), before + CL.STANDARD_CHECKLISTS.length);
    await admin.post('/checklists/standard', { _csrf: csrf });
    assert.equal(count('checklists'), before + CL.STANDARD_CHECKLISTS.length, 'not added twice');

    // A finished job waits for sign-off too; sending it back needs a remark.
    const job = app.db.get("SELECT * FROM jobs WHERE title = 'Change clutch lining'");
    assert.match((await admin.get('/approvals')).text, /Change clutch lining/);
    await admin.post(`/jobs/${job.id}/review`, { _csrf: csrf, decision: 'return' });
    assert.equal(app.db.get('SELECT status FROM jobs WHERE id = :id', { id: job.id }).status, 'Done');
    await admin.post(`/jobs/${job.id}/review`, { _csrf: csrf, decision: 'approve' });
    assert.ok(app.db.get('SELECT approved_at FROM jobs WHERE id = :id', { id: job.id }).approved_at, 'signed off');
    const fitterId = app.db.get('SELECT assigned_to FROM jobs WHERE id = :id', { id: job.id }).assigned_to;
    const reopened = await admin.post(`/jobs/${job.id}/edit`, { _csrf: csrf, title: job.title, department: 'Production', assigned_to: String(fitterId), priority: 'High', status: 'In progress' });
    assert.equal(reopened.status, 303);
    assert.equal(app.db.get('SELECT approved_at FROM jobs WHERE id = :id', { id: job.id }).approved_at, null, 'reopening through the form clears the sign-off');

    // The register has no generic add or edit page, even for an admin.
    assert.equal((await admin.get('/checklist_runs/new')).status, 404);
    assert.equal((await admin.post(`/checklist_runs/${run.id}/edit`, { _csrf: csrf })).status, 404);
    // A head adds compliance items for their own department only.
    const qTok = csrfOf((await qhead.get('/compliance_items/new')).text);
    const foreign = await qhead.post('/compliance_items/new', { _csrf: qTok, title: 'Boiler licence', category: 'Licence & registration', frequency: 'Yearly', due_on: F.addDays(F.today(), 30), remind_days: '7', department: 'Accounts', active: '1' });
    assert.equal(foreign.status, 422);
    assert.match(foreign.text, /for Quality only/);

    // Scorecards and the registers render.
    const score = await qhead.get('/scorecards');
    assert.equal(score.status, 200);
    assert.match(score.text, /Inspector One/);
    assert.equal((await qhead.get(`/scorecards?week=${F.addDays(F.weekOf(F.today()), -7)}`)).status, 200);
    for (const p of ['/checklist_runs?view=all', '/checklists', '/compliance_items?view=all', '/my-checklists', '/']) {
      assert.equal((await admin.get(p)).status, 200, p);
    }

    // The dashboard fits the person: shop-floor people get their day and the plant, not the money side.
    const floor = await inspector.get('/');
    assert.match(floor.text, /Your day/);
    assert.match(floor.text, /Plant today/);
    assert.doesNotMatch(floor.text, /Money owed to SEI/);
    const office = await admin.get('/');
    assert.match(office.text, /Your day/);
    assert.match(office.text, /Money owed to SEI/);
    assert.match(office.text, /Plant today/, 'admins see both');
  });

  await t.test('long lists come a page at a time', async () => {
    app.db.tx(() => {
      for (let i = 1; i <= 105; i += 1) app.db.run('INSERT INTO suppliers (name) VALUES (:n)', { n: `Pager Supplier ${String(i).padStart(3, '0')}` });
    });
    const first = await admin.get('/suppliers?view=all&q=Pager');
    assert.match(first.text, /105 suppliers · showing 1–100/);
    assert.match(first.text, /Page 1 of 2/);
    assert.equal((first.text.match(/data-label="Supplier"/g) || []).length, 100);
    const second = await admin.get('/suppliers?view=all&q=Pager&page=2');
    assert.match(second.text, /showing 101–105/);
    assert.equal((second.text.match(/data-label="Supplier"/g) || []).length, 5);
    assert.match((await admin.get('/suppliers?view=all&q=Pager&page=99')).text, /Page 2 of 2/, 'a page past the end shows the last one');
  });

  await t.test('people sign in with a user name; email is optional', async () => {
    const made = await admin.post('/users/new', { _csrf: csrf, name: 'Mohan Lal', role: 'viewer', department: 'Production' });
    assert.match(made.text, /signs in as <b>mohan\.lal<\/b>/, 'user name made from the name');
    assert.equal(app.db.get('SELECT email FROM users WHERE username = :u', { u: 'mohan.lal' }).email, null);
    const pw = /class="temp-pw">([^<]+)</.exec(made.text)[1];
    const u = new Agent(base);
    const page = await u.get('/login');
    assert.match(page.text, /User name/);
    const r = await u.post('/login', { _csrf: csrfOf(page.text), username: 'Mohan.Lal', password: pw, next: '' });
    assert.equal(r.status, 303, 'any case works');
    assert.equal(r.location, '/account/password');
    const dup = await admin.post('/users/new', { _csrf: csrf, name: 'Another Mohan', username: 'MOHAN.LAL', role: 'viewer' });
    assert.equal(dup.status, 422);
    assert.match(dup.text, /already has this user name/);
    const spaces = await admin.post('/users/new', { _csrf: csrf, name: 'Bad Name', username: 'bad name', role: 'viewer' });
    assert.equal(spaces.status, 422);
  });

  await t.test('a burst of guesses at one account is cut off, and its owner still gets in', async () => {
    const created = await admin.post('/users/new', { _csrf: csrf, name: 'Burst Target', email: 'burst@test.local', role: 'sales' });
    const pw = /class="temp-pw">([^<]+)</.exec(created.text)[1];
    const attacker = new Agent(base);
    const token = csrfOf((await attacker.get('/login')).text);
    const tries = await Promise.all(Array.from({ length: 20 }, (_, i) => attacker.post('/login', { _csrf: token, email: 'burst@test.local', password: `wrong-guess-${i}`, next: '' })));
    const wrong = tries.filter((r) => r.status === 401).length;
    const refused = tries.filter((r) => r.status === 429).length;
    assert.ok(wrong >= 5 && wrong <= 6, `only the free tries reach the password check (${wrong})`);
    assert.equal(wrong + refused, 20);

    // A new browser has to wait too, even with the right password...
    const owner = new Agent(base);
    const early = await login(owner, 'burst@test.local', pw);
    assert.equal(early.status, 429);
    assert.match(early.text, /Wait \d+ seconds? and try again/);
    await new Promise((r) => setTimeout(r, 2100));
    const inside = await login(owner, 'burst@test.local', pw);
    assert.equal(inside.status, 303);
    assert.ok(owner.jar.sei_dev, 'known-browser cookie set');

    // ...but once it has signed in, the attacker's guessing no longer keeps the owner out.
    assert.equal((await login(attacker, 'burst@test.local', 'another-guess-1')).status, 429);
    const back = new Agent(base);
    back.jar.sei_dev = owner.jar.sei_dev;
    assert.equal((await login(back, 'burst@test.local', pw)).status, 303);
  });

  await t.test('common passwords are refused when choosing a new one', async () => {
    const page = await admin.get('/account/password');
    for (const weak of ['Welcome@123', 'Password@2026', 'admin@123456', '9810012345', 'qwertyuiop', 'abcd@123456']) {
      const r = await admin.post('/account/password', { _csrf: csrfOf(page.text), current: 'a-long-new-password', password: weak, confirm: weak });
      assert.equal(r.status, 422, weak);
      assert.match(r.text, /lists attackers try first|only digits|different characters/, weak);
    }
  });

  // ---------- improvements (November 2026) ----------

  const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const bigPng = (mb) => Buffer.concat([PNG_HEAD, Buffer.alloc(Math.floor(mb * 1024 * 1024) - PNG_HEAD.length)]);

  await t.test('change 1: a checklist on a phone keeps its answers and photos', async () => {
    const made = await admin.post('/checklists/new', { _csrf: csrf, title: 'Phone round', department: 'Quality', frequency: 'Daily', active: '1', items_text: 'Floor clean\nOil level [2-4 litres]\n' });
    assert.equal(made.status, 303);
    const run = app.db.get("SELECT r.id FROM checklist_runs r JOIN checklists c ON c.id = r.checklist_id WHERE c.title = 'Phone round' AND r.due_on = :t", { t: F.today() });
    const page = await admin.get(`/checklist_runs/${run.id}`);
    // The browser itself asks for every answer before anything is sent, so photos are never lost.
    assert.match(page.text, /<input type="radio" name="a_\d+" value="ok" required>/);
    assert.match(page.text, /<input type="text" inputmode="decimal" name="a_\d+" value="" required/);
    assert.match(page.text, /data-min="2" data-max="4"/, 'limits go to the browser, so it can ask for a note');
    assert.match(page.text, /data-max-files="5" data-max-mb="8"/);
    // Five 8 MB photos are within the limit the help text promises.
    const answers = app.db.all('SELECT id FROM checklist_answers WHERE run_id = :id ORDER BY position', { id: run.id });
    const fields = { _csrf: csrf, [`a_${answers[0].id}`]: 'ok', [`a_${answers[1].id}`]: '3' };
    const five = Array.from({ length: 5 }, (_, i) => ({ name: `p${i}.png`, data: bigPng(7.9), type: 'image/png' }));
    const ok = await admin.upload(`/checklist_runs/${run.id}/submit`, fields, five);
    assert.equal(ok.status, 303, 'five photos of 7.9 MB are accepted');
    // A form over the limit gets a clear answer, not a reset connection.
    app.db.run("UPDATE checklist_runs SET status = 'Open' WHERE id = :id", { id: run.id });
    const tooBig = await admin.upload(`/checklist_runs/${run.id}/submit`, fields, [...five, { name: 'p5.png', data: bigPng(7.9), type: 'image/png' }]);
    assert.equal(tooBig.status, 413);
    assert.match(tooBig.text, /8 MB/);
  });

  await t.test('change 2: the status agrees with the data', async () => {
    const cid = String(clientId);
    // A complaint closes only with its root cause and corrective action.
    const base = { _csrf: csrf, client_id: cid, received_on: F.today(), severity: 'Major', defect: 'Crack at bend' };
    const noCause = await admin.post('/complaints/new', { ...base, status: 'Closed' });
    assert.equal(noCause.status, 422);
    assert.match(noCause.text, /Enter the root cause/);
    assert.match(noCause.text, /Enter the corrective and preventive action/);
    const closed = await admin.post('/complaints/new', { ...base, complaint_ref: 'QC-9', status: 'Closed', root_cause: 'Wrong bend radius', corrective_action: 'Die corrected; first-piece check added' });
    assert.equal(closed.status, 303);
    // The same client's complaint number only once.
    const dupRef = await admin.post('/complaints/new', { ...base, complaint_ref: 'qc-9', status: 'Open' });
    assert.equal(dupRef.status, 422);
    assert.match(dupRef.text, /already entered/);
    // A quote that is sent, in negotiation or won has its price.
    const rfq = { _csrf: csrf, client_id: cid, part_name: 'Hinge', received_on: F.today() };
    const wonNoPrice = await admin.post('/rfqs/new', { ...rfq, status: 'Won' });
    assert.equal(wonNoPrice.status, 422);
    assert.match(wonNoPrice.text, /Enter the quoted price/);
    assert.equal((await admin.post('/rfqs/new', { ...rfq, status: 'Won', unit_price: '12.50' })).status, 303);
    // Short production says why.
    const prod = { _csrf: csrf, plan_date: F.today(), part_name: 'Hinge', planned_qty: '1000', status: 'In progress', produced_qty: '600' };
    const noReason = await admin.post('/production_plans/new', prod);
    assert.equal(noReason.status, 422);
    assert.match(noReason.text, /Choose why the quantity is short/);
    // Received means all of it.
    const sup = app.db.get("SELECT id FROM suppliers WHERE name = 'Test Steel'").id;
    const part = await admin.post('/purchase_plans/new', { _csrf: csrf, item: 'HR coil', category: 'Raw material', qty: '100', unit: 'kg', required_by: F.today(), status: 'Received', supplier_id: String(sup), received_qty: '40' });
    assert.equal(part.status, 422);
    assert.match(part.text, /Choose Part received/);
    // No dispatch against a cancelled PO.
    await admin.post('/orders/new', { _csrf: csrf, client_id: cid, po_no: 'PO-CXL', po_date: F.today(), part_name: 'Hinge', qty: '500', due_on: F.addDays(F.today(), 10), status: 'Cancelled' });
    const cxl = app.db.get("SELECT id FROM orders WHERE po_no = 'PO-CXL'");
    const dis = await admin.post('/dispatches/new', { _csrf: csrf, order_id: String(cxl.id), dispatched_on: F.today(), qty: '10' });
    assert.equal(dis.status, 422);
    assert.match(dis.text, /This PO is Cancelled/);
  });

  await t.test('change 3: a delete never erases history', async () => {
    const count = (sql, p = {}) => app.db.get(sql, p).n;
    // A checklist with a missed or filled-in day keeps it: untick In use instead.
    await admin.post('/checklists/new', { _csrf: csrf, title: 'Old round', department: 'Quality', frequency: 'Daily', active: '1', items_text: 'Area clean' });
    const old = app.db.get("SELECT id FROM checklists WHERE title = 'Old round'").id;
    app.db.run('UPDATE checklist_runs SET due_on = :d WHERE checklist_id = :c', { d: F.addDays(F.today(), -1), c: old });
    const blocked = await admin.post(`/checklists/${old}/delete`, { _csrf: csrf });
    assert.equal(blocked.location, `/checklists/${old}/edit`);
    assert.equal(count('SELECT COUNT(*) AS n FROM checklist_runs WHERE checklist_id = :c', { c: old }), 1, 'the missed day is kept');
    assert.match((await admin.get(`/checklists/${old}/edit`)).text, /Untick In use/);
    // A checklist made by mistake today can still go.
    await admin.post('/checklists/new', { _csrf: csrf, title: 'Typo round', department: 'Quality', frequency: 'Daily', active: '1', items_text: 'Area clean' });
    const typo = app.db.get("SELECT id FROM checklists WHERE title = 'Typo round'").id;
    await admin.post(`/checklists/${typo}/delete`, { _csrf: csrf });
    assert.equal(count('SELECT COUNT(*) AS n FROM checklists WHERE id = :c', { c: typo }), 0);
    // A compliance item with filings keeps them.
    const filed = app.db.get('SELECT item_id FROM compliance_filings LIMIT 1').item_id;
    await admin.post(`/compliance_items/${filed}/delete`, { _csrf: csrf });
    assert.ok(app.db.get('SELECT id FROM compliance_items WHERE id = :id', { id: filed }), 'item with filings kept');
    // A client whose only link is a job is not deleted.
    const made = await admin.post('/clients/new', { _csrf: csrf, name: 'Jobs Only Ltd', status: 'Active' });
    const jc = Number(/\/clients\/(\d+)/.exec(made.location)[1]);
    const adminId = app.db.get('SELECT id FROM users WHERE email = :e', { e: 'admin@test.local' }).id;
    const job = await admin.post('/jobs/new', { _csrf: csrf, title: 'Visit Jobs Only', department: 'Sales', assigned_to: String(adminId), priority: 'Normal', status: 'To do', client_id: String(jc), due_on: F.today() });
    assert.equal(job.status, 303);
    await admin.post(`/clients/${jc}/delete`, { _csrf: csrf });
    assert.ok(app.db.get('SELECT id FROM clients WHERE id = :id', { id: jc }), 'client with a job kept');
    // Deleting a logged call shows on the client's timeline.
    const act = app.db.get('SELECT id FROM activities WHERE client_id = :c LIMIT 1', { c: clientId });
    await admin.post(`/activities/${act.id}/delete`, { _csrf: csrf });
    assert.match((await admin.get(`/clients/${clientId}`)).text, /deleted activity/);
  });

  const newUser = async (name, user, role, department, isHead, pw) => {
    const made = await admin.post('/users/new', { _csrf: csrf, name, username: user, role, department, ...(isHead ? { is_head: '1' } : {}) });
    const temp = /class="temp-pw">([^<]+)</.exec(made.text)[1];
    const a = new Agent(base);
    await login(a, user, temp);
    const page = await a.get('/account/password');
    await a.post('/account/password', { _csrf: csrfOf(page.text), current: temp, password: pw, confirm: pw });
    a.csrf = csrfOf((await a.get('/')).text);
    a.id = app.db.get('SELECT id FROM users WHERE username = :u', { u: user }).id;
    return a;
  };

  await t.test('change 4: "Approved by" is the person who really approved', async () => {
    const clerk = await newUser('Accounts Clerk', 'clerk', 'accounts', 'Accounts', false, 'ledger lines up nicely');
    const head = await newUser('Accounts Head', 'achead', 'accounts', 'Accounts', true, 'books close on friday');
    const adminId = app.db.get('SELECT id FROM users WHERE email = :e', { e: 'admin@test.local' }).id;
    const plan = { category: 'Rent', payee: 'Landlord', amount: '25000', plan_date: F.today(), priority: 'Normal', status: 'Approved', approved_by: String(adminId) };
    // A clerk can't approve, even by naming the admin.
    const byClerk = await clerk.post('/payment_plans/new', { _csrf: clerk.csrf, ...plan });
    assert.equal(byClerk.status, 422);
    assert.match(byClerk.text, /Only an admin or the head of Accounts can approve/);
    // The head approves; the record names the head, whatever the form said.
    assert.equal((await head.post('/payment_plans/new', { _csrf: head.csrf, ...plan, notes: 'June rent' })).status, 303);
    const row = app.db.get("SELECT * FROM payment_plans WHERE notes = 'June rent'");
    assert.equal(row.approved_by, head.id);
    // A later edit by the clerk keeps the head as the approver.
    await clerk.post(`/payment_plans/${row.id}/edit`, { _csrf: clerk.csrf, ...plan, approved_by: String(clerk.id), notes: 'June rent', reference: 'UTR1' });
    assert.equal(app.db.get('SELECT approved_by FROM payment_plans WHERE id = :id', { id: row.id }).approved_by, head.id);
    // Petty cash: only an approver fills in Approved by, and only as themselves.
    const petty = { entry_type: 'Expense', head: 'Tea & refreshments', plan_date: F.today(), description: 'Tea for audit', mode: 'Cash', planned_amount: '300', status: 'Planned', approved_by: String(adminId) };
    const pc = await clerk.post('/petty_cash/new', { _csrf: clerk.csrf, ...petty });
    assert.equal(pc.status, 422);
    assert.match(pc.text, /Only an admin or the head of Accounts can approve/);
    assert.equal((await head.post('/petty_cash/new', { _csrf: head.csrf, ...petty })).status, 303);
    assert.equal(app.db.get("SELECT approved_by FROM petty_cash WHERE description = 'Tea for audit'").approved_by, head.id);
  });

  await t.test('change 5: dates in the right order, and nothing done in the future', async () => {
    const cid = String(clientId);
    const d = (n) => F.addDays(F.today(), n);
    const expect422 = async (p, form, re) => {
      const r = await admin.post(p, { _csrf: csrf, ...form });
      assert.equal(r.status, 422, p);
      assert.match(r.text, re, p);
    };
    await expect422('/rfqs/new', { client_id: cid, part_name: 'Clip', received_on: d(-2), quote_due_on: d(-5), status: 'New' }, /on or after the received date/);
    await expect422('/rfqs/new', { client_id: cid, part_name: 'Clip', received_on: d(-2), status: 'Lost', decision_on: d(-9) }, /on or after the received date/);
    await expect422('/complaints/new', { client_id: cid, received_on: d(-2), severity: 'Minor', defect: 'Scratch', status: 'Closed', root_cause: 'x', corrective_action: 'y', closed_on: d(-5) }, /on or after the received date/);
    await expect422('/orders/new', { client_id: cid, po_no: 'PO-DT', po_date: d(-1), part_name: 'Clip', qty: '10', due_on: d(-3), status: 'Open' }, /on or after the PO date/);
    await expect422('/payment_plans/new', { category: 'Rent', payee: 'Landlord', amount: '10', plan_date: F.today(), priority: 'Normal', status: 'Planned', bill_date: d(-1), due_on: d(-4) }, /on or after the bill date/);
    const inv = app.db.get("SELECT id, invoice_date FROM invoices WHERE invoice_no = 'INV-1'");
    await expect422('/payments/new', { invoice_id: String(inv.id), received_on: F.addDays(inv.invoice_date, -1), amount: '1' }, /on or after the invoice date/);
    await expect422('/payments/new', { invoice_id: String(inv.id), received_on: d(30), amount: '1' }, /in the future/);
    const order = app.db.get("SELECT id FROM orders WHERE po_no = 'PO-77'");
    await expect422('/dispatches/new', { order_id: String(order.id), dispatched_on: d(200), qty: '1' }, /in the future/);
    // The Week planner for next week counts only invoices that are really overdue today.
    const P = require('../src/planning');
    app.db.run("INSERT INTO invoices (client_id, invoice_no, invoice_date, amount, due_on) VALUES (:c, 'INV-TMRW', :d, 500, :due)", { c: clientId, d: F.today(), due: d(1) });
    const next = P.loadWeek(app.db, F.addDays(F.weekOf(F.today()), 7));
    const overdueNow = app.db.get('SELECT COUNT(*) AS n FROM v_invoices WHERE balance > 0.5 AND due_on < :t', { t: F.today() }).n;
    assert.equal(next.totals.inOverdueN, overdueNow, 'an invoice due tomorrow is not overdue');
  });

  await t.test('change 6: pages stay quick as the records grow', async () => {
    // "Today" is worked out fast, and still follows the time zone setting.
    const started = performance.now();
    for (let i = 0; i < 10000; i += 1) F.today();
    assert.ok(performance.now() - started < 500, `10 000 calls took ${Math.round(performance.now() - started)} ms`);
    const instant = new Date('2026-01-01T11:30:00Z');
    F.setTimeZone('Pacific/Kiritimati');
    assert.equal(F.isoDate(instant), '2026-01-02');
    F.setTimeZone('Pacific/Pago_Pago');
    assert.equal(F.isoDate(instant), '2026-01-01');
    F.setTimeZone(cfg.timeZone);
    // The client list shows 100 a page, like every other list.
    app.db.tx(() => { for (let i = 1; i <= 105; i += 1) app.db.run("INSERT INTO clients (name, status) VALUES (:n, 'Active')", { n: `Pager Client ${String(i).padStart(3, '0')}` }); });
    const first = await admin.get('/clients?q=Pager+Client&sort=name');
    assert.match(first.text, /105 clients · showing 1–100/);
    assert.match(first.text, /Page 1 of 2/);
    assert.equal((first.text.match(/class="rowlink" href="\/clients\/\d+"/g) || []).length, 100);
    assert.match((await admin.get('/clients?q=Pager+Client&sort=name&page=2')).text, /showing 101–105/);
    // The indexes for the activity log and the money owed are there.
    for (const ix of ['idx_activities_day', 'idx_payments_invoice_cover']) {
      assert.ok(app.db.get("SELECT name FROM sqlite_master WHERE type = 'index' AND name = :n", { n: ix }), ix);
    }
    // The full CSV still has every row and every column.
    const csv = await admin.get('/invoices.csv?view=all');
    assert.match(csv.text.split('\r\n')[0], /Invoice no/);
    assert.equal(csv.text.trim().split('\r\n').length - 1, app.db.get('SELECT COUNT(*) AS n FROM invoices').n);
  });

  await t.test('change 7: lists and the menu work on a phone', async () => {
    // Filters fold behind one button on a phone, so the first rows show on the first screen.
    for (const p of ['/production_plans', '/jobs', '/clients']) {
      const page = await admin.get(p);
      assert.match(page.text, /<details class="ffold"[^>]*><summary class="btn btn-sm ffold-sum">Filters/, p);
    }
    const filtered = await admin.get('/jobs?priority=Urgent');
    assert.match(filtered.text, /<details class="ffold" data-active="1"/, 'a filter in use is marked, so the fold stays open');
    // The menu button says whether the menu is open, and the password page can be reached from the menu.
    const dash = await admin.get('/');
    assert.match(dash.text, /<button class="nav-toggle" type="button" data-nav-toggle aria-controls="side" aria-expanded="false">Menu<\/button>/);
    assert.match(dash.text, /<a class="side-pw" href="\/account\/password">Change password<\/a>/);
    const css = (await admin.get('/static/app.css')).text;
    assert.match(css, /\.side:not\(\.open\) \{[^}]*visibility: hidden/, 'a closed menu takes no keyboard focus');
    assert.match(css, /min-height: 44px/, 'buttons big enough for a finger');
  });

  await t.test('change 8: keyboard and screen-reader users', async () => {
    // A field error is tied to its field; one summary is announced and takes the focus.
    const bad = await admin.post('/contacts/new', { _csrf: csrf, client_id: String(clientId), name: '', email: 'not-an-email' });
    assert.equal(bad.status, 422);
    assert.match(bad.text, /<input type="email" id="f_email" name="email" aria-invalid="true" aria-describedby="f_email-err"/);
    assert.match(bad.text, /<div class="err" id="f_email-err">/);
    assert.doesNotMatch(bad.text, /class="err" role="alert"/, 'only the summary is announced');
    assert.match(bad.text, /<div class="alert alert-error" role="alert" tabindex="-1" data-focus>/);
    // Help text is read with its field.
    const form = await admin.get('/invoices/new');
    assert.match(form.text, /name="due_on" aria-describedby="f_due_on-help"/);
    assert.match(form.text, /<div class="help" id="f_due_on-help">/);
    // The view in use is announced, and menu counts say what they count.
    assert.match((await admin.get('/orders?view=late')).text, /<a class="chip is-active" aria-current="page" href="\/orders\?view=late"/);
    assert.match(form.text, /<span class="vh">Late POs<\/span>/);
    // Each button says what it acts on.
    const jobs = (await admin.get('/jobs?view=all')).text;
    assert.match(jobs, /aria-label="(Start|Done): [^"]+"/);
    assert.match(jobs, /<th scope="col" class=""><span class="vh">Actions<\/span><\/th>/);
    // Focus rings show on the navy menu and on a chosen checklist answer, also in Windows high contrast.
    const css = (await admin.get('/static/app.css')).text;
    assert.match(css, /\.side :focus-visible \{ outline-color: #fff; \}/);
    assert.match(css, /@media \(forced-colors: active\)/);
  });

  await t.test('change 9: screen text in ASD-STE100, one word for one thing', async () => {
    // Errors say what to do.
    const empty = await admin.post('/clients/new', { _csrf: csrf, name: '', status: 'Active', payment_terms_days: '-5' });
    assert.equal(empty.status, 422);
    assert.doesNotMatch(empty.text, />Required</);
    assert.match(empty.text, /Enter the /);
    assert.match(empty.text, /Enter a whole number, 0 or more/);
    const inv = app.db.get("SELECT id FROM invoices WHERE invoice_no = 'INV-1'");
    const over = await admin.post('/payments/new', { _csrf: csrf, invoice_id: String(inv.id), received_on: F.today(), amount: '9999999' });
    assert.match(over.text, /Enter ₹[\d,.]+ or less, with the TDS or debit note/);
    // One word for one thing: client (not customer), sign off (not approve) for checklists and jobs.
    assert.match((await admin.get('/clients')).text, /Every client with/);
    assert.match((await admin.get('/complaints')).text, /Client complaints/);
    const signoffs = await admin.get('/approvals');
    assert.match(signoffs.text, /<h1[^>]*>Sign-offs/);
    assert.doesNotMatch(signoffs.text, />Approve</);
    assert.doesNotMatch((await admin.get('/planning')).text, /[Cc]ustomer/);
    // People sign in with a user name; the role help matches the README.
    const users = (await admin.get('/users')).text;
    assert.match(users, /signs in with their own user name and password/);
    assert.match(users, /Accounts<\/dt><dd>Invoices and payments, contacts, calls and visits, follow-ups/);
    // Empty lists and the help name the real button, and use the active voice.
    const jc = app.db.get("SELECT id FROM clients WHERE name = 'Jobs Only Ltd'").id;
    assert.match((await admin.get(`/clients/${jc}?tab=rfqs`)).text, /Nothing here for Jobs Only Ltd yet/);
    assert.match((await admin.get('/pm_tasks')).text, /Plan PM for this week/);
    const complaintForm = (await admin.get('/complaints/new')).text;
    assert.match(complaintForm, /The app fills this in when/);
    for (const passive of [/Filled in automatically/, /People are grouped/]) assert.doesNotMatch(complaintForm + (await admin.get('/jobs/new')).text, passive);
    // No sentence of help or of a permission message has more than 20 words.
    const { MODULES } = require('../src/modules');
    const long = [];
    for (const m of Object.values(MODULES)) {
      const texts = [m.help, m.forbidden, m.readonlyNote, m.deleteHint, ...(m.fields || []).map((f) => f.help)].filter((x) => typeof x === 'string');
      for (const s of texts.flatMap((x) => x.split(/(?<=[.:])\s+/))) if (s.split(/\s+/).length > 20) long.push(s);
    }
    assert.deepEqual(long, []);
  });

  await t.test('change 10: choosing "From RFQ" fills in the PO', async () => {
    const rfq = app.db.get("SELECT * FROM rfqs WHERE part_name = 'Hinge' AND status = 'Won'");
    const page = await admin.get('/orders/new');
    // The RFQ list carries the part, part number and price, so the browser can fill them in.
    const opt = new RegExp(`<option value="${rfq.id}" data-client="${rfq.client_id}" data-part="Hinge" data-part-no="" data-price="12.5"`);
    assert.match(page.text, opt);
    const js = (await admin.get('/static/app.js')).text;
    assert.match(js, /select\[name=rfq_id\]/, 'public/app.js fills the PO form from the chosen RFQ');
  });

  await t.test('wide screens: the menu is an icon strip across the top, with arrows and the mouse wheel', async () => {
    const dash = (await admin.get('/')).text;
    // Arrow buttons on each side of the strip; they help the mouse only, so the keyboard skips them.
    assert.match(dash, /<button class="strip-arrow" type="button" data-strip="-1" tabindex="-1" aria-hidden="true">/);
    assert.match(dash, /<button class="strip-arrow" type="button" data-strip="1" tabindex="-1" aria-hidden="true">/);
    const css = (await admin.get('/static/app.css')).text;
    assert.match(css, /@media \(min-width: 901px\) \{[\s\S]*?\.side \.nav \{[^}]*flex-direction: row;[^}]*overflow-x: auto;/);
    assert.doesNotMatch(css, /translate: 0 -50%/, 'the old floating rail is gone');
    const js = (await admin.get('/static/app.js')).text;
    assert.match(js, /addEventListener\('wheel'/, 'the mouse wheel scrolls the strip sideways');
  });
});

test('dates: real calendar days, and compliance due dates that keep their day', () => {
  const CL = require('../src/checklists');
  assert.equal(F.isIsoDate('2027-02-31'), false);
  assert.equal(F.isIsoDate('2028-02-29'), true);
  // The TDS returns follow their own calendar: 31 Jan is followed by 31 May, not 30 Apr.
  assert.equal(CL.nextDueFor({ title: 'TDS returns – 24Q and 26Q', frequency: 'Quarterly', due_on: '2027-01-31' }), '2027-05-31');
  assert.equal(CL.nextDueFor({ title: 'GSTR-1 – outward supplies', frequency: 'Monthly', due_on: '2026-12-11' }), '2027-01-11');
  // An item due on the 31st goes to the last day of February and back to the 31st after it.
  const feb = CL.nextDueFor({ title: 'Month-end stock check', frequency: 'Monthly', due_on: '2027-01-31', due_day: 31 });
  assert.equal(feb, '2027-02-28');
  assert.equal(CL.nextDueFor({ title: 'Month-end stock check', frequency: 'Monthly', due_on: feb, due_day: 31 }), '2027-03-31');
  assert.equal(CL.nextDueFor({ title: 'Licence', frequency: 'One-time', due_on: '2027-01-31' }), null);
});

test('sign-in protection helpers', async () => {
  const A = require('../src/auth');
  // IPv6 addresses count by /64; IPv4 and IPv4-mapped addresses count alone.
  assert.equal(A.addressKey('2001:db8:1:2:aaaa::1'), A.addressKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
  assert.notEqual(A.addressKey('2001:db8:1:2::1'), A.addressKey('2001:db8:1:3::1'));
  assert.equal(A.addressKey('2001:DB8::1'), '2001:db8:0:0::/64');
  assert.equal(A.addressKey('::ffff:10.1.2.3'), '10.1.2.3');
  assert.equal(A.addressKey('10.1.2.3'), '10.1.2.3');

  assert.equal(A.passwordProblem('the forklift needs oil'), '');
  assert.equal(A.passwordProblem('k7Pq-mW3xa-R9tzH'), '');
  assert.notEqual(A.passwordProblem('Mehta@2026!', { name: 'Anil Mehta' }), '');

  // Password checks don't run on the request thread.
  const check = A.verifyPassword('right horse battery', A.hashPassword('right horse battery'));
  assert.ok(check instanceof Promise);
  assert.equal(await check, true);
  assert.equal(await A.verifyPassword('wrong', A.hashPassword('right horse battery')), false);

  // Known-browser cookies can't be forged or reused after they expire.
  const tok = A.deviceToken('k1', 7);
  assert.equal(A.deviceUserId('k1', tok), 7);
  assert.equal(A.deviceUserId('k2', tok), 0);
  assert.equal(A.deviceUserId('k1', tok.replace(/^7/, '8')), 0);
  assert.equal(A.deviceUserId('k1', tok, Date.now() + (A.DEVICE_DAYS + 1) * 86400000), 0);

  // A flood of throttling keys drops the least recently used ones, not every count.
  A.noteFailure('lru:keep');
  for (let i = 0; i < 50000; i++) {
    A.noteFailure(`lru:${i}`);
    if (i % 1000 === 0) A.noteFailure('lru:keep');
  }
  assert.ok(A.failureCount('lru:keep') > 0);
  assert.equal(A.failureCount('lru:0'), 0);
});
