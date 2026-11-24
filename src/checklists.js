'use strict';
// The company checklist: recurring checklists and the copy made for each day they are due,
// the compliance calendar's due dates, and the weekly scorecard.
const F = require('./format');

const FREQ = ['Daily (Mon–Sat)', 'Daily', 'Weekly', 'Monthly'];
const RUN_OPEN = ['Open', 'Returned'];
const RUN_DONE = ['Submitted', 'Approved', 'Done'];
const isAdmin = (u) => !!u && u.role === 'admin';

// ---------- items ----------

// One item per line. A line ending in [5-6 kg/cm²] is a reading with limits; [₹] or [hours] is a
// reading without limits; anything else is an OK / Not OK check. Blank lines are skipped.
const READING = /\[\s*(?:(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?))?\s*([^\]]{0,24})\]\s*$/;
function parseItems(text) {
  const items = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^(?:[-•*]|\d{1,2}[.)])\s+/, '').trim(); // drop "1." / "-" / "•" bullets
    if (!line) continue;
    const m = READING.exec(line);
    if (m && (m[1] != null || m[3].trim())) {
      items.push({ text: line.slice(0, m.index).trim() || line, kind: 'reading', min: m[1] != null ? Number(m[1]) : null, max: m[2] != null ? Number(m[2]) : null, unit: m[3].trim() || null });
    } else {
      items.push({ text: line, kind: 'check', min: null, max: null, unit: null });
    }
  }
  return items.slice(0, 80);
}

const limits = (a) => (a.min != null && a.max != null ? `${F.num(a.min)}–${F.num(a.max)}${a.unit ? ` ${a.unit}` : ''}` : a.unit || '');

// What an answer means: 1 fine, 0 a problem, null not applicable.
function judge(a, value) {
  if (a.kind === 'reading') {
    const n = Number(String(value).replace(/,/g, ''));
    if (value === '' || value == null || !Number.isFinite(n)) return { error: 'Enter the reading' };
    const ok = (a.min == null || n >= a.min) && (a.max == null || n <= a.max) ? 1 : 0;
    return { value: String(n), ok };
  }
  if (value === 'ok') return { value, ok: 1 };
  if (value === 'not_ok') return { value, ok: 0 };
  if (value === 'na') return { value, ok: null };
  return { error: 'Pick OK, Not OK or N/A' };
}

// ---------- when a checklist is due ----------

const lastDay = (iso) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();
function isDue(c, d) {
  switch (c.frequency) {
    case 'Daily': return true;
    case 'Daily (Mon–Sat)': return F.dayIndex(d) !== 6;
    case 'Weekly': return F.dayName(d) === (c.weekday || 'Monday');
    case 'Monthly': return Number(d.slice(8)) === Math.min(c.month_day || 1, lastDay(d));
    default: return false;
  }
}
function describe(c) {
  if (c.frequency === 'Weekly') return `Every ${c.weekday || 'Monday'}`;
  if (c.frequency === 'Monthly') return c.month_day >= 28 ? `Monthly, on day ${c.month_day} (or the month’s last day)` : `Monthly, on day ${c.month_day || 1}`;
  return c.frequency === 'Daily' ? 'Every day' : 'Every working day (Mon–Sat)';
}

// ---------- the daily copies ----------

function insertAnswers(db, runId, itemsText) {
  parseItems(itemsText).forEach((it, i) => {
    db.run('INSERT INTO checklist_answers (run_id, position, text, kind, unit, min, max) VALUES (:r, :p, :t, :k, :u, :mn, :mx)', {
      r: runId, p: i + 1, t: it.text, k: it.kind, u: it.unit, mn: it.min, mx: it.max,
    });
  });
}

// The copy of checklist `c` for day `d`, if it doesn't exist yet. Call inside a transaction.
function createRun(db, c, d) {
  const r = db.run(`INSERT OR IGNORE INTO checklist_runs (checklist_id, due_on, department, assignee_id)
                    VALUES (:c, :d, :dept, :a)`, { c: c.id, d, dept: c.department, a: c.assignee_id });
  if (r.changes) insertAnswers(db, r.id, c.items_text);
  return r.changes ? r.id : null;
}

// After a checklist is added or changed: today's copy follows it, as long as nobody has started it.
function refreshToday(db, c) {
  const t = F.today();
  const run = db.get('SELECT * FROM checklist_runs WHERE checklist_id = :c AND due_on = :t', { c: c.id, t });
  if (!run) {
    if (c.active && isDue(c, t)) createRun(db, c, t);
    return;
  }
  const started = db.get('SELECT COUNT(*) AS n FROM checklist_answers WHERE run_id = :r AND value IS NOT NULL', { r: run.id }).n;
  if (run.status !== 'Open' || started) return;
  if (!c.active || !isDue(c, t)) { db.run('DELETE FROM checklist_runs WHERE id = :id', { id: run.id }); return; }
  db.run('DELETE FROM checklist_answers WHERE run_id = :r', { r: run.id });
  db.run("UPDATE checklist_runs SET department = :d, assignee_id = :a, updated_at = datetime('now') WHERE id = :id", { d: c.department, a: c.assignee_id, id: run.id });
  insertAnswers(db, run.id, c.items_text);
}

