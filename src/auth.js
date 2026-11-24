'use strict';
const crypto = require('node:crypto');
const net = require('node:net');
const { promisify } = require('node:util');

const scryptAsync = promisify(crypto.scrypt);

const ROLES = { admin: 'Admin', sales: 'Sales', accounts: 'Accounts', quality: 'Quality', production: 'Production & maintenance', purchase: 'Purchase & stores', viewer: 'View only' };
const ROLE_HELP = {
  admin: 'Everything, including users and deleting records',
  sales: 'Clients, contacts, RFQs and quotes, orders and deliveries, complaints, the weekly sales plan',
  accounts: 'Invoices and payments, contacts, calls and visits, follow-ups, the weekly payment plan, petty cash, suppliers. The head of Accounts also approves payments',
  quality: 'Quality complaints, contacts, calls and visits, follow-ups, preventive maintenance tasks',
  production: 'Production plan, machines and tools, preventive maintenance',
  purchase: 'Suppliers and the weekly purchase plan',
  viewer: 'Can see everything but change nothing',
};
const MIN_PASSWORD = 10;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

// Password checks run on Node's worker threads, never on the thread that serves pages, and at
// most VERIFY_ACTIVE at a time with up to VERIFY_WAITING queued. A flood of sign-in attempts
// therefore can't freeze the app for people already signed in; past the queue it is refused.
const VERIFY_ACTIVE = 2;
const VERIFY_WAITING = 64;
let verifying = 0;
const verifyQueue = [];

class BusyError extends Error {}

function acquireVerifySlot() {
  if (verifying < VERIFY_ACTIVE) { verifying += 1; return Promise.resolve(); }
  if (verifyQueue.length >= VERIFY_WAITING) return Promise.reject(new BusyError('Too many password checks at once'));
  return new Promise((resolve) => verifyQueue.push(resolve));
}

function releaseVerifySlot() {
  const next = verifyQueue.shift();
  if (next) next(); // hand the slot straight to the next request in line
  else verifying -= 1;
}

// True when a new password check would be refused. Callers check this before counting the attempt.
const verifierBusy = () => verifying >= VERIFY_ACTIVE && verifyQueue.length >= VERIFY_WAITING;

// Resolves true when the password matches. Rejects with BusyError when the queue is full.
async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  await acquireVerifySlot();
  try {
    const actual = await scryptAsync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    return actual.length === expected.length && crypto.timingSafeEqual(expected, actual);
  } finally {
    releaseVerifySlot();
  }
}

// Passwords that guessing lists try first: a common word or the person's own name with digits or
// symbols around it (Welcome@123, Admin@2026), keyboard or number runs, phone-number-like digits.
const COMMON_WORDS = [
  'password', 'passwd', 'qwerty', 'welcome', 'letmein', 'iloveyou', 'admin', 'administrator', 'login', 'changeme',
  'secret', 'master', 'monkey', 'dragon', 'sunshine', 'superman', 'hello', 'computer', 'test', 'user', 'guest',
  'sei', 'seicrm', 'services', 'engineering', 'india', 'bharat', 'gurgaon', 'gurugram', 'delhi', 'manesar',
];
const RUNS = ['01234567890123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm', '1qaz2wsx3edc4rfv5tgb6yhn', 'qazwsxedcrfvtgbyhnujm', '1q2w3e4r5t6y7u8i9o0p'];
const RUNS_BOTH = [...RUNS, ...RUNS.map((s) => [...s].reverse().join(''))];
const unLeet = (s) => s.replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/[$5]/g, 's').replace(/7/g, 't');
const isRun = (s) => s.length >= 4 && RUNS_BOTH.some((r) => r.includes(s));

