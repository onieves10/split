/**
 * Backend for the Orlando & Jonah shared expenses app.
 *
 * It reads and writes the month tabs of the "Orlando & Jonah Shared Expenses"
 * Google Sheet, so the app and the sheet always show the same numbers.
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as: Me
 *   Who has access: Anyone
 * Then paste the web app URL into the app.
 */

// Leave blank when this script is attached to the sheet (Extensions > Apps Script).
// For a standalone script, put the sheet's ID here.
const SPREADSHEET_ID = '';

const PEOPLE = ['Orlando', 'Jonah'];
const FIRST_ROW = 11;
const LAST_ROW = 110;
const TABLE_COL = { Orlando: 1, Jonah: 7 }; // first column of each table: A and G
const SPLIT_FIRST = 11;
const SPLIT_LAST = 35;
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const MONTH_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/;
const CLOSED_TAG = 'Closed month';

function doGet() {
  return json_({ ok: true, app: 'shared-expenses', version: 1 });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    return json_(Object.assign({ ok: true }, handle_(req)));
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) { /* lock was never taken */ }
  }
}

function handle_(req) {
  const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  const settingsSheet = ss.getSheetByName('Settings');
  if (!settingsSheet) throw new Error('The sheet has no Settings tab.');
  ensureAppSettings_(settingsSheet);
  const stored = String(settingsSheet.getRange('G6').getDisplayValue() || '').trim();
  const action = req.action;

  if (action === 'hello') return { passcodeSet: !!stored, people: PEOPLE };

  if (action === 'setPasscode') {
    if (stored) throw new Error('A passcode is already set. Enter it to connect.');
    const pass = String(req.passcode || '').trim();
    if (pass.length < 4) throw new Error('Use at least 4 characters for the passcode.');
    settingsSheet.getRange('G6').setValue("'" + pass);
    return bootstrap_(ss);
  }

  if (!stored) throw new Error('NO_PASSCODE');
  if (String(req.passcode || '').trim() !== stored) throw new Error('BAD_PASSCODE');

  switch (action) {
    case 'bootstrap': {
      // The app can ask for a month here too, so opening it takes one request instead of two.
      const out = bootstrap_(ss);
      const wanted = String(req.month || '');
      if (MONTH_RE.test(wanted) && ss.getSheetByName(wanted)) out.month = monthData_(ss, ss.getSheetByName(wanted));
      return out;
    }
    case 'getMonth':
      return { month: monthData_(ss, monthSheet_(ss, req.month)) };
    case 'addExpense':
      return addExpense_(ss, req);
    case 'updateExpense':
      return updateExpense_(ss, req);
    case 'deleteExpense':
      return deleteExpense_(ss, req);
    case 'createMonth':
      return createMonth_(ss, req);
    case 'closeMonth':
      return setClosed_(ss, req, true);
    case 'reopenMonth':
      return setClosed_(ss, req, false);
    case 'saveSettings':
      return saveSettings_(ss, req);
    default:
      throw new Error('Unknown action: ' + action);
  }
}

// ---------- reads ----------

function bootstrap_(ss) {
  return { months: listMonths_(ss), settings: readSettings_(ss), sheetUrl: ss.getUrl() };
}

function listMonths_(ss) {
  return ss.getSheets()
    .filter(function (sh) { return MONTH_RE.test(sh.getName()); })
    .map(function (sh) { return monthSummary_(ss, sh); })
    .sort(function (a, b) { return (a.year - b.year) || (a.month - b.month); });
}

function monthSummary_(ss, sh) {
  const m = sh.getName().match(MONTH_RE);
  const top = sh.getRange('A1:K7').getValues();
  const status = String(top[4][10] || '').trim() === 'Closed' ? 'Closed' : 'Open';
  return {
    name: sh.getName(),
    title: sh.getRange('A1').getDisplayValue() || sh.getName(),
    year: Number(m[2]),
    month: MONTH_ABBR.indexOf(m[1]) + 1,
    status: status,
    closedOn: status === 'Closed' ? fmtDate_(top[5][10], ss) : '',
    settlement: status === 'Closed' ? String(top[6][10] || '') : '',
    summary: {
      jonahOwesOrlando: num_(top[4][2]),
      orlandoOwesJonah: num_(top[5][2]),
      orlandoPaid: num_(top[4][8]),
      jonahPaid: num_(top[5][8])
    }
  };
}

