'use strict';
// The company checklist: My checklists, filling one in (phone or PC), sign-off, approvals for
// checklists and jobs, the compliance calendar's "mark done", scorecards, and evidence files.
const { html } = require('../html');
const F = require('../format');
const C = require('../cells');
const UI = require('../ui');
const CL = require('../checklists');
const U = require('../uploads');
const { MODULES, canManageJob } = require('../modules');
const { canEdit, isAdmin } = require('../auth');
const { HttpError, safeReturn } = require('../http');

const RUN_SQL = `SELECT r.*, c.title, c.needs_approval, c.frequency, c.weekday, c.month_day, a.code AS asset_code, a.name AS asset_name,
                        u.name AS assignee_name, s.name AS submitter_name, v.name AS reviewer_name
                 FROM checklist_runs r JOIN checklists c ON c.id = r.checklist_id LEFT JOIN assets a ON a.id = c.asset_id
                 LEFT JOIN users u ON u.id = r.assignee_id LEFT JOIN users s ON s.id = r.submitted_by LEFT JOIN users v ON v.id = r.reviewed_by`;
// Never NULL, so NOT ${MINE} also keeps checklists given to nobody.
const MINE = '(IFNULL(r.assignee_id, 0) = :me OR (r.assignee_id IS NULL AND r.department = :dept))';

function getRun(db, id) {
  const r = db.get(`${RUN_SQL} WHERE r.id = :id`, { id });
  if (!r) throw new HttpError(404, "That checklist doesn't exist.");
  return r;
}

// ---------- My checklists ----------

function runCard(r, t, team = false) {
  const missed = CL.RUN_OPEN.includes(r.status) && r.due_on < t;
  const due = r.due_on === t ? (team && CL.RUN_OPEN.includes(r.status) ? 'Not filled in yet' : 'Today') : missed ? `Missed · ${F.fmtDate(r.due_on)}` : F.fmtDate(r.due_on);
  const facts = team ? [r.department, r.submitter_name || r.assignee_name || `Anyone in ${r.department}`] : [r.asset_code, r.department, `${r.items} items`];
  return html`<li><a class="cl-card${missed ? ' is-missed' : ''}" href="/checklist_runs/${r.id}">
<span class="cl-card-main"><b>${r.title}</b><span class="sub">${facts.filter(Boolean).join(' · ')}</span></span>
<span class="cl-card-side"><span class="sub${missed ? ' tone-text-bad' : ''}">${due}</span>${r.status === 'Open' ? '' : C.runStatus(r.status)}${r.issues ? html`<span class="sub tone-text-bad">${F.plural(r.issues, 'problem')}</span>` : ''}</span>
</a></li>`;
}

function myChecklists(ctx) {
  const db = ctx.db;
  CL.ensureRuns(db);
  const t = F.today();
  const p = { me: ctx.user.id, dept: ctx.user.department || '', t, from: F.addDays(t, -14) };
  const withItems = RUN_SQL.replace('SELECT r.*,', 'SELECT r.*, (SELECT COUNT(*) FROM checklist_answers x WHERE x.run_id = r.id) AS items,');
  const todo = db.all(`${withItems} WHERE ${MINE} AND r.status IN ('Open', 'Returned') AND r.due_on = :t ORDER BY c.title`, p);
  const late = db.all(`${withItems} WHERE ${MINE} AND r.status IN ('Open', 'Returned') AND r.due_on < :t AND r.due_on >= :from ORDER BY r.due_on DESC, c.title`, p);
  const done = db.all(`${withItems} WHERE ${MINE} AND r.status IN ('Submitted', 'Approved', 'Done') AND r.due_on = :t ORDER BY r.submitted_at DESC`, p);
  // Heads see the rest of their department's checklists for today; admins see everyone's.
  const admin = isAdmin(ctx.user);
  const head = !!ctx.user.is_head && !!ctx.user.department;
  const team = admin || head
    ? db.all(`${withItems} WHERE r.due_on = :t AND NOT ${MINE}${admin ? '' : ' AND r.department = :dept'} ORDER BY r.department, c.title`, p)
    : [];
  const teamLeft = team.filter((r) => CL.RUN_OPEN.includes(r.status)).length;
  const waiting = approvalsFor(ctx).length;
  const section = (title, rows, empty, isTeam) => html`<section class="cl-section"><h2>${title} <span class="dim">${isTeam ? `${rows.length - teamLeft} of ${rows.length} filled in` : rows.length}</span></h2>${rows.length ? html`<ul class="cl-list">${rows.map((r) => runCard(r, t, isTeam))}</ul>` : html`<p class="dim">${empty}</p>`}</section>`;
  const actions = html`${waiting ? UI.button('/approvals', `Approvals (${waiting})`, 'primary') : ''}${canEdit(ctx.user, MODULES.checklists) ? UI.button('/checklists', 'Templates') : ''}${UI.button('/checklist_runs?view=week', 'Register')}`;
  const body = html`
${UI.pageHeader('My checklists', `${F.dayName(t)}, ${F.fmtDate(t)}${ctx.user.department ? ` · ${ctx.user.department}` : ''}`, actions)}
${section('To do today', todo, 'Nothing left to fill in today.')}
${late.length ? section('Missed', late, '') : ''}
${todo.length || done.length || !team.length ? section('Done today', done, 'Nothing filled in yet today.') : ''}
${team.length ? section(admin ? 'Everyone today' : `${ctx.user.department} today`, team, '', true) : ''}
${!todo.length && !late.length && !done.length && !ctx.user.department && !admin ? html`<p class="alert alert-info">Checklists are given by department. Ask an admin to set yours on the Users page.</p>` : ''}`;
  ctx.page('My checklists', body, { active: 'my-checklists' });
}

