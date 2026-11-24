'use strict';
const { html } = require('../html');
const F = require('../format');
const C = require('../cells');
const UI = require('../ui');
const { MODULES, RFQ_OPEN, JOB_OPEN, PM_OPEN, PURCHASE_OPEN, sqlIn } = require('../modules');
const { canEdit, isAdmin } = require('../auth');
const { dateParams } = require('../crud');
const { clientSummaries, byAttention } = require('./clients');

// Who sees which half of the dashboard: the money-and-clients side, the shop-floor side, or both (admins).
const COMMERCIAL_ROLES = ['admin', 'sales', 'accounts', 'viewer'];
const COMMERCIAL_DEPTS = ['Management', 'Sales', 'Accounts'];
const PLANT_ROLES = ['admin', 'production', 'purchase', 'quality'];
const PLANT_DEPTS = ['Production', 'Maintenance', 'Tool room', 'Quality', 'Purchase & stores', 'Dispatch & logistics'];
function sides(u) {
  const plant = PLANT_ROLES.includes(u.role) || PLANT_DEPTS.includes(u.department);
  const commercial = COMMERCIAL_ROLES.includes(u.role) && !(u.role === 'viewer' && plant) || COMMERCIAL_DEPTS.includes(u.department);
  return { commercial: commercial || !plant, plant };
}

// "Your day": what is waiting on this person today, across checklists, sign-offs, jobs, follow-ups and compliance.
function yourDay(ctx, { commercial, fu }) {
  const db = ctx.db;
  const u = ctx.user;
  const t = F.today();
  const admin = isAdmin(u);
  const p = { me: u.id, dept: u.department || '', t, from: F.addDays(t, -14), head: u.is_head ? 1 : 0, all: admin || u.role === 'accounts' ? 1 : 0 };
  const mine = '(IFNULL(assignee_id, 0) = :me OR (assignee_id IS NULL AND department = :dept))';
  const runs = db.get(`SELECT COUNT(CASE WHEN due_on = :t AND status IN ('Open', 'Returned') THEN 1 END) AS todo,
                              COUNT(CASE WHEN due_on < :t AND status IN ('Open', 'Returned') THEN 1 END) AS missed,
                              COUNT(CASE WHEN due_on = :t AND status IN ('Submitted', 'Approved', 'Done') THEN 1 END) AS done
                       FROM checklist_runs WHERE due_on BETWEEN :from AND :t AND ${mine}`, p);
  const jobs = db.get(`SELECT COUNT(*) AS open, COUNT(CASE WHEN due_on < :t THEN 1 END) AS overdue, COUNT(CASE WHEN due_on = :t THEN 1 END) AS today
                       FROM jobs WHERE assigned_to = :me AND status IN (${sqlIn(JOB_OPEN)})`, p);
  const comp = db.get(`SELECT COUNT(*) AS n, COUNT(CASE WHEN due_on < :t THEN 1 END) AS overdue FROM compliance_items
                       WHERE active = 1 AND date(due_on, '-' || remind_days || ' days') <= :t
                         AND (:all = 1 OR owner_id = :me OR (:head = 1 AND department = :dept))`, p);
  const approvals = UI.navCounts(ctx).approvals;

  const rows = [{
    key: 'my-checklists', href: '/my-checklists', label: 'Checklists',
    text: runs.todo ? `${runs.todo} to fill in today` : runs.done ? 'All filled in for today' : 'Nothing due today',
    sub: [runs.missed ? `${runs.missed} missed` : '', runs.done && runs.todo ? `${runs.done} done` : ''].filter(Boolean).join(' · '),
    tone: runs.missed ? 'bad' : runs.todo ? 'warn' : 'ok',
  }];
  if (approvals || admin || u.is_head) {
    rows.push({ key: 'approvals', href: '/approvals', label: 'Sign-offs', text: approvals ? `${approvals} waiting for you` : 'Nothing waiting', tone: approvals ? 'warn' : 'ok' });
  }
  rows.push({
    key: 'jobs', href: '/jobs', label: 'Jobs', text: jobs.open ? F.plural(jobs.open, 'open job') : 'No open jobs',
    sub: [jobs.overdue ? `${jobs.overdue} overdue` : '', jobs.today ? `${jobs.today} due today` : ''].filter(Boolean).join(' · '),
    tone: jobs.overdue ? 'bad' : jobs.today ? 'warn' : 'ok',
  });
  if (commercial || fu.overdue + fu.today) {
    rows.push({
      key: 'followups', href: '/followups?view=open&assigned_to=me', label: 'Follow-ups',
      text: fu.overdue + fu.today ? `${fu.overdue + fu.today} due` : 'Nothing due today',
      sub: [fu.overdue ? `${fu.overdue} overdue` : '', fu.today ? `${fu.today} today` : ''].filter(Boolean).join(' · '),
      tone: fu.overdue ? 'bad' : fu.today ? 'warn' : 'ok',
    });
  }
  if (comp.n || p.all || u.is_head) {
    rows.push({
      key: 'compliance_items', href: '/compliance_items?view=due', label: 'Compliance',
      text: comp.overdue ? `${comp.overdue} overdue` : comp.n ? `${comp.n} due soon` : 'Nothing due soon',
      sub: comp.overdue && comp.n > comp.overdue ? `${comp.n - comp.overdue} more due soon` : '',
      tone: comp.overdue ? 'bad' : comp.n ? 'warn' : 'ok',
    });
  }
  return html`<section class="card today" aria-labelledby="today-h"><div class="card-h"><h2 id="today-h">Your day</h2></div>
<ul class="today-list">${rows.map((r) => html`<li><a class="today-item" data-tone="${r.tone}" href="${r.href}"><span class="today-ico">${UI.icon(r.key)}</span><span class="today-text"><span class="today-label">${r.label}</span><b>${r.text}</b>${r.sub ? html`<span class="today-sub">${r.sub}</span>` : ''}</span></a></li>`)}</ul></section>`;
}

