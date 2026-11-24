'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { html } = require('./html');
const F = require('./format');
const C = require('./cells');
const UI = require('./ui');
const { MODULES } = require('./modules');
const { canEdit, isAdmin } = require('./auth');
const { HttpError, safeReturn } = require('./http');

// type -> [table, belongs to a client?]
const FK = {
  client: ['clients', false], contact: ['contacts', true], user: ['users', false], rfq: ['rfqs', true], order: ['orders', true], invoice: ['invoices', true],
  supplier: ['suppliers', false], asset: ['assets', false], machine: ['assets', false], assignee: ['users', false],
};
const FK_TYPES = new Set(Object.keys(FK));
const PREFILL_KEYS = ['client_id', 'contact_id', 'order_id', 'invoice_id', 'rfq_id', 'asset_id', 'supplier_id'];

function dateParams() {
  const t = F.today();
  const d = (n) => F.addDays(t, n);
  const wk = F.weekOf(t); // this Monday
  return {
    t, tm7: d(-7), tm14: d(-14), tm30: d(-30), tm60: d(-60), tm90: d(-90), tp3: d(3), tp7: d(7),
    wk, wkp: F.addDays(wk, -7), wkn: F.addDays(wk, 7), wkne: F.addDays(wk, 13), tp30: d(30),
  };
}

const likeParam = (q) => `%${String(q).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

function requireEdit(ctx, mod, row) {
  if (canEdit(ctx.user, mod, row)) return;
  throw new HttpError(403, mod.forbidden || `Your role can't change ${mod.plural.toLowerCase()}. Ask an admin if you need access.`);
}

function resolveDefault(f, ctx) {
  if (f.default === undefined) return undefined;
  return typeof f.default === 'function' ? f.default(ctx) : f.default;
}

// An empty required field says what to do, in the words of its label ("Enter the part").
const PICKED = new Set(['select', 'client', 'contact', 'user', 'rfq', 'order', 'invoice', 'supplier', 'asset', 'machine', 'assignee']);
function requiredError(f) {
  if (f.type === 'date') return 'Pick a date';
  if (PICKED.has(f.type)) return 'Choose one from the list';
  const label = f.label.replace(/\s*\([^)]*\)$/, '');
  return `Enter the ${/^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label}`;
}

function coerce(f, input) {
  let v = input == null ? '' : String(input).trim();
  if (v === '') return f.required ? { error: requiredError(f) } : { value: null };
  switch (f.type) {
    case 'int': {
      const n = Number(v.replace(/[,\s]/g, ''));
      const min = f.min ?? 0;
      if (!Number.isInteger(n) || n < min) return { error: `Enter a whole number, ${min} or more` };
      if (n > 1e9) return { error: 'That number is too large' };
      return { value: n };
    }
    case 'money': case 'money2': {
      const n = Number(v.replace(/[,\s₹]/g, ''));
      if (!Number.isFinite(n) || n < 0) return { error: 'Enter an amount in rupees, 0 or more' };
      if (n > 1e12) return { error: 'That amount is too large' };
      if (f.positive && n <= 0) return { error: 'Enter an amount above zero' };
      return { value: Math.round(n * 100) / 100 };
    }
    case 'decimal': {
      const n = Number(v.replace(/[,\s]/g, ''));
      if (!Number.isFinite(n) || n < 0) return { error: 'Enter a quantity' };
      if (n > 1e9) return { error: 'That number is too large' };
      if (f.positive && n <= 0) return { error: 'Enter a quantity above zero' };
      return { value: Math.round(n * 1000) / 1000 };
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: 'Enter a date' };
      const d = new Date(`${v}T00:00:00Z`);
      // Date.parse rolls 31 Feb over into March, so round-trip to reject days that don't exist.
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return { error: 'That date doesn’t exist' };
      const year = Number(v.slice(0, 4));
      if (year < 1990 || year > 2100) return { error: 'Enter a year between 1990 and 2100' };
      return { value: v };
    }
    case 'select':
      return f.options.includes(v) ? { value: v } : { error: 'Pick one of the options' };
    case 'email':
      return C.EMAIL_RE.test(v) && v.length <= 200 ? { value: v.toLowerCase() } : { error: 'Enter an email address like name@company.com' };
    case 'tel':
      return /^[+\d(][\d\s()+\-/.,]*(\s*(ext|x)\.?\s*\d+)?$/i.test(v) && v.length <= 40 ? { value: v } : { error: 'Enter a phone number' };
    case 'url': {
      const u = /^https?:\/\//i.test(v) ? v : `https://${v}`;
      try {
        const parsed = new URL(u);
        if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes('.')) throw new Error('bad');
        return { value: u };
      } catch { return { error: 'Enter a web address like www.example.com' }; }
    }
    default: {
      if (FK_TYPES.has(f.type)) {
        const n = Number(v);
        return Number.isInteger(n) && n > 0 ? { value: n } : { error: 'Pick one of the options' };
      }
      if (f.upper) v = v.toUpperCase();
      if (f.pattern && !f.pattern.test(v)) return { error: f.patternMsg || 'Check the format' };
      const max = f.type === 'textarea' ? 5000 : 200;
      return v.length > max ? { error: `Keep it under ${max} characters` } : { value: v };
    }
  }
}

