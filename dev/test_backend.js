const assert = require('assert');
const { ctx, ss } = require('./fake_sheet');

let PASS = '';
function call(action, body = {}) {
  const res = ctx.doPost({ postData: { contents: JSON.stringify({ action, passcode: PASS, ...body }) } });
  return JSON.parse(res.text);
}
function ok(action, body) { const r = call(action, body); if (!r.ok) throw new Error(action + ' failed: ' + r.error); return r; }
function fails(action, body, re) { const r = call(action, body); assert(!r.ok, action + ' should fail'); assert(re.test(r.error), r.error); }

// 1. passcode
assert.strictEqual(ok('hello').passcodeSet, false);
fails('bootstrap', {}, /NO_PASSCODE/);
PASS = '4821';
let r = ok('setPasscode');
assert.deepStrictEqual(r.months.map((m) => m.name), ['Nov 2026', 'Dec 2026']);
assert.strictEqual(r.settings.defaultSplit, '50/50');
assert.deepStrictEqual(r.settings.splits.map((s) => s.label), ['50/50', '60/40', '40/60', '70/30', '30/70', '0/100']);
fails('setPasscode', {}, /already set/);
PASS = 'nope'; fails('bootstrap', {}, /BAD_PASSCODE/); PASS = '4821';

// 2. add expenses
const M = 'Nov 2026';
ok('addExpense', { month: M, payer: 'Orlando', date: '2026-11-02', item: 'Groceries', amount: 100, split: '' });
ok('addExpense', { month: M, payer: 'Orlando', date: '2026-11-05', item: 'Gas', amount: 60, split: '60/40' });
ok('addExpense', { month: M, payer: 'Jonah', date: '2026-11-03', item: 'Utilities', amount: 200, split: '60/40' });
r = ok('addExpense', { month: M, payer: 'Orlando', date: '2026-11-09', item: '1/2 pizza', amount: '33.333', split: '0/100' });
let mo = r.month;
assert.strictEqual(mo.expenses.length, 4);
const pizza = mo.expenses.find((e) => e.item === '1/2 pizza');
assert(pizza, 'item text kept as text'); assert.strictEqual(pizza.amount, 33.33); assert.strictEqual(pizza.owed, 33.33); assert.strictEqual(pizza.row, 13);
assert.strictEqual(mo.summary.jonahOwesOrlando, 50 + 24 + 33.33);
assert.strictEqual(mo.summary.orlandoOwesJonah, 80);
assert.strictEqual(mo.expenses.find((e) => e.item === 'Utilities').row, 11);
fails('addExpense', { month: M, payer: 'Orlando', date: '2026-11-09', item: 'x', amount: 5, split: '99/1' }, /Unknown split/);
fails('addExpense', { month: M, payer: 'Orlando', date: '2026-11-09', item: '', amount: 5 }, /what the expense/);
fails('addExpense', { month: M, payer: 'Orlando', date: '2026-11-09', item: 'x', amount: 0 }, /greater than/);

// 3. edit in place and move between payers
r = ok('updateExpense', { month: M, payer: 'Orlando', row: 12, expect: { item: 'Gas', amount: 60 }, date: '2026-11-05', item: 'Gas', amount: 80, split: '60/40' });
assert.strictEqual(r.month.expenses.find((e) => e.item === 'Gas').owed, 32);
r = ok('updateExpense', { month: M, payer: 'Orlando', row: 11, expect: { item: 'Groceries', amount: 100 }, newPayer: 'Jonah', date: '2026-11-02', item: 'Groceries', amount: 100, split: '' });
mo = r.month;
assert.deepStrictEqual(mo.expenses.filter((e) => e.payer === 'Orlando').map((e) => [e.row, e.item]), [[11, 'Gas'], [12, '1/2 pizza']]);
assert.deepStrictEqual(mo.expenses.filter((e) => e.payer === 'Jonah').map((e) => [e.row, e.item]), [[11, 'Utilities'], [12, 'Groceries']]);
assert.strictEqual(mo.summary.orlandoOwesJonah, 130);
fails('updateExpense', { month: M, payer: 'Orlando', row: 11, expect: { item: 'Groceries', amount: 100 }, date: '2026-11-02', item: 'x', amount: 1 }, /changed since/);

// 4. delete
fails('deleteExpense', { month: M, payer: 'Orlando', row: 11, expect: { item: 'Gas', amount: 60 } }, /changed since/);
r = ok('deleteExpense', { month: M, payer: 'Orlando', row: 11, expect: { item: 'Gas', amount: 80 } });
assert.deepStrictEqual(r.month.expenses.filter((e) => e.payer === 'Orlando').map((e) => [e.row, e.item, e.split]), [[11, '1/2 pizza', '0/100']]);
assert.strictEqual(r.month.summary.jonahOwesOrlando, 33.33);
assert.strictEqual(r.month.expenses.find((e) => e.item === 'Utilities').date, '2026-11-03');

