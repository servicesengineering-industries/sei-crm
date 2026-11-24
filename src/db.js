'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { baseUsername, uniqueUsername } = require('./usernames');

const TS = `created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`;

// Append new migrations to the end; never edit one that has shipped.
const MIGRATIONS = [
  `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'viewer',
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  ${TS}
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  flash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'Active',
  segment TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  vendor_code TEXT,
  payment_terms_days INTEGER,
  gstin TEXT,
  city TEXT,
  state TEXT,
  address TEXT,
  website TEXT,
  notes TEXT,
  ${TS}
);

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  designation TEXT,
  department TEXT,
  location TEXT,
  mobile TEXT,
  phone TEXT,
  email TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  ${TS}
);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  subject TEXT NOT NULL,
  notes TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ${TS}
);

CREATE TABLE followups (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  due_on TEXT NOT NULL,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Open',
  done_on TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ${TS}
);

CREATE TABLE rfqs (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  part_name TEXT NOT NULL,
  part_no TEXT,
  drawing_rev TEXT,
  material TEXT,
  annual_volume INTEGER,
  rfq_ref TEXT,
  received_on TEXT NOT NULL,
  quote_due_on TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  quote_no TEXT,
  quoted_on TEXT,
  unit_price REAL,
  tooling_cost REAL,
  decision_on TEXT,
  lost_reason TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  ${TS}
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rfq_id INTEGER REFERENCES rfqs(id) ON DELETE SET NULL,
  po_no TEXT NOT NULL,
  po_date TEXT,
  part_name TEXT NOT NULL,
  part_no TEXT,
  plant TEXT,
  qty INTEGER NOT NULL,
  unit_price REAL,
  due_on TEXT,
  status TEXT NOT NULL DEFAULT 'Open',
  notes TEXT,
  ${TS}
);

CREATE TABLE dispatches (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  dispatched_on TEXT NOT NULL,
  qty INTEGER NOT NULL,
  invoice_no TEXT,
  notes TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ${TS}
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  invoice_no TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  amount REAL NOT NULL,
  due_on TEXT,
  notes TEXT,
  ${TS}
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  received_on TEXT NOT NULL,
  amount REAL NOT NULL,
  deduction REAL,
  mode TEXT,
  reference TEXT,
  notes TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ${TS}
);

CREATE TABLE complaints (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  complaint_ref TEXT,
  received_on TEXT NOT NULL,
  category TEXT,
  severity TEXT NOT NULL DEFAULT 'Major',
  part_name TEXT,
  part_no TEXT,
  defect TEXT NOT NULL,
  qty_affected INTEGER,
  status TEXT NOT NULL DEFAULT 'Open',
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_on TEXT,
  containment TEXT,
  root_cause TEXT,
  corrective_action TEXT,
  closed_on TEXT,
  notes TEXT,
  ${TS}
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  summary TEXT NOT NULL
);

CREATE INDEX idx_contacts_client ON contacts(client_id);
CREATE INDEX idx_activities_client ON activities(client_id, occurred_on);
CREATE INDEX idx_followups_client ON followups(client_id, status, due_on);
CREATE INDEX idx_followups_assigned ON followups(assigned_to, status, due_on);
CREATE INDEX idx_rfqs_client ON rfqs(client_id, status);
CREATE INDEX idx_orders_client ON orders(client_id, status);
CREATE INDEX idx_dispatches_order ON dispatches(order_id);
CREATE INDEX idx_invoices_client ON invoices(client_id);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_complaints_client ON complaints(client_id, status);
CREATE INDEX idx_audit_client ON audit_log(client_id, at);
CREATE INDEX idx_sessions_user ON sessions(user_id);
`,
  // 2: lookups for the duplicate invoice and PO checks
  `
CREATE INDEX IF NOT EXISTS idx_invoices_no ON invoices(invoice_no COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_orders_po ON orders(client_id, po_no COLLATE NOCASE);
`,
  // 3: weekly planning: suppliers, machines and tools with preventive maintenance, and the
  // weekly sales, production, purchase, payment and petty cash plans. week_start is a Monday.
  `
CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category TEXT,
  contact_person TEXT,
  mobile TEXT,
  email TEXT,
  gstin TEXT,
  payment_terms_days INTEGER,
  city TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  ${TS}
);

CREATE TABLE assets (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'Machine',
  category TEXT,
  location TEXT,
  make TEXT,
  model_no TEXT,
  serial_no TEXT,
  capacity TEXT,
  part_name TEXT,
  status TEXT NOT NULL DEFAULT 'Running',
  installed_on TEXT,
  pm_frequency TEXT,
  pm_day TEXT,
  pm_minutes INTEGER,
  pm_checklist TEXT,
  responsible_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_pm_on TEXT,
  notes TEXT,
  ${TS}
);

CREATE TABLE pm_tasks (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  planned_on TEXT NOT NULL,
  week_start TEXT NOT NULL,
  checklist TEXT,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  technician TEXT,
  status TEXT NOT NULL DEFAULT 'Planned',
  done_on TEXT,
  downtime_min INTEGER,
  findings TEXT,
  spares_used TEXT,
  cost REAL,
  notes TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ${TS}
);

CREATE TABLE sales_plans (
  id INTEGER PRIMARY KEY,
  week_start TEXT NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  part_name TEXT NOT NULL,
  part_no TEXT,
  planned_qty INTEGER NOT NULL,
  rate REAL,
  dispatch_on TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  ${TS}
);

CREATE TABLE production_plans (
  id INTEGER PRIMARY KEY,
  plan_date TEXT NOT NULL,
  week_start TEXT NOT NULL,
  shift TEXT,
  asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  operation TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  part_name TEXT NOT NULL,
  part_no TEXT,
  planned_qty INTEGER NOT NULL,
  produced_qty INTEGER,
  rejected_qty INTEGER,
  status TEXT NOT NULL DEFAULT 'Planned',
  shortfall_reason TEXT,
  supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  ${TS}
);

CREATE TABLE purchase_plans (
  id INTEGER PRIMARY KEY,
  required_by TEXT NOT NULL,
  week_start TEXT NOT NULL,
  category TEXT NOT NULL,
  item TEXT NOT NULL,
  spec TEXT,
  purpose TEXT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  qty REAL NOT NULL,
  unit TEXT,
  rate REAL,
  status TEXT NOT NULL DEFAULT 'Planned',
  po_no TEXT,
  po_date TEXT,
  received_qty REAL,
  received_on TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  ${TS}
);

CREATE TABLE payment_plans (
  id INTEGER PRIMARY KEY,
  plan_date TEXT NOT NULL,
  week_start TEXT NOT NULL,
  category TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  payee TEXT NOT NULL,
  bill_no TEXT,
  bill_date TEXT,
  due_on TEXT,
  amount REAL NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Normal',
  mode TEXT,
  status TEXT NOT NULL DEFAULT 'Planned',
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  paid_on TEXT,
  paid_amount REAL,
  reference TEXT,
  notes TEXT,
  ${TS}
);

CREATE TABLE petty_cash (
  id INTEGER PRIMARY KEY,
  plan_date TEXT NOT NULL,
  week_start TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'Expense',
  head TEXT,
  description TEXT NOT NULL,
  paid_to TEXT,
  mode TEXT NOT NULL DEFAULT 'Cash',
  planned_amount REAL NOT NULL,
  amount REAL,
  status TEXT NOT NULL DEFAULT 'Planned',
  voucher_no TEXT,
  upi_ref TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  ${TS}
);

CREATE INDEX idx_pm_tasks_asset ON pm_tasks(asset_id, status, planned_on);
CREATE INDEX idx_pm_tasks_week ON pm_tasks(week_start);
CREATE INDEX idx_sales_plans_week ON sales_plans(week_start, client_id);
CREATE INDEX idx_production_plans_week ON production_plans(week_start, plan_date);
CREATE INDEX idx_production_plans_asset ON production_plans(asset_id, plan_date);
CREATE INDEX idx_purchase_plans_week ON purchase_plans(week_start);
CREATE INDEX idx_purchase_plans_supplier ON purchase_plans(supplier_id);
CREATE INDEX idx_payment_plans_week ON payment_plans(week_start);
CREATE INDEX idx_payment_plans_supplier ON payment_plans(supplier_id);
CREATE INDEX idx_petty_cash_week ON petty_cash(week_start);
CREATE INDEX idx_dispatches_client_day ON dispatches(client_id, dispatched_on);
`,
  // 4: people belong to a department, departments have heads, and heads and admins give jobs.
  `
ALTER TABLE users ADD COLUMN department TEXT;
ALTER TABLE users ADD COLUMN is_head INTEGER NOT NULL DEFAULT 0;

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  details TEXT,
  department TEXT NOT NULL,
  assigned_to INTEGER NOT NULL REFERENCES users(id),
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'Normal',
  due_on TEXT,
  status TEXT NOT NULL DEFAULT 'To do',
  done_on TEXT,
  ${TS}
);

CREATE TABLE job_updates (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT,
  note TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_jobs_assignee ON jobs(assigned_to, status, due_on);
CREATE INDEX idx_jobs_department ON jobs(department, status);
CREATE INDEX idx_jobs_assigner ON jobs(assigned_by, status);
CREATE INDEX idx_job_updates_job ON job_updates(job_id, id);
`,
  // 5: people sign in with a user name; email becomes optional. SQLite can't drop NOT NULL in
  // place, so the users table is rebuilt. Foreign keys are paused for it (see openDb): with them on,
  // dropping the old table would fire every ON DELETE rule pointing at users.
  {
    fkOff: true,
    up(raw) {
      raw.exec(`
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'viewer',
  department TEXT,
  is_head INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  ${TS}
);`);
      const taken = new Set();
      const copy = raw.prepare(`INSERT INTO users_new (id, name, username, email, role, department, is_head, password_hash,
                                                       must_change_password, active, last_login_at, created_at, updated_at)
                                SELECT id, name, ?, email, role, department, is_head, password_hash,
                                       must_change_password, active, last_login_at, created_at, updated_at
                                FROM users WHERE id = ?`);
      for (const u of raw.prepare('SELECT id, name, email FROM users ORDER BY id').all()) {
        const username = uniqueUsername(baseUsername(u.name, u.email), (c) => taken.has(c));
        taken.add(username);
        copy.run(username, u.id);
      }
      raw.exec('DROP TABLE users; ALTER TABLE users_new RENAME TO users;');
    },
  },
  // 6: the company checklist: recurring checklists and their daily copies, the compliance
  // calendar, sign-off on jobs, and photo or document evidence on any of them.
  `
CREATE TABLE checklists (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  department TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'Daily (Mon–Sat)',
  weekday TEXT,
  month_day INTEGER,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  needs_approval INTEGER NOT NULL DEFAULT 1,
  items_text TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  ${TS}
);

CREATE TABLE checklist_runs (
  id INTEGER PRIMARY KEY,
  checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  due_on TEXT NOT NULL,
  department TEXT NOT NULL,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Open',
  issues INTEGER NOT NULL DEFAULT 0,
  remarks TEXT,
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  review_note TEXT,
  ${TS},
  UNIQUE (checklist_id, due_on)
);

CREATE TABLE checklist_answers (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES checklist_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'check',
  unit TEXT,
  min REAL,
  max REAL,
  value TEXT,
  ok INTEGER,
  note TEXT
);

CREATE TABLE compliance_items (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'Monthly',
  due_on TEXT NOT NULL,
  remind_days INTEGER NOT NULL DEFAULT 7,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  department TEXT,
  authority TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  ${TS}
);

CREATE TABLE compliance_filings (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES compliance_items(id) ON DELETE CASCADE,
  period_due_on TEXT NOT NULL,
  done_on TEXT NOT NULL,
  done_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reference TEXT,
  amount REAL,
  note TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  stored TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE jobs ADD COLUMN approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN approved_at TEXT;

CREATE INDEX idx_checklists_dept ON checklists(department, active);
CREATE INDEX idx_runs_due ON checklist_runs(due_on, status);
CREATE INDEX idx_runs_assignee ON checklist_runs(assignee_id, status, due_on);
CREATE INDEX idx_runs_dept ON checklist_runs(department, status, due_on);
CREATE INDEX idx_answers_run ON checklist_answers(run_id, position);
CREATE INDEX idx_compliance_due ON compliance_items(active, due_on);
CREATE INDEX idx_filings_item ON compliance_filings(item_id, done_on);
CREATE INDEX idx_attachments_entity ON attachments(entity, entity_id);
`,
  // 7: the intended day of the month for a compliance item, so dates on the 29th–31st don't drift
  // to the 28th after February.
  `
ALTER TABLE compliance_items ADD due_day INTEGER;
UPDATE compliance_items SET due_day = CAST(substr(due_on, 9, 2) AS INTEGER);
`,
  // 8: speed. Recent calls and visits by date (dashboard, activity log), and what has been paid
  // on each invoice read from the index alone (menu counts, dashboard money, Week planner).
  `
CREATE INDEX IF NOT EXISTS idx_activities_day ON activities(occurred_on);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_cover ON payments(invoice_id, amount, deduction, received_on);
`,
];

