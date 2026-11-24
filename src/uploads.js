'use strict';
// Evidence files (photos and PDFs) on checklists, jobs and compliance filings. Uploads arrive as
// multipart forms; each file is checked by its first bytes, not its name or declared type, and
// stored under data/uploads with a random name. Files are served only to signed-in users.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { html } = require('./html');
const { HttpError } = require('./http');

const MAX_FILE = 8 * 1024 * 1024;
const MAX_FILES = 5;
// Five full-size files plus the form's text fields.
const MAX_BODY = MAX_FILES * MAX_FILE + 1024 * 1024;

function readRaw(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (over) {
        // Keep reading (and dropping) the rest, so the browser gets the 413 page instead of
        // a reset connection. Only a body far past the limit is cut off.
        if (size > limit * 2) req.destroy();
        return;
      }
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(new HttpError(413, 'The photos are too large. Send up to 5 files, each 8 MB or less. Go back and choose fewer or smaller photos.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// multipart/form-data -> { fields, files: [{ field, filename, data }] }
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) throw new HttpError(400, 'That form could not be read. Go back, reload the page and try again.');
  const boundary = (m[1] || m[2]).trim();
  const delim = Buffer.from(`--${boundary}`);
  const sep = Buffer.from(`\r\n--${boundary}`);
  const fields = Object.create(null);
  const files = [];
  let pos = buf.indexOf(delim);
  if (pos < 0) throw new HttpError(400, 'That form could not be read. Go back, reload the page and try again.');
  pos += delim.length;
  for (let parts = 0; parts < 400; parts++) {
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break; // closing "--"
    pos += 2; // CRLF after the boundary
    const headEnd = buf.indexOf('\r\n\r\n', pos);
    if (headEnd < 0) throw new HttpError(400, 'That form could not be read. Go back, reload the page and try again.');
    const head = buf.subarray(pos, headEnd).toString('utf8');
    const end = buf.indexOf(sep, headEnd + 4);
    if (end < 0) throw new HttpError(400, 'That form could not be read. Go back, reload the page and try again.');
    const body = buf.subarray(headEnd + 4, end);
    const name = (/\bname="([^"]*)"/i.exec(head) || [])[1];
    const filename = /\bfilename="([^"]*)"/i.exec(head);
    if (name != null) {
      if (filename) {
        if (body.length) {
          if (files.length >= MAX_FILES) throw new HttpError(413, 'Send up to 5 files at a time. Go back and choose fewer files.');
          files.push({ field: name, filename: path.basename(filename[1].replace(/\\/g, '/')).slice(0, 120) || 'file', data: Buffer.from(body) });
        }
      } else if (!(name in fields)) {
        fields[name] = body.toString('utf8');
      }
    }
    pos = end + sep.length;
  }
  return { fields, files };
}

// What a file really is, from its first bytes.
function sniff(data) {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (data.length > 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (data.length > 5 && data.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

// Checks every file first, so a bad one stops the whole save. Returns what to store.
function checkFiles(files) {
  return files.map((f) => {
    if (f.data.length > MAX_FILE) throw new HttpError(413, `${f.filename} is over 8 MB. Take the photo at a lower size, or send a smaller PDF.`);
    const kind = sniff(f.data);
    if (!kind) throw new HttpError(415, `${f.filename} isn't a photo (JPG, PNG, WebP) or a PDF. On an iPhone, set Camera > Formats to “Most Compatible”.`);
    return { ...f, ...kind };
  });
}

const uploadDir = (cfg) => path.join(cfg.dataDir, 'uploads');

// Write checked files and record them against a record. Call inside the record's transaction.
function saveFiles(ctx, entity, entityId, checked) {
  if (!checked.length) return 0;
  const dir = uploadDir(ctx.cfg);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of checked) {
    const stored = `${crypto.randomUUID()}.${f.ext}`;
    fs.writeFileSync(path.join(dir, stored), f.data, { mode: 0o600 });
    ctx.db.run(`INSERT INTO attachments (entity, entity_id, filename, stored, mime, size, user_id)
                VALUES (:e, :id, :fn, :st, :mime, :size, :u)`, {
      e: entity, id: entityId, fn: f.filename, st: stored, mime: f.mime, size: f.data.length, u: ctx.user.id,
    });
  }
  return checked.length;
}

const listFor = (db, entity, entityId) => db.all(`SELECT a.*, u.name AS user_name FROM attachments a LEFT JOIN users u ON u.id = a.user_id
                                                  WHERE a.entity = :e AND a.entity_id = :id ORDER BY a.id`, { e: entity, id: entityId });

// Thumbnails for photos, a labelled link for PDFs.
function gallery(files) {
  if (!files.length) return '';
  return html`<ul class="evidence">${files.map((f) => html`<li>${f.mime.startsWith('image/')
    ? html`<a href="/attachments/${f.id}" target="_blank" rel="noopener"><img src="/attachments/${f.id}" alt="${f.filename}" loading="lazy"></a>`
    : html`<a class="evidence-doc" href="/attachments/${f.id}" target="_blank" rel="noopener">PDF<span>${f.filename}</span></a>`}
<span class="sub">${f.user_name || ''}</span></li>`)}</ul>`;
}

function serve(ctx) {
  const f = ctx.db.get('SELECT * FROM attachments WHERE id = :id', { id: Number(ctx.params.id) });
  if (!f) throw new HttpError(404, 'That file is no longer here.');
  const file = path.join(uploadDir(ctx.cfg), f.stored);
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(f.stored) || !fs.existsSync(file)) throw new HttpError(404, 'That file is no longer here.');
  const safeName = f.filename.replace(/[^\w.\- ]+/g, '_');
  ctx.send(200, fs.readFileSync(file), f.mime, {
    'Content-Disposition': `inline; filename="${safeName}"`,
    'Cache-Control': 'private, max-age=86400',
  });
}

module.exports = { MAX_BODY, MAX_FILE, MAX_FILES, readRaw, parseMultipart, checkFiles, saveFiles, listFor, gallery, serve, sniff };