// The shop floor today: production plan, PM due and breakdowns, material due.
function plantCard(ctx) {
  const db = ctx.db;
  const p = dateParams();
  const prod = db.all(`SELECT pp.*, a.code AS asset_code, c.name AS client_name FROM production_plans pp
                       LEFT JOIN assets a ON a.id = pp.asset_id LEFT JOIN clients c ON c.id = pp.client_id
                       WHERE pp.plan_date = :t ORDER BY pp.shift, a.code, pp.id LIMIT 12`, p);
  const pm = db.all(`SELECT k.*, a.code AS asset_code, a.name AS asset_name FROM pm_tasks k JOIN assets a ON a.id = k.asset_id
                     WHERE k.status IN (${sqlIn(PM_OPEN)}) AND k.planned_on <= :t ORDER BY k.planned_on, a.code LIMIT 8`, p);
  const down = db.all("SELECT id, code, name FROM assets WHERE status = 'Breakdown' ORDER BY code");
  const material = db.all(`SELECT pp.*, s.name AS supplier_name FROM purchase_plans pp LEFT JOIN suppliers s ON s.id = pp.supplier_id
                           WHERE pp.status IN (${sqlIn(PURCHASE_OPEN)}) AND pp.required_by <= :tp3 ORDER BY pp.required_by LIMIT 6`, p);
  const prodTable = UI.table([
    { label: 'Machine', render: (r) => html`<a class="rowlink" href="/production_plans/${r.id}/edit?return=%2F">${r.asset_code || 'No machine'}</a><span class="sub">${[r.shift, r.operation].filter(Boolean).join(' · ')}</span>` },
    { label: 'Part', render: (r) => html`${r.part_name}${r.client_name ? html`<span class="sub">${r.client_name}</span>` : ''}` },
    { label: 'Plan', cls: 'r', render: (r) => C.int(r.planned_qty) },
    { label: 'Made', cls: 'r', render: (r) => C.int(r.produced_qty) },
    { label: 'Status', render: (r) => C.badge(r.status) },
  ], prod, { ctx, empty: 'No production planned for today.' });
  const pmList = pm.length
    ? html`<ul class="list">${pm.map((k) => html`<li><div class="grow"><a class="who" href="/pm_tasks/${k.id}/edit?return=%2F">${k.asset_code} ${k.asset_name}</a><span class="sub">${C.due(k.planned_on, true)}</span></div>${canEdit(ctx.user, MODULES.pm_tasks) ? C.actionButton(`/pm_tasks/${k.id}/done`, 'Done', ctx, {}, `PM of ${k.asset_code} ${k.asset_name}`) : ''}</li>`)}</ul>`
    : html`<p class="dim">No PM due today or overdue.</p>`;
  const downList = down.length
    ? html`<div class="flags">${down.map((a) => html`<a class="flag tone-bad" href="/assets/${a.id}/edit">${a.code} ${a.name}</a>`)}</div>`
    : html`<p class="dim">Every machine is running.</p>`;
  const matList = material.length
    ? html`<ul class="list">${material.map((m) => html`<li><div class="grow"><a class="who" href="/purchase_plans/${m.id}/edit?return=%2F">${m.item}</a><span class="sub">${C.due(m.required_by, true)}</span>${m.supplier_name ? html`<span class="sub">${m.supplier_name}</span>` : ''}</div>${C.badge(m.status)}</li>`)}</ul>`
    : html`<p class="dim">No material due in the next 3 days.</p>`;
  return html`<section class="card"><div class="card-h"><h2>Plant today</h2><a href="/planning">Week planner</a></div>${prodTable}
<div class="card-b plant-grid">
  <div><h3 class="section-title mini">Preventive maintenance due</h3>${pmList}</div>
  <div><h3 class="section-title mini">Under breakdown</h3>${downList}<h3 class="section-title mini">Material due</h3>${matList}</div>
</div></section>`;
}

