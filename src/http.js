'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Only allow redirects back into this app: one leading slash, then printable ASCII with no
// backslash. Tabs, newlines and other control characters are rejected because browsers
// strip them, which would turn "/\t/evil.example" into "//evil.example".
const SAFE_PATH = /^\/(?!\/)[\x21-\x5b\x5d-\x7e]*$/;
function safeReturn(value, fallback) {
  if (typeof value === 'string' && value.length < 600 && SAFE_PATH.test(value)) return value;
  return fallback;
}

function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    try { out[key] = decodeURIComponent(val); } catch { out[key] = val; }
  }
  return out;
}

function cookie(name, value, { maxAge, secure = false } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (secure) c += '; Secure';
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'That form is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function toObject(searchParams) {
  const out = Object.create(null);
  for (const [k, v] of searchParams) out[k] = v;
  return out;
}

const parseForm = (text) => toObject(new URLSearchParams(text));

module.exports = { HttpError, safeReturn, parseCookies, cookie, readBody, parseForm, toObject };
