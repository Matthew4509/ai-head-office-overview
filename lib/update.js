// Settings › About › Update: is there a newer office on GitHub, and taking it in one click. A copy unpacked from the release
// zip (no .git folder) checks from a scratch repository in the temp folder, and its first Update now links it to
// GitHub at the version it already is (its files checked against that signed release), then updates as a git copy. Asks GitHub only when the user
// presses Check for updates (Settings › About); nothing about the user is sent. Updates come from the office's FIXED address
// (lib/release.js, never the folder's own `origin`) and only as a v<version> tag whose message carries a signature
// from the release key for that exact commit and its files, checked with Node (no gpg, no ssh-keygen). The tag is
// fetched into a private ref (refs/aho-update/), so a local tag of the same name never clashes, and dropped again.
// Taking it: refused when files here were changed (never overwritten, reset or stashed) or when this copy has commits
// of its own; the signed files are first opened in a temp folder and started once as a test copy (a dry run on a free
// port over throwaway data), and only then does git move this folder forward to the exact signed commit. The office
// then restarts itself. Go back moves it back to the commit it was on (git reset --keep, which refuses rather than
// lose changes), recorded in data/update/last.json. Git runs with hooks off and the same guard as every other git the
// office runs, so a setting in the folder's git config cannot start a program.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { execFile, spawn } = require('child_process');
const cfg = require('./config');
const release = require('./release');
const { gitConfigProblem } = require('./gitstate');

const REF = v => 'refs/aho-update/v' + v;
// Tests point the fixed address at a bare repository in a temp folder; nothing else sets this.
const url = () => process.env.AHO_RELEASE_GIT || release.GIT_URL;

// Where things are, overridable by the tests (a made-up office in a temp folder).
const where = (o = {}) => ({ app: o.app || cfg.HERE, data: o.data || cfg.DATA, version: o.version || cfg.VERSION, key: o.key == null ? release.RELEASE_KEY : o.key });
const lastFile = w => path.join(w.data, 'update', 'last.json');

// Hooks point at an empty folder, fsmonitor is off, and git never stops to ask for a password.
function noHooks() {
  // A fresh, randomly named empty folder each run (a fixed shared name could be filled by another program first).
  if (!noHooks.dir) { try { noHooks.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-no-hooks-')); } catch { noHooks.dir = path.join(os.tmpdir(), 'aho-no-hooks-none'); } }
  return noHooks.dir;
}
// Git installed while the office runs (Install Git below) is not on the office's PATH until it starts again: Git for
// Windows' own place is tried when a bare "git" is not found.
const gitHome = () => (process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe') : null);
function git(dir, args, timeout = 8000) {
  const run = exe => new Promise(resolve => {
    execFile(exe, ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=' + noHooks(), '-c', 'log.showSignature=false', '-c', 'credential.helper=', '-c', 'protocol.ext.allow=never', '-C', dir, ...args], {
      timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    }, (err, stdout, stderr) => resolve({ ok: !err, missing: err?.code === 'ENOENT', out: String(stdout || '').trimEnd(), err: String(stderr || err?.message || '').trim() }));
  });
  return run(git.exe || 'git').then(r => {
    const home = gitHome();
    if (!r.missing || git.exe || process.env.AHO_NO_GIT_HOME || !home || !fs.existsSync(home)) return r;
    git.exe = home;
    return run(home);
  });
}
const no = (fault, reason, wayOut) => ({ ok: false, fault, reason, wayOut });
// No git on this PC: the page offers Install Git (Windows only), then Check again.
const gitMissing = () => ({ ...no('Git is not installed.', 'Updating needs Git, the free program that fetches the new version from GitHub.', process.platform === 'win32' ? 'Press Install Git (it opens a window and asks before it changes anything), then press Check again.' : 'Install Git, then press Check again.'), installGit: process.platform === 'win32' });
// A copy unpacked from a zip has no .git folder: Check looks from a scratch repository, Update now links it first.
const isZip = dir => !fs.existsSync(path.join(dir, '.git'));
const notReleased = v => ({ ...no('This copy cannot update itself.', `Its version, ${v}, is not a signed release on GitHub, so the office cannot check that its files are the released ones (a "Download ZIP" of GitHub's newest code, perhaps).`, 'Unzip the newest release zip once (see README.md, "Install it"), copy your data folder across, and it updates itself from then on. Or clone it with git.'), notReleased: true });
const firstLine = s => String(s || '').split('\n').find(Boolean)?.slice(0, 200) || '';
const versionIn = text => /const VERSION = '([^']+)'/.exec(text || '')?.[1] || null;
const short = id => String(id || '').slice(0, 7);

