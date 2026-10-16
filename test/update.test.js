// Tests for lib/update.js (Settings › Update) against little repositories in a temp folder: a "GitHub" bare
// repository, a clone of it as the office's folder, and a second clone that adds the newer version.
// Run: node test/update.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const update = require('../lib/update');

let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-update-'));
const git = (dir, ...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'init.defaultBranch=main', ...a], { stdio: 'pipe' }).toString().trim();
const save = (d, file, text) => { fs.writeFileSync(path.join(d, file), text); git(d, 'add', file); git(d, 'commit', '-q', '-m', 'save ' + file); };

const hub = path.join(tmp, 'hub.git');
execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', '--bare', hub]);
const maker = path.join(tmp, 'maker');
fs.mkdirSync(maker);
git(maker, 'init', '-q');
fs.mkdirSync(path.join(maker, 'lib'));
save(maker, 'lib/config.js', "const VERSION = '0.1.0';\n");
git(maker, 'remote', 'add', 'origin', hub);
git(maker, 'push', '-q', 'origin', 'main');
const office = path.join(tmp, 'office');
execFileSync('git', ['clone', '-q', hub, office], { stdio: 'pipe' });

(async () => {
  await check('a folder without git cannot update, and says why', async () => {
    const d = path.join(tmp, 'zip'); fs.mkdirSync(d);
    const r = await update.check(d);
    assert(!r.ok && /cannot update itself/.test(r.fault) && r.wayOut, JSON.stringify(r));
  });
  await check('freshly cloned: the newest version, nothing to take', async () => {
    const r = await update.check(office);
    assert(r.ok && r.behind === 0 && r.ahead === 0 && r.branch === 'main', JSON.stringify(r));
    const p = await update.pull(office);
    assert(!p.ok && /nothing to take/.test(p.fault), JSON.stringify(p));
  });
  save(maker, 'lib/config.js', "const VERSION = '0.1.1';\n");
  save(maker, 'b.txt', 'new file');
  git(maker, 'push', '-q', 'origin', 'main');
  await check('two newer changes on GitHub: counted, listed, with the new version', async () => {
    const r = await update.check(office);
    assert(r.ok && r.behind === 2 && r.commits.length === 2 && r.newVersion === '0.1.1' && r.commits[0].text === 'save b.txt', JSON.stringify(r));
  });
  await check('a changed file here: the update is refused and the file is untouched', async () => {
    fs.writeFileSync(path.join(office, 'lib', 'config.js'), "const VERSION = 'mine';\n");
    const p = await update.pull(office);
    assert(!p.ok && /changed here/.test(p.fault) && /lib\/config\.js/.test(p.reason), JSON.stringify(p));
    assert.strictEqual(fs.readFileSync(path.join(office, 'lib', 'config.js'), 'utf8'), "const VERSION = 'mine';\n");
    git(office, 'checkout', '--', 'lib/config.js');
  });
  await check('a file git does not track (like the data folder) does not stop it, and is kept', async () => {
    fs.mkdirSync(path.join(office, 'data'));
    fs.writeFileSync(path.join(office, 'data', 'settings.json'), '{"mine":true}');
    const p = await update.pull(office);
    assert(p.ok && p.took === 2 && p.newVersion === '0.1.1', JSON.stringify(p));
    // git may write the file with Windows line endings
    assert.strictEqual(fs.readFileSync(path.join(office, 'lib', 'config.js'), 'utf8').replace(/\r\n/g, '\n'), "const VERSION = '0.1.1';\n");
    assert.strictEqual(fs.readFileSync(path.join(office, 'data', 'settings.json'), 'utf8'), '{"mine":true}');
  });
  await check('a change saved only here: refused (it cannot simply move forward)', async () => {
    save(office, 'c.txt', 'local');
    save(maker, 'd.txt', 'remote');
    git(maker, 'push', '-q', 'origin', 'main');
    const r = await update.check(office);
    assert(r.ok && r.behind === 1 && r.ahead === 1, JSON.stringify(r));
    const p = await update.pull(office);
    assert(!p.ok && /own saved changes/.test(p.fault), JSON.stringify(p));
  });
  await check('a hook in the folder is not run by the update', async () => {
    const d = path.join(tmp, 'hooked');
    execFileSync('git', ['clone', '-q', hub, d], { stdio: 'pipe' });
    git(d, 'reset', '-q', '--hard', 'HEAD~1');
    const ran = path.join(tmp, 'hook-ran.txt');
    fs.writeFileSync(path.join(d, '.git', 'hooks', 'post-merge'), `#!/bin/sh\necho ran > "${ran.replace(/\\/g, '/')}"\n`, { mode: 0o755 });
    const p = await update.pull(d);
    assert(p.ok && !fs.existsSync(ran), JSON.stringify(p));
  });
  await check('a git setting that names a program: git is not run at all', async () => {
    const d = path.join(tmp, 'risky');
    execFileSync('git', ['clone', '-q', hub, d], { stdio: 'pipe' });
    git(d, 'config', 'core.pager', 'evil.exe');
    const r = await update.check(d);
    assert(!r.ok && /did not run git/.test(r.fault), JSON.stringify(r));
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* left in temp */ }
  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
