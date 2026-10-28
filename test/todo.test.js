// Tests for lib/todo.js (the To Do: Today / This week / This month, sizes, carry-over and quick checks). Every date is
// set by the test, so the results never depend on the day it runs.
// Run: node test/todo.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const T = require('../lib/todo');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
const fresh = () => T.normalize(null);
const MON = '2026-10-26', TUE = '2026-10-27', WED = '2026-10-28';
const names = { 'alpha-1a2b3c': 'Alpha', 'beta-4d5e6f': 'Beta', 'gamma-777777': 'Gamma' };

check('add: a row goes in its zone with its size and note; Today sizes add up against the day', () => {
  const s = fresh();
  assert(T.add(s, { project: 'alpha-1a2b3c', name: 'Alpha', size: 120, note: 'fix the header', zone: 'today' }, MON).ok);
  assert(T.add(s, { project: 'beta-4d5e6f', name: 'Beta', size: 15, zone: 'today' }, MON).ok);
  assert(T.add(s, { project: 'gamma-777777', name: 'Gamma', size: 480, zone: 'month' }, MON).ok);
  const v = T.view(s, MON, names);
  assert.deepStrictEqual(v.zones.map(z => z.items.map(i => i.name)), [['Alpha', 'Beta'], [], ['Gamma']]);
  assert.strictEqual(v.zones[0].items[0].note, 'fix the header');
  assert.strictEqual(v.total.todayMin, 135);
  assert.strictEqual(v.total.text, 'Today 2 h 15 of 8 h');
  assert.strictEqual(v.open, 2);
});

check('over the day: said plainly, never refused', () => {
  const s = fresh();
  for (const size of [480, 60]) assert(T.add(s, { project: 'alpha-1a2b3c', size, zone: 'today' }, MON).ok);
  assert.strictEqual(T.view(s, MON, names).total.text, 'Today 9 h of 8 h: 1 h over');
  assert(T.setSettings(s, { dayHours: 12 }).ok);
  assert.strictEqual(T.view(s, MON, names).total.text, 'Today 9 h of 12 h');
  assert(!T.setSettings(s, { dayHours: 20 }).ok, 'a day is 1-16 h');
  assert(!T.setSettings(s, { checksPerDay: 3 }).ok, 'quick checks come 1 or 2 a day');
});

check('nothing drops off: an unfinished Today row is still in Today the next day, marked with its day', () => {
  const s = fresh();
  T.add(s, { project: 'alpha-1a2b3c', zone: 'today' }, MON);
  const v = T.view(s, WED, names);
  assert.strictEqual(v.zones[0].items.length, 1);
  assert.strictEqual(v.zones[0].items[0].from, 'Mon 26');
  assert.strictEqual(T.view(s, MON, names).zones[0].items[0].from, null, 'not marked on the day it came in');
});

check('move: between zones and before another row; into Today it takes today\'s date', () => {
  const s = fresh();
  const a = T.add(s, { project: 'alpha-1a2b3c', zone: 'week' }, MON).item;
  const b = T.add(s, { project: 'beta-4d5e6f', zone: 'today' }, MON).item;
  assert(T.move(s, a.id, 'today', b.id, WED).ok);
  const v = T.view(s, WED, names);
  assert.deepStrictEqual(v.zones[0].items.map(i => i.name), ['Alpha', 'Beta']);
  assert.strictEqual(v.zones[0].items[0].from, null, 'moved in today: not carried');
  assert.strictEqual(v.zones[0].items[1].from, 'Mon 26');
  assert(!T.move(s, a.id, 'someday', null, WED).ok, 'an unknown zone is refused');
  assert(!T.move(s, 'deadbeef00', 'today', null, WED).ok, 'an unknown row is refused');
});