/** Can this copy take updates through git? null when it can, else the reason (fault, reason, way out). */
async function whyNot(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return no('This copy cannot update itself.', 'It was not downloaded with git (a zip, perhaps), so it has no link to GitHub.', 'Download the newest zip from GitHub and copy your data folder across, or clone it with git (see README.md).');
  const bad = await gitConfigProblem(dir);
  if (bad) return no('The office did not run git in its own folder.', bad === 'program' ? 'Its git settings name a program (a filter, hook or similar).' : 'Its git settings could not be read safely.', 'Update it by hand (see AGENTS.md, "Update it"), after checking .git/config.');
  return null;
}

// The working folder as it stands: changed tracked files, and where HEAD is. (Never trimmed at the front before
// slice(3): " M file" would lose its first letter.)
async function standing(dir) {
  const [st, head] = await Promise.all([git(dir, ['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=all']), git(dir, ['rev-parse', 'HEAD'])]);
  return { changed: st.ok ? st.out.split('\n').filter(l => l.trim()).map(l => l.slice(3)) : null, head: head.ok ? head.out : null };
}
const listed = files => files.slice(0, 3).join(', ') + (files.length > 3 ? ', …' : '');

// Private refs a check or update left behind (the office stopped half way): dropped before anything new is fetched.
async function dropRefs(dir) {
  const r = await git(dir, ['for-each-ref', '--format=%(refname)', 'refs/aho-update/']);
  for (const ref of r.ok ? r.out.split('\n').filter(Boolean) : []) await git(dir, ['update-ref', '-d', ref]);
}

