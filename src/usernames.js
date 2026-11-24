'use strict';
// User names are what people sign in with: 2 to 30 letters, digits, dots, dashes or underscores,
// stored in lower case and matched without regard to case.
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,29}$/;

// "anil@demo.local" -> "anil"; "Anil Mehta" (no email) -> "anil.mehta".
function baseUsername(name, email) {
  const fromEmail = email ? String(email).split('@')[0] : '';
  let s = (fromEmail || String(name || ''))
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 30)
    .replace(/[._-]+$/g, '');
  if (s.length < 2) s = 'user';
  return s;
}

// First free name: anil, anil2, anil3 ...
function uniqueUsername(base, isTaken) {
  if (!isTaken(base)) return base;
  for (let i = 2; ; i++) {
    const c = `${base.slice(0, 30 - String(i).length)}${i}`;
    if (!isTaken(c)) return c;
  }
}

module.exports = { USERNAME_RE, baseUsername, uniqueUsername };
