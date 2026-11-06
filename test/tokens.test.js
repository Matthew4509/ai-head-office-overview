// Tests for lib/tokens.js: transcripts are read in 1 MB pieces, so lines longer than a piece and characters split
// between two pieces must come through whole. Run: node test/tokens.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { eachLine } = require('../lib/tokens');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-tokens-'));
const lines = f => { const out = []; eachLine(f, l => out.push(l)); return out; };

check('every line comes back, the last one without a newline too', () => {
  const f = path.join(tmp, 'a.jsonl');
  fs.writeFileSync(f, 'one\ntwo\n\nthree');
  assert.deepStrictEqual(lines(f), ['one', 'two', 'three']);
});
check('a line longer than the 1 MB piece comes back whole', () => {
  const f = path.join(tmp, 'b.jsonl');
  const big = 'x'.repeat(3 * 1024 * 1024 + 17);
  fs.writeFileSync(f, 'first\n' + big + '\nlast\n');
  const got = lines(f);
  assert.strictEqual(got.length, 3);
  assert.strictEqual(got[1].length, big.length);
  assert.strictEqual(got[2], 'last');
});
check('a line over 16 MB with no newline is passed over, and the lines after it still come back', () => {
  const f = path.join(tmp, 'huge.jsonl');
  const fd = fs.openSync(f, 'w');
  fs.writeSync(fd, 'before\n');
  const mb = Buffer.alloc(1 << 20, 0x61);
  for (let i = 0; i < 20; i++) fs.writeSync(fd, mb);
  fs.writeSync(fd, '\nafter\n');
  fs.closeSync(fd);
  const t0 = Date.now();
  assert.deepStrictEqual(lines(f), ['before', 'after']);
  assert(Date.now() - t0 < 5000, (Date.now() - t0) + ' ms');
});
check('a character split between two pieces is not broken', () => {
  const f = path.join(tmp, 'c.jsonl');
  // "é" is 2 bytes and "€" 3: start them one byte before the 1 MB mark so they straddle it.
  const pad = 'a'.repeat(1024 * 1024 - 1);
  fs.writeFileSync(f, pad + 'é€ok\nnext\n');
  const got = lines(f);
  assert.strictEqual(got[0].slice(-4), 'é€ok');
  assert.strictEqual(got[1], 'next');
});
check('a missing file is no lines, not an error', () => assert.deepStrictEqual(lines(path.join(tmp, 'none.jsonl')), []));

// AHO-10 (1 Nov): a Codex session's running total, across a month end: each month gets only what was used in it.
check('a Codex session that crosses into a new month counts there only what was used there', () => {
  const { scanCodex, makeMatcher } = require('../lib/tokens');
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const f = path.join(tmp, 'codex.jsonl');
  const ev = (ts, total) => JSON.stringify({ timestamp: ts, payload: { type: 'token_count', info: { total_token_usage: { total_tokens: total } } } });
  // midday UTC, so the month is the same in every time zone
  fs.writeFileSync(f, [JSON.stringify({ timestamp: '2026-10-15T12:00:00Z', payload: { cwd: proj } }), ev('2026-10-15T12:00:00Z', 100), ev('2026-10-16T12:00:00Z', 100), ev('2026-11-15T12:00:00Z', 150)].join('\n') + '\n');
  const per = scanCodex(f, makeMatcher([{ id: 'p', dir: proj }]));
  assert.strictEqual(per.p, 150, 'the session total');
  const m = per.__months__ || {};
  assert.deepStrictEqual(Object.entries(m).filter(([k]) => k.startsWith('p|')).map(([k, v]) => [k.split('|')[1], v]).sort(), [['2026-10', 100], ['2026-11', 50]]);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
