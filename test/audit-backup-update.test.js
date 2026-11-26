// Audit of backups, zips and signed updates: one test per fault found. A P0 test fails until the fault is fixed; a P1
// test is marked todo. Made-up projects, drives and repositories in a temp folder only, signed with a throwaway key; the
// office's own repository, data folder, settings and registry are never read or changed.
// Run: node test/audit-backup-update.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-audit-bu-'));
process.env.AHO_DATA = path.join(TMP, 'proc-data');
delete process.env.AHO_RELEASE_GIT;
const Backup = require('../lib/backup');
const { keyOf } = require('../lib/projects');
const release = require('../lib/release');
const update = require('../lib/update');

test.after(() => {
  delete process.env.AHO_RELEASE_GIT;
  for (let i = 0; i < 5; i++) { try { fs.rmSync(TMP, { recursive: true, force: true }); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); } }
});

// ---- backups: a made-up drive list over the temp folder's drive ----
const vols = [{ letter: TMP[0].toUpperCase(), serial: 'AUDIT001', label: 'Audit stick', type: 2, bus: 'USB', size: 64e9, free: 32e9 }];
let dataN = 0;
const engine = (o = {}) => Backup.create({ dataDir: path.join(TMP, 'bdata' + (++dataN)), listDrives: async () => vols, keyOf, host: 'AUDIT-PC', version: 'test', ...o });
const waitJob = async b => { for (let i = 0; i < 600; i++) { const j = b.status(); if (j && j.finished) return j; await new Promise(r => setTimeout(r, 50)); } throw new Error('the backup did not finish'); };
const mk = (root, rel, data = 'x') => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; };
let projN = 0;
function project(name) {
  const dir = path.join(TMP, 'work' + (++projN), name);
  mk(dir, 'README.md', '# ' + name + '\n');
  mk(dir, 'src/app.js', 'console.log(1)\n'.repeat(50));
  return { id: name.toLowerCase() + '-' + projN, name, dir, folder: name, updated: Date.now() - 3600e3 };
}
const usbN = (() => { let n = 0; return () => path.join(TMP, 'usb' + (++n)); })();
const zipsIn = d => (fs.existsSync(d) ? fs.readdirSync(d).filter(n => n.endsWith('.zip')) : []);

test('AUD-BU-01 P0 edge: Keep last 1 deletes the backup it has just made when an older backup carries a later date (the clock was ahead once)', async () => {
  let clock = Date.now() + 400 * 864e5; // the PC's clock was set a year ahead for one backup
  const b = engine({ now: () => clock });
  const p = project('Clock');
  const usb = usbN();
  assert.ok((await b.addDrive(usb, { projects: [p] })).ok);
  await b.start([p]); await waitJob(b);
  clock = Date.now(); // the clock put right
  assert.ok(b.setKeep(1).ok);
  await b.start([p]);
  const j = await waitJob(b);
  assert.strictEqual(j.items[0].state, 'done');
  const made = path.join(usb, Backup.FOLDER_NAME, j.items[0].file);
  assert.ok(fs.existsSync(made), 'the run says done, but Keep last 1 deleted the zip it had just made (' + path.basename(made) + ')');
});

test('AUD-BU-02 (was P0, now P2): Keep last N deletes a zip in another project\'s folder when the drive\'s index names it under this project', { todo: 'P2 (downgraded by the disprove pass)' }, async () => {
  const alpha = project('Alpha'), beta = project('Beta');
  const usb = usbN();
  const first = engine();
  assert.ok((await first.addDrive(usb, { projects: [alpha, beta] })).ok);
  await first.start([beta]); await waitJob(first);
  const folder = path.join(usb, Backup.FOLDER_NAME);
  const betaZip = zipsIn(path.join(folder, 'Beta'))[0];
  assert.ok(betaZip);
  // The drive's index (written by another PC, or damaged) lists Beta's zip as a backup of Alpha.
  const idxFile = path.join(folder, Backup.INDEX_NAME);
  const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  idx.backups.push({ key: keyOf(alpha.dir), file: 'Beta/' + betaZip, at: Date.now() - 5000, bytes: 10, source: 10, files: 1, checked: true, host: 'OTHER-PC' });
  fs.writeFileSync(idxFile, JSON.stringify(idx));
  const b = engine();
  assert.ok((await b.addDrive(usb, { projects: [alpha, beta] })).ok);
  assert.ok(b.setKeep(1).ok);
  await b.start([alpha]); await waitJob(b);
  assert.ok(fs.existsSync(path.join(folder, 'Beta', betaZip)), 'a backup of Alpha deleted Beta\'s zip ' + betaZip);
});