// Days between preventive maintenance at each frequency. Monthly and longer are counted in
// whole weeks (4, 13, 26, 52) so every PM lands in a planning week and the weekly plan stays even.
const PM_DAYS = { Weekly: 7, Fortnightly: 14, Monthly: 28, Quarterly: 91, 'Half-yearly': 182, Yearly: 364 };
const pmDaysSql = (col) => `CASE ${col} ${Object.entries(PM_DAYS).map(([k, d]) => `WHEN '${k}' THEN ${d}`).join(' ')} END`;

// Recreated on every start, so changing them needs no migration.
const VIEWS = `
DROP VIEW IF EXISTS v_orders;
CREATE VIEW v_orders AS
SELECT o.*,
       COALESCE((SELECT SUM(d.qty) FROM dispatches d WHERE d.order_id = o.id), 0) AS dispatched,
       o.qty - COALESCE((SELECT SUM(d.qty) FROM dispatches d WHERE d.order_id = o.id), 0) AS pending,
       (SELECT MAX(d.dispatched_on) FROM dispatches d WHERE d.order_id = o.id) AS last_dispatch_on
FROM orders o;
-- Totals are looked up per order through idx_dispatches_order, so a query that picks a few
-- orders (open ones, one client's) doesn't add up every dispatch ever made.

DROP VIEW IF EXISTS v_invoices;
CREATE VIEW v_invoices AS
SELECT i.*,
       COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS received,
       COALESCE((SELECT SUM(COALESCE(p.deduction, 0)) FROM payments p WHERE p.invoice_id = i.id), 0) AS deducted,
       ROUND(i.amount - COALESCE((SELECT SUM(p.amount + COALESCE(p.deduction, 0)) FROM payments p WHERE p.invoice_id = i.id), 0), 2) AS balance,
       (SELECT MAX(p.received_on) FROM payments p WHERE p.invoice_id = i.id) AS last_payment_on
FROM invoices i;

-- Last PM is the later of the last task marked Done and the date entered on the register.
-- A machine never maintained has no next date: it is due now.
DROP VIEW IF EXISTS v_assets;
CREATE VIEW v_assets AS
SELECT x.*,
       CASE WHEN x.last_done_on IS NULL OR x.pm_days IS NULL THEN NULL
            ELSE date(x.last_done_on, '+' || x.pm_days || ' days') END AS next_pm_on
FROM (
  SELECT a.*,
         ${pmDaysSql('a.pm_frequency')} AS pm_days,
         CASE WHEN t.last_done IS NULL THEN a.last_pm_on
              WHEN a.last_pm_on IS NULL OR t.last_done > a.last_pm_on THEN t.last_done
              ELSE a.last_pm_on END AS last_done_on,
         COALESCE(t.open_tasks, 0) AS open_tasks,
         t.next_planned_on
  FROM assets a
  LEFT JOIN (SELECT asset_id,
                    MAX(CASE WHEN status = 'Done' THEN done_on END) AS last_done,
                    COUNT(CASE WHEN status IN ('Planned', 'Postponed') THEN 1 END) AS open_tasks,
                    MIN(CASE WHEN status IN ('Planned', 'Postponed') THEN planned_on END) AS next_planned_on
             FROM pm_tasks GROUP BY asset_id) t ON t.asset_id = a.id
) x;

-- Actual sales for a plan line: what was dispatched to that client in that week, against the
-- line's PO when it names one, otherwise against any PO for the same part that has no line of
-- its own that week (so one dispatch is never counted on two lines).
DROP VIEW IF EXISTS v_sales_plans;
CREATE VIEW v_sales_plans AS
SELECT y.*,
       y.planned_qty * y.rate AS planned_value,
       y.actual_qty * y.rate AS actual_value,
       y.planned_qty - y.actual_qty AS balance_qty
FROM (
  SELECT s.*,
         COALESCE((SELECT SUM(d.qty) FROM dispatches d JOIN orders o ON o.id = d.order_id
                   WHERE d.client_id = s.client_id
                     AND d.dispatched_on BETWEEN s.week_start AND date(s.week_start, '+6 days')
                     AND CASE WHEN s.order_id IS NOT NULL THEN d.order_id = s.order_id
                              ELSE o.part_name = s.part_name COLLATE NOCASE
                                   AND (s.part_no IS NULL OR COALESCE(o.part_no, '') = s.part_no COLLATE NOCASE)
                                   AND NOT EXISTS (SELECT 1 FROM sales_plans s2 WHERE s2.week_start = s.week_start
                                                     AND s2.client_id = s.client_id AND s2.order_id = d.order_id) END), 0) AS actual_qty
  FROM sales_plans s
) y;
`;

