// Tests for lib/priorities.js (the project planner's rules and data), built on its worked examples: every number is
// worked out by hand first.
// Run: node test/priorities.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const P = require('../lib/priorities');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
const DAY = 86400000;
const at = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); };
// A score of exactly n out of 100: profit carries 30, so n/10 on every mark gives n.
const scored = n => ({ p: n / 10, d: n / 10, m: n / 10, c: n / 10, k: n / 10 });
const TODAY = '2026-10-16'; // a Friday
const project = (key, updated = TODAY) => ({ key, name: key, updated: at(updated) });

check('score: the five marks weigh 30 + 25 + 20 + 15 + 10; marks not set count 5', () => {
  assert.strictEqual(P.scoreOf({ p: 10, d: 10, m: 10, c: 10, k: 10 }), 100);
  assert.strictEqual(P.scoreOf({ p: 10, d: 0, m: 0, c: 0, k: 0 }), 30);
  assert.strictEqual(P.scoreOf({}), 50);
  assert.strictEqual(P.scoreOf({ p: 99, d: -3 }), 30 + 0 + 10 + 7.5 + 5, 'marks are kept to 0-10');
});

check('§8: 8 h, scores 80 / 70 / 63: #1 3 h 30, #2 1 h 51, #3 1 h 39, 420 min in all', () => {
  assert.deepStrictEqual(P.splitFocus(420, [80, 70, 63]), [210, 111, 99]);
  const plan = P.planDay({
    projects: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(k => project(k)),
    entries: { a: { scores: scored(80) }, b: { scores: scored(70) }, c: { scores: scored(63) }, d: { scores: scored(40) }, e: { scores: scored(40) }, f: { scores: scored(40) }, g: { scores: scored(20) } },
    today: TODAY,
  });
  assert.deepStrictEqual(plan.focus.map(f => [f.key, f.min]), [['a', 210], ['b', 111], ['c', 99]]);
  assert.strictEqual(plan.medium.min + plan.low.min, 60, 'the last hour: 40 + 20');
  assert.strictEqual(plan.focusMin + plan.bottomMin + plan.topMin, 480);
});

check('§8: rounding leftovers go on #1 (the parts always add up to the focus time)', () => {
  for (const total of [419, 420, 421, 300, 7]) {
    const parts = P.splitFocus(total, [90, 41, 13]);
    assert.strictEqual(parts.reduce((a, b) => a + b, 0), total, String(parts));
  }
  assert.deepStrictEqual(P.splitFocus(100, [50]), [100]);
  assert.deepStrictEqual(P.splitFocus(100, [50, 40]), [50, 50]);
});

check('§8: 20 low projects, one check-in a day by longest wait: each is seen every 20 days, never at random', () => {
  // Six projects above them fill the focus three and the medium slot; the 20 low ones wait from different days.
  const keys = [...'abcdef'].concat(Array.from({ length: 20 }, (_, i) => 'low' + i));
  const entries = Object.fromEntries(keys.map((k, i) => [k, { scores: scored(i < 6 ? 90 - i : 30) }]));
  const seen = Object.fromEntries(keys.map(k => [k, []]));
  const start = at('2026-01-01');
  for (let d = 0; d < 60; d++) {
    const today = P.dateOf(start + d * DAY);
    const plan = P.planDay({ projects: keys.map((k, i) => ({ key: k, name: k, updated: start - (i + 1) * DAY })), entries, today });
    seen[plan.low.key].push(d);
    entries[plan.low.key] = P.answer(entries[plan.low.key], 'fine', today);
  }
  for (let i = 0; i < 20; i++) {
    const days = seen['low' + i];
    assert.strictEqual(days.length, 3, `low${i} seen ${days.length} times in 60 days`);
    assert(days.every((d, j) => !j || d - days[j - 1] === 20), `low${i} seen on days ${days}`);
  }
});

