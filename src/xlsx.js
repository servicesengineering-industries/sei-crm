'use strict';
// A small .xlsx writer with no dependencies. It covers what planning sheets need: text, numbers,
// dates, formulas, styles, column widths, frozen header rows, filters, merged cells, drop-down
// lists and conditional colours. Files are zipped with Node's own zlib.
const zlib = require('node:zlib');

// ---------- zip ----------

function dosDateTime(d = new Date()) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function zip(files) {
  const { time, date } = dosDateTime();
  const out = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const body = zlib.deflateRawSync(data, { level: 6 });
    const crc = zlib.crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    out.push(local, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42); // other fields stay 0
    central.push(c, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...out, dir, end]);
}

// ---------- helpers ----------

// Characters XML 1.0 can't carry are dropped; the rest are escaped.
const esc = (s) => String(s)
  .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function col(n) { // 0 -> A, 26 -> AA
  let s = '';
  for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
const ref = (r, c) => `${col(c)}${r + 1}`; // zero-based row and column

// 'YYYY-MM-DD' -> Excel date serial (days since 30 Dec 1899).
function serial(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5;
}

const COLORS = {
  navy: 'FF14263D', red: 'FFC83B43', paper: 'FFF4F6F8', mist: 'FFE6EBF0', slate: 'FF5A697A', white: 'FFFFFFFF',
  input: 'FFFFF8DC', ok: 'FF1F6B4A', okBg: 'FFE2EFE8', warn: 'FF8A5A0B', warnBg: 'FFF6ECD8', bad: 'FFB1262F', badBg: 'FFF8E3E4',
  info: 'FF24486F', infoBg: 'FFE2E9F2',
};
const argb = (c) => (c ? COLORS[c] || c : null);

const FORMATS = {
  int: '#,##0',
  dec: '#,##0.00',
  // Indian grouping: 1,23,45,678
  money: '[>=10000000]"₹"#\\,##\\,##\\,##0;[>=100000]"₹"#\\,##\\,##0;"₹"#,##0',
  money2: '"₹"#,##0.00',
  date: 'dd-mmm-yyyy',
  day: 'ddd dd-mmm',
  pct: '0%',
  text: '@',
};
const BUILTIN_FMT = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '@': 49 };

class Styles {
  constructor() {
    this.fonts = ['<font><sz val="10"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'];
    this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    this.borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    this.numFmts = [];
    this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    this.dxfs = [];
    this.seen = new Map();
  }

  intern(list, kind, xml) {
    const key = `${kind}:${xml}`;
    if (!this.seen.has(key)) { list.push(xml); this.seen.set(key, list.length - 1); }
    return this.seen.get(key);
  }

  font({ bold, italic, size = 10, color, underline }) {
    const c = argb(color);
    return this.intern(this.fonts, 'font', `<font>${bold ? '<b/>' : ''}${italic ? '<i/>' : ''}${underline ? '<u/>' : ''}<sz val="${size}"/>${c ? `<color rgb="${c}"/>` : '<color theme="1"/>'}<name val="Calibri"/><family val="2"/></font>`);
  }

  fill(color) {
    if (!color) return 0;
    return this.intern(this.fills, 'fill', `<fill><patternFill patternType="solid"><fgColor rgb="${argb(color)}"/><bgColor indexed="64"/></patternFill></fill>`);
  }

  border(kind) {
    if (!kind) return 0;
    const line = (side) => (kind === 'all' || kind === side ? `<${side} style="thin"><color rgb="FFC5CDD6"/></${side}>` : `<${side}/>`);
    return this.intern(this.borders, 'border', `<border>${line('left')}${line('right')}${line('top')}${line('bottom')}<diagonal/></border>`);
  }

  numFmt(fmt) {
    if (!fmt) return 0;
    const code = FORMATS[fmt] || fmt;
    if (code in BUILTIN_FMT) return BUILTIN_FMT[code];
    let f = this.numFmts.find((x) => x.code === code);
    if (!f) { f = { id: 164 + this.numFmts.length, code }; this.numFmts.push(f); }
    return f.id;
  }

