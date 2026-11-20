'use strict';
const { html } = require('./html');
const F = require('./format');
const C = require('./cells');
const UI = require('./ui');
const { MODULES } = require('./modules');
const { canEdit, isAdmin } = require('./auth');
const { HttpError, safeReturn } = require('./http');

// type -> [table, belongs to a client?]
const FK = { client: ['clients', false], contact: ['contacts', true], user: ['users', false], rfq: ['rfqs', true], order: ['orders', true], invoice: ['invoices', true] };
const PREFILL_KEYS = ['client_id', 'contact_id', 'order_id', 'invoice_id', 'rfq_id'];

function dateParams() {
  const t = F.today();
  const d = (n) => F.addDays(t, n);
  return { t, tm7: d(-7), tm14: d(-14), tm30: d(-30), tm60: d(-60), tm90: d(-90), tp3: d(3), tp7: d(7) };
}

const likeParam = (q) => `%${String(q).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

function requireEdit(ctx, mod) {
  if (!canEdit(ctx.user, mod)) throw new HttpError(403, `Your role can't change ${mod.plural.toLowerCase()}. Ask an admin if you need access.`);
}

function resolveDefault(f, ctx) {
  if (f.default === undefined) return undefined;
  return typeof f.default === 'function' ? f.default(ctx) : f.default;
}