// 5. months
r = ok('createMonth', { year: 2027, monthIndex: 1 });
assert.strictEqual(r.month.title, 'January 2027'); assert.strictEqual(r.month.expenses.length, 0);
r = ok('createMonth', { year: 2026, monthIndex: 10 });
assert.deepStrictEqual(ss.getSheets().map((s) => s.name), ['Oct 2026', 'Nov 2026', 'Dec 2026', 'Jan 2027', 'Template', 'Settings']);
assert.deepStrictEqual(r.months.map((m) => m.name), ['Oct 2026', 'Nov 2026', 'Dec 2026', 'Jan 2027']);
fails('createMonth', { year: 2026, monthIndex: 11 }, /already exists/);
r = ok('addExpense', { month: 'Jan 2027', payer: 'Jonah', date: '2027-01-04', item: 'Rent', amount: 2000, split: '' });
assert.strictEqual(r.month.summary.orlandoOwesJonah, 1000);
fails('getMonth', { month: 'Template' }, /No tab named/);

// 6. close and reopen
r = ok('closeMonth', { month: M, note: 'Orlando paid Jonah $96.67' });
assert.strictEqual(r.month.status, 'Closed'); assert.strictEqual(r.month.settlement, 'Orlando paid Jonah $96.67');
assert(r.month.closedOn.match(/^\d{4}-\d{2}-\d{2}$/));
assert.strictEqual(r.months.find((m) => m.name === M).status, 'Closed');
assert.strictEqual(ss.getSheetByName(M).protections.length, 1);
fails('addExpense', { month: M, payer: 'Orlando', date: '2026-11-09', item: 'x', amount: 5 }, /is closed/);
r = ok('reopenMonth', { month: M });
assert.strictEqual(r.month.status, 'Open'); assert.strictEqual(ss.getSheetByName(M).protections.length, 0);
ok('addExpense', { month: M, payer: 'Orlando', date: '2026-11-20', item: 'Tip', amount: 10 });

// 7. settings
r = ok('saveSettings', { addSplit: { label: '80/20' }, venmo: { Orlando: '@orlando-n', Jonah: 'jonah_x' } });
assert.deepStrictEqual(r.settings.venmo, { Orlando: 'orlando-n', Jonah: 'jonah_x' });
assert(r.settings.splits.some((s) => s.label === '80/20' && s.payerShare === 0.8));
r = ok('saveSettings', { defaultSplit: '80/20' });
assert.strictEqual(r.settings.defaultSplit, '80/20');
fails('saveSettings', { addSplit: { label: '70/20' } }, /add up to 100/);
fails('saveSettings', { addSplit: { label: '80/20' } }, /already/);
fails('saveSettings', { venmo: { Jonah: 'bad name!' } }, /looks off/);
r = ok('addExpense', { month: M, payer: 'Orlando', date: '2026-11-21', item: 'Default split now 80/20', amount: 100, split: '' });
assert.strictEqual(r.month.expenses.find((e) => e.item.startsWith('Default')).owed, 20);
// split labels like 2/98 must stay text
ok('saveSettings', { addSplit: { label: '2/98' } });
ok('addExpense', { month: M, payer: 'Jonah', date: '2026-11-22', item: 'Tiny share', amount: 50, split: '2/98' });
r = ok('bootstrap', { month: 'Jan 2027' });
assert.strictEqual(r.month.name, 'Jan 2027'); assert.strictEqual(r.month.expenses.length, 1);
assert.strictEqual(ok('bootstrap', { month: 'Mar 2031' }).month, undefined);
// 8. template tab renamed, e.g. "TEMPLATE (DO NOT EDIT)"
const tpl = ss.getSheets().find((s) => s.name === 'Template');
assert(tpl, 'template tab present');
tpl.setName('TEMPLATE (DO NOT EDIT)');
r = ok('createMonth', { year: 2027, monthIndex: 2 });
assert.strictEqual(r.month.title, 'February 2027');
assert(ss.getSheets().some((s) => s.name === 'Feb 2027'), 'Feb 2027 copied from the renamed template');
tpl.setName('Monthly template');  // does not start with "Template"
fails('createMonth', { year: 2027, monthIndex: 3 }, /no Template tab/);
tpl.setName('template');          // case does not matter
r = ok('createMonth', { year: 2027, monthIndex: 3 });
assert.strictEqual(r.month.title, 'March 2027');
tpl.setName('Template');

console.log('All backend tests passed');