// ---------- one checklist: fill in, read, sign off ----------

function answerView(a) {
  let value;
  if (a.kind === 'reading') value = a.value != null ? html`<b class="num${a.ok === 0 ? ' tone-text-bad' : ''}">${F.num(Number(a.value))}${a.unit ? ` ${a.unit}` : ''}</b>${a.min != null ? html`<span class="sub">limits ${CL.limits(a)}</span>` : ''}` : C.dash;
  else value = a.value === 'ok' ? C.badge('OK', 'ok') : a.value === 'not_ok' ? C.badge('Not OK', 'bad') : a.value === 'na' ? C.badge('N/A', 'muted') : C.dash;
  return html`<li class="cl-item is-read${a.ok === 0 ? ' is-bad' : ''}"><div class="cl-q"><span class="cl-n">${a.position}</span><span>${a.text}</span></div><div class="cl-a">${value}</div>${a.note ? html`<div class="cl-note-read">${a.note}</div>` : ''}</li>`;
}

function answerInput(a, vals, errs) {
  const v = vals[`a_${a.id}`] ?? a.value ?? '';
  const note = vals[`n_${a.id}`] ?? a.note ?? '';
  const err = errs[a.id];
  // `required` lets the phone itself ask for a missed answer, before any photo is sent.
  const control = a.kind === 'reading'
    ? html`<div class="cl-reading"><input type="text" inputmode="decimal" name="a_${a.id}" value="${v}" required aria-label="${a.text}" autocomplete="off"><span class="cl-limit">${CL.limits(a) || 'reading'}</span></div>`
    : html`<div class="seg" role="radiogroup" aria-label="${a.text}">${[['ok', 'OK', 'seg-ok'], ['not_ok', 'Not OK', 'seg-bad'], ['na', 'N/A', 'seg-na']].map(([val, label, cls]) => html`<label class="${cls}"><input type="radio" name="a_${a.id}" value="${val}" required${v === val ? html` checked` : ''}><span>${label}</span></label>`)}</div>`;
  // The limits also go to public/app.js, which asks for a note on a reading outside them.
  const limits = a.kind === 'reading' ? html`${a.min != null ? html` data-min="${a.min}"` : ''}${a.max != null ? html` data-max="${a.max}"` : ''}` : '';
  return html`<li class="cl-item${err ? ' has-error' : ''}"${limits}><div class="cl-q"><span class="cl-n">${a.position}</span><span>${a.text}</span></div>
${control}
<input class="cl-note" type="text" name="n_${a.id}" value="${note}" placeholder="Note: what is wrong, what was done" aria-label="Note for ${a.text}">
${err ? html`<div class="err">${err}</div>` : ''}</li>`;
}