function coerce(f, input) {
  let v = input == null ? '' : String(input).trim();
  if (v === '') return f.required ? { error: 'Required' } : { value: null };
  switch (f.type) {
    case 'int': {
      const n = Number(v.replace(/[,\s]/g, ''));
      const min = f.min ?? 0;
      if (!Number.isInteger(n) || n < min) return { error: min > 0 ? `Enter a whole number of at least ${min}` : 'Enter a whole number' };
      if (n > 1e9) return { error: 'That number is too large' };
      return { value: n };
    }
    case 'money': case 'money2': {
      const n = Number(v.replace(/[,\s₹]/g, ''));
      if (!Number.isFinite(n) || n < 0) return { error: 'Enter an amount in rupees' };
      if (n > 1e12) return { error: 'That amount is too large' };
      if (f.positive && n <= 0) return { error: 'Enter an amount above zero' };
      return { value: Math.round(n * 100) / 100 };
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
    case 'client': case 'contact': case 'user': case 'rfq': case 'order': case 'invoice': {
      const n = Number(v);
      return Number.isInteger(n) && n > 0 ? { value: n } : { error: 'Pick one of the options' };
    }
    default: {
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
  if (mod.parent && data[mod.parent.field] != null) {
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
    const n = ctx.db.get(`SELECT COUNT(*) AS n FROM ${d.table} WHERE ${d.fk} = :id`, { id }).n;
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
  if (clientId) return `/clients/${clientId}?tab=${mod.tab || 'overview'}`;
  return `/${mod.key}`;
}

// ---------- lists ----------

function currentFilters(ctx, mod) {
  const q = ctx.query;
  const views = mod.views || [];
  const view = views.some((v) => v.key === q.view) ? q.view : mod.defaultView || (views[0] && views[0].key) || '';
  const f = { view, q: (q.q || '').trim().slice(0, 100), client: /^\d+$/.test(q.client || '') ? q.client : '' };
  for (const flt of mod.filters || []) f[flt.name] = q[flt.name] || '';
  return f;
}

function listRows(ctx, mod, filters, limit = 501) {
  const where = [];
  const params = dateParams();
  const view = (mod.views || []).find((v) => v.key === filters.view);
  if (view && view.where) where.push(`(${view.where})`);
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
  const sql = `SELECT * FROM (${mod.listSql}) x${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${mod.order} LIMIT ${limit}`;
  return ctx.db.all(sql, params);
}

function listPage(ctx, mod) {
  const filters = currentFilters(ctx, mod);
  const rows = listRows(ctx, mod, filters);
  const more = rows.length > 500;
  if (more) rows.length = 500;
  const add = canEdit(ctx.user, mod) && !mod.parent ? UI.button(`/${mod.key}/new`, `New ${mod.singular}`, 'primary') : '';
  const csvHref = `/${mod.key}.csv${ctx.url.search}`;
  const body = html`
${UI.pageHeader(mod.plural, mod.help, add)}
${UI.filterBar(ctx, mod, filters)}
<p class="count">${F.plural(rows.length, mod.singular, mod.key === 'activities' ? 'activities' : undefined)}${more ? ' (first 500 shown)' : ''}</p>
${UI.table(mod.columns, rows, { ctx, empty: filters.q || filters.client ? 'Nothing matches these filters.' : `No ${mod.plural.toLowerCase()} in this view yet.` })}
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
  const rows = listRows(ctx, mod, currentFilters(ctx, mod), 100000);
  const keys = mod.csv;
  const label = (k) => {
    const f = mod.fields.find((x) => x.name === k);
    if (f) return f.label;
    return { client_name: 'Client', contact_name: 'Contact', owner_name: 'Owner', user_name: 'Entered by', assigned_name: 'Assigned to' }[k]
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
  const rows = ctx.db.all(`SELECT * FROM (${child.listSql}) x WHERE ${child.parent.field} = :pid ORDER BY ${child.order}`, { pid: parentId });
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
  const editable = canEdit(ctx.user, mod);
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
${!editable ? html`<p class="alert alert-info">You can see this ${mod.singular}, but your role can't change it.</p>` : ''}
<div class="card"><div class="card-b">${UI.form(ctx, mod, {
    action: editing ? `/${mod.key}/${id}/edit` : `/${mod.key}/new`,
    values, errors, readonly: !editable, editing, returnTo, cancel: back,
    submit: editing ? 'Save changes' : `Add ${mod.singular}`,
  })}</div></div>
${kids}
${meta}
${del}`;
  ctx.page(heading, body, { active: mod.parent ? mod.parent.module : mod.key, status });
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
  requireEdit(ctx, mod);
  const existing = getRow(ctx, mod, id);
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
  });
  ctx.flash('ok', 'Changes saved.');
  ctx.redirect(safeReturn(ctx.body.return, backTo(mod, data.client_id, id)));
}

function remove(ctx, mod, id) {
  if (!isAdmin(ctx.user)) throw new HttpError(403, 'Only an admin can delete records.');
  const existing = getRow(ctx, mod, id);
  if (mod.key === 'clients') {
    const linked = ['contacts', 'activities', 'followups', 'rfqs', 'orders', 'invoices', 'complaints']
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
  ctx.db.tx(() => {
    ctx.audit({ clientId: mod.key === 'clients' ? null : existing.client_id, entity: mod.key, entityId: id, action: 'deleted', summary: `deleted ${mod.singular} “${mod.title(existing)}”` });
    ctx.db.run(`DELETE FROM ${mod.table} WHERE id = :id`, { id });
  });
  ctx.flash('ok', `${F.cap(mod.singular)} deleted.`);
  const fallback = mod.parent ? `/${mod.parent.module}/${existing[mod.parent.field]}/edit` : mod.key === 'clients' ? '/clients' : backTo(mod, existing.client_id, null);
  ctx.redirect(safeReturn(ctx.body.return, fallback));
}

function registerCrud(router, key) {
  const mod = MODULES[key];
  router.on('GET', `/${key}`, (ctx) => listPage(ctx, mod));
  router.on('GET', `/${key}.csv`, (ctx) => csvExport(ctx, mod));
  router.on('GET', `/${key}/new`, (ctx) => newPage(ctx, mod));
  router.on('POST', `/${key}/new`, (ctx) => create(ctx, mod));
  router.on('GET', `/${key}/:id`, (ctx) => ctx.redirect(`/${key}/${ctx.params.id}/edit`));
  router.on('GET', `/${key}/:id/edit`, (ctx) => formPage(ctx, mod, { id: Number(ctx.params.id), values: getRow(ctx, mod, Number(ctx.params.id)) }));
  router.on('POST', `/${key}/:id/edit`, (ctx) => update(ctx, mod, Number(ctx.params.id)));
  router.on('POST', `/${key}/:id/delete`, (ctx) => remove(ctx, mod, Number(ctx.params.id)));
}

module.exports = { registerCrud, dateParams, likeParam, listRows, requireEdit };
