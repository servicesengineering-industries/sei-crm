'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Minimal .env reader: KEY=value lines, # comments. Real environment variables win.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

function loadConfig(argv = process.argv.slice(2)) {
  loadDotEnv(path.join(ROOT, '.env'));
  const env = process.env;
  const demo = argv.includes('--demo') || env.DEMO === '1';
  const dataDir = path.resolve(ROOT, env.DATA_DIR || 'data');
  return {
    root: ROOT,
    demo,
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || (demo ? 3001 : 3000)),
    dataDir,
    dbPath: demo ? path.join(dataDir, 'demo.db') : path.join(dataDir, env.DB_FILE || 'crm.db'),
    cookieSecure: env.COOKIE_SECURE === '1',
    trustProxy: env.TRUST_PROXY === '1',
    timeZone: env.TZ_NAME || 'Asia/Kolkata',
    adminEmail: (env.ADMIN_EMAIL || 'admin@sei.local').toLowerCase(),
    companyName: env.COMPANY_NAME || 'Services Engineering Industries',
    sessionDays: Number(env.SESSION_DAYS || 7),
  };
}

module.exports = { loadConfig, ROOT };
