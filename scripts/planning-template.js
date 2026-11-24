#!/usr/bin/env node
'use strict';
// Builds the stand-alone weekly planning workbook, for planning in Excel alongside the CRM:
//   sheets/SEI Weekly Planning Template.xlsx  - every plan with drop-downs, formulas, a 52-week
//                                                PM calendar and one PM card per machine or tool
//   sheets/SEI Weekly Plan - demo week.xlsx    - what "Download week as Excel" gives from the CRM
// Example rows come from the demo data (made up). Run: npm run sheets
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const F = require('../src/format');
const X = require('../src/xlsx');
const { openDb, seedClients, PM_DAYS } = require('../src/db');
const demo = require('../src/demo');
const { OPT, MODULES } = require('../src/modules');
const { weekWorkbook } = require('../src/planning');

F.setTimeZone(process.env.TZ_NAME || 'Asia/Kolkata');
const OUT = path.join(__dirname, '..', 'sheets');
const LAST = 600; // formulas look at rows 5..LAST of each plan sheet

const SH = {
  readme: 'Read me', week: 'Week summary', sales: 'Sales plan', prod: 'Production plan', reg: 'Machines & tools', cal: 'PM calendar',
  pm: 'PM plan', buy: 'Purchase plan', pay: 'Payment plan', petty: 'Petty cash (Cash-UPI)', sup: 'Suppliers', lists: 'Lists',
};
const q = X.quoteSheet;
const colRef = (sheet, c) => `${q(sheet)}!$${c}:$${c}`; // whole column
const rng = (sheet, c) => `${q(sheet)}!$${c}$5:$${c}$${LAST}`; // plan rows only
const S = X.ST;

// ---------- drop-down lists ----------
const LISTS = [
  ['Asset type', OPT.assetType], ['PM frequency', OPT.pmFrequency], ['Every (days)', OPT.pmFrequency.map((f) => PM_DAYS[f])], ['PM day', F.DAYS],
  ['PM status', OPT.pmStatus], ['Shift', OPT.shift], ['Operation', OPT.operation], ['Production status', OPT.productionStatus],
  ['Reason if short', OPT.shortfallReason], ['Purchase category', OPT.purchaseCategory], ['Unit', OPT.unit], ['Purchase status', OPT.purchaseStatus],
  ['Payment category', OPT.paymentCategory], ['Priority', OPT.paymentPriority], ['Pay mode', OPT.payMode], ['Payment status', OPT.paymentPlanStatus],
  ['Petty entry', OPT.pettyType], ['Petty head', OPT.pettyHead], ['Paid by', OPT.pettyMode], ['Petty status', OPT.pettyStatus],
  ['Asset status', OPT.assetStatus], ['Supplier category', OPT.supplierCategory],
];
function list(name) {
  const i = LISTS.findIndex((l) => l[0] === name);
  if (i < 0) throw new Error(`No list ${name}`);
  return `${q(SH.lists)}!$${X.col(i)}$2:$${X.col(i)}$${LISTS[i][1].length + 1}`;
}
const CODES = `${q(SH.reg)}!$A$5:$A$${LAST}`;
const SUPPLIER_NAMES = `${q(SH.sup)}!$A$5:$A$${LAST}`;
const weekOfF = (c, r) => `IF(${c}${r}="","",${c}${r}-WEEKDAY(${c}${r},3))`;
const lookup = (code, c) => `IFERROR(INDEX(${colRef(SH.reg, c)},MATCH(${code},${colRef(SH.reg, 'A')},0)),"")`;
// Text fields: &"" keeps an empty register cell empty instead of showing 0.
const lookupText = (code, c) => `IFERROR(INDEX(${colRef(SH.reg, c)},MATCH(${code},${colRef(SH.reg, 'A')},0))&"","")`;

// ---------- example data from a throwaway demo database ----------
function demoData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sei-sheets-'));
  const db = openDb(path.join(dir, 'demo.db'));
  const log = console.log;
  console.log = () => {};
  try {
    seedClients(db);
    demo.seedDemo(db);
    demo.seedPlanningDemo(db);
  } finally { console.log = log; }
  const ws = F.weekOf(F.today());
  const lw = F.addDays(ws, -7);
  const rows = (key, where, order) => db.all(`SELECT * FROM (${MODULES[key].listSql}) x WHERE ${where} ORDER BY ${order}`, { ws, lw });
  const data = {
    ws,
    assets: rows('assets', "status <> 'Scrapped'", MODULES.assets.order),
    pm: rows('pm_tasks', 'week_start IN (:lw, :ws)', 'planned_on, asset_code'),
    sales: rows('sales_plans', 'week_start IN (:lw, :ws)', 'week_start, client_name, part_name'),
    prod: rows('production_plans', 'week_start = :ws', 'plan_date, shift, asset_code'),
    buy: rows('purchase_plans', '1 = 1', 'required_by, item'),
    pay: rows('payment_plans', '1 = 1', 'plan_date, id'),
    petty: rows('petty_cash', '1 = 1', 'plan_date, id'),
    suppliers: rows('suppliers', '1 = 1', 'name'),
    week: weekWorkbook(db, ws),
  };
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  return data;
}

// ---------- sheets ----------