function monthData_(ss, sh) {
  SpreadsheetApp.flush();
  const data = monthSummary_(ss, sh);
  const rows = sh.getRange(FIRST_ROW, 1, LAST_ROW - FIRST_ROW + 1, 11).getValues();
  const expenses = [];
  rows.forEach(function (r, i) {
    PEOPLE.forEach(function (p) {
      const c = TABLE_COL[p] - 1;
      if (isBlank_(r[c]) && isBlank_(r[c + 1]) && isBlank_(r[c + 2])) return;
      expenses.push({
        payer: p,
        row: FIRST_ROW + i,
        date: fmtDate_(r[c], ss),
        item: String(r[c + 1]),
        amount: num_(r[c + 2]),
        split: String(r[c + 3] || ''),
        owed: num_(r[c + 4])
      });
    });
  });
  data.expenses = expenses;
  return data;
}

function readSettings_(ss) {
  const sh = ss.getSheetByName('Settings');
  const n = SPLIT_LAST - SPLIT_FIRST + 1;
  const labels = sh.getRange(SPLIT_FIRST, 1, n, 1).getDisplayValues();
  const vals = sh.getRange(SPLIT_FIRST, 1, n, 4).getValues();
  const splits = [];
  labels.forEach(function (l, i) {
    const label = String(l[0]).trim();
    if (!label) return;
    splits.push({ label: label, payerShare: num_(vals[i][1]), note: String(vals[i][3] || '') });
  });
  return {
    defaultSplit: String(sh.getRange('B3').getDisplayValue()).trim() || '50/50',
    splits: splits,
    venmo: {
      Orlando: String(sh.getRange('G4').getDisplayValue()).trim(),
      Jonah: String(sh.getRange('G5').getDisplayValue()).trim()
    }
  };
}

// ---------- expense writes ----------

function addExpense_(ss, req) {
  const sh = openMonthSheet_(ss, req.month);
  const e = cleanExpense_(ss, req);
  const row = firstEmptyRow_(sh, e.payer);
  writeRow_(sh, e.payer, row, e);
  return { month: monthData_(ss, sh), months: listMonths_(ss) };
}

function updateExpense_(ss, req) {
  const sh = openMonthSheet_(ss, req.month);
  checkExpected_(sh, req.payer, req.row, req.expect);
  const e = cleanExpense_(ss, req);
  if (e.payer === req.payer) {
    writeRow_(sh, e.payer, Number(req.row), e);
  } else {
    const row = firstEmptyRow_(sh, e.payer);
    writeRow_(sh, e.payer, row, e);
    removeRow_(sh, req.payer, Number(req.row));
  }
  return { month: monthData_(ss, sh), months: listMonths_(ss) };
}

function deleteExpense_(ss, req) {
  const sh = openMonthSheet_(ss, req.month);
  checkExpected_(sh, req.payer, req.row, req.expect);
  removeRow_(sh, req.payer, Number(req.row));
  return { month: monthData_(ss, sh), months: listMonths_(ss) };
}