function runPage(ctx, id, { vals = {}, errs = {}, formError = '', status = 200 } = {}) {
  const db = ctx.db;
  const r = getRun(db, id);
  const answers = db.all('SELECT * FROM checklist_answers WHERE run_id = :id ORDER BY position', { id });
  const files = U.listFor(db, 'checklist_runs', id);
  const t = F.today();
  const fillable = CL.RUN_OPEN.includes(r.status) && CL.canFillRun(ctx.user, r);
  const missed = CL.RUN_OPEN.includes(r.status) && r.due_on < t;
  const sub = html`${r.department}${r.asset_code ? html` · ${r.asset_code} ${r.asset_name}` : ''} · ${r.due_on === t ? 'due today' : `due ${F.fmtDate(r.due_on)}`} · ${r.assignee_name ? `for ${r.assignee_name}` : `anyone in ${r.department}`}`;
  const head = html`<p class="crumbs"><a href="/my-checklists">← My checklists</a></p>
${UI.pageHeader(html`${r.title} ${missed ? C.badge('Missed', 'bad') : C.runStatus(r.status)}`, sub)}`;
  let main;
  if (fillable) {
    const errCount = Object.keys(errs).length;
    main = html`<form method="post" action="/checklist_runs/${id}/submit" enctype="multipart/form-data" class="cl-form">
${C.csrf(ctx)}
${r.status === 'Returned' && r.review_note ? html`<div class="alert alert-error" role="alert"><b>Sent back by ${r.reviewer_name || 'the head'}:</b> ${r.review_note}</div>` : ''}
${formError ? html`<div class="alert alert-error" role="alert">${formError}</div>` : errCount ? html`<div class="alert alert-error" role="alert">${F.plural(errCount, 'item needs', 'items need')} an answer or a note, marked below. Add the photos again before you send.</div>` : ''}
<ol class="cl-items">${answers.map((a) => answerInput(a, vals, errs))}</ol>
<div class="card"><div class="card-b fgrid">
  <div class="field wide"><label for="cl_remarks">Remarks</label><textarea id="cl_remarks" name="remarks" rows="2" placeholder="Anything else the head should know">${vals.remarks ?? r.remarks ?? ''}</textarea></div>
  <div class="field wide"><label for="cl_files">Photos or PDF</label><input id="cl_files" class="cl-file" type="file" name="files" accept="image/*,application/pdf" multiple data-max-files="${U.MAX_FILES}" data-max-mb="${U.MAX_FILE / 1024 / 1024}"><div class="help">Optional. Up to 5 files, 8 MB each.</div></div>
</div></div>
<button class="btn btn-primary btn-block cl-submit" type="submit">${r.needs_approval ? 'Submit for sign-off' : 'Submit'}</button>
</form>`;
  } else {
    main = html`<ol class="cl-items">${answers.map(answerView)}</ol>
${r.remarks ? html`<div class="card"><div class="card-b"><b>Remarks</b><p class="tl-notes">${r.remarks}</p></div></div>` : ''}
${CL.RUN_OPEN.includes(r.status) ? html`<p class="alert alert-info">${r.assignee_name ? `${r.assignee_name} fills this in.` : `Anyone in ${r.department} can fill this in.`}</p>` : ''}`;
  }
  const who = r.submitted_at ? html`<p class="meta">Filled in by ${r.submitter_name || 'someone'} on ${F.fmtDateTime(r.submitted_at)}${F.localDay(r.submitted_at) > r.due_on ? html` <b class="tone-text-warn">(late)</b>` : ''}${r.reviewed_at ? html` · ${r.status === 'Approved' ? 'signed off' : 'sent back'} by ${r.reviewer_name} on ${F.fmtDateTime(r.reviewed_at)}${r.review_note && r.status !== 'Returned' ? html`: “${r.review_note}”` : ''}` : ''}</p>` : '';
  const review = r.status === 'Submitted' && CL.canReviewRun(ctx.user, r)
    ? html`<section class="card" id="review"><div class="card-h"><h2>Sign-off</h2>${r.issues ? html`<span class="tone-text-bad"><b>${F.plural(r.issues, 'problem')}</b> reported</span>` : html`<span class="tone-text-ok">No problems reported</span>`}</div><div class="card-b">
<form method="post" action="/checklist_runs/${id}/review" class="form">${C.csrf(ctx)}
<div class="field"><label for="rv_note">Remark</label><textarea id="rv_note" name="note" rows="2" placeholder="Needed when sending it back"></textarea></div>
<div class="form-actions spaced"><button class="btn btn-primary" name="decision" value="approve" type="submit">Sign off</button><button class="btn" name="decision" value="return" type="submit">Send back</button></div>
</form></div></section>`
    : '';
  const canAddFiles = !fillable && (CL.canFillRun(ctx.user, r) || CL.canReviewRun(ctx.user, r));
  const evidence = files.length || canAddFiles
    ? html`<section class="card"><div class="card-h"><h2>Photos and documents</h2><span class="dim">${files.length}</span></div><div class="card-b">${U.gallery(files)}${canAddFiles ? html`<form method="post" action="/checklist_runs/${id}/files" enctype="multipart/form-data" class="inline-upload">${C.csrf(ctx)}<input type="file" name="files" accept="image/*,application/pdf" multiple required aria-label="Add photos or PDF"><button class="btn btn-sm" type="submit">Add</button></form>` : ''}</div></section>`
    : '';
  ctx.page(r.title, html`${head}${main}${who}${review}${evidence}`, { active: 'my-checklists', status });
}

