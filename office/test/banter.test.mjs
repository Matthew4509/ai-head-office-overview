// The office chat's characters and lines (office/public/banter.js): every kind of event has lines, every placeholder is
// filled, replies come from those nearby, and the quiet one is quiet. Run: node --test office/test/banter.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const window = {};
vm.runInNewContext(fs.readFileSync(new URL('../public/banter.js', import.meta.url), 'utf8'), { window });
const B = window.officeBanter;
/** A steady "random": the same sequence every run. */
const seq = (seed) => { let x = seed; return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; };
const EVENTS = [{ kind: 'tests-passed' }, { kind: 'tests-failed' }, { kind: 'commit' }, { kind: 'push' }, { kind: 'push-friday' }, { kind: 'again', file: 'app.js', n: 3 },
  { kind: 'stopped' }, { kind: 'late' }, { kind: 'pair' }, { kind: 'bug' }, { kind: 'failed' }, { kind: 'push-weekend' }, { kind: 'tests-failed-monday' }];

test('six characters, one for good per seat, all of them used', () => {
  assert.equal(B.CHARACTERS.length, 6);
  assert.equal(B.characterOf(123456), B.characterOf(123456));
  const seen = new Set();
  for (let s = 0; s < 2000; s += 7) seen.add(B.characterOf(s * 2654435761 >>> 0).id);
  assert.equal(seen.size, 6);
});

test('every event has lines in every voice, with every placeholder filled', () => {
  for (const e of EVENTS) {
    assert.ok(B.LINES[e.kind], e.kind);
    for (const me of B.CHARACTERS) {
      const near = B.CHARACTERS.slice(0, 3).map((c) => ({ character: c, name: 'Otto' }));
      for (let r = 1; r < 40; r++) {
        for (const l of B.plan(e, { ...me, talk: 1 }, near, 'Wren', seq(r))) {
          assert.ok(!/\{(file|n|who)\}/.test(l.text), `${e.kind}/${me.id}: ${l.text}`);
          assert.ok(l.by >= -1 && l.by < near.length);
        }
      }
    }
  }
});

test('most moments get one line; replies are the exception; some get none', () => {
  const near = B.CHARACTERS.slice(0, 2).map((c) => ({ character: c, name: 'Otto' }));
  let none = 0, one = 0, more = 0;
  const rnd = seq(7);
  for (let i = 0; i < 2000; i++) {
    const n = B.plan({ kind: 'tests-passed' }, B.CHARACTERS[2], near, 'Wren', rnd).length;
    if (!n) none++; else if (n === 1) one++; else more++;
  }
  assert.ok(none > 300, `silence happens (${none})`);
  assert.ok(one > more, `one line is the usual (${one} vs ${more})`);
});

test('the quiet one says far less than the pun lover', () => {
  const count = (c) => { const rnd = seq(11); let n = 0; for (let i = 0; i < 2000; i++) if (B.plan({ kind: 'commit' }, c, [], 'Wren', rnd).length) n++; return n; };
  assert.ok(count(B.CHARACTERS.find((c) => c.id === 'quiet')) * 2 < count(B.CHARACTERS.find((c) => c.id === 'punny')));
});

test('Work only: the plain fact for each event from a thread', () => {
  for (const e of EVENTS.filter((x) => !['late', 'pair'].includes(x.kind))) assert.ok(B.fact(e), e.kind);
  assert.equal(B.fact({ kind: 'again', file: 'app.js', n: 6 }), 'Editing app.js again (6 times).');
  assert.equal(B.fact({ kind: 'late' }), null, 'office-only moments have no fact');
});

test('"It worked on my desk." always gets its answer from the nearest, when someone is near', () => {
  const bold = { ...B.CHARACTERS.find((c) => c.id === 'bold'), talk: 1 };
  const near = [{ character: B.CHARACTERS.find((c) => c.id === 'quiet'), name: 'Otto' }];
  let seen = 0;
  for (let r = 1; r < 400; r++) {
    const lines = B.plan({ kind: 'tests-failed' }, bold, near, 'Wren', seq(r));
    const i = lines.findIndex((l) => l.by === -1 && l.text === 'It worked on my desk.');
    if (i < 0) continue;
    seen++;
    assert.equal(lines[i + 1]?.by, 0);
    assert.equal(lines[i + 1]?.text, B.COMEBACKS['It worked on my desk.'][0]);
  }
  assert.ok(seen > 10, `the line comes up (${seen})`);
  for (let r = 1; r < 400; r++) for (const l of B.plan({ kind: 'tests-failed' }, bold, [], 'Wren', seq(r))) assert.equal(l.by, -1, 'nobody near, nobody answers');
});

test('day-specific moments: a Friday or weekend push always, failed tests on a Monday about half the time', () => {
  // 13-18 Oct 2026, local noon: Tuesday 13th to Sunday 18th; 12th is a Monday.
  const at = (d) => new Date(2026, 9, d, 12).toISOString();
  const always = () => 0;
  assert.equal(B.dayKind({ kind: 'push' }, at(16), always).kind, 'push-friday');
  assert.equal(B.dayKind({ kind: 'push' }, at(17), always).kind, 'push-weekend');
  assert.equal(B.dayKind({ kind: 'push' }, at(18), always).kind, 'push-weekend');
  assert.equal(B.dayKind({ kind: 'push' }, at(14), always).kind, 'push');
  assert.equal(B.dayKind({ kind: 'tests-failed' }, at(12), always).kind, 'tests-failed-monday');
  assert.equal(B.dayKind({ kind: 'tests-failed' }, at(12), () => 0.9).kind, 'tests-failed', 'Mondays still hear the usual lines');
  assert.equal(B.dayKind({ kind: 'tests-failed' }, at(13), always).kind, 'tests-failed');
  assert.equal(B.dayKind({ kind: 'commit', file: 'a.js' }, at(16), always).file, 'a.js', 'the rest of the event is kept');
  assert.ok(B.LINES['push-friday'].any.includes('Pushing on a Friday... isn\'t there a rule about this?'));
});
