// AHO-09 (1 Nov): a project's "last updated" sees an edit deep in its folders, not only the top two levels, and
// stays cheap on a big project. Made-up folders in a temp dir. Run: node test/updated.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { lastUpdated, lastUpdatedAsync } = require('../lib/projects');

let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-updated-'));
const mk = (rel, when) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); fs.utimesSync(f, when / 1000, when / 1000); };
const OLD = Date.UTC(2020, 0, 1), NEW = Date.UTC(2026, 10, 1);

(async () => {
  try {
    mk('README.md', OLD);
    mk('src/a/b/changed.js', NEW);
    mk('node_modules/pkg/newer.js', NEW + 1e9); // never walked
    mk('.git/objects/x', NEW + 1e9);
    await check('an edit three folders down counts (sync and async)', async () => {
      assert.strictEqual(lastUpdated(tmp), NEW);
      assert.strictEqual(await lastUpdatedAsync(tmp), NEW);
    });
    await check('a big project: the walk stops at its budget, nearest folders first, and still answers', async () => {
      for (let i = 0; i < 4000; i++) mk(`many/f${i}.txt`, OLD);
      const t0 = Date.now();
      const v = await lastUpdatedAsync(tmp);
      assert(v >= OLD);
      assert(Date.now() - t0 < 5000, 'took ' + (Date.now() - t0) + ' ms');
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