check('§8: a flagged project (+20) reaches the top three, and loses the flag once worked on', () => {
  const entries = { a: { scores: scored(80) }, b: { scores: scored(70) }, c: { scores: scored(63) }, d: { scores: scored(55) } };
  entries.d = P.answer(entries.d, 'needs', TODAY);
  assert.strictEqual(P.rankScore(entries.d), 75);
  const plan = P.planDay({ projects: ['a', 'b', 'c', 'd'].map(k => project(k)), entries, today: TODAY });
  assert.deepStrictEqual(plan.focus.map(f => f.key), ['a', 'd', 'b']);
  assert(plan.focus[1].flagged);
  assert.strictEqual(P.clearWorkedFlag(entries.d, at(TODAY)).flag, 'needs', 'not yet: nothing changed after the day it was flagged');
  const after = P.clearWorkedFlag(entries.d, at('2026-10-17'));
  assert(!after.flag && !after.flaggedAt && P.rankScore(after) === 55);
});

check('a hard date puts a project at the top, soonest first; parked and ready-to-ship projects take no focus time', () => {
  const entries = { a: { scores: scored(90) }, b: { scores: scored(30), deadline: '2026-11-01' }, c: { scores: scored(20), deadline: '2026-10-20' },
    d: { scores: scored(99), stage: 'parked' }, e: { scores: scored(99), stage: 'ready' } };
  const plan = P.planDay({ projects: ['a', 'b', 'c', 'd', 'e'].map(k => project(k)), entries, today: TODAY });
  assert.deepStrictEqual(plan.focus.map(f => f.key), ['c', 'b', 'a']);
  assert.deepStrictEqual(plan.ready.map(r => r.key), ['e']);
  assert(!JSON.stringify(plan.focus).includes('"d"'));
});

check('§10.3: paid weekly check 30 at the top, medium 40 + two handovers 30 + low 20 at the bottom: focus 6 h = 180 / 95 / 85', () => {
  const cats = [{ id: 'unsorted', name: 'Not sorted', owner: 'mine' },
    { id: 'company-b', name: 'Company B', owner: 'client', care: { checkEvery: 'week', checkMin: 30, paid: true } },
    { id: 'clients', name: 'Clients', owner: 'client' }];
  const friday = new Date(at(TODAY)).getDay();
  const entries = {
    a: { scores: scored(80) }, b: { scores: scored(70) }, c: { scores: scored(63) }, d: { scores: scored(40) }, e: { scores: scored(40) }, f: { scores: scored(40) }, g: { scores: scored(20) },
    paidSite: { categories: ['company-b'], stage: 'looked-after', stageSince: '2026-09-01', checkDay: friday },
    hand1: { categories: ['clients'], stage: 'handover', stageSince: '2026-10-05' },
    hand2: { categories: ['clients'], stage: 'handover', stageSince: '2026-10-16' },
  };
  const plan = P.planDay({ projects: Object.keys(entries).map(k => project(k)), entries, cats, today: TODAY });
  assert.deepStrictEqual(plan.paid.map(c => [c.key, c.min]), [['paidSite', 30]]);
  assert.deepStrictEqual(plan.checkins.map(c => [c.key, c.min, c.kind]), [['hand1', 15, 'handover'], ['hand2', 15, 'handover']]);
  assert.strictEqual(plan.topMin, 30);
  assert.strictEqual(plan.bottomMin, 90);
  assert.strictEqual(plan.focusMin, 360);
  assert.deepStrictEqual(plan.focus.map(f => f.min), [180, 95, 85]);
  assert.strictEqual(30 + 180 + 95 + 85 + 40 + 30 + 20, 480);
  assert.strictEqual(plan.checkins[0].day, 12, 'handover day 12 of 30');
  assert(/2 check-ins today \(2 handover\): focus is 6 h/.test(plan.notes[0]), plan.notes[0]);
});

