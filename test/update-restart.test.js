// Self-test (audit 8 Nov, R7): when an update was taken but the restart is refused (a backup is running), the answer says
// the new version is in place and the office must be restarted by hand, instead of the page claiming it restarted.
// Run: node test/update-restart.test.js   (no packages; update.take is a stand-in, nothing is fetched).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-restart-'));
process.env.AHO_DATA = path.join(tmp, 'data'); process.env.AHO_ROOT = path.join(tmp, 'work');
const { state } = require('../lib/state');
const update = require('../lib/update');
const system = require('../lib/routes/system');

let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };

(async () => {
  update.take = async v => ({ ok: true, from: 'aaaa', to: 'bbbb', version: v, linked: false });
  await check('no backup: Update now says nothing is blocked', async () => {
    state.backups = { status: () => null };
    const r = await system.post['/api/update/take']({ body: { version: '0.1.99' } });
    assert(r.ok && r.restart && r.restart.blocked === false, JSON.stringify(r));
  });
  await check('backup running: the answer says the new version is in place and how to restart by hand', async () => {
    state.backups = { status: () => ({ finished: null, items: [] }) };
    const r = await system.post['/api/update/take']({ body: { version: '0.1.99' } });
    assert(r.ok && r.restart.blocked && /in place/.test(r.restart.text) && /still running the old one/.test(r.restart.text) && /start\.cmd/.test(r.restart.text), JSON.stringify(r));
    const q = await system.post['/api/update/restart']({ body: {} });
    assert(q.ok === false && /A backup is running/.test(q.fault) && /new version is already in place/.test(q.wayOut), JSON.stringify(q));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