function submitRun(ctx) {
  const id = Number(ctx.params.id);
  const db = ctx.db;
  const r = getRun(db, id);
  if (!CL.canFillRun(ctx.user, r)) throw new HttpError(403, `Only ${r.assignee_name || `people in ${r.department}`}, the head of ${r.department} or an admin can fill this in.`);
  if (!CL.RUN_OPEN.includes(r.status)) { ctx.flash('error', 'This checklist is already sent. Open My checklists to see what is still to do.'); return ctx.redirect(`/checklist_runs/${id}`); }
  const answers = db.all('SELECT * FROM checklist_answers WHERE run_id = :id ORDER BY position', { id });
  const errs = {};
  const results = answers.map((a) => {
    const res = CL.judge(a, String(ctx.body[`a_${a.id}`] ?? '').trim());
    const note = String(ctx.body[`n_${a.id}`] ?? '').trim().slice(0, 500);
    if (res.error) errs[a.id] = res.error;
    else if (res.ok === 0 && !note) errs[a.id] = a.kind === 'reading' ? 'Outside the limits: say what was done' : 'Say what is wrong';
    return { a, ...res, note: note || null };
  });
  if (Object.keys(errs).length) return runPage(ctx, id, { vals: ctx.body, errs, status: 422 });
  let checked;
  try { checked = U.checkFiles(ctx.files); } catch (err) {
    if (err instanceof HttpError) return runPage(ctx, id, { vals: ctx.body, formError: err.message, status: 422 });
    throw err;
  }
  const issues = results.filter((x) => x.ok === 0).length;
  const status = r.needs_approval ? 'Submitted' : 'Done';
  db.tx(() => {
    for (const x of results) db.run('UPDATE checklist_answers SET value = :v, ok = :ok, note = :n WHERE id = :id', { v: x.value, ok: x.ok, n: x.note, id: x.a.id });
    db.run(`UPDATE checklist_runs SET status = :s, issues = :i, remarks = :rm, submitted_by = :u, submitted_at = datetime('now'),
            reviewed_by = NULL, reviewed_at = NULL, updated_at = datetime('now') WHERE id = :id`, {
      s: status, i: issues, rm: String(ctx.body.remarks || '').trim().slice(0, 2000) || null, u: ctx.user.id, id,
    });
    U.saveFiles(ctx, 'checklist_runs', id, checked);
    ctx.audit({ entity: 'checklist_runs', entityId: id, action: 'updated', summary: `filled in “${r.title}” for ${F.fmtDate(r.due_on)}${issues ? ` with ${F.plural(issues, 'problem')}` : ''}` });
  });
  ctx.flash('ok', `${r.title}: ${r.needs_approval ? 'sent for sign-off' : 'done'}.${issues ? ` ${F.plural(issues, 'problem')} recorded for the head to see.` : ''}`);
  ctx.redirect('/my-checklists');
}

function reviewRun(ctx) {
  const id = Number(ctx.params.id);
  const r = getRun(ctx.db, id);
  if (!CL.canReviewRun(ctx.user, r)) throw new HttpError(403, `Only the head of ${r.department} or an admin can sign this off. Nobody signs off a checklist they filled in.`);
  const back = safeReturn(ctx.body.return, `/checklist_runs/${id}`);
  if (r.status !== 'Submitted') { ctx.flash('error', 'This checklist is not waiting for sign-off. Someone signed it off or sent it back already.'); return ctx.redirect(back); }
  const approve = ctx.body.decision !== 'return';
  const note = String(ctx.body.note || '').trim().slice(0, 1000);
  if (!approve && !note) { ctx.flash('error', 'Say what needs doing again before sending it back.'); return ctx.redirect(`/checklist_runs/${id}#review`); }
  ctx.db.tx(() => {
    ctx.db.run("UPDATE checklist_runs SET status = :s, reviewed_by = :u, reviewed_at = datetime('now'), review_note = :n, updated_at = datetime('now') WHERE id = :id", {
      s: approve ? 'Approved' : 'Returned', u: ctx.user.id, n: note || null, id,
    });
    ctx.audit({ entity: 'checklist_runs', entityId: id, action: 'updated', summary: `${approve ? 'signed off' : 'sent back'} “${r.title}” for ${F.fmtDate(r.due_on)}${note ? `: ${note}` : ''}` });
  });
  ctx.flash('ok', approve ? `${r.title} signed off.` : `${r.title} sent back to ${r.submitter_name || 'the person who filled it in'}.`);
  ctx.redirect(back);
}

function addRunFiles(ctx) {
  const id = Number(ctx.params.id);
  const r = getRun(ctx.db, id);
  if (!CL.canFillRun(ctx.user, r) && !CL.canReviewRun(ctx.user, r)) throw new HttpError(403, 'You can’t add files to this checklist.');
  const checked = U.checkFiles(ctx.files);
  if (!checked.length) { ctx.flash('error', 'Pick a photo or PDF first.'); return ctx.redirect(`/checklist_runs/${id}`); }
  ctx.db.tx(() => U.saveFiles(ctx, 'checklist_runs', id, checked));
  ctx.flash('ok', `${F.plural(checked.length, 'file')} added.`);
  ctx.redirect(`/checklist_runs/${id}`);
}

// ---------- approvals: checklists and finished jobs waiting for this person ----------

function approvalsFor(ctx) {
  const u = ctx.user;
  // The SQL narrows to this person's department (or everything for an admin); the permission
  // check then has the last word.
  const p = { me: u.id, dept: u.department || '', admin: isAdmin(u) ? 1 : 0, head: u.is_head ? 1 : 0 };
  const runs = ctx.db.all(`${RUN_SQL} WHERE r.status = 'Submitted' AND (:admin = 1 OR (:head = 1 AND r.department = :dept))
                           ORDER BY r.due_on, c.title`, p).filter((r) => CL.canReviewRun(u, r));
  const jobs = ctx.db.all(`SELECT j.*, a.name AS assignee_name FROM jobs j JOIN users a ON a.id = j.assigned_to
                           WHERE j.status = 'Done' AND j.approved_at IS NULL
                             AND (:admin = 1 OR j.assigned_by = :me OR (:head = 1 AND j.department = :dept))
                           ORDER BY j.done_on`, p)
    .filter((j) => canManageJob(u, j) && (j.assigned_to !== u.id || isAdmin(u)));
  return [...runs.map((r) => ({ type: 'run', r })), ...jobs.map((j) => ({ type: 'job', j }))];
}

