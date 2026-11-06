// Tests for Run's first-run approval fingerprint (lib/runner.js runFingerprint): every part of what an npm, yarn or
// pnpm start runs counts, so a change anywhere in it asks again. Nothing is started; the project folders are made up.
// Run: node test/runner-trust.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
// A made-up data folder before lib/config is loaded (lib/runner loads lib/state): the real one is never read.
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-trust-data-'));
process.env.AHO_DATA = DATA;
const { runFingerprint, cleanPort } = require('../lib/runner');
const { state } = require('../lib/state');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-trust-'));
const p = { id: 'demo-1', name: 'demo', dir };
const entry = { key: 'dev', exe: 'npm', args: ['run', 'dev'], port: 5000, from: 'project.json' };
const pkg = scripts => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', scripts }));
const fp = () => runFingerprint(p, entry);

try {
  check('AHO-12: a change after the first 400 characters of the script asks again', () => {
    const head = 'node server.js ' + 'x'.repeat(420);
    pkg({ dev: head + ' && echo one' });
    const a = fp();
    pkg({ dev: head + ' && echo two' });
    assert.notStrictEqual(fp(), a);
  });

  check('AHO-13: a changed pre or post script asks again (npm runs them with the script)', () => {
    pkg({ dev: 'node server.js', predev: 'echo a' });
    const a = fp();
    pkg({ dev: 'node server.js', predev: 'echo b' });
    const b = fp();
    assert.notStrictEqual(b, a, 'predev');
    pkg({ dev: 'node server.js', predev: 'echo b', postdev: 'echo c' });
    assert.notStrictEqual(fp(), b, 'postdev');
  });

  check('npm start: prestart counts too', () => {
    const e = { ...entry, args: ['start'] };
    pkg({ start: 'node server.js' });
    const a = runFingerprint(p, e);
    pkg({ start: 'node server.js', prestart: 'echo hi' });
    assert.notStrictEqual(runFingerprint(p, e), a);
  });

  check('an unchanged command keeps its fingerprint (no asking for nothing)', () => {
    pkg({ dev: 'vite --port 5000' });
    assert.strictEqual(fp(), fp());
  });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

// F10: two projects moved to a clean port at the same moment never get the same one.
(async () => {
  const a = { starting: true, port: 47310 }, b = { starting: true, port: 47310 };
  state.running.set('a', a); state.running.set('b', b);
  const was = state.projects; state.projects = [];
  try {
    const [pa, pb] = await Promise.all([cleanPort(47310, a), cleanPort(47310, b)]);
    if (pa && pb && pa !== pb && a.port === pa && b.port === pb) console.log('ok   F10: two moves at once get two ports (' + pa + ', ' + pb + ')');
    else { failures++; console.log('FAIL F10: two moves at once: ' + pa + ', ' + pb); }
  } finally { state.running.delete('a'); state.running.delete('b'); state.projects = was; fs.rmSync(DATA, { recursive: true, force: true }); }
  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
