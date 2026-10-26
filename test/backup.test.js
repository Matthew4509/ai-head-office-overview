// Tests for backups (lib/backup.js, lib/zip.js): what goes in, the zip itself, the read-back check, drives found by
// serial, keep-last-N, refusals, and a drive used before telling a new office what it holds. Made-up folders in a temp
// dir only; the drives are a made-up list. Run: node test/backup.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const Backup = require('../lib/backup');
const { writeZip, checkZip, listZip } = require('../lib/zip');
const { keyOf } = require('../lib/projects');

let failures = 0;
const tests = [];
const check = (name, fn) => tests.push([name, fn]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-backup-'));
const mk = (root, rel, data = 'x') => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; };
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const hasTar = process.platform === 'win32' && fs.existsSync(TAR);

// A made-up project: real work, a git folder, and the folders a backup leaves out.
function project(name) {
  const p = path.join(tmp, 'work', name);
  mk(p, 'README.md', '# ' + name + '\n');
  mk(p, 'src/app.js', 'console.log(1)\n'.repeat(500));
  mk(p, '.git/HEAD', 'ref: refs/heads/main\n');
  mk(p, '.git/objects/ab/cdef', Buffer.alloc(3000, 7));
  mk(p, 'node_modules/left/index.js', 'x');
  mk(p, 'deep/node_modules/also/index.js', 'x');
  mk(p, 'php/composer.json', '{}'); mk(p, 'php/vendor/lib.php', 'x');
  mk(p, 'js/vendor/shipped.js', 'kept');
  mk(p, 'net/App.csproj', '<Project/>'); mk(p, 'net/bin/App.dll', 'x'); mk(p, 'net/obj/x.cache', 'x');
  mk(p, 'other/bin/tool.sh', 'kept');
  mk(p, 'rust/Cargo.toml', ''); mk(p, 'rust/target/debug/x', 'x');
  mk(p, 'data/target/keep.csv', 'kept');
  mk(p, '.claude/worktrees/wt/file.txt', 'x'); mk(p, '.claude/launch.json', '{}');
  mk(p, 'dist/release.zip', Buffer.alloc(2000, 1));
  mk(p, 'notes/naïve ü/日本 é.txt', 'unicode name');
  fs.mkdirSync(path.join(p, 'empty'), { recursive: true });
  return { id: name.toLowerCase() + '-1', name, dir: p, folder: name, updated: Date.now() - 3600e3 };
}
const names = w => w.items.map(i => i.name);

check('walk: .git kept; node_modules, vendor beside composer.json, bin/obj beside a .csproj, target beside Cargo.toml and .claude/worktrees left out; look-alikes kept', async () => {
  const p = project('Alpha');
  const w = await Backup.walk(p.dir);
  const n = names(w);
  for (const keep of ['Alpha/.git/HEAD', 'Alpha/js/vendor/shipped.js', 'Alpha/other/bin/tool.sh', 'Alpha/data/target/keep.csv', 'Alpha/.claude/launch.json', 'Alpha/dist/release.zip', 'Alpha/notes/naïve ü/日本 é.txt', 'Alpha/empty/'])
    assert.ok(n.includes(keep), 'missing ' + keep);
  for (const out of ['node_modules', 'php/vendor', 'net/bin', 'net/obj', 'rust/target', '.claude/worktrees'])
    assert.ok(!n.some(x => x.includes('Alpha/' + out + '/') || x.includes('/' + out + '/')), 'should be left out: ' + out);
  assert.strictEqual(w.leftOut.node_modules, 2);
  assert.strictEqual(w.files, n.filter(x => !x.endsWith('/')).length);
});