function readMe(d) {
  const lines = [
    ['How this workbook works', 'h'],
    ['Plan the week in the coloured sheets. Type in the yellow rows (and over the example rows); columns with formulas fill themselves.'],
    ['Pick from the drop-down lists wherever a cell has one (status, category, machine code, supplier and so on).'],
    ['Dates: type any date. Each plan works out its week (Monday to Sunday) by itself.'],
    ['The rows already filled in are made-up examples from the CRM demo. Delete them, or type over them, before real use.'],
    [''],
    ['Sheets', 'h'],
    [`${SH.week}: pick a week (cell C4) to see every plan’s totals for that week: sales, production, PM, purchases, payments and petty cash.`],
    [`${SH.sales}: what each client should get that week, against what was dispatched.`],
    [`${SH.prod}: day and shift plan per machine, with produced and rejected quantities. It warns when a machine is under breakdown or has PM that day.`],
    [`${SH.reg}: every machine, die, fixture and gauge, with its own PM frequency, PM day, checklist (one check per line) and next due date.`],
    [`${SH.cal}: 52 weeks for every machine and tool. P = PM planned, ✓ = done, ✗ = missed. A red P is a planned week that has passed without the PM being done.`],
    [`${SH.pm}: the weekly PM tasks. Mark each one Done with the date, and the register and calendar move on to the next due date.`],
    ['Card sheets (one per machine or tool): the individual PM check sheet. Change the code in C4 to use a card for another machine; copy a card sheet for a new one.'],
    [`${SH.buy}: what has to be bought each week, from whom and by when; late items are flagged.`],
    [`${SH.pay}: payments to make each week, with priority (Must pay first), mode and status.`],
    [`${SH.petty}: petty cash payments planned and paid in Cash or by UPI, cash added to the box, and the cash left in the box after each entry.`],
    [`${SH.sup}: supplier list used by the purchase plan.`],
    [''],
    ['PM frequencies', 'h'],
    ['Weekly = every week · Fortnightly = every 2 weeks · Monthly = every 4 weeks · Quarterly = every 13 weeks · Half-yearly = every 26 weeks · Yearly = every 52 weeks. Counting in whole weeks keeps every PM in a planning week.'],
    [''],
    ['The same plans in the CRM', 'h'],
    ['The CRM has the same plans under Weekly planning, with a Week planner page. “Plan PM for this week” there fills the PM plan from each machine’s frequency, and “Download week as Excel” gives a workbook laid out like these sheets, filled from live data.'],
    ['Petty cash (Cash-UPI): small payments made in cash from the petty cash box or by UPI. Only cash payments reduce the cash in the box.'],
    [''],
    [`Made on ${F.fmtDate(F.today())}. Example rows are for the weeks around ${F.weekLabel(d.ws)}.`],
  ];
  return {
    name: SH.readme, tabColor: 'red', gridlines: false, cols: [130],
    rows: [[{ v: 'SEI weekly planning workbook', st: S.title }], [{ v: 'Sales · production · preventive maintenance · purchase · payments · petty cash (Cash / UPI)', st: S.subtitle }], [],
      ...lines.map(([t, kind]) => [{ v: t, st: kind === 'h' ? { bold: true, size: 12, color: 'navy' } : { wrap: true } }])],
  };
}