function cleanExpense_(ss, req) {
  const payer = String(req.newPayer || req.payer || '');
  if (PEOPLE.indexOf(payer) < 0) throw new Error('Pick who paid.');
  const amount = Math.round(Number(req.amount) * 100) / 100;
  if (!(amount > 0) || amount > 1000000) throw new Error('Enter an amount greater than $0.');
  const item = String(req.item || '').trim().slice(0, 200);
  if (!item) throw new Error('Say what the expense was for.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.date || ''))) throw new Error('Pick a date.');
  const split = String(req.split || '').trim();
  if (split) {
    const labels = readSettings_(ss).splits.map(function (s) { return s.label; });
    if (labels.indexOf(split) < 0) throw new Error('Unknown split: ' + split);
  }
  return { payer: payer, amount: amount, item: item, date: String(req.date), split: split };
}

function checkExpected_(sh, payer, row, expect) {
  if (PEOPLE.indexOf(payer) < 0) throw new Error('Unknown payer.');
  row = Number(row);
  if (!(row >= FIRST_ROW && row <= LAST_ROW)) throw new Error('Unknown expense.');
  const v = sh.getRange(row, TABLE_COL[payer], 1, 3).getValues()[0];
  const sameItem = String(v[1]).trim() === String((expect && expect.item) || '').trim();
  const sameAmount = Math.abs(num_(v[2]) - Number((expect && expect.amount) || 0)) < 0.005;
  if (!sameItem || !sameAmount) {
    throw new Error('That expense changed since you loaded it. Refresh and try again.');
  }
}

function firstEmptyRow_(sh, payer) {
  const n = LAST_ROW - FIRST_ROW + 1;
  const vals = sh.getRange(FIRST_ROW, TABLE_COL[payer], n, 3).getValues();
  let last = -1;
  vals.forEach(function (r, i) {
    if (!isBlank_(r[0]) || !isBlank_(r[1]) || !isBlank_(r[2])) last = i;
  });
  if (last + 1 >= n) throw new Error(payer + "'s table for this month is full (" + n + ' rows).');
  return FIRST_ROW + last + 1;
}

function writeRow_(sh, payer, row, e) {
  const p = e.date.split('-').map(Number);
  const date = new Date(p[0], p[1] - 1, p[2], 12); // noon, so time zones never shift the day
  sh.getRange(row, TABLE_COL[payer], 1, 4)
    .setValues([[date, asText_(e.item), e.amount, e.split ? asText_(e.split) : '']]);
}

function removeRow_(sh, payer, row) {
  const n = LAST_ROW - FIRST_ROW + 1;
  const rng = sh.getRange(FIRST_ROW, TABLE_COL[payer], n, 4);
  const vals = rng.getValues();
  vals.splice(row - FIRST_ROW, 1);
  vals.push(['', '', '', '']);
  rng.setValues(vals.map(function (r) { return [r[0], asText_(r[1]), r[2], asText_(r[3])]; }));
}

// ---------- months ----------

// The template tab. Exact name wins; otherwise any tab whose name starts with
// "Template", so renames like "TEMPLATE (DO NOT EDIT)" keep working.
function findTemplate_(ss) {
  const sheets = ss.getSheets();
  let loose = null;
  for (let i = 0; i < sheets.length; i++) {
    const n = sheets[i].getName().trim();
    if (n.toLowerCase() === 'template') return sheets[i];
    if (!loose && /^template\b/i.test(n)) loose = sheets[i];
  }
  return loose;
}

function createMonth_(ss, req) {
  const y = Number(req.year);
  const m = Number(req.monthIndex);
  if (!(y >= 2000 && y <= 2100) || !(m >= 1 && m <= 12)) throw new Error('Pick a valid month.');
  const name = MONTH_ABBR[m - 1] + ' ' + y;
  if (ss.getSheetByName(name)) throw new Error(name + ' already exists.');
  const template = findTemplate_(ss);
  if (!template) throw new Error('The sheet has no Template tab to copy. Name a tab Template, or start its name with Template, like "TEMPLATE (DO NOT EDIT)".');

  const sh = template.copyTo(ss).setName(name);
  sh.getRange('A1').setValue("'" + MONTH_FULL[m - 1] + ' ' + y);
  const n = LAST_ROW - FIRST_ROW + 1;
  PEOPLE.forEach(function (p) { sh.getRange(FIRST_ROW, TABLE_COL[p], n, 4).clearContent(); });
  sh.getRange('J4:K7').clear();

  // Keep month tabs in date order, ahead of Template and Settings.
  const key = y * 12 + m;
  let target = template.getIndex();
  ss.getSheets().forEach(function (other) {
    const mm = other.getName().match(MONTH_RE);
    if (!mm || other.getName() === name) return;
    const k = Number(mm[2]) * 12 + MONTH_ABBR.indexOf(mm[1]) + 1;
    if (k > key && other.getIndex() < target) target = other.getIndex();
  });
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(target);
  return { month: monthData_(ss, sh), months: listMonths_(ss) };
}

function setClosed_(ss, req, closed) {
  const sh = monthSheet_(ss, req.month);
  const head = sh.getRange('J4:K4');
  if (!head.isPartOfMerge()) head.merge();
  head.setValue('Month status').setFontFamily('Arial').setFontWeight('bold')
    .setFontColor('#FFFFFF').setBackground('#1F3864');
  sh.getRange('J5:J7').setValues([['Status'], ['Closed on'], ['Settlement']]);
  const body = sh.getRange('J5:K7');
  body.setFontFamily('Arial').setBorder(true, true, true, true, true, true, '#D0D0D0', SpreadsheetApp.BorderStyle.SOLID);

  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) {
    if (p.getDescription() === CLOSED_TAG) p.remove();
  });
  if (closed) {
    const note = String(req.note || '').slice(0, 200);
    sh.getRange('K5:K7').setValues([['Closed'], [new Date()], [note ? asText_(note) : '']]);
    sh.getRange('K6').setNumberFormat('mmm d, yyyy');
    sh.getRange('K5').setFontWeight('bold').setFontColor('#2B8A3E');
    sh.protect().setDescription(CLOSED_TAG).setWarningOnly(true);
  } else {
    sh.getRange('K5').setValue('Open').setFontWeight('bold').setFontColor('#000000');
    sh.getRange('K6:K7').clearContent();
  }
  return { month: monthData_(ss, sh), months: listMonths_(ss) };
}