function readForm(ctx, mod, body, existing) {
  const data = {};
  const virt = {};
  const errors = {};
  for (const f of mod.fields) {
    if (existing && f.createOnly) continue;
    const target = f.virtual ? virt : data;
    if (f.type === 'checkbox') { target[f.name] = body[f.name] ? 1 : 0; continue; }
    const r = coerce(f, body[f.name]);
    if (r.error) errors[f.name] = r.error;
    else target[f.name] = r.value;
  }
  // Child records (dispatches, payments) take their client from the parent.
  if (mod.parent && !mod.parent.noClient && data[mod.parent.field] != null) {
    const p = ctx.db.get(`SELECT client_id FROM ${mod.parent.table} WHERE id = :id`, { id: data[mod.parent.field] });
    if (p) data.client_id = p.client_id;
  }
  // Linked records must exist and belong to the same client.
  const clientId = mod.key === 'clients' ? null : (data.client_id ?? (existing ? existing.client_id : null));
  for (const f of mod.fields) {
    const spec = FK[f.type];
    const v = (f.virtual ? virt : data)[f.name];
    if (!spec || v == null || errors[f.name]) continue;
    const [table, scoped] = spec;
    const row = ctx.db.get(`SELECT id${scoped ? ', client_id' : ''} FROM ${table} WHERE id = :id`, { id: v });
    if (!row) errors[f.name] = 'That record no longer exists';
    else if (scoped && clientId != null && row.client_id !== clientId) errors[f.name] = 'This belongs to a different client';
  }
  if (mod.validate) mod.validate(data, virt, errors, ctx, existing);
  return { data, virt, errors };
}