function weekSummary() {
  const W = '$C$5';
  const sumifs = (sheet, sumCol, ...crit) => `SUMIFS(${colRef(sheet, sumCol)},${crit.join(',')})`;
  const wk = (sheet) => `${colRef(sheet, 'B')},${W}`;
  const head = (t) => [{ v: '', st: {} }, { v: t, st: S.head }, { v: '', st: S.head }, { v: '', st: S.head }];
  const row = (label, f, fmt, note) => [{ v: '' }, { v: label, st: { bold: true, border: 'all' } }, { f, st: { border: 'all', fmt, bold: true } }, { v: note || '', st: { border: 'all', italic: true, color: 'slate', wrap: true } }];
  const rows = [
    [{ v: 'Week summary', st: S.title }],
    [{ v: 'Every plan’s totals for one week. Type any date in C4 (it shows today’s week by default).', st: S.subtitle }],
    [],
    [{ v: '' }, { v: 'Week (type any date in it)', st: { bold: true, border: 'all' } }, { f: 'TODAY()', st: { fmt: 'date', fill: 'input', border: 'all', bold: true } }, { v: 'Overwrite with a date to see another week', st: { italic: true, color: 'slate' } }],
    [{ v: '' }, { v: 'Week starts (Monday)', st: { border: 'all' } }, { f: 'C4-WEEKDAY(C4,3)', st: { fmt: 'date', border: 'all' } }],
    [{ v: '' }, { v: 'Week ends (Sunday)', st: { border: 'all' } }, { f: 'C5+6', st: { fmt: 'date', border: 'all' } }],
    [],
    head('Sales (dispatch) plan'),
    row('Planned dispatch value', sumifs(SH.sales, 'I', wk(SH.sales)), 'money'),
    row('Dispatched value', sumifs(SH.sales, 'K', wk(SH.sales)), 'money'),
    row('Achieved', 'IFERROR(C10/C9,"")', 'pct'),
    row('Lines not fully dispatched yet', `COUNTIFS(${wk(SH.sales)},${colRef(SH.sales, 'M')},"<1")`, 'int'),
    head('Production plan'),
    row('Planned (pcs)', sumifs(SH.prod, 'L', wk(SH.prod)), 'int'),
    row('Produced OK (pcs)', sumifs(SH.prod, 'M', wk(SH.prod)), 'int'),
    row('Achieved', 'IFERROR(C15/C14,"")', 'pct'),
    row('Rejection', `IFERROR(${sumifs(SH.prod, 'N', wk(SH.prod))}/(C15+${sumifs(SH.prod, 'N', wk(SH.prod))}),"")`, '0.0%'),
    row('Lines short', `COUNTIFS(${wk(SH.prod)},${colRef(SH.prod, 'Q')},"Short")`, 'int'),
    row('Lines on a machine under breakdown or PM', `COUNTIFS(${wk(SH.prod)},${colRef(SH.prod, 'G')},"?*")`, 'int', 'Move these to another machine or day'),
    head('Preventive maintenance'),
    row('PM tasks planned', `COUNTIFS(${wk(SH.pm)},${colRef(SH.pm, 'H')},"<>Cancelled")`, 'int'),
    row('Done', `COUNTIFS(${wk(SH.pm)},${colRef(SH.pm, 'H')},"Done")`, 'int'),
    row('Missed', `COUNTIFS(${wk(SH.pm)},${colRef(SH.pm, 'H')},"Missed")`, 'int'),
    row('Overdue now (any week)', `COUNTIFS(${colRef(SH.pm, 'A')},"<"&TODAY(),${colRef(SH.pm, 'H')},"Planned")+COUNTIFS(${colRef(SH.pm, 'A')},"<"&TODAY(),${colRef(SH.pm, 'H')},"Postponed")`, 'int'),
    row('PM downtime (minutes)', sumifs(SH.pm, 'K', wk(SH.pm)), 'int'),
    row('Machines and tools due by week end', `COUNTIF(${colRef(SH.reg, 'M')},"Due")`, 'int', 'From the register; plan each one in the PM plan'),
    row('Under breakdown', `COUNTIF(${colRef(SH.reg, 'N')},"Breakdown")`, 'int'),
    head('Purchase plan'),
    row('Planned purchase value', `${sumifs(SH.buy, 'K', wk(SH.buy))}-${sumifs(SH.buy, 'K', wk(SH.buy), `${colRef(SH.buy, 'L')},"Cancelled"`)}`, 'money'),
    row('Received', `COUNTIFS(${wk(SH.buy)},${colRef(SH.buy, 'L')},"Received")`, 'int'),
    row('Late now (any week)', `COUNTIF(${colRef(SH.buy, 'Q')},"Late")`, 'int'),
    head('Payment plan'),
    row('Payments planned', `${sumifs(SH.pay, 'H', wk(SH.pay))}-${sumifs(SH.pay, 'H', wk(SH.pay), `${colRef(SH.pay, 'K')},"Cancelled"`)}`, 'money'),
    row('Still to pay', `${sumifs(SH.pay, 'H', wk(SH.pay), `${colRef(SH.pay, 'K')},"Planned"`)}+${sumifs(SH.pay, 'H', wk(SH.pay), `${colRef(SH.pay, 'K')},"Approved"`)}`, 'money'),
    row('of which must pay', `${sumifs(SH.pay, 'H', wk(SH.pay), `${colRef(SH.pay, 'K')},"Planned"`, `${colRef(SH.pay, 'I')},"Must pay"`)}+${sumifs(SH.pay, 'H', wk(SH.pay), `${colRef(SH.pay, 'K')},"Approved"`, `${colRef(SH.pay, 'I')},"Must pay"`)}`, 'money'),
    row('Paid', sumifs(SH.pay, 'N', wk(SH.pay)), 'money'),
    row('Unpaid from earlier weeks', `SUMIFS(${colRef(SH.pay, 'H')},${colRef(SH.pay, 'B')},"<"&${W},${colRef(SH.pay, 'K')},"Planned")+SUMIFS(${colRef(SH.pay, 'H')},${colRef(SH.pay, 'B')},"<"&${W},${colRef(SH.pay, 'K')},"Approved")`, 'money'),
    head('Petty cash (Cash / UPI)'),
    row('Planned spend', `${sumifs(SH.petty, 'H', wk(SH.petty), `${colRef(SH.petty, 'C')},"Expense"`)}-${sumifs(SH.petty, 'H', wk(SH.petty), `${colRef(SH.petty, 'C')},"Expense"`, `${colRef(SH.petty, 'J')},"Cancelled"`)}`, 'money'),
    row('Paid in cash', sumifs(SH.petty, 'I', wk(SH.petty), `${colRef(SH.petty, 'C')},"Expense"`, `${colRef(SH.petty, 'J')},"Paid"`, `${colRef(SH.petty, 'G')},"Cash"`), 'money'),
    row('Paid by UPI', sumifs(SH.petty, 'I', wk(SH.petty), `${colRef(SH.petty, 'C')},"Expense"`, `${colRef(SH.petty, 'J')},"Paid"`, `${colRef(SH.petty, 'G')},"UPI"`), 'money'),
    row('Cash topped up', sumifs(SH.petty, 'I', wk(SH.petty), `${colRef(SH.petty, 'C')},"Cash top-up"`, `${colRef(SH.petty, 'J')},"Paid"`), 'money'),
    row('Cash in the box at week end', `SUMIFS(${colRef(SH.petty, 'I')},${colRef(SH.petty, 'A')},"<="&$C$6,${colRef(SH.petty, 'J')},"Paid",${colRef(SH.petty, 'C')},"Cash top-up")-SUMIFS(${colRef(SH.petty, 'I')},${colRef(SH.petty, 'A')},"<="&$C$6,${colRef(SH.petty, 'J')},"Paid",${colRef(SH.petty, 'C')},"Expense",${colRef(SH.petty, 'G')},"Cash")`, 'money'),
  ];
  return { name: SH.week, tabColor: 'red', gridlines: false, cols: [2, 40, 18, 46], rows, heights: { 3: 20 } };
}

