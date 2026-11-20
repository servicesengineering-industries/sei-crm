'use strict';
const F = require('../format');
const { MODULES } = require('../modules');
const { requireEdit } = require('../crud');
const { HttpError, safeReturn } = require('../http');

function register(router) {
  // One-click "Done" from lists, the dashboard and client pages.
  router.on('POST', '/followups/:id/done', (ctx) => {
    const mod = MODULES.followups;
    requireEdit(ctx, mod);
    const id = Number(ctx.params.id);
    const f = ctx.db.get('SELECT * FROM followups WHERE id = :id', { id });
    if (!f) throw new HttpError(404, 'That follow-up no longer exists.');
    if (f.status === 'Open') {
      ctx.db.tx(() => {
        ctx.db.run("UPDATE followups SET status = 'Done', done_on = :d, updated_at = datetime('now') WHERE id = :id", { d: F.today(), id });
        ctx.audit({ clientId: f.client_id, entity: 'followups', entityId: id, action: 'updated', summary: `completed follow-up “${f.title}”` });
      });
      ctx.flash('ok', `Marked done: ${f.title}`);
    }
    ctx.redirect(safeReturn(ctx.body.return, '/followups'));
  });
}

module.exports = { register };