test('AUD-BU-03 (was P0, now P1): a drive index whose size is not a number blocks every backup to that drive ("needs about NaN MB")', { todo: 'P1 (downgraded by the disprove pass)' }, async () => {
  const p = project('Shape');
  const usb = usbN();
  const folder = path.join(usb, Backup.FOLDER_NAME);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, Backup.INDEX_NAME), JSON.stringify({ backups: [{ key: keyOf(p.dir), file: 'Shape/Shape-2020-01-01-0000.zip', at: Date.now() - 1000, bytes: 'big', source: 100, checked: true }] }));
  const b = engine();
  assert.ok((await b.addDrive(usb, { projects: [p] })).ok);
  const pl = await b.plan([p]);
  assert.ok(Number.isFinite(pl.total.zip), 'the plan\'s zip size is ' + pl.total.zip);
  const s = await b.start([p]);
  assert.ok(s.ok, 'Start refused: ' + s.fault + ' ' + s.reason);
  await waitJob(b);
});

test('AUD-BU-04 P1: the drive index rewritten by one office drops the backups another office (another PC) wrote there', { todo: 'P1' }, async () => {
  const one = project('One'), two = project('Two');
  const usb = usbN();
  const a = engine(), c = engine();
  await a.addDrive(usb, { projects: [one, two] });
  await a.start([one]); await waitJob(a);
  await c.addDrive(usb, { projects: [one, two] });
  await c.start([two]); await waitJob(c);
  await a.start([one]); await waitJob(a);
  const idx = JSON.parse(fs.readFileSync(path.join(usb, Backup.FOLDER_NAME, Backup.INDEX_NAME), 'utf8'));
  assert.ok(idx.backups.some(x => x.key === keyOf(two.dir)), 'the index no longer lists the backup of Two that the other office made');
});

test('AUD-BU-05 P1: a backup dated in the future (clock ahead once) hides "changed since" and Needs attention for ever', { todo: 'P1' }, async () => {
  let clock = Date.now() + 400 * 864e5;
  const b = engine({ now: () => clock });
  const p = project('Future');
  await b.addDrive(usbN(), { projects: [p] });
  b.setListed([p.dir], true);
  await b.start([p]); await waitJob(b);
  clock = Date.now() + 30 * 864e5; // a month later, the project changed since
  p.updated = clock - 1000;
  const row = b.rowOf(p);
  assert.ok(row.changed, 'the project changed after its last real backup, but the row says it did not');
});

test('AUD-BU-06 P1: Keep last N on one PC deletes the backups another PC made of a project at the same path (the host is ignored)', { todo: 'P1' }, async () => {
  const p = project('Shared');
  const usb = usbN();
  const other = engine({ host: 'OTHER-PC' });
  await other.addDrive(usb, { projects: [p] });
  await other.start([p]); await waitJob(other);
  const folder = path.join(usb, Backup.FOLDER_NAME, 'Shared');
  const theirs = zipsIn(folder)[0];
  const mine = engine({ host: 'THIS-PC', now: () => Date.now() + 120000 });
  await mine.addDrive(usb, { projects: [p] });
  mine.setKeep(1);
  await mine.start([p]); await waitJob(mine);
  assert.ok(fs.existsSync(path.join(folder, theirs)), 'the other PC\'s backup was deleted by this PC\'s Keep last 1');
});