// Make the copies for every day since the last time, up to today (at most 31 days back), so a
// day the app wasn't opened still counts as missed. Cheap after the first call of the day.
const madeFor = new WeakMap();
function ensureRuns(db) {
  const t = F.today();
  if (madeFor.get(db) === t) return;
  const last = (db.get("SELECT value FROM meta WHERE key = 'checklists_through'") || {}).value;
  let start = last ? F.addDays(last, 1) : t;
  if (start < F.addDays(t, -31)) start = F.addDays(t, -31);
  if (start > t) start = t;
  const lists = db.all('SELECT * FROM checklists WHERE active = 1');
  db.tx(() => {
    for (let d = start; d <= t; d = F.addDays(d, 1)) {
      for (const c of lists) if (String(c.created_at).slice(0, 10) <= d && isDue(c, d)) createRun(db, c, d);
    }
    db.run("INSERT INTO meta (key, value) VALUES ('checklists_through', :t) ON CONFLICT(key) DO UPDATE SET value = excluded.value", { t });
  });
  madeFor.set(db, t);
}

// ---------- who may do what ----------

const headOf = (u, dept) => !!u.is_head && !!u.department && u.department === dept;
const canManageChecklist = (u, c) => isAdmin(u) || (c ? headOf(u, c.department) : !!u.is_head);
// Fill: whoever it's given to, anyone in the department when it's given to nobody, the head, admins.
const canFillRun = (u, r) => isAdmin(u) || r.assignee_id === u.id || headOf(u, r.department)
  || (r.assignee_id == null && !!u.department && u.department === r.department);
// Sign off: the department head or an admin, and not on a checklist they filled themselves.
const canReviewRun = (u, r) => (isAdmin(u) || headOf(u, r.department)) && (r.submitted_by !== u.id || isAdmin(u));

// ---------- compliance dates ----------

// `day` is the intended day of the month: an item due on the 31st stays on the month's last day
// after a short month, instead of drifting to the 28th.
function addMonths(iso, n, day = Number(iso.slice(8))) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + n;
  const ty = y + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  const d = Math.min(day, new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate());
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const FREQ_MONTHS = { Monthly: 1, Quarterly: 3, 'Half-yearly': 6, Yearly: 12 };
const nextDue = (freq, from, day) => (FREQ_MONTHS[freq] ? addMonths(from, FREQ_MONTHS[freq], day || undefined) : null);

// Statutory due dates as generally notified. Extensions are announced each year: check them.
// Licences, insurance and calibration have company-specific dates, so they are added by hand.
const STANDARD_COMPLIANCE = [
  ['TDS / TCS – deposit tax deducted last month', 'TDS / TCS', 'Monthly', { day: 7 }, 'Income Tax Department (challan 281)'],
  ['GSTR-1 – outward supplies', 'GST', 'Monthly', { day: 11 }, 'GST portal'],
  ['PF – ECR filing and payment', 'PF / ESI', 'Monthly', { day: 15 }, 'EPFO portal'],
  ['ESI – contribution payment', 'PF / ESI', 'Monthly', { day: 15 }, 'ESIC portal'],
  ['GSTR-3B – return and GST payment', 'GST', 'Monthly', { day: 20 }, 'GST portal'],
  ['Advance tax instalment', 'Income tax', 'Quarterly', { dates: ['06-15', '09-15', '12-15', '03-15'] }, 'Income Tax portal'],
  ['TDS returns – 24Q and 26Q', 'TDS / TCS', 'Quarterly', { dates: ['07-31', '10-31', '01-31', '05-31'] }, 'TRACES'],
  ['ROC – AOC-4 (financial statements)', 'ROC / MCA', 'Yearly', { dates: ['10-30'] }, 'MCA portal'],
  ['Income tax return (company, audited)', 'Income tax', 'Yearly', { dates: ['10-31'] }, 'Income Tax portal'],
  ['ROC – MGT-7 (annual return)', 'ROC / MCA', 'Yearly', { dates: ['11-29'] }, 'MCA portal'],
  ['GST annual return – GSTR-9 / 9C', 'GST', 'Yearly', { dates: ['12-31'] }, 'GST portal'],
];
// The first due date on or after `from` for a standard item's rule.
function firstDue(rule, from = F.today()) {
  const y = Number(from.slice(0, 4));
  if (rule.day) {
    const thisMonth = `${from.slice(0, 7)}-${String(rule.day).padStart(2, '0')}`;
    return thisMonth >= from ? thisMonth : addMonths(thisMonth, 1);
  }
  const candidates = [];
  for (const yy of [y, y + 1]) for (const md of rule.dates) candidates.push(`${yy}-${md}`);
  return candidates.sort().find((d) => d >= from);
}

