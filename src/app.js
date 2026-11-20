'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { openDb, seedClients } = require('./db');
const { Router } = require('./router');
const { HttpError, parseCookies, readBody, parseForm, toObject } = require('./http');
const A = require('./auth');
const UI = require('./ui');
const F = require('./format');
const { html } = require('./html');
const { MODULES } = require('./modules');
const { registerCrud } = require('./crud');

const SESSION_COOKIE = 'sei_sid';

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const STATIC_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const isLoopback = (addr) => /^(127(\.\d{1,3}){3}|::1|::ffff:127(\.\d{1,3}){3}|localhost)$/i.test(String(addr || ''));

// Behind a reverse proxy on this machine, the proxy appends the real client address last.
// Anything earlier in X-Forwarded-For was sent by the client and is not trusted.
function clientIp(req, trustProxy) {
  const peer = req.socket.remoteAddress || '';
  const fwd = req.headers['x-forwarded-for'];
  if (trustProxy && fwd && isLoopback(peer)) {
    const hops = String(fwd).split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return peer;
}

function firstLoginFile(cfg) { return path.join(cfg.dataDir, 'first-login.txt'); }

function checkConfig(cfg) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: cfg.timeZone }).format(new Date());
  } catch {
    throw new Error(`TZ_NAME "${cfg.timeZone}" is not a time zone. Use a name like Asia/Kolkata.`);
  }
  if (cfg.demo && (!isLoopback(cfg.host) || cfg.cookieSecure)) {
    throw new Error('Demo mode uses a published password, so it only runs on this PC: HOST=127.0.0.1 and COOKIE_SECURE=0.');
  }
  if (!isLoopback(cfg.host) && !cfg.cookieSecure) {
    console.warn(`Warning: listening on ${cfg.host} without COOKIE_SECURE=1, so sign-in cookies can travel unencrypted. Put the app behind HTTPS and set COOKIE_SECURE=1, or keep HOST=127.0.0.1.`);
  }
}

function secureDataDir(cfg) {
  fs.mkdirSync(cfg.dataDir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(cfg.dataDir, 0o700); } catch { /* not ours to change */ }
  }
}

function ensureAdmin(db, cfg) {
  if (db.get('SELECT COUNT(*) AS n FROM users').n > 0) return;
  const password = A.tempPassword();
  const id = db.run("INSERT INTO users (name, email, role, password_hash, must_change_password) VALUES ('Administrator', :email, 'admin', :hash, 1)", {
    email: cfg.adminEmail, hash: A.hashPassword(password),
  }).id;
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('first_login_user', :id)", { id: String(id) });
  const file = firstLoginFile(cfg);
  fs.writeFileSync(file, [
    'SEI Client CRM: first admin sign-in',
    '',
    `Address:  http://${isLoopback(cfg.host) || cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`,
    `Email:    ${cfg.adminEmail}`,
    `Password: ${password}`,
    '',
    'You will be asked to choose your own password after signing in.',
    'This file is deleted automatically when you do.',
    '',
  ].join('\n'), { mode: 0o600 });
  console.log(`First run: created the admin account ${cfg.adminEmail}. Its one-time password is in ${file}`);
}

function bootstrap(db, cfg) {
  const added = seedClients(db);
  if (added) console.log(`Added ${added} SEI customers to the client list.`);
  if (cfg.demo) require('./demo').seedDemo(db);
  ensureAdmin(db, cfg);
  db.run("DELETE FROM sessions WHERE expires_at <= datetime('now')");
}