  // st: { bold, italic, size, color, fill, border, fmt, wrap, align, valign, indent }
  xf(st) {
    if (!st) return 0;
    const key = `xf:${JSON.stringify(st)}`;
    if (this.seen.has(key)) return this.seen.get(key);
    const fontId = this.font(st);
    const fillId = this.fill(st.fill);
    const borderId = this.border(st.border);
    const numFmtId = this.numFmt(st.fmt);
    const align = st.wrap || st.align || st.valign || st.indent
      ? `<alignment${st.align ? ` horizontal="${st.align}"` : ''} vertical="${st.valign || 'top'}"${st.wrap ? ' wrapText="1"' : ''}${st.indent ? ` indent="${st.indent}"` : ''}/>`
      : '';
    this.xfs.push(`<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}${fillId ? ' applyFill="1"' : ''}${borderId ? ' applyBorder="1"' : ''}${align ? ' applyAlignment="1"' : ''}>${align}</xf>`);
    this.seen.set(key, this.xfs.length - 1);
    return this.xfs.length - 1;
  }

  // Conditional formatting looks: 'ok' | 'warn' | 'bad' | 'info' | 'muted'
  dxf(tone) {
    const t = { ok: ['ok', 'okBg'], warn: ['warn', 'warnBg'], bad: ['bad', 'badBg'], info: ['info', 'infoBg'], muted: ['slate', 'mist'] }[tone];
    return this.intern(this.dxfs, 'dxf', `<dxf><font>${tone === 'bad' ? '<b/>' : ''}<color rgb="${argb(t[0])}"/></font><fill><patternFill patternType="solid"><bgColor rgb="${argb(t[1])}"/></patternFill></fill></dxf>`);
  }

  xml() {
    const fmts = this.numFmts.length ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map((f) => `<numFmt numFmtId="${f.id}" formatCode="${esc(f.code)}"/>`).join('')}</numFmts>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${fmts}<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts><fills count="${this.fills.length}">${this.fills.join('')}</fills><borders count="${this.borders.length}">${this.borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${this.dxfs.length}">${this.dxfs.join('')}</dxfs><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
  }
}

// ---------- sheets ----------

