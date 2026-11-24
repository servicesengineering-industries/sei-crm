'use strict';
// The Week planner: one page for the week's sales, production, PM, purchase, payment and petty
// cash plans, plus "Plan PM for the week", the week's Excel download and the PM "Done" button.
const { html } = require('../html');
const F = require('../format');
const C = require('../cells');
const UI = require('../ui');
const { MODULES, PM_OPEN, PURCHASE_OPEN, PAY_OPEN } = require('../modules');
const { canEdit } = require('../auth');
const { requireEdit } = require('../crud');
const { HttpError, safeReturn } = require('../http');
const { planPmWeek, loadWeek, weekWorkbook } = require('../planning');

const weekParam = (v) => (F.isIsoDate(v) ? F.weekOf(v) : F.weekOf(F.today()));
const MAX_PER_CELL = 6;

// One cell of the day board: a short list with "+ n more".
function dayCell(items, href) {
  if (!items.length) return html`<span class="dim">—</span>`;
  const shown = items.slice(0, MAX_PER_CELL);
  return html`<ul class="day-list">${shown}</ul>${items.length > shown.length ? html`<a class="day-more" href="${href}">+ ${items.length - shown.length} more</a>` : ''}`;
}

function board(w) {
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => F.addDays(w.ws, i));
  const onDay = (rows, k, d) => rows.filter((r) => r[k] === d);
  const sundayUsed = [w.pm, w.production, w.purchase, w.payments, w.petty].some((rows) => rows.some((r) => [r.planned_on, r.plan_date, r.required_by].includes(days[6])))
    || w.sales.some((r) => r.dispatch_on === days[6]);
  const shownDays = sundayUsed ? days : days.slice(0, 6);
  const t = F.today();
  const q = `?view=all&week=${w.ws}`;
  const back = `?return=${encodeURIComponent(`/planning?week=${w.ws}`)}`;
  const li = (tone, body, href) => html`<li class="day-i tone-l-${tone}"><a href="${href}">${body}</a></li>`;
  const rows = [
    {
      label: 'Preventive maintenance', href: `/pm_tasks${q}`,
      cell: (d) => onDay(w.pm, 'planned_on', d).map((r) => li(r.status === 'Done' ? 'ok' : r.status === 'Missed' || (PM_OPEN.includes(r.status) && r.planned_on < t) ? 'bad' : r.status === 'Cancelled' ? 'muted' : 'info',
        html`<b>${r.asset_code}</b> ${C.clip(r.asset_name, 22)}<span class="sub">${r.status}</span>`, `/pm_tasks/${r.id}/edit${back}`)),
    },
    {
      label: 'Production', href: `/production_plans${q}`,
      cell: (d) => onDay(w.production, 'plan_date', d).map((r) => li(r.status === 'Done' ? 'ok' : r.status === 'Short' || r.pm_clash || r.asset_status === 'Breakdown' ? 'bad' : 'info',
        html`<b>${r.asset_code || 'No machine'}</b> ${C.clip(r.part_name, 22)}<span class="sub">${F.num(r.planned_qty)} pcs${r.produced_qty != null ? ` · made ${F.num(r.produced_qty)}` : ''}${r.pm_clash ? ' · PM same day' : ''}</span>`, `/production_plans/${r.id}/edit${back}`)),
    },
    {
      label: 'Dispatch plan', href: `/sales_plans${q}`,
      cell: (d) => onDay(w.sales, 'dispatch_on', d).map((r) => li(r.actual_qty >= r.planned_qty ? 'ok' : d < t ? 'bad' : 'info',
        html`<b>${C.clip(r.client_name, 18)}</b> ${C.clip(r.part_name, 20)}<span class="sub">${F.num(r.planned_qty)} pcs · sent ${F.num(r.actual_qty)}</span>`, `/sales_plans/${r.id}/edit${back}`)),
    },
    {
      label: 'Material due in', href: `/purchase_plans${q}`,
      cell: (d) => onDay(w.purchase, 'required_by', d).map((r) => li(r.status === 'Received' ? 'ok' : PURCHASE_OPEN.includes(r.status) && d < t ? 'bad' : r.status === 'Cancelled' ? 'muted' : 'info',
        html`<b>${C.clip(r.item, 24)}</b><span class="sub">${F.num(r.qty)} ${r.unit || ''} · ${r.status}</span>`, `/purchase_plans/${r.id}/edit${back}`)),
    },
    {
      label: 'Payments out', href: `/payment_plans${q}`,
      cell: (d) => onDay(w.payments, 'plan_date', d).map((r) => li(r.status === 'Paid' ? 'ok' : PAY_OPEN.includes(r.status) && d < t ? 'bad' : r.priority === 'Must pay' ? 'warn' : 'info',
        html`<b>${C.clip(r.payee, 22)}</b><span class="sub">${F.money(r.amount)} · ${r.status}</span>`, `/payment_plans/${r.id}/edit${back}`)),
    },
    {
      label: 'Petty cash', href: `/petty_cash${q}`,
      cell: (d) => onDay(w.petty, 'plan_date', d).map((r) => li(r.entry_type === 'Cash top-up' ? 'ok' : r.status === 'Paid' ? 'muted' : 'info',
        html`<b>${C.clip(r.description, 22)}</b><span class="sub">${F.money(r.amount ?? r.planned_amount)} · ${r.mode} · ${r.status}</span>`, `/petty_cash/${r.id}/edit${back}`)),
    },
  ];
  const undated = w.sales.filter((r) => !r.dispatch_on).length;
  return html`<div class="table-wrap"><table class="grid board">
<thead><tr><th scope="col">Plan</th>${shownDays.map((d) => html`<th scope="col" class="${d === t ? 'is-today' : ''}">${F.dayName(d).slice(0, 3)} <span class="num">${Number(d.slice(8))}</span>${d === t ? html`<span class="sub">today</span>` : ''}</th>`)}</tr></thead>
<tbody>${rows.map((row) => html`<tr><th scope="row"><a href="${row.href}">${row.label}</a>${row.label === 'Dispatch plan' && undated ? html`<span class="sub">${F.plural(undated, 'line')} with no day set</span>` : ''}</th>${shownDays.map((d) => html`<td class="${d === t ? 'is-today' : ''}">${dayCell(row.cell(d), row.href)}</td>`)}</tr>`)}</tbody>
</table></div>`;
}

