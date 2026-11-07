// The office's own files and the transcripts it reads, when they are valid JSON of the wrong shape or hold fields of the wrong
// type: the office opens, answers its state, and keeps what it set aside. Run: node --test office/test/shape.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Office } from '../src/office.mjs';
import { readJson } from '../src/files.mjs';
import { tempHome, lines, ROOT } from './helpers.mjs';

const NOW = Date.parse('2026-10-12T01:00:00Z');
const open = (h, files = {}) => {
  fs.mkdirSync(h.data, { recursive: true });
  for (const [name, v] of Object.entries(files)) fs.writeFileSync(`${h.data}/${name}`, typeof v === 'string' ? v : JSON.stringify(v));
  return new Office({ dataDir: h.data, transcriptsDir: h.transcripts, now: () => NOW, workingFolders: () => [ROOT] });
};
const asides = (h, base) => fs.readdirSync(h.data).filter((n) => n.startsWith(`${base}.damaged-`));

for (const [name, files] of Object.entries({
  'ledger {} (no threads)': { 'ledger.json': {} },
  'ledger with a null thread': { 'ledger.json': { threads: { a: null, b: 5, c: { lastAt: {} } } } },
  'seats with text for a folder': { 'seats.json': { alpha: 'str', beta: { 1: 5, 2: null } } },
  'done with odd values': { 'done.json': { a: 5, b: null, c: { x: 1 } } },
  'settings with a number for the folder': { 'settings.json': { openedAt: 5, quietMinutes: 'abc', root: 5, theme: {}, favProjects: 5 } },
  'settings with a list for the folder': { 'settings.json': { openedAt: '2026-10-01T00:00:00Z', quietMinutes: 60, root: ['x'], favProjects: [null, {}] } },
})) {
  test(`${name}: the office opens and answers`, () => {
    const h = tempHome();
    try {
      const o = open(h, files);
      const s = o.snapshot();
      assert.ok(Array.isArray(s.people) || s.people === undefined || typeof s === 'object');
      assert.equal(o.setNickname('alpha', 1, 'Bo'), true);
      assert.equal(o.markDone('nobody'), false);
      assert.ok(Number.isFinite(o.settings.quietMinutes));
      assert.equal(typeof o.root(), 'string');
    } finally { h.done(); }
  });
}

test('what had to be dropped is copied aside first, and a good file is not', () => {
  const h = tempHome();
  try {
    open(h, { 'ledger.json': { threads: { a: null } }, 'seats.json': { alpha: { 1: { nick: 'Bo' } } } });
    assert.equal(asides(h, 'ledger').length, 1);
    assert.equal(asides(h, 'seats').length, 0, 'nothing was dropped from seats.json');
  } finally { h.done(); }
});

test('a transcript line with a cwd that is not text does not stop the office', () => {
  const h = tempHome();
  try {
    lines('sess1').prompt(0, 'hello', 5).raw({ type: 'user', timestamp: '2026-10-12T00:01:00Z', cwd: { a: 1 }, message: { content: 'x' } })
      .raw({ type: 'assistant', timestamp: '2026-10-12T00:02:00Z', cwd: ['x'], message: { id: 'm', content: [{ type: 'tool_use', name: 'Write', input: { file_path: {} } }, { type: 'tool_use', name: 'Bash', input: { command: 5 } }] } })
      .write(`${h.transcripts}/C--Work-projects/sess1.jsonl`);
    const o = open(h);
    o.scan();
    assert.doesNotThrow(() => o.snapshot());
    assert.equal(typeof o.root(), 'string', 'the projects folder is text (the server asks path.resolve about it)');
  } finally { h.done(); }
});

test('a thread called like an Object.prototype member is no crash', () => {
  const h = tempHome();
  try {
    for (const id of ['constructor', 'toString', '__proto__', 'sess2']) lines(id).prompt(0, 'hi').write(`${h.transcripts}/C--Work-projects/${id}.jsonl`);
    const o = open(h);
    o.scan();
    const s = o.snapshot();
    assert.ok(s);
    assert.equal(Object.keys(o.files).length, 2, 'constructor and __proto__ are left out; toString is an ordinary id once the maps have no prototype');
  } finally { h.done(); }
});

test('a nickname for a folder called toString is kept like any other', () => {
  const h = tempHome();
  try {
    const o = open(h);
    o.setNickname('toString', 1, 'Tess');
    assert.deepEqual(JSON.parse(fs.readFileSync(`${h.data}/seats.json`, 'utf8')).toString, { 1: { nick: 'Tess' } });
  } finally { h.done(); }
});

test('readJson with a cleaner: wrong shapes are cut to what the caller reads', () => {
  const h = tempHome();
  try {
    fs.mkdirSync(h.data, { recursive: true });
    const f = `${h.data}/x.json`;
    fs.writeFileSync(f, JSON.stringify({ a: 1, b: 'x' }));
    assert.deepEqual(readJson(f, {}, (v) => ({ a: v.a })), { a: 1 });
    assert.equal(asides(h, 'x').length, 1);
  } finally { h.done(); }
});
