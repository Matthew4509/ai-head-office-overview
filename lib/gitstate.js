// Where each project stands with git, read only: not in git / changes not saved / saved but only on this PC / saved
// but not pushed / backed up. Never writes to a repository: GIT_OPTIONAL_LOCKS=0 stops "git status" refreshing the
// index, and core.fsmonitor is forced off on the command line (a repository's own config can name a program there,
// which "git status" would run: a folder someone downloaded must not get to run anything). Works the same on Linux.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const TTL = 60000;
const cache = new Map();
let gitMissing = false;

// A folder someone downloaded owns its own .git/config, which git fully trusts once the folder is the user's.
// `git status` hashes working files and, where .gitattributes assigns a filter, runs that filter's clean/process
// command; `git log` on a signed commit can run gpg.program; include/hooksPath/sshCommand/pager/editor can each
// name a program. There is no single flag that turns clean/smudge filters off, so the office refuses to run git in
// a folder whose repository config sets any of these, rather than run a program from a folder it only means to read.
// The config is read by git itself (`git config --file … --list`), so both ways of writing a section ([filter "x"]
// and [filter.x]) and every quoting trick are read the way git reads them. Every file git would read for this folder
// is checked: the shared config of a worktree (commondir), config.worktree, and the configs of its submodules.
const RISKY_SECTION = /^(filter|include|includeif|credential|pager)\./;
const RISKY_NAME = /(command|program|editor|pager|askpass|hookspath|fsmonitor|external|textconv|driver|gitproxy|helper|hook|cmd|uploadpack|receivepack)$/;
const FALSEY = /^(|true|false|yes|no|on|off|0|1)$/i; // core.fsmonitor=true is git's own watcher, not a program
function riskyKey(key, value) {
  const k = key.toLowerCase();
  if (RISKY_SECTION.test(k)) return true;
  const name = k.slice(k.lastIndexOf('.') + 1);
  if (!RISKY_NAME.test(name)) return false;
  return !(name === 'fsmonitor' && FALSEY.test(String(value).trim()));
}

// Every config file git would read for the repository in dir: [paths], or null when that cannot be worked out (a
// ".git" file without a gitdir line, a commondir that leads nowhere): the folder is then refused, not trusted.
const MODULE_SKIP = new Set(['objects', 'refs', 'logs', 'hooks', 'info', 'lfs', 'worktrees']);
function configFiles(dir) {
  const dotgit = path.join(dir, '.git');
  let gitdir;
  try {
    if (fs.statSync(dotgit).isDirectory()) gitdir = dotgit;
    else { // ".git" as a file ("gitdir: <path>") can point at a config the folder's author controls: read that one.
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotgit, 'utf8'));
      if (!m) return null;
      gitdir = path.resolve(dir, m[1]);
    }
    if (!fs.statSync(gitdir).isDirectory()) return null;
  } catch { return null; }
  let common = gitdir;
  const cd = path.join(gitdir, 'commondir');
  if (fs.existsSync(cd)) {
    try { common = path.resolve(gitdir, fs.readFileSync(cd, 'utf8').trim()); if (!fs.statSync(common).isDirectory()) return null; } catch { return null; }
  }
  const files = new Set([path.join(common, 'config'), path.join(gitdir, 'config'), path.join(common, 'config.worktree'), path.join(gitdir, 'config.worktree')]);
  // Submodules keep their repositories in modules/<name>/ (names can hold slashes; nested ones in modules/…/modules/).
  let over = false;
  const walk = (d, depth) => {
    if (over) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isFile() && (e.name === 'config' || e.name === 'config.worktree')) files.add(path.join(d, e.name));
      else if (e.isDirectory() && !MODULE_SKIP.has(e.name)) { if (depth >= 12 || files.size > 400) { over = true; return; } walk(path.join(d, e.name), depth + 1); }
    }
  };
  for (const g of new Set([common, gitdir])) walk(path.join(g, 'modules'), 0);
  if (over) return null;
  return [...files].filter(f => fs.existsSync(f));
}