// ---------- settings ----------

function saveSettings_(ss, req) {
  const sh = ss.getSheetByName('Settings');
  const current = readSettings_(ss);
  const labels = current.splits.map(function (s) { return s.label; });

  if (req.addSplit) {
    const label = String(req.addSplit.label || '').replace(/\s/g, '');
    const m = label.match(/^(\d{1,3})\/(\d{1,3})$/);
    if (!m || Number(m[1]) + Number(m[2]) !== 100) {
      throw new Error('Write a split as two numbers that add up to 100, like 80/20.');
    }
    if (labels.indexOf(label) >= 0) throw new Error(label + ' is already an option.');
    const n = SPLIT_LAST - SPLIT_FIRST + 1;
    const col = sh.getRange(SPLIT_FIRST, 1, n, 1).getDisplayValues();
    let row = -1;
    for (let i = 0; i < n; i++) { if (!String(col[i][0]).trim()) { row = SPLIT_FIRST + i; break; } }
    if (row < 0) throw new Error('The split list is full.');
    sh.getRange(row, 1, 1, 2).setValues([["'" + label, Number(m[1]) / 100]]);
    const note = String(req.addSplit.note || '').trim().slice(0, 100);
    if (note) sh.getRange(row, 4).setValue(asText_(note));
    labels.push(label);
  }
  if (req.defaultSplit !== undefined) {
    const d = String(req.defaultSplit).trim();
    if (labels.indexOf(d) < 0) throw new Error('Unknown split: ' + d);
    sh.getRange('B3').setValue("'" + d);
  }
  if (req.venmo) {
    PEOPLE.forEach(function (p, i) {
      if (req.venmo[p] === undefined) return;
      const handle = String(req.venmo[p]).trim().replace(/^@/, '');
      if (handle && !/^[A-Za-z0-9_-]{1,40}$/.test(handle)) throw new Error('That Venmo username looks off: ' + handle);
      sh.getRange(4 + i, 7).setValue(handle ? "'" + handle : '');
    });
  }
  return { settings: readSettings_(ss) };
}

/** Adds the app's block (Venmo usernames and passcode) to the Settings tab the first time. */
function ensureAppSettings_(sh) {
  if (String(sh.getRange('F3').getValue()).trim()) return;
  const head = sh.getRange('F3:G3');
  head.merge().setValue('App settings').setFontFamily('Arial').setFontWeight('bold')
    .setFontColor('#FFFFFF').setBackground('#1F3864');
  sh.getRange('F4:F6').setValues([["Orlando's Venmo"], ["Jonah's Venmo"], ['App passcode']]);
  sh.getRange('F4:G6').setFontFamily('Arial')
    .setBorder(true, true, true, true, true, true, '#D0D0D0', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('G4:G6').setFontColor('#0000FF');
  sh.setColumnWidth(6, 130);
  sh.setColumnWidth(7, 150);
}

// ---------- helpers ----------

function monthSheet_(ss, name) {
  name = String(name || '');
  const sh = MONTH_RE.test(name) ? ss.getSheetByName(name) : null;
  if (!sh) throw new Error('No tab named ' + name + '.');
  return sh;
}

function openMonthSheet_(ss, name) {
  const sh = monthSheet_(ss, name);
  if (String(sh.getRange('K5').getValue()).trim() === 'Closed') {
    throw new Error(name + ' is closed. Reopen it to make changes.');
  }
  return sh;
}

function fmtDate_(v, ss) {
  if (v instanceof Date) return Utilities.formatDate(v, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return isBlank_(v) ? '' : String(v);
}

function asText_(v) {
  // A leading apostrophe stops Sheets from turning text like "1/2" into a date or "=x" into a formula.
  return typeof v === 'string' && v !== '' ? "'" + v : v;
}

function num_(v) {
  const n = Number(v);
  return isFinite(n) && v !== '' ? Math.round(n * 100) / 100 : 0;
}

function isBlank_(v) {
  return v === '' || v === null || v === undefined;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