function salesPlan(d) {
  const n = d.sales.length + 40;
  return X.table({
    name: SH.sales, title: 'Sales (dispatch) plan', subtitle: 'One line per client, part and week. Dispatched qty is what actually went out that week.', tabColor: 'navy', blankRows: 40,
    columns: [
      { label: 'Plan week (any date in it)', fmt: 'date', width: 13, input: true },
      { label: 'Week (Monday)', fmt: 'date', width: 12, formula: (r) => weekOfF('A', r) },
      { label: 'Client', width: 22, input: true }, { label: 'PO / schedule', width: 13, input: true }, { label: 'Part', width: 24, input: true }, { label: 'Part no', width: 12, input: true },
      { label: 'Planned qty', fmt: 'int', width: 10, total: true, input: true }, { label: 'Rate (₹)', fmt: 'money2', width: 10, input: true },
      { label: 'Planned value', fmt: 'money', width: 13, total: true, formula: (r) => `IF(G${r}="","",G${r}*H${r})` },
      { label: 'Dispatched qty', fmt: 'int', width: 11, total: true, input: true },
      { label: 'Dispatched value', fmt: 'money', width: 13, total: true, formula: (r) => `IF(J${r}="","",J${r}*H${r})` },
      { label: 'Balance qty', fmt: 'int', width: 10, total: true, formula: (r) => `IF(G${r}="","",G${r}-N(J${r}))` },
      { label: 'Achieved', fmt: 'pct', width: 10, formula: (r) => `IF(OR(G${r}="",J${r}=""),"",J${r}/G${r})` },
      { label: 'Dispatch day', fmt: 'day', width: 12, input: true }, { label: 'Handled by', width: 14, input: true },
    ],
    rows: d.sales.map((r) => [r.week_start, null, r.client_name, r.po_no, r.part_name, r.part_no, r.planned_qty, r.rate, null, r.actual_qty, null, null, null, r.dispatch_on, r.owner_name]),
    cf: [{ sqref: `M5:M${4 + n}`, formula: (r) => `AND(M${r}<>"",M${r}<0.8)`, tone: 'bad' }, { sqref: `M5:M${4 + n}`, formula: (r) => `AND(M${r}<>"",M${r}>=1)`, tone: 'ok' }],
  });
}

function productionPlan(d) {
  const pmOpen = (r) => `COUNTIFS(${rng(SH.pm, 'D')},E${r},${rng(SH.pm, 'A')},A${r},${rng(SH.pm, 'H')},"Planned")+COUNTIFS(${rng(SH.pm, 'D')},E${r},${rng(SH.pm, 'A')},A${r},${rng(SH.pm, 'H')},"Postponed")`;
  const n = d.prod.length + 60;
  return X.table({
    name: SH.prod, title: 'Production plan', subtitle: 'Day and shift plan per machine. The warning column checks the machine register and the PM plan.', tabColor: 'navy', blankRows: 60,
    columns: [
      { label: 'Date', fmt: 'date', width: 12, input: true },
      { label: 'Week', fmt: 'date', width: 11, formula: (r) => weekOfF('A', r) },
      { label: 'Day', width: 6, formula: (r) => `IF(A${r}="","",TEXT(A${r},"ddd"))` },
      { label: 'Shift', width: 11, source: list('Shift'), input: true },
      { label: 'Machine', width: 10, source: CODES, input: true },
      { label: 'Machine name', width: 22, formula: (r) => `IF(E${r}="","",${lookupText(`E${r}`, 'B')})` },
      { label: 'Warning', width: 18, formula: (r) => `IF(E${r}="","",TRIM(IF(${lookupText(`E${r}`, 'N')}="Breakdown","Breakdown ","")&IF(${pmOpen(r)}>0,"PM same day","")))` },
      { label: 'Operation', width: 18, source: list('Operation'), input: true },
      { label: 'Client', width: 18, input: true }, { label: 'Part', width: 22, input: true }, { label: 'Part no', width: 12, input: true },
      { label: 'Planned', fmt: 'int', width: 9, total: true, input: true }, { label: 'Produced', fmt: 'int', width: 9, total: true, input: true }, { label: 'Rejected', fmt: 'int', width: 9, total: true, input: true },
      { label: 'Achieved', fmt: 'pct', width: 9, formula: (r) => `IF(OR(L${r}="",M${r}=""),"",M${r}/L${r})` },
      { label: 'Rejection', fmt: '0.0%', width: 9, formula: (r) => `IF(OR(M${r}="",N(M${r})+N(N${r})=0),"",N(N${r})/(N(M${r})+N(N${r})))` },
      { label: 'Status', width: 11, source: list('Production status'), input: true },
      { label: 'Reason if short', width: 18, source: list('Reason if short'), input: true },
      { label: 'Supervisor', width: 14, input: true },
    ],
    rows: d.prod.map((r) => [r.plan_date, null, null, r.shift, r.asset_code, null, null, r.operation, r.client_name, r.part_name, r.part_no, r.planned_qty, r.produced_qty, r.rejected_qty, null, null, r.status, r.shortfall_reason, r.supervisor_name]),
    cf: [
      { sqref: `G5:G${4 + n}`, formula: (r) => `G${r}<>""`, tone: 'bad' },
      { sqref: `Q5:Q${4 + n}`, formula: (r) => `Q${r}="Short"`, tone: 'bad' },
      { sqref: `Q5:Q${4 + n}`, formula: (r) => `Q${r}="Done"`, tone: 'ok' },
    ],
  });
}