// git's own reading of one config file, with nothing of the folder's in play: run from the temp folder, includes
// off (the default with --file), no prompts. A verdict is kept while the file is unchanged.
const verdicts = new Map();
const CONFIG_ENV = () => ({ ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' });
// Run from the office's own folder: a bare "git" is looked for in the working folder first, and TEMP can hold anything.
const OWN = path.resolve(__dirname, '..');
const CONFIG_ARGS = file => ['config', '--file', file, '--no-includes', '--list', '-z'];
function judgeList(out) {
  for (const entry of String(out).split('\0')) {
    if (!entry) continue;
    const nl = entry.indexOf('\n');
    const key = nl < 0 ? entry : entry.slice(0, nl), value = nl < 0 ? '' : entry.slice(nl + 1);
    if (riskyKey(key, value)) return 'program';
  }
  return null;
}
const stamp = f => { try { const s = fs.statSync(f); return s.mtimeMs + ':' + s.size; } catch { return null; } };
// err.code ENOENT: there is no git on this PC, so nothing can run either. Any other failure (git cannot parse the
// file) is refused: git would fail on it too, and a file the office cannot read is not one it trusts.
const verdictOf = (err, out) => err ? (err.code === 'ENOENT' ? null : 'unreadable') : judgeList(out);
function checkFileSync(file) {
  const s = stamp(file), hit = verdicts.get(file);
  if (s && hit && hit.s === s) return hit.v;
  let v;
  try { v = verdictOf(null, execFileSync('git', CONFIG_ARGS(file), { cwd: OWN, encoding: 'utf8', windowsHide: true, timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], env: CONFIG_ENV() })); }
  catch (e) { v = verdictOf(e); }
  if (s) verdicts.set(file, { s, v });
  return v;
}
function checkFile(file) {
  const s = stamp(file), hit = verdicts.get(file);
  if (s && hit && hit.s === s) return Promise.resolve(hit.v);
  return new Promise(resolve => execFile('git', CONFIG_ARGS(file), { cwd: OWN, encoding: 'utf8', windowsHide: true, timeout: 8000, env: CONFIG_ENV() }, (err, out) => {
    const v = verdictOf(err, out);
    if (s) verdicts.set(file, { s, v });
    resolve(v);
  }));
}

// null when git may be run in dir; otherwise 'program' (a setting names a program) or 'unreadable'.
function gitConfigProblemSync(dir) {
  const files = configFiles(dir);
  if (!files) return 'unreadable';
  for (const f of files) { const v = checkFileSync(f); if (v) return v; }
  return null;
}
async function gitConfigProblem(dir) {
  const files = configFiles(dir);
  if (!files) return 'unreadable';
  for (const f of files) { const v = await checkFile(f); if (v) return v; }
  return null;
}
const gitConfigRisky = dir => !!gitConfigProblemSync(dir);
const REFUSED = {
  program: 'This folder\'s git settings could run a program (a filter, hook or similar), so the office did not read',
  unreadable: 'This folder\'s git settings could not be read safely (a damaged config, or a link to a git folder that is not there), so the office did not read',
};

// Every git the office runs on a project folder goes through here: fsmonitor forced off, no signature checks, no
// index refresh written back, no prompts, and fenced (below). Callers check gitConfigProblem first.
// Git finds the repository itself, but only the folder's own .git, whose settings were read above: never the folder
// itself taken as a bare repository, never a folder above it. Git's own check of who owns the folder still applies.
function fenced(dir) {
  return { args: ['-c', 'safe.bareRepository=explicit'], env: { GIT_CEILING_DIRECTORIES: path.dirname(path.resolve(dir)) } };
}
const SAFE_ARGS = dir => ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', ...fenced(dir).args, '-C', dir];
const SAFE_ENV = dir => ({ ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...fenced(dir).env });
function git(dir, args, big) {
  return new Promise(resolve => {
    execFile('git', [...SAFE_ARGS(dir), ...args], {
      timeout: big ? 20000 : 8000, windowsHide: true, maxBuffer: (big ? 32 : 4) * 1024 * 1024, env: SAFE_ENV(dir),
    }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') gitMissing = true;
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') });
    });
  });
}
// The same, waiting for the answer (for code that cannot wait on a promise). Throws as execFileSync does.
function gitSync(dir, args) {
  return execFileSync('git', [...SAFE_ARGS(dir), ...args], { encoding: 'utf8', windowsHide: true, timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], env: SAFE_ENV(dir) });
}

