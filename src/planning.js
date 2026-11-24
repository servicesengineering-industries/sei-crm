'use strict';
// Weekly planning: filling a week's preventive maintenance from each machine's frequency,
// gathering everything planned for one week, and the week's Excel workbook.
const F = require('./format');
const X = require('./xlsx');
const { MODULES, PM_OPEN, PURCHASE_OPEN, PAY_OPEN } = require('./modules');
const { PM_DAYS } = require('./db');

const weekRows = (db, key, ws, order) => db.all(`SELECT * FROM (${MODULES[key].listSql}) x WHERE week_start = :ws ORDER BY ${order || MODULES[key].order}`, { ws });

// Plan PM for every machine and tool that falls due by the end of week `ws`, on its PM day.
// The next due date counts from the last PM done, or from a PM still planned in an earlier week
// (so next week can be planned before this week's PM is done). A machine is skipped when it
// already has a task that week, or a task whose day has passed without being done: that one is
// shown as overdue instead of planning a second. Returns the tasks added.
function planPmWeek(db, ws, { userId = null, audit } = {}) {
  const we = F.addDays(ws, 6);
  const t = F.today();
  const assets = db.all("SELECT * FROM v_assets WHERE status <> 'Scrapped' AND pm_frequency IS NOT NULL ORDER BY code");
  const added = [];
  db.tx(() => {
    for (const a of assets) {
      const p = { a: a.id, ws, t };
      if (db.get("SELECT id FROM pm_tasks WHERE asset_id = :a AND status <> 'Cancelled' AND week_start = :ws", p)) continue;
      if (db.get("SELECT id FROM pm_tasks WHERE asset_id = :a AND status IN ('Planned', 'Postponed') AND planned_on < :ws AND planned_on < :t", p)) continue;
      const open = db.get("SELECT MAX(planned_on) AS d FROM pm_tasks WHERE asset_id = :a AND status IN ('Planned', 'Postponed') AND planned_on < :ws", p).d;
      const base = [a.last_done_on, open].filter(Boolean).sort().pop();
      const due = base ? F.addDays(base, PM_DAYS[a.pm_frequency]) : ws; // never maintained: due now
      if (due > we) continue;
      const planned = a.pm_day ? F.addDays(ws, F.DAYS.indexOf(a.pm_day)) : (due < ws ? ws : due);
      const id = db.run(`INSERT INTO pm_tasks (asset_id, planned_on, week_start, checklist, assigned_to, status, user_id)
                         VALUES (:a, :p, :ws, :cl, :u, 'Planned', :by)`, {
        a: a.id, p: planned, ws, cl: a.pm_checklist, u: a.responsible_id, by: userId,
      }).id;
      if (audit) audit({ entity: 'pm_tasks', entityId: id, action: 'created', summary: `planned PM for ${a.code} – ${a.name} on ${F.fmtDate(planned)}` });
      added.push({ id, asset: a, planned });
    }
  });
  return added;
}