function register(d) {
  const n = d.assets.length + 30;
  // Last PM done: the latest Done date for this code in the PM plan, or the date typed in J.
  const lastDone = (r) => `IF(A${r}="","",MAX(N(J${r}),SUMPRODUCT(MAX((${rng(SH.pm, 'D')}=A${r})*(${rng(SH.pm, 'H')}="Done")*${rng(SH.pm, 'I')}))))`;
  return X.table({
    name: SH.reg, title: 'Machines and tools: preventive maintenance register', subtitle: 'One row per machine, die, fixture or gauge. Each has its own PM frequency, day and checklist (one check per line; Alt+Enter starts a new line).', tabColor: 'navy', blankRows: 30, totals: false,
    columns: [
      { label: 'Code', width: 12, input: true }, { label: 'Name', width: 28, input: true }, { label: 'Type', width: 11, source: list('Asset type'), input: true },
      { label: 'Kind', width: 22, input: true }, { label: 'Line / bay', width: 16, input: true }, { label: 'For part', width: 20, input: true },
      { label: 'PM frequency', width: 12, source: list('PM frequency'), input: true }, { label: 'PM day', width: 11, source: list('PM day'), input: true },
      { label: 'Every (days)', fmt: 'int', width: 8, formula: (r) => `IF(G${r}="","",IFERROR(INDEX(${list('Every (days)')},MATCH(G${r},${list('PM frequency')},0)),""))` },
      { label: 'Last PM before this sheet', fmt: 'date', width: 12, input: true },
      { label: 'Last PM done', fmt: 'dd-mmm-yyyy;;', width: 12, formula: lastDone },
      { label: 'Next PM due', fmt: 'date', width: 12, formula: (r) => `IF(OR(A${r}="",G${r}=""),"",IF(N(K${r})=0,TODAY(),K${r}+I${r}))` },
      { label: 'Due by week end?', width: 9, formula: (r) => `IF(L${r}="","",IF(L${r}<=${q(SH.week)}!$C$6,"Due",""))` },
      { label: 'Status', width: 11, source: list('Asset status'), input: true }, { label: 'Responsible', width: 14, input: true },
      { label: 'PM checklist (one check per line)', width: 70, wrap: true, input: true },
    ],
    rows: d.assets.map((a) => [a.code, a.name, a.asset_type, a.category, a.location, a.part_name, a.pm_frequency, a.pm_day, null, a.last_done_on, null, null, null, a.status, a.responsible_name, a.pm_checklist]),
    cf: [
      { sqref: `L5:L${4 + n}`, formula: (r) => `AND(L${r}<>"",L${r}<TODAY())`, tone: 'bad' },
      { sqref: `M5:M${4 + n}`, formula: (r) => `M${r}="Due"`, tone: 'warn' },
      { sqref: `N5:N${4 + n}`, formula: (r) => `N${r}="Breakdown"`, tone: 'bad' },
    ],
  });
}

function pmPlan(d) {
  const n = d.pm.length + 60;
  return X.table({
    name: SH.pm, title: 'Preventive maintenance plan (weekly)', subtitle: 'One line per PM task. Mark it Done with the date; the register and the PM calendar update by themselves.', tabColor: 'navy', blankRows: 60,
    columns: [
      { label: 'Planned on', fmt: 'date', width: 12, input: true },
      { label: 'Week', fmt: 'date', width: 11, formula: (r) => weekOfF('A', r) },
      { label: 'Day', width: 6, formula: (r) => `IF(A${r}="","",TEXT(A${r},"ddd"))` },
      { label: 'Code', width: 12, source: CODES, input: true },
      { label: 'Machine / tool', width: 28, formula: (r) => `IF(D${r}="","",${lookupText(`D${r}`, 'B')})` },
      { label: 'Type', width: 10, formula: (r) => `IF(D${r}="","",${lookupText(`D${r}`, 'C')})` },
      { label: 'Responsible', width: 14, input: true },
      { label: 'Status', width: 11, source: list('PM status'), input: true },
      { label: 'Done on', fmt: 'date', width: 12, input: true },
      { label: 'Done by', width: 16, input: true },
      { label: 'Downtime (min)', fmt: 'int', width: 10, total: true, input: true },
      { label: 'Findings and abnormalities', width: 34, wrap: true, input: true },
      { label: 'Spares used', width: 16, input: true },
      { label: 'Cost (₹)', fmt: 'money', width: 10, total: true, input: true },
    ],
    rows: d.pm.map((r) => [r.planned_on, null, null, r.asset_code, null, null, r.assigned_name, r.status, r.done_on, r.technician, r.downtime_min, r.findings, r.spares_used, r.cost]),
    cf: [
      { sqref: `H5:H${4 + n}`, formula: (r) => `H${r}="Done"`, tone: 'ok' },
      { sqref: `H5:H${4 + n}`, formula: (r) => `H${r}="Missed"`, tone: 'bad' },
      { sqref: `A5:A${4 + n}`, formula: (r) => `AND(A${r}<>"",A${r}<TODAY(),OR(H${r}="Planned",H${r}="Postponed"))`, tone: 'bad' },
    ],
  });
}