// Customers listed on sei.co.in. Segments are only set where the business is clear.
const SEI_CLIENTS = [
  ['Maruti Suzuki', 'OEM – Passenger cars'],
  ['Suzuki', 'OEM – Other'],
  ['CNH Industrial', 'OEM – Tractors'],
  ['Escorts', 'OEM – Tractors'],
  ['Piaggio', 'OEM – 3-wheelers'],
  ['Kongsberg Automotive', 'Tier-1 supplier'],
  ['JBM Group', 'Tier-1 supplier'],
  ['Bellsonica', 'Tier-1 supplier'],
  ['NIFCO', 'Tier-1 supplier'],
  ['Terra Motors', 'OEM – 3-wheelers'],
  ['Krishna Maruti', 'Tier-1 supplier'],
  ['IFB', null],
  ['Groz', null],
  ['Aditya', null],
  ['Udaan', null],
  ['Jupiter', null],
];

const PARAM_RE = /[:@$]([A-Za-z_][A-Za-z0-9_]*)/g;

// node:sqlite throws on unknown named parameters, so bind only the names each statement uses.
function wrap(raw) {
  const cache = new Map();
  function prep(sql) {
    let entry = cache.get(sql);
    if (!entry) {
      const names = new Set();
      for (const m of sql.matchAll(PARAM_RE)) names.add(m[1]);
      entry = { stmt: raw.prepare(sql), names: [...names] };
      if (cache.size > 500) cache.clear();
      cache.set(sql, entry);
    }
    return entry;
  }
  function bind(entry, params) {
    const out = {};
    for (const n of entry.names) {
      const v = params ? params[n] : undefined;
      out[n] = v === undefined ? null : typeof v === 'boolean' ? Number(v) : v;
    }
    return out;
  }
  return {
    raw,
    all(sql, params) { const e = prep(sql); return e.stmt.all(bind(e, params)); },
    get(sql, params) { const e = prep(sql); return e.stmt.get(bind(e, params)); },
    run(sql, params) {
      const e = prep(sql);
      const r = e.stmt.run(bind(e, params));
      return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
    },
    exec(sql) { raw.exec(sql); },
    tx(fn) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        try { raw.exec('ROLLBACK'); } catch { /* keep the original error */ }
        throw err;
      }
    },
    close() { raw.close(); },
  };
}