// "2 dispatches and 1 invoice": records that point at this one (see `dependents` in modules.js).
function dependentSummary(ctx, mod, id) {
  const parts = [];
  for (const d of mod.dependents || []) {
    // `where` narrows what counts as history (for example, only checklist days that are past or filled in).
    const n = d.where
      ? ctx.db.get(`SELECT COUNT(*) AS n FROM ${d.table} WHERE ${d.fk} = :id AND (${d.where})`, { id, t: F.today() }).n
      : ctx.db.get(`SELECT COUNT(*) AS n FROM ${d.table} WHERE ${d.fk} = :id`, { id }).n;
    if (n) parts.push(F.plural(n, d.one, d.many));
  }
  if (parts.length < 2) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function insertRow(db, table, data) {
  const cols = Object.keys(data);
  return db.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`, data).id;
}

function updateRow(db, table, id, data) {
  const cols = Object.keys(data);
  db.run(`UPDATE ${table} SET ${cols.map((c) => `${c} = :${c}`).join(', ')}, updated_at = datetime('now') WHERE id = :__id`, { ...data, __id: id });
}

function describeChanges(mod, before, after) {
  const changed = [];
  for (const f of mod.fields) {
    if (f.virtual || !(f.name in after)) continue;
    const a = before[f.name] ?? null;
    const b = after[f.name] ?? null;
    if (String(a ?? '') === String(b ?? '')) continue;
    if (f.type === 'select') changed.push(`${f.label.toLowerCase()} ${a || '—'} → ${b || '—'}`);
    else if (f.type === 'date') changed.push(`${f.label.toLowerCase()} → ${b ? F.fmtDate(b) : 'blank'}`);
    else if (f.type === 'money' || f.type === 'money2') changed.push(`${f.label.replace(/ \(₹\)$/, '').toLowerCase()} → ${b == null ? 'blank' : F.money2(b)}`);
    else changed.push(f.label.toLowerCase());
  }
  if (changed.length > 4) return `${changed.slice(0, 4).join(', ')} and ${changed.length - 4} more`;
  return changed.join(', ');
}

function backTo(mod, clientId, id) {
  if (mod.key === 'clients') return id ? `/clients/${id}` : '/clients';
  if (clientId && !mod.homeList) return `/clients/${clientId}?tab=${mod.tab || 'overview'}`;
  return `/${mod.key}`;
}

// ---------- lists ----------

function currentFilters(ctx, mod) {
  const q = ctx.query;
  const views = mod.views || [];
  // Opening a plan at a given week (?week=) shows that week, whatever view was last used.
  const week = mod.weekly && F.isIsoDate(q.week) ? F.weekOf(q.week) : '';
  const view = week ? 'all' : views.some((v) => v.key === q.view) ? q.view : mod.defaultView || (views[0] && views[0].key) || '';
  const f = { view, week, q: (q.q || '').trim().slice(0, 100), client: !mod.noClient && /^\d+$/.test(q.client || '') ? q.client : '' };
  for (const flt of mod.filters || []) f[flt.name] = q[flt.name] || '';
  return f;
}

function listRows(ctx, mod, filters, limit = 501, cols = null) {
  const where = [];
  const params = {
    ...dateParams(), me: ctx.user.id, dept: ctx.user.department || '',
    head: ctx.user.is_head ? 1 : 0, admin: ctx.user.role === 'admin' ? 1 : 0,
  };
  const view = (mod.views || []).find((v) => v.key === filters.view);
  if (view && view.where) where.push(`(${view.where})`);
  if (filters.week) { where.push('week_start = :week'); params.week = filters.week; }
  if (filters.client) { where.push(`${mod.key === 'clients' ? 'id' : 'client_id'} = :client`); params.client = Number(filters.client); }
  for (const flt of mod.filters || []) {
    let v = filters[flt.name];
    if (!v) continue;
    if (flt.type === 'user') {
      if (v === 'me') v = ctx.user.id;
      else if (/^\d+$/.test(v)) v = Number(v);
      else continue;
    } else if (!flt.options.includes(v)) continue;
    where.push(`${flt.name} = :f_${flt.name}`);
    params[`f_${flt.name}`] = v;
  }
  if (filters.q && mod.search) {
    where.push(`(${mod.search.map((c) => `${c} LIKE :q ESCAPE '\\'`).join(' OR ')})`);
    params.q = likeParam(filters.q);
  }
  // A CSV asks for every row (no limit) and only its own columns, which lets SQLite skip the rest.
  const sql = `SELECT ${cols ? cols.join(', ') : '*'} FROM (${mod.listSql}) x${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${mod.order}${limit ? ` LIMIT ${limit}` : ''}`;
  return ctx.db.all(sql, params);
}

// Long lists show 100 rows a page. Totals above the list still count every row that matches.
const PAGE_SIZE = 100;
const MAX_ROWS = 2000;

function pager(ctx, page, pages) {
  if (pages < 2) return '';
  const link = (n, label, rel) => {
    const p = new URLSearchParams(ctx.url.search);
    if (n > 1) p.set('page', String(n)); else p.delete('page');
    const qs = p.toString();
    return html`<a class="chip" rel="${rel}" href="${ctx.url.pathname}${qs ? `?${qs}` : ''}">${label}</a>`;
  };
  return html`<nav class="pager chips" aria-label="Pages">${page > 1 ? link(page - 1, '← Previous', 'prev') : ''}<span class="pager-at">Page ${page} of ${pages}</span>${page < pages ? link(page + 1, 'Next →', 'next') : ''}</nav>`;
}

function listPage(ctx, mod) {
  const filters = currentFilters(ctx, mod);
  const rows = listRows(ctx, mod, filters, MAX_ROWS + 1);
  const more = rows.length > MAX_ROWS;
  if (more) rows.length = MAX_ROWS;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(ctx.query.page, 10) || 1));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const range = pages > 1 ? ` · showing ${F.num((page - 1) * PAGE_SIZE + 1)}–${F.num((page - 1) * PAGE_SIZE + shown.length)}` : '';
  const add = !mod.readOnly && canEdit(ctx.user, mod) && (!mod.parent || mod.parent.standalone) ? UI.button(`/${mod.key}/new`, `New ${mod.singular}`, 'primary') : '';
  const planner = mod.weekly ? UI.button(`/planning${filters.week ? `?week=${filters.week}` : ''}`, 'Week planner') : '';
  const csvHref = `/${mod.key}.csv${ctx.url.search}`;
  const many = mod.many || (mod.key === 'activities' ? 'activities' : undefined);
  const body = html`
${UI.pageHeader(mod.plural, mod.help, html`${mod.listActions ? mod.listActions(ctx) : ''}${planner}${add}`)}
${UI.filterBar(ctx, mod, filters)}
${mod.listSummary ? mod.listSummary(ctx, rows, filters) : ''}
<p class="count">${F.plural(rows.length, mod.singular, many)}${filters.week ? ` in the week of ${F.weekLabel(filters.week)}` : ''}${more ? ` (the first ${F.num(MAX_ROWS)}: narrow the filters or download the CSV for all)` : ''}${range}</p>
${UI.table(mod.columns, shown, { ctx, empty: filters.q || filters.client || filters.week ? 'Nothing matches these filters. Clear the filters to see more.' : (mod.views || []).length ? 'Nothing in this view. Choose another view above.' : 'Nothing here yet.' })}
${pager(ctx, page, pages)}
<p class="export"><a href="${csvHref}">Download as CSV</a> (opens in Excel)</p>`;
  ctx.page(mod.plural, body, { active: mod.key });
}

function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  // Phone numbers like +91 98100 12345: Excel would read the + as a sum, so wrap as a text formula.
  // The value holds only digits and separators, so the wrapper can't carry a payload.
  if (/^\+[\d\s()\-/.]+$/.test(s)) s = `="${s}"`;
  else if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvExport(ctx, mod) {
  const rows = listRows(ctx, mod, currentFilters(ctx, mod), null, mod.csv);
  const keys = mod.csv;
  const label = (k) => {
    const f = mod.fields.find((x) => x.name === k);
    if (f) return f.label;
    return {
      client_name: 'Client', contact_name: 'Contact', owner_name: 'Owner', user_name: 'Entered by', assigned_name: 'Assigned to',
      supplier_name: 'Supplier', asset_code: 'Machine / tool code', asset_name: 'Machine / tool', responsible_name: 'Responsible',
      supervisor_name: 'Supervisor', approved_name: 'Approved by', last_done_on: 'Last PM done', next_pm_on: 'Next PM due',
      planned_value: 'Planned value', actual_qty: 'Dispatched qty', actual_value: 'Dispatched value', balance_qty: 'Balance qty',
      week_start: 'Week starting',
    }[k]
      || k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  };
  const lines = [keys.map((k) => csvCell(label(k))).join(',')];
  for (const r of rows) lines.push(keys.map((k) => csvCell(r[k])).join(','));
  ctx.send(200, `﻿${lines.join('\r\n')}\r\n`, 'text/csv; charset=utf-8', {
    'Content-Disposition': `attachment; filename="sei-${mod.key}-${F.today()}.csv"`,
  });
}

// ---------- forms ----------

function childSection(ctx, child, parentMod, parentId) {
  const rows = ctx.db.all(`SELECT * FROM (${child.listSql}) x WHERE ${child.parent.field} = :pid ORDER BY ${child.childOrder || child.order}`, { pid: parentId });
  const back = `/${parentMod.key}/${parentId}/edit`;
  const add = canEdit(ctx.user, child)
    ? UI.button(`/${child.key}/new?${child.parent.field}=${parentId}&return=${encodeURIComponent(back)}`, `Add ${child.singular}`, 'primary btn-sm')
    : '';
  return html`<section class="card child">
<div class="card-h"><h2>${child.plural}</h2>${add}</div>
${parentMod.childSummary ? parentMod.childSummary(ctx, parentId) : ''}
${UI.table(child.childColumns, rows, { ctx, empty: child.emptyChild })}
</section>`;
}

function formPage(ctx, mod, { id = null, values, errors = {}, status = 200 }) {
  const editing = id != null;
  const editable = canEdit(ctx.user, mod, editing ? values : undefined);
  const returnTo = safeReturn(ctx.method === 'POST' ? ctx.body.return : ctx.query.return, '');
  const clientId = mod.key === 'clients' ? id : Number(values.client_id) || null;
  const client = clientId ? ctx.db.get('SELECT id, name FROM clients WHERE id = :id', { id: clientId }) : null;
  const back = returnTo || backTo(mod, client && client.id, id);
  const heading = editing ? mod.title(values) || F.cap(mod.singular) : `New ${mod.singular}`;
  const sub = client && mod.key !== 'clients' ? html`${F.cap(mod.singular)} for <a href="/clients/${client.id}">${client.name}</a>` : editing ? F.cap(mod.singular) : '';
  const kids = editing ? (mod.children || []).map((k) => childSection(ctx, MODULES[k], mod, id)) : [];
  const meta = editing && values.created_at
    ? html`<p class="meta">Added ${F.fmtDateTime(values.created_at)}${values.updated_at && values.updated_at !== values.created_at ? html` · last changed ${F.fmtDateTime(values.updated_at)}` : ''}</p>`
    : '';
  const extra = editing && mod.key === 'rfqs' && values.status === 'Won' && canEdit(ctx.user, MODULES.orders)
    ? UI.button(`/orders/new?rfq_id=${id}`, 'Create PO from this RFQ')
    : '';
  const del = editing && isAdmin(ctx.user)
    ? html`<form method="post" action="/${mod.key}/${id}/delete" class="danger-zone" data-confirm="Delete this ${mod.singular}? This cannot be undone.">${C.csrf(ctx)}<input type="hidden" name="return" value="${returnTo}"><button class="btn btn-danger btn-sm" type="submit">Delete ${mod.singular}</button></form>`
    : '';
  const body = html`
<p class="crumbs"><a href="${back}">← Back</a></p>
${UI.pageHeader(heading, sub, extra)}
${!editable ? html`<p class="alert alert-info">${mod.readonlyNote || html`You can see this ${mod.singular}, but your role can't change it.`}</p>` : ''}
<div class="card"><div class="card-b">${UI.form(ctx, mod, {
    action: editing ? `/${mod.key}/${id}/edit` : `/${mod.key}/new`,
    values, errors, readonly: !editable, editing, returnTo, cancel: back,
    submit: editing ? 'Save changes' : `Add ${mod.singular}`,
  })}</div></div>
${editing && mod.formExtra ? mod.formExtra(ctx, id, values) : ''}
${kids}
${meta}
${del}`;
  ctx.page(heading, body, { active: mod.parent && !mod.parent.standalone ? mod.parent.module : mod.key, status });
}

function newPage(ctx, mod) {
  requireEdit(ctx, mod);
  const values = Object.create(null);
  for (const f of mod.fields) {
    const d = resolveDefault(f, ctx);
    if (d !== undefined) values[f.name] = d;
  }
  for (const k of PREFILL_KEYS) {
    if (/^\d+$/.test(ctx.query[k] || '') && mod.fields.some((f) => f.name === k)) values[k] = Number(ctx.query[k]);
  }
  if (mod.prefill) mod.prefill(ctx, values);
  formPage(ctx, mod, { values });
}

function getRow(ctx, mod, id) {
  const row = ctx.db.get(`SELECT * FROM ${mod.table} WHERE id = :id`, { id });
  if (!row) throw new HttpError(404, `That ${mod.singular} doesn't exist. It may have been deleted.`);
  return row;
}

function create(ctx, mod) {
  requireEdit(ctx, mod);
  const { data, virt, errors } = readForm(ctx, mod, ctx.body, null);
  if (Object.keys(errors).length) return formPage(ctx, mod, { values: { ...ctx.body }, errors, status: 422 });
  if (mod.key === 'clients' && ctx.db.get('SELECT id FROM clients WHERE name = :name', { name: data.name })) {
    return formPage(ctx, mod, { values: { ...ctx.body }, errors: { name: 'A client with this name already exists' }, status: 422 });
  }
  let id;
  ctx.db.tx(() => {
    if (mod.beforeSave) mod.beforeSave(data, ctx, null);
    if (mod.beforeInsert) mod.beforeInsert(data, ctx);
    id = insertRow(ctx.db, mod.table, data);
    const clientId = mod.key === 'clients' ? id : data.client_id;
    ctx.audit({ clientId, entity: mod.key, entityId: id, action: 'created', summary: `added ${mod.singular} “${mod.title({ ...data, id })}”` });
    if (mod.afterInsert) mod.afterInsert(ctx, id, data, virt);
  });
  ctx.flash('ok', `${F.cap(mod.singular)} saved.`);
  ctx.redirect(safeReturn(ctx.body.return, backTo(mod, data.client_id, id)));
}

function update(ctx, mod, id) {
  const existing = getRow(ctx, mod, id);
  requireEdit(ctx, mod, existing);
  const { data, errors } = readForm(ctx, mod, ctx.body, existing);
  if (mod.key === 'clients' && !errors.name && ctx.db.get('SELECT id FROM clients WHERE name = :name AND id <> :id', { name: data.name, id })) {
    errors.name = 'Another client already has this name';
  }
  // Moving a record to another client would strand the records that point at it.
  if (mod.dependents && data.client_id != null && data.client_id !== existing.client_id && !errors.client_id) {
    const deps = dependentSummary(ctx, mod, id);
    if (deps) errors.client_id = `It can’t move to another client because it has ${deps}. Add it again under the right client instead.`;
  }
  if (Object.keys(errors).length) {
    const values = { ...existing, ...ctx.body };
    // An unticked box is missing from the form data; don't let the saved value tick it again.
    for (const f of mod.fields) if (f.type === 'checkbox') values[f.name] = ctx.body[f.name] ? 1 : 0;
    return formPage(ctx, mod, { id, values, errors, status: 422 });
  }
  ctx.db.tx(() => {
    if (mod.beforeSave) mod.beforeSave(data, ctx, existing);
    updateRow(ctx.db, mod.table, id, data);
    const changes = describeChanges(mod, existing, data);
    if (changes) {
      const clientId = mod.key === 'clients' ? id : data.client_id;
      ctx.audit({ clientId, entity: mod.key, entityId: id, action: 'updated', summary: `updated ${mod.singular} “${mod.title({ ...existing, ...data })}”: ${changes}` });
    }
    if (mod.afterUpdate) mod.afterUpdate(ctx, id, data, existing);
  });
  ctx.flash('ok', 'Changes saved.');
  ctx.redirect(safeReturn(ctx.body.return, backTo(mod, data.client_id, id)));
}

const ATTACHED = {
  jobs: { entity: 'job_updates', ids: 'SELECT id FROM job_updates WHERE job_id = :id' },
  checklists: { entity: 'checklist_runs', ids: 'SELECT id FROM checklist_runs WHERE checklist_id = :id' },
  compliance_items: { entity: 'compliance_filings', ids: 'SELECT id FROM compliance_filings WHERE item_id = :id' },
};

function remove(ctx, mod, id) {
  if (!isAdmin(ctx.user)) throw new HttpError(403, 'Only an admin can delete records.');
  const existing = getRow(ctx, mod, id);
  if (mod.key === 'clients') {
    const linked = ['contacts', 'activities', 'followups', 'rfqs', 'orders', 'invoices', 'complaints', 'sales_plans', 'production_plans', 'jobs']
      .reduce((n, t) => n + ctx.db.get(`SELECT COUNT(*) AS n FROM ${t} WHERE client_id = :id`, { id }).n, 0);
    if (linked > 0) {
      ctx.flash('error', `${existing.name} has ${F.plural(linked, 'linked record')}, so it can't be deleted. Set its status to Dormant or Lost instead.`);
      return ctx.redirect(`/clients/${id}?tab=details`);
    }
  } else if (mod.dependents) {
    const deps = dependentSummary(ctx, mod, id);
    if (deps) {
      ctx.flash('error', `This ${mod.singular} has ${deps}, so it can't be deleted. ${mod.deleteHint || 'Delete those first.'}`);
      return ctx.redirect(`/${mod.key}/${id}/edit`);
    }
  }
  // Photos and PDFs hang off the record's updates, daily copies or filings: they go with it.
  const files = ATTACHED[mod.key]
    ? ctx.db.all(`SELECT id, stored FROM attachments WHERE entity = :e AND entity_id IN (${ATTACHED[mod.key].ids})`, { e: ATTACHED[mod.key].entity, id })
    : [];
  ctx.db.tx(() => {
    ctx.audit({ clientId: mod.key === 'clients' ? null : existing.client_id, entity: mod.key, entityId: id, action: 'deleted', summary: `deleted ${mod.singular} “${mod.title(existing)}”${files.length ? ` and ${F.plural(files.length, 'attached file')}` : ''}` });
    for (const f of files) ctx.db.run('DELETE FROM attachments WHERE id = :id', { id: f.id });
    ctx.db.run(`DELETE FROM ${mod.table} WHERE id = :id`, { id });
  });
  for (const f of files) fs.rmSync(path.join(ctx.cfg.dataDir, 'uploads', f.stored), { force: true });
  ctx.flash('ok', `${F.cap(mod.singular)} deleted.`);
  const fallback = mod.parent ? `/${mod.parent.module}/${existing[mod.parent.field]}/edit` : mod.key === 'clients' ? '/clients' : backTo(mod, existing.client_id, null);
  ctx.redirect(safeReturn(ctx.body.return, fallback));
}

function registerCrud(router, key) {
  const mod = MODULES[key];
  router.on('GET', `/${key}`, (ctx) => listPage(ctx, mod));
  router.on('GET', `/${key}.csv`, (ctx) => csvExport(ctx, mod));
  if (mod.readOnly) return; // its records have their own pages
  router.on('GET', `/${key}/new`, (ctx) => newPage(ctx, mod));
  router.on('POST', `/${key}/new`, (ctx) => create(ctx, mod));
  router.on('GET', `/${key}/:id`, (ctx) => ctx.redirect(`/${key}/${ctx.params.id}/edit`));
  router.on('GET', `/${key}/:id/edit`, (ctx) => formPage(ctx, mod, { id: Number(ctx.params.id), values: getRow(ctx, mod, Number(ctx.params.id)) }));
  router.on('POST', `/${key}/:id/edit`, (ctx) => update(ctx, mod, Number(ctx.params.id)));
  router.on('POST', `/${key}/:id/delete`, (ctx) => remove(ctx, mod, Number(ctx.params.id)));
}

module.exports = { registerCrud, dateParams, likeParam, listRows, requireEdit, pager, PAGE_SIZE };
