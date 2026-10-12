import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Office } from '../src/office.mjs';
import { tempHome, lines, ROOT } from './helpers.mjs';

const tokens = createRequire(import.meta.url)('../../lib/tokens.js');
const file = (h, id) => path.join(h.transcripts, 'C--Work-projects', `${id}.jsonl`);
const A = `${ROOT}\\harbour notes`, B = `${ROOT}\\Larkspur`;
const rules = (office, projects, sig) => ({ sig, match: tokens.makeMatcher(projects), hint: (f) => tokens.hintFromDirName(path.relative(office.transcriptsDir, f).split(path.sep)[0], projects) });
// A reply line with every kind of token, so the count is input + cache write + cache read + output.
const reply = (id, ts, cwd, out = 10) => ({ type: 'assistant', timestamp: ts, cwd, message: { id, stop_reason: 'end_turn', usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: out }, content: [{ type: 'text', text: 'ok' }] } });

test('one read gives the staff and the tokens per project; a reply over several lines counts once', () => {
  const h = tempHome();
  try {
    lines('t')
      .raw(reply('m1', '2026-10-12T01:00:00Z', A, 4)).raw(reply('m1', '2026-10-12T01:00:01Z', A, 4)) // one reply, two lines
      .tool(2, 'Write', { file_path: `${B}\\a.md` }, 0) // a tool call naming Larkspur moves the count there
      .raw(reply('m9', '2026-10-12T01:05:00Z', ROOT, 10))
      .write(file(h, 't'));
    const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts });
    const projects = [{ id: 'a', dir: A }, { id: 'b', dir: B }];
    office.setTokens(rules(office, projects, 'one'));
    office.scan();
    const t = office.tokenTotals();
    assert.equal(t.total.a, 1 + 2 + 3 + 4);
    // The tool call's own reply has no input counts in the helper; Larkspur gets it (0 out) and m9 (16).
    assert.equal(t.total.b, 16);
    assert.ok(office.snapshot().people.length >= 1, 'the same read gave the staff');
  } finally { h.done(); }
});

test('a rewound thread writes earlier replies again far down the file: they count once', () => {
  const h = tempHome();
  try {
    const l = lines('r').raw(reply('m1', '2026-10-12T01:00:00Z', A, 4));
    for (let i = 0; i < 20; i++) l.raw(reply(`x${i}`, '2026-10-12T01:01:00Z', A, 0));
    l.raw(reply('m1', '2026-10-12T02:00:00Z', A, 4)).write(file(h, 'r'));
    const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts });
    office.setTokens(rules(office, [{ id: 'a', dir: A }], 'one'));
    office.scan();
    assert.equal(office.tokenTotals().total.a, 10 + 20 * 6);
  } finally { h.done(); }
});

test('a new project list counts the tokens again from the start; new lines are counted once as the file grows', () => {
  const h = tempHome();
  try {
    const l = lines('g').raw(reply('m1', '2026-10-12T01:00:00Z', B, 4));
    l.write(file(h, 'g'));
    const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts });
    office.setTokens(rules(office, [{ id: 'a', dir: A }], 'one'));
    office.scan();
    assert.deepEqual(office.tokenTotals().total, {}, 'Larkspur is not on the first list');
    office.setTokens(rules(office, [{ id: 'a', dir: A }, { id: 'b', dir: B }], 'two'));
    office.scan();
    assert.equal(office.tokenTotals().total.b, 10);
    fs.appendFileSync(file(h, 'g'), JSON.stringify(reply('m2', '2026-10-12T01:10:00Z', B, 4)) + '\n');
    office.scan();
    office.scan();
    assert.equal(office.tokenTotals().total.b, 20);
  } finally { h.done(); }
});

test('this month: only replies written this month (UTC) count', () => {
  const h = tempHome();
  try {
    lines('m').raw(reply('old', '2026-09-30T23:00:00Z', A, 4)).raw(reply('new', '2026-10-01T00:30:00Z', A, 4)).write(file(h, 'm'));
    const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts, now: () => Date.parse('2026-10-12T00:00:00Z') });
    office.setTokens(rules(office, [{ id: 'a', dir: A }], 'one'));
    office.scan();
    const t = office.tokenTotals();
    assert.equal(t.total.a, 20);
    assert.equal(t.month.a, 10);
  } finally { h.done(); }
});
