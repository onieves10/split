// Runs Code.gs against a fake SpreadsheetApp that mimics the uploaded sheet's layout and formulas.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const seed = JSON.parse(fs.readFileSync(__dirname + '/seed.json', 'utf8'));
const MONTH_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/;

function colNum(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function parseA1(a1) {
  const [a, b] = a1.split(':');
  const p = (x) => { const m = x.match(/^([A-Z]+)(\d+)$/); return [Number(m[2]), colNum(m[1])]; };
  const [r1, c1] = p(a); const [r2, c2] = b ? p(b) : [r1, c1];
  return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
}

class Sheet {
  constructor(ss, name, grid) { this.ss = ss; this.name = name; this.cells = {}; this.merges = []; this.protections = [];
    for (const [k, v] of Object.entries(grid)) this.cells[k] = (typeof v === 'string' && v.startsWith('=')) ? { f: v } : { v }; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getIndex() { return this.ss.sheets.indexOf(this) + 1; }
  getRange(a, b, c, d) { return typeof a === 'string' ? new Range(this, ...parseA1(a)) : new Range(this, a, b, c || 1, d || 1); }
  copyTo(ss) { const s = new Sheet(ss, 'Copy of ' + this.name, {}); s.cells = JSON.parse(JSON.stringify(this.cells));
    for (const k in s.cells) if (s.cells[k].v && s.cells[k].d) s.cells[k].v = new Date(s.cells[k].v);
    ss.sheets.push(s); return s; }
  protect() { const p = { desc: '', warn: false, setDescription(d) { this.desc = d; return this; }, getDescription() { return this.desc; },
    setWarningOnly(w) { this.warn = w; return this; }, remove: () => { this.protections = this.protections.filter((x) => x !== p); } };
    this.protections.push(p); return p; }
  getProtections() { return this.protections.slice(); }
  setColumnWidth() { return this; }
  raw(r, c) { const cell = this.cells[colName(c) + r]; return cell ? cell : null; }
  // Evaluate the few formulas the layout uses.
  value(r, c) {
    const cell = this.raw(r, c);
    if (!cell) return '';
    if (cell.f === undefined) return cell.v === undefined ? '' : cell.v;
    const f = cell.f;
    if (this.name === 'Settings') { const b = this.value(r, 2); return b === '' ? '' : 1 - b; }
    let m;
    if ((m = f.match(/^=IF\(([A-Z])(\d+)="",""/))) {
      const ac = colNum(m[1]); const amt = this.value(r, ac); if (amt === '') return '';
      let split = this.value(r, ac + 1); if (split === '') split = this.ss.getSheetByName('Settings').value(3, 2);
      const st = this.ss.getSheetByName('Settings'); let other = null;
      for (let i = 11; i <= 35; i++) if (st.value(i, 1) === split) other = st.value(i, 3);
      if (other === null) return '#N/A';
      return Math.round(amt * other * 100) / 100;
    }
    if ((m = f.match(/^=SUM\(([A-Z])(\d+):([A-Z])(\d+)\)$/))) {
      let s = 0; for (let i = Number(m[2]); i <= Number(m[4]); i++) { const v = this.value(i, colNum(m[1])); if (typeof v === 'number') s += v; } return s;
    }
    if (f === '=I5+I6') return this.value(5, 9) + this.value(6, 9);
    if (f === '=ABS(C5-C6)') return Math.abs(this.value(5, 3) - this.value(6, 3));
    if (f.startsWith('=IF(C5>C6')) { const a = this.value(5, 3), b = this.value(6, 3); return a > b ? 'Jonah Venmos Orlando' : b > a ? 'Orlando Venmos Jonah' : 'All square, nobody owes'; }
    throw new Error('Unhandled formula ' + f);
  }
  isSplitCell(r, c) { return (MONTH_RE.test(this.name) || this.name === 'Template') && r >= 11 && r <= 110 && (c === 4 || c === 10)
    || (this.name === 'Settings' && r === 3 && c === 2); }
  write(r, c, v) {
    const key = colName(c) + r;
    const existing = this.cells[key];
    if (existing && existing.f !== undefined) throw new Error('Script overwrote formula cell ' + this.name + '!' + key);
    let stored = v;
    if (typeof v === 'string') {
      if (v.startsWith("'")) stored = v.slice(1);
      else if (v.startsWith('=')) { this.cells[key] = { f: v }; return; }
      else if (/^-?\d+(\.\d+)?$/.test(v)) stored = Number(v);
      else if (/^\d{1,2}\/\d{1,4}$/.test(v) && Number(v.split('/')[0]) <= 12) stored = new Date(2026, 0, 1); // Sheets would make it a date
    }
    if (this.isSplitCell(r, c) && stored !== '') {
      const st = this.ss.getSheetByName('Settings'); const labels = [];
      for (let i = 11; i <= 35; i++) labels.push(st.value(i, 1));
      if (!labels.includes(stored)) throw new Error('Data validation rejected ' + JSON.stringify(stored) + ' in ' + this.name + '!' + key);
    }
    this.cells[key] = { v: stored };
  }
}

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.value(this.r + i, this.c + j)); out.push(row); } return out; }
  getValue() { return this.sh.value(this.r, this.c); }
  getDisplayValues() { return this.getValues().map((row) => row.map((v) => v instanceof Date ? 'DATE' : String(v))); }
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  setValues(vals) { assert.strictEqual(vals.length, this.nr); vals.forEach((row, i) => { assert.strictEqual(row.length, this.nc); row.forEach((v, j) => this.sh.write(this.r + i, this.c + j, v)); }); return this; }
  setValue(v) { this.sh.write(this.r, this.c, v); return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) { const k = colName(this.c + j) + (this.r + i); if (this.sh.cells[k] && this.sh.cells[k].f === undefined) delete this.sh.cells[k]; } return this; }
  clear() { return this.clearContent(); }
  isPartOfMerge() { return this.sh.merges.includes(`${this.r},${this.c}`); }
  merge() { this.sh.merges.push(`${this.r},${this.c}`); return this; }
}
for (const m of ['setFontFamily', 'setFontWeight', 'setFontColor', 'setBackground', 'setBorder', 'setNumberFormat']) Range.prototype[m] = function () { return this; };

class Spreadsheet {
  constructor() { this.sheets = Object.entries(seed).map(([n, g]) => new Sheet(this, n, g)); this.active = null; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/test/edit'; }
  getSpreadsheetTimeZone() { return 'America/Denver'; }
  setActiveSheet(s) { this.active = s; return s; }
  moveActiveSheet(pos) { this.sheets = this.sheets.filter((s) => s !== this.active); this.sheets.splice(pos - 1, 0, this.active); }
}

const ss = new Spreadsheet();
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush() {}, ProtectionType: { SHEET: 'SHEET' }, BorderStyle: { SOLID: 1 } },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }) },
  Utilities: { formatDate: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` },
  console,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../Code.gs', 'utf8'), ctx);

module.exports = { ctx, ss };
