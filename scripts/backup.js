'use strict';
// Writes a consistent copy of the database to data/backups/ and keeps the newest 30.
// Safe to run while the app is running. Usage: npm run backup
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { loadConfig } = require('../src/config');

if (process.platform !== 'win32') process.umask(0o077); // backups readable only by this user

const cfg = loadConfig();
if (!fs.existsSync(cfg.dbPath)) {
  console.error(`No database at ${cfg.dbPath}. Start the app once first.`);
  process.exit(1);
}
const dir = path.join(cfg.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const out = path.join(dir, `${path.basename(cfg.dbPath, '.db')}-${stamp}.db`);

const db = new DatabaseSync(cfg.dbPath);
db.exec('PRAGMA busy_timeout = 5000');
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
console.log(`Backup written to ${out}`);

const old = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().reverse().slice(30);
for (const f of old) fs.rmSync(path.join(dir, f));
if (old.length) console.log(`Removed ${old.length} older backup(s).`);