function plannerPage(ctx) {
  const ws = weekParam(ctx.query.week);
  const w = loadWeek(ctx.db, ws);
  const T = w.totals;
  const thisWeek = F.weekOf(F.today());
  const prev = F.addDays(ws, -7);
  const next = F.addDays(ws, 7);
  const q = `?view=all&week=${ws}`;
  const ret = encodeURIComponent(`/planning?week=${ws}`);
  const pctOf = (a, b) => (b > 0 ? `${F.pct(a, b)}%` : '—');
  // Colour plan-vs-actual only for finished weeks; the current week is still in progress.
  const toneOf = (a, b) => (b <= 0 || ws > thisWeek ? '' : a >= b ? 'ok' : ws === thisWeek ? '' : a >= 0.8 * b ? 'warn' : 'bad');

  const tiles = html`<div class="tiles">
${UI.tile({ label: 'Sales dispatched', value: pctOf(T.salesActVal, T.salesPlanVal), sub: T.salesPlanVal ? `${F.moneyShort(T.salesActVal) || '₹0'} of ${F.moneyShort(T.salesPlanVal)} planned` : 'No sales plan for this week', tone: toneOf(T.salesActVal, T.salesPlanVal), href: `/sales_plans${q}` })}
${UI.tile({ label: 'Production made', value: pctOf(T.prodMade, T.prodPlan), sub: T.prodPlan ? `${F.num(T.prodMade)} of ${F.num(T.prodPlan)} pcs${T.prodShort ? ` · ${T.prodShort} short` : ''}` : 'No production plan yet', tone: toneOf(T.prodMade, T.prodPlan), href: `/production_plans${q}` })}
${UI.tile({ label: 'PM done', value: `${T.pmDone} / ${T.pmPlanned}`, sub: T.pmOverdue ? `${T.pmOverdue} overdue` : T.pmPlanned ? 'None overdue' : 'Nothing planned yet', tone: T.pmOverdue ? 'bad' : T.pmPlanned && T.pmDone === T.pmPlanned ? 'ok' : '', href: `/pm_tasks${q}` })}
${UI.tile({ label: 'Purchases', value: F.moneyShort(T.buyValue) || '₹0', sub: `${w.purchase.length} lines · ${T.buyReceived} received${T.buyLate ? ` · ${T.buyLate} late` : ''}`, tone: T.buyLate ? 'bad' : '', href: `/purchase_plans${q}` })}
${UI.tile({ label: 'Payments to make', value: F.moneyShort(T.payOpen) || '₹0', sub: `${F.moneyShort(T.payPaid) || '₹0'} paid · ${F.moneyShort(T.inDue) || '₹0'} due in from clients`, tone: T.payCarried ? 'bad' : T.payMust ? 'warn' : '', href: `/payment_plans${q}` })}
${UI.tile({ label: 'Petty cash', value: F.money(T.pettyPlanned), sub: `Cash ${F.money(T.pettyCash)} · UPI ${F.money(T.pettyUpi)} paid · ${F.money(T.cashBox)} in box`, tone: T.cashBox < 0 ? 'bad' : '', href: `/petty_cash${q}` })}
</div>`;

  const warnings = [];
  for (const r of w.conflicts) {
    warnings.push(html`<li><b>${r.asset_code}</b> has production of ${r.part_name} on ${F.dayName(r.plan_date)} ${F.fmtDate(r.plan_date)}, but ${r.asset_status === 'Breakdown' ? 'is under breakdown' : 'has PM planned that day'}. <a href="/production_plans/${r.id}/edit?return=${ret}">Move the production</a></li>`);
  }
  if (w.pmCarried.length) warnings.push(html`<li>${F.plural(w.pmCarried.length, 'PM task')} from earlier weeks still open: ${w.pmCarried.slice(0, 6).map((r) => r.asset_code).join(', ')}${w.pmCarried.length > 6 ? '…' : ''}. <a href="/pm_tasks?view=overdue">See overdue PM</a></li>`);
  if (w.purchaseCarried.length) warnings.push(html`<li>${F.plural(w.purchaseCarried.length, 'purchase')} from earlier weeks not received yet. <a href="/purchase_plans?view=late">See late purchases</a></li>`);
  if (w.payCarried.length) warnings.push(html`<li>${F.money(T.payCarried)} of payments from earlier weeks not made yet. <a href="/payment_plans?view=overdue">See them</a></li>`);
  for (const a of w.breakdowns) warnings.push(html`<li><b>${a.code}</b> ${a.name} is under breakdown. <a href="/assets/${a.id}/edit">Open it</a></li>`);

  const canPm = canEdit(ctx.user, MODULES.pm_tasks);
  const pmButton = canPm
    ? html`<form method="post" action="/planning/pm" class="inline">${C.csrf(ctx)}<input type="hidden" name="week" value="${ws}"><button class="btn btn-primary" type="submit">Plan PM for this week</button></form>`
    : '';
  const actions = html`<a class="btn" href="/planning.xlsx?week=${ws}">Download week as Excel</a>${pmButton}`;
  const nav = html`<nav class="chips week-nav" aria-label="Weeks">
<a class="chip" href="/planning?week=${prev}">← ${F.weekLabel(prev)}</a>
<a class="chip${ws === thisWeek ? ' is-active' : ''}" href="/planning">This week</a>
<a class="chip" href="/planning?week=${next}">${F.weekLabel(next)} →</a>
<form class="inline week-go" method="get" action="/planning"><input type="date" name="week" value="${ws}" aria-label="Go to the week of"><button class="btn btn-sm" type="submit">Go</button></form>
</nav>`;

  const stillPetty = T.pettyOpen;
  const cashRows = [
    ['Client payments due this week', T.inDue, ''],
    ['Payments planned this week, still to pay', -T.payOpen, ''],
    ['Unpaid from earlier weeks', -T.payCarried, T.payCarried > 0.5 ? 'bad' : ''],
    ['Petty cash still to spend', -stillPetty, ''],
  ];
  const net = T.inDue - T.payOpen - T.payCarried - stillPetty;
  const signed = (v) => (v < 0 ? `− ${F.money(-v)}` : F.money(v));
  const cashCard = html`<table class="aging"><tbody>${cashRows.map(([l, v, tone]) => html`<tr><td>${tone ? html`<span class="tone-text-${tone}">${l}</span>` : l}</td><td>${signed(v)}</td></tr>`)}
<tr class="aging-total"><td>Net for the week if clients pay on time</td><td class="${net < 0 ? 'tone-text-bad' : 'tone-text-ok'}">${signed(net)}</td></tr></tbody></table>
<p class="help">Must-pay items: ${F.money(T.payMust)}. This does not count client money that is already overdue (${F.money(T.inOverdue)}).</p>`;

  const salesTable = UI.table([
    { label: 'Client', render: (r) => C.client(r) },
    { label: 'Part', render: (r, c) => C.edit('sales_plans', r, r.part_name, r.po_no ? `PO ${r.po_no}` : null, c) },
    { label: 'Planned', cls: 'r', render: (r) => C.int(r.planned_qty) },
    { label: 'Dispatched', cls: 'r', render: (r) => C.int(r.actual_qty) },
    { label: 'Plan value', cls: 'r', render: (r) => C.money(r.planned_value) },
  ], w.sales.slice(0, 10), { ctx, empty: 'No sales plan lines for this week.' });

  const pmList = w.pm.length
    ? html`<ul class="list">${w.pm.slice(0, 12).map((r) => html`<li><div class="grow"><a class="who" href="/pm_tasks/${r.id}/edit?return=${ret}">${r.asset_code} – ${r.asset_name}</a>
<span class="sub">${F.dayName(r.planned_on)} ${F.fmtDate(r.planned_on)}${r.assigned_name ? ` · ${r.assigned_name}` : ''}</span></div>${C.badge(r.status)}${PM_OPEN.includes(r.status) && canPm ? C.actionButton(`/pm_tasks/${r.id}/done`, 'Done', ctx, {}, `PM of ${r.asset_code} ${r.asset_name}`) : ''}</li>`)}</ul>${w.pm.length > 12 ? html`<p class="help"><a href="/pm_tasks${q}">All ${w.pm.length} PM tasks</a></p>` : ''}`
    : html`<p class="dim">No PM planned for this week yet.${canPm ? ' Use “Plan PM for this week” to plan every machine and tool that falls due.' : ''}</p>`;

  const body = html`
${UI.pageHeader('Week planner', html`Week of <b>${F.weekLabel(ws)}</b>${ws === thisWeek ? ' · this week' : ws < thisWeek ? ' · past week' : ' · coming week'}`, actions)}
${nav}
${tiles}
${warnings.length ? html`<div class="alert alert-error plan-warn" role="status"><b>Needs attention</b><ul>${warnings}</ul></div>` : ''}
<section class="card"><div class="card-h"><h2>Day by day</h2><span class="dim">Click an item to open it</span></div>${board(w)}</section>
<div class="cols-even">
  <section class="card"><div class="card-h"><h2>Preventive maintenance</h2><a href="/pm_tasks${q}">All PM this week</a></div><div class="card-b">${pmList}</div></section>
  <section class="card"><div class="card-h"><h2>Cash this week</h2><a href="/payment_plans${q}">Payment plan</a></div><div class="card-b">${cashCard}</div></section>
</div>
<section class="card"><div class="card-h"><h2>Sales plan</h2><a href="/sales_plans${q}">All ${F.plural(w.sales.length, 'line')}</a></div>${salesTable}</section>`;
  ctx.page('Week planner', body, { active: 'planning' });
}