// ---- updates: a bare repository stands in for GitHub, signed with a throwaway key ----
const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ident = d => { g(d, 'config', 'user.name', 'Test'); g(d, 'config', 'user.email', 'test@example.invalid'); g(d, 'config', 'core.autocrlf', 'false'); };
const KEY = (() => { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); return { pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }; })();
const put = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const cfgText = v => "const VERSION = '" + v + "';\n";
function signTag(work, v) {
  const msg = path.join(TMP, 'tag-' + crypto.randomBytes(4).toString('hex') + '.txt');
  fs.writeFileSync(msg, release.tagMessage(release.signTag(KEY.pem, v, g(work, 'rev-parse', 'HEAD'), g(work, 'rev-parse', 'HEAD^{tree}'))));
  g(work, 'tag', '-a', 'v' + v, '-F', msg);
}
// A tiny released office: 1.0.0 and 1.0.1, both signed, pushed to a bare repository.
function standIn(name) {
  const base = path.join(TMP, name); fs.mkdirSync(base);
  const origin = path.join(base, 'origin.git'), work = path.join(base, 'work');
  g(base, 'init', '-q', '--bare', '-b', 'main', origin);
  fs.mkdirSync(work); g(work, 'init', '-q', '-b', 'main'); ident(work);
  put(work, 'lib/config.js', cfgText('1.0.0')); put(work, 'README.md', 'readme\n'); put(work, '.gitignore', 'data/\n');
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', '1.0.0'); signTag(work, '1.0.0');
  put(work, 'lib/config.js', cfgText('1.0.1')); g(work, 'commit', '-q', '-am', '1.0.1'); signTag(work, '1.0.1');
  g(work, 'push', '-q', origin, 'main', 'v1.0.0', 'v1.0.1');
  return { base, origin, work };
}
// A copy unpacked from the 1.0.0 release zip.
function zipCopy(base, name) {
  const d = path.join(base, name);
  put(d, 'lib/config.js', cfgText('1.0.0')); put(d, 'README.md', 'readme\n'); put(d, '.gitignore', 'data/\n');
  fs.mkdirSync(path.join(d, 'data'));
  return d;
}
const W = (app, version = '1.0.0', data = path.join(app, 'data')) => update.where({ app, data, version, key: KEY.pub });

