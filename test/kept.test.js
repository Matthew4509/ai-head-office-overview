// AHO-17 (1 Nov): a data file that cannot be read, and whose safe copy cannot be made, is never written over (the
// settings, the prompts, the To Do). The copy is made to fail here (no disk is filled). Run: node test/kept.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Settings = require('../lib/settings');
const Prompts = require('../lib/prompts');
const Todo = require('../lib/todo');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-kept-'));
const real = fs.copyFileSync;
const fail = () => { fs.copyFileSync = (a, b, ...r) => { if (String(b).includes('.damaged-')) { const e = new Error('denied'); e.code = 'EPERM'; throw e; } return real(a, b, ...r); }; };
const heal = () => { fs.copyFileSync = real; };
const BAD = '{"workingFolders": [ cut short';

try {
  check('settings: read as defaults, not written over, a save refused plainly; once the copy works, saved', () => {
    const f = path.join(tmp, 'settings.json');
    fs.writeFileSync(f, BAD);
    fail();
    const s = Settings.load(f, null);
    assert.deepStrictEqual(s.workingFolders, []);
    assert.strictEqual(fs.readFileSync(f, 'utf8'), BAD, 'not written over at load');
    assert.throws(() => Settings.saveJson(f, s), e => e.code === 'EKEPT' && /not written over/.test(e.message));
    assert.strictEqual(fs.readFileSync(f, 'utf8'), BAD, 'nor at a save');
    assert(!fs.readdirSync(tmp).some(n => /\.tmp$/.test(n)), 'no temp file left');
    heal();
    Settings.saveJson(f, s);
    assert(fs.readdirSync(tmp).some(n => /^settings\.damaged-.*\.json$/.test(n)), 'copied aside first');
  });

  check('prompts: the starters show, the file is not written over', () => {
    const f = path.join(tmp, 'prompts.json');
    fs.writeFileSync(f, BAD);
    fail();
    const st = Prompts.load(f);
    assert(st.prompts.length > 0, 'the starters show');
    assert.strictEqual(fs.readFileSync(f, 'utf8'), BAD);
    heal();
  });

  check('To Do: shown empty, a change refused, the file as it was', () => {
    const d = path.join(tmp, 'todo');
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'todo.json'), BAD);
    fail();
    const st = Todo.create({ dataDir: d, today: () => '2026-11-02' });
    assert.strictEqual(st.view({}).open, 0);
    assert.throws(() => st.add({ project: 'alpha-1a2b3c', size: 60, zone: 'today' }), /not written over/);
    assert.strictEqual(fs.readFileSync(path.join(d, 'todo.json'), 'utf8'), BAD);
    heal();
  });
} finally {
  heal();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? failures + ' FAILED' : 'all passed');
process.exit(failures ? 1 : 0);