function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  // Each step re-reads the version inside a write lock, so two processes starting together
  // can't both run the same migration. Views are rebuilt in the same locked transaction.
  // A migration marked fkOff (a table rebuild) runs with foreign keys paused, which SQLite only
  // allows outside a transaction; the step checks every key before it commits.
  let fkPaused = false;
  const resumeKeys = () => { if (fkPaused) { raw.exec('PRAGMA foreign_keys = ON'); fkPaused = false; } };
  for (;;) {
    raw.exec('BEGIN IMMEDIATE');
    try {
      const version = raw.prepare('PRAGMA user_version').get().user_version;
      if (version >= MIGRATIONS.length) {
        raw.exec(VIEWS);
        raw.exec('COMMIT');
        break;
      }
      const step = MIGRATIONS[version];
      if (typeof step === 'object' && step.fkOff && !fkPaused) {
        raw.exec('ROLLBACK');
        raw.exec('PRAGMA foreign_keys = OFF');
        fkPaused = true;
        continue; // take the lock again and re-read the version
      }
      if (typeof step === 'string') raw.exec(step);
      else step.up(raw);
      if (fkPaused) {
        const broken = raw.prepare('PRAGMA foreign_key_check').all();
        if (broken.length) throw new Error(`Migration ${version + 1} would break ${broken.length} links between records; nothing was changed.`);
      }
      raw.exec(`PRAGMA user_version = ${version + 1}`);
      raw.exec('COMMIT');
    } catch (err) {
      try { raw.exec('ROLLBACK'); } catch { /* keep the original error */ }
      resumeKeys();
      throw err;
    }
    resumeKeys();
  }
  return wrap(raw);
}

function seedClients(db) {
  if (db.get("SELECT value FROM meta WHERE key = 'clients_seeded'")) return 0;
  return db.tx(() => {
    let added = 0;
    for (const [name, segment] of SEI_CLIENTS) {
      const exists = db.get('SELECT id FROM clients WHERE name = :name', { name });
      if (exists) continue;
      db.run("INSERT INTO clients (name, segment, status) VALUES (:name, :segment, 'Active')", { name, segment });
      added += 1;
    }
    db.run("INSERT INTO meta (key, value) VALUES ('clients_seeded', datetime('now'))");
    return added;
  });
}

module.exports = { openDb, seedClients, SEI_CLIENTS, PM_DAYS };