test('AUD-UP-01 P0 edge: a zip copy\'s first Update now stopped part way (office closed during the fetch) wedges Update: Check says it has commits of its own, Update says to update by hand', async () => {
  const s = standIn('link');
  process.env.AHO_RELEASE_GIT = s.origin;
  try {
    // Stopped after git init (the fetch was under way): a .git folder with no commit.
    const z1 = zipCopy(s.base, 'z1');
    g(z1, 'init', '-q'); g(z1, 'config', 'core.autocrlf', 'false');
    const c1 = await update.check(W(z1));
    assert.ok(!(c1.ok && c1.own), 'Check says this copy has commits of its own: ' + JSON.stringify({ own: c1.own, zip: c1.zip }));
    const t1 = await update.take('1.0.1', W(z1));
    assert.notStrictEqual(t1.fault, 'Git could not say where this copy is.', 'Update now gives up: ' + t1.fault + ' ' + t1.wayOut);
    // Stopped after main was set, before the index was: every file looks changed.
    const z2 = zipCopy(s.base, 'z2');
    g(z2, 'init', '-q'); g(z2, 'config', 'core.autocrlf', 'false');
    g(z2, 'fetch', '-q', s.origin, '+refs/tags/v1.0.0:refs/aho-update/v1.0.0');
    g(z2, 'update-ref', 'refs/heads/main', g(z2, 'rev-parse', 'refs/aho-update/v1.0.0^{commit}'));
    g(z2, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    const t2 = await update.take('1.0.1', W(z2));
    assert.ok(!/were changed here/.test(t2.fault || ''), 'Update now says the unchanged files were changed here: ' + t2.reason);
  } finally { delete process.env.AHO_RELEASE_GIT; }
});

test('AUD-UP-01b: a .git that may be the person\'s own (a bare git init, no commit) is never removed by Update now, and the refusal says how to go on', async () => {
  const s = standIn('own-init');
  process.env.AHO_RELEASE_GIT = s.origin;
  try {
    const z = zipCopy(s.base, 'z3');
    g(z, 'init', '-q'); g(z, 'config', 'core.autocrlf', 'false'); g(z, 'config', 'user.name', 'kept');
    const c = await update.check(W(z));
    assert.ok(!(c.ok && c.own), 'Check says this copy has commits of its own');
    const t = await update.take('1.0.1', W(z));
    assert.ok(!t.ok, 'Update now went ahead');
    assert.match(String(t.wayOut || ''), /delete the \.git folder/, 'the refusal does not say how to go on: ' + t.wayOut);
    assert.match(fs.readFileSync(path.join(z, '.git', 'config'), 'utf8'), /name = kept/, 'the .git was removed or replaced');
  } finally { delete process.env.AHO_RELEASE_GIT; }
});

test('AUD-UP-02 (was P0, now P1): an update stopped during the move (office window closed, power cut) leaves the folder between versions, and Check then says it is up to date', { todo: 'P1 (downgraded by the disprove pass)' }, async () => {
  const s = standIn('midmerge');
  process.env.AHO_RELEASE_GIT = s.origin;
  try {
    const app = path.join(s.base, 'app');
    g(s.base, 'clone', '-q', '-c', 'core.autocrlf=false', s.origin, app); ident(app);
    g(app, 'reset', '-q', '--hard', 'v1.0.0');
    const data = path.join(s.base, 'data'); fs.mkdirSync(data);
    // What a merge killed part way leaves (seen by killing a real take() during its merge): HEAD still at 1.0.0, some
    // files already the new version's (lib/config.js says 1.0.1), git's index.lock left, and no record of the update.
    put(app, 'lib/config.js', cfgText('1.0.1'));
    fs.writeFileSync(path.join(app, '.git', 'index.lock'), '');
    // The office starts again and reads its version from lib/config.js: 1.0.1.
    const r = await update.check(W(app, '1.0.1', data));
    assert.ok(!(r.ok && r.newer === false && !r.fault), 'Check says this copy is up to date (1.0.1), but its folder is at the 1.0.0 commit with half the new files: ' + JSON.stringify({ ok: r.ok, newer: r.newer, version: r.version }));
  } finally { delete process.env.AHO_RELEASE_GIT; }
});

test('AUD-UP-03 P1: Go back overwrites a file of yours that the newer version ignores and the older one tracked', { todo: 'P1' }, async () => {
  const base = path.join(TMP, 'goback'); fs.mkdirSync(base);
  const work = path.join(base, 'work'); fs.mkdirSync(work); g(work, 'init', '-q', '-b', 'main'); ident(work);
  put(work, 'notes.txt', 'from the release\n'); put(work, 'lib/config.js', cfgText('1.0.0'));
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', '1.0.0');
  const from = g(work, 'rev-parse', 'HEAD');
  g(work, 'rm', '-q', 'notes.txt'); put(work, '.gitignore', 'notes.txt\n'); put(work, 'lib/config.js', cfgText('1.0.1'));
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', '1.0.1');
  const to = g(work, 'rev-parse', 'HEAD');
  const app = path.join(base, 'app'); g(base, 'clone', '-q', '-c', 'core.autocrlf=false', work, app); ident(app);
  fs.writeFileSync(path.join(app, 'notes.txt'), 'my own notes\n');
  const data = path.join(base, 'data'); fs.mkdirSync(path.join(data, 'update'), { recursive: true });
  fs.writeFileSync(path.join(data, 'update', 'last.json'), JSON.stringify({ route: 'git', ok: true, from: '1.0.0', to: '1.0.1', fromCommit: from, toCommit: to }));
  const r = await update.goBack(W(app, '1.0.1', data));
  assert.strictEqual(fs.readFileSync(path.join(app, 'notes.txt'), 'utf8'), 'my own notes\n', 'Go back (' + JSON.stringify(r) + ') wrote over the file');
});