/** Fetch v<version> into the private ref and check it: a signed tag, for the commit it names and its files. */
async function fetchSigned(w, version) {
  await dropRefs(w.app);
  const f = await git(w.app, ['fetch', '--quiet', '--no-tags', '--no-recurse-submodules', url(), '+refs/tags/v' + version + ':' + REF(version)], 120000);
  if (f.missing) return gitMissing();
  // noTag: GitHub answered, and has no v<version> (the caller says what that means for this copy).
  if (!f.ok) return { ...no('The new version could not be fetched.', firstLine(f.err) || 'No answer from GitHub.', 'Check this PC is online, then press Check again.'), noTag: /couldn't find remote ref|not our ref|no such ref/i.test(f.err) };
  const refuse = async (fault, reason, wayOut) => { await git(w.app, ['update-ref', '-d', REF(version)]); return no(fault, reason, wayOut); };
  const type = await git(w.app, ['cat-file', '-t', REF(version)]);
  if (type.out !== 'tag') return refuse(`Version ${version} was not taken.`, `v${version} on GitHub is a plain tag, not a signed release.`, 'Nothing was changed. Tell the office\'s maker, or update by hand (see AGENTS.md, "Update it").');
  const tag = await git(w.app, ['cat-file', 'tag', REF(version)]);
  const head = tag.out.split('\n\n')[0];
  const commit = /^object ([0-9a-f]{40,64})$/m.exec(head)?.[1];
  if (!commit || !/^type commit$/m.test(head) || !new RegExp('^tag v' + version.replace(/\./g, '\\.') + '$', 'm').test(head)) return refuse(`Version ${version} was not taken.`, `The tag v${version} does not point at a commit of that name.`, 'Nothing was changed. Tell the office\'s maker.');
  const tree = await git(w.app, ['rev-parse', commit + '^{tree}']);
  const c = release.tagCheck(release.tagSigOf(tag.out), version, commit, tree.out, w.key);
  if (c.code === 'newkey') return refuse(`Version ${version} was not taken.`, 'It is signed with a key this office does not know.', 'If the office\'s maker changed keys, update this copy by hand once (see AGENTS.md, "Update it"); Update works again from that version on.');
  if (c.code === 'none') return refuse(`Version ${version} was not taken.`, 'Its tag carries no signature.', 'Nothing was changed. Something is wrong with that release: tell the office\'s maker.');
  if (c.code === 'nokey') return refuse(`Version ${version} was not taken.`, 'This copy carries no release key, so it cannot check any signature.', 'Update it by hand once (see AGENTS.md, "Update it"); a version with the key checks every update after it.');
  if (c.code) return refuse(`Version ${version} was not taken.`, c.why[0].toUpperCase() + c.why.slice(1) + '.', 'Nothing was changed. Tell the office\'s maker.');
  return { ok: true, commit, tree: tree.out, drop: () => git(w.app, ['update-ref', '-d', REF(version)]) };
}

/**
 * Check: the newest v<version> tag at the fixed address, and, when it is newer, its signature, what it brings and
 * whether this copy can simply move forward to it. The fetched tag is dropped again; Update now fetches it once more.
 */
async function check(w = where()) {
  if (isZip(w.app)) return checkZip(w);
  const bad = await whyNot(w.app);
  if (bad) return bad;
  const base = await newest(w.app, w);
  if (!base.ok || !base.newer) return base;
  const s = await fetchSigned(w, base.version);
  if (!s.ok) return s;
  const [st, ch] = await Promise.all([standing(w.app), changes(w.app, 'HEAD', s.commit)]);
  await s.drop();
  return { ...base, signed: true, commit: short(s.commit), at: short(st.head), changed: (st.changed || []).slice(0, 20), ...ch };
}

/** The newest v<version> tag at the fixed address (asked from `dir`, which only has to be a folder git can run in). */
async function newest(dir, w) {
  const r = await git(dir, ['ls-remote', '--tags', '--refs', url()], 30000);
  if (r.missing) return gitMissing();
  if (!r.ok) return no('GitHub could not be asked.', /not found|could not read|authentication|403|401/i.test(r.err) ? 'GitHub would not show the office\'s repository (it may be private for now, or moved).' : firstLine(r.err) || 'No answer.', 'Check this PC is online, then press Check again.');
  const versions = [...r.out.matchAll(/refs\/tags\/v(\d{1,4}\.\d{1,4}\.\d{1,4})$/gm)].map(m => m[1]).sort(release.compareVersions);
  const version = versions[versions.length - 1] || null;
  return { ok: true, mine: w.version, version, newer: release.newer(version, w.version), from: url() === release.GIT_URL ? release.REPO : 'a test repository' };
}

/** What moving from `from` to `to` brings: how many commits, the newest 30, and whether it is a simple move forward. */
async function changes(dir, from, to) {
  const [count, log, ff] = await Promise.all([
    git(dir, ['rev-list', '--count', from + '..' + to]),
    git(dir, ['log', '--format=%h%x09%cs%x09%s', '-n', '30', from + '..' + to]),
    git(dir, ['merge-base', '--is-ancestor', from, to]),
  ]);
  return {
    behind: Number(count.out) || 0, own: !ff.ok,
    commits: log.out ? log.out.split('\n').map(l => { const [id, date, ...t] = l.split('\t'); return { id, date, text: t.join('\t') }; }) : [],
  };
}

// `git status --porcelain` lines split into files that are gone (" D", put back from the release) and files that differ.
function sortStatus(out) {
  const lines = String(out || '').split('\n').filter(l => l.trim());
  return { missing: lines.filter(l => l.slice(0, 2) === ' D').map(l => l.slice(3)), changed: lines.filter(l => l.slice(0, 2) !== ' D').map(l => l.slice(3)) };
}

/**
 * Check, for a copy unpacked from a zip (no .git): the same answer as for a git copy, worked out in a scratch
 * repository in the temp folder, which is deleted again. Its own version's signed release is fetched there too, so
 * the page can say what is new since it and whether any of this copy's files differ from it. Nothing in the office's
 * folder is written: its files are only read, against the scratch repository's index.
 */
async function checkZip(w) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-zipcheck-'));
  try {
    const i = await git(dir, ['init', '--quiet']);
    if (i.missing) return gitMissing();
    if (!i.ok) return no('The office could not look for a newer version.', firstLine(i.err) || 'Git did not start.', 'Press Check again.');
    await git(dir, ['config', 'core.autocrlf', 'false']);
    const base = await newest(dir, w);
    if (!base.ok || !base.newer) return { ...base, zip: true };
    const at = { ...w, app: dir };
    const mine = await fetchSigned(at, w.version);
    if (!mine.ok) return mine.noTag ? notReleased(w.version) : mine;
    const s = await fetchSigned(at, base.version);
    if (!s.ok) return s;
    // The scratch repository set to this copy's release (HEAD and index), the index refreshed against this copy's files
    // (read-tree leaves no file times, so without the refresh every file would look changed). Only the scratch
    // repository is written.
    const hd = await git(dir, ['update-ref', 'HEAD', mine.commit]);
    const rt = hd.ok ? await git(dir, ['read-tree', mine.commit]) : hd;
    if (rt.ok) await git(dir, ['--work-tree=' + w.app, 'update-index', '-q', '--refresh'], 60000);
    const st = rt.ok ? await git(dir, ['--work-tree=' + w.app, 'status', '--porcelain', '--untracked-files=no', '--ignore-submodules=all'], 60000) : rt;
    if (!st.ok) return no('The office could not compare its files with the release.', firstLine(st.err) || 'Git did not say.', 'Press Check again.');
    const ch = await changes(dir, mine.commit, s.commit);
    return { ...base, zip: true, signed: true, commit: short(s.commit), at: short(mine.commit), changed: sortStatus(st.out).changed.slice(0, 20), ...ch };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/**
 * Update now, first step for a copy unpacked from a zip: link it to GitHub. git init here, its own version's signed
 * release fetched and checked, main set to that exact commit with the index to match, and the files compared. Files
 * that differ: refused, and the new .git folder removed again (nothing changed). Files missing: put back from the
 * signed release. After this the copy is an ordinary git copy at the version it already was, and takes updates the
 * same way (and Go back returns to this commit).
 */
async function adopt(w) {
  const dotGit = path.join(w.app, '.git');
  const undo = () => { try { fs.rmSync(dotGit, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} };
  const fail = (fault, reason, wayOut) => { undo(); return no(fault, reason, wayOut); };
  const i = await git(w.app, ['init', '--quiet']);
  if (i.missing) return gitMissing();
  if (!i.ok || !fs.existsSync(dotGit)) return fail('This copy could not be linked to GitHub.', firstLine(i.err) || 'Git could not start a repository in its folder.', 'Nothing was changed. Press Check again.');
  // Files as the release zip has them (Windows scripts CRLF, the rest as committed), whatever this PC's git defaults.
  await git(w.app, ['config', 'core.autocrlf', 'false']);
  const mine = await fetchSigned(w, w.version);
  if (!mine.ok) { undo(); return mine.noTag ? notReleased(w.version) : mine; }
  const steps = [['update-ref', 'refs/heads/main', mine.commit], ['symbolic-ref', 'HEAD', 'refs/heads/main'], ['reset', '--quiet', '--mixed']];
  for (const s of steps) {
    const r = await git(w.app, s, 60000);
    if (!r.ok) return fail('This copy could not be linked to GitHub.', firstLine(r.err) || 'Git refused a step.', 'Nothing was changed. Press Check again.');
  }
  await mine.drop();
  const st = await git(w.app, ['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=all'], 60000);
  if (!st.ok) return fail('This copy could not be linked to GitHub.', firstLine(st.err) || 'Git could not compare its files.', 'Nothing was changed. Press Check again.');
  const { missing, changed } = sortStatus(st.out);
  if (changed.length) return fail(`Files in the office's folder differ from version ${w.version} as released.`, `An update could overwrite them (${listed(changed)}).`, 'Nothing was changed. Keep or undo those changes yourself, or unzip the release again and copy your data folder across.');
  if (missing.length) {
    const r = await git(w.app, ['checkout', '--quiet', '--', ...missing], 60000);
    if (!r.ok) return fail('This copy could not be linked to GitHub.', `Files missing here could not be put back (${listed(missing)}).`, 'Nothing was changed. Unzip the release again and copy your data folder across.');
  }
  return { ok: true, commit: mine.commit, restored: missing.length };
}

// ---- the test start: the new copy started once, as a test copy, before this folder moves ----

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
function ask(port, p, headers = {}, method = 'GET') {
  return new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Host: '127.0.0.1:' + port, 'Content-Type': 'application/json', ...headers }, timeout: 10000 }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', c => { if (b.length < 400000) b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('timeout', () => r.destroy()); r.on('error', () => resolve({ status: 0, body: '' }));
    r.end(method === 'POST' ? '{}' : undefined);
  });
}