function pmCalendar(d) {
  const n = d.assets.length + 30;
  const WEEKS = 52;
  const FIRST = 6; // column G
  const rows = [];
  rows[0] = [{ v: 'PM calendar: 52 weeks', st: S.title }];
  rows[1] = [{ v: 'P = PM planned that week · ✓ = done · ✗ = missed. A red P has passed without the PM being done. Rows follow the Machines & tools sheet.', st: S.subtitle }];
  rows[2] = [{ v: 'First week shown', st: { bold: true } }, null, { f: 'TODAY()-WEEKDAY(TODAY(),3)-28', st: { fmt: 'date', fill: 'input', border: 'all' } }, { v: 'Type a date to start the calendar elsewhere', st: { italic: true, color: 'slate' } }];
  const head = ['Code', 'Machine / tool', 'Frequency', 'Every (weeks)', 'Next due week', 'Last PM'].map((v) => ({ v, st: S.head }));
  for (let w = 0; w < WEEKS; w++) head.push({ f: w === 0 ? 'C3-WEEKDAY(C3,3)' : `${X.col(FIRST + w - 1)}4+7`, st: { ...S.head, fmt: 'dd-mmm', align: 'center' } });
  rows[3] = head;
  const wkRow = [null, null, null, null, null, { v: 'Week no', st: { italic: true, color: 'slate', align: 'right' } }];
  for (let w = 0; w < WEEKS; w++) wkRow.push({ f: `"W"&ISOWEEKNUM(${X.col(FIRST + w)}4)`, st: { italic: true, color: 'slate', align: 'center' } });
  rows[4] = wkRow;
  const pmCode = rng(SH.pm, 'D');
  const pmWeek = rng(SH.pm, 'B');
  const pmStatus = rng(SH.pm, 'H');
  const reg = q(SH.reg);
  for (let i = 0; i < n; i++) {
    const r = 6 + i; // sheet row (1-based); the register row is 5 + i
    const g = 5 + i;
    const row = [
      { f: `IF(${reg}!A${g}="","",${reg}!A${g})`, st: { border: 'all', bold: true } },
      { f: `IF(A${r}="","",${reg}!B${g})`, st: { border: 'all' } },
      { f: `IF(A${r}="","",${reg}!G${g})`, st: { border: 'all' } },
      { f: `IF(OR(A${r}="",${reg}!I${g}=""),"",${reg}!I${g}/7)`, st: { border: 'all', fmt: 'int', align: 'center' } },
      { f: `IF(OR(A${r}="",${reg}!L${g}=""),"",${reg}!L${g}-WEEKDAY(${reg}!L${g},3))`, st: { border: 'all', fmt: 'date' } },
      { f: `IF(A${r}="","",IF(N(${reg}!K${g})=0,"",${reg}!K${g}))`, st: { border: 'all', fmt: 'date' } },
    ];
    for (let w = 0; w < WEEKS; w++) {
      const c = X.col(FIRST + w);
      const f = `IF($A${r}="","",IF(COUNTIFS(${pmCode},$A${r},${pmWeek},${c}$4,${pmStatus},"Done")>0,"✓",IF(COUNTIFS(${pmCode},$A${r},${pmWeek},${c}$4,${pmStatus},"Missed")>0,"✗",IF(AND($E${r}<>"",$D${r}<>"",${c}$4>=$E${r}),IF(MOD(ROUND((${c}$4-$E${r})/7,0),$D${r})=0,"P",""),""))))`;
      row.push({ f, st: { border: 'all', align: 'center' } });
    }
    rows[5 + i] = row;
  }
  const area = `G6:${X.col(FIRST + WEEKS - 1)}${5 + n}`;
  return {
    name: SH.cal, tabColor: 'navy', landscape: true,
    rows,
    cols: [12, 26, 11, 8, 12, 12, ...Array(WEEKS).fill(8)],
    heights: { 3: 30 },
    freeze: { rows: 5, cols: 2 },
    cf: [
      { sqref: area, formula: 'G6="✓"', tone: 'ok' },
      { sqref: area, formula: 'G6="✗"', tone: 'bad' },
      { sqref: area, formula: 'AND(G6="P",G$4<TODAY()-WEEKDAY(TODAY(),3))', tone: 'bad' },
      { sqref: area, formula: 'G6="P"', tone: 'info' },
    ],
  };
}

// One check sheet per machine or tool, driven by the code in C4.
function pmCard(code) {
  const at = (c) => (['I', 'K', 'L'].includes(c) ? lookup('$C$4', c) : lookupText('$C$4', c)); // I, K, L are numbers and dates
  const lab = (v) => ({ v, st: { bold: true, border: 'all', fill: 'mist' } });
  const val = (f, fmt) => ({ f, st: { border: 'all', fmt, align: 'left' } });
  const blank = { v: null, st: { border: 'all' } };
  const DATES = 13;
  const CHECKS = 12;
  const rows = [];
  rows[0] = [{ v: 'Preventive maintenance card', st: S.title }];
  rows[1] = [{ v: 'One card per machine or tool. At each PM tick every check: ✓ OK, ✗ not OK (write what was done in Remarks), NA not applicable.', st: S.subtitle }];
  const line = (l1, v1, l2, v2) => [null, lab(l1), v1, blank, blank, blank, lab(l2), { v: null, st: lab('').st }, v2, blank, blank, blank, blank, blank, blank];
  rows[3] = line('Code', { v: code, st: { bold: true, border: 'all', fill: 'input', size: 12 } }, 'Name', val(at('B')));
  rows[4] = line('Type', val(at('C')), 'Line / bay', val(at('E')));
  rows[5] = line('PM frequency', val(`IF(${at('G')}="","",${at('G')}&IF(${at('H')}="",""," on "&${at('H')}))`), 'Responsible', val(at('O')));
  rows[6] = line('Last PM done', val(`IF(N(${at('K')})=0,"",${at('K')})`, 'date'), 'Next PM due', val(at('L'), 'date'));
  rows[7] = line('Status', val(at('N')), 'For part', val(at('F')));
  const head = [{ v: '#', st: S.head }, { v: 'Check point: OK when (method)', st: S.head }];
  for (let i = 0; i < DATES; i++) {
    const f = i === 0 ? 'IF(I7="","",I7)' : `IF(OR(${X.col(1 + i)}10="",${at('I')}=""),"",${X.col(1 + i)}10+${at('I')})`;
    head.push({ f, st: { ...S.head, fmt: 'dd-mmm-yy', align: 'center' } });
  }
  rows[9] = head;
  for (let k = 1; k <= CHECKS; k++) {
    const r = 10 + k; // sheet row
    const split = `IFERROR(TRIM(MID(SUBSTITUTE(${at('P')},CHAR(10),REPT(" ",999)),${(k - 1) * 999 + 1},999)),"")`;
    const row = [{ f: `IF(B${r}="","",${k})`, st: { border: 'all', align: 'center' } }, { f: split, st: { border: 'all', wrap: true } }];
    for (let i = 0; i < DATES; i++) row.push({ v: null, st: { border: 'all', align: 'center', valign: 'center' } });
    rows[r - 1] = row;
  }
  ['Done by', 'Downtime (min)', 'Remarks / spares used', 'Checked by (supervisor)'].forEach((label, j) => {
    const row = [{ v: '', st: { border: 'all', fill: 'mist' } }, { v: label, st: { bold: true, border: 'all', fill: 'mist' } }];
    for (let i = 0; i < DATES; i++) row.push({ v: null, st: { border: 'all', wrap: true } });
    rows[10 + CHECKS + j] = row;
  });
  const ticks = `C11:${X.col(1 + DATES)}${10 + CHECKS}`;
  return {
    name: `Card ${code}`.slice(0, 31), tabColor: 'slate', landscape: true, gridlines: false,
    rows,
    cols: [4, 62, ...Array(DATES).fill(10.5)],
    heights: Object.fromEntries([[9, 30], ...Array.from({ length: CHECKS }, (_, k) => [10 + k, 30]), [10 + CHECKS + 2, 30]]),
    merges: ['C4:F4', 'C5:F5', 'C6:F6', 'C7:F7', 'C8:F8', 'G4:H4', 'G5:H5', 'G6:H6', 'G7:H7', 'G8:H8', 'I4:O4', 'I5:O5', 'I6:O6', 'I7:O7', 'I8:O8'],
    validations: [
      { sqref: ticks, list: ['✓', '✗', 'NA'] },
      { sqref: 'C4', source: CODES, prompt: 'Pick the machine or tool code from the register' },
    ],
    cf: [
      { sqref: ticks, formula: 'C11="✓"', tone: 'ok' },
      { sqref: ticks, formula: 'C11="✗"', tone: 'bad' },
    ],
    freeze: { rows: 10, cols: 2 },
  };
}