function approvalsPage(ctx) {
  const items = approvalsFor(ctx);
  const ret = '/approvals';
  const runs = items.filter((x) => x.type === 'run').map((x) => x.r);
  const jobs = items.filter((x) => x.type === 'job').map((x) => x.j);
  const runList = runs.length ? html`<ul class="cl-list">${runs.map((r) => html`<li class="cl-approve">
<a class="cl-card" href="/checklist_runs/${r.id}#review"><span class="cl-card-main"><b>${r.title}</b><span class="sub">${r.department} · ${F.fmtDate(r.due_on)} · by ${r.submitter_name || '—'}</span></span>
<span class="cl-card-side">${r.issues ? html`<span class="tone-text-bad"><b>${F.plural(r.issues, 'problem')}</b></span>` : html`<span class="tone-text-ok">No problems</span>`}</span></a>
${r.issues ? '' : html`<form method="post" action="/checklist_runs/${r.id}/review" class="inline">${C.csrf(ctx)}<input type="hidden" name="return" value="${ret}"><button class="btn btn-sm" name="decision" value="approve" type="submit" aria-label="Sign off: ${r.title}, ${F.fmtDate(r.due_on)}">Sign off</button></form>`}
</li>`)}</ul>` : html`<p class="dim">No checklists waiting for you.</p>`;
  const jobList = jobs.length ? html`<ul class="cl-list">${jobs.map((j) => html`<li class="cl-approve">
<a class="cl-card" href="/jobs/${j.id}/edit"><span class="cl-card-main"><b>${j.title}</b><span class="sub">${j.department} · done by ${j.assignee_name} on ${F.fmtDate(j.done_on)}${j.due_on && j.done_on > j.due_on ? ' (late)' : ''}</span></span><span class="cl-card-side">${C.badge(j.priority)}</span></a>
<form method="post" action="/jobs/${j.id}/review" class="inline">${C.csrf(ctx)}<input type="hidden" name="return" value="${ret}"><button class="btn btn-sm" name="decision" value="approve" type="submit" aria-label="Sign off: ${j.title}">Sign off</button></form>
</li>`)}</ul>` : html`<p class="dim">No finished jobs waiting for you.</p>`;
  const body = html`
${UI.pageHeader('Sign-offs', 'Checklists and finished jobs that wait for your sign-off. Open one to see the answers, photos and notes, or to send it back.')}
<section class="cl-section"><h2>Checklists <span class="dim">${runs.length}</span></h2>${runList}</section>
<section class="cl-section"><h2>Finished jobs <span class="dim">${jobs.length}</span></h2>${jobList}</section>`;
  ctx.page('Sign-offs', body, { active: 'approvals' });
}

// ---------- compliance: mark done ----------

const canFileCompliance = (u, item) => isAdmin(u) || u.role === 'accounts' || item.owner_id === u.id || (!!u.is_head && u.department === item.department);

function complianceExtra(ctx, id) {
  const db = ctx.db;
  const item = db.get('SELECT * FROM compliance_items WHERE id = :id', { id });
  if (!item) return '';
  const filings = db.all(`SELECT f.*, u.name AS done_by_name FROM compliance_filings f LEFT JOIN users u ON u.id = f.done_by
                          WHERE f.item_id = :id ORDER BY f.done_on DESC, f.id DESC LIMIT 24`, { id });
  const next = CL.nextDueFor(item);
  const form = item.active && canFileCompliance(ctx.user, item)
    ? html`<form method="post" action="/compliance_items/${id}/done" enctype="multipart/form-data" class="form">${C.csrf(ctx)}
<div class="fgrid">
  <div class="field"><label for="cf_done">Done on</label><input id="cf_done" type="date" name="done_on" value="${F.today()}" required></div>
  <div class="field"><label for="cf_ref">Reference</label><input id="cf_ref" name="reference" placeholder="ARN, challan or certificate no"></div>
  <div class="field"><label for="cf_amt">Amount paid (₹)</label><input id="cf_amt" name="amount" inputmode="decimal" class="num" autocomplete="off"></div>
  <div class="field"><label for="cf_next">Next due on</label><input id="cf_next" type="date" name="next_due" value="${next || ''}"${next ? html` required` : ''}><div class="help">${next ? 'Worked out from how often it is due. Change it if the date moves.' : 'One-time: leave blank and it is closed.'}</div></div>
  <div class="field wide"><label for="cf_note">Note</label><input id="cf_note" name="note"></div>
  <div class="field wide"><label for="cf_files">Proof: challan, acknowledgement, certificate</label><input id="cf_files" type="file" name="files" accept="image/*,application/pdf" multiple></div>
</div>
<div class="form-actions spaced"><button class="btn btn-primary" type="submit">Mark done for ${F.fmtDate(item.due_on)}</button></div>
</form>` : '';
  const history = filings.length
    ? html`<ol class="tl">${filings.map((f) => html`<li class="tl-item"><div class="tl-day"><b>${F.fmtDate(f.done_on)}</b>for ${F.fmtDate(f.period_due_on)}</div><div>
<div class="tl-title">${f.done_by_name || 'Someone'} ${f.done_on > f.period_due_on ? C.badge('Late', 'warn') : C.badge('On time', 'ok')}</div>
<div class="tl-meta">${[f.reference && `Ref ${f.reference}`, f.amount != null && F.money(f.amount), f.note].filter(Boolean).join(' · ')}</div>
${U.gallery(U.listFor(db, 'compliance_filings', f.id))}</div></li>`)}</ol>`
    : html`<p class="dim">Not marked done yet.</p>`;
  return html`<section class="card" id="done"><div class="card-h"><h2>Mark done</h2>${C.due(item.due_on, !!item.active)}</div><div class="card-b">${form}${form ? html`<div class="spacer"></div>` : ''}<h3 class="section-title mini">History</h3>${history}</div></section>`;
}