check('§10.3: six unpaid handovers make the bottom 150: focus 5 h, and the plan says so', () => {
  const cats = [{ id: 'unsorted', name: 'Not sorted' }, { id: 'company-b', name: 'Company B', owner: 'client', care: { checkEvery: 'week', checkMin: 30, paid: true } }];
  const friday = new Date(at(TODAY)).getDay();
  const entries = { a: { scores: scored(80) }, b: { scores: scored(70) }, c: { scores: scored(63) }, d: { scores: scored(40) }, e: { scores: scored(40) }, f: { scores: scored(40) }, g: { scores: scored(20) },
    paidSite: { categories: ['company-b'], stage: 'looked-after', stageSince: '2026-09-01', checkDay: friday } };
  for (let i = 0; i < 6; i++) entries['h' + i] = { stage: 'handover', stageSince: '2026-10-10' };
  const plan = P.planDay({ projects: Object.keys(entries).map(k => project(k)), entries, cats, today: TODAY });
  assert.strictEqual(plan.bottomMin, 150);
  assert.strictEqual(plan.focusMin, 300);
  assert(/6 check-ins today \(6 handover\): focus is 5 h/.test(plan.notes[0]), plan.notes[0]);
});

check('stages: a handover runs 30 days, then Looked after (weekly on its day) or Handed on when sold', () => {
  const cats = [{ id: 'unsorted', name: 'Not sorted' }];
  const e = { stage: 'handover', stageSince: '2026-09-17' }; // day 30 is 16 Oct
  assert.deepStrictEqual([P.standing(e, cats, '2026-10-16').stage, P.standing(e, cats, '2026-10-16').day], ['handover', 30]);
  const later = P.standing(e, cats, '2026-10-17');
  assert.strictEqual(later.stage, 'looked-after');
  assert.strictEqual(P.standing({ ...e, soldOn: '2026-09-17' }, cats, '2026-10-17').stage, 'handed-on');
  const weekly = { stage: 'looked-after', stageSince: '2026-10-01', checkDay: 3 }; // Wednesdays
  assert.strictEqual(P.standing(weekly, cats, '2026-10-21').due.kind, 'weekly');
  assert.strictEqual(P.standing(weekly, cats, '2026-10-22').due, null);
  assert.strictEqual(P.standing(weekly, cats, '2026-10-21').due.movable, true, 'a weekly check can move to tomorrow');
  assert.strictEqual(P.standing(e, cats, '2026-10-16').due.movable, false, 'a handover check stays');
});

check('O3 working days: weekends do not count and have no handover check; O4 off: own sites skip the handover', () => {
  const cats = [{ id: 'unsorted', name: 'Not sorted', owner: 'mine' }];
  const e = { stage: 'handover', stageSince: '2026-10-12' }; // a Monday
  const working = { ...P.SETTINGS, handoverDays: 'working' };
  assert.strictEqual(P.standing(e, cats, '2026-10-16', working).day, 5);
  assert.strictEqual(P.standing(e, cats, '2026-10-17', working).due, null, 'Saturday');
  assert.strictEqual(P.standing(e, cats, '2026-10-17').day, 6, 'calendar days by default');
  assert.strictEqual(P.standing(e, cats, '2026-10-16', { ...P.SETTINGS, ownHandover: false }).stage, 'looked-after');
});