check('done today shows, and counts in the day; earlier done rows show for this week, this month, or are hidden', () => {
  const s = fresh();
  const a = T.add(s, { project: 'alpha-1a2b3c', zone: 'today', size: 60 }, MON).item;
  T.add(s, { project: 'beta-4d5e6f', zone: 'today', size: 120 }, MON);
  T.done(s, a.id, true, TUE);
  let v = T.view(s, TUE, names);
  assert.deepStrictEqual(v.zones[0].items.map(i => i.name), ['Beta'], 'a done row leaves its part');
  assert.deepStrictEqual(v.doneToday.map(i => i.name), ['Alpha'], 'done today shows');
  assert.strictEqual(v.total.text, 'Today 3 h of 8 h · 1 h done', 'the day counts what was done today and what is left');
  v = T.view(s, WED, names);
  assert.strictEqual(v.doneToday.length, 0);
  assert.deepStrictEqual(v.doneEarlier.items.map(i => i.name), ['Alpha'], 'the next day: earlier this week');
  assert.strictEqual(v.doneEarlier.name, 'Done earlier this week');
  assert.strictEqual(T.view(s, '2026-11-03', names).doneEarlier.items.length, 0, 'next week: no longer listed');
  T.setSettings(s, { doneShow: 'month' });
  assert.deepStrictEqual(T.view(s, '2026-10-30', names).doneEarlier.items.map(i => i.name), ['Alpha'], 'this month');
  assert.strictEqual(T.view(s, '2026-11-03', names).doneEarlier.items.length, 0, 'a new month: no longer listed');
  T.setSettings(s, { doneShow: 'hide' });
  v = T.view(s, WED, names);
  assert(v.doneEarlier.items.length === 0 && v.doneEarlier.hidden === 1, 'hidden, and how many is said');
  assert(!T.setSettings(s, { doneShow: 'year' }).ok);
  T.done(s, a.id, false, WED);
  v = T.view(s, WED, names);
  assert.deepStrictEqual(v.zones[0].items.map(i => i.name).sort(), ['Alpha', 'Beta'], 'unticked: back in its part');
  T.done(s, a.id, true, WED);
  assert.strictEqual(T.tidy(s, '2026-11-30'), 0, '33 days on: kept');
  assert.strictEqual(T.tidy(s, '2026-12-05'), 1, '38 days on: gone');
});

check('quick checks: 1 a day comes into Today, the longest overdue first, and none is skipped', () => {
  const s = fresh();
  T.setCheck(s, 'alpha-1a2b3c', 'week', 'Alpha', MON);
  T.setCheck(s, 'beta-4d5e6f', 'week', 'Beta', MON);
  s.checks['beta-4d5e6f'].next = '2026-10-20'; // Beta has waited longer
  T.setCheck(s, 'gamma-777777', 'month', 'Gamma', MON);
  s.checks['gamma-777777'].next = '2026-11-15'; // not due yet
  assert.strictEqual(T.pullChecks(s, MON), 1);
  let today = T.view(s, MON, names).zones[0].items;
  assert.deepStrictEqual(today.map(i => [i.name, i.kind, i.size]), [['Beta', 'check', 15]]);
  assert.strictEqual(T.pullChecks(s, MON), 0, 'one a day: no second one the same day');
  T.done(s, today[0].id, true, MON);
  assert.strictEqual(s.checks['beta-4d5e6f'].next, '2026-11-02', 'ticked: due again a week on');
  assert.strictEqual(T.pullChecks(s, MON), 0, 'still one a day after the tick');
  assert.strictEqual(T.pullChecks(s, TUE), 1);
  today = T.view(s, TUE, names).zones[0].items;
  assert.deepStrictEqual(today.map(i => i.name), ['Alpha'], 'the next day: the other one due');
});

check('quick checks: 2 a day when set; an open check is not added twice; untick puts its date back', () => {
  const s = fresh();
  T.setSettings(s, { checksPerDay: 2 });
  for (const k of Object.keys(names)) T.setCheck(s, k, 'week', names[k], MON);
  assert.strictEqual(T.pullChecks(s, MON), 2);
  assert.strictEqual(T.pullChecks(s, TUE), 1, 'the third one due; the first two are still open, so not again');
  const v = T.view(s, TUE, names).zones[0].items;
  assert.strictEqual(v.length, 3);
  const first = v[0];
  T.done(s, first.id, true, TUE);
  assert.strictEqual(s.checks[first.project].next, '2026-11-03');
  T.done(s, first.id, false, TUE);
  assert.strictEqual(s.checks[first.project].next, MON, 'unticked: back to when it was due');
});

check('quick checks over 30 days: 6 weekly checks at 1 a day each come up every week, none waits more than 6 days', () => {
  const s = fresh();
  const ks = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map(k => k + '-000000');
  for (const k of ks) T.setCheck(s, k, 'week', k, '2026-11-01');
  const last = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(2026, 10, 1 + i, 12), day = T.dayOf(d);
    T.pullChecks(s, day);
    for (const it of s.items.filter(x => x.kind === 'check' && !x.done && x.pulledOn === day)) { T.done(s, it.id, true, day); last[it.project] = day; }
  }
  for (const k of ks) assert(last[k] && last[k] >= '2026-11-24', k + ' was last checked ' + last[k]);
});