function complianceDone(ctx) {
  const id = Number(ctx.params.id);
  const item = ctx.db.get('SELECT * FROM compliance_items WHERE id = :id', { id });
  if (!item) throw new HttpError(404, "That compliance item doesn't exist.");
  if (!canFileCompliance(ctx.user, item)) throw new HttpError(403, 'Only its owner, accounts, the department head or an admin can mark this done.');
  const back = `/compliance_items/${id}/edit#done`;
  const fail = (msg) => { ctx.flash('error', msg); ctx.redirect(back); };
  const doneOn = String(ctx.body.done_on || '');
  if (!F.isIsoDate(doneOn) || doneOn > F.today()) return fail('Enter the date it was done (not in the future).');
  const nextDue = String(ctx.body.next_due || '');
  if (item.frequency !== 'One-time' && (!F.isIsoDate(nextDue) || nextDue <= item.due_on)) return fail(`Enter the next due date, after ${F.fmtDate(item.due_on)}.`);
  const amountRaw = String(ctx.body.amount || '').replace(/[,\s₹]/g, '');
  const amount = amountRaw ? Number(amountRaw) : null;
  if (amountRaw && (!Number.isFinite(amount) || amount < 0)) return fail('Enter the amount in rupees, or leave it blank.');
  let checked;
  try { checked = U.checkFiles(ctx.files); } catch (err) { if (err instanceof HttpError) return fail(err.message); throw err; }
  ctx.db.tx(() => {
    const f = ctx.db.run(`INSERT INTO compliance_filings (item_id, period_due_on, done_on, done_by, reference, amount, note)
                          VALUES (:i, :p, :d, :u, :ref, :amt, :n)`, {
      i: id, p: item.due_on, d: doneOn, u: ctx.user.id, ref: String(ctx.body.reference || '').trim().slice(0, 100) || null,
      amt: amount, n: String(ctx.body.note || '').trim().slice(0, 500) || null,
    });
    if (item.frequency === 'One-time' && !F.isIsoDate(nextDue)) ctx.db.run("UPDATE compliance_items SET active = 0, updated_at = datetime('now') WHERE id = :id", { id });
    else {
      // A date typed in by hand sets the day of the month from now on; the suggested one keeps it.
      const day = nextDue === CL.nextDueFor(item) ? item.due_day : Number(nextDue.slice(8));
      ctx.db.run("UPDATE compliance_items SET due_on = :d, due_day = :day, updated_at = datetime('now') WHERE id = :id", { d: nextDue, day, id });
    }
    U.saveFiles(ctx, 'compliance_filings', f.id, checked);
    ctx.audit({ entity: 'compliance_items', entityId: id, action: 'updated', summary: `marked “${item.title}” done for ${F.fmtDate(item.due_on)}` });
  });
  ctx.flash('ok', `${item.title}: done for ${F.fmtDate(item.due_on)}.${item.frequency !== 'One-time' ? ` Next due ${F.fmtDate(nextDue)}.` : ''}`);
  ctx.redirect('/compliance_items');
}

// ---------- standard sets (admin) ----------