// Returns why a new password can't be used, or '' when it is fine.
function passwordProblem(password, { email = '', name = '', username = '' } = {}) {
  const pw = String(password);
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters`;
  if (pw.length > 200) return 'Keep it under 200 characters';
  const lower = pw.toLowerCase();
  if (/^[\d\s+().\-/]+$/.test(pw)) return 'Don’t use only digits, like a phone number';
  if (new Set(lower).size < 5) return 'Use more different characters';
  const own = [String(email || '').toLowerCase().split('@')[0], ...String(username || '').toLowerCase().split(/[^a-z]+/), ...String(name).toLowerCase().split(/[^a-z]+/)];
  const words = new Set([...COMMON_WORDS, ...own].filter((w) => w && w.length >= 3));
  const core = unLeet(lower.replace(/^[\d\W_]+|[\d\W_]+$/g, ''));
  if (words.has(core) || isRun(core) || isRun(lower.replace(/[^a-z0-9]/g, ''))) {
    return 'That password is on the lists attackers try first. A short sentence is safer and easier to remember.';
  }
  return '';
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

// A module can decide per record (`canEditRow`); `row` is undefined when asking about a new one.
const canEdit = (user, mod, row) => !!user && (user.role === 'admin'
  || (mod.canEditRow ? !!mod.canEditRow(user, row) : (mod.editRoles || []).includes(user.role)));
const isAdmin = (user) => !!user && user.role === 'admin';

// Sign-in throttling, counted per key over 15 minutes. Counts live in memory, so a restart
// clears them. When there are too many keys the least recently used are dropped, never all.
const failures = new Map(); // key -> { count, first, last }, oldest use first
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const MAX_KEYS = 50000;
const FREE_ACCOUNT_TRIES = 5;
const MAX_ACCOUNT_GAP_S = 60;

function liveEntry(key, now = Date.now()) {
  const f = failures.get(key);
  if (!f) return null;
  if (now - f.first > WINDOW_MS) { failures.delete(key); return null; }
  return f;
}

function failureCount(key) {
  const f = liveEntry(key);
  return f ? f.count : 0;
}
const isLimited = (key, max = MAX_FAILURES) => failureCount(key) >= max;

// Count a failed attempt. Sign-in counts every attempt here *before* checking the password and
// refunds it on success, so requests sent at the same moment can't all slip under a limit.
function noteFailure(key, now = Date.now()) {
  let f = liveEntry(key, now);
  if (f) failures.delete(key); // re-insert below to mark it most recently used
  else f = { count: 0, first: now, last: now };
  f.count += 1;
  f.last = now;
  failures.set(key, f);
  if (failures.size > MAX_KEYS) {
    for (const k of failures.keys()) {
      if (failures.size <= MAX_KEYS * 0.9) break;
      failures.delete(k);
    }
  }
}

function refundFailure(key) {
  const f = liveEntry(key);
  if (!f) return;
  f.count -= 1;
  if (f.count <= 0) failures.delete(key);
}
const clearFailures = (key) => failures.delete(key);

// Seconds before one account accepts another attempt, counted across every address. The first
// FREE_ACCOUNT_TRIES wrong passwords in the window are free; after that attempts must be 1, 2, 4 ...
// up to MAX_ACCOUNT_GAP_S seconds apart. Early attempts are refused, not delayed.
function accountWait(key, now = Date.now()) {
  const f = liveEntry(key, now);
  if (!f || f.count < FREE_ACCOUNT_TRIES) return 0;
  const gap = Math.min(2 ** (f.count - FREE_ACCOUNT_TRIES), MAX_ACCOUNT_GAP_S) * 1000;
  const left = f.last + gap - now;
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

// Throttling key for a client address. IPv6 is grouped by /64, the block one subscriber gets,
// so rotating addresses inside it doesn't reset the count. IPv4-mapped IPv6 becomes plain IPv4.
function addressKey(ip) {
  const s = String(ip || '').replace(/%.*$/, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  if (mapped) return mapped[1];
  if (!net.isIPv6(s)) return s;
  let groups = s.split(':');
  if (s.includes('::')) {
    const [head, tail] = s.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const tailSize = t.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0);
    groups = [...h, ...Array(8 - h.length - tailSize).fill('0'), ...t];
  }
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

// "Known browser" cookie: proof that this browser signed in to this account before. It lets the
// owner past the per-account wait while someone else is guessing their password. It is not a
// sign-in by itself: the password is still checked.
const DEVICE_DAYS = 180;
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest('base64url');
function deviceToken(key, userId, now = Date.now()) {
  const body = `${userId}.${Math.floor(now / 1000) + DEVICE_DAYS * 86400}`;
  return `${body}.${hmac(key, body)}`;
}
function deviceUserId(key, value, now = Date.now()) {
  const m = /^(\d+)\.(\d+)\.([\w-]+)$/.exec(String(value || ''));
  if (!m || Number(m[2]) * 1000 < now || !safeEqual(m[3], hmac(key, `${m[1]}.${m[2]}`))) return 0;
  return Number(m[1]);
}

module.exports = {
  ROLES, ROLE_HELP, MIN_PASSWORD, hashPassword, verifyPassword, verifierBusy, BusyError, passwordProblem,
  token, sha256, tempPassword, safeEqual, canEdit, isAdmin,
  isLimited, failureCount, noteFailure, refundFailure, clearFailures, accountWait, addressKey,
  DEVICE_DAYS, deviceToken, deviceUserId,
};
