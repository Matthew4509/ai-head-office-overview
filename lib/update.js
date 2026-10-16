// Settings › Update: is there a newer office on GitHub, and taking it in one click. Asks GitHub only when the user
// opens the tab or presses Check (one `git fetch` of the office's own repository); nothing about the user is sent.
// Taking it is a fast-forward of this folder to the branch it was cloned from: refused when files here were changed
// or saved here (never overwritten, reset or stashed), and run with hooks off and the same guard as every other git
// the office runs, so a setting in the folder's git config cannot start a program. The office then restarts itself.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { gitConfigProblem, safeRemote } = require('./gitstate');

// Hooks point at an empty folder, fsmonitor is off, and git never stops to ask for a password.
function noHooks() {
  const d = path.join(os.tmpdir(), 'aho-no-hooks');
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* git then finds no hooks there either */ }
  return d;
}
function git(dir, args, timeout = 8000) {
  return new Promise(resolve => {
    execFile('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=' + noHooks(), '-c', 'log.showSignature=false', '-C', dir, ...args], {
      timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    }, (err, stdout, stderr) => resolve({ ok: !err, missing: err?.code === 'ENOENT', out: String(stdout || '').trimEnd(), err: String(stderr || err?.message || '').trim() }));
  });
}
const no = (fault, reason, wayOut) => ({ ok: false, fault, reason, wayOut });
const firstLine = s => String(s || '').split('\n').find(Boolean)?.slice(0, 200) || '';
const versionIn = text => /const VERSION = '([^']+)'/.exec(text || '')?.[1] || null;

/** Where this folder stands against the branch it came from, after asking GitHub (fetch: false skips the asking). */
async function check(dir, { fetch = true } = {}) {
  if (!fs.existsSync(path.join(dir, '.git'))) return no('This copy cannot update itself.', 'It was not downloaded with git (a zip, perhaps), so it has no link to GitHub.', 'Download the newest zip from GitHub and copy your data folder across, or clone it with git (see README.md).');
  const bad = await gitConfigProblem(dir);
  if (bad) return no('The office did not run git in its own folder.', bad === 'program' ? 'Its git settings name a program (a filter, hook or similar).' : 'Its git settings could not be read safely.', 'Update it by hand: git pull --ff-only in the office\'s folder, after checking .git/config.');
  const branch = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch.missing) return no('Git is not installed.', 'Updating needs git to ask GitHub for the newest version.', 'Install it (winget install --id Git.Git -e), then press Check again.');
  if (!branch.ok || branch.out === 'HEAD') return no('This copy is not on a branch.', 'It is checked out at one saved point, so there is nothing to bring it up to.', 'In the office\'s folder: git switch main, then press Check again.');
  const remote = await git(dir, ['remote', 'get-url', 'origin']);
  if (!remote.ok) return no('This copy has no GitHub address.', 'Its git has no remote called origin.', 'Add it: git remote add origin https://github.com/Matthew4509/ai-head-office-overview.git');
  if (fetch) {
    const f = await git(dir, ['fetch', '--quiet', '--no-tags', 'origin', branch.out], 60000);
    if (!f.ok) return no('GitHub could not be asked.', firstLine(f.err) || 'No answer.', 'Check this PC is online, then press Check again.');
  }
  const up = 'origin/' + branch.out;
  const [behind, ahead, log, changed, here, there] = await Promise.all([
    git(dir, ['rev-list', '--count', 'HEAD..' + up]),
    git(dir, ['rev-list', '--count', up + '..HEAD']),
    git(dir, ['log', '--format=%h%x09%cs%x09%s', '-n', '30', 'HEAD..' + up]),
    git(dir, ['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=all']),
    git(dir, ['rev-parse', '--short', 'HEAD']),
    git(dir, ['show', up + ':lib/config.js']),
  ]);
  if (!behind.ok) return no('The newest version could not be compared.', firstLine(behind.err), 'Press Check again; if it stays, run git fetch in the office\'s folder to see why.');
  return {
    ok: true, branch: branch.out, remote: safeRemote(remote.out), at: here.out,
    behind: Number(behind.out) || 0, ahead: Number(ahead.out) || 0,
    changed: changed.out ? changed.out.split('\n').map(l => l.slice(3)).slice(0, 20) : [],
    newVersion: versionIn(there.out),
    commits: log.out ? log.out.split('\n').map(l => { const [id, date, ...s] = l.split('\t'); return { id, date, text: s.join('\t') }; }) : [],
  };
}

/** Takes the newer version: a fast-forward only, after the same checks (without asking GitHub again). */
async function pull(dir) {
  const c = await check(dir, { fetch: false });
  if (!c.ok) return c;
  if (!c.behind) return no('There is nothing to take.', 'This copy is already the newest version.', 'Nothing to do.');
  if (c.changed.length) return no('Files in the office\'s folder were changed here.', `An update could overwrite them (${c.changed.slice(0, 3).join(', ')}${c.changed.length > 3 ? ', …' : ''}).`, 'Keep or undo those changes yourself, then press Update again. Your data folder is not one of them.');
  if (c.ahead) return no('This copy has its own saved changes.', `It has ${c.ahead} saved change${c.ahead === 1 ? '' : 's'} that GitHub does not, so it cannot simply move forward.`, 'Bring it up to date by hand in the office\'s folder (git pull), or ask whoever made those changes.');
  const m = await git(dir, ['merge', '--ff-only', '--quiet', 'origin/' + c.branch], 60000);
  if (!m.ok) return no('The update did not go in.', firstLine(m.err) || 'git refused it.', 'Nothing was changed. Run git pull --ff-only in the office\'s folder to see why.');
  const now = await git(dir, ['rev-parse', '--short', 'HEAD']);
  return { ok: true, from: c.at, to: now.out, took: c.behind, newVersion: c.newVersion };
}

/** Starts this office again once it has stopped: a small helper waits for this process to end, then runs the same
 * command (same port and mode) without opening another window, since the page reloads itself in its own. */
function restartAfterExit() {
  const wait = `const pid=+process.argv[1];const go=()=>{try{process.kill(pid,0);setTimeout(go,300)}catch{require('child_process').spawn(process.argv[2],process.argv.slice(3),{detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,AHO_OPEN:'0'}}).unref()}};go()`;
  spawn(process.execPath, ['-e', wait, String(process.pid), process.execPath, ...process.argv.slice(1)], { detached: true, stdio: 'ignore', windowsHide: true, cwd: process.cwd() }).unref();
}

module.exports = { check, pull, restartAfterExit };
