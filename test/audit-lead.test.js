// Audit tests from the heavy walk (report only). P1 items are marked todo so the suite stays green.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeMatcher } = require('../lib/disclosure');

// A project whose folder name is made only of ordinary words is matched only when written as a path, so the same
// name written in prose (a comment, a message) passes the privacy check and the bake.
test('H-01: another project named in prose is found even when every word of its name is an ordinary word', { todo: 'P1' }, () => {
  const scan = makeMatcher({ details: [], others: ['new project bridge'], own: ['this office'] });
  assert.ok(scan('// The New Project Bridge demo uses the same ports.\n').length > 0, 'the name in prose was not found');
});
test('H-01b: the same name written as a path is found (control)', () => {
  const scan = makeMatcher({ details: [], others: ['new project bridge'], own: ['this office'] });
  assert.ok(scan('see ../new project bridge/notes\n').length > 0);
});

// categories.json held by another program while the planner is read, then let go before the save: the planner read
// then must not be written back over the real files (stand-in names, or no categories at all).
test('R-01b: a planner read while categories.json or priorities.json was held is never saved over the real files', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const S = require('../lib/settings');
  const P = require('../lib/priorities');
  for (const heldName of ['categories.json', 'priorities.json']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-r01b-'));
    const cats = JSON.stringify({ categories: [{ id: 'clients', name: 'Client work', owner: 'mine', rescan: true, order: 1 }] });
    const pri = JSON.stringify({ settings: {}, projects: { 'alpha-site': { categories: ['clients'] } } });
    fs.writeFileSync(path.join(dir, 'categories.json'), cats);
    fs.writeFileSync(path.join(dir, 'priorities.json'), pri);
    const real = S.readText;
    S.readText = f => { if (path.basename(f) === heldName) throw Object.assign(new Error('held'), { code: 'EBUSY' }); return real(f); };
    let st;
    try { st = P.load(dir); } finally { S.readText = real; }
    assert.throws(() => P.save(dir, st), /holding/, heldName + ': the save went ahead');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'categories.json'), 'utf8'), cats, heldName + ': categories.json changed');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'priorities.json'), 'utf8'), pri, heldName + ': priorities.json changed');
    assert.ok(!fs.readdirSync(dir).some(n => n.includes('damaged')), heldName + ': a file that was only held was copied aside as damaged');
    assert.ok(!Object.keys(st).includes('held'), 'the held mark would reach the page');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A transcript line whose reply counts a huge or negative number of words written makes the staff purse infinite
// (anything can be bought, and the ledger saves null) or lowers it.
test('H-03: a reply count that is huge or below zero is not added to what the staff earned', { todo: 'P2' }, async () => {
  const { emptyThread, addLine } = await import('../office/src/transcript.mjs');
  const line = (id, out) => ({ type: 'assistant', sessionId: 's', timestamp: '2026-03-02T10:00:00.000Z', message: { id, role: 'assistant', model: 'm', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 1, output_tokens: out } } });
  const t = emptyThread('s');
  addLine(t, line('a', 1e400));
  addLine(t, line('b', -5));
  assert.ok(Number.isFinite(t.out) && t.out >= 0, 'out became ' + t.out);
});

// Turning advanced setup on rewrites the AI app's whole settings file through JSON numbers: a whole number longer than
// 15 digits elsewhere in that file comes back with other digits (a copy of the file is kept first).
test('H-04: advanced setup keeps every other value in the AI app settings exactly as it was', { todo: 'P2' }, async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-h04-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{\n  "big": 12345678901234567890\n}\n');
  const before = process.env.AHO_SETTINGS;
  process.env.AHO_SETTINGS = file;
  try {
    const setup = await import('../office/src/setup.mjs');
    const office = { settings: {}, root: () => dir, lastHookAt: 0 };
    const r = setup.apply(office, { advanced: true }, { port: 8899, hookScript: path.join(__dirname, '..', 'office', 'hook.mjs') });
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(fs.readFileSync(file, 'utf8'), /12345678901234567890/);
  } finally {
    if (before === undefined) delete process.env.AHO_SETTINGS; else process.env.AHO_SETTINGS = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