function addStandardChecklists(ctx) {
  if (!isAdmin(ctx.user)) throw new HttpError(403, 'Only an admin can add the standard checklists.');
  let added = 0;
  ctx.db.tx(() => {
    for (const s of CL.STANDARD_CHECKLISTS) {
      if (ctx.db.get('SELECT id FROM checklists WHERE title = :t COLLATE NOCASE', { t: s.title })) continue;
      const id = ctx.db.run(`INSERT INTO checklists (title, department, frequency, weekday, month_day, needs_approval, items_text)
                             VALUES (:t, :d, :f, :w, :m, :a, :items)`, {
        t: s.title, d: s.department, f: s.frequency, w: s.weekday || null, m: s.month_day || null, a: s.needs_approval, items: s.items.join('\n'),
      }).id;
      CL.refreshToday(ctx.db, ctx.db.get('SELECT * FROM checklists WHERE id = :id', { id }));
      added += 1;
    }
    ctx.audit({ entity: 'checklists', action: 'created', summary: `added ${F.plural(added, 'standard checklist')}` });
  });
  ctx.flash('ok', added ? `Added ${F.plural(added, 'standard checklist')}. Open each one to choose who fills it in.` : 'The standard checklists are already here.');
  ctx.redirect('/checklists');
}

function addStandardCompliance(ctx) {
  if (!isAdmin(ctx.user)) throw new HttpError(403, 'Only an admin can add the standard dates.');
  let added = 0;
  ctx.db.tx(() => {
    for (const [title, category, frequency, rule, authority] of CL.STANDARD_COMPLIANCE) {
      if (ctx.db.get('SELECT id FROM compliance_items WHERE title = :t COLLATE NOCASE', { t: title })) continue;
      ctx.db.run(`INSERT INTO compliance_items (title, category, frequency, due_on, remind_days, department, authority, notes)
                  VALUES (:t, :c, :f, :d, 7, 'Accounts', :a, 'Standard due date. Check for extensions announced by the authority.')`, {
        t: title, c: category, f: frequency, d: CL.firstDue(rule), a: authority,
      });
      added += 1;
    }
    ctx.audit({ entity: 'compliance_items', action: 'created', summary: `added ${F.plural(added, 'standard compliance date')}` });
  });
  ctx.flash('ok', added ? `Added ${F.plural(added, 'statutory due date')}. Add your licence, insurance and calibration renewals with their own dates.` : 'The standard dates are already here.');
  ctx.redirect('/compliance_items?view=active');
}

// ---------- scorecards ----------

function scorecardsPage(ctx) {
  const ws = F.isIsoDate(ctx.query.week) ? F.weekOf(ctx.query.week) : F.weekOf(F.today());
  const thisWeek = F.weekOf(F.today());
  const s = CL.scorecard(ctx.db, ws);
  const prog = (v) => (v == null ? C.dash : html`<span class="score"><progress max="100" value="${v}" class="${v >= 90 ? 'is-ok' : v >= 70 ? 'is-warn' : 'is-bad'}"></progress><b class="num">${v}%</b></span>`);
  const n = (v, tone) => (v ? html`<span class="num${tone ? ` tone-text-${tone}` : ''}">${v}</span>` : C.dash);
  const cols = (first) => [
    first,
    { label: 'On time', render: (r) => prog(r.score) },
    { label: 'Checklists due', cls: 'r', render: (r) => n(r.due) },
    { label: 'Done on time', cls: 'r', render: (r) => n(r.onTime, 'ok') },
    { label: 'Late', cls: 'r', render: (r) => n(r.late, 'warn') },
    { label: 'Missed', cls: 'r', render: (r) => n(r.missed, 'bad') },
    { label: 'Problems found', cls: 'r', render: (r) => n(r.issues) },
    { label: 'Jobs due', cls: 'r', render: (r) => n(r.jobsDue) },
    { label: 'Jobs on time', cls: 'r', render: (r) => n(r.jobsOnTime, 'ok') },
    { label: 'Jobs late or overdue', cls: 'r', render: (r) => n(r.jobsOverdue + r.jobsLate, 'bad') },
  ];
  const tot = s.depts.reduce((a, d) => ({ due: a.due + d.due, on: a.on + d.onTime, missed: a.missed + d.missed, pending: a.pending + d.pending, jd: a.jd + d.jobsDue, jo: a.jo + d.jobsOnTime }), { due: 0, on: 0, missed: 0, pending: 0, jd: 0, jo: 0 });
  const counted = tot.due - tot.pending;
  const tiles = html`<div class="tiles">
${UI.tile({ label: 'Checklists done on time', value: counted ? `${F.pct(tot.on, counted)}%` : '—', sub: `${tot.on} of ${counted}${tot.missed ? ` · ${tot.missed} missed` : ''}`, tone: tot.missed ? 'bad' : '', href: '/checklist_runs?view=missed' })}
${UI.tile({ label: 'Jobs done on time', value: tot.jd ? `${F.pct(tot.jo, tot.jd)}%` : '—', sub: `${tot.jo} of ${tot.jd} due ${ws === thisWeek ? 'so far this week' : 'that week'}`, href: '/jobs?view=overdue' })}
${UI.tile({ label: 'Preventive maintenance', value: `${s.pm.done} / ${s.pm.planned}`, sub: `PM tasks done ${ws === thisWeek ? 'this week' : 'that week'}`, href: `/pm_tasks?view=all&week=${ws}` })}
${UI.tile({ label: 'Compliance overdue', value: s.complianceOverdue.length, sub: s.complianceOverdue.length ? 'Open the calendar' : 'Nothing overdue', tone: s.complianceOverdue.length ? 'bad' : 'ok', href: '/compliance_items?view=overdue' })}
</div>`;
  const nav = html`<nav class="chips week-nav" aria-label="Weeks">
<a class="chip" href="/scorecards?week=${F.addDays(ws, -7)}">← ${F.weekLabel(F.addDays(ws, -7))}</a>
<a class="chip${ws === thisWeek ? ' is-active' : ''}" href="/scorecards">This week</a>
${F.addDays(ws, 7) < thisWeek ? html`<a class="chip" href="/scorecards?week=${F.addDays(ws, 7)}">${F.weekLabel(F.addDays(ws, 7))} →</a>` : ''}
</nav>`;
  const missed = s.missed.length ? UI.table([
    { label: 'Due', render: (r) => C.date(r.due_on) },
    { label: 'Checklist', render: (r) => html`<a class="rowlink" href="/checklist_runs/${r.id}">${r.title}</a>` },
    { label: 'Department', render: (r) => r.department },
    { label: 'Was for', render: (r) => C.text(r.assignee_name || `Anyone in ${r.department}`) },
  ], s.missed, { ctx }) : html`<div class="empty">Nothing missed this week.</div>`;
  const overdue = s.complianceOverdue.length ? UI.table([
    { label: 'Due', render: (r) => C.due(r.due_on, true) },
    { label: 'What', render: (r) => html`<a class="rowlink" href="/compliance_items/${r.id}/edit#done">${r.title}</a><span class="sub">${r.category}</span>` },
    { label: 'Owner', render: (r) => C.text(r.owner_name) },
  ], s.complianceOverdue, { ctx }) : html`<div class="empty">No compliance item overdue.</div>`;
  const body = html`
${UI.pageHeader('Scorecards', html`Week of <b>${F.weekLabel(ws)}</b>${ws === thisWeek ? ' · counted up to today' : ''}. On time means finished by the day it was due.`)}
${nav}
${tiles}
<section class="card"><div class="card-h"><h2>By department</h2></div>${UI.table(cols({ label: 'Department', render: (r) => html`<b>${r.label}</b>` }), s.depts, { ctx, empty: 'Nothing was due this week.' })}</section>
<section class="card"><div class="card-h"><h2>By person</h2></div>${UI.table(cols({ label: 'Person', render: (r) => html`<b>${r.label}</b>` }), s.people, { ctx, empty: 'Nothing was due this week.' })}</section>
<div class="cols-even">
  <section class="card"><div class="card-h"><h2>Missed checklists</h2><a href="/checklist_runs?view=missed">All missed</a></div>${missed}</section>
  <section class="card"><div class="card-h"><h2>Compliance overdue</h2><a href="/compliance_items?view=overdue">Calendar</a></div>${overdue}</section>
</div>`;
  ctx.page('Scorecards', body, { active: 'scorecards' });
}

