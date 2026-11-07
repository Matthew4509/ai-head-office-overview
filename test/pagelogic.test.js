// Tests for office/public/pagelogic.js: the small decisions the page makes (gone-home time, arrow keys on tabs, how many
// findings a pasted report-back would set aside, newest-answer-only), and that the page no longer uses the browser's own
// confirm(), which does nothing when a browser blocks dialogs.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../office/public/pagelogic.js');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };

check('gone-home time: 5 to 1440 whole minutes are kept; 0, -5, 99999, empty and words are refused with a message', () => {
  assert.deepStrictEqual(L.quietMinutes('60'), { ok: true, value: 60 });
  assert.deepStrictEqual(L.quietMinutes(' 5 '), { ok: true, value: 5 });
  assert.deepStrictEqual(L.quietMinutes('1440'), { ok: true, value: 1440 });
  assert.deepStrictEqual(L.quietMinutes('59.6'), { ok: true, value: 60 });
  for (const bad of ['0', '-5', '99999', '4', '1441', '', 'abc', 'NaN', 'Infinity']) {
    const r = L.quietMinutes(bad);
    assert.strictEqual(r.ok, false, bad);
    assert(/\d/.test(r.message) && r.message.length > 20, 'a message for ' + bad);
  }
});

check('the page range is the office\'s own (office/src/setup.mjs)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'office', 'src', 'setup.mjs'), 'utf8');
  assert(new RegExp('m >= ' + L.QUIET_MIN + ' && m <= ' + L.QUIET_MAX).test(src), 'setup.mjs range differs from pagelogic.js');
});

check('arrow keys: Right and Left wrap round, Home and End go to the ends, other keys do nothing', () => {
  assert.strictEqual(L.nextTab('ArrowRight', 0, 4), 1);
  assert.strictEqual(L.nextTab('ArrowRight', 3, 4), 0);
  assert.strictEqual(L.nextTab('ArrowLeft', 0, 4), 3);
  assert.strictEqual(L.nextTab('ArrowLeft', 2, 4), 1);
  assert.strictEqual(L.nextTab('Home', 2, 4), 0);
  assert.strictEqual(L.nextTab('End', 1, 4), 3);
  assert.strictEqual(L.nextTab('a', 1, 4), -1);
  assert.strictEqual(L.nextTab('ArrowRight', 0, 0), -1);
});

const TABLE = (rows) => '## False flags\n\n| Rule | Where | Verdict | Why | What the rule should do |\n|---|---|---|---|---|\n' + rows.join('\n') + '\n';

check('report-back: counts the rows that would set findings aside (false, not a fault, duplicate), one per place', () => {
  const rows = [];
  for (let i = 1; i <= 12; i++) rows.push(`| SEC-00${i % 9 + 1} | src/f${i}.js:${i} | false | a test value | skip tests |`);
  assert.strictEqual(L.judgeRows(TABLE(rows)), 12);
  assert.strictEqual(L.judgeRows(TABLE(['| SEC-001 | a.php:3, b.php:9 | false | x | y |'])), 2);
  assert.strictEqual(L.judgeRows(TABLE(['| SEC-001 | a.js:3 | Not a fault | x | y |', '| SEC-002 | a.js:4 | duplicate of SEC-001 | x | y |'])), 2);
  assert.strictEqual(L.judgeRows(TABLE(['| SEC-001 | a.js:3 | real fault | x | y |', '| None | | | | |'])), 0);
  assert.strictEqual(L.judgeRows('no table here'), 0);
  assert.strictEqual(L.judgeRows(''), 0);
});

check('report-back: only the False flags section counts when there is one; the Findings table does not', () => {
  const t = '## Findings\n\n| Id | Severity | Category | Where | Evidence | Fix |\n|---|---|---|---|---|---|\n| R-1 | High | auth | a.js:1 | false | fix |\n\n' + TABLE(['| SEC-001 | a.js:3 | false | x | y |']);
  assert.strictEqual(L.judgeRows(t), 1);
  assert(L.JUDGE_CONFIRM_ABOVE >= 5 && L.JUDGE_CONFIRM_ABOVE <= 20);
});

check('sequence: only the newest ask is the latest', () => {
  const s = L.sequence();
  const a = s.begin(), b = s.begin();
  assert.strictEqual(s.isLatest(a), false);
  assert.strictEqual(s.isLatest(b), true);
  const c = s.begin();
  assert.strictEqual(s.isLatest(b), false);
  assert.strictEqual(s.isLatest(c), true);
});

check('the page scripts no longer call the browser\'s confirm()', () => {
  const dir = path.join(__dirname, '..', 'office', 'public');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert(!/(^|[^.\w])confirm\(/.test(text), f + ' still calls confirm(');
  }
});

check('index.html has the confirm window\'s layer after the other windows and loads pagelogic.js first', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'office', 'public', 'index.html'), 'utf8');
  assert(html.indexOf('id="ask"') > html.indexOf('id="check"'), 'the confirm layer must sit above the others');
  assert(html.indexOf('pagelogic.js') > 0 && html.indexOf('pagelogic.js') < html.indexOf('app.js'));
});

check('Help does not claim a fixed number of rules, and the canvas text names no List tab', () => {
  const dir = path.join(__dirname, '..', 'office', 'public');
  assert(!/about \d+ rules/.test(fs.readFileSync(path.join(dir, 'settings.js'), 'utf8')), 'Help gives a rule count');
  assert(!/List tab/.test(fs.readFileSync(path.join(dir, 'office.js'), 'utf8')), 'List tab named');
  assert(/Project planner/.test(fs.readFileSync(path.join(dir, 'settings.js'), 'utf8').match(/h3\('Project planner'\)[\s\S]{0,400}/)[0]), 'Help names the planner');
});

if (failures) { console.log(failures + ' failed'); process.exit(1); }
console.log('all passed');