function createApp(cfg) {
  checkConfig(cfg);
  F.setTimeZone(cfg.timeZone);
  secureDataDir(cfg);
  const db = openDb(cfg.dbPath);
  bootstrap(db, cfg);
  const dummyHash = A.hashPassword(A.token()); // keeps sign-in timing the same for unknown emails
  const baseHeaders = { ...SECURITY_HEADERS, ...(cfg.cookieSecure ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}) };

  const router = new Router();
  require('./routes/auth').register(router, { dummyHash, SESSION_COOKIE, firstLoginFile });
  require('./routes/dashboard').register(router);
  require('./routes/clients').register(router);
  require('./routes/followups').register(router);
  for (const key of Object.keys(MODULES)) registerCrud(router, key);
  require('./routes/users').register(router);
  require('./routes/search').register(router);

  const publicDir = path.join(cfg.root, 'public');

  function decorate(ctx) {
    ctx.outCookies = [];
    ctx.setCookie = (c) => ctx.outCookies.push(c);
    ctx.send = (status, body, type = 'text/html; charset=utf-8', headers = {}) => {
      const res = ctx.res;
      if (res.headersSent) return;
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      const h = { ...baseHeaders, 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store', ...headers };
      if (ctx.outCookies.length) h['Set-Cookie'] = ctx.outCookies;
      res.writeHead(status, h);
      res.end(ctx.req.method === 'HEAD' ? undefined : buf);
    };
    ctx.redirect = (location) => ctx.send(303, '', 'text/plain; charset=utf-8', { Location: location });
    ctx.page = (title, body, opts = {}) => ctx.send(opts.status || 200, String(UI.layout(ctx, { title, body, active: opts.active })));
    ctx.flash = (type, msg) => {
      if (ctx.session) db.run('UPDATE sessions SET flash = :f WHERE id = :id', { f: JSON.stringify({ type, msg }), id: ctx.session.id });
    };
    ctx.takeFlash = () => {
      if (!ctx.session || !ctx.session.flash) return null;
      db.run('UPDATE sessions SET flash = NULL WHERE id = :id', { id: ctx.session.id });
      const f = ctx.session.flash;
      ctx.session.flash = null;
      try { return JSON.parse(f); } catch { return null; }
    };
    ctx.audit = ({ clientId = null, entity, entityId = null, action, summary }) => {
      db.run('INSERT INTO audit_log (user_id, client_id, entity, entity_id, action, summary) VALUES (:u, :c, :e, :eid, :a, :s)', {
        u: ctx.user ? ctx.user.id : null, c: clientId, e: entity, eid: entityId, a: action, s: summary,
      });
    };
  }

  function loadSession(ctx) {
    const tok = ctx.cookies[SESSION_COOKIE];
    if (!tok) return;
    const row = db.get(`SELECT s.id AS sid, s.csrf, s.flash, u.id, u.name, u.email, u.role, u.must_change_password
                        FROM sessions s JOIN users u ON u.id = s.user_id
                        WHERE s.id = :sid AND s.expires_at > datetime('now') AND u.active = 1`, { sid: A.sha256(tok) });
    if (!row) return;
    ctx.session = { id: row.sid, csrf: row.csrf, flash: row.flash };
    ctx.user = { id: row.id, name: row.name, email: row.email, role: row.role, must_change_password: row.must_change_password };
  }

  function serveStatic(ctx) {
    const name = ctx.path.slice('/static/'.length);
    if (!/^(fonts\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new HttpError(404, 'Not found');
    const type = STATIC_TYPES[path.extname(name).toLowerCase()];
    const file = path.join(publicDir, name);
    if (!type || !fs.existsSync(file)) throw new HttpError(404, 'Not found');
    const immutable = name.startsWith('fonts/');
    ctx.send(200, fs.readFileSync(file), type, { 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300' });
  }

  function errorPage(ctx, err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(err);
    const titles = { 400: 'Bad request', 403: 'Not allowed', 404: 'Not found', 413: 'Too large', 415: 'Not supported', 500: 'Something went wrong' };
    const title = titles[status] || 'Error';
    const msg = status >= 500 ? 'The error has been logged on the server. Try again, and tell your admin if it keeps happening.' : err.message;
    if (ctx.res.headersSent) return;
    try {
      if (ctx.user) {
        return ctx.page(title, html`<div class="error-page"><h1>${title}</h1><p>${msg}</p><p><a href="/">Back to the dashboard</a></p></div>`, { status });
      }
    } catch (e2) { console.error(e2); }
    ctx.send(status, `<!doctype html><meta charset="utf-8"><title>${title}</title><p>${title}. <a href="/login">Sign in</a></p>`);
  }

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      req.resume();
      res.writeHead(400, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Bad request');
      return;
    }
    const ctx = {
      req, res, cfg, db, url, path: url.pathname,
      method: req.method === 'HEAD' ? 'GET' : req.method,
      query: toObject(url.searchParams), params: Object.create(null), body: Object.create(null),
      cookies: parseCookies(req.headers.cookie), session: null, user: null,
    };
    ctx.ip = clientIp(req, cfg.trustProxy);
    decorate(ctx);
    try {
      if (ctx.path.startsWith('/static/')) return serveStatic(ctx);
      if (ctx.path === '/healthz') return ctx.send(200, 'ok', 'text/plain; charset=utf-8');
      loadSession(ctx);
      const match = router.match(ctx.method, ctx.path);
      if (!match) {
        req.resume();
        if (!ctx.user) return ctx.redirect('/login');
        throw new HttpError(404, "That page doesn't exist.");
      }
      ctx.params = match.params;
      const opts = match.route.opts;
      // Signed-out requests to private pages are turned away before any form body is read.
      if (!opts.public && !ctx.user) {
        req.resume();
        if (ctx.method === 'GET') return ctx.redirect(`/login?next=${encodeURIComponent(ctx.path + ctx.url.search)}`);
        return ctx.redirect('/login');
      }
      if (ctx.method === 'POST') {
        const type = String(req.headers['content-type'] || '');
        if (!type.startsWith('application/x-www-form-urlencoded')) throw new HttpError(415, 'Forms must be sent as ordinary web forms.');
        ctx.body = parseForm(await readBody(req));
      }
      if (!opts.public) {
        if (ctx.method === 'POST' && !A.safeEqual(ctx.body._csrf, ctx.session.csrf)) {
          throw new HttpError(403, 'This form has expired. Go back, reload the page and try again.');
        }
        if (ctx.user.must_change_password && !opts.allowPasswordChange) return ctx.redirect('/account/password');
      }
      await match.route.handler(ctx);
      if (!res.headersSent) throw new Error(`No response for ${ctx.method} ${ctx.path}`);
    } catch (err) {
      req.resume();
      errorPage(ctx, err);
    }
  }

  return { handle, db, router, cfg };
}

module.exports = { createApp, SESSION_COOKIE, clientIp, isLoopback };
