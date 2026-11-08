// What git says about a saved-secret file (lib/audit.js, settingsFilesAndGit): SEC-024 (Medium) when .claude/settings.local.json holds
// saved approvals and git tracks it or the project's own .gitignore does not cover it; and an AGENT-023 secret stays High unless the
// project itself keeps the file out of git. The person's global ignore list does not count (it is not shared with the repo).
// Secrets are made up and put together at run time. Run: node test/saved-secrets-git.test.js   (git on PATH; everything in a temp folder).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-saved-git-'));
process.env.AHO_DATA = path.join(TMP, 'data');
const { runAudit } = require('../lib/audit');
let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + (e && e.message)); } };
const PW = ['Zk4', 'mP9qR2xT'].join('');
const LOCAL = '.claude/settings.local.json';
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let n = 0;
function project(allow, o = {}) {
  const dir = path.join(TMP, 'p' + (++n));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)\n');
  fs.writeFileSync(path.join(dir, LOCAL), JSON.stringify({ permissions: { allow } }, null, 2) + '\n');
  if (o.ignore) fs.writeFileSync(path.join(dir, '.gitignore'), o.ignore + '\n');
  if (o.git) {
    git(dir, 'init', '-q'); git(dir, 'config', 'user.email', '12345+tester@users.noreply.github.com'); git(dir, 'config', 'user.name', 'Tester'); git(dir, 'config', 'commit.gpgsign', 'false');
    if (o.track) { git(dir, 'add', '-f', '-A'); git(dir, 'commit', '-qm', 'one'); }
  }
  return dir;
}
const of = async (dir, id) => (await runAudit(dir, null)).findings.filter(f => f.rule === id);
const SAFE = ['Bash(npm test:*)'], SECRET = ['Bash(PGPASSWORD=' + PW + ' psql -h db.acme.test)'];

(async () => {
  await check('SEC-024: saved approvals in a file git tracks: Medium, says tracked, names git rm --cached', async () => {
    const f = await of(project(SAFE, { git: true, track: true }), 'SEC-024');
    assert.strictEqual(f.length, 1); assert.strictEqual(f[0].sev, 'Medium');
    assert(/git tracks it/.test(f[0].title) && /git rm --cached/.test(f[0].fix));
  });
  await check('SEC-024: a git project whose own .gitignore does not cover it', async () => {
    const f = await of(project(SAFE, { git: true }), 'SEC-024');
    assert.strictEqual(f.length, 1); assert(/does not cover it/.test(f[0].title));
  });
  await check('SEC-024 is quiet when .gitignore covers it, with no rules, or outside a git project', async () => {
    assert.strictEqual((await of(project(SAFE, { git: true, ignore: '.claude/settings.local.json' }), 'SEC-024')).length, 0);
    assert.strictEqual((await of(project(SAFE, { git: true, ignore: '.claude/' }), 'SEC-024')).length, 0);
    assert.strictEqual((await of(project([], { git: true }), 'SEC-024')).length, 0);
    assert.strictEqual((await of(project(SAFE), 'SEC-024')).length, 0);
  });
  await check('a saved secret stays High when the project does not keep the file out of git, and the password is never shown', async () => {
    const dir = project(SECRET, { git: true });
    const a = await runAudit(dir, null);
    const f = a.findings.filter(x => x.rule === 'AGENT-023');
    assert.strictEqual(f.length, 1); assert.strictEqual(f[0].sev, 'High');
    assert(!JSON.stringify(a).includes(PW));
    assert.strictEqual(a.verdict, 'fix-first');
  });
  await check('a saved secret in a file the project itself ignores is softened to Medium, like any ignored leak', async () => {
    const f = await of(project(SECRET, { git: true, ignore: '.claude/settings.local.json' }), 'AGENT-023');
    assert.strictEqual(f.length, 1); assert.strictEqual(f[0].sev, 'Medium', f[0].sev);
  });
  await check('a file hidden only by a global ignore list is not covered: the secret stays High', async () => {
    const dir = project(SECRET, { git: true });
    const glob = path.join(TMP, 'global-ignore'); fs.writeFileSync(glob, '.claude/settings.local.json' + String.fromCharCode(10));
    git(dir, 'config', 'core.excludesFile', glob);
    assert.strictEqual(git(dir, 'check-ignore', LOCAL).trim(), LOCAL, 'git itself should treat it as ignored here');
    const f = await of(dir, 'AGENT-023');
    assert.strictEqual(f.length, 1); assert.strictEqual(f[0].sev, 'High', f[0].sev);
    assert.strictEqual((await of(dir, 'SEC-024')).length, 1, 'and SEC-024 says the project does not cover it');
  });
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10 });
  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