function register(router) {
  router.on('GET', '/planning', plannerPage);

  router.on('POST', '/planning/pm', (ctx) => {
    requireEdit(ctx, MODULES.pm_tasks);
    const ws = weekParam(ctx.body.week);
    const added = planPmWeek(ctx.db, ws, { userId: ctx.user.id, audit: ctx.audit });
    ctx.flash('ok', added.length
      ? `Planned PM for ${F.plural(added.length, 'machine or tool', 'machines and tools')} in the week of ${F.weekLabel(ws)}.`
      : `Nothing more falls due in the week of ${F.weekLabel(ws)}. Every machine and tool is already planned or not yet due.`);
    ctx.redirect(`/planning?week=${ws}`);
  });

  router.on('GET', '/planning.xlsx', (ctx) => {
    const ws = weekParam(ctx.query.week);
    const buf = weekWorkbook(ctx.db, ws, { company: ctx.cfg.companyName });
    ctx.send(200, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', {
      'Content-Disposition': `attachment; filename="sei-weekly-plan-${ws}.xlsx"`,
    });
  });

  // One click from a list or the planner: done today.
  router.on('POST', '/pm_tasks/:id/done', (ctx) => {
    requireEdit(ctx, MODULES.pm_tasks);
    const id = Number(ctx.params.id);
    const r = ctx.db.get('SELECT p.*, a.code, a.name FROM pm_tasks p JOIN assets a ON a.id = p.asset_id WHERE p.id = :id', { id });
    if (!r) throw new HttpError(404, "That PM task doesn't exist. It may have been deleted.");
    if (PM_OPEN.includes(r.status)) {
      ctx.db.tx(() => {
        ctx.db.run("UPDATE pm_tasks SET status = 'Done', done_on = :d, updated_at = datetime('now') WHERE id = :id", { d: F.today(), id });
        ctx.audit({ entity: 'pm_tasks', entityId: id, action: 'updated', summary: `marked PM for ${r.code} – ${r.name} done` });
      });
      ctx.flash('ok', `PM for ${r.code} marked done. Open it to add findings, spares and downtime.`);
    }
    ctx.redirect(safeReturn(ctx.body.return, '/pm_tasks'));
  });
}

module.exports = { register };