/** Starts the copy in `dir` with --dry-run on a free port over a throwaway data folder; '' when it came up as `version`. */
async function selfTest(dir, version, w = where(), ms = 60000) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-selftest-'));
  const data = path.join(tmp, 'data'), root = path.join(tmp, 'root');
  fs.mkdirSync(data); fs.mkdirSync(root);
  // Your settings, so the new version is seen reading them, but nothing that points at your projects or sites: its
  // working folder is an empty one, and it has no projects added one by one, no live addresses and no trusted runs.
  try {
    const s = JSON.parse(fs.readFileSync(path.join(w.data, 'settings.json'), 'utf8'));
    const keep = { ...s, workingFolders: [root], extraProjects: [], liveUrls: {}, trustedRuns: [], hidden: [] };
    fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify(keep));
  } catch {}
  const port = await freePort();
  // None of this run's AHO_ settings (a test's, or a developer's) reach the copy; only the ones it needs. Its AI app
  // settings and app records point at files that do not exist, so it reads none of yours.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^AHO_/i.test(k)));
  Object.assign(env, { AHO_DATA: data, AHO_ROOT: root, AHO_OPEN: '0', AHO_SETTINGS: path.join(tmp, 'no-ai-settings.json'), AHO_APP_SESSIONS: path.join(tmp, 'no-app-sessions') });
  let out = '', ended = false;
  const child = spawn(process.execPath, ['server.js', '--dry-run', '--port=' + port], { cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => { if (out.length < 4000) out += d; });
  child.stderr.on('data', d => { if (out.length < 4000) out += d; });
  child.on('exit', () => { ended = true; });
  child.on('error', () => { ended = true; });
  let why = 'it did not answer within ' + Math.round(ms / 1000) + ' seconds';
  const end = Date.now() + ms;
  try {
    while (Date.now() < end && !ended) {
      await new Promise(r => setTimeout(r, 300));
      const page = await ask(port, '/');
      if (page.status !== 200 || !/name="aho-key"/.test(page.body)) continue;
      const ico = await ask(port, '/app.ico');
      let run = null; try { run = JSON.parse(fs.readFileSync(path.join(data, 'run.json'), 'utf8')); } catch {}
      const stats = run ? await ask(port, '/api/stats', { 'X-AHO-Key': run.key }) : { status: 0 };
      let v = null; try { v = JSON.parse(stats.body).version; } catch {}
      why = ico.status !== 200 ? 'its icon did not load' : v !== version ? 'it says it is ' + (v || 'no version') + ', not ' + version : '';
      if (run) await ask(port, '/api/quit', { 'X-AHO-Key': run.key }, 'POST');
      break;
    }
    if (ended && why.startsWith('it did not answer')) why = 'it stopped as soon as it started' + (out.trim() ? ' (' + out.trim().split(/\r?\n/).pop().slice(0, 200) + ')' : '');
  } finally {
    for (let i = 0; i < 25 && !ended; i++) await new Promise(r => setTimeout(r, 200));
    if (!ended) try { child.kill(); } catch {}
    await new Promise(r => setTimeout(r, 200));
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  return why;
}

/** The signed commit's files, opened in a temp folder (git archive, then Windows' own tar); { dir, staging } or why not. */
async function openCommit(w, commit, version) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-update-'));
  const tarFile = path.join(staging, 'v.tar'), dir = path.join(staging, 'app');
  const gone = why => { fs.rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); return { why }; };
  const a = await git(w.app, ['archive', '--format=tar', '-o', tarFile, commit], 60000);
  if (!a.ok) return gone('its files could not be read out of git (' + firstLine(a.err) + ')');
  fs.mkdirSync(dir);
  const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  if (!await new Promise(r => execFile(TAR, ['-x', '-f', tarFile, '-C', dir], { windowsHide: true }, e => r(!e)))) return gone('its files could not be opened');
  for (const f of ['server.js', 'lib/config.js', 'lib/app.js', 'office/public/index.html', 'office/public/app.ico']) if (!fs.existsSync(path.join(dir, f))) return gone('it is not a whole office (' + f + ' is missing)');
  for (const d of ['data', 'data-demo', 'data-dryrun']) if (fs.existsSync(path.join(dir, d))) return gone('it carries a ' + d + ' folder of its own');
  const v = versionIn(fs.readFileSync(path.join(dir, 'lib', 'config.js'), 'utf8'));
  if (v !== version) return gone('its files say version ' + (v || 'none'));
  return { dir, staging };
}

