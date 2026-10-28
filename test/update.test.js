// Signed updates (Settings › Update): the signature parts (lib/release.js), signing in the bake (tools/sign-release.js)
// and the update itself (lib/update.js) against little repositories in a temp folder: a bare repository stands in for
// the office's fixed GitHub address (AHO_RELEASE_GIT, which only tests set), a working repository makes the releases,
// and a clone of it is the office that updates. A copy of this office stands in for the old and new versions, so the
// test start really starts one. Everything uses a throwaway key; nothing outside the temp folder is started or changed.
// Run: node test/update.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { execFileSync } = require('child_process');

const HERE = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-update-'));
process.env.AHO_DATA = path.join(TMP, 'proc-data');
delete process.env.AHO_RELEASE_GIT;
const release = require('../lib/release');
const update = require('../lib/update');
const signing = require('../tools/sign-release');

let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pair = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
};
const KEY = pair(), OTHER = pair();
const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ident = d => { g(d, 'config', 'user.name', 'Test'); g(d, 'config', 'user.email', 'test@example.invalid'); g(d, 'config', 'core.autocrlf', 'false'); };

// A copy of this office (what it needs to start) with its own version.
function copyOffice(to, version) {
  const copy = rel => {
    const from = path.join(HERE, rel), dest = path.join(to, rel);
    if (fs.statSync(from).isDirectory()) { for (const n of fs.readdirSync(from)) if (n !== 'test') copy(path.join(rel, n)); return; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(from, dest);
  };
  for (const rel of ['server.js', 'index.html', 'package.json', 'README.md', 'LICENSE', 'lib', 'office']) copy(rel);
  const cfgFile = path.join(to, 'lib', 'config.js');
  fs.writeFileSync(cfgFile, fs.readFileSync(cfgFile, 'utf8').replace(/const VERSION = '[^']+';/, "const VERSION = '" + version + "';"));
  return to;
}
const setVersion = (dir, v) => { const f = path.join(dir, 'lib', 'config.js'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/const VERSION = '[^']+';/, "const VERSION = '" + v + "';")); };
// The signed annotated tag v<version> on the commit `work` is on, as the bake's tag message makes it.
function signedTag(work, version, pem = KEY.pem, force = false) {
  const msg = path.join(TMP, 'tag-' + version + '.txt');
  fs.writeFileSync(msg, release.tagMessage(release.signTag(pem, version, g(work, 'rev-parse', 'HEAD'), g(work, 'rev-parse', 'HEAD^{tree}'))));
  g(work, 'tag', ...(force ? ['-f'] : []), '-a', 'v' + version, '-F', msg);
  return msg;
}

(async () => {
  // ---------- lib/release.js ----------
  await check('a git release: the signed commit and tree, read back out of the tag message; any change fails', () => {
    const c = '1'.repeat(40), t = '2'.repeat(40);
    const s = release.signTag(KEY.pem, '0.1.99', c, t);
    const msg = release.tagMessage(s);
    assert.match(msg, /^AI Head Office Overview 0\.1\.99\n\naho-release \{/);
    const back = release.tagSigOf('object ' + c + '\ntype commit\ntag v0.1.99\ntagger x\n\n' + msg);
    assert.equal(release.tagCheck(back, '0.1.99', c, t, KEY.pub).code, '');
    assert.equal(release.tagCheck(back, '0.1.99', '3'.repeat(40), t, KEY.pub).code, 'changed');
    assert.equal(release.tagCheck(back, '0.1.99', c, '3'.repeat(40), KEY.pub).code, 'changed');
    assert.equal(release.tagCheck(back, '0.2.0', c, t, KEY.pub).code, 'version');
    assert.equal(release.tagCheck({ ...back, commit: '3'.repeat(40) }, '0.1.99', '3'.repeat(40), t, KEY.pub).code, 'bad');
    assert.equal(release.tagCheck(release.tagSigOf('no mark here'), '0.1.99', c, t, KEY.pub).code, 'none');
    assert.equal(release.tagCheck({ version: '0.1.99' }, '0.1.99', c, t, KEY.pub).code, 'format');
    assert.equal(release.tagCheck(back, '0.1.99', c, t, '').code, 'nokey');
    // A whole signature from another key: told apart as a new key; another key's signature naming OUR key is just bad.
    assert.equal(release.tagCheck(release.signTag(OTHER.pem, '0.1.99', c, t), '0.1.99', c, t, KEY.pub).code, 'newkey');
    assert.equal(release.tagCheck({ ...release.signTag(OTHER.pem, '0.1.99', c, t), key: KEY.pub }, '0.1.99', c, t, KEY.pub).code, 'bad');
  });
  await check('a zip signature: its version and SHA-256; versions compare part by part; the address is fixed', () => {
    const SHA = 'ab'.repeat(32);
    const sig = release.signRelease(KEY.pem, '0.1.99', SHA);
    assert.equal(release.zipCheck(sig, '0.1.99', SHA, KEY.pub).code, '');
    assert.equal(release.zipCheck(sig, '0.1.99', 'cd'.repeat(32), KEY.pub).code, 'changed');
    assert.equal(release.zipCheck({ ...sig, signature: 'not base64 at all!' }, '0.1.99', SHA, KEY.pub).code, 'bad');
    assert.equal(release.signedText('0.1.99', SHA.toUpperCase()), 'AI Head Office Overview release 0.1.99\nsha256 ' + SHA + '\n');
    assert.ok(release.newer('0.1.10', '0.1.9') && !release.newer('0.1.9', '0.1.10') && !release.newer('0.1.9', '0.1.9') && !release.newer('x', '0.1.0'));
    assert.equal(release.GIT_URL, 'https://github.com/Matthew4509/ai-head-office-overview.git');
    // The key the office carries is empty (before the first bake) or a whole Ed25519 public key.
    assert.ok(release.RELEASE_KEY === '' || Buffer.from(release.RELEASE_KEY, 'base64').length === 44, 'RELEASE_KEY is not a public key');
    assert.ok(!/PRIVATE/.test(fs.readFileSync(path.join(HERE, 'lib', 'release.js'), 'utf8')));
  });

  // ---------- signing in the bake ----------
  await check('the bake makes the key once, writes its public half, signs, and refuses a lost or wrong key', () => {
    const d = fs.mkdtempSync(path.join(TMP, 'sign-'));
    const keyFile = path.join(d, 'private', 'release-key.pem'), rel = path.join(d, 'release.js');
    fs.writeFileSync(rel, fs.readFileSync(path.join(HERE, 'lib', 'release.js'), 'utf8').replace(/const RELEASE_KEY = '[^']*';/, "const RELEASE_KEY = '';"));
    const a = signing.ensureKey({ file: keyFile, releaseJs: rel });
    assert.ok(a.made && /Made the release key/.test(a.said) && fs.existsSync(keyFile));
    const pub = /const RELEASE_KEY = '([^']+)';/.exec(fs.readFileSync(rel, 'utf8'))[1];
    assert.equal(pub, release.publicOf(a.pem));
    const b = signing.ensureKey({ file: keyFile, releaseJs: rel });
    assert.ok(!b.made && !b.said && b.pem === a.pem);
    const zip = path.join(d, 'z.zip'); fs.writeFileSync(zip, 'zip bytes');
    assert.match(signing.signZip(zip, '0.1.99', a.pem, rel), /Signed/);
    assert.equal(release.zipCheck(JSON.parse(fs.readFileSync(zip + '.sig', 'utf8')), '0.1.99', sha256(zip), pub).code, '');
    assert.throws(() => signing.signZip(zip, '0.1.99', OTHER.pem, rel), /not signed/);
    fs.writeFileSync(keyFile, OTHER.pem);
    assert.match(signing.ensureKey({ file: keyFile, releaseJs: rel }).error, /not the one the office carries/);
    fs.rmSync(keyFile);
    assert.match(signing.ensureKey({ file: keyFile, releaseJs: rel }).error, /--new-key/);
    const c = signing.ensureKey({ file: keyFile, releaseJs: rel, newKey: true });
    assert.ok(c.made && release.publicOf(c.pem) !== pub);
    assert.equal(signing.KEY_DEFAULT.startsWith(HERE), false, 'the key lives outside the repository');
  });
  await check('the tag message: signed for the commit you are on, refused while files are changed', () => {
    const d = fs.mkdtempSync(path.join(TMP, 'tagrepo-'));
    fs.mkdirSync(path.join(d, 'lib'));
    fs.writeFileSync(path.join(d, 'lib', 'config.js'), "const VERSION = '0.1.99';\n");
    fs.writeFileSync(path.join(d, 'lib', 'release.js'), "const RELEASE_KEY = '" + KEY.pub + "';\n");
    fs.writeFileSync(path.join(d, 'README.md'), 'readme\n');
    g(d, 'init', '-q', '-b', 'main'); ident(d); g(d, 'add', '-A'); g(d, 'commit', '-q', '-m', 'v');
    const opts = { dir: d, releaseJs: path.join(d, 'lib', 'release.js') };
    const r = signing.writeTag('0.1.99', KEY.pem, opts);
    assert.ok(r.file, r.why);
    const s = release.tagSigOf('\n' + fs.readFileSync(r.file, 'utf8'));
    assert.equal(release.tagCheck(s, '0.1.99', g(d, 'rev-parse', 'HEAD'), g(d, 'rev-parse', 'HEAD^{tree}'), KEY.pub).code, '');
    fs.appendFileSync(path.join(d, 'README.md'), 'changed\n');
    assert.match(signing.writeTag('0.1.99', KEY.pem, opts).why, /not committed/);
    g(d, 'checkout', '--', 'README.md');
    assert.match(signing.writeTag('0.2.0', KEY.pem, opts).why, /says version 0\.1\.99/);
  });

  // ---------- the update ----------
  const origin = path.join(TMP, 'origin.git'), work = path.join(TMP, 'work'), clone = path.join(TMP, 'clones', 'office');
  g(TMP, 'init', '-q', '--bare', '-b', 'main', origin);
  copyOffice(work, '0.1.98');
  g(work, 'init', '-q', '-b', 'main'); ident(work);
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', '0.1.98'); g(work, 'push', '-q', origin, 'main');
  fs.mkdirSync(path.dirname(clone));
  g(TMP, 'clone', '-q', '-c', 'core.autocrlf=false', origin, clone); ident(clone);
  const DATA = path.join(clone, 'data');
  fs.mkdirSync(DATA);
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ workingFolders: [], welcomed: true, mine: true }));
  process.env.AHO_RELEASE_GIT = origin;
  const W = extra => update.where({ app: clone, data: DATA, version: '0.1.98', key: KEY.pub, ...extra });
  const noRefs = () => assert.equal(g(clone, 'for-each-ref', 'refs/aho-update/'), '', 'no fetched refs left behind');

  await check('a folder without git (a zip copy) checks from a scratch repository; a git setting that names a program stops git', async () => {
    const d = path.join(TMP, 'zip'); fs.mkdirSync(d);
    const r = await update.check(W({ app: d }));
    assert(r.ok && r.zip && r.version === null && !r.newer, JSON.stringify(r));
    assert(!fs.existsSync(path.join(d, '.git')), 'Check wrote a .git folder');
    const risky = path.join(TMP, 'risky');
    g(TMP, 'clone', '-q', origin, risky);
    g(risky, 'config', 'core.pager', 'evil.exe');
    const k = await update.check(W({ app: risky }));
    assert(!k.ok && /did not run git/.test(k.fault), JSON.stringify(k));
  });
  await check('no signed release on GitHub yet: said plainly, nothing to take', async () => {
    const r = await update.check(W());
    assert.deepStrictEqual([r.ok, r.version, r.newer], [true, null, false], JSON.stringify(r));
  });

  // 0.1.99, signed, one commit ahead.
  setVersion(work, '0.1.99');
  g(work, 'commit', '-q', '-am', 'office 0.1.99');
  const msg99 = signedTag(work, '0.1.99');
  g(work, 'push', '-q', origin, 'main', 'v0.1.99');

  await check('a signed newer version: found at the fixed address, its signature checked, its changes listed', async () => {
    const r = await update.check(W());
    assert(r.ok && r.newer && r.signed && r.version === '0.1.99' && r.behind === 1 && r.commits[0].text === 'office 0.1.99' && !r.own && !r.changed.length, JSON.stringify(r));
    noRefs();
    // The folder's own origin is never asked: it points nowhere, and the check still works.
    const real = g(clone, 'remote', 'get-url', 'origin');
    g(clone, 'remote', 'set-url', 'origin', path.join(TMP, 'nowhere.git'));
    try { assert((await update.check(W())).newer); } finally { g(clone, 'remote', 'set-url', 'origin', real); }
  });
  await check('a changed file here: the update is refused and the file is untouched', async () => {
    fs.appendFileSync(path.join(clone, 'README.md'), '\nedited here\n');
    const p = await update.take('0.1.99', W());
    assert(!p.ok && /changed here/.test(p.fault) && /README\.md/.test(p.reason), JSON.stringify(p));
    assert.match(fs.readFileSync(path.join(clone, 'README.md'), 'utf8'), /edited here/);
    g(clone, 'checkout', '--', 'README.md');
  });
  await check('signed with another key, or a copy with no key: refused, with the way out', async () => {
    const a = await update.take('0.1.99', W({ key: OTHER.pub }));
    assert(!a.ok && /does not know/.test(a.reason) && /by hand once/.test(a.wayOut), JSON.stringify(a));
    const b = await update.check(W({ key: '' }));
    assert(!b.ok && /no release key/.test(b.reason), JSON.stringify(b));
    noRefs();
  });
  await check('Update now: the test start passes, the clone moves to the exact signed commit, data and hooks are left alone', async () => {
    const before = g(clone, 'rev-parse', 'HEAD');
    const ran = path.join(TMP, 'hook-ran.txt');
    fs.writeFileSync(path.join(clone, '.git', 'hooks', 'post-merge'), `#!/bin/sh\necho ran > "${ran.replace(/\\/g, '/')}"\n`, { mode: 0o755 });
    const r = await update.take('0.1.99', W());
    assert(r.ok && r.version === '0.1.99', JSON.stringify(r));
    assert.equal(g(clone, 'rev-parse', 'HEAD'), g(work, 'rev-parse', 'HEAD'));
    assert(!fs.existsSync(ran), 'a hook in the folder ran');
    assert.equal(JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).mine, true);
    const last = update.lastResult(W());
    assert.deepStrictEqual([last.route, last.ok, last.from, last.to, last.fromCommit, last.toCommit], ['git', true, '0.1.98', '0.1.99', before, g(work, 'rev-parse', 'HEAD')]);
    assert(update.status(W({ version: '0.1.99' })).canGoBack);
    noRefs();
  });
  await check('Go back: the clone moves back to where it was, once', async () => {
    const last = update.lastResult(W());
    const b = await update.goBack(W({ version: '0.1.99' }));
    assert(b.ok && b.version === '0.1.98', JSON.stringify(b));
    assert.equal(g(clone, 'rev-parse', 'HEAD'), last.fromCommit);
    assert(update.lastResult(W()).back === true && !update.status(W()).canGoBack);
    const again = await update.goBack(W());
    assert(!again.ok && /no update to go back from/.test(again.fault), JSON.stringify(again));
  });
  // ---------- a copy unpacked from the release zip (no .git folder) ----------
  // 0.1.98, the first commit, signed too; a zip copy is that release's files, as git archive (and the bake) give them.
  const c98 = g(work, 'rev-list', '--max-parents=0', 'HEAD');
  const m98 = path.join(TMP, 'tag-0.1.98.txt');
  fs.writeFileSync(m98, release.tagMessage(release.signTag(KEY.pem, '0.1.98', c98, g(work, 'rev-parse', c98 + '^{tree}'))));
  g(work, 'tag', '-a', 'v0.1.98', '-F', m98, c98); g(work, 'push', '-q', origin, 'v0.1.98');
  const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const zipCopy = name => {
    const dir = path.join(TMP, 'zips', name), tarFile = path.join(TMP, 'zips', name + '.tar');
    fs.mkdirSync(dir, { recursive: true });
    g(work, 'archive', '--format=tar', '-o', tarFile, 'v0.1.98');
    execFileSync(TAR, ['-x', '-f', tarFile, '-C', dir]);
    fs.mkdirSync(path.join(dir, 'data'));
    fs.writeFileSync(path.join(dir, 'data', 'settings.json'), JSON.stringify({ workingFolders: [], welcomed: true, mine: true }));
    return { app: dir, data: path.join(dir, 'data') };
  };
  const hasGit = dir => fs.existsSync(path.join(dir, '.git'));

  await check('a zip copy: Check finds the signed 0.1.99 and what it brings, and writes nothing in its folder', async () => {
    const z = zipCopy('clean');
    const r = await update.check(W(z));
    assert(r.ok && r.zip && r.newer && r.signed && r.version === '0.1.99' && r.behind === 1 && r.commits[0].text === 'office 0.1.99' && !r.own && !r.changed.length, JSON.stringify(r));
    assert(!hasGit(z.app), 'Check wrote a .git folder');
    assert(update.status(W(z)).zip);
  });
  await check('a zip copy with a changed file: shown on Check; Update now refuses, keeps the file and leaves no .git', async () => {
    const z = zipCopy('changed');
    fs.appendFileSync(path.join(z.app, 'README.md'), '\nedited here\n');
    const r = await update.check(W(z));
    assert(r.ok && r.changed.includes('README.md'), JSON.stringify(r));
    const t = await update.take('0.1.99', W(z));
    assert(!t.ok && /differ from version 0\.1\.98/.test(t.fault) && /README\.md/.test(t.reason), JSON.stringify(t));
    assert(!hasGit(z.app), 'a refused link left its .git folder');
    assert.match(fs.readFileSync(path.join(z.app, 'README.md'), 'utf8'), /edited here/);
  });
  await check('a zip copy whose version is not a signed release: said plainly, nothing changed', async () => {
    const z = zipCopy('unreleased');
    const r = await update.check(W({ ...z, version: '0.1.97' }));
    assert(!r.ok && r.notReleased && /0\.1\.97, is not a signed release/.test(r.reason) && /release zip/.test(r.wayOut), JSON.stringify(r));
    const t = await update.take('0.1.99', W({ ...z, version: '0.1.97' }));
    assert(!t.ok && t.notReleased, JSON.stringify(t));
    assert(!hasGit(z.app), 'a refused link left its .git folder');
  });
  await check('Update now in a zip copy: linked at its own signed version, a missing file put back, moved to 0.1.99; Go back works', async () => {
    const z = zipCopy('takes');
    fs.rmSync(path.join(z.app, 'LICENSE'));
    const r = await update.take('0.1.99', W(z));
    assert(r.ok && r.version === '0.1.99' && r.linked, JSON.stringify(r));
    assert.equal(g(z.app, 'rev-parse', 'HEAD'), g(work, 'rev-parse', 'v0.1.99^{commit}'));
    assert.equal(g(z.app, 'symbolic-ref', 'HEAD'), 'refs/heads/main');
    assert.equal(g(z.app, 'status', '--porcelain', '--untracked-files=no'), '', 'files differ from the signed commit');
    assert(fs.existsSync(path.join(z.app, 'LICENSE')), 'the missing file was not put back');
    assert.equal(JSON.parse(fs.readFileSync(path.join(z.data, 'settings.json'), 'utf8')).mine, true);
    assert.equal(update.lastResult(W(z)).fromCommit, c98);
    assert.equal(g(z.app, 'for-each-ref', 'refs/aho-update/'), '', 'no fetched refs left behind');
    // From now on an ordinary git copy: Check says it is the newest, and Go back returns to the 0.1.98 it was.
    const c = await update.check(W({ ...z, version: '0.1.99' }));
    assert(c.ok && !c.zip && !c.newer && c.version === '0.1.99', JSON.stringify(c));
    const b = await update.goBack(W({ ...z, version: '0.1.99' }));
    assert(b.ok && b.version === '0.1.98' && g(z.app, 'rev-parse', 'HEAD') === c98, JSON.stringify(b));
  });
  await check('no git on this PC: said plainly, with Install Git offered (Windows)', async () => {
    const path0 = process.env.PATH, dirs = [zipCopy('nogit').app, clone];
    process.env.PATH = path.join(TMP, 'no-programs-here');
    process.env.AHO_NO_GIT_HOME = '1';
    try {
      for (const dir of dirs) {
        const r = await update.check(W({ app: dir }));
        assert(!r.ok && r.fault === 'Git is not installed.' && r.installGit === (process.platform === 'win32') && /Install Git/.test(r.wayOut), JSON.stringify(r));
      }
    } finally { process.env.PATH = path0; delete process.env.AHO_NO_GIT_HOME; }
  });
  await check('Install Git: winget in a window of its own (a test copy only says so)', () => {
    const os2 = require('../lib/platform');
    if (process.platform !== 'win32') return;
    assert.match(os2.installGitCommand('C:\\x\\winget.exe'), /^winget install --id Git\.Git -e --source winget \(in a new window\)$/);
    assert.match(os2.installGitCommand(null), /winget not found/);
  });

  await check('a version that does not start is never taken', async () => {
    const at = g(clone, 'rev-parse', 'HEAD');
    // The tag points at a commit whose server.js stops at once.
    const broken = path.join(TMP, 'broken');
    g(TMP, 'clone', '-q', origin, broken); ident(broken);
    fs.writeFileSync(path.join(broken, 'server.js'), "console.error('broken on purpose'); process.exit(3);\n");
    setVersion(broken, '0.1.100');
    g(broken, 'commit', '-q', '-am', 'broken');
    signedTag(broken, '0.1.100');
    g(broken, 'push', '-q', origin, 'main', 'v0.1.100');
    const r = await update.take('0.1.100', W());
    assert(!r.ok && /not installed/.test(r.fault) && /stopped as soon as it started/.test(r.reason), JSON.stringify(r));
    assert.equal(g(clone, 'rev-parse', 'HEAD'), at);
    noRefs();
    // Put the address back as it was: v0.1.100 and the broken commit gone.
    g(broken, 'push', '-q', origin, ':refs/tags/v0.1.100');
    g(broken, 'push', '-q', '-f', origin, g(work, 'rev-parse', 'HEAD') + ':refs/heads/main');
  });
  await check('a moved tag, a plain tag, an unsigned tag: none taken', async () => {
    fs.appendFileSync(path.join(work, 'README.md'), '\nsomething else\n');
    g(work, 'commit', '-q', '-am', 'other');
    g(work, 'tag', '-f', '-a', 'v0.1.99', '-F', msg99);
    g(work, 'push', '-q', '-f', origin, 'main', 'v0.1.99');
    assert.match((await update.check(W())).reason, /another commit than the one that was signed/i);
    setVersion(work, '0.1.101');
    g(work, 'commit', '-q', '-am', '0.1.101');
    g(work, 'tag', 'v0.1.101'); g(work, 'push', '-q', origin, 'main', 'v0.1.101');
    assert.match((await update.check(W())).reason, /plain tag/);
    g(work, 'tag', '-d', 'v0.1.101'); g(work, 'tag', '-a', 'v0.1.101', '-m', 'no signature'); g(work, 'push', '-q', '-f', origin, 'v0.1.101');
    assert.match((await update.check(W())).reason, /no signature/);
    noRefs();
  });
  await check('commits of its own: shown, and Update now refuses (not a fast-forward)', async () => {
    signedTag(work, '0.1.101', KEY.pem, true);
    g(work, 'push', '-q', '-f', origin, 'v0.1.101');
    fs.writeFileSync(path.join(clone, 'mine.txt'), 'mine'); g(clone, 'add', 'mine.txt'); g(clone, 'commit', '-q', '-m', 'mine');
    const c = await update.check(W());
    assert(c.ok && c.newer && c.own, JSON.stringify(c));
    const t = await update.take('0.1.101', W());
    assert(!t.ok && /own saved changes/.test(t.fault), JSON.stringify(t));
    noRefs();
  });
  await check('Go back takes commit ids only: an edited last.json never hands git an option', async () => {
    fs.writeFileSync(path.join(DATA, 'update', 'last.json'), JSON.stringify({ route: 'git', ok: true, from: '0.1.98', to: '0.1.99', fromCommit: '--hard', toCommit: g(clone, 'rev-parse', 'HEAD') }));
    const at = g(clone, 'rev-parse', 'HEAD');
    const r = await update.goBack(W());
    assert(!r.ok && /no update to go back from/.test(r.fault), JSON.stringify(r));
    assert.equal(g(clone, 'rev-parse', 'HEAD'), at);
  });
  await check('a file of yours that git ignores is never overwritten by one a release brings', async () => {
    fs.writeFileSync(path.join(work, 'local.json'), '{"from":"the release"}\n');
    setVersion(work, '0.1.102');
    g(work, 'add', 'local.json', 'lib/config.js'); g(work, 'commit', '-q', '-m', '0.1.102');
    signedTag(work, '0.1.102');
    g(work, 'push', '-q', '-f', origin, 'main', 'v0.1.102');
    const c2 = path.join(TMP, 'clones', 'office2');
    g(TMP, 'clone', '-q', '-c', 'core.autocrlf=false', origin, c2); ident(c2);
    g(c2, 'reset', '-q', '--hard', 'HEAD~1');
    fs.appendFileSync(path.join(c2, '.git', 'info', 'exclude'), '\nlocal.json\n');
    fs.writeFileSync(path.join(c2, 'local.json'), '{"mine":true}\n');
    const at = g(c2, 'rev-parse', 'HEAD');
    const r = await update.take('0.1.102', W({ app: c2, data: path.join(c2, 'data'), version: '0.1.101' }));
    assert(!r.ok && /did not go in/.test(r.fault), JSON.stringify(r));
    assert.equal(fs.readFileSync(path.join(c2, 'local.json'), 'utf8'), '{"mine":true}\n');
    assert.equal(g(c2, 'rev-parse', 'HEAD'), at);
  });
  await check('the test start says when a copy reports another version', async () => {
    const dir = copyOffice(path.join(TMP, 'plain-copy'), '0.1.99');
    assert.match(await update.selfTest(dir, '0.2.0', W()), /says it is 0\.1\.99, not 0\.2\.0/);
  });

  delete process.env.AHO_RELEASE_GIT;
  for (let i = 0; i < 5; i++) { try { fs.rmSync(TMP, { recursive: true, force: true }); break; } catch { await sleep(500); } }
  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
