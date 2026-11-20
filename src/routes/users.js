'use strict';
const { html, attrIf } = require('../html');
const F = require('../format');
const C = require('../cells');
const UI = require('../ui');
const A = require('../auth');
const { HttpError } = require('../http');

function requireAdmin(ctx) {
  if (!A.isAdmin(ctx.user)) throw new HttpError(403, 'Only an admin can manage users.');
}

function roleHelp() {
  return html`<section class="card"><div class="card-h"><h2>What each role can change</h2></div><div class="card-b"><dl class="dl">${Object.keys(A.ROLES).map((r) => html`<dt>${A.ROLES[r]}</dt><dd>${A.ROLE_HELP[r]}</dd>`)}</dl><p class="help">Everyone who can sign in can see every client. Only admins can delete records.</p></div></section>`;
}

function userForm(ctx, { action, values, errors = {}, self = false, submit }) {
  const err = (k) => (errors[k] ? html`<div class="err" role="alert">${errors[k]}</div>` : '');
  return html`<form method="post" action="${action}" class="form">
${C.csrf(ctx)}
<div class="fgrid">
  <div class="field${errors.name ? ' has-error' : ''}"><label for="u_name">Name</label><input id="u_name" name="name" required value="${values.name || ''}">${err('name')}</div>
  <div class="field${errors.email ? ' has-error' : ''}"><label for="u_email">Email (used to sign in)</label><input id="u_email" name="email" type="email" required value="${values.email || ''}" autocomplete="off">${err('email')}</div>
  <div class="field${errors.role ? ' has-error' : ''}"><label for="u_role">Role</label>
    <select id="u_role" name="role"${attrIf(self, 'disabled')}>${Object.keys(A.ROLES).map((r) => html`<option value="${r}"${attrIf(r === values.role, 'selected')}>${A.ROLES[r]}</option>`)}</select>
    ${self ? html`<div class="help">You can't change your own role.</div>` : err('role')}</div>
  ${values.id ? html`<div class="field field-check"><label><input type="checkbox" name="active" value="1"${attrIf(values.active, 'checked')}${attrIf(self, 'disabled')}> Can sign in</label><div class="help">${self ? "You can't disable your own account." : 'Untick when someone leaves. Their history stays.'}</div></div>` : ''}
</div>
<div class="form-actions spaced"><button class="btn btn-primary" type="submit">${submit}</button><a class="btn btn-quiet" href="/users">Cancel</a></div>
</form>`;
}

function validateUser(ctx, body, id) {
  const errors = {};
  const name = String(body.name || '').trim().slice(0, 100);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const role = String(body.role || '');
  if (!name) errors.name = 'Required';
  if (!C.EMAIL_RE.test(email)) errors.email = 'Enter an email address';
  else if (ctx.db.get('SELECT id FROM users WHERE email = :email AND id <> :id', { email, id: id || 0 })) errors.email = 'Someone already uses this email';
  if (!A.ROLES[role]) errors.role = 'Pick a role';
  return { errors, values: { name, email, role } };
}

function passwordShown(ctx, user, title, intro) {
  return (password) => {
    const body = html`
${UI.pageHeader(title, intro)}
<div class="card"><div class="card-b">
<p>One-time password for <b>${user.name}</b> (${user.email}):</p>
<p><span class="temp-pw">${password}</span></p>
<p class="help">Give it to them in person or by phone. It is shown only once. They will choose their own password the first time they sign in.</p>
<div class="form-actions spaced"><a class="btn btn-primary" href="/users">Back to users</a></div>
</div></div>`;
    ctx.page(title, body, { active: 'users' });
  };
}

function register(router) {
  router.on('GET', '/users', (ctx) => {
    requireAdmin(ctx);
    const users = ctx.db.all('SELECT * FROM users ORDER BY active DESC, name');
    const cols = [
      { label: 'Name', render: (u) => html`<a class="rowlink" href="/users/${u.id}/edit">${u.name}</a>${u.id === ctx.user.id ? html`<span class="sub">You</span>` : ''}` },
      { label: 'Email', render: (u) => u.email },
      { label: 'Role', render: (u) => C.badge(A.ROLES[u.role], u.role === 'admin' ? 'info' : 'muted') },
      { label: 'Status', render: (u) => (u.active ? (u.must_change_password ? C.badge('Not signed in yet', 'warn') : C.badge('Active', 'ok')) : C.badge('Disabled', 'muted')) },
      { label: 'Last sign-in', render: (u) => (u.last_login_at ? F.fmtDateTime(u.last_login_at) : C.dash) },
    ];
    ctx.page('Users', html`${UI.pageHeader('Users', 'Who can sign in, and what they can change.', UI.button('/users/new', 'Add user', 'primary'))}${UI.table(cols, users, { ctx })}<div class="spacer"></div>${roleHelp()}`, { active: 'users' });
  });

  router.on('GET', '/users/new', (ctx) => {
    requireAdmin(ctx);
    ctx.page('Add user', html`<p class="crumbs"><a href="/users">← Users</a></p>${UI.pageHeader('Add user', 'They get a one-time password to sign in with.')}<div class="card"><div class="card-b">${userForm(ctx, { action: '/users/new', values: { role: 'sales' }, submit: 'Add user' })}</div></div>${roleHelp()}`, { active: 'users' });
  });

  router.on('POST', '/users/new', (ctx) => {
    requireAdmin(ctx);
    const { errors, values } = validateUser(ctx, ctx.body, null);
    if (Object.keys(errors).length) {
      return ctx.page('Add user', html`<p class="crumbs"><a href="/users">← Users</a></p>${UI.pageHeader('Add user', '')}<div class="card"><div class="card-b">${userForm(ctx, { action: '/users/new', values, errors, submit: 'Add user' })}</div></div>`, { active: 'users', status: 422 });
    }
    const password = A.tempPassword();
    const id = ctx.db.run('INSERT INTO users (name, email, role, password_hash, must_change_password) VALUES (:name, :email, :role, :hash, 1)', { ...values, hash: A.hashPassword(password) }).id;
    ctx.audit({ entity: 'users', entityId: id, action: 'created', summary: `added user ${values.name} (${A.ROLES[values.role]})` });
    passwordShown(ctx, values, 'User added', `${values.name} can now sign in.`)(password);
  });

  router.on('GET', '/users/:id/edit', (ctx) => {
    requireAdmin(ctx);
    const u = ctx.db.get('SELECT * FROM users WHERE id = :id', { id: Number(ctx.params.id) });
    if (!u) throw new HttpError(404, 'No such user.');
    const self = u.id === ctx.user.id;
    const reset = html`<section class="card"><div class="card-h"><h2>Password</h2></div><div class="card-b">
<p class="help">Forgot their password? Give them a new one-time password. They'll be signed out everywhere.</p>
<form method="post" action="/users/${u.id}/reset" class="form-actions spaced" data-confirm="Make a new one-time password for ${u.name}?">${C.csrf(ctx)}<button class="btn" type="submit">Make a new one-time password</button></form>
</div></section>`;
    ctx.page(u.name, html`<p class="crumbs"><a href="/users">← Users</a></p>${UI.pageHeader(u.name, u.last_login_at ? `Last signed in ${F.fmtDateTime(u.last_login_at)}` : 'Has not signed in yet')}<div class="card"><div class="card-b">${userForm(ctx, { action: `/users/${u.id}/edit`, values: u, self, submit: 'Save changes' })}</div></div>${self ? '' : reset}`, { active: 'users' });
  });

  router.on('POST', '/users/:id/edit', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const u = ctx.db.get('SELECT * FROM users WHERE id = :id', { id });
    if (!u) throw new HttpError(404, 'No such user.');
    const self = u.id === ctx.user.id;
    const { errors, values } = validateUser(ctx, { ...ctx.body, role: self ? u.role : ctx.body.role }, id);
    const active = self ? 1 : ctx.body.active ? 1 : 0;
    if (Object.keys(errors).length) {
      return ctx.page(u.name, html`${UI.pageHeader(u.name, '')}<div class="card"><div class="card-b">${userForm(ctx, { action: `/users/${id}/edit`, values: { ...values, id, active }, errors, self, submit: 'Save changes' })}</div></div>`, { active: 'users', status: 422 });
    }
    ctx.db.tx(() => {
      ctx.db.run("UPDATE users SET name = :name, email = :email, role = :role, active = :active, updated_at = datetime('now') WHERE id = :id", { ...values, active, id });
      if (!active) ctx.db.run('DELETE FROM sessions WHERE user_id = :id', { id });
      ctx.audit({ entity: 'users', entityId: id, action: 'updated', summary: `updated user ${values.name}${u.role !== values.role ? `: role ${A.ROLES[u.role]} → ${A.ROLES[values.role]}` : ''}${u.active && !active ? ', disabled sign-in' : ''}` });
    });
    ctx.flash('ok', `Saved ${values.name}.`);
    ctx.redirect('/users');
  });

  router.on('POST', '/users/:id/reset', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const u = ctx.db.get('SELECT * FROM users WHERE id = :id', { id });
    if (!u) throw new HttpError(404, 'No such user.');
    if (u.id === ctx.user.id) throw new HttpError(400, 'Use “Password” at the top of the page to change your own password.');
    const password = A.tempPassword();
    ctx.db.tx(() => {
      ctx.db.run("UPDATE users SET password_hash = :h, must_change_password = 1, updated_at = datetime('now') WHERE id = :id", { h: A.hashPassword(password), id });
      ctx.db.run('DELETE FROM sessions WHERE user_id = :id', { id });
      ctx.audit({ entity: 'users', entityId: id, action: 'updated', summary: `reset the password for ${u.name}` });
    });
    passwordShown(ctx, u, 'New one-time password', `${u.name} has been signed out everywhere.`)(password);
  });
}

module.exports = { register };
