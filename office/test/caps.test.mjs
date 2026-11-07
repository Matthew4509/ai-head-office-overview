// A long thread's lists of files stay small, and the cache is not rewritten at every scan (code review 2, R10 / L-items).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Office } from '../src/office.mjs';
import { tempHome, lines, ROOT } from './helpers.mjs';

const BASE = Date.parse('2026-10-12T00:00:00Z');
const file = (h, id) => path.join(h.transcripts, 'C--Work-projects', `${id}.jsonl`);

function setup(h, extra = {}) {
  const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts, now: () => BASE + 3000 * 60000, ...extra });
  office.settings.root = ROOT;
  return office;
}

test('a thread that writes 700 different files keeps only the newest 200 (wrote) and 500 (edits)', () => {
  const h = tempHome();
  try {
    const l = lines('big').prompt(0, 'start');
    for (let i = 0; i < 700; i++) l.tool(1 + i * 0.01, 'Write', { file_path: `${ROOT}\\harbour notes\\f${i}.md` }, 1);
    l.write(file(h, 'big'));
    const office = setup(h);
    office.scan();
    const t = Object.values(office.files)[0].t;
    assert.equal(t.wrote.length, 200);
    assert.equal(Object.keys(t.edits).length, 500);
    assert.ok(t.wrote.at(-1).endsWith('f699.md'), 'the newest is kept');
    assert.ok(!t.wrote.some((p) => p.endsWith('\\f0.md')), 'the oldest is dropped');
    assert.ok(t.edits[`${ROOT}\\harbour notes\\f699.md`] === 1 && !(`${ROOT}\\harbour notes\\f0.md` in t.edits));
  } finally {
    h.done();
  }
});

test('save: the first save is at once; a change soon after waits (it stays marked changed); save(true) writes it', () => {
  const h = tempHome();
  try {
    lines('a').prompt(0, 'start').tool(1, 'Write', { file_path: `${ROOT}\\harbour notes\\a.md` }, 5).write(file(h, 'a'));
    const office = setup(h, { saveEveryMs: 60000 });
    office.scan(); office.snapshot();
    office.save();
    const cache = path.join(h.data, 'cache.json');
    const first = fs.statSync(cache).mtimeMs;
    const before = fs.readFileSync(cache, 'utf8');
    lines('a').prompt(0, 'start').tool(1, 'Write', { file_path: `${ROOT}\\harbour notes\\a.md` }, 5).reply(2, 'Done.', 7).write(file(h, 'a'));
    office.scan(); office.snapshot();
    assert.equal(office.dirty, true);
    office.save();
    assert.equal(fs.readFileSync(cache, 'utf8'), before, 'held back inside the interval');
    assert.equal(office.dirty, true, 'still to be saved');
    office.save(true);
    assert.notEqual(fs.readFileSync(cache, 'utf8'), before, 'written when forced');
    assert.equal(office.dirty, false);
    assert.ok(fs.statSync(cache).mtimeMs >= first);
  } finally {
    h.done();
  }
});
