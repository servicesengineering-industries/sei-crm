'use strict';
// Progress on a job: the person doing it (and whoever gave it, the department head or an admin)
// posts an update, moves the status, or clicks Start / Done from a list.
const F = require('../format');
const { OPT, canManageJob, canUpdateJob } = require('../modules');
const { HttpError, safeReturn } = require('../http');
const U = require('../uploads');

function postUpdate(ctx) {
  const id = Number(ctx.params.id);
  const job = ctx.db.get('SELECT j.*, a.name AS assignee_name FROM jobs j JOIN users a ON a.id = j.assigned_to WHERE j.id = :id', { id });
  if (!job) throw new HttpError(404, "That job doesn't exist. It may have been deleted.");
  if (!canUpdateJob(ctx.user, job)) {
    throw new HttpError(403, 'Only the person doing this job, the person who gave it, the head of its department or an admin can update it.');
  }
  const back = safeReturn(ctx.body.return, `/jobs/${id}/edit`);
  let status = OPT.jobStatus.includes(ctx.body.status) ? ctx.body.status : job.status;
  // Cancelling, and reopening a cancelled job, are the decision of whoever gave the job, not the person doing it.
  if ((status === 'Cancelled' || job.status === 'Cancelled') && status !== job.status && !canManageJob(ctx.user, job)) status = job.status;
  const note = String(ctx.body.note || '').trim().slice(0, 2000);
  let checked;
  try { checked = U.checkFiles(ctx.files || []); } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    ctx.flash('error', err.message);
    return ctx.redirect(back);
  }
  if (status === job.status && !note && !checked.length) {
    ctx.flash('error', 'Write an update, add a photo or change the status.');
    return ctx.redirect(back);
  }
  const changed = status !== job.status;
  const doneOn = status === 'Done' ? (job.status === 'Done' && job.done_on) || F.today() : null;
  ctx.db.tx(() => {
    // Reopening a finished job clears its approval.
    if (changed) ctx.db.run("UPDATE jobs SET status = :s, done_on = :d, approved_by = NULL, approved_at = NULL, updated_at = datetime('now') WHERE id = :id", { s: status, d: doneOn, id });
    const upd = ctx.db.run('INSERT INTO job_updates (job_id, user_id, status, note) VALUES (:j, :u, :s, :n)', {
      j: id, u: ctx.user.id, s: changed ? status : null, n: note || (checked.length && !changed ? `Added ${F.plural(checked.length, 'photo or document', 'photos or documents')}.` : null),
    });
    U.saveFiles(ctx, 'job_updates', upd.id, checked);
    ctx.audit({
      clientId: job.client_id, entity: 'jobs', entityId: id, action: 'updated',
      summary: `${changed ? `moved job “${job.title}” ${job.status} → ${status}` : `posted an update on job “${job.title}”`}${note ? `: ${note.length > 120 ? `${note.slice(0, 119)}…` : note}` : ''}`,
    });
  });
  ctx.flash('ok', changed ? `“${job.title}” is now ${status.toLowerCase()}.` : 'Update posted.');
  ctx.redirect(back);
}

// Sign-off on a finished job by whoever gave it, the department head or an admin.
function reviewJob(ctx) {
  const id = Number(ctx.params.id);
  const job = ctx.db.get('SELECT j.*, a.name AS assignee_name FROM jobs j JOIN users a ON a.id = j.assigned_to WHERE j.id = :id', { id });
  if (!job) throw new HttpError(404, "That job doesn't exist. It may have been deleted.");
  if (!canManageJob(ctx.user, job) || (job.assigned_to === ctx.user.id && ctx.user.role !== 'admin')) {
    throw new HttpError(403, 'Only the person who gave this job, the head of its department or an admin can sign it off.');
  }
  const back = safeReturn(ctx.body.return, `/jobs/${id}/edit`);
  if (job.status !== 'Done' || job.approved_at) { ctx.flash('error', 'This job is not waiting for sign-off. Someone signed it off already, or it is not finished.'); return ctx.redirect(back); }
  const approve = ctx.body.decision !== 'return';
  const note = String(ctx.body.note || '').trim().slice(0, 1000);
  if (!approve && !note) { ctx.flash('error', 'Say what still needs doing before sending it back.'); return ctx.redirect(`/jobs/${id}/edit#progress`); }
  ctx.db.tx(() => {
    if (approve) ctx.db.run("UPDATE jobs SET approved_by = :u, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = :id", { u: ctx.user.id, id });
    else ctx.db.run("UPDATE jobs SET status = 'In progress', done_on = NULL, updated_at = datetime('now') WHERE id = :id", { id });
    ctx.db.run('INSERT INTO job_updates (job_id, user_id, status, note) VALUES (:j, :u, :s, :n)', {
      j: id, u: ctx.user.id, s: approve ? null : 'In progress', n: approve ? `Signed off.${note ? ` ${note}` : ''}` : `Sent back: ${note}`,
    });
    ctx.audit({ clientId: job.client_id, entity: 'jobs', entityId: id, action: 'updated', summary: `${approve ? 'signed off' : 'sent back'} job “${job.title}”${note ? `: ${note}` : ''}` });
  });
  ctx.flash('ok', approve ? `“${job.title}” signed off.` : `“${job.title}” sent back to ${job.assignee_name}.`);
  ctx.redirect(back);
}

function register(router) {
  router.on('POST', '/jobs/:id/update', postUpdate, { multipart: true });
  router.on('POST', '/jobs/:id/review', reviewJob);
}

module.exports = { register };
