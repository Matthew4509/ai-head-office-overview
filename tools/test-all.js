// Every test, one command: node tools/test-all.js (or npm test). The engine's suites (test/*.test.js) one at a time,
// since several start a test copy on port 8881, then the office's (office/test/*.test.mjs) with node's own runner.
//   node tools/test-all.js server setup     only the suites whose names contain one of these words
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = path.resolve(__dirname, '..');
const only = process.argv.slice(2);
const pick = name => !only.length || only.some(w => name.includes(w));
const results = [];
// Every suite gets throwaway data, AI-app settings and app records, so none can read or write this PC's real ones, even
// by loading a lib module whose default data folder is the real data/ (a suite that sets its own still wins).
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-tests-'));
process.on('exit', () => { try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch {} });
const ENV = { ...process.env, AHO_DATA: path.join(SCRATCH, 'data'), AHO_SETTINGS: path.join(SCRATCH, 'no-ai-settings.json'), AHO_APP_SESSIONS: path.join(SCRATCH, 'no-app-sessions') };
const run = (label, args) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: HERE, env: ENV, encoding: 'utf8', timeout: 15 * 60 * 1000 });
  const secs = Math.round((Date.now() - t0) / 1000);
  const ok = r.status === 0;
  results.push({ label, ok, secs });
  const tail = ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/);
  console.log((ok ? 'ok    ' : 'FAIL  ') + label + ' (' + secs + ' s)');
  if (!ok) console.log('      ' + tail.filter(l => !/^ok\b/.test(l)).slice(-25).join('\n      '));
};

for (const f of fs.readdirSync(path.join(HERE, 'test')).filter(f => f.endsWith('.test.js')).sort()) {
  if (pick(f)) run('test/' + f, [path.join('test', f)]);
}
const officeTests = fs.readdirSync(path.join(HERE, 'office', 'test')).filter(f => f.endsWith('.test.mjs')).sort();
if (pick('office')) run('office/test (' + officeTests.length + ' files)', ['--test', ...officeTests.map(f => path.join('office', 'test', f))]);

const failed = results.filter(r => !r.ok);
console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' suites passed' + (failed.length ? '; failed: ' + failed.map(r => r.label).join(', ') : '') + '.');
// A full, clean pass leaves a stamp for this exact tree; tools/bake.js refuses a tree without one, so a release is only
// ever made from what the whole suite passed on. A filtered run or a changed working tree leaves none (and removes any old one).
const STAMP = path.join(HERE, '_releases', 'test-stamp.json');
try { fs.rmSync(STAMP, { force: true }); } catch {}
if (!failed.length && !only.length) {
  try {
    const git = a => spawnSync('git', a, { cwd: HERE, encoding: 'utf8' }).stdout.trim();
    if (git(['status', '--porcelain', '--untracked-files=no'])) console.log('No test stamp: files changed since the commit, so a pass says nothing about the commit.');
    else {
      fs.mkdirSync(path.dirname(STAMP), { recursive: true });
      fs.writeFileSync(STAMP, JSON.stringify({ tree: git(['rev-parse', 'HEAD^{tree}']), commit: git(['rev-parse', 'HEAD']), at: new Date().toISOString(), suites: results.length }) + '\n');
      console.log('Test stamp written for this commit.');
    }
  } catch {}
}
process.exit(failed.length ? 1 : 0);