// The due date after this one. Standard statutory items follow their own calendar (the TDS
// returns are due 31 Jul, 31 Oct, 31 Jan and 31 May, not every 3 months); the rest repeat on
// their intended day of the month.
function nextDueFor(item) {
  const std = STANDARD_COMPLIANCE.find(([title]) => title === item.title);
  if (std && std[2] === item.frequency) return firstDue(std[3], F.addDays(item.due_on, 1));
  return nextDue(item.frequency, item.due_on, item.due_day);
}

// ---------- standard checklists for a sheet-metal and welding plant ----------

const STANDARD_CHECKLISTS = [
  { title: 'Press start-up check', department: 'Production', frequency: 'Daily (Mon–Sat)', needs_approval: 0, items: [
    'Air pressure at the clutch [5-6 kg/cm²]', 'Lubrication oil level in the sight glass', 'Guards and light curtain in place and working',
    'Two-hand control and emergency stop tested', 'Die clamped, bolts tight', 'First piece checked and approved by quality', 'Area clean, no oil on the floor'] },
  { title: 'Welding cell start-up check', department: 'Production', frequency: 'Daily (Mon–Sat)', needs_approval: 0, items: [
    'Gas flow [12-15 L/min]', 'Torch nozzle and contact tip clean', 'Earth clamp tight', 'Fixture locators clean of spatter',
    'Helmet, gloves and apron worn', 'Fume extraction running'] },
  { title: 'Shop floor 5S round', department: 'Production', frequency: 'Daily (Mon–Sat)', needs_approval: 1, items: [
    'Walkways and exits clear', 'Scrap bins not overflowing', 'Tools back on the shadow boards', 'No oil or coolant spills',
    'WIP bins labelled with part no and quantity', 'Rejected parts in the red bin and tagged'] },
  { title: 'Safety round', department: 'HR & admin', frequency: 'Daily (Mon–Sat)', needs_approval: 1, items: [
    'Fire extinguishers in place, seals intact', 'Emergency exits unlocked and clear', 'First-aid box stocked',
    'PPE worn in the press and weld shops', 'No loose or damaged wiring', 'Forklift checked before use'] },
  { title: 'First-piece and gauge check', department: 'Quality', frequency: 'Daily (Mon–Sat)', needs_approval: 0, items: [
    'First-piece approval done for every set-up', 'Gauges in use have valid calibration tags', 'Rejection register updated',
    'Hold material tagged and kept apart', 'Open customer complaints reviewed'] },
  { title: 'Stores closing', department: 'Purchase & stores', frequency: 'Daily (Mon–Sat)', needs_approval: 0, items: [
    'Today’s GRNs entered', 'Material issued to production recorded', 'Rejected incoming material tagged and moved to the rejection area',
    'Consumables below minimum noted for purchase', 'Stores locked and keys returned'] },
  { title: 'Dispatch closing', department: 'Dispatch & logistics', frequency: 'Daily (Mon–Sat)', needs_approval: 1, items: [
    'Invoice and delivery challan printed for every dispatch', 'E-way bill made for every vehicle', 'Packing as per the customer standard',
    'Vehicle checked: tarpaulin and lashing', 'Dispatch register updated'] },
  { title: 'Compressor and utilities check', department: 'Maintenance', frequency: 'Daily (Mon–Sat)', needs_approval: 0, items: [
    'Water drained from the air receiver', 'Compressor oil level', 'Line pressure [6-8 kg/cm²]', 'Diesel in the DG set [25-100 %]',
    'Panel room dry and locked'] },
  { title: 'Weekly accounts close', department: 'Accounts', frequency: 'Weekly', weekday: 'Saturday', needs_approval: 1, items: [
    'Bank statements reconciled', 'Cash counted in the petty cash box [₹]', 'Customer payments due next week followed up',
    'Supplier bills due next week in the payment plan', 'E-invoices generated for the week’s sales'] },
  { title: 'Weekly maintenance review', department: 'Maintenance', frequency: 'Weekly', weekday: 'Saturday', needs_approval: 1, items: [
    'All PM tasks of the week closed or moved', 'Breakdowns of the week logged with their cause', 'Downtime this week [hours]',
    'Spares below minimum ordered', 'Oil and grease stock checked'] },
  { title: 'Fire extinguisher inspection', department: 'HR & admin', frequency: 'Monthly', month_day: 1, needs_approval: 1, items: [
    'Pressure gauge needle in the green', 'Safety pin and seal intact', 'Hose and nozzle not cracked or blocked',
    'Refill or expiry date valid', 'Inspection tag signed and dated'] },
  { title: 'Gauge calibration review', department: 'Quality', frequency: 'Monthly', month_day: 5, needs_approval: 1, items: [
    'Calibration due list for next month made', 'Gauges due sent to the lab', 'Calibration certificates filed', 'Damaged or worn gauges withdrawn'] },
];

