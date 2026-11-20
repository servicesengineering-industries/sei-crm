'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

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
];

// Recreated on every start, so changing them needs no migration.
const VIEWS = `
DROP VIEW IF EXISTS v_orders;
CREATE VIEW v_orders AS
SELECT o.*,
       COALESCE(d.dispatched, 0) AS dispatched,
       o.qty - COALESCE(d.dispatched, 0) AS pending,
       d.last_dispatch_on
FROM orders o
LEFT JOIN (SELECT order_id, SUM(qty) AS dispatched, MAX(dispatched_on) AS last_dispatch_on
           FROM dispatches GROUP BY order_id) d ON d.order_id = o.id;

DROP VIEW IF EXISTS v_invoices;
CREATE VIEW v_invoices AS
SELECT i.*,
       COALESCE(p.received, 0) AS received,
       COALESCE(p.deducted, 0) AS deducted,
       ROUND(i.amount - COALESCE(p.received, 0) - COALESCE(p.deducted, 0), 2) AS balance,
       p.last_payment_on
FROM invoices i
LEFT JOIN (SELECT invoice_id, SUM(amount) AS received, SUM(COALESCE(deduction, 0)) AS deducted,
                  MAX(received_on) AS last_payment_on
           FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id;
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
  for (;;) {
    raw.exec('BEGIN IMMEDIATE');
    try {
      const version = raw.prepare('PRAGMA user_version').get().user_version;
      if (version >= MIGRATIONS.length) {
        raw.exec(VIEWS);
        raw.exec('COMMIT');
        break;
      }
      raw.exec(MIGRATIONS[version]);
      raw.exec(`PRAGMA user_version = ${version + 1}`);
      raw.exec('COMMIT');
    } catch (err) {
      try { raw.exec('ROLLBACK'); } catch { /* keep the original error */ }
      throw err;
    }
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

module.exports = { openDb, seedClients, SEI_CLIENTS };