function greeting(ctx) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: ctx.cfg.timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${ctx.user.name.split(' ')[0]}`;
}

function dashboard(ctx) {
  const db = ctx.db;
  const p = dateParams();
  const me = ctx.user.id;
  const side = sides(ctx.user);
  const fuCounts = db.get(`SELECT COUNT(CASE WHEN due_on < :t THEN 1 END) AS overdue, COUNT(CASE WHEN due_on = :t THEN 1 END) AS today
                           FROM followups WHERE status = 'Open' AND assigned_to = :me`, { ...p, me });
  if (!side.commercial) return plantDashboard(ctx, fuCounts);

  const recv = db.get(`SELECT COALESCE(SUM(balance), 0) AS total,
                              COALESCE(SUM(CASE WHEN due_on < :t THEN balance END), 0) AS overdue,
                              COUNT(CASE WHEN due_on < :t THEN 1 END) AS overdue_n
                       FROM v_invoices WHERE balance > 0.5`, p);
  const late = db.get("SELECT COUNT(*) AS n, COALESCE(SUM(pending), 0) AS qty FROM v_orders WHERE status = 'Open' AND pending > 0 AND due_on < :t", p);
  const week = db.get("SELECT COUNT(*) AS n FROM v_orders WHERE status = 'Open' AND pending > 0 AND due_on BETWEEN :t AND :tp7", p);
  const rfq = db.get(`SELECT COUNT(CASE WHEN status IN (${sqlIn(RFQ_OPEN)}) THEN 1 END) AS open,
                             COUNT(CASE WHEN status IN ('Quoted', 'Negotiation') AND quoted_on <= :tm14 THEN 1 END) AS chase,
                             COUNT(CASE WHEN status IN ('New', 'Costing') AND quote_due_on <= :tp3 THEN 1 END) AS due
                      FROM rfqs`, p);
  const cmp = db.get(`SELECT COUNT(*) AS open, COUNT(CASE WHEN severity = 'Critical' THEN 1 END) AS critical,
                             COUNT(CASE WHEN target_on < :t THEN 1 END) AS overdue
                      FROM complaints WHERE status <> 'Closed'`, p);

  const summaries = clientSummaries(ctx);
  const attention = summaries.filter((c) => c.score >= 1 && c.status !== 'Lost').sort(byAttention).slice(0, 8);
  const quiet = summaries.filter((c) => c.status === 'Active' && !c.last_contact).length;

  const myFollowups = db.all(`SELECT f.*, c.name AS client_name, ct.name AS contact_name, ct.mobile AS contact_mobile
                              FROM followups f JOIN clients c ON c.id = f.client_id LEFT JOIN contacts ct ON ct.id = f.contact_id
                              WHERE f.status = 'Open' AND f.assigned_to = :me AND f.due_on <= :tp7
                              ORDER BY f.due_on, f.id LIMIT 12`, { ...p, me });
  const aging = db.get(`SELECT
      COALESCE(SUM(CASE WHEN due_on IS NULL OR due_on >= :t THEN balance END), 0) AS current,
      COALESCE(SUM(CASE WHEN due_on < :t AND due_on >= :tm30 THEN balance END), 0) AS d30,
      COALESCE(SUM(CASE WHEN due_on < :tm30 AND due_on >= :tm60 THEN balance END), 0) AS d60,
      COALESCE(SUM(CASE WHEN due_on < :tm60 AND due_on >= :tm90 THEN balance END), 0) AS d90,
      COALESCE(SUM(CASE WHEN due_on < :tm90 THEN balance END), 0) AS d90p
    FROM v_invoices WHERE balance > 0.5`, p);
  const debtors = db.all(`SELECT c.id, c.name, SUM(i.balance) AS owed, SUM(CASE WHEN i.due_on < :t THEN i.balance ELSE 0 END) AS overdue
                          FROM v_invoices i JOIN clients c ON c.id = i.client_id WHERE i.balance > 0.5
                          GROUP BY c.id ORDER BY owed DESC LIMIT 5`, p);
  const recent = db.all(`SELECT a.*, c.name AS client_name, u.name AS user_name, ct.name AS contact_name
                         FROM activities a JOIN clients c ON c.id = a.client_id
                         LEFT JOIN users u ON u.id = a.user_id LEFT JOIN contacts ct ON ct.id = a.contact_id
                         ORDER BY a.occurred_on DESC, a.id DESC LIMIT 8`);

  const tiles = html`<div class="tiles">