// Only host and path leave the server: a remote address can carry a user name and token (https://user:token@host/…).
function safeRemote(url) {
  const u = String(url || '').trim();
  const scp = !u.includes('://') && /^[^@\s]+@([^:\s]+):(.+)$/.exec(u); // git@github.com:owner/repo.git
  if (scp) return scp[1] + '/' + scp[2].replace(/\.git$/, '');
  try { const x = new URL(u); return x.host + x.pathname.replace(/\.git$/, ''); } catch { return path.basename(u); }
}

async function read(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return { state: 'none' };
  const bad = await gitConfigProblem(dir);
  if (bad) return { state: 'error', reason: REFUSED[bad] + ' its git state.' };
  const st = await git(dir, ['status', '--porcelain=v2', '--branch', '--ignore-submodules=all']);
  if (!st.ok) {
    if (gitMissing) return { state: 'error', reason: 'git is not installed on this PC.' };
    return { state: 'error', reason: /dubious ownership/.test(st.err) ? 'git refuses this folder: it belongs to another user account.' : 'git could not read this folder: ' + st.err.split('\n')[0].slice(0, 160) };
  }
  const info = { branch: null, upstream: null, ahead: 0, behind: 0, changes: 0, commits: true };
  for (const line of st.out.split('\n')) {
    if (line.startsWith('# branch.head ')) info.branch = line.slice(14);
    else if (line.startsWith('# branch.oid ')) info.commits = line.slice(13) !== '(initial)';
    else if (line.startsWith('# branch.upstream ')) info.upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) { const m = /\+(\d+) -(\d+)/.exec(line); if (m) { info.ahead = +m[1]; info.behind = +m[2]; } }
    else if (line && !line.startsWith('#')) info.changes++;
  }
  const rem = await git(dir, ['config', '--get-regexp', '^remote\\..*\\.url$']);
  const remotes = rem.out.split('\n').filter(Boolean).map(l => { const m = /^remote\.(.+)\.url (.+)$/.exec(l); return m ? { name: m[1], where: safeRemote(m[2]) } : null; }).filter(Boolean);
  const log = info.commits ? await git(dir, ['log', '-1', '--format=%cI']) : { out: '' };
  const out = { state: 'ok', branch: info.branch, changes: info.changes, ahead: info.ahead, behind: info.behind,
    remote: remotes[0] ? remotes[0].where : null, remoteName: remotes[0] ? remotes[0].name : null, lastCommit: log.out.trim() || null, pushed: null };
  if (!info.commits) out.state = 'empty';
  else if (!remotes.length) out.state = 'local';
  else {
    // No upstream set (common after a push from GitHub Desktop): compare with the remote's copy of this branch if
    // this PC has one; none means the branch was never pushed.
    let upstream = info.upstream;
    if (!upstream && info.branch && info.branch !== '(detached)') {
      const ref = remotes[0].name + '/' + info.branch;
      if ((await git(dir, ['rev-parse', '--verify', '--quiet', 'refs/remotes/' + ref])).ok) {
        upstream = ref;
        const ab = await git(dir, ['rev-list', '--left-right', '--count', ref + '...HEAD']);
        const m = /(\d+)\s+(\d+)/.exec(ab.out);
        if (m) { out.behind = +m[1]; out.ahead = +m[2]; }
      }
    }
    out.pushed = !!upstream;
    if (!upstream) out.state = 'unpushed';
    else if (out.ahead) out.state = 'ahead';
  }
  if (out.changes && (out.state === 'ok' || out.state === 'ahead')) out.state = 'changes';
  return out;
}

// One entry per folder, kept for a minute (Refresh passes fresh). The remote copy is as of this PC's last fetch or
// push: nothing here goes to the network.
async function gitState(dir, fresh) {
  const k = dir.toLowerCase();
  const hit = cache.get(k);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await read(dir).catch(e => ({ state: 'error', reason: String(e.message || e) }));
  cache.set(k, { at: Date.now(), value });
  return value;
}