// A cell is a plain value or { v, f, st }. Dates: pass { v: serial(iso), st: { fmt: 'date' } } or use D().
function cellXml(r, c, cell, styles) {
  if (cell == null) return '';
  const o = typeof cell === 'object' ? cell : { v: cell };
  const s = styles.xf(o.st);
  const sa = s ? ` s="${s}"` : '';
  const at = ref(r, c);
  if (o.f) return `<c r="${at}"${sa}><f>${esc(o.f)}</f></c>`;
  const v = o.v;
  if (v == null || v === '') return s ? `<c r="${at}"${sa}/>` : '';
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${at}"${sa}><v>${v}</v></c>` : `<c r="${at}"${sa}/>`;
  if (typeof v === 'boolean') return `<c r="${at}"${sa} t="b"><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${at}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

// sheet: { name, rows: [[cell]], cols: [width], heights: { rowIndex: pt }, freeze: { rows, cols },
//          autoFilter: 'A4:H40', merges: ['A1:H1'], validations: [{ sqref, list | source, prompt }],
//          cf: [{ sqref, formula, tone }], tabColor, landscape, hidden, gridlines }
function sheetXml(sh, styles, index) {
  const rows = sh.rows || [];
  // rows may have gaps (blank rows), so don't spread it: holes would become NaN.
  let width = Math.max(1, (sh.cols || []).length);
  for (let i = 0; i < rows.length; i++) if (rows[i] && rows[i].length > width) width = rows[i].length;
  const dim = `A1:${ref(Math.max(0, rows.length - 1), width - 1)}`;
  const fr = sh.freeze || {};
  let pane = '';
  if (fr.rows || fr.cols) {
    const tl = ref(fr.rows || 0, fr.cols || 0);
    const active = fr.rows && fr.cols ? 'bottomRight' : fr.rows ? 'bottomLeft' : 'topRight';
    pane = `<pane${fr.cols ? ` xSplit="${fr.cols}"` : ''}${fr.rows ? ` ySplit="${fr.rows}"` : ''} topLeftCell="${tl}" activePane="${active}" state="frozen"/><selection pane="${active}" activeCell="${tl}" sqref="${tl}"/>`;
  }
  const view = `<sheetViews><sheetView workbookViewId="0"${index === 0 ? ' tabSelected="1"' : ''}${sh.gridlines === false ? ' showGridLines="0"' : ''}${sh.zoom ? ` zoomScale="${sh.zoom}"` : ''}>${pane}</sheetView></sheetViews>`;
  const cols = (sh.cols || []).length ? `<cols>${sh.cols.map((w, i) => (w ? `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>` : '')).join('')}</cols>` : '';
  const heights = sh.heights || {};
  const data = rows.map((row, r) => {
    const cells = (row || []).map((cell, c) => cellXml(r, c, cell, styles)).join('');
    const ht = heights[r] ? ` ht="${heights[r]}" customHeight="1"` : '';
    return cells || ht ? `<row r="${r + 1}"${ht}>${cells}</row>` : '';
  }).join('');
  const filter = sh.autoFilter ? `<autoFilter ref="${sh.autoFilter}"/>` : '';
  const merges = (sh.merges || []).length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  let prio = 1;
  const cf = (sh.cf || []).map((r) => `<conditionalFormatting sqref="${r.sqref}"><cfRule type="expression" dxfId="${styles.dxf(r.tone)}" priority="${prio++}"${r.stop ? ' stopIfTrue="1"' : ''}><formula>${esc(r.formula)}</formula></cfRule></conditionalFormatting>`).join('');
  const dv = (sh.validations || []).length
    ? `<dataValidations count="${sh.validations.length}">${sh.validations.map((v) => {
      const f1 = v.list ? `"${v.list.join(',')}"` : v.source;
      const prompt = v.prompt ? ` showInputMessage="1" promptTitle="${esc(v.promptTitle || 'Pick one')}" prompt="${esc(v.prompt)}"` : '';
      return `<dataValidation type="list" allowBlank="1" showErrorMessage="1"${prompt} sqref="${v.sqref}"><formula1>${esc(f1)}</formula1></dataValidation>`;
    }).join('')}</dataValidations>`
    : '';
  const props = sh.tabColor || sh.landscape ? `<sheetPr>${sh.tabColor ? `<tabColor rgb="${argb(sh.tabColor)}"/>` : ''}${sh.landscape ? '<pageSetUpPr fitToPage="1"/>' : ''}</sheetPr>` : '';
  const setup = sh.landscape ? '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' : '<pageSetup paperSize="9"/>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${props}<dimension ref="${dim}"/>${view}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${data}</sheetData>${filter}${merges}${cf}${dv}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>${setup}</worksheet>`;
}

const quoteSheet = (name) => `'${String(name).replace(/'/g, "''")}'`;

