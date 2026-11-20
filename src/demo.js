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
    ].map(([name, email, role]) => ins('INSERT INTO users (name, email, role, password_hash, must_change_password) VALUES (:name, :email, :role, :hash, 0)', { name, email, role, hash }));
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

module.exports = { seedDemo, DEFAULT_DEMO_PASSWORD };
