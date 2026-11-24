'use strict';
const fs = require('node:fs');
const { html } = require('../html');
const UI = require('../ui');
const A = require('../auth');
const { cookie, safeReturn, HttpError } = require('../http');

const LOGIN_CSRF = 'sei_lcsrf';
const DEVICE_COOKIE = 'sei_dev';

function loginPage(ctx, { error, login = '', next = '', status = 200 }) {
  const csrf = A.token(16);
  ctx.setCookie(cookie(LOGIN_CSRF, csrf, { maxAge: 3600, secure: ctx.cfg.cookieSecure }));
  const body = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · SEI CRM</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
${UI.FONT_PRELOAD}
<link rel="stylesheet" href="/static/app.css?v=${UI.ASSET_V}">
</head>
<body class="login">
<main class="login-card">
  <div class="brand">${UI.MARK}<span class="brand-word">SEI</span><span class="brand-sub">Client CRM</span></div>
  <h1>Sign in</h1>
  ${ctx.cfg.demo ? html`<p class="alert alert-info">Demo database. The demo sign-ins are listed in README.md.</p>` : ''}
  ${error ? html`<p class="alert alert-error" role="alert">${error}</p>` : ''}
  <form method="post" action="/login">
    <input type="hidden" name="_csrf" value="${csrf}">
    <input type="hidden" name="next" value="${safeReturn(next, '')}">
    <div class="field"><label for="username">User name</label><input id="username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${login}" autofocus></div>
    <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn btn-primary btn-block" type="submit">Sign in</button>
  </form>
  <p class="login-foot">${ctx.cfg.companyName}</p>
</main>
</body>
</html>`;
  ctx.send(status, String(body));
}

function passwordPage(ctx, { errors = {}, status = 200 } = {}) {
  const forced = !!ctx.user.must_change_password;
  const field = (name, label, autocomplete, help) => html`<div class="field${errors[name] ? ' has-error' : ''}"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="password" autocomplete="${autocomplete}" required>${errors[name] ? html`<div class="err" role="alert">${errors[name]}</div>` : help ? html`<div class="help">${help}</div>` : ''}</div>`;
  const body = html`
${UI.pageHeader(forced ? 'Choose your password' : 'Change password', forced ? 'You signed in with a one-time password. Pick your own before carrying on.' : `Signed in as ${ctx.user.username}`)}
<div class="card"><div class="card-b">
<form method="post" action="/account/password" class="form">
  <input type="hidden" name="_csrf" value="${ctx.session.csrf}">
  <div class="fgrid">
    ${field('current', forced ? 'One-time password' : 'Current password', 'current-password')}
    <div></div>
    ${field('password', 'New password', 'new-password', `At least ${A.MIN_PASSWORD} characters. A short sentence is easy to remember. The app does not accept common passwords like Welcome@123.`)}
    ${field('confirm', 'New password again', 'new-password')}
  </div>
  <div class="form-actions spaced"><button class="btn btn-primary" type="submit">Save password</button>${forced ? '' : html`<a class="btn btn-quiet" href="/">Cancel</a>`}</div>
</form>
</div></div>`;
  ctx.page('Password', body, { status });
}

function register(router, { dummyHash, SESSION_COOKIE, firstLoginFile, deviceKey }) {
  router.on('GET', '/login', (ctx) => {
    if (ctx.user) return ctx.redirect('/');
    loginPage(ctx, { next: ctx.query.next || '' });
  }, { public: true });

  router.on('POST', '/login', async (ctx) => {
    // People sign in with their user name. An email address still works, for anyone used to it.
    const login = String(ctx.body.username ?? ctx.body.email ?? '').trim().toLowerCase().slice(0, 200);
    const password = String(ctx.body.password || '');
    const next = ctx.body.next || '';
    if (!A.safeEqual(ctx.body._csrf, ctx.cookies[LOGIN_CSRF])) {
      return loginPage(ctx, { login, next, error: 'The sign-in form expired. Please try again.', status: 400 });
    }
    const user = login.includes('@')
      ? ctx.db.get('SELECT * FROM users WHERE email = :login AND active = 1', { login })
      : ctx.db.get('SELECT * FROM users WHERE username = :login AND active = 1', { login });
    // Limits (src/auth.js), all checked and counted before the password is, so requests sent at
    // the same moment can't slip past them together:
    // - per address (IPv6 by /64): 30 wrong passwords in 15 minutes, 10 for any one account;
    // - per account, from anywhere: 5 free, then attempts must be 1, 2, 4 ... 60 seconds apart.
    //   A browser that has signed in to the account before skips that wait, so someone guessing
    //   a colleague's password can't keep the colleague out.
    // Accounts are counted by id, so switching between user name and email doesn't reset them.
    const who = user ? `id:${user.id}` : `name:${login}`;
    const addr = A.addressKey(ctx.ip);
    const keyIp = `ip:${addr}`;
    const keyPair = `pair:${addr}|${who}`;
    const keyUser = `user:${who}`;
    if (A.isLimited(keyIp, 30) || A.isLimited(keyPair)) {
      return loginPage(ctx, { login, next, error: 'Too many wrong attempts from this connection. Wait 15 minutes and try again.', status: 429 });
    }
    const knownBrowser = !!user && A.deviceUserId(deviceKey, ctx.cookies[DEVICE_COOKIE]) === user.id;
    const wait = knownBrowser ? 0 : A.accountWait(keyUser);
    if (wait) {
      return loginPage(ctx, { login, next, error: `Too many wrong passwords for this account. Wait ${wait} second${wait === 1 ? '' : 's'} and try again.`, status: 429 });
    }
    if (A.verifierBusy()) {
      return loginPage(ctx, { login, next, error: 'Sign-in is busy right now. Try again in a few seconds.', status: 503 });
    }
    A.noteFailure(keyIp);
    A.noteFailure(keyPair);
    A.noteFailure(keyUser);
    // Unknown user names are checked against a dummy hash so they take as long as real ones.
    let ok;
    try {
      ok = (await A.verifyPassword(password, user ? user.password_hash : dummyHash)) && !!user;
    } catch (err) {
      if (!(err instanceof A.BusyError)) throw err;
      for (const k of [keyIp, keyPair, keyUser]) A.refundFailure(k);
      return loginPage(ctx, { login, next, error: 'Sign-in is busy right now. Try again in a few seconds.', status: 503 });
    }
    if (!ok) {
      console.warn(`Failed sign-in for ${JSON.stringify(login)} from ${ctx.ip}`);
      return loginPage(ctx, { login, next, error: 'That user name and password don’t match.', status: 401 });
    }
    A.refundFailure(keyIp);
    A.clearFailures(keyPair);
    A.refundFailure(keyUser); // only this attempt: the owner signing in doesn't reset an attacker's count
    const tok = A.token();
    ctx.db.run("INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (:id, :uid, :csrf, datetime('now', :exp))", {
      id: A.sha256(tok), uid: user.id, csrf: A.token(24), exp: `+${ctx.cfg.sessionDays} days`,
    });
    ctx.db.run("UPDATE users SET last_login_at = datetime('now') WHERE id = :id", { id: user.id });
    ctx.db.run("DELETE FROM sessions WHERE expires_at <= datetime('now')");
    ctx.setCookie(cookie(SESSION_COOKIE, tok, { maxAge: ctx.cfg.sessionDays * 86400, secure: ctx.cfg.cookieSecure }));
    ctx.setCookie(cookie(LOGIN_CSRF, '', { maxAge: 0, secure: ctx.cfg.cookieSecure }));
    ctx.setCookie(cookie(DEVICE_COOKIE, A.deviceToken(deviceKey, user.id), { maxAge: A.DEVICE_DAYS * 86400, secure: ctx.cfg.cookieSecure }));
    ctx.redirect(user.must_change_password ? '/account/password' : safeReturn(next, '/'));
  }, { public: true });

  router.on('POST', '/logout', (ctx) => {
    ctx.db.run('DELETE FROM sessions WHERE id = :id', { id: ctx.session.id });
    ctx.setCookie(cookie(SESSION_COOKIE, '', { maxAge: 0, secure: ctx.cfg.cookieSecure }));
    ctx.redirect('/login');
  }, { allowPasswordChange: true });

  router.on('GET', '/account/password', (ctx) => passwordPage(ctx), { allowPasswordChange: true });

  router.on('POST', '/account/password', async (ctx) => {
    const { current = '', password = '', confirm = '' } = ctx.body;
    const user = ctx.db.get('SELECT * FROM users WHERE id = :id', { id: ctx.user.id });
    const errors = {};
    let currentOk;
    try {
      currentOk = await A.verifyPassword(current, user.password_hash);
    } catch (err) {
      if (err instanceof A.BusyError) throw new HttpError(503, 'The server is busy. Wait a few seconds and save again.');
      throw err;
    }
    if (!currentOk) errors.current = 'That isn’t your current password';
    const weak = A.passwordProblem(password, { email: user.email, name: user.name, username: user.username });
    if (weak) errors.password = weak;
    else if (password === current) errors.password = 'Choose a different password from the old one';
    if (!errors.password && password !== confirm) errors.confirm = 'The two new passwords don’t match';
    if (Object.keys(errors).length) return passwordPage(ctx, { errors, status: 422 });
    ctx.db.tx(() => {
      ctx.db.run("UPDATE users SET password_hash = :h, must_change_password = 0, updated_at = datetime('now') WHERE id = :id", { h: A.hashPassword(password), id: user.id });
      ctx.db.run('DELETE FROM sessions WHERE user_id = :uid AND id <> :sid', { uid: user.id, sid: ctx.session.id });
    });
    const first = ctx.db.get("SELECT value FROM meta WHERE key = 'first_login_user'");
    // Databases created before first_login_user existed: any admin's change clears the file.
    if ((first && Number(first.value) === user.id) || (!first && user.role === 'admin')) {
      try { fs.rmSync(firstLoginFile(ctx.cfg), { force: true }); } catch { /* not there */ }
      ctx.db.run("DELETE FROM meta WHERE key = 'first_login_user'");
    }
    ctx.user.must_change_password = 0;
    ctx.flash('ok', 'Password saved. Other devices signed in as you have been signed out.');
    ctx.redirect('/');
  }, { allowPasswordChange: true });
}

module.exports = { register };
