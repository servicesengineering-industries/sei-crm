'use strict';
const { html } = require('../html');
const F = require('../format');
const C = require('../cells');
const UI = require('../ui');
const { MODULES, RFQ_OPEN, sqlIn } = require('../modules');
const { canEdit } = require('../auth');
const { dateParams } = require('../crud');
const { clientSummaries, byAttention } = require('./clients');

function greeting(ctx) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: ctx.cfg.timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${ctx.user.name.split(' ')[0]}`;
}

function dashboard(ctx) {
  const db = ctx.db;
  const p = dateParams();
  const me = ctx.user.id;

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
  const fu = db.get(`SELECT COUNT(CASE WHEN due_on < :t THEN 1 END) AS overdue, COUNT(CASE WHEN due_on = :t THEN 1 END) AS today
                     FROM followups WHERE status = 'Open' AND assigned_to = :me`, { ...p, me });

  const summaries = clientSummaries(ctx);
  const attention = summaries.filter((c) => c.score >= 1 && c.status !== 'Lost').sort(byAttention).slice(0, 8);
  const quiet = summaries.filter((c) => c.status === 'Active' && !c.last_contact).length;

  const myFollowups = db.all(`SELECT f.*, c.name AS client_name, ct.name AS contact_name, ct.mobile AS contact_mobile
                              FROM followups f JOIN clients c ON c.id = f.client_id LEFT JOIN contacts ct ON ct.id = f.contact_id
                              WHERE f.status = 'Open' AND f.assigned_to = :me AND f.due_on <= :tp7
                              ORDER BY f.due_on, f.id LIMIT 12`, { ...p, me });
  const deliveries = db.all(`SELECT o.*, c.name AS client_name FROM v_orders o JOIN clients c ON c.id = o.client_id
                             WHERE o.status = 'Open' AND o.pending > 0 AND o.due_on <= :tp7
                             ORDER BY o.due_on LIMIT 10`, p);
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
${UI.tile({ label: 'My follow-ups', value: fu.overdue + fu.today, sub: fu.overdue ? `${fu.overdue} overdue · ${fu.today} due today` : fu.today ? `${fu.today} due today` : 'Nothing due today', tone: fu.overdue ? 'bad' : fu.today ? 'warn' : 'ok', href: '/followups?view=open&assigned_to=me' })}
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

  const deliveryTable = UI.table([
    { label: 'Due', render: (r) => C.due(r.due_on, true) },
    { label: 'PO', render: (r, c) => C.edit('orders', r, r.po_no, r.part_name, c) },
    { label: 'Client', render: (r) => C.client(r) },
    { label: 'Pending', cls: 'r', render: (r) => html`<b class="num">${F.num(r.pending)}</b>` },
  ], deliveries, { ctx, empty: 'No deliveries late or due in the next 7 days.' });

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
${UI.pageHeader(greeting(ctx), `${new Intl.DateTimeFormat('en-IN', { timeZone: ctx.cfg.timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}${quiet ? ` · ${F.plural(quiet, 'active client')} with no contact logged yet` : ''}`, actions)}
${tiles}
<div class="cols">
  <div>
    <section class="card"><div class="card-h"><h2>Clients needing attention</h2><a href="/clients?sort=attention&attention=1">See all</a></div>${attentionTable}</section>
    <section class="card"><div class="card-h"><h2>Deliveries late or due this week</h2><a href="/orders?view=open">All open POs</a></div>${deliveryTable}</section>
  </div>
  <div>
    <section class="card"><div class="card-h"><h2>My follow-ups</h2><a href="/followups?view=open&assigned_to=me">All mine</a></div><div class="card-b">${fuList}</div></section>
    <section class="card"><div class="card-h"><h2>Money owed to SEI</h2><a href="/invoices?view=unpaid">Unpaid invoices</a></div><div class="card-b">${agingCard}</div></section>
  </div>
</div>
<section class="card"><div class="card-h"><h2>Recent calls and visits</h2><a href="/activities">Activity log</a></div><div class="card-b">${recentList}</div></section>`;
  ctx.page('Dashboard', body, { active: 'dashboard' });
}

function register(router) {
  router.on('GET', '/', dashboard);
}

module.exports = { register };