check('care plans: a project follows its main category unless it has its own; a change says who changes, and "new" keeps them', () => {
  const store = { settings: P.SETTINGS, categories: [{ id: 'unsorted', name: 'Not sorted' }, { id: 'b', name: 'Company B', owner: 'client', care: { checkEvery: 'week', checkMin: 15 } }],
    entries: { x: { categories: ['b'] }, y: { categories: ['b'] }, z: { categories: ['b'], care: { checkMin: 60 } }, w: { categories: ['unsorted', 'b'] } } };
  assert.strictEqual(P.careOf(store.entries.x, store.categories).checkMin, 15);
  assert.strictEqual(P.careOf(store.entries.z, store.categories).checkMin, 60);
  assert.strictEqual(P.careOf(store.entries.w, store.categories).checkEvery, 'week', 'the second category never sets the care plan');
  assert.deepStrictEqual(P.careChange(store.entries, 'b'), { follows: ['x', 'y'], own: ['z'] });
  const r = P.changeCare(store, 'b', { checkEvery: 'week', checkMin: 30 }, 'new');
  assert(r.ok && r.kept === 2);
  assert.strictEqual(P.careOf(store.entries.x, store.categories).checkMin, 15, 'kept the old plan as its own');
  P.changeCare(store, 'b', { checkEvery: 'week', checkMin: 45 }, 'all');
  assert.strictEqual(P.careOf(store.entries.z, store.categories).checkMin, 60, 'its own plan is never changed');
});

check('data: kept in the data folder, cleaned on the way in; Not sorted is always there and cannot go', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-prio-'));
  try {
    fs.writeFileSync(path.join(dir, 'priorities.json'), JSON.stringify({ settings: { hoursPerDay: 99, handoverDays: 'working', evil: 1 },
      projects: { 'C:\\P\\A': { scores: { p: 12, d: 'x' }, flag: 'yes', deadline: '2026-02-30', stage: 'handover', categories: ['b', 'gone', 'b', 'c'], care: { checkMin: 'lots', paid: true } }, bad: 'nope' } }));
    fs.writeFileSync(path.join(dir, 'categories.json'), JSON.stringify({ categories: [{ id: 'b', name: '  Company   B ' }, { id: 'B', name: 'Dup' }, { id: 'unsorted', name: 'Mine now' }, { name: 'no id' }] }));
    const st = P.load(dir);
    assert.strictEqual(st.settings.hoursPerDay, 16);
    assert.strictEqual(st.settings.handoverDays, 'working');
    assert(!('evil' in st.settings));
    assert.deepStrictEqual(st.categories.map(c => [c.id, c.name]), [['unsorted', 'Not sorted'], ['b', 'Company B']]);
    assert.deepStrictEqual(st.entries['c:\\p\\a'], { scores: { p: 10 }, stage: 'handover', categories: ['b'], care: { paid: true } });
    assert(!('bad' in st.entries));
    assert(!P.removeCategory(st, 'unsorted').ok);
    assert(/name/.test(P.saveCategory(st, { name: '   ' }).error), 'an empty name is refused, with a way out');
    assert(/already/.test(P.saveCategory(st, { name: 'company b' }).error));
    const made = P.saveCategory(st, { name: 'My boss\'s projects', owner: 'company' });
    assert(made.ok && made.category.id === 'my-boss-s-projects');
    st.entries['c:\\p\\a'].categories = ['my-boss-s-projects', 'b'];
    assert.strictEqual(P.removeCategory(st, 'my-boss-s-projects').projects, 1);
    assert.deepStrictEqual(st.entries['c:\\p\\a'].categories, ['b']);
    P.save(dir, st);
    const again = P.load(dir);
    assert.deepStrictEqual(again.categories.map(c => c.id), ['unsorted', 'b']);
    assert.deepStrictEqual(again.entries, st.entries);
    assert(!fs.readFileSync(path.join(dir, 'categories.json'), 'utf8').includes('unsorted'), 'Not sorted is never written: it is always there');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check('answers: Fine for now starts the wait again, Needs work flags it, Park it takes it off the board', () => {
  const e = { scores: scored(40) };
  assert.strictEqual(P.waitingDays(e, at('2026-10-01'), TODAY), 15);
  assert.strictEqual(P.waitingDays(P.answer(e, 'fine', TODAY), at('2026-10-01'), TODAY), 0);
  assert.strictEqual(P.answer(e, 'needs', TODAY).flag, 'needs');
  assert.strictEqual(P.answer(e, 'park', TODAY).stage, 'parked');
  assert.throws(() => P.answer(e, 'maybe', TODAY));
});

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
