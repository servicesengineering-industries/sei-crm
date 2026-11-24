'use strict';
// Dates are stored as 'YYYY-MM-DD' strings; timestamps as SQLite UTC 'YYYY-MM-DD HH:MM:SS'.

let TZ = 'Asia/Kolkata';
// Building an Intl.DateTimeFormat is slow (about 0.15 ms), and "today" is asked for once or twice
// per row on long lists, so one is kept and rebuilt only when the time zone changes.
let dayFormat = null;
const setTimeZone = (tz) => { TZ = tz; dayFormat = null; };

function isoDate(d = new Date()) {
  if (!dayFormat) dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = dayFormat.formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const today = () => isoDate();

function addDays(iso, n) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Whole days from `from` to `to` (positive when `to` is later).
function daysBetween(from, to) {
  const a = Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(to).slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 864e5);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

function utcToDate(utc) { return new Date(`${String(utc).replace(' ', 'T')}Z`); }
function fmtDateTime(utc) {
  if (!utc) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(utcToDate(utc));
}
const localDay = (utc) => isoDate(utcToDate(utc));

const INR0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const INR2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUM = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const money = (n) => (n == null ? '' : INR0.format(n));
const money2 = (n) => (n == null ? '' : INR2.format(n));
const num = (n) => (n == null ? '' : NUM.format(n));

// ₹12.40 L / ₹1.25 Cr for tiles.
function moneyShort(n) {
  if (n == null) return '';
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return money(n);
}

function relDays(iso, t = today()) {
  if (!iso) return 'never';
  const d = daysBetween(iso, t);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d > 1) return `${d} days ago`;
  if (d === -1) return 'tomorrow';
  return `in ${-d} days`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Planning weeks run Monday to Sunday and are stored by their Monday.
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayIndex = (iso) => (new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).getUTCDay() + 6) % 7;
const dayName = (iso) => DAYS[dayIndex(iso)];
const weekOf = (iso) => addDays(iso, -dayIndex(iso));
// A real calendar date: 2027-02-31 is refused, not rolled over into March.
const isIsoDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// "23–29 Nov 2026", or "30 Nov – 6 Dec 2026" across a month end.
function weekLabel(ws) {
  const we = addDays(ws, 6);
  const [y1, m1, d1] = ws.split('-').map(Number);
  const [y2, m2, d2] = we.split('-').map(Number);
  if (y1 !== y2) return `${fmtDate(ws)} – ${fmtDate(we)}`;
  if (m1 !== m2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  return `${d1}–${d2} ${MONTHS[m2 - 1]} ${y2}`;
}
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);

module.exports = {
  setTimeZone, isoDate, today, addDays, daysBetween, fmtDate, fmtDateTime, localDay,
  money, money2, num, moneyShort, relDays, plural, cap,
  DAYS, dayIndex, dayName, weekOf, weekLabel, isIsoDate, pct,
};