function record(w, v) {
  try { fs.mkdirSync(path.dirname(lastFile(w)), { recursive: true }); fs.writeFileSync(lastFile(w), JSON.stringify({ ...v, when: new Date().toISOString() }, null, 1) + '\n'); } catch {}
}
function lastResult(w = where()) {
  try { const v = JSON.parse(fs.readFileSync(lastFile(w), 'utf8')); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

/**
 * Update now: v<version> fetched and checked again, this copy checked (no changed files, no commits of its own), the
 * signed files started once as a test copy, then a fast-forward to the exact signed commit. The caller restarts.
 */
async function take(version, w = where()) {
  if (!release.isVersion(version)) return no('That is not a version.', 'The page asked for something that is not a version number.', 'Press Check again.');
  if (!release.newer(version, w.version)) return no('There is nothing to take.', `This copy is ${w.version} already.`, 'Nothing to do.');
  // A copy from a zip is linked to GitHub first (at the version it already is), then updated like any other.
  const linked = isZip(w.app);
  if (linked) { const a = await adopt(w); if (!a.ok) return a; }
  const bad = await whyNot(w.app);
  if (bad) return bad;
  const before = await standing(w.app);
  if (!before.head) return no('Git could not say where this copy is.', 'It has no commit, or git could not read it.', 'Update it by hand (see AGENTS.md, "Update it").');
  if (before.changed?.length) return no('Files in the office\'s folder were changed here.', `An update could overwrite them (${listed(before.changed)}).`, 'Keep or undo those changes yourself, then press Update again. Your data folder is not one of them.');
  const s = await fetchSigned(w, version);
  if (!s.ok) return s;
  const ff = await git(w.app, ['merge-base', '--is-ancestor', before.head, s.commit]);
  if (!ff.ok) { await s.drop(); return no('This copy has its own saved changes.', `It has commits that ${version} does not, so it cannot simply move forward.`, 'Bring it up to date by hand in the office\'s folder (see AGENTS.md, "Update it"), or ask whoever made those changes.'); }
  const o = await openCommit(w, s.commit, version);
  if (o.why) { await s.drop(); return no(`Version ${version} was not taken.`, o.why[0].toUpperCase() + o.why.slice(1) + '.', 'Nothing was changed. Tell the office\'s maker.'); }
  let t;
  try { t = await selfTest(o.dir, version, w); } finally { fs.rmSync(o.staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  if (t) { await s.drop(); return no(`Version ${version} was not installed.`, `Started once as a test copy, ${t}.`, 'Nothing was changed. Press Check again later, or tell the office\'s maker.'); }
  const now = await standing(w.app);
  if (now.head !== before.head || now.changed?.length) { await s.drop(); return no('This copy changed while the update was checked.', 'A commit or an edit landed in the office\'s folder meanwhile.', 'Nothing was taken. Press Check again.'); }
  // --no-overwrite-ignore: a file of yours that git ignores (projects.json, notes) is never replaced by one the release brings.
  const m = await git(w.app, ['merge', '--ff-only', '--no-overwrite-ignore', '--quiet', s.commit], 60000);
  await s.drop();
  if (!m.ok) return no('The update did not go in.', firstLine(m.err) || 'git refused it.', 'Nothing was changed. Press Check again; if it stays, see AGENTS.md, "Update it".');
  record(w, { route: 'git', ok: true, from: w.version, to: version, fromCommit: before.head, toCommit: s.commit });
  return { ok: true, from: short(before.head), to: short(s.commit), version, linked };
}

/** Go back after an update: this folder moved back to the commit it was on, only while nothing changed since. */
async function goBack(w = where()) {
  const last = lastResult(w);
  // Commit ids only: a damaged or edited last.json never hands git an option.
  const isId = id => typeof id === 'string' && /^[0-9a-f]{40,64}$/.test(id);
  if (!last || last.route !== 'git' || !last.ok || last.back || !isId(last.fromCommit) || !isId(last.toCommit)) return no('There is no update to go back from.', 'Go back undoes the last update taken here, and there is none on record.', 'Nothing to do.');
  const bad = await whyNot(w.app);
  if (bad) return bad;
  const s = await standing(w.app);
  if (s.head !== last.toCommit) return no('Going back is up to you now.', 'This copy has moved since the update (a commit or a pull).', `In the office's folder, git log shows where it was before the update (${short(last.fromCommit)}).`);
  if (s.changed?.length) return no('Files in the office\'s folder were changed here.', `Going back could overwrite them (${listed(s.changed)}).`, 'Keep or undo those changes yourself, then press Go back again.');
  const r = await git(w.app, ['reset', '--keep', '--quiet', last.fromCommit], 60000);
  if (!r.ok) return no('Going back did not work.', firstLine(r.err) || 'git refused it.', 'Nothing was changed.');
  record(w, { route: 'git', ok: true, back: true, from: last.to, to: last.from, fromCommit: last.toCommit, toCommit: last.fromCommit });
  return { ok: true, version: last.from };
}

/** What Settings › About › Update shows before asking GitHub: this version, whether it can check signatures, the last update. */
function status(w = where()) {
  const last = lastResult(w);
  return { version: w.version, hasKey: !!w.key, zip: isZip(w.app), last, canGoBack: !!(last && last.route === 'git' && last.ok && !last.back && last.fromCommit && last.toCommit) };
}

/** Starts this office again once it has stopped: a small helper waits for this process to end, then runs the same
 * command (same port and mode) without opening another window, since the page reloads itself in its own. */
function restartAfterExit() {
  const wait = `const pid=+process.argv[1];const go=()=>{try{process.kill(pid,0);setTimeout(go,300)}catch{require('child_process').spawn(process.argv[2],process.argv.slice(3),{detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,AHO_OPEN:'0'}}).unref()}};go()`;
  spawn(process.execPath, ['-e', wait, String(process.pid), process.execPath, ...process.argv.slice(1)], { detached: true, stdio: 'ignore', windowsHide: true, cwd: process.cwd() }).unref();
}

module.exports = { where, check, take, goBack, status, selfTest, lastResult, restartAfterExit, REF, url };