check('monthly: the same day next month; the 31st becomes the month\'s last day', () => {
  assert.strictEqual(T.nextDate('2026-10-15', 'month'), '2026-11-15');
  assert.strictEqual(T.nextDate('2026-01-31', 'month'), '2026-02-28');
  assert.strictEqual(T.nextDate('2026-12-20', 'month'), '2027-01-20');
  assert.strictEqual(T.nextDate('2026-12-29', 'week'), '2027-01-05');
  assert.strictEqual(T.weekStart('2026-11-01'), '2026-10-26', 'a Sunday belongs to the week from Monday');
});

check('a project that left the list keeps its row and name, and its check does not come in', () => {
  const s = fresh();
  T.add(s, { project: 'alpha-1a2b3c', name: 'Alpha', zone: 'today' }, MON);
  T.setCheck(s, 'beta-4d5e6f', 'week', 'Beta', MON);
  assert.strictEqual(T.pullChecks(s, MON, k => k !== 'beta-4d5e6f'), 0);
  const it = T.view(s, MON, {}).zones[0].items[0];
  assert(it.gone && it.name === 'Alpha');
});

check('text from the page is one line, without control or direction characters, at most 120', () => {
  assert.strictEqual(T.cleanText('fix\nthe\u202Eheader\u0007  now', 120), 'fix the header now');
  assert.strictEqual(T.cleanText('x'.repeat(500), 120).length, 120);
});

check('normalize: rows and checks of the wrong shape are dropped, the rest kept', () => {
  const s = T.normalize({
    items: [{ id: 'abcdef0123', project: 'alpha-1a2b3c', name: 'A', size: 60, zone: 'today', added: MON },
      { id: 'abcdef0123', project: 'alpha-1a2b3c', size: 60, zone: 'today' }, // same id again
      { id: 'zz', project: 'alpha-1a2b3c', size: 60, zone: 'today' }, { id: 'abcdef0124', project: '../x', size: 60, zone: 'today' },
      { id: 'abcdef0125', project: 'beta-4d5e6f', size: 61, zone: 'today' }, { id: 'abcdef0126', project: 'beta-4d5e6f', size: 60, zone: 'later' }],
    checks: { 'alpha-1a2b3c': { every: 'week', next: MON }, '__proto__': { every: 'week', next: MON }, 'beta-4d5e6f': { every: 'day', next: MON } },
    settings: { dayHours: 99, checksPerDay: 5 },
  });
  assert.deepStrictEqual(s.items.map(i => i.id), ['abcdef0123']);
  assert.deepStrictEqual(Object.keys(s.checks), ['alpha-1a2b3c']);
  assert.deepStrictEqual(s.settings, { dayHours: 8, checksPerDay: 1, doneShow: 'week' });
});

check('the store: a fresh read writes nothing; changes are saved; a damaged file is copied aside, not lost', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-todo-'));
  try {
    let day = MON;
    const st = T.create({ dataDir: dir, today: () => day });
    assert.strictEqual(st.view(names).open, 0);
    assert(!fs.existsSync(path.join(dir, 'todo.json')), 'a read writes no file');
    assert(st.add({ project: 'alpha-1a2b3c', name: 'Alpha', size: 120, zone: 'today' }).ok);
    const again = T.create({ dataDir: dir, today: () => day });
    assert.strictEqual(again.view(names).zones[0].items[0].name, 'Alpha', 'read back from the file');
    assert(!st.add({ project: '' }).ok);
    fs.writeFileSync(path.join(dir, 'todo.json'), '{"items": [ cut short');
    const broken = T.create({ dataDir: dir, today: () => day });
    assert.strictEqual(broken.view(names).open, 0);
    const aside = fs.readdirSync(dir).filter(f => /^todo\.damaged-.*\.json$/.test(f));
    assert.strictEqual(aside.length, 1, 'the damaged file was copied aside');
    assert.strictEqual(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), '{"items": [ cut short');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

console.log(failures ? failures + ' FAILED' : 'all passed');
process.exit(failures ? 1 : 0);