// ---------- files ----------

function deleteFile(ctx) {
  const f = ctx.db.get('SELECT * FROM attachments WHERE id = :id', { id: Number(ctx.params.id) });
  if (!f) throw new HttpError(404, 'That file is no longer here.');
  // Evidence is the record of what was found: only an admin removes it, and the removal is logged.
  if (!isAdmin(ctx.user)) throw new HttpError(403, 'Only an admin can remove a photo or document.');
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM attachments WHERE id = :id', { id: f.id });
    ctx.audit({ entity: f.entity, entityId: f.entity_id, action: 'updated', summary: `removed the file “${f.filename}”` });
  });
  try { require('node:fs').rmSync(require('node:path').join(ctx.cfg.dataDir, 'uploads', f.stored), { force: true }); } catch { /* already gone */ }
  ctx.flash('ok', 'File removed.');
  ctx.redirect(safeReturn(ctx.body.return, '/'));
}

function register(router) {
  router.on('GET', '/my-checklists', myChecklists);
  router.on('GET', '/approvals', approvalsPage);
  router.on('GET', '/scorecards', scorecardsPage);
  router.on('GET', '/checklist_runs/:id', (ctx) => runPage(ctx, Number(ctx.params.id)));
  router.on('GET', '/checklist_runs/:id/edit', (ctx) => ctx.redirect(`/checklist_runs/${ctx.params.id}`));
  router.on('POST', '/checklist_runs/:id/submit', submitRun, { multipart: true });
  router.on('POST', '/checklist_runs/:id/review', reviewRun);
  router.on('POST', '/checklist_runs/:id/files', addRunFiles, { multipart: true });
  router.on('POST', '/checklists/standard', addStandardChecklists);
  router.on('POST', '/compliance_items/standard', addStandardCompliance);
  router.on('POST', '/compliance_items/:id/done', complianceDone, { multipart: true });
  router.on('GET', '/attachments/:id', U.serve);
  router.on('POST', '/attachments/:id/delete', deleteFile);
}

module.exports = { register, complianceExtra, approvalsFor };