function build(sheets) {
  const styles = new Styles();
  const names = new Set();
  for (const s of sheets) {
    if (!s.name || s.name.length > 31 || /[[\]:*?/\\]/.test(s.name)) throw new Error(`Bad sheet name: ${s.name}`);
    if (names.has(s.name.toLowerCase())) throw new Error(`Duplicate sheet name: ${s.name}`);
    names.add(s.name.toLowerCase());
  }
  const bodies = sheets.map((s, i) => sheetXml(s, styles, i));
  const defined = sheets.map((s, i) => (s.autoFilter
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(quoteSheet(s.name))}!${s.autoFilter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>`
    : '')).join('');
  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    {
      name: 'docProps/app.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SEI Client CRM</Application></Properties>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', data: styles.xml() },
    ...bodies.map((data, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data })),
  ];
  return zip(files);
}

// ---------- table sheets ----------

const ST = {
  title: { bold: true, size: 15, color: 'navy' },
  subtitle: { italic: true, color: 'slate' },
  head: { bold: true, color: 'white', fill: 'navy', border: 'all', wrap: true, valign: 'center' },
  total: { bold: true, fill: 'mist', border: 'all' },
  label: { bold: true, color: 'navy' },
  note: { italic: true, color: 'slate', wrap: true },
};
const D = (iso, st = {}) => ({ v: serial(iso), st: { fmt: 'date', border: 'all', ...st } });

// A titled table: title (row 1), subtitle (row 2), headers (row 4), data from row 5, then totals.
// columns: [{ label, width, fmt, total: true, wrap, input: true, formula: (row) => 'E5*F5', list: [..] | source }]
// rows: arrays of values in column order (ignored for formula columns). blankRows: extra empty
// rows that keep formats, formulas and drop-downs so the sheet can be filled in by hand.
function table({ name, title, subtitle, columns, rows, blankRows = 0, totals = true, tabColor, cf = [], note, landscape = true }) {
  const HEAD = 3; // zero-based row of the headers
  const first = HEAD + 1;
  const n = rows.length + blankRows;
  const last = first + Math.max(n, 1) - 1;
  const out = [];
  out[0] = [{ v: title, st: ST.title }];
  out[1] = [{ v: subtitle || '', st: ST.subtitle }];
  if (note) out[2] = [{ v: note, st: ST.note }];
  out[HEAD] = columns.map((c) => ({ v: c.label, st: ST.head }));
  for (let i = 0; i < Math.max(n, 1); i++) {
    const r = first + i;
    const src = rows[i] || [];
    out[r] = columns.map((c, ci) => {
      const st = { border: 'all', fmt: c.fmt === 'text' ? undefined : c.fmt, wrap: c.wrap || undefined, fill: c.input && i >= rows.length ? 'input' : undefined };
      if (c.formula) return { f: c.formula(r + 1), st };
      const v = src[ci];
      if (c.fmt === 'date' || c.fmt === 'day') return { v: v ? serial(v) : null, st };
      return { v: v == null ? null : v, st };
    });
  }
  const anyTotal = totals && columns.some((c) => c.total);
  if (anyTotal) {
    const r = last + 1;
    out[r] = columns.map((c, ci) => {
      if (ci === 0) return { v: 'Total', st: ST.total };
      if (!c.total) return { v: null, st: ST.total };
      const range = `${col(ci)}${first + 1}:${col(ci)}${last + 1}`;
      const f = typeof c.total === 'function' ? c.total(first + 1, last + 1) : `SUBTOTAL(9,${range})`;
      return { f, st: { ...ST.total, fmt: c.fmt } };
    });
  }
  const validations = columns.map((c, ci) => (c.list || c.source
    ? { sqref: `${col(ci)}${first + 1}:${col(ci)}${last + 1}`, list: c.list, source: c.source, prompt: c.prompt }
    : null)).filter(Boolean);
  const rules = cf.map((r) => ({ sqref: r.sqref || `A${first + 1}:${col(columns.length - 1)}${last + 1}`, formula: r.formula(first + 1), tone: r.tone }));
  const heights = { [HEAD]: 30 };
  if (note) heights[2] = 30;
  return {
    name, tabColor, landscape,
    rows: out,
    cols: columns.map((c) => c.width || 14),
    heights,
    freeze: { rows: first, cols: 0 },
    autoFilter: `A${HEAD + 1}:${col(columns.length - 1)}${last + 1}`,
    merges: note ? [`A3:${col(Math.min(columns.length - 1, 9))}3`] : [],
    validations,
    cf: rules,
    firstRow: first + 1,
    lastRow: last + 1,
  };
}

module.exports = { build, table, serial, col, ref, D, ST, COLORS, quoteSheet };