function purchasePlan(d) {
  const n = d.buy.length + 40;
  return X.table({
    name: SH.buy, title: 'Purchase plan (weekly)', subtitle: 'What has to be bought, from whom and by when. Late = the date needed has passed and it is not received.', tabColor: 'navy', blankRows: 40,
    columns: [
      { label: 'Needed by', fmt: 'date', width: 12, input: true },
      { label: 'Week', fmt: 'date', width: 11, formula: (r) => weekOfF('A', r) },
      { label: 'Item', width: 22, input: true }, { label: 'Grade / size / spec', width: 22, input: true },
      { label: 'Category', width: 17, source: list('Purchase category'), input: true }, { label: 'For', width: 18, input: true },
      { label: 'Supplier', width: 24, source: SUPPLIER_NAMES, input: true },
      { label: 'Qty', fmt: 'dec', width: 10, input: true }, { label: 'Unit', width: 8, source: list('Unit'), input: true }, { label: 'Rate (₹)', fmt: 'money2', width: 10, input: true },
      { label: 'Amount (₹)', fmt: 'money', width: 12, total: true, formula: (r) => `IF(OR(H${r}="",J${r}=""),"",H${r}*J${r})` },
      { label: 'Status', width: 13, source: list('Purchase status'), input: true },
      { label: 'PO no', width: 11, input: true }, { label: 'PO date', fmt: 'date', width: 11, input: true },
      { label: 'Received qty', fmt: 'dec', width: 10, input: true }, { label: 'Received on', fmt: 'date', width: 11, input: true },
      { label: 'Late?', width: 7, formula: (r) => `IF(AND(A${r}<>"",A${r}<TODAY(),L${r}<>"Received",L${r}<>"Cancelled"),"Late","")` },
    ],
    rows: d.buy.map((r) => [r.required_by, null, r.item, r.spec, r.category, r.purpose, r.supplier_name, r.qty, r.unit, r.rate, null, r.status, r.po_no, r.po_date, r.received_qty, r.received_on]),
    cf: [{ sqref: `Q5:Q${4 + n}`, formula: (r) => `Q${r}="Late"`, tone: 'bad' }, { sqref: `L5:L${4 + n}`, formula: (r) => `L${r}="Received"`, tone: 'ok' }],
  });
}

function paymentPlan(d) {
  const n = d.pay.length + 40;
  return X.table({
    name: SH.pay, title: 'Payment plan (weekly)', subtitle: 'Payments to make each week. Pay Must pay items first: salaries, statutory dues, critical suppliers.', tabColor: 'navy', blankRows: 40,
    columns: [
      { label: 'Pay on', fmt: 'date', width: 12, input: true },
      { label: 'Week', fmt: 'date', width: 11, formula: (r) => weekOfF('A', r) },
      { label: 'Pay to', width: 26, input: true }, { label: 'Category', width: 19, source: list('Payment category'), input: true },
      { label: 'Bill no', width: 12, input: true }, { label: 'Bill date', fmt: 'date', width: 11, input: true }, { label: 'Bill due', fmt: 'date', width: 11, input: true },
      { label: 'Amount (₹)', fmt: 'money', width: 13, total: true, input: true },
      { label: 'Priority', width: 10, source: list('Priority'), input: true }, { label: 'Mode', width: 12, source: list('Pay mode'), input: true },
      { label: 'Status', width: 10, source: list('Payment status'), input: true }, { label: 'Approved by', width: 13, input: true },
      { label: 'Paid on', fmt: 'date', width: 11, input: true }, { label: 'Paid (₹)', fmt: 'money', width: 12, total: true, input: true },
      { label: 'Balance (₹)', fmt: 'money', width: 12, total: true, formula: (r) => `IF(H${r}="","",IF(OR(K${r}="Cancelled",K${r}="Deferred"),0,H${r}-N(N${r})))` },
      { label: 'UTR / cheque no', width: 16, input: true },
    ],
    rows: d.pay.map((r) => [r.plan_date, null, r.payee, r.category, r.bill_no, r.bill_date, r.due_on, r.amount, r.priority, r.mode, r.status, r.approved_name, r.paid_on, r.paid_amount, null, r.reference]),
    cf: [
      { sqref: `I5:I${4 + n}`, formula: (r) => `I${r}="Must pay"`, tone: 'warn' },
      { sqref: `K5:K${4 + n}`, formula: (r) => `K${r}="Paid"`, tone: 'ok' },
      { sqref: `A5:A${4 + n}`, formula: (r) => `AND(A${r}<>"",A${r}<TODAY(),OR(K${r}="Planned",K${r}="Approved"))`, tone: 'bad' },
    ],
  });
}