${UI.tile({ label: 'Overdue payments', value: F.moneyShort(recv.overdue), sub: recv.overdue_n ? `${F.plural(recv.overdue_n, 'invoice')} · ${F.moneyShort(recv.total)} outstanding in all` : `${F.moneyShort(recv.total)} outstanding, none overdue`, tone: recv.overdue > 0.5 ? 'bad' : 'ok', href: '/invoices?view=overdue' })}
${UI.tile({ label: 'Late deliveries', value: late.n, sub: late.n ? `${F.num(late.qty)} pcs past due · ${week.n} more due this week` : `${F.plural(week.n, 'PO')} due this week`, tone: late.n ? 'bad' : 'ok', href: late.n ? '/orders?view=late' : '/orders?view=week' })}
${UI.tile({ label: 'Open RFQs', value: rfq.open, sub: [rfq.due ? `${rfq.due} quote${rfq.due === 1 ? '' : 's'} due in 3 days` : null, rfq.chase ? `${rfq.chase} to chase` : null].filter(Boolean).join(' · ') || 'Nothing pressing', tone: rfq.due || rfq.chase ? 'warn' : '', href: rfq.due ? '/rfqs?view=due' : rfq.chase ? '/rfqs?view=chase' : '/rfqs' })}
${UI.tile({ label: 'Open complaints', value: cmp.open, sub: cmp.critical ? `${cmp.critical} critical${cmp.overdue ? ` · ${cmp.overdue} past target` : ''}` : cmp.overdue ? `${cmp.overdue} past target date` : 'None critical', tone: cmp.critical ? 'bad' : cmp.open ? 'warn' : 'ok', href: '/complaints' })}
</div>`;

  const attentionTable = UI.table([
    { label: 'Client', render: (r) => html`<a class="rowlink" href="/clients/${r.id}">${r.name}</a><span class="sub">${r.owner_name ? `Account manager: ${r.owner_name}` : 'No account manager'}</span>` },
    { label: 'Why', render: (r) => UI.flags(r.flags) },
    { label: 'Last contact', render: (r) => (r.last_contact ? F.relDays(r.last_contact) : C.dash) },
  ], attention, { ctx, empty: 'No client needs attention right now.' });

  const canFollow = canEdit(ctx.user, MODULES.followups);
  const fuList = myFollowups.length
    ? html`<ul class="list">${myFollowups.map((f) => html`<li><div class="grow">
<a class="who" href="/followups/${f.id}/edit?return=%2F">${f.title}</a>
<span class="sub">${C.due(f.due_on, true)}</span>
<span class="sub"><a href="/clients/${f.client_id}">${f.client_name}</a>${f.contact_name ? html` · ${f.contact_name}${f.contact_mobile ? html` · ${C.tel(f.contact_mobile)}` : ''}` : ''}</span>
</div>${canFollow ? C.doneButton(f, ctx) : ''}</li>`)}</ul>`
    : html`<p class="dim">Nothing due in the next 7 days.</p>`;

  const agingRows = [['Not yet due', aging.current], ['1–30 days overdue', aging.d30], ['31–60 days overdue', aging.d60], ['61–90 days overdue', aging.d90], ['Over 90 days overdue', aging.d90p]];
  const agingCard = html`<table class="aging"><tbody>${agingRows.map(([l, v], i) => html`<tr><td>${i > 0 && v > 0.5 ? html`<span class="tone-text-bad">${l}</span>` : l}</td><td>${F.money(v)}</td></tr>`)}</tbody></table>