function loadWeek(db, ws) {
  const we = F.addDays(ws, 6);
  const t = F.today();
  const p = { ws, we, t };
  const sales = weekRows(db, 'sales_plans', ws, 'client_name, part_name');
  const production = weekRows(db, 'production_plans', ws, 'plan_date, shift, asset_code');
  const pm = weekRows(db, 'pm_tasks', ws, 'planned_on, asset_code');
  const purchase = weekRows(db, 'purchase_plans', ws, 'required_by, item');
  const payments = weekRows(db, 'payment_plans', ws, "plan_date, CASE priority WHEN 'Must pay' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END");
  const petty = weekRows(db, 'petty_cash', ws, 'plan_date, id');
  const open = (list) => list.map((s) => `'${s}'`).join(', ');
  // Still open from earlier weeks, and already past their day (a future week doesn't count
  // this week's not-yet-due items as overdue).
  const pmCarried = db.all(`SELECT * FROM (${MODULES.pm_tasks.listSql}) x WHERE status IN (${open(PM_OPEN)}) AND planned_on < :ws AND planned_on < :t ORDER BY planned_on`, p);
  const purchaseCarried = db.all(`SELECT * FROM (${MODULES.purchase_plans.listSql}) x WHERE status IN (${open(PURCHASE_OPEN)}) AND required_by < :ws AND required_by < :t ORDER BY required_by`, p);
  const payCarried = db.all(`SELECT * FROM (${MODULES.payment_plans.listSql}) x WHERE status IN (${open(PAY_OPEN)}) AND plan_date < :ws AND plan_date < :t ORDER BY plan_date`, p);
  // Money expected in: unpaid invoices falling due this week, and what is already overdue.
  const receivables = db.all(`SELECT i.*, c.name AS client_name FROM v_invoices i JOIN clients c ON c.id = i.client_id
                              WHERE i.balance > 0.5 AND i.due_on BETWEEN :ws AND :we ORDER BY i.due_on`, p);
  // Overdue means overdue today: in a future week, invoices not yet due are not counted.
  const overdueIn = db.get('SELECT COALESCE(SUM(balance), 0) AS amt, COUNT(*) AS n FROM v_invoices WHERE balance > 0.5 AND due_on < :ws AND due_on < :t', p);
  const cashBox = db.get(`SELECT COALESCE(SUM(CASE WHEN entry_type = 'Cash top-up' THEN amount ELSE 0 END), 0)
                               - COALESCE(SUM(CASE WHEN entry_type = 'Expense' AND mode = 'Cash' THEN amount ELSE 0 END), 0) AS cash
                          FROM petty_cash WHERE status = 'Paid' AND plan_date <= :we`, p).cash;
  const breakdowns = db.all("SELECT * FROM assets WHERE status = 'Breakdown' ORDER BY code");
  const sum = (rows, k) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const exp = petty.filter((r) => r.entry_type === 'Expense' && r.status !== 'Cancelled');
  const payOpen = payments.filter((r) => PAY_OPEN.includes(r.status));
  const totals = {
    salesPlanQty: sum(sales, 'planned_qty'), salesActQty: sum(sales, 'actual_qty'),
    salesPlanVal: sum(sales, 'planned_value'), salesActVal: sum(sales, 'actual_value'),
    prodPlan: sum(production, 'planned_qty'), prodMade: sum(production, 'produced_qty'), prodRej: sum(production, 'rejected_qty'),
    prodShort: production.filter((r) => r.status === 'Short').length,
    pmPlanned: pm.filter((r) => r.status !== 'Cancelled').length, pmDone: pm.filter((r) => r.status === 'Done').length,
    pmOverdue: pm.filter((r) => PM_OPEN.includes(r.status) && r.planned_on < t).length + pmCarried.length,
    pmDowntime: sum(pm, 'downtime_min'),
    buyValue: sum(purchase.filter((r) => r.status !== 'Cancelled'), 'amount'),
    buyReceived: purchase.filter((r) => r.status === 'Received').length,
    buyLate: purchase.filter((r) => PURCHASE_OPEN.includes(r.status) && r.required_by < t).length + purchaseCarried.length,
    payPlanned: sum(payments.filter((r) => r.status !== 'Cancelled'), 'amount'), payOpen: sum(payOpen, 'amount'),
    payMust: sum(payOpen.filter((r) => r.priority === 'Must pay'), 'amount'), payPaid: sum(payments, 'paid_amount'),
    payCarried: sum(payCarried, 'amount'),
    inDue: sum(receivables, 'balance'), inOverdue: overdueIn.amt, inOverdueN: overdueIn.n,
    pettyPlanned: sum(exp, 'planned_amount'),
    pettyOpen: sum(exp.filter((r) => r.status !== 'Paid'), 'planned_amount'), // still to spend: unpaid lines only
    pettyCash: sum(exp.filter((r) => r.status === 'Paid' && r.mode === 'Cash'), 'amount'),
    pettyUpi: sum(exp.filter((r) => r.status === 'Paid' && r.mode === 'UPI'), 'amount'),
    pettyTopUp: sum(petty.filter((r) => r.entry_type === 'Cash top-up' && r.status === 'Paid'), 'amount'),
    cashBox,
  };
  // Production booked on a machine that is down or has PM planned that day.
  const conflicts = production.filter((r) => r.asset_id && (r.pm_clash || r.asset_status === 'Breakdown') && r.status !== 'Cancelled');
  return { ws, we, sales, production, pm, purchase, payments, petty, pmCarried, purchaseCarried, payCarried, receivables, breakdowns, conflicts, totals };
}

