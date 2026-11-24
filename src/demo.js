'use strict';
// Made-up records for the demo database only (npm run demo). Never runs on the real database.
const { hashPassword } = require('./auth');
const F = require('./format');

const DEFAULT_DEMO_PASSWORD = 'sei-demo-2026';

function rng(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PARTS = [
  ['Parking brake lever assy', 'PBL', 'CRCA 2.0 mm + EN8 pin', 180, 420],
  ['Gear shift lever assy', 'GSL', 'CRCA 2.5 mm', 240, 520],
  ['Brake pedal assy', 'BPA', 'HR 3.0 mm', 310, 640],
  ['Pedal bracket', 'PBR', 'HR 2.5 mm', 38, 95],
  ['Reinforcement plate', 'RFP', 'CRCA 1.6 mm', 12, 40],
  ['Mounting bracket', 'MBR', 'HR 3.0 mm', 18, 55],
  ['Ratchet plate', 'RTP', 'EN8 1.6 mm', 9, 22],
  ['Release button pin', 'RBP', 'EN8 bar', 4, 11],
];
const PEOPLE = ['Amit Sharma', 'Neha Kapoor', 'Rajesh Kumar', 'Priya Malhotra', 'Sandeep Singh', 'Kavita Rao', 'Manoj Verma', 'Deepa Nair', 'Vikas Jain', 'Ritu Bansal', 'Arun Pillai', 'Sneha Joshi', 'Harish Chauhan', 'Meena Iyer', 'Gaurav Saxena', 'Pallavi Desai', 'Rohit Arora', 'Anjali Mehra', 'Suresh Reddy', 'Nidhi Agarwal', 'Karan Bedi', 'Swati Kulkarni', 'Tarun Bhatia', 'Lata Menon'];
const ROLES = [['Purchase', 'Senior Manager – Purchase'], ['SQA / Quality', 'Manager – Supplier Quality'], ['Accounts', 'Accounts Executive'], ['Engineering / Development', 'Development Engineer'], ['Logistics / Stores', 'Stores In-charge']];
const PLANTS = ['Gurugram plant', 'Manesar plant', 'Faridabad plant', 'Greater Noida plant', 'Pune plant', 'Head office'];
const CITIES = [['Gurugram', 'Haryana'], ['Manesar', 'Haryana'], ['Faridabad', 'Haryana'], ['Greater Noida', 'Uttar Pradesh'], ['Pune', 'Maharashtra'], ['Chennai', 'Tamil Nadu']];
const CALLS = ['Confirmed next month’s schedule', 'Chased payment against last month’s invoices', 'Discussed revised drawing for the bracket', 'Asked for feedback on our quotation', 'Agreed dispatch plan for the week', 'Reviewed PPAP documents', 'Price revision discussion for steel increase', 'Shared 8D report on the last complaint'];
const VISITS = ['Plant visit with the purchase team', 'Line visit after rejection at incoming', 'Annual supplier review meeting', 'Sample submission for new part', 'Quarterly business review'];
const FOLLOWUPS = ['Send revised quote', 'Collect payment for overdue invoices', 'Share 8D report', 'Confirm next month’s schedule', 'Arrange sample submission', 'Get PO amendment for new rate', 'Send PPAP documents'];
const DEFECTS = ['Weld spatter on bracket face', 'Burr on lever edge', 'Powder coat peeling near weld', 'Ratchet not engaging at third notch', 'Hole position out of tolerance by 0.4 mm', 'Rust on parts received in transit', 'Wrong part mixed in bin', 'Pin length short on 12 pieces'];

function seedDemo(db) {
  if (db.get("SELECT value FROM meta WHERE key = 'demo_seeded'")) return;
  const r = rng(20261119);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const t = F.today();
  const day = (n) => F.addDays(t, n);
  const hash = hashPassword(process.env.DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD);
  let personIdx = 0;
  const audit = (clientId, userId, entity, summary, at) => db.run(
    "INSERT INTO audit_log (at, user_id, client_id, entity, entity_id, action, summary) VALUES (:at, :u, :c, :e, NULL, 'created', :s)",
    { at: `${at} 10:30:00`, u: userId, c: clientId, e: entity, s: summary },
  );

  db.tx(() => {
    const ins = (sql, p) => db.run(sql, p).id;
    const users = [
      ['Demo Admin', 'admin@demo.local', 'admin'],
      ['Anil Mehta', 'anil@demo.local', 'sales'],
      ['Pooja Arora', 'pooja@demo.local', 'sales'],
      ['Rakesh Gupta', 'rakesh@demo.local', 'accounts'],
      ['Sunil Yadav', 'sunil@demo.local', 'quality'],
      ['Viewer Demo', 'viewer@demo.local', 'viewer'],
    ].map(([name, email, role]) => ins('INSERT INTO users (name, username, email, role, password_hash, must_change_password) VALUES (:name, :username, :email, :role, :hash, 0)', { name, username: email.split('@')[0], email, role, hash }));
    const [admin, anil, pooja, rakesh, sunil] = users;
    const salesTeam = [anil, pooja];
    const clients = db.all('SELECT id, name FROM clients ORDER BY id');
    let poSeq = 4100;
    let invSeq = 1200;
    let quoteSeq = 310;

    clients.forEach((c, i) => {
      const owner = salesTeam[i % 2];
      const terms = pick([30, 45, 60]);
      const [city, state] = CITIES[i % CITIES.length];
      db.run('UPDATE clients SET owner_id = :o, payment_terms_days = :t, vendor_code = :v, city = :city, state = :state WHERE id = :id', {
        o: owner, t: terms, v: `V${int(10000, 99999)}`, city, state, id: c.id,
      });
      const slug = c.name.toLowerCase().replace(/[^a-z]+/g, '');
      const nContacts = i < 10 ? 3 : i < 13 ? 2 : 1;
      const contacts = [];
      for (let k = 0; k < nContacts; k++) {
        const [dept, title] = ROLES[k];
        const name = PEOPLE[personIdx++ % PEOPLE.length];
        contacts.push(ins(`INSERT INTO contacts (client_id, name, designation, department, location, mobile, phone, email, is_primary)
                           VALUES (:c, :name, :title, :dept, :loc, :mob, :ph, :em, :pri)`, {
          c: c.id, name, title, dept, loc: pick(PLANTS), mob: `+91 00000 ${String(10000 + personIdx * 37).slice(-5)}`,
          ph: k === 0 ? `0124 000 ${String(1000 + personIdx * 13).slice(-4)}` : null,
          em: `${name.split(' ')[0].toLowerCase()}.${slug}@example.com`, pri: k === 0 ? 1 : 0,
        }));
      }

      // Activities: most clients recently, a few gone quiet, the last three never contacted.
      if (i < 13) {
        const latest = i >= 9 ? -int(35, 60) : -int(0, 12);
        const n = i >= 9 ? 1 : int(2, 5);
        for (let k = 0; k < n; k++) {
          const when = day(latest - k * int(5, 14));
          const visit = r() < 0.3;
          ins('INSERT INTO activities (client_id, contact_id, type, occurred_on, subject, notes, user_id, created_at) VALUES (:c, :ct, :type, :d, :s, :n, :u, :at)', {
            c: c.id, ct: pick(contacts), type: visit ? 'Visit' : pick(['Call', 'Call', 'Email', 'WhatsApp']), d: when,
            s: visit ? pick(VISITS) : pick(CALLS), n: r() < 0.5 ? 'Next steps agreed on the call. Details in the follow-up.' : null, u: owner, at: `${when} 11:00:00`,
          });
        }
      }

      // Follow-ups.
      if (i < 12) {
        const n = int(1, 2);
        for (let k = 0; k < n; k++) {
          const offset = k === 0 && i % 3 === 0 ? -int(2, 9) : int(0, 10);
          ins('INSERT INTO followups (client_id, contact_id, title, due_on, assigned_to, created_by) VALUES (:c, :ct, :t, :d, :u, :u)', {
            c: c.id, ct: contacts[0], t: pick(FOLLOWUPS), d: day(offset), u: i % 4 === 0 ? admin : owner,
          });
        }
        ins("INSERT INTO followups (client_id, contact_id, title, due_on, assigned_to, created_by, status, done_on) VALUES (:c, :ct, :t, :d, :u, :u, 'Done', :d)", {
          c: c.id, ct: contacts[0], t: pick(FOLLOWUPS), d: day(-int(10, 30)), u: owner,
        });
      }

      // RFQs.
      if (i < 12) {
        const n = int(1, 2);
        for (let k = 0; k < n; k++) {
          const [part, code, material, lo, hi] = pick(PARTS);
          const status = pick(['New', 'Costing', 'Quoted', 'Quoted', 'Negotiation', 'Won', 'Lost']);
          const received = day(-int(5, 75));
          const quoted = ['Quoted', 'Negotiation', 'Won', 'Lost'].includes(status) ? F.addDays(received, int(4, 12)) : null;
          const decided = ['Won', 'Lost'].includes(status) ? F.addDays(quoted, int(7, 20)) : null;
          const rfqId = ins(`INSERT INTO rfqs (client_id, contact_id, part_name, part_no, drawing_rev, material, annual_volume, rfq_ref, received_on, quote_due_on,
                                         status, quote_no, quoted_on, unit_price, tooling_cost, decision_on, lost_reason, owner_id)
                             VALUES (:c, :ct, :part, :pno, :rev, :mat, :vol, :ref, :rec, :due, :st, :qno, :qon, :price, :tool, :dec, :lost, :o)`, {
            c: c.id, ct: contacts[0], part, pno: `${code}-${int(1000, 9999)}`, rev: pick(['A', 'B', 'C']), mat: material,
            vol: int(12, 240) * 1000, ref: `RFQ/${int(100, 999)}`, rec: received, due: F.addDays(received, int(7, 14)), st: status,
            qno: quoted ? `SEI/Q/${quoteSeq++}` : null, qon: quoted, price: quoted ? int(lo * 100, hi * 100) / 100 : null,
            tool: quoted && r() < 0.6 ? int(2, 18) * 25000 : null, dec: decided, lost: status === 'Lost' ? pick(['Price higher than incumbent', 'Customer kept part in-house']) : null, o: owner,
          });
          audit(c.id, owner, 'rfqs', `added RFQ “${part}”`, received);
          if (status === 'Won') audit(c.id, owner, 'rfqs', `updated RFQ “${part}”: status Negotiation → Won`, decided);
          void rfqId;
        }
      }

      // Orders, dispatches, invoices and payments for the first ten clients.
      if (i < 10) {
        const nOrders = int(1, 2);
        for (let k = 0; k < nOrders; k++) {
          const [part, code, , lo, hi] = pick(PARTS);
          const qty = int(10, 80) * 100;
          const price = int(lo * 100, hi * 100) / 100;
          const poDate = day(-int(20, 60));
          const due = day(int(-15, 20));
          const orderId = ins(`INSERT INTO orders (client_id, po_no, po_date, part_name, part_no, plant, qty, unit_price, due_on, status)
                               VALUES (:c, :po, :pd, :part, :pno, :plant, :qty, :price, :due, 'Open')`, {
            c: c.id, po: `PO-${poSeq++}`, pd: poDate, part, pno: `${code}-${int(1000, 9999)}`, plant: pick(PLANTS), qty, price, due,
          });
          const share = due < t && r() < 0.6 ? r() * 0.6 : 0.4 + r() * 0.6;
          let left = Math.round((qty * share) / 100) * 100;
          let d = F.addDays(poDate, int(5, 10));
          while (left > 0 && d <= t) {
            const lot = Math.min(left, int(5, 20) * 100);
            const invNo = `SEI/26-27/${invSeq++}`;
            ins('INSERT INTO dispatches (client_id, order_id, dispatched_on, qty, invoice_no, user_id) VALUES (:c, :o, :d, :q, :inv, :u)', { c: c.id, o: orderId, d, q: lot, inv: invNo, u: owner });
            const amount = Math.round(lot * price * 1.18);
            const invId = ins('INSERT INTO invoices (client_id, order_id, invoice_no, invoice_date, amount, due_on) VALUES (:c, :o, :no, :d, :a, :due)', {
              c: c.id, o: orderId, no: invNo, d, a: amount, due: F.addDays(d, terms),
            });
            const age = F.daysBetween(d, t);
            const roll = r();
            if (age > terms + 10 && roll < 0.7) {
              ins("INSERT INTO payments (client_id, invoice_id, received_on, amount, deduction, mode, reference, user_id) VALUES (:c, :i, :d, :a, :tds, 'NEFT / RTGS', :ref, :u)", {
                c: c.id, i: invId, d: F.addDays(d, terms + int(-5, 8)), a: Math.round(amount * 0.98), tds: amount - Math.round(amount * 0.98), ref: `UTR${int(100000, 999999)}`, u: rakesh,
              });
            } else if (age > terms - 5 && roll < 0.85) {
              ins("INSERT INTO payments (client_id, invoice_id, received_on, amount, mode, reference, user_id) VALUES (:c, :i, :d, :a, 'NEFT / RTGS', :ref, :u)", {
                c: c.id, i: invId, d: F.addDays(d, terms), a: Math.round(amount * 0.5), ref: `UTR${int(100000, 999999)}`, u: rakesh,
              });
            }
            left -= lot;
            d = F.addDays(d, int(6, 14));
          }
        }
      }
    });

    // Quality complaints.
    const cl = (n) => clients[n % clients.length].id;
    const complaints = [
      [0, 'Critical', 'Containment done', -6, 'Line rejection', 3],
      [2, 'Major', 'Open', -3, 'Incoming inspection', 5],
      [4, 'Major', 'Root cause found', -15, 'Field failure / warranty', -2],
      [1, 'Minor', 'Closed', -40, 'Delivery / packing', -30],
      [6, 'Minor', 'Action taken', -9, 'Documentation', 4],
      [3, 'Major', 'Closed', -55, 'Line rejection', -45],
    ];
    complaints.forEach(([idx, severity, status, ago, category, target], n) => {
      const c = cl(idx);
      const contact = db.get('SELECT id FROM contacts WHERE client_id = :c ORDER BY id DESC LIMIT 1', { c });
      const [part, code] = pick(PARTS);
      const received = day(ago);
      ins(`INSERT INTO complaints (client_id, contact_id, complaint_ref, received_on, category, severity, part_name, part_no, defect, qty_affected, status,
                                   owner_id, target_on, containment, root_cause, corrective_action, closed_on)
           VALUES (:c, :ct, :ref, :rec, :cat, :sev, :part, :pno, :defect, :qty, :st, :o, :target, :cont, :root, :capa, :closed)`, {
        c, ct: contact && contact.id, ref: `CC-${int(1000, 9999)}`, rec: received, cat: category, sev: severity, part, pno: `${code}-${int(1000, 9999)}`,
        defect: DEFECTS[n % DEFECTS.length], qty: int(5, 240), st: status, o: sunil, target: day(target),
        cont: status !== 'Open' ? '100% sorting of stock at SEI and at the customer’s stores.' : null,
        root: ['Root cause found', 'Action taken', 'Closed'].includes(status) ? 'Fixture locating pin worn; not caught at first-piece inspection.' : null,
        capa: ['Action taken', 'Closed'].includes(status) ? 'Pin replaced, added to daily fixture checklist, first-piece check now includes this dimension.' : null,
        closed: status === 'Closed' ? day(ago + 12) : null,
      });
      audit(c, sunil, 'complaints', `added complaint “${DEFECTS[n % DEFECTS.length]}”`, received);
    });

    db.run("INSERT INTO meta (key, value) VALUES ('demo_seeded', :v)", { v: t });
  });
  console.log('Demo data added. Demo sign-ins are listed in README.md.');
}

// ---------- weekly planning demo (added separately so an older demo database gets it too) ----------

const SUPPLIERS = [
  ['Aravali Steel Traders', 'Raw material – steel', 'Mukesh Goyal', 30, 'Faridabad'],
  ['Prime Welding Gases', 'Consumables & gases', 'Sanjay Tyagi', 15, 'Gurugram'],
  ['Kiran Fasteners', 'Bought-out parts', 'Kiran Bala', 30, 'Delhi'],
  ['Delta Hydraulics & Spares', 'Tooling & spares', 'Imran Khan', 30, 'Manesar'],
  ['Om Tool Room', 'Tooling & spares', 'Om Prakash', 45, 'Faridabad'],
  ['Bright Powder Coats', 'Consumables & gases', 'Ravi Sood', 30, 'Noida'],
  ['Shiv Zinc Platers', 'Job work', 'Shiv Kumar', 30, 'Gurugram'],
  ['Haryana Roadlines', 'Transport', 'Balwant Singh', 15, 'Gurugram'],
  ['Sunrise Corrugators', 'Packaging', 'Alok Jain', 30, 'Manesar'],
];

// code, name, type, kind, location, checklist, frequency, PM day, minutes, part, weeks until due
const ASSETS = [
  ['PP-01', 'Power press 200 T', 'Machine', 'Mechanical power press 200 T', 'Press shop – bay 1', 'press', 'Weekly', 'Saturday', 90, null, 0],
  ['PP-02', 'Power press 100 T', 'Machine', 'Mechanical power press 100 T', 'Press shop – bay 1', 'press', 'Weekly', 'Saturday', 60, null, 0],
  ['PP-03', 'Power press 63 T', 'Machine', 'Mechanical power press 63 T', 'Press shop – bay 2', 'press', 'Fortnightly', 'Saturday', 60, null, 0],
  ['HP-01', 'Hydraulic press 150 T', 'Machine', 'Hydraulic press 150 T', 'Press shop – bay 2', 'hydraulic', 'Monthly', 'Wednesday', 90, null, 0],
  ['SH-01', 'Shearing machine 3 m', 'Machine', 'Hydraulic shear 3 m × 6 mm', 'Cutting section', 'shear', 'Monthly', 'Thursday', 60, null, 2],
  ['MW-01', 'MIG welder 400 A – cell 1', 'Machine', 'MIG welding machine 400 A', 'Weld shop – cell 1', 'mig', 'Weekly', 'Friday', 30, null, 0],
  ['MW-02', 'MIG welder 400 A – cell 2', 'Machine', 'MIG welding machine 400 A', 'Weld shop – cell 2', 'mig', 'Weekly', 'Friday', 30, null, 0],
  ['SW-01', 'Spot welder 75 kVA', 'Machine', 'Spot welding machine 75 kVA', 'Weld shop', 'spot', 'Fortnightly', 'Thursday', 45, null, -1],
  ['CL-01', 'CNC lathe', 'Machine', 'CNC turning centre', 'Machine shop', 'cnc', 'Monthly', 'Wednesday', 120, null, 1],
  ['DR-01', 'Radial drilling machine', 'Machine', 'Radial drill 40 mm', 'Machine shop', 'drill', 'Monthly', 'Tuesday', 45, null, 0],
  ['AC-01', 'Air compressor 15 HP', 'Utility', 'Screw compressor 15 HP', 'Compressor room', 'compressor', 'Weekly', 'Monday', 30, null, 0],
  ['PC-01', 'Powder coating plant', 'Utility', 'Oven, booth and conveyor', 'Paint shop', 'coating', 'Monthly', 'Saturday', 180, null, 3],
  ['DIE-PBL-01', 'Blanking die – parking brake lever', 'Tool / die', 'Blanking die', 'Tool room', 'die', 'Fortnightly', 'Saturday', 60, 'Parking brake lever assy', 1],
  ['DIE-GSL-01', 'Forming die – gear shift lever', 'Tool / die', 'Forming die', 'Tool room', 'die', 'Monthly', 'Saturday', 60, 'Gear shift lever assy', 0],
  ['DIE-PBR-01', 'Progressive die – pedal bracket', 'Tool / die', 'Progressive die', 'Tool room', 'die', 'Weekly', 'Saturday', 45, 'Pedal bracket', 0],
  ['FX-BPA-01', 'Welding fixture – brake pedal assy', 'Fixture', 'MIG welding fixture', 'Weld shop – cell 1', 'fixture', 'Monthly', 'Friday', 30, 'Brake pedal assy', 2],
  ['FX-PBL-01', 'Welding fixture – parking brake lever', 'Fixture', 'MIG welding fixture', 'Weld shop – cell 2', 'fixture', 'Monthly', 'Friday', 30, 'Parking brake lever assy', 0],
  ['GA-MBR-01', 'Hole position gauge – mounting bracket', 'Gauge', 'Go / no-go gauge', 'Quality lab', 'gauge', 'Quarterly', 'Monday', 20, 'Mounting bracket', 0],
  ['GA-PBR-01', 'Checking fixture – pedal bracket', 'Gauge', 'Checking fixture', 'Quality lab', 'gauge', 'Quarterly', 'Tuesday', 20, 'Pedal bracket', 6],
];
const FINDINGS = ['All checks OK', 'All checks OK', 'Lubrication line choked at one point; cleaned', 'Minor air leak at FRL unit; tightened', 'Contact tip worn; replaced', 'Gib clearance 0.25 mm; adjusted to 0.15 mm', 'All checks OK', 'Burr 0.12 mm on last part; die sent for sharpening'];

function seedPlanningDemo(db) {
  if (db.get("SELECT value FROM meta WHERE key = 'demo_planning_seeded'")) return;
  const { checklistText } = require('./pm-checklists');
  const { planPmWeek } = require('./planning');
  const { PM_DAYS } = require('./db');
  const r = rng(20261123);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const t = F.today();
  const ws = F.weekOf(t);
  const lw = F.addDays(ws, -7);
  const nw = F.addDays(ws, 7);
  const dayIn = (w, name) => F.addDays(w, F.DAYS.indexOf(name));
  const ins = (sql, p) => db.run(sql, p).id;
  const user = (email) => (db.get('SELECT id FROM users WHERE email = :e', { e: email }) || {}).id || null;
  const hash = hashPassword(process.env.DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD);

  db.tx(() => {
    for (const [name, email, role] of [['Vijay Kumar', 'vijay@demo.local', 'production'], ['Neeraj Sethi', 'neeraj@demo.local', 'purchase']]) {
      if (!user(email)) ins('INSERT INTO users (name, username, email, role, password_hash, must_change_password) VALUES (:name, :username, :email, :role, :hash, 0)', { name, username: email.split('@')[0], email, role, hash });
    }
  });
  const admin = user('admin@demo.local');
  const vijay = user('vijay@demo.local');
  const neeraj = user('neeraj@demo.local');
  const sunil = user('sunil@demo.local');
  const rakesh = user('rakesh@demo.local');
  const sales = [user('anil@demo.local'), user('pooja@demo.local')];

  const suppliers = {};
  const assets = {};
  db.tx(() => {
    SUPPLIERS.forEach(([name, category, person, terms, city], i) => {
      suppliers[name] = ins(`INSERT INTO suppliers (name, category, contact_person, mobile, email, payment_terms_days, city)
                             VALUES (:name, :category, :person, :mob, :em, :terms, :city)`, {
        name, category, person, terms, city, mob: `+91 00000 ${String(20011 + i * 41).slice(-5)}`, em: `accounts@${name.toLowerCase().replace(/[^a-z]+/g, '')}.example.com`,
      });
    });

    // The register, with PM history going back about ten weeks.
    for (const [code, name, type, kind, location, list, freq, pmDay, minutes, part, dueIn] of ASSETS) {
      const id = ins(`INSERT INTO assets (code, name, asset_type, category, location, part_name, make, status, installed_on, pm_frequency, pm_day, pm_minutes, pm_checklist, responsible_id)
                      VALUES (:code, :name, :type, :kind, :loc, :part, :make, :status, :inst, :freq, :day, :min, :cl, :resp)`, {
        code, name, type, kind, loc: location, part, make: type === 'Machine' || type === 'Utility' ? pick(['Make A', 'Make B', 'Make C']) : 'SEI tool room',
        status: code === 'SH-01' ? 'Breakdown' : 'Running', inst: `20${int(12, 22)}-0${int(1, 9)}-1${int(0, 9)}`,
        freq, day: pmDay, min: minutes, cl: checklistText(list), resp: type === 'Gauge' ? sunil : vijay,
      });
      assets[code] = id;
      const weeks = PM_DAYS[freq] / 7;
      // The last PM was `weeks` before the week it falls due again; earlier ones every `weeks` before that.
      for (let k = 1; k * weeks - dueIn <= 10; k++) {
        const w = F.addDays(ws, (dueIn - k * weeks) * 7);
        const d = dayIn(w, pmDay);
        if (d >= t) continue;
        const missed = code === 'MW-02' && k === 2;
        ins(`INSERT INTO pm_tasks (asset_id, planned_on, week_start, checklist, assigned_to, technician, status, done_on, downtime_min, findings, spares_used, cost, user_id)
             VALUES (:a, :d, :w, :cl, :u, :tech, :st, :done, :dt, :f, :sp, :cost, :u)`, {
          a: id, d, w, cl: checklistText(list), u: type === 'Gauge' ? sunil : vijay, tech: missed ? null : pick(['Ramesh (fitter)', 'Sohan (electrician)', 'Ajay (tool room)']),
          st: missed ? 'Missed' : 'Done', done: missed ? null : d, dt: missed ? null : minutes + int(-10, 25), f: missed ? null : pick(FINDINGS),
          sp: !missed && r() < 0.25 ? pick(['Grease 1 kg', 'Contact tips ×10', 'O-ring kit', 'V-belt B-52']) : null, cost: !missed && r() < 0.25 ? int(4, 40) * 100 : null,
        });
      }
    }
    // Spot welder: last week's PM was never done, so it shows as overdue.
    const lastThu = dayIn(lw, 'Thursday');
    if (lastThu < t) {
      ins("INSERT INTO pm_tasks (asset_id, planned_on, week_start, checklist, assigned_to, status, user_id) VALUES (:a, :d, :w, :cl, :u, 'Planned', :u)", {
        a: assets['SW-01'], d: lastThu, w: lw, cl: checklistText('spot'), u: vijay,
      });
    }
    db.run("UPDATE assets SET notes = 'Blade chipped on 6 mm HR sheet. New blade set ordered from Om Tool Room.' WHERE code = 'SH-01'");
  });

  // This week's PM, planned the same way the "Plan PM for this week" button does it.
  planPmWeek(db, ws, { userId: vijay });

  db.tx(() => {
    // Anything planned before today is done.
    for (const p of db.all("SELECT p.id, p.planned_on, a.pm_minutes FROM pm_tasks p JOIN assets a ON a.id = p.asset_id WHERE p.week_start = :ws AND p.status = 'Planned' AND p.planned_on < :t", { ws, t })) {
      db.run("UPDATE pm_tasks SET status = 'Done', done_on = :d, technician = 'Ramesh (fitter)', downtime_min = :m, findings = 'All checks OK' WHERE id = :id", { d: p.planned_on, m: p.pm_minutes, id: p.id });
    }

    // Sales plan: last week, this week and next week for every open PO, with dispatches for last week.
    const orders = db.all("SELECT o.*, c.owner_id FROM v_orders o JOIN clients c ON c.id = o.client_id WHERE o.status = 'Open' AND o.pending > 0 ORDER BY o.id");
    orders.forEach((o, i) => {
      const lot = Math.max(100, Math.min(o.pending, Math.round((o.qty * (0.15 + r() * 0.15)) / 100) * 100));
      const owner = o.owner_id || sales[i % 2];
      // Last week: planned, and most of it went out.
      ins('INSERT INTO sales_plans (week_start, client_id, order_id, part_name, part_no, planned_qty, rate, dispatch_on, owner_id) VALUES (:w, :c, :o, :p, :pn, :q, :rate, :d, :u)', {
        w: lw, c: o.client_id, o: o.id, p: o.part_name, pn: o.part_no, q: lot, rate: o.unit_price, d: dayIn(lw, pick(['Tuesday', 'Wednesday', 'Thursday', 'Friday'])), u: owner,
      });
      const sent = Math.min(o.pending, Math.round((lot * (i % 4 === 3 ? 0.5 : 0.9 + r() * 0.2)) / 50) * 50);
      const sentOn = dayIn(lw, pick(['Wednesday', 'Thursday', 'Friday', 'Saturday']));
      if (sent > 0 && sentOn < t) {
        ins("INSERT INTO dispatches (client_id, order_id, dispatched_on, qty, invoice_no, user_id, notes) VALUES (:c, :o, :d, :q, :inv, :u, 'Against weekly sales plan')", {
          c: o.client_id, o: o.id, d: sentOn, q: sent, inv: `SEI/26-27/${3000 + i}`, u: owner,
        });
      }
      const left = o.pending - sent;
      if (left > 0) {
        ins('INSERT INTO sales_plans (week_start, client_id, order_id, part_name, part_no, planned_qty, rate, dispatch_on, owner_id) VALUES (:w, :c, :o, :p, :pn, :q, :rate, :d, :u)', {
          w: ws, c: o.client_id, o: o.id, p: o.part_name, pn: o.part_no, q: Math.min(left, lot), rate: o.unit_price, d: dayIn(ws, pick(['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])), u: owner,
        });
      }
      if (left - lot > 0 && i % 2 === 0) {
        ins('INSERT INTO sales_plans (week_start, client_id, order_id, part_name, part_no, planned_qty, rate, owner_id) VALUES (:w, :c, :o, :p, :pn, :q, :rate, :u)', {
          w: nw, c: o.client_id, o: o.id, p: o.part_name, pn: o.part_no, q: Math.min(left - lot, lot), rate: o.unit_price, u: owner,
        });
      }
    });

    // Production plan: last week (with actuals) and this week, day and shift-wise per machine.
    const routes = [
      ['PP-01', 'Blanking / shearing'], ['PP-02', 'Piercing'], ['PP-03', 'Forming / bending'], ['HP-01', 'Drawing'],
      ['MW-01', 'Welding (MIG)'], ['MW-02', 'Welding (MIG)'], ['SW-01', 'Spot / projection welding'], ['PC-01', 'Painting / powder coating'],
    ];
    const parts = db.all('SELECT DISTINCT client_id, part_name, part_no FROM sales_plans WHERE week_start IN (:lw, :ws) ORDER BY part_name', { lw, ws });
    // Keep production off machines on their PM day, except one, so the planner has a clash to show.
    const pmDays = new Set(db.all("SELECT asset_id, planned_on FROM pm_tasks WHERE status IN ('Planned', 'Postponed')").map((x) => `${x.asset_id}|${x.planned_on}`));
    let clashKept = false;
    for (const w of [lw, ws]) {
      for (let d = 0; d < 6; d++) {
        const date = F.addDays(w, d);
        const used = new Set();
        for (let k = 0; k < 4; k++) {
          let n = d * 3 + k;
          for (let tries = 0; tries < routes.length; tries++, n++) {
            const c = routes[n % routes.length][0];
            if (used.has(c)) continue;
            if (!pmDays.has(`${assets[c]}|${date}`)) break;
            if (!clashKept && c === 'PP-01') { clashKept = true; break; }
          }
          const [code, op] = routes[n % routes.length];
          used.add(code);
          const p = parts[(d + k) % Math.max(parts.length, 1)] || { part_name: 'Pedal bracket', part_no: null, client_id: null };
          const planned = int(8, 30) * 100;
          const past = date < t;
          const short = past && r() < 0.2;
          const made = past ? (short ? Math.round((planned * (0.55 + r() * 0.3)) / 10) * 10 : planned + int(0, 4) * 10) : null;
          ins(`INSERT INTO production_plans (plan_date, week_start, shift, asset_id, operation, client_id, part_name, part_no, planned_qty, produced_qty, rejected_qty, status, shortfall_reason, supervisor_id)
               VALUES (:d, :w, :sh, :a, :op, :c, :p, :pn, :q, :made, :rej, :st, :why, :u)`, {
            d: date, w, sh: k < 3 ? 'A (day)' : 'B (evening)', a: assets[code], op, c: p.client_id, p: p.part_name, pn: p.part_no, q: planned,
            made, rej: past ? int(0, Math.max(1, Math.round(planned * 0.015))) : null, st: past ? (short ? 'Short' : 'Done') : date === t ? 'In progress' : 'Planned',
            why: short ? pick(['Material shortage', 'Tool / die problem', 'Manpower shortage', 'Power cut']) : null, u: vijay,
          });
        }
      }
    }
    // Blanking planned on the broken shear, so the planner shows the clash.
    ins(`INSERT INTO production_plans (plan_date, week_start, shift, asset_id, operation, part_name, planned_qty, status, supervisor_id, notes)
         VALUES (:d, :w, 'A (day)', :a, 'Blanking / shearing', 'Reinforcement plate', 1500, 'Planned', :u, 'Sheet cutting for next week')`, {
      d: dayIn(ws, 'Tuesday'), w: ws, a: assets['SH-01'], u: vijay,
    });

    // Purchase plan.
    const S = suppliers;
    const buys = [
      [lw, 'Monday', 'CRCA sheet', '1.6 mm × 1250 × 2500', 'Raw material', 'Reinforcement plate', 2500, 'kg', 68, 'Aravali Steel Traders', 'Received'],
      [lw, 'Tuesday', 'HR sheet', '3.0 mm × 1250 × 2500', 'Raw material', 'Brake pedal assy', 4000, 'kg', 62, 'Aravali Steel Traders', 'Received'],
      [lw, 'Wednesday', 'MIG wire ER70S-6', '1.2 mm, 15 kg spool', 'Consumables', 'Weld shop', 450, 'kg', 115, 'Prime Welding Gases', 'Received'],
      [lw, 'Friday', 'M8 hex bolts', 'M8 × 25, grade 8.8, zinc plated', 'Bought-out parts', 'Gear shift lever assy', 5000, 'nos', 2.4, 'Kiran Fasteners', 'PO placed'],
      [ws, 'Monday', 'CO2 gas cylinders', '30 kg', 'Consumables', 'Weld shop', 20, 'cylinder', 950, 'Prime Welding Gases', 'Received'],
      [ws, 'Tuesday', 'EN8 bright bar', 'Ø12 mm', 'Raw material', 'Release button pin', 600, 'kg', 78, 'Aravali Steel Traders', 'PO placed'],
      [ws, 'Wednesday', 'Shear blade set', 'For SH-01, 3 m', 'Tooling', 'SH-01 breakdown', 1, 'set', 38000, 'Om Tool Room', 'PO placed'],
      [ws, 'Wednesday', 'Hydraulic oil', 'ISO VG 68', 'Machine spares (PM)', 'HP-01 PM', 210, 'litre', 165, 'Delta Hydraulics & Spares', 'Indent raised'],
      [ws, 'Thursday', 'Die springs', '25 × 50 mm heavy duty', 'Machine spares (PM)', 'DIE-PBR-01 PM', 40, 'nos', 180, 'Delta Hydraulics & Spares', 'Planned'],
      [ws, 'Friday', 'Powder coat', 'Black RAL 9005, matt', 'Consumables', 'Paint shop', 200, 'kg', 310, 'Bright Powder Coats', 'Planned'],
      [ws, 'Saturday', 'Corrugated boxes', '5-ply, 400 × 300 × 250', 'Packaging', 'Dispatch', 800, 'nos', 42, null, 'Planned'],
      [nw, 'Monday', 'CRCA sheet', '2.0 mm × 1250 × 2500', 'Raw material', 'Parking brake lever assy', 3000, 'kg', 69, 'Aravali Steel Traders', 'Planned'],
      [nw, 'Wednesday', 'Clutch lining set', 'For PP-02', 'Machine spares (PM)', 'PP-02', 1, 'set', 14500, 'Delta Hydraulics & Spares', 'Planned'],
      [nw, 'Thursday', 'Zinc plating (job work)', 'Release button pin', 'Job work', 'Release button pin', 20000, 'nos', 0.9, 'Shiv Zinc Platers', 'Planned'],
    ];
    for (const [w, day, item, spec, cat, purpose, qty, unit, rate, sup, status] of buys) {
      const need = dayIn(w, day);
      const ordered = ['PO placed', 'Received'].includes(status);
      ins(`INSERT INTO purchase_plans (required_by, week_start, category, item, spec, purpose, supplier_id, qty, unit, rate, status, po_no, po_date, received_qty, received_on, owner_id)
           VALUES (:need, :w, :cat, :item, :spec, :purpose, :sup, :qty, :unit, :rate, :st, :po, :pod, :rq, :ron, :u)`, {
        need, w, cat, item, spec, purpose, sup: sup ? S[sup] : null, qty, unit, rate, st: status,
        po: ordered ? `SEI/PO/${int(700, 899)}` : null, pod: ordered ? F.addDays(need, -int(4, 9)) : null,
        rq: status === 'Received' ? qty : null, ron: status === 'Received' ? (need < t ? need : t) : null, u: neeraj,
      });
    }

    // Payment plan.
    const pays = [
      [lw, 'Tuesday', 'Supplier bill', 'Aravali Steel Traders', null, 'AST/2611', 412000, 'Normal', 'NEFT / RTGS', 'Paid'],
      [lw, 'Wednesday', 'Salary & wages', null, 'Contract labour – weekly wages', null, 178500, 'Must pay', 'NEFT / RTGS', 'Paid'],
      [lw, 'Thursday', 'Transport & freight', 'Haryana Roadlines', null, 'HRL/884', 23400, 'Normal', 'UPI', 'Paid'],
      [lw, 'Friday', 'Supplier bill', 'Kiran Fasteners', null, 'KF/1290', 48200, 'Normal', 'NEFT / RTGS', 'Approved'],
      [lw, 'Saturday', 'Job work', 'Shiv Zinc Platers', null, 'SZP/301', 31500, 'Can defer', 'NEFT / RTGS', 'Deferred'],
      [ws, 'Tuesday', 'Machine repair', 'Om Tool Room', null, 'Advance – shear blades', 19000, 'Must pay', 'NEFT / RTGS', 'Approved'],
      [ws, 'Tuesday', 'Supplier bill', 'Aravali Steel Traders', null, 'AST/2648', 485000, 'Normal', 'NEFT / RTGS', 'Planned'],
      [ws, 'Wednesday', 'Supplier bill', 'Prime Welding Gases', null, 'PWG/552', 62000, 'Normal', 'NEFT / RTGS', 'Planned'],
      [ws, 'Thursday', 'Electricity & utilities', null, 'Electricity bill – factory', 'Nov bill', 235000, 'Must pay', 'NEFT / RTGS', 'Planned'],
      [ws, 'Friday', 'Supplier bill', 'Delta Hydraulics & Spares', null, 'DHS/219', 38500, 'Can defer', 'Cheque', 'Planned'],
      [ws, 'Saturday', 'Salary & wages', null, 'Contract labour – weekly wages', null, 182000, 'Must pay', 'NEFT / RTGS', 'Planned'],
      [nw, 'Monday', 'Rent', null, 'Factory rent – December', null, 120000, 'Must pay', 'NEFT / RTGS', 'Planned'],
      [nw, 'Monday', 'Statutory – TDS', null, 'TDS for November (due 7 Dec)', null, 42000, 'Must pay', 'NEFT / RTGS', 'Planned'],
      [nw, 'Thursday', 'Supplier bill', 'Bright Powder Coats', null, 'BPC/77', 58900, 'Normal', 'NEFT / RTGS', 'Planned'],
    ];
    for (const [w, day, cat, sup, payee, bill, amount, prio, mode, status] of pays) {
      const d = dayIn(w, day);
      const paid = status === 'Paid';
      ins(`INSERT INTO payment_plans (plan_date, week_start, category, supplier_id, payee, bill_no, bill_date, due_on, amount, priority, mode, status, approved_by, paid_on, paid_amount, reference)
           VALUES (:d, :w, :cat, :sup, :payee, :bill, :bd, :due, :amt, :prio, :mode, :st, :appr, :pon, :pamt, :ref)`, {
        d, w, cat, sup: sup ? S[sup] : null, payee: payee || sup, bill, bd: bill && sup ? F.addDays(d, -int(25, 40)) : null, due: F.addDays(d, int(0, 3)),
        amt: amount, prio, mode, st: status, appr: ['Approved', 'Paid'].includes(status) ? admin : null,
        pon: paid ? d : null, pamt: paid ? amount : null, ref: paid ? (mode === 'UPI' ? `UPI${int(100000, 999999)}` : `UTR${int(100000, 999999)}`) : null,
      });
    }

    // Petty cash (Cash / UPI).
    const petty = [
      [lw, 'Monday', 'Cash top-up', null, 'Cash drawn for petty cash box', 'Accounts', 'Cash', 15000, 'Paid'],
      [lw, 'Monday', 'Expense', 'Tea & refreshments', 'Tea and snacks – week', 'Canteen', 'Cash', 1200, 'Paid'],
      [lw, 'Tuesday', 'Expense', 'Courier & postage', 'PPAP documents to customer', 'Courier', 'UPI', 450, 'Paid'],
      [lw, 'Wednesday', 'Expense', 'Conveyance & travel', 'Auto fare for sample delivery', 'Driver', 'Cash', 380, 'Paid'],
      [lw, 'Thursday', 'Expense', 'Small repairs', 'Welding cable lugs and tape', 'Local hardware shop', 'UPI', 1650, 'Paid'],
      [lw, 'Friday', 'Expense', 'Stationery & printing', 'Job cards and labels printing', 'Print shop', 'Cash', 900, 'Paid'],
      [lw, 'Saturday', 'Expense', 'Loading & labour', 'Unloading of steel coils', 'Loaders', 'Cash', 2400, 'Paid'],
      [ws, 'Monday', 'Expense', 'Tea & refreshments', 'Tea and snacks – week', 'Canteen', 'Cash', 1200, 'Paid'],
      [ws, 'Tuesday', 'Expense', 'Courier & postage', 'Samples to customer quality', 'Courier', 'UPI', 600, 'Planned'],
      [ws, 'Wednesday', 'Expense', 'Small consumables', 'Cotton waste and grease for PM', 'Local hardware shop', 'Cash', 850, 'Planned'],
      [ws, 'Thursday', 'Cash top-up', null, 'Cash drawn for petty cash box', 'Accounts', 'Cash', 10000, 'Planned'],
      [ws, 'Thursday', 'Expense', 'Conveyance & travel', 'Visit to Om Tool Room for shear blades', 'Self', 'UPI', 700, 'Planned'],
      [ws, 'Saturday', 'Expense', 'Loading & labour', 'Loading of dispatch trucks', 'Loaders', 'Cash', 2000, 'Planned'],
      [ws, 'Saturday', 'Expense', 'Staff welfare', 'Sweets for safety award', 'Sweet shop', 'UPI', 1500, 'Planned'],
    ];
    let voucher = 401;
    for (const [w, day, type, head, desc, to, mode, amt, status] of petty) {
      const d = dayIn(w, day);
      const paid = status === 'Paid' && d <= t;
      ins(`INSERT INTO petty_cash (plan_date, week_start, entry_type, head, description, paid_to, mode, planned_amount, amount, status, voucher_no, upi_ref, approved_by, user_id)
           VALUES (:d, :w, :type, :head, :desc, :to, :mode, :pamt, :amt, :st, :v, :upi, :appr, :u)`, {
        d, w, type, head, desc, to, mode, pamt: amt, amt: paid ? amt + (type === 'Expense' && r() < 0.3 ? int(-50, 80) : 0) : null, st: paid ? 'Paid' : 'Planned',
        v: paid && mode === 'Cash' ? `PC-${voucher++}` : null, upi: paid && mode === 'UPI' ? `${int(400000000000, 499999999999)}` : null, appr: rakesh, u: rakesh,
      });
    }

    db.run("INSERT INTO meta (key, value) VALUES ('demo_planning_seeded', :v)", { v: t });
  });
  console.log('Demo planning data added: machines and tools, PM, sales, production, purchase, payment and petty cash plans.');
}

// ---------- departments, heads and jobs (demo only) ----------

function seedJobsDemo(db) {
  if (db.get("SELECT value FROM meta WHERE key = 'demo_jobs_seeded'")) return;
  const t = F.today();
  const day = (n) => F.addDays(t, n);
  const hash = hashPassword(process.env.DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD);
  const user = (email) => (db.get('SELECT id FROM users WHERE email = :e', { e: email }) || {}).id || null;
  db.tx(() => {
    // Two more people to give jobs to: a fitter (view-only role) and an accounts assistant.
    for (const [name, email, role] of [['Ramesh Chauhan', 'ramesh@demo.local', 'viewer'], ['Kavita Sharma', 'kavita@demo.local', 'accounts']]) {
      if (!user(email)) db.run('INSERT INTO users (name, username, email, role, password_hash, must_change_password) VALUES (:name, :username, :email, :role, :hash, 0)', { name, username: email.split('@')[0], email, role, hash });
    }
    const depts = [
      ['admin@demo.local', 'Management', 0], ['viewer@demo.local', 'Management', 0],
      ['anil@demo.local', 'Sales', 1], ['pooja@demo.local', 'Sales', 0],
      ['rakesh@demo.local', 'Accounts', 1], ['kavita@demo.local', 'Accounts', 0],
      ['sunil@demo.local', 'Quality', 1],
      ['vijay@demo.local', 'Production', 1], ['ramesh@demo.local', 'Production', 0],
      ['neeraj@demo.local', 'Purchase & stores', 1],
    ];
    for (const [email, dept, head] of depts) db.run('UPDATE users SET department = :d, is_head = :h WHERE email = :e', { d: dept, h: head, e: email });

    const client = (name) => (db.get('SELECT id FROM clients WHERE name = :n', { n: name }) || {}).id || null;
    const admin = user('admin@demo.local');
    // [title, details, department, to, by, priority, due (days from today), status, client, updates [[by, days ago, status, note]]]
    const jobs = [
      ['Replace clutch lining on PP-02', 'Lining set arrives Wednesday. Fit it, set the brake angle and run 50 trial strokes before handing back.', 'Production', 'ramesh', 'vijay', 'High', 2, 'In progress', null,
        [['ramesh', 0, 'In progress', 'Old lining removed. Waiting on the new set from Delta Hydraulics.']]],
      ['Clean the coolant tank of CL-01', 'Drain, clean the sump and refill at 6% concentration.', 'Production', 'ramesh', 'vijay', 'Normal', 0, 'To do', null, []],
      ['Fix the air leak at the FRL unit near PP-01', '', 'Production', 'ramesh', 'vijay', 'Normal', -2, 'Done', null,
        [['ramesh', 2, 'Done', 'Replaced the O-ring and tightened the coupling. No leak on soap test.']]],
      ['Plan Saturday PM shutdown for the presses', 'PP-01, PP-02 and PP-03 together, second shift. Tell Sales which dispatches move.', 'Production', 'vijay', 'admin', 'Normal', 4, 'To do', null, []],
      ['Send the revised quote for the parking brake lever', 'Steel went up 6%. Use the new rate sheet and copy Anil.', 'Sales', 'pooja', 'anil', 'High', 1, 'To do', 'Maruti Suzuki', []],
      ['Get the PO amendment for the new rate', '', 'Sales', 'pooja', 'anil', 'Normal', -2, 'Waiting', 'Escorts',
        [['pooja', 1, 'Waiting', 'Buyer is on leave till Thursday. Followed up by email.']]],
      ['Reconcile TDS deductions for October', 'Match Form 26AS with the debit notes booked.', 'Accounts', 'kavita', 'rakesh', 'Normal', 3, 'In progress', null,
        [['kavita', 0, 'In progress', 'Done for 9 of 14 clients.']]],
      ['Chase the overdue payment', 'Three invoices are more than 10 days late.', 'Accounts', 'kavita', 'rakesh', 'Urgent', 0, 'To do', 'NIFCO', []],
      ['Submit the 8D report for the line rejection', 'Containment is done; root cause and actions are in the complaint.', 'Quality', 'sunil', 'admin', 'High', 1, 'In progress', 'Maruti Suzuki',
        [['sunil', 0, 'In progress', 'D1–D5 written. Waiting for the fixture photos from the tool room.']]],
      ['Get three quotes for the shear blade set', '', 'Purchase & stores', 'neeraj', 'admin', 'High', -1, 'Done', null,
        [['neeraj', 1, 'Done', 'Om Tool Room is cheapest at ₹38,000 with 4 days delivery. PO placed.']]],
    ];
    for (const [title, details, dept, to, by, priority, due, status, cl, updates] of jobs) {
      const toId = user(`${to}@demo.local`);
      const byId = by === 'admin' ? admin : user(`${by}@demo.local`);
      const created = `${day(-3)} 09:30:00`;
      const id = db.run(`INSERT INTO jobs (title, details, department, assigned_to, assigned_by, client_id, priority, due_on, status, done_on, created_at, updated_at)
                         VALUES (:title, :details, :dept, :to, :by, :client, :priority, :due, :status, :done, :at, :at)`, {
        title, details: details || null, dept, to: toId, by: byId, client: cl ? client(cl) : null, priority, due: day(due), status,
        done: status === 'Done' ? day(due) : null, at: created,
      }).id;
      const toName = db.get('SELECT name FROM users WHERE id = :id', { id: toId }).name;
      db.run('INSERT INTO job_updates (job_id, user_id, status, note, at) VALUES (:j, :u, :s, :n, :at)', { j: id, u: byId, s: 'To do', n: `Gave this job to ${toName}, due ${F.fmtDate(day(due))}.`, at: created });
      for (const [who, ago, st, note] of updates) {
        db.run('INSERT INTO job_updates (job_id, user_id, status, note, at) VALUES (:j, :u, :s, :n, :at)', { j: id, u: user(`${who}@demo.local`), s: st, n: note, at: `${day(-ago)} 15:10:00` });
      }
    }
    db.run("INSERT INTO meta (key, value) VALUES ('demo_jobs_seeded', :v)", { v: t });
  });
}

// ---------- company checklist: three weeks of checklists, sign-offs and compliance (demo only) ----------

function seedChecklistDemo(db) {
  if (db.get("SELECT value FROM meta WHERE key = 'demo_checklists_seeded'")) return;
  const CL = require('./checklists');
  const t = F.today();
  const day = (n) => F.addDays(t, n);
  const r = rng(20261123);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const pad = (n) => String(n).padStart(2, '0');
  const user = (name) => (db.get('SELECT id FROM users WHERE email = :e', { e: `${name}@demo.local` }) || {}).id || null;
  const admin = user('admin');
  const HEADS = { Production: 'vijay', Quality: 'sunil', Accounts: 'rakesh', 'Purchase & stores': 'neeraj', Sales: 'anil' };
  const reviewerFor = (dept, by) => { const h = HEADS[dept] && user(HEADS[dept]); return h && h !== by ? h : admin; };
  const WHO = {
    'Press start-up check': 'ramesh', 'Welding cell start-up check': 'ramesh', 'Safety round': 'sunil', 'First-piece and gauge check': 'sunil',
    'Stores closing': 'neeraj', 'Dispatch closing': 'pooja', 'Compressor and utilities check': 'ramesh', 'Weekly accounts close': 'kavita',
    'Weekly maintenance review': 'vijay', 'Fire extinguisher inspection': 'sunil', 'Gauge calibration review': 'sunil',
  }; // the 5S round is left to anyone in Production
  const NOTES = ['Told the supervisor; fixed before the shift started', 'Maintenance called; fixed by 11 am', 'Reported to the head; a job is given to fix it', 'Corrected on the spot'];
  const reading = (a, bad) => {
    if (a.min != null && a.max != null) {
      return Math.round((bad ? a.min - (a.max - a.min) * 0.1 : a.min + (a.max - a.min) * (0.3 + r() * 0.4)) * 10) / 10;
    }
    if (a.unit === '₹') return 3000 + Math.round(r() * 30) * 50;
    if (a.unit === 'hours') return Math.round(r() * 60) / 10;
    return Math.round(r() * 100);
  };
  // Answer every item (one of them wrong when `bad`) and record who submitted it and how it was signed off.
  const fill = (runId, { bad, by, at, status, reviewer = null, reviewedAt = null, reviewNote = null }) => {
    const answers = db.all('SELECT * FROM checklist_answers WHERE run_id = :id ORDER BY position', { id: runId });
    const badPos = bad ? answers[Math.floor(r() * answers.length)].position : 0;
    let issues = 0;
    for (const a of answers) {
      const wrong = a.position === badPos;
      const value = a.kind === 'reading' ? String(reading(a, wrong)) : wrong ? 'not_ok' : 'ok';
      const { ok } = CL.judge(a, value);
      if (ok === 0) issues += 1;
      db.run('UPDATE checklist_answers SET value = :v, ok = :ok, note = :n WHERE id = :id', { v: value, ok, n: ok === 0 ? pick(NOTES) : null, id: a.id });
    }
    db.run(`UPDATE checklist_runs SET status = :s, issues = :i, submitted_by = :by, submitted_at = :at, reviewed_by = :rv, reviewed_at = :ra,
            review_note = :rn, updated_at = :at WHERE id = :id`, { s: status, i: issues, by, at, rv: reviewer, ra: reviewedAt, rn: reviewNote, id: runId });
  };

  db.tx(() => {
    const lists = [];
    for (const s of CL.STANDARD_CHECKLISTS) {
      if (db.get('SELECT id FROM checklists WHERE title = :t', { t: s.title })) continue;
      const id = db.run(`INSERT INTO checklists (title, department, frequency, weekday, month_day, assignee_id, needs_approval, items_text, created_at, updated_at)
                         VALUES (:t, :d, :f, :w, :m, :a, :na, :items, :at, :at)`, {
        t: s.title, d: s.department, f: s.frequency, w: s.weekday || null, m: s.month_day || null, a: WHO[s.title] ? user(WHO[s.title]) : null,
        na: s.needs_approval, items: s.items.join('\n'), at: `${day(-30)} 04:00:00`,
      }).id;
      lists.push(db.get('SELECT * FROM checklists WHERE id = :id', { id }));
    }

    // The last three weeks: most filled in on the day, a few late, a few missed, some with problems.
    for (let k = 21; k >= 1; k -= 1) {
      const d = day(-k);
      for (const c of lists) {
        if (!CL.isDue(c, d)) continue;
        const id = CL.createRun(db, c, d);
        const roll = r();
        if (!id || roll < 0.07) continue; // missed: nobody filled it in
        const by = user(WHO[c.title] || 'ramesh');
        const at = `${roll < 0.13 ? F.addDays(d, 1) : d} ${pad(4 + Math.floor(r() * 8))}:${pad(Math.floor(r() * 60))}:00`;
        const bad = r() < 0.15;
        if (!c.needs_approval) { fill(id, { bad, by, at, status: 'Done' }); continue; }
        if (k <= 2) { fill(id, { bad: bad || c.title === 'Safety round', by, at, status: 'Submitted' }); continue; }
        const reviewedAt = `${F.addDays(at.slice(0, 10), 1)} 06:15:00`;
        if (k === 3 && c.title === 'Shop floor 5S round') {
          fill(id, { bad: true, by, at, status: 'Returned', reviewer: reviewerFor(c.department, by), reviewedAt, reviewNote: 'Scrap bin area not checked. Do the round again and add a photo of the bins.' });
        } else {
          fill(id, { bad, by, at, status: 'Approved', reviewer: reviewerFor(c.department, by), reviewedAt });
        }
      }
    }
    // Today: the press start-up check is already done; the rest are waiting to be filled in.
    for (const c of lists) {
      if (!CL.isDue(c, t)) continue;
      const id = CL.createRun(db, c, t);
      if (id && c.title === 'Press start-up check') fill(id, { bad: false, by: user('ramesh'), at: `${t} 03:40:00`, status: 'Done' });
    }
    db.run("INSERT INTO meta (key, value) VALUES ('checklists_through', :t) ON CONFLICT(key) DO UPDATE SET value = excluded.value", { t });

    // Compliance: the standard statutory dates with last period's filing, plus the plant's own renewals.
    const kavita = user('kavita');
    const BACK = { Monthly: 1, Quarterly: 3, 'Half-yearly': 6, Yearly: 12 };
    const PAID = { 'TDS / TCS – deposit tax deducted last month': 48350, 'PF – ECR filing and payment': 112400, 'ESI – contribution payment': 18760, 'GSTR-3B – return and GST payment': 384210, 'Advance tax instalment': 250000 };
    const addItem = (title, category, frequency, due, owner, dept, authority, remind, notes) => db.run(`INSERT INTO compliance_items (title, category, frequency, due_on, remind_days, owner_id, department, authority, notes)
      VALUES (:t, :c, :f, :d, :rd, :o, :dept, :a, :n)`, { t: title, c: category, f: frequency, d: due, rd: remind, o: owner, dept, a: authority, n: notes || null }).id;
    for (const [title, category, frequency, rule, authority] of CL.STANDARD_COMPLIANCE) {
      if (db.get('SELECT id FROM compliance_items WHERE title = :t', { t: title })) continue;
      const due = CL.firstDue(rule);
      const id = addItem(title, category, frequency, due, kavita, 'Accounts', authority, 7, 'Standard due date. Check for extensions announced by the authority.');
      const prev = CL.addMonths(due, -BACK[frequency]);
      if (prev >= t) continue;
      const late = title.startsWith('GSTR-1');
      db.run(`INSERT INTO compliance_filings (item_id, period_due_on, done_on, done_by, reference, amount, at)
              VALUES (:i, :p, :d, :u, :ref, :amt, :at)`, {
        i: id, p: prev, d: F.addDays(prev, late ? 1 : -2), u: kavita, ref: `ACK ${Math.floor(1e8 + r() * 9e8)}`, amt: PAID[title] ?? null, at: `${F.addDays(prev, late ? 1 : -2)} 10:20:00`,
      });
    }
    const rakesh = user('rakesh');
    const sunil = user('sunil');
    for (const it of [
      ['Factory licence renewal', 'Licence & registration', 'Yearly', day(-3), rakesh, 'Management', 'Labour department (Factories Act)', 30],
      ['Fire NOC renewal', 'Fire & safety', 'Yearly', day(20), sunil, 'HR & admin', 'Fire department', 30],
      ['Consent to operate – air and water', 'Pollution control', 'Yearly', day(75), rakesh, 'Management', 'State pollution control board', 45],
      ['Fire and burglary insurance policy', 'Insurance', 'Yearly', day(40), kavita, 'Accounts', 'Insurer', 30],
      ['Weighing scales – legal metrology stamping', 'Calibration', 'Yearly', day(12), sunil, 'Quality', 'Legal Metrology department', 15],
      ['Air receiver hydraulic test', 'Fire & safety', 'Half-yearly', day(5), user('vijay'), 'Maintenance', 'Competent person (Factories Act)', 10],
      ['Contract labour register check', 'Labour laws', 'Monthly', day(8), rakesh, 'HR & admin', 'Labour department', 7],
    ]) {
      if (!db.get('SELECT id FROM compliance_items WHERE title = :t', { t: it[0] })) addItem(...it);
    }

    // Jobs: the shear blade quotes are signed off; the air leak fix still waits for Vijay.
    const job = db.get("SELECT id FROM jobs WHERE title = 'Get three quotes for the shear blade set' AND status = 'Done'");
    if (job) {
      db.run('UPDATE jobs SET approved_by = :a, approved_at = :at WHERE id = :id', { a: admin, at: `${day(0)} 04:30:00`, id: job.id });
      db.run('INSERT INTO job_updates (job_id, user_id, note, at) VALUES (:j, :u, :n, :at)', { j: job.id, u: admin, n: 'Signed off. Good comparison.', at: `${day(0)} 04:30:00` });
    }
    db.run("INSERT INTO meta (key, value) VALUES ('demo_checklists_seeded', :v)", { v: t });
  });
}

module.exports = { seedDemo, seedPlanningDemo, seedJobsDemo, seedChecklistDemo, DEFAULT_DEMO_PASSWORD };