${debtors.length ? html`<h3 class="section-title mini">Most owed</h3><ul class="list">${debtors.map((d) => html`<li><a class="who" href="/clients/${d.id}?tab=invoices">${d.name}</a><span class="num">${F.money(d.owed)}${d.overdue > 0.5 ? html`<span class="sub tone-text-bad">${F.money(d.overdue)} overdue</span>` : ''}</span></li>`)}</ul>` : ''}`;

  const recentList = recent.length
    ? html`<ol class="tl">${recent.map((a) => html`<li class="tl-item"><div class="tl-day"><b>${F.fmtDate(a.occurred_on)}</b>${F.relDays(a.occurred_on)}</div><div>
<div class="tl-title">${C.badge(a.type)}<a class="rowlink" href="/clients/${a.client_id}">${a.client_name}</a></div>
<div class="tl-notes">${a.subject}</div>
<div class="tl-meta">${[a.contact_name ? `With ${a.contact_name}` : null, a.user_name ? `logged by ${a.user_name}` : null].filter(Boolean).join(' · ')}</div>
</div></li>`)}</ol>`
    : html`<p class="dim">No calls or visits logged yet. Open a client and use “Log a call, visit or note”.</p>`;

  const actions = html`${canEdit(ctx.user, MODULES.rfqs) ? UI.button('/rfqs/new', 'New RFQ') : ''}${canEdit(ctx.user, MODULES.activities) ? UI.button('/activities/new', 'Log activity', 'primary') : ''}`;
  const body = html`
${UI.pageHeader(greeting(ctx), `${todayLong(ctx)}${quiet ? ` · ${F.plural(quiet, 'active client')} with no contact logged yet` : ''}`, actions)}
${yourDay(ctx, { commercial: true, fu: fuCounts })}
${tiles}
<div class="cols">
  <div>
    <section class="card"><div class="card-h"><h2>Clients needing attention</h2><a href="/clients?sort=attention&attention=1">See all</a></div>${attentionTable}</section>
    ${deliveriesCard(ctx)}
  </div>
  <div>
    ${myJobsCard(ctx)}
    <section class="card"><div class="card-h"><h2>My follow-ups</h2><a href="/followups?view=open&assigned_to=me">All mine</a></div><div class="card-b">${fuList}</div></section>
    <section class="card"><div class="card-h"><h2>Money owed to SEI</h2><a href="/invoices?view=unpaid">Unpaid invoices</a></div><div class="card-b">${agingCard}</div></section>
  </div>