check('zip: written, listed by its own reader and by Windows tar, every file checked (names with é and 日本 too)', async () => {
  const p = project('Beta');
  const w = await Backup.walk(p.dir);
  const z = path.join(tmp, 'beta.zip');
  const made = await writeZip(z, w.items);
  assert.strictEqual(made.skipped.length, 0);
  const list = await listZip(z);
  assert.strictEqual(list.length, w.items.length);
  assert.ok(list.some(e => e.name === 'Beta/notes/naïve ü/日本 é.txt'));
  const r = await checkZip(z, made.entries);
  assert.ok(r.ok, r.fault);
  assert.strictEqual(r.files, w.files);
  if (hasTar) {
    const t = spawnSync(TAR, ['-tf', z], { encoding: 'utf8' });
    assert.strictEqual(t.status, 0, t.stderr);
    assert.strictEqual(t.stdout.trim().split(/\r?\n/).length, w.items.length);
    const x = spawnSync(TAR, ['-x', '-O', '-f', z], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
    assert.strictEqual(x.status, 0, x.stderr);
  }
});

check('zip64: more entries than plain zip holds (70,000) still lists and checks', async () => {
  const items = [{ name: 'Many/', dir: true, mtimeMs: Date.now() }];
  for (let i = 0; i < 70000; i++) items.push({ name: `Many/d${i}/`, dir: true, mtimeMs: Date.now() });
  const z = path.join(tmp, 'many.zip');
  const made = await writeZip(z, items);
  assert.strictEqual((await listZip(z)).length, 70001);
  assert.ok((await checkZip(z, made.entries)).ok);
  if (hasTar) assert.strictEqual(spawnSync(TAR, ['-tf', z], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout.trim().split(/\r?\n/).length, 70001);
});

check('the check catches one changed byte and a zip cut short', async () => {
  const p = project('Gamma');
  mk(p.dir, 'big.dat', Buffer.from(Array.from({ length: 400000 }, (_, i) => (i * 7919) % 251)));
  const w = await Backup.walk(p.dir);
  const z = path.join(tmp, 'gamma.zip');
  const made = await writeZip(z, w.items);
  const buf = fs.readFileSync(z);
  const e = (await listZip(z)).find(x => x.name === 'Gamma/big.dat');
  const bad = Buffer.from(buf); bad[e.offset + 30 + Buffer.byteLength(e.name) + Math.floor(e.csize / 2)] ^= 0xff;
  fs.writeFileSync(path.join(tmp, 'bad.zip'), bad);
  const r1 = await checkZip(path.join(tmp, 'bad.zip'), made.entries);
  assert.strictEqual(r1.ok, false);
  assert.match(r1.fault, /big\.dat/);
  fs.writeFileSync(path.join(tmp, 'short.zip'), buf.subarray(0, Math.floor(buf.length * 0.6)));
  const r2 = await checkZip(path.join(tmp, 'short.zip'), made.entries);
  assert.strictEqual(r2.ok, false);
  assert.match(r2.fault, /could not be read back/);
});

if (process.platform === 'win32') check('a file that cannot be read is listed, and the backup still passes', async () => {
  const p = project('Delta');
  const locked = mk(p.dir, 'locked.txt', 'secret');
  const user = process.env.USERNAME;
  spawnSync('icacls', [locked, '/deny', user + ':(R)']);
  try {
    const w = await Backup.walk(p.dir);
    const z = path.join(tmp, 'delta.zip');
    const made = await writeZip(z, w.items);
    assert.deepStrictEqual(made.skipped.map(s => s.name), ['Delta/locked.txt']);
    assert.ok((await checkZip(z, made.entries)).ok);
  } finally { spawnSync('icacls', [locked, '/remove:d', user]); }
});

// ---- the engine, with a made-up drive list: the temp folder's drive has serial TEST0001 ----
const letter = tmp[0].toUpperCase();
let vols = [{ letter, serial: 'TEST0001', label: 'Test stick', type: 2, bus: 'USB', size: 64e9, free: 32e9 }];
let dataN = 0;
const engine = (o = {}) => Backup.create({ dataDir: path.join(tmp, 'data' + (++dataN)), listDrives: async () => vols, keyOf, host: 'TEST-PC', version: 'test', ...o });
const waitJob = async (b) => { for (let i = 0; i < 600; i++) { const j = b.status(); if (j && j.finished) return j; await new Promise(r => setTimeout(r, 50)); } throw new Error('the backup did not finish'); };

check('engine: add a drive, back up the list, the zip and its .txt are there, and the drive keeps its own index', async () => {
  const b = engine();
  const p = project('Epsilon');
  const usb = path.join(tmp, 'usb1');
  const r = await b.addDrive(usb, { projects: [p] });
  assert.ok(r.ok, r.fault);
  assert.strictEqual(r.drive.name, 'Drive 1');
  assert.ok(r.drive.here);
  b.setListed([p.dir], true);
  const pl = await b.plan([p]);
  assert.strictEqual(pl.drive.id, r.drive.id);
  assert.ok(pl.rows[0].files > 5 && pl.rows[0].secs >= 0 && pl.fits);
  assert.ok(pl.firstGuess);
  const s = await b.start([p]);
  assert.ok(s.ok, s.fault);
  const j = await waitJob(b);
  assert.strictEqual(j.items[0].state, 'done', JSON.stringify(j.items[0]));
  const dir = path.join(usb, Backup.FOLDER_NAME, 'Epsilon');
  const zips = fs.readdirSync(dir).filter(n => n.endsWith('.zip'));
  assert.strictEqual(zips.length, 1);
  assert.match(zips[0], /^Epsilon-\d{4}-\d\d-\d\d-\d{4}\.zip$/);
  const txt = fs.readFileSync(path.join(dir, zips[0].replace(/\.zip$/, '.txt')), 'utf8');
  assert.match(txt, /Check: passed/);
  assert.match(txt, /node_modules x2/);
  assert.ok(fs.existsSync(path.join(usb, Backup.FOLDER_NAME, Backup.INDEX_NAME)));
  const row = b.rowOf(p);
  assert.ok(row.listed && row.last && row.last.drive === 'Drive 1' && !row.changed);
  assert.deepStrictEqual(b.needs([p]), []);
});

check('engine: the drive is found by its serial, not its letter, and a moved letter is said', async () => {
  const b = engine();
  const p = project('Zeta');
  const usb = path.join(tmp, 'usb2');
  const r = await b.addDrive(usb, { projects: [p] });
  assert.ok(r.ok);
  // Last seen as Q: (as if Windows gave it another letter last time): found again under its serial, and said.
  const file = path.join(tmp, 'data' + dataN, 'backups.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')); saved.drives[0].letter = 'Q'; fs.writeFileSync(file, JSON.stringify(saved));
  const b2 = Backup.create({ dataDir: path.join(tmp, 'data' + dataN), listDrives: async () => vols, keyOf });
  const v = (await b2.view()).drives[0];
  assert.ok(v.here);
  assert.strictEqual(v.movedFrom, 'Q');
  // Another stick in the same letter (another serial): not the backup drive.
  const before = vols;
  vols = [{ ...before[0], serial: 'OTHER999' }];
  try {
    const b3 = Backup.create({ dataDir: path.join(tmp, 'data' + dataN), listDrives: async () => vols, keyOf });
    assert.strictEqual((await b3.view()).drives[0].here, false);
    const s = await b3.start([p]);
    assert.strictEqual(s.ok, false);
    assert.match(s.fault, /No backup drive is plugged in/);
  } finally { vols = before; }
});

check('engine: refuses a folder inside a project or a working folder; warns on a cloud folder', async () => {
  const b = engine();
  const p = project('Eta');
  const r1 = await b.addDrive(path.join(p.dir, 'backups'), { projects: [p] });
  assert.strictEqual(r1.ok, false); assert.match(r1.fault, /inside Eta/);
  const r2 = await b.addDrive(path.join(tmp, 'work'), { projects: [p], workingFolders: [path.join(tmp, 'work')] });
  assert.strictEqual(r2.ok, false); assert.match(r2.fault, /working folder/);
  const r3 = await b.addDrive('relative\\path', { projects: [p] });
  assert.strictEqual(r3.ok, false);
  const r4 = await b.addDrive(path.join(tmp, 'OneDrive', 'Backups'), { projects: [p] });
  assert.ok(r4.ok);
  assert.ok(r4.warnings.some(x => /cloud/.test(x)));
});

check('engine: will not start when it will not fit; nothing is written or deleted', async () => {
  const b = engine({ statfs: async () => ({ bavail: 1000, bsize: 4096, blocks: 1e6 }) });
  const p = project('Theta');
  const usb = path.join(tmp, 'usb3');
  assert.ok((await b.addDrive(usb, { projects: [p] })).ok);
  const pl = await b.plan([p]);
  assert.strictEqual(pl.fits, false);
  const s = await b.start([p]);
  assert.strictEqual(s.ok, false);
  assert.match(s.fault, /will not fit/);
  assert.match(s.reason, /never deleted/);
  assert.deepStrictEqual(fs.readdirSync(path.join(usb, Backup.FOLDER_NAME)), []);
});

check('engine: a failed check stays .partial, the earlier backup stays, and Needs attention says so', async () => {
  let fail = false;
  const b = engine({ check: async (f, e, o) => (fail ? { ok: false, fault: 'Made-up fault.' } : checkZip(f, e, o)) });
  const p = project('Iota');
  const usb = path.join(tmp, 'usb4');
  assert.ok((await b.addDrive(usb, { projects: [p] })).ok);
  b.setListed([p.dir], true);
  await b.start([p]); await waitJob(b);
  fail = true;
  await new Promise(r => setTimeout(r, 1100)); // another minute stamp is not needed: a second zip gets -2
  await b.start([p]); const j = await waitJob(b);
  assert.strictEqual(j.items[0].state, 'failed');
  assert.match(j.items[0].fault.reason, /Made-up fault/);
  const dir = path.join(usb, Backup.FOLDER_NAME, 'Iota');
  const files = fs.readdirSync(dir);
  assert.strictEqual(files.filter(n => n.endsWith('.zip')).length, 1);
  assert.strictEqual(files.filter(n => n.endsWith('.zip.partial')).length, 1);
  assert.strictEqual(b.needs([p])[0].kind, 'failed');
  assert.ok(b.rowOf(p).last, 'the earlier backup still counts');
});

check('engine: every backup is kept by default; keep-last-N deletes only its own older zips, after a passing check', async () => {
  const b = engine();
  const p = project('Kappa');
  const usb = path.join(tmp, 'usb5');
  assert.ok((await b.addDrive(usb, { projects: [p] })).ok);
  const dir = path.join(usb, Backup.FOLDER_NAME, 'Kappa');
  for (let i = 0; i < 3; i++) { await b.start([p]); await waitJob(b); }
  assert.strictEqual(fs.readdirSync(dir).filter(n => n.endsWith('.zip')).length, 3);
  mk(dir, 'mine.zip', 'not the office\'s');
  assert.ok(b.setKeep(2).ok);
  await b.start([p]); await waitJob(b);
  const left = fs.readdirSync(dir);
  assert.strictEqual(left.filter(n => /^Kappa-.*\.zip$/.test(n)).length, 2);
  assert.ok(left.includes('mine.zip'));
  assert.strictEqual(left.filter(n => n.endsWith('.txt')).length, 2);
});

check('engine: a drive used before tells a new office what it holds; forgetting a drive leaves its files', async () => {
  const p = project('Lambda');
  const usb = path.join(tmp, 'usb6');
  const b1 = engine();
  assert.ok((await b1.addDrive(usb, { projects: [p] })).ok);
  await b1.start([p]); await waitJob(b1);
  const b2 = engine();
  const r = await b2.addDrive(usb, { projects: [p] });
  assert.strictEqual(r.imported, 1);
  assert.strictEqual(b2.rowOf(p).last.drive, 'Drive 1');
  assert.ok(b2.forgetDrive(r.drive.id).ok);
  assert.strictEqual(fs.readdirSync(path.join(usb, Backup.FOLDER_NAME, 'Lambda')).filter(n => n.endsWith('.zip')).length, 1);
});

check('engine: two drives plugged in means choosing one; never backed up and changed-since show in Needs attention', async () => {
  let shift = 0;
  const b = engine({ now: () => Date.now() + shift });
  const p = project('Mu');
  assert.ok((await b.addDrive(path.join(tmp, 'usb7'), { projects: [p] })).ok);
  assert.ok((await b.addDrive(path.join(tmp, 'usb8'), { projects: [p] })).ok);
  b.setListed([p.dir], true);
  assert.strictEqual(b.needs([p])[0].kind, 'never');
  const pl = await b.plan([p]);
  assert.strictEqual(pl.choose, true);
  assert.strictEqual(pl.drive, null);
  const s = await b.start([p]);
  assert.strictEqual(s.ok, false); assert.match(s.fault, /Two backup drives/);
  const d2 = pl.drives.find(d => d.name === 'Drive 2');
  assert.ok((await b.start([p], d2.id)).ok);
  await waitJob(b);
  assert.strictEqual(b.rowOf(p).last.drive, 'Drive 2');
  // Drive 2 unplugged (its folder gone), Drive 1 still in: asking for Drive 2 plans for Drive 1, and Start refuses.
  fs.renameSync(path.join(tmp, 'usb8'), path.join(tmp, 'usb8-away'));
  try {
    const pl2 = await b.plan([p], d2.id);
    assert.strictEqual(pl2.drive.name, 'Drive 1');
    const s2 = await b.start([p], d2.id);
    assert.strictEqual(s2.ok, false); assert.match(s2.fault, /not plugged in now/);
  } finally { fs.renameSync(path.join(tmp, 'usb8-away'), path.join(tmp, 'usb8')); }
  const later = { ...p, updated: Date.now() + 1000 };
  assert.ok(b.rowOf(later).changed);
  assert.deepStrictEqual(b.needs([later]), [], 'changed, but backed up today: not yet');
  shift = 8 * 864e5; // eight days on, still changed since that backup
  assert.deepStrictEqual(b.needs([later]).map(x => x.kind), ['stale']);
  b.setListed([p.dir], false);
  assert.deepStrictEqual(b.needs([later]), [], 'off the list: never in Needs attention');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