// ---------- the weekly scorecard ----------

function scorecard(db, ws) {
  const t = F.today();
  const we = F.addDays(ws, 6);
  const upTo = we < t ? we : t;
  const p = { ws, upTo, t };
  const blank = () => ({ due: 0, onTime: 0, late: 0, missed: 0, pending: 0, issues: 0, jobsDue: 0, jobsOnTime: 0, jobsLate: 0, jobsOverdue: 0, jobsPending: 0 });
  const depts = new Map();
  const people = new Map();
  const bump = (map, key, label, f) => { if (!map.has(key)) map.set(key, { key, label, ...blank() }); f(map.get(key)); };

  const runs = upTo < ws ? [] : db.all(`SELECT r.*, c.title, u.name AS assignee_name, s.name AS submitter_name
                                         FROM checklist_runs r JOIN checklists c ON c.id = r.checklist_id
                                         LEFT JOIN users u ON u.id = r.assignee_id LEFT JOIN users s ON s.id = r.submitted_by
                                         WHERE r.due_on BETWEEN :ws AND :upTo ORDER BY r.due_on, c.title`, p);
  const missed = [];
  for (const r of runs) {
    const done = RUN_DONE.includes(r.status);
    const onTime = done && F.localDay(r.submitted_at) <= r.due_on;
    const f = (s) => {
      s.due += 1;
      if (done) s[onTime ? 'onTime' : 'late'] += 1;
      else if (r.due_on < t) s.missed += 1;
      else s.pending += 1;
      s.issues += r.issues || 0;
    };
    bump(depts, r.department, r.department, f);
    const pid = r.assignee_id || r.submitted_by;
    if (pid) bump(people, pid, r.assignee_name || r.submitter_name, f);
    if (!done && r.due_on < t) missed.push(r);
  }

  const jobs = db.all(`SELECT j.*, a.name AS assignee_name FROM jobs j JOIN users a ON a.id = j.assigned_to
                       WHERE j.due_on BETWEEN :ws AND :upTo AND j.status <> 'Cancelled'`, p);
  for (const j of jobs) {
    const f = (s) => {
      s.jobsDue += 1;
      if (j.status === 'Done') s[j.done_on && j.done_on <= j.due_on ? 'jobsOnTime' : 'jobsLate'] += 1;
      else if (j.due_on < t) s.jobsOverdue += 1;
      else s.jobsPending += 1; // due today and not finished yet: not late, so not counted against anyone
    };
    bump(depts, j.department, j.department, f);
    bump(people, j.assigned_to, j.assignee_name, f);
  }

  const pct = (s) => {
    const due = s.due + s.jobsDue - s.pending - s.jobsPending;
    return due > 0 ? Math.round(((s.onTime + s.jobsOnTime) / due) * 100) : null;
  };
  const sortRows = (map) => [...map.values()].map((s) => ({ ...s, score: pct(s) }))
    .sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || String(a.label).localeCompare(String(b.label)));

  const compliance = db.all(`SELECT f.*, i.title, i.category, u.name AS done_by_name FROM compliance_filings f
                             JOIN compliance_items i ON i.id = f.item_id LEFT JOIN users u ON u.id = f.done_by
                             WHERE f.period_due_on BETWEEN :ws AND :upTo ORDER BY f.period_due_on`, p);
  const complianceOverdue = db.all(`SELECT i.*, u.name AS owner_name FROM compliance_items i LEFT JOIN users u ON u.id = i.owner_id
                                    WHERE i.active = 1 AND i.due_on < :t ORDER BY i.due_on`, p);
  const pm = db.get(`SELECT COUNT(CASE WHEN status <> 'Cancelled' THEN 1 END) AS planned, COUNT(CASE WHEN status = 'Done' THEN 1 END) AS done
                     FROM pm_tasks WHERE week_start = :ws`, p);
  return { ws, we, upTo, depts: sortRows(depts), people: sortRows(people), missed, compliance, complianceOverdue, pm };
}

module.exports = {
  FREQ, RUN_OPEN, RUN_DONE, parseItems, limits, judge, isDue, describe, createRun, refreshToday, ensureRuns,
  canManageChecklist, canFillRun, canReviewRun, addMonths, nextDue, nextDueFor, firstDue, STANDARD_COMPLIANCE, STANDARD_CHECKLISTS, scorecard,
};
