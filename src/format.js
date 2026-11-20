'use strict';
// Dates are stored as 'YYYY-MM-DD' strings; timestamps as SQLite UTC 'YYYY-MM-DD HH:MM:SS'.

let TZ = 'Asia/Kolkata';
const setTimeZone = (tz) => { TZ = tz; };

function isoDate(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
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

module.exports = {
  setTimeZone, isoDate, today, addDays, daysBetween, fmtDate, fmtDateTime, localDay,
  money, money2, num, moneyShort, relDays, plural, cap,
};