// ---------- the week's workbook ----------

function weekWorkbook(db, ws, { company = 'Services Engineering Industries' } = {}) {
  const w = loadWeek(db, ws);
  const T = w.totals;
  const sub = `${company} · week of ${F.weekLabel(ws)} · from the CRM on ${F.fmtDate(F.today())}`;
  const pct = (a, b) => (b > 0 ? a / b : null);
  const sheets = [];

  // Summary
  const S = X.ST;
  const kv = (label, value, fmt, note) => [{ v: label, st: { bold: true, border: 'all' } }, { v: value, st: { border: 'all', fmt } }, { v: note || '', st: { border: 'all', italic: true, color: 'slate' } }];
  const head = (label) => [{ v: label, st: S.head }, { v: '', st: S.head }, { v: '', st: S.head }];
  sheets.push({
    name: 'Summary', tabColor: 'red', gridlines: false,
    cols: [38, 20, 54],
    rows: [
      [{ v: 'Weekly plan', st: S.title }],
      [{ v: sub, st: S.subtitle }],
      [],
      head('Sales (dispatch) plan'),
      kv('Planned dispatch value', T.salesPlanVal, 'money', `${F.num(T.salesPlanQty)} pcs on ${w.sales.length} lines`),
      kv('Dispatched value', T.salesActVal, 'money', `${F.num(T.salesActQty)} pcs`),
      kv('Achieved', pct(T.salesActVal, T.salesPlanVal), 'pct'),
      head('Production plan'),
      kv('Planned (pcs)', T.prodPlan, 'int', `${w.production.length} lines`),
      kv('Produced OK (pcs)', T.prodMade, 'int'),
      kv('Achieved', pct(T.prodMade, T.prodPlan), 'pct'),
      kv('Rejection', pct(T.prodRej, T.prodMade + T.prodRej), '0.0%', `${F.num(T.prodRej)} pcs rejected`),
      kv('Lines short', T.prodShort, 'int', w.conflicts.length ? `${w.conflicts.length} lines on a machine under PM or breakdown` : ''),
      head('Preventive maintenance'),
      kv('PM tasks planned', T.pmPlanned, 'int'),
      kv('Done', T.pmDone, 'int'),
      kv('Overdue (incl. earlier weeks)', T.pmOverdue, 'int'),
      kv('PM downtime (minutes)', T.pmDowntime, 'int'),
      head('Purchase plan'),
      kv('Planned purchase value', T.buyValue, 'money', `${w.purchase.length} lines`),
      kv('Received', T.buyReceived, 'int'),
      kv('Late (incl. earlier weeks)', T.buyLate, 'int'),
      head('Payment plan and cash'),
      kv('Payments planned', T.payPlanned, 'money', `${w.payments.length} payments`),
      kv('Still to pay', T.payOpen, 'money', `must pay ${F.money(T.payMust)}`),
      kv('Paid', T.payPaid, 'money'),
      kv('Unpaid from earlier weeks', T.payCarried, 'money'),
      kv('Client payments due this week', T.inDue, 'money', `${w.receivables.length} invoices`),
      kv('Client payments already overdue', T.inOverdue, 'money', `${T.inOverdueN} invoices`),
      head('Petty cash (Cash / UPI)'),
      kv('Planned spend', T.pettyPlanned, 'money'),
      kv('Paid in cash', T.pettyCash, 'money'),
      kv('Paid by UPI', T.pettyUpi, 'money'),
      kv('Cash topped up', T.pettyTopUp, 'money'),
      kv('Cash in the box at week end', T.cashBox, 'money'),
    ],
  });

  const t = X.table;
  sheets.push(t({
    name: 'Sales plan', title: 'Sales (dispatch) plan', subtitle: sub, tabColor: 'navy',
    columns: [
      { label: 'Client', width: 24 }, { label: 'PO / schedule', width: 14 }, { label: 'Part', width: 26 }, { label: 'Part no', width: 13 },
      { label: 'Planned qty', fmt: 'int', total: true, width: 11 }, { label: 'Rate (₹)', fmt: 'money2', width: 11 },
      { label: 'Planned value', fmt: 'money', total: true, width: 14 }, { label: 'Dispatched qty', fmt: 'int', total: true, width: 12 },
      { label: 'Dispatched value', fmt: 'money', total: true, width: 14 }, { label: 'Balance qty', fmt: 'int', total: true, width: 11 },
      { label: 'Achieved', fmt: 'pct', width: 10 }, { label: 'Dispatch day', fmt: 'day', width: 12 }, { label: 'Handled by', width: 16 },
    ],
    rows: w.sales.map((r) => [r.client_name, r.po_no, r.part_name, r.part_no, r.planned_qty, r.rate, r.planned_value, r.actual_qty, r.actual_value, r.balance_qty, pct(r.actual_qty, r.planned_qty), r.dispatch_on, r.owner_name]),
    cf: [{ sqref: `K5:K${4 + Math.max(w.sales.length, 1)}`, formula: (r) => `AND(K${r}<>"",K${r}<0.8)`, tone: 'bad' }],
  }));

  sheets.push(t({
    name: 'Production plan', title: 'Production plan', subtitle: sub, tabColor: 'navy',
    columns: [
      { label: 'Date', fmt: 'day', width: 12 }, { label: 'Shift', width: 11 }, { label: 'Machine', width: 10 }, { label: 'Machine name', width: 22 },
      { label: 'Operation', width: 18 }, { label: 'Client', width: 18 }, { label: 'Part', width: 24 }, { label: 'Part no', width: 12 },
      { label: 'Planned', fmt: 'int', total: true, width: 10 }, { label: 'Produced', fmt: 'int', total: true, width: 10 }, { label: 'Rejected', fmt: 'int', total: true, width: 10 },
      { label: 'Achieved', fmt: 'pct', width: 10 }, { label: 'Status', width: 11 }, { label: 'Reason if short', width: 18 }, { label: 'Warning', width: 20 }, { label: 'Supervisor', width: 15 },
    ],
    rows: w.production.map((r) => [r.plan_date, r.shift, r.asset_code, r.asset_name, r.operation, r.client_name, r.part_name, r.part_no, r.planned_qty, r.produced_qty, r.rejected_qty,
      r.produced_qty != null ? pct(r.produced_qty, r.planned_qty) : null, r.status, r.shortfall_reason,
      [r.asset_status === 'Breakdown' ? 'Machine under breakdown' : null, r.pm_clash ? 'PM planned same day' : null].filter(Boolean).join('; '), r.supervisor_name]),
    cf: [{ sqref: `M5:M${4 + Math.max(w.production.length, 1)}`, formula: (r) => `M${r}="Short"`, tone: 'bad' }, { sqref: `O5:O${4 + Math.max(w.production.length, 1)}`, formula: (r) => `O${r}<>""`, tone: 'warn' }],
  }));

  const pmRows = [...w.pmCarried, ...w.pm];
  sheets.push(t({
    name: 'PM plan', title: 'Preventive maintenance plan', subtitle: `${sub} · open tasks from earlier weeks are listed first`, tabColor: 'navy',
    columns: [
      { label: 'Planned on', fmt: 'day', width: 12 }, { label: 'Code', width: 13 }, { label: 'Machine / tool', width: 26 }, { label: 'Type', width: 11 }, { label: 'Line / bay', width: 13 },
      { label: 'Responsible', width: 15 }, { label: 'Status', width: 11 }, { label: 'Done on', fmt: 'date', width: 12 }, { label: 'Done by', width: 15 },
      { label: 'Downtime (min)', fmt: 'int', total: true, width: 11 }, { label: 'Cost (₹)', fmt: 'money', total: true, width: 11 },
      { label: 'Checklist', width: 60, wrap: true }, { label: 'Findings', width: 30, wrap: true }, { label: 'Spares used', width: 18 },
    ],
    rows: pmRows.map((r) => [r.planned_on, r.asset_code, r.asset_name, r.asset_type, r.location, r.assigned_name, r.status, r.done_on, r.technician, r.downtime_min, r.cost, r.checklist, r.findings, r.spares_used]),
    cf: [
      { sqref: `G5:G${4 + Math.max(pmRows.length, 1)}`, formula: (r) => `G${r}="Done"`, tone: 'ok' },
      { sqref: `A5:A${4 + Math.max(pmRows.length, 1)}`, formula: (r) => `AND(OR($G${r}="Planned",$G${r}="Postponed"),A${r}<TODAY())`, tone: 'bad' },
    ],
  }));

  const assets = db.all(`SELECT * FROM (${MODULES.assets.listSql}) x WHERE status <> 'Scrapped' ORDER BY ${MODULES.assets.order}`);
  sheets.push(t({
    name: 'Machines & tools', title: 'Machines and tools: PM register', subtitle: sub, tabColor: 'navy', totals: false,
    columns: [
      { label: 'Code', width: 13 }, { label: 'Name', width: 28 }, { label: 'Type', width: 11 }, { label: 'Kind', width: 20 }, { label: 'Line / bay', width: 13 },
      { label: 'For part', width: 20 }, { label: 'PM frequency', width: 12 }, { label: 'PM day', width: 11 }, { label: 'Last PM', fmt: 'date', width: 12 },
      { label: 'Next PM due', fmt: 'date', width: 12 }, { label: 'Status', width: 11 }, { label: 'Responsible', width: 15 }, { label: 'Checklist', width: 60, wrap: true },
    ],
    rows: assets.map((a) => [a.code, a.name, a.asset_type, a.category, a.location, a.part_name, a.pm_frequency, a.pm_day, a.last_done_on, a.next_pm_on, a.status, a.responsible_name, a.pm_checklist]),
    cf: [{ sqref: `J5:J${4 + Math.max(assets.length, 1)}`, formula: (r) => `AND(J${r}<>"",J${r}<TODAY())`, tone: 'bad' }, { sqref: `K5:K${4 + Math.max(assets.length, 1)}`, formula: (r) => `K${r}="Breakdown"`, tone: 'bad' }],
  }));

  const buyRows = [...w.purchaseCarried, ...w.purchase];
  sheets.push(t({
    name: 'Purchase plan', title: 'Purchase plan', subtitle: `${sub} · late lines from earlier weeks are listed first`, tabColor: 'navy',
    columns: [
      { label: 'Needed by', fmt: 'day', width: 12 }, { label: 'Item', width: 24 }, { label: 'Spec', width: 18 }, { label: 'Category', width: 16 }, { label: 'For', width: 18 },
      { label: 'Supplier', width: 24 }, { label: 'Qty', fmt: 'dec', width: 10 }, { label: 'Unit', width: 8 }, { label: 'Rate (₹)', fmt: 'money2', width: 11 },
      { label: 'Amount (₹)', fmt: 'money', total: true, width: 13 }, { label: 'Status', width: 13 }, { label: 'PO no', width: 11 }, { label: 'Received qty', fmt: 'dec', width: 11 }, { label: 'Received on', fmt: 'date', width: 12 },
    ],
    rows: buyRows.map((r) => [r.required_by, r.item, r.spec, r.category, r.purpose, r.supplier_name, r.qty, r.unit, r.rate, r.amount, r.status, r.po_no, r.received_qty, r.received_on]),
    cf: [{ sqref: `A5:A${4 + Math.max(buyRows.length, 1)}`, formula: (r) => `AND($K${r}<>"Received",$K${r}<>"Cancelled",A${r}<TODAY())`, tone: 'bad' }, { sqref: `K5:K${4 + Math.max(buyRows.length, 1)}`, formula: (r) => `K${r}="Received"`, tone: 'ok' }],
  }));

  const payRows = [...w.payCarried, ...w.payments];
  sheets.push(t({
    name: 'Payment plan', title: 'Payment plan', subtitle: `${sub} · unpaid lines from earlier weeks are listed first`, tabColor: 'navy',
    columns: [
      { label: 'Pay on', fmt: 'day', width: 12 }, { label: 'Pay to', width: 26 }, { label: 'Category', width: 18 }, { label: 'Bill no', width: 12 }, { label: 'Bill due', fmt: 'date', width: 12 },
      { label: 'Priority', width: 11 }, { label: 'Mode', width: 12 }, { label: 'Amount (₹)', fmt: 'money', total: true, width: 13 }, { label: 'Status', width: 11 },
      { label: 'Paid on', fmt: 'date', width: 12 }, { label: 'Paid (₹)', fmt: 'money', total: true, width: 13 }, { label: 'UTR / cheque', width: 16 }, { label: 'Approved by', width: 15 },
    ],
    rows: payRows.map((r) => [r.plan_date, r.payee, r.category, r.bill_no, r.due_on, r.priority, r.mode, r.amount, r.status, r.paid_on, r.paid_amount, r.reference, r.approved_name]),
    cf: [{ sqref: `F5:F${4 + Math.max(payRows.length, 1)}`, formula: (r) => `F${r}="Must pay"`, tone: 'warn' }, { sqref: `I5:I${4 + Math.max(payRows.length, 1)}`, formula: (r) => `I${r}="Paid"`, tone: 'ok' }],
  }));

  sheets.push(t({
    name: 'Client payments due', title: 'Client payments due this week (cash in)', subtitle: sub, tabColor: 'navy',
    columns: [{ label: 'Due on', fmt: 'day', width: 12 }, { label: 'Client', width: 26 }, { label: 'Invoice', width: 18 }, { label: 'Invoice date', fmt: 'date', width: 12 }, { label: 'Invoice amount (₹)', fmt: 'money', total: true, width: 15 }, { label: 'Balance due (₹)', fmt: 'money', total: true, width: 15 }],
    rows: w.receivables.map((r) => [r.due_on, r.client_name, r.invoice_no, r.invoice_date, r.amount, r.balance]),
  }));

  sheets.push(t({
    name: 'Petty cash', title: 'Petty cash plan (Cash / UPI)', subtitle: `${sub} · cash in the box at week end ${F.money(T.cashBox)}`, tabColor: 'navy',
    columns: [
      { label: 'Date', fmt: 'day', width: 12 }, { label: 'Entry', width: 12 }, { label: 'Head', width: 18 }, { label: 'What for', width: 30 }, { label: 'Paid to', width: 18 },
      { label: 'Paid by', width: 9 }, { label: 'Planned (₹)', fmt: 'money', total: true, width: 12 }, { label: 'Paid (₹)', fmt: 'money', total: true, width: 12 },
      { label: 'Status', width: 10 }, { label: 'Voucher', width: 10 }, { label: 'UPI ref', width: 16 }, { label: 'Approved by', width: 15 },
    ],
    rows: w.petty.map((r) => [r.plan_date, r.entry_type, r.head, r.description, r.paid_to, r.mode, r.planned_amount, r.amount, r.status, r.voucher_no, r.upi_ref, r.approved_name]),
    cf: [{ sqref: `B5:B${4 + Math.max(w.petty.length, 1)}`, formula: (r) => `B${r}="Cash top-up"`, tone: 'ok' }],
  }));

  return X.build(sheets);
}

module.exports = { planPmWeek, loadWeek, weekWorkbook };