function pettyCash(d) {
  const n = d.petty.length + 40;
  return X.table({
    name: SH.petty, title: 'Petty cash plan (Cash / UPI)', subtitle: 'Small payments planned and paid in cash or by UPI, and cash put into the box. Only cash payments reduce the cash in the box.', tabColor: 'navy', blankRows: 40,
    columns: [
      { label: 'Date', fmt: 'date', width: 12, input: true },
      { label: 'Week', fmt: 'date', width: 11, formula: (r) => weekOfF('A', r) },
      { label: 'Entry', width: 12, source: list('Petty entry'), input: true }, { label: 'Head', width: 19, source: list('Petty head'), input: true },
      { label: 'What for', width: 30, input: true }, { label: 'Paid to', width: 18, input: true }, { label: 'Paid by', width: 8, source: list('Paid by'), input: true },
      { label: 'Planned (₹)', fmt: 'money', width: 11, total: true, input: true }, { label: 'Paid (₹)', fmt: 'money', width: 11, total: true, input: true },
      { label: 'Status', width: 10, source: list('Petty status'), input: true }, { label: 'Voucher no', width: 10, input: true }, { label: 'UPI reference', width: 16, input: true },
      { label: 'Approved by', width: 13, input: true },
      { label: 'Cash in box after (₹)', fmt: 'money', width: 13, formula: (r) => `IF(A${r}="","",SUMIFS($I$5:I${r},$J$5:J${r},"Paid",$C$5:C${r},"Cash top-up")-SUMIFS($I$5:I${r},$J$5:J${r},"Paid",$C$5:C${r},"Expense",$G$5:G${r},"Cash"))` },
    ],
    rows: d.petty.map((r) => [r.plan_date, null, r.entry_type, r.head, r.description, r.paid_to, r.mode, r.planned_amount, r.amount, r.status, r.voucher_no, r.upi_ref, r.approved_name]),
    note: 'Keep the rows in date order so the running cash balance is right. A UPI payment marked Paid needs its UPI reference.',
    cf: [
      { sqref: `C5:C${4 + n}`, formula: (r) => `C${r}="Cash top-up"`, tone: 'ok' },
      { sqref: `N5:N${4 + n}`, formula: (r) => `AND(N${r}<>"",N${r}<0)`, tone: 'bad' },
      { sqref: `L5:L${4 + n}`, formula: (r) => `AND(G${r}="UPI",J${r}="Paid",C${r}="Expense",L${r}="")`, tone: 'warn' },
    ],
  });
}

function suppliersSheet(d) {
  return X.table({
    name: SH.sup, title: 'Suppliers', subtitle: 'Used by the drop-downs in the purchase plan.', tabColor: 'navy', blankRows: 30,
    columns: [
      { label: 'Supplier name', width: 28, input: true }, { label: 'Supplies', width: 20, source: list('Supplier category'), input: true },
      { label: 'Contact person', width: 18, input: true }, { label: 'Mobile', width: 16, input: true }, { label: 'Email', width: 32, input: true },
      { label: 'GSTIN', width: 18, input: true }, { label: 'Credit days', fmt: 'int', width: 9, input: true }, { label: 'City', width: 14, input: true },
      { label: 'Planned to pay (₹)', fmt: 'money', width: 14, total: true, formula: (r) => `IF(A${r}="","",SUMIFS(${colRef(SH.pay, 'H')},${colRef(SH.pay, 'C')},A${r},${colRef(SH.pay, 'K')},"Planned")+SUMIFS(${colRef(SH.pay, 'H')},${colRef(SH.pay, 'C')},A${r},${colRef(SH.pay, 'K')},"Approved"))` },
    ],
    rows: d.suppliers.map((s) => [s.name, s.category, s.contact_person, s.mobile, s.email, s.gstin, s.payment_terms_days, s.city]),
  });
}

function listsSheet() {
  const height = Math.max(...LISTS.map((l) => l[1].length)) + 1;
  const rows = [];
  for (let r = 0; r < height; r++) rows.push(LISTS.map(([name, vals]) => (r === 0 ? { v: name, st: { bold: true } } : vals[r - 1] ?? null)));
  return { name: SH.lists, hidden: true, rows, cols: LISTS.map(() => 22) };
}

function main() {
  const d = demoData();
  fs.mkdirSync(OUT, { recursive: true });
  const cards = d.assets.map((a) => pmCard(a.code));
  const sheets = [
    readMe(d), weekSummary(), salesPlan(d), productionPlan(d), register(d), pmCalendar(d), pmPlan(d),
    purchasePlan(d), paymentPlan(d), pettyCash(d), suppliersSheet(d), ...cards, listsSheet(),
  ];
  const template = path.join(OUT, 'SEI Weekly Planning Template.xlsx');
  fs.writeFileSync(template, X.build(sheets));
  const week = path.join(OUT, 'SEI Weekly Plan - demo week.xlsx');
  fs.writeFileSync(week, d.week);
  console.log(`Wrote ${template} (${sheets.length} sheets, ${cards.length} PM cards)`);
  console.log(`Wrote ${week} (the CRM's "Download week as Excel" for the demo week of ${F.weekLabel(d.ws)})`);
}

main();
