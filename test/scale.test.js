// Self-test (audit 8 Nov, R10): many projects must not start many git reads at once, a read already under way is shared,
// and a list build does not parse every project's saved audit again when the file has not changed.
// Run: node test/scale.test.js   (no packages; throwaway folders in temp; nothing of the user's is read).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-scale-'));
process.env.AHO_DATA = path.join(tmp, 'data'); process.env.AHO_ROOT = path.join(tmp, 'work');

// Count the git processes running at the same moment (the folder is named by -C in the arguments).
const real = cp.execFile; const active = new Map(); let peak = 0;
const dirOf = args => { const i = (args || []).indexOf('-C'); return i >= 0 ? args[i + 1] : ''; };
cp.execFile = function (file, args, opts, cb) {
  const d = dirOf(args);
  active.set(d, (active.get(d) || 0) + 1); peak = Math.max(peak, active.size);
  const wrapped = (...a) => { const n = (active.get(d) || 1) - 1; if (n) active.set(d, n); else active.delete(d); return cb(...a); };
  return real.call(cp, file, args, opts, wrapped);
};
const git = require('../lib/gitstate');
const store = require('../lib/audit-store');

let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };

(async () => {
  const dirs = [];
  for (let i = 0; i < 24; i++) {
    const d = path.join(tmp, 'p' + i); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'a.txt'), 'x' + i);
    real.call(cp, 'git', ['init', '-q'], { cwd: d }, () => {}); dirs.push(d);
  }
  await new Promise(r => setTimeout(r, 1500));
  await check('24 repositories read at once: no more than ' + git.MAX_READS + ' folders have git running together', async () => {
    peak = 0;
    const t = Date.now();
    const all = await Promise.all(dirs.map(d => git.gitState(d, true)));
    console.log('     (24 reads in ' + (Date.now() - t) + ' ms, peak folders at once: ' + peak + ')');
    assert(all.every(v => v && v.state), 'every folder answered');
    assert(peak <= git.MAX_READS, 'peak was ' + peak);
  });
  await check('a read under way is shared: two asks for one folder give one answer', async () => {
    const a = git.gitState(dirs[0], true), b = git.gitState(dirs[0], true);
    assert.strictEqual(a, b);
    await a;
  });
  await check('500 saved audits: the second list build reads none of them again', async () => {
    fs.mkdirSync(path.join(process.env.AHO_DATA, 'audits'), { recursive: true });
    const findings = Array.from({ length: 40 }, (_, i) => ({ rule: 'SEC-00' + (i % 9), where: 'src/f' + i + '.js', sev: 'Low', title: 't' }));
    for (let i = 0; i < 500; i++) fs.writeFileSync(path.join(process.env.AHO_DATA, 'audits', 'proj-' + i + '.json'), JSON.stringify({ ranAt: '2026-11-08', counts: { Low: 40 }, verdict: 'ok', findings }));
    let t = Date.now(); for (let i = 0; i < 500; i++) store.lastSummary('proj-' + i); const first = Date.now() - t;
    const reads = fs.readFileSync; let n = 0; fs.readFileSync = function (...a) { n++; return reads.apply(this, a); };
    t = Date.now(); for (let i = 0; i < 500; i++) store.lastSummary('proj-' + i); const second = Date.now() - t;
    fs.readFileSync = reads;
    console.log('     (500 summaries: first ' + first + ' ms, again ' + second + ' ms, file reads on the second pass: ' + n + ')');
    assert.strictEqual(n, 0);
    fs.writeFileSync(path.join(process.env.AHO_DATA, 'audits', 'proj-1.json'), JSON.stringify({ ranAt: '2026-11-09', counts: { Low: 1 }, verdict: 'ok', findings: findings.slice(0, 1) }));
    assert.strictEqual(store.lastSummary('proj-1').ranAt, '2026-11-09', 'a changed file is read again');
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
