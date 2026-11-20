'use strict';
const crypto = require('node:crypto');

const ROLES = { admin: 'Admin', sales: 'Sales', accounts: 'Accounts', quality: 'Quality', viewer: 'View only' };
const ROLE_HELP = {
  admin: 'Everything, including users and deleting records',
  sales: 'Clients, contacts, RFQs and quotes, orders and deliveries, complaints',
  accounts: 'Invoices and payments',
  quality: 'Quality complaints',
  viewer: 'Can see everything but change nothing',
};
const MIN_PASSWORD = 10;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(expected, actual);
}

const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// Readable one-time password like 'k7Pq-mW3xa-R9tzH'.
function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(14)) s += alphabet[b % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4, 9)}-${s.slice(9, 14)}`;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

const canEdit = (user, mod) => !!user && (user.role === 'admin' || (mod.editRoles || []).includes(user.role));
const isAdmin = (user) => !!user && user.role === 'admin';

// Sign-in throttling, counted per key over 15 minutes.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
function failureCount(key) {
  const f = failures.get(key);
  if (!f) return 0;
  if (Date.now() - f.first > WINDOW_MS) { failures.delete(key); return 0; }
  return f.count;
}
const isLimited = (key, max = MAX_FAILURES) => failureCount(key) >= max;
function noteFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else f.count += 1;
  if (failures.size > 10000) failures.clear();
}
const clearFailures = (key) => failures.delete(key);

module.exports = {
  ROLES, ROLE_HELP, MIN_PASSWORD, hashPassword, verifyPassword, token, sha256, tempPassword, safeEqual,
  canEdit, isAdmin, isLimited, failureCount, noteFailure, clearFailures,
};