// ---- What changed since the last save, to read before committing: every changed file with its lines, as git diff
// shows them against the last commit (saved-for-commit and not, together). Read only, like the rest of this file:
// --no-ext-diff and --no-textconv keep a repository's own settings from running a diff program. New files not yet in
// git are read straight from the folder (text only, first lines). Big changes are cut, and say so.
const MAX_FILES = 300, MAX_LINES = 1500, MAX_NEW_BYTES = 200 * 1024;
const KIND = { M: 'changed', A: 'new', D: 'deleted', R: 'renamed', C: 'copied', T: 'changed', U: 'conflict', '?': 'new' };
async function changes(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return { ok: false, error: 'This folder is not in git, so there is no last save to compare with.' };
  const bad = await gitConfigProblem(dir);
  if (bad) return { ok: false, error: REFUSED[bad] + ' it.' };
  // A new folder is one entry (git's own default), not every file in it: a folder link that points back up (a
  // junction loop) or a fresh node_modules would otherwise list without end and push the real changes out of view.
  const st = await git(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=all'], true);
  if (!st.ok) return { ok: false, error: gitMissing ? 'git is not installed on this PC.' : 'git could not read this folder: ' + st.err.split('\n')[0].slice(0, 160) };
  const files = [];
  const parts = st.out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2), file = e.slice(3);
    const code = xy === '??' ? '?' : (xy.replace(/[ .]/g, '')[0] || 'M');
    const f = { path: file, kind: KIND[code] || 'changed', untracked: code === '?', added: 0, removed: 0, lines: [] };
    if (code === 'R' || code === 'C') f.from = parts[++i];
    files.push(f);
  }
  // Changes to files git already holds come first; new files and folders after them.
  files.sort((a, b) => a.untracked - b.untracked);
  for (const f of files) if (f.untracked && f.path.endsWith('/')) { f.kind = 'new'; f.folder = true; f.note = 'A new folder, not in git yet: its files are not listed one by one here.'; }
  const shown = files.slice(0, MAX_FILES);
  const head = (await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])).ok;
  // Against the last commit; before the first commit, what is staged is all there is to compare.
  const d = await git(dir, ['-c', 'core.quotePath=false', 'diff', ...(head ? ['HEAD'] : ['--cached']), '--no-color', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '-M', '--unified=3'], true);
  if (!d.ok) return { ok: false, error: /maxBuffer/i.test(d.err) ? 'The changes are too big to show here (over 32 MB). Use a git program to read them.' : 'git could not compare this folder: ' + d.err.split('\n')[0].slice(0, 160) };
  const byPath = new Map(shown.map(f => [f.path, f]));
  for (const chunk of d.out.split(/^diff --git /m).slice(1)) {
    const lines = chunk.split('\n');
    const plus = lines.find(l => l.startsWith('+++ '));
    const minus = lines.find(l => l.startsWith('--- '));
    const name = plus && plus !== '+++ /dev/null' ? plus.slice(6) : minus ? minus.slice(6) : (/ b\/(.+)$/.exec(lines[0]) || [])[1];
    const f = byPath.get(name) || [...byPath.values()].find(x => lines[0].endsWith(' b/' + x.path));
    if (!f) continue;
    const at = lines.findIndex(l => l.startsWith('@@') || l.startsWith('Binary files'));
    const body = at < 0 ? [] : lines.slice(at).filter((l, i, a) => !(i === a.length - 1 && l === ''));
    for (const l of body) { if (l[0] === '+') f.added++; else if (l[0] === '-') f.removed++; }
    if (body.some(l => l.startsWith('Binary files'))) f.binary = true;
    f.lines = body.slice(0, MAX_LINES);
    if (body.length > MAX_LINES) f.cut = body.length - MAX_LINES;
  }
  for (const f of shown) {
    if (f.kind !== 'new' || f.folder || f.lines.length || f.binary) continue;
    try {
      const abs = path.join(dir, f.path);
      const size = fs.statSync(abs).size;
      if (size > MAX_NEW_BYTES) { f.note = 'A new file of ' + Math.round(size / 1024) + ' KB: too big to show here.'; continue; }
      const buf = fs.readFileSync(abs);
      if (buf.includes(0)) { f.binary = true; continue; }
      const text = buf.toString('utf8').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
      f.added = text.length;
      f.lines = text.slice(0, MAX_LINES).map(l => '+' + l);
      if (text.length > MAX_LINES) f.cut = text.length - MAX_LINES;
    } catch { f.note = 'Could not be read.'; }
  }
  return { ok: true, files: shown, more: files.length - shown.length, against: head ? 'last save' : 'nothing saved yet' };
}

module.exports = { gitState, changes, safeRemote, gitConfigRisky, gitConfigProblem, gitSync, fenced, isMissing: () => gitMissing };