</div>
${side.plant ? plantCard(ctx) : ''}
<section class="card"><div class="card-h"><h2>Recent calls and visits</h2><a href="/activities">Activity log</a></div><div class="card-b">${recentList}</div></section>`;
  ctx.page('Dashboard', body, { active: 'dashboard' });
}

const todayLong = (ctx) => new Intl.DateTimeFormat('en-IN', { timeZone: ctx.cfg.timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

function myJobsCard(ctx) {
  const me = ctx.user.id;
  const myJobs = ctx.db.all(`SELECT j.*, b.name AS assigner_name FROM jobs j LEFT JOIN users b ON b.id = j.assigned_by
                             WHERE j.assigned_to = :me AND j.status IN (${sqlIn(JOB_OPEN)})
                             ORDER BY CASE j.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, COALESCE(j.due_on, '9999'), j.id LIMIT 8`, { me });
  const givenOpen = ctx.db.get(`SELECT COUNT(*) AS n FROM jobs WHERE assigned_by = :me AND status IN (${sqlIn(JOB_OPEN)})`, { me }).n;
  const jobList = myJobs.length
    ? html`<ul class="list">${myJobs.map((j) => html`<li><div class="grow">
<a class="who" href="/jobs/${j.id}/edit?return=%2F">${j.title}</a>
<span class="sub">${j.due_on ? C.due(j.due_on, true) : 'No due date'}</span>
<span class="sub">${C.badge(j.priority)} ${C.badge(j.status)}${j.assigner_name ? ` · from ${j.assigner_name}` : ''}</span>
</div>${C.actionButton(`/jobs/${j.id}/update`, j.status === 'To do' ? 'Start' : 'Done', ctx, { status: j.status === 'To do' ? 'In progress' : 'Done' }, j.title)}</li>`)}</ul>`
    : html`<p class="dim">No jobs given to you right now.${givenOpen ? html` You have given <a href="/jobs?view=given">${F.plural(givenOpen, 'open job')}</a> to others.` : ''}</p>`;
  const canGive = canEdit(ctx.user, MODULES.jobs);
  return html`<section class="card"><div class="card-h"><h2>My jobs</h2>${canGive ? UI.button('/jobs/new', 'Give a job', 'sm') : html`<a href="/jobs">All my jobs</a>`}</div><div class="card-b">${jobList}</div></section>`;
}

function deliveriesCard(ctx) {
  const deliveries = ctx.db.all(`SELECT o.*, c.name AS client_name FROM v_orders o JOIN clients c ON c.id = o.client_id
                                 WHERE o.status = 'Open' AND o.pending > 0 AND o.due_on <= :tp7
                                 ORDER BY o.due_on LIMIT 10`, dateParams());
  const table = UI.table([
    { label: 'Due', render: (r) => C.due(r.due_on, true) },
    { label: 'PO', render: (r, c) => C.edit('orders', r, r.po_no, r.part_name, c) },
    { label: 'Client', render: (r) => C.client(r) },
    { label: 'Pending', cls: 'r', render: (r) => html`<b class="num">${F.num(r.pending)}</b>` },
  ], deliveries, { ctx, empty: 'No deliveries late or due in the next 7 days.' });
  return html`<section class="card"><div class="card-h"><h2>Deliveries late or due this week</h2><a href="/orders?view=open">All open POs</a></div>${table}</section>`;
}

// Production, maintenance, quality, stores and dispatch people: their day and the shop floor, without the money side.
function plantDashboard(ctx, fuCounts) {
  const actions = html`${UI.button('/planning', 'Week planner')}${canEdit(ctx.user, MODULES.jobs) ? UI.button('/jobs/new', 'Give a job', 'primary') : ''}`;
  const body = html`
${UI.pageHeader(greeting(ctx), html`${todayLong(ctx)}${ctx.user.department ? ` · ${ctx.user.department}` : ''}`, actions)}
${yourDay(ctx, { commercial: false, fu: fuCounts })}
<div class="cols">
  <div>${plantCard(ctx)}${deliveriesCard(ctx)}</div>
  <div>${myJobsCard(ctx)}</div>
</div>`;
  ctx.page('Dashboard', body, { active: 'dashboard' });
}

function register(router) {
  router.on('GET', '/', dashboard);
}

module.exports = { register };
