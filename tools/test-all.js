// Every test, one command: node tools/test-all.js (or npm test). The engine's suites (test/*.test.js) one at a time,
// since several start a test copy on port 8881, then the office's (office/test/*.test.mjs) with node's own runner.
//   node tools/test-all.js server setup     only the suites whose names contain one of these words
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = path.resolve(__dirname, '..');
const only = process.argv.slice(2);
const pick = name => !only.length || only.some(w => name.includes(w));
const results = [];
const run = (label, args) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: HERE, encoding: 'utf8', timeout: 15 * 60 * 1000 });
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
process.exit(failed.length ? 1 : 0);
