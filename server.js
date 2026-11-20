'use strict';
const http = require('node:http');
const { loadConfig } = require('./src/config');

// New files (database, backups, first-login file) readable only by this user on Linux/macOS.
if (process.platform !== 'win32') process.umask(0o077);

const { createApp } = require('./src/app');

const cfg = loadConfig();
let app;
try {
  app = createApp(cfg);
} catch (err) {
  console.error(`Could not start: ${err.message}`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  app.handle(req, res).catch((err) => {
    console.error(err);
    try {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Server error');
    } catch { /* connection already gone */ }
  });
});
server.headersTimeout = 30000;
server.requestTimeout = 60000;

// Log instead of crashing if anything still slips through.
process.on('unhandledRejection', (err) => { console.error('Unhandled rejection:', err); });

server.listen(cfg.port, cfg.host, () => {
  const shown = cfg.host === '0.0.0.0' ? 'localhost' : cfg.host;
  console.log(`SEI Client CRM${cfg.demo ? ' (DEMO DATABASE)' : ''} running at http://${shown}:${cfg.port}`);
  console.log(`Database: ${cfg.dbPath}`);
});

function shutdown() {
  server.close(() => {
    try { app.db.close(); } catch { /* already closed */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
