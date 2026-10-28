// Windows: every call the office makes to Windows itself lives here (and in the .ps1 helpers beside it), so another
// system only needs its own file with the same functions. Nothing here knows about dry runs or demos: the callers
// decide whether to act, and this file only acts.
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PS_DIR = path.join(__dirname, 'windows');
const NAME = 'Windows';
// Windows' own programs, always by their full path. A bare name is looked for in the working folder first (for Open
// terminal that is the project's folder), so a project that ships its own cmd.exe would have it run.
const WINDIR = process.env.SystemRoot || 'C:\\Windows';
const SYS = name => path.join(WINDIR, 'System32', name);
const CMD = SYS('cmd.exe');
const POWERSHELL = SYS(path.join('WindowsPowerShell', 'v1.0', 'powershell.exe'));

// Runs one of the .ps1 helpers with fixed arguments and returns what it printed. STA: the folder dialog needs it.
function powershell(script, args, { sta = false } = {}) {
  return new Promise(resolve => {
    const ps = spawn(POWERSHELL, ['-NoProfile', ...(sta ? ['-STA'] : []), '-ExecutionPolicy', 'Bypass', '-File', path.join(PS_DIR, script), ...args], { windowsHide: true });
    let out = '', err = '';
    ps.stdout.setEncoding('utf8'); ps.stderr.setEncoding('utf8');
    ps.stdout.on('data', d => { out += d; });
    ps.stderr.on('data', d => { err += d; });
    ps.on('error', e => resolve({ code: -1, out, err, spawnError: e }));
    ps.on('close', code => resolve({ code, out, err }));
  });
}
const firstLine = s => (s || '').trim().split(/\r?\n/)[0];
const detached = (exe, args, opts = {}) => spawn(exe, args, { detached: true, stdio: 'ignore', ...opts }).unref();

// The default browser.
function openUrl(url) { detached(SYS('rundll32.exe'), ['url.dll,FileProtocolHandler', url]); }

// Microsoft Edge ships with every Windows 11: the office's own window (app mode) and the site pictures use it.
function findBrowser() {
  const c = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean).map(b => path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  return c.find(p => fs.existsSync(p)) || null;
}

// The Windows 11 "Select folder" dialog. The title comes from the caller's fixed list.
async function pickFolder(title) {
  const r = await powershell('pick-folder.ps1', ['-Title', title], { sta: true });
  if (r.spawnError) return { error: 'The folder window could not be opened (' + r.spawnError.message + '). Type the folder path instead.' };
  const p = r.out.trim();
  if (p) return { path: p };
  if (r.code !== 0) return { error: 'The folder window could not be opened' + (r.err ? ': ' + firstLine(r.err) : '') + '. Type the folder path instead.' };
  return { cancelled: true };
}

function onPath(name) {
  try { return execFileSync(SYS('where.exe'), [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim() || null; }
  catch { return null; }
}

// A plain terminal in the folder. The folder is passed to `wt` as one argument, and to the cmd fallback only as the
// child's working directory (cwd) — never inside the command line, so a folder name with cmd metacharacters
// (& ^ ( ) which Windows allows) cannot break out into another command. `start ""` gives the window an empty title.
function terminalCommand(dir) { return (onPath('wt') && !dir.includes(';') ? 'wt' : 'start') + ' cmd.exe /k (in ' + dir + ')'; }
function openTerminal(dir) {
  const { exe, args, opts } = terminalLaunch(dir);
  detached(exe, args, opts);
}
// What Open terminal starts: every program by its full path (wt where Windows found it, cmd.exe from System32).
function terminalLaunch(dir) {
  // wt reads ";" as "start another command" anywhere in its command line: a folder with one opens the cmd way.
  const wt = !dir.includes(';') && onPath('wt');
  if (wt) return { exe: wt, args: ['-d', dir, CMD, '/k'], opts: {} };
  return { exe: CMD, args: ['/c', 'start', '', CMD, '/k'], opts: { cwd: dir } };
}

const EXPLORER = path.join(WINDIR, 'explorer.exe');
function openFolder(dir) { detached(EXPLORER, [dir]); }
function revealFile(file) { detached(EXPLORER, ['/select,', file]); }

// Desktop shortcut / Start with Windows. folder: tests only, instead of the real Desktop or Startup folder.
const SHORTCUT_PLACES = { desktop: 'Desktop', startup: 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup' };
async function shortcut(where, action, folder) {
  const args = ['-Where', where, '-Action', action];
  if (folder) { fs.mkdirSync(folder, { recursive: true }); args.push('-Folder', folder); }
  const r = await powershell('shortcut.ps1', args);
  if (r.spawnError) return { where, error: r.spawnError.message };
  try { return JSON.parse(r.out.trim()); } catch { return { where, error: firstLine(r.err) || 'no answer' }; }
}

// The ai-head-office://start link (index.html's Start office button), for this Windows user only: no admin needed.
// It runs   "<node.exe>" "<folder>\lib\platform\windows\link-start.js" "%1"   : node.exe gets the address as one
// argument and link-start.js never reads it. The node.exe is the one running now; every start registers the link
// again, so it follows Node.
// AHO_LINK_KEY: tests use a throwaway key instead of the real one.
const LINK_KEY = process.env.AHO_LINK_KEY || 'HKCU\\Software\\Classes\\ai-head-office';
function reg(args) {
  try { return { ok: true, out: execFileSync(SYS('reg.exe'), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }) }; }
  catch (e) { return { ok: false, err: firstLine(String(e.stderr || e.message)) }; }
}
function linkCommand(appDir) { return '"' + process.execPath + '" "' + path.join(appDir, 'lib', 'platform', 'windows', 'link-start.js') + '" "%1"'; }
function link(action, appDir) {
  if (action === 'create') {
    const steps = [
      ['add', LINK_KEY, '/ve', '/d', 'URL:AI Head Office Overview', '/f'],
      ['add', LINK_KEY, '/v', 'URL Protocol', '/d', '', '/f'],
      ['add', LINK_KEY + '\\DefaultIcon', '/ve', '/d', '"' + path.join(appDir, 'office', 'public', 'app.ico') + '"', '/f'],
      ['add', LINK_KEY + '\\shell\\open\\command', '/ve', '/d', linkCommand(appDir), '/f'],
    ];
    for (const a of steps) { const r = reg(a); if (!r.ok) return { where: 'link', error: 'Windows refused the change (' + r.err + ')' }; }
  } else if (action === 'remove') {
    reg(['delete', LINK_KEY, '/f']); // already gone is fine
  }
  const q = reg(['query', LINK_KEY + '\\shell\\open\\command', '/ve']);
  const m = q.ok && /REG_SZ\s+(.*)$/m.exec(q.out);
  const cmd = m ? m[1].trim() : '';
  return { where: 'link', exists: !!cmd, here: !!cmd && cmd.toLowerCase() === linkCommand(appDir).toLowerCase() };
}

// Which program listens on each port: [{ port, pid, name, cmd, parent }].
async function portOwners(ports) {
  if (!ports.length) return [];
  const r = await powershell('port-owner.ps1', ['-Ports', ports.join(',')]);
  let list = [];
  try { list = JSON.parse(r.out.trim() || '[]'); } catch {}
  return Array.isArray(list) ? list : [list];
}
// Every drive with a letter (backups): [{ letter, serial, label, type, bus, fs, size, free }].
async function drives() {
  const r = await powershell('drive-info.ps1', []);
  let list = [];
  try { list = JSON.parse(r.out.trim() || '[]'); } catch {}
  return (Array.isArray(list) ? list : [list]).filter(d => d && /^[A-Z]$/i.test(d.letter || ''));
}
// Windows' own processes and the office's window are never offered for stopping.
const PROTECTED_NAMES = /^(system|idle|svchost|lsass|wininit|winlogon|services|csrss|smss|spoolsv|explorer|dwm|fontdrvhost|msedge|msedgewebview2)\.exe$/i;
function systemProcessWhy(o) {
  if (!o.pid || o.pid <= 4) return 'it is part of Windows';
  if (PROTECTED_NAMES.test(o.name || '')) return (o.name || 'it') + ' is part of Windows or the office window';
  return null;
}
// What spawn() can start with no shell. A .cmd/.bat (npm, npx, yarn, pnpm and the like) cannot be started that way on
// Windows (EINVAL / ENOENT). npm and npx become node + their own script beside node.exe; any other script runs through
// cmd.exe, but only with plain arguments (nothing cmd would read as a command: & | < > ^ % ! " ( ) ).
const NPM_CLI = { npm: 'npm-cli.js', npx: 'npx-cli.js' };
// cwd: the folder it runs in, where a bare "serve.cmd" is looked for first (as cmd.exe would).
/** The file a start command really runs, as Windows picks it: for a bare name, a program or script of that name in
 * the project's own folder first (local: true), then the one on PATH. Shown in the Run prompt and fingerprinted. */
function resolveProgram(exe, cwd) {
  if (/[\\/]/.test(exe)) { const full = path.resolve(cwd || '.', exe); return { full, local: !!cwd && full.toLowerCase().startsWith(path.resolve(cwd).toLowerCase() + path.sep) }; }
  const local = cwd && ['', '.exe', '.com', '.cmd', '.bat'].map(x => path.join(cwd, exe + x)).find(f => /\.(exe|com|cmd|bat)$/i.test(f) && fs.existsSync(f));
  if (local) return { full: local, local: true };
  return { full: onPath(exe) || exe, local: false };
}
function runnable(exe, args, cwd) {
  let full = exe;
  // A bare program name with a program of that name in the project's folder: that one, named in full (it is the one
  // the Run prompt showed), rather than leaving the choice to the process launcher.
  const own = cwd && !/[\\/]/.test(exe) && ['', '.exe', '.com'].map(x => path.join(cwd, exe + x)).find(f => /\.(exe|com)$/i.test(f) && fs.existsSync(f));
  if (own) return { exe: own, args };
  const here = cwd && !/[\\/]/.test(exe) && ['', '.cmd', '.bat'].map(x => path.join(cwd, exe + x)).find(f => /\.(cmd|bat)$/i.test(f) && fs.existsSync(f));
  if (here) full = here;
  else if (!/[\\/]/.test(exe)) {
    if (/\.exe$/i.test(exe)) return { exe, args };
    full = onPath(exe);
    if (!full) return { exe, args }; // spawn reports it as not found
    // where.exe lists the extension-less shell script first for npm/npx; the .cmd beside it is the one Windows runs
    if (!/\.(cmd|bat|exe|com)$/i.test(full)) { const cmd = full + '.cmd'; full = fs.existsSync(cmd) ? cmd : full; }
  }
  if (!/\.(cmd|bat)$/i.test(full)) return { exe: full, args };
  const base = path.basename(full).replace(/\.(cmd|bat)$/i, '').toLowerCase();
  if (NPM_CLI[base]) {
    const node = path.join(path.dirname(full), 'node.exe');
    const cli = path.join(path.dirname(full), 'node_modules', 'npm', 'bin', NPM_CLI[base]);
    if (fs.existsSync(cli)) return { exe: fs.existsSync(node) ? node : process.execPath, args: [cli, ...args] };
  }
  const bad = args.find(a => /[&|<>^%!"()\r\n]/.test(a));
  if (bad !== undefined) return { error: 'it is a Windows script (' + path.basename(full) + '), and the argument "' + bad.slice(0, 40) + '" has a character the Windows command line would treat as a command.' };
  // The script's own path is always quoted (a folder named "R&D" stays one path); cmd.exe still reads % (and ! with
  // delayed expansion) inside quotes, and a " would end the quoting, so a path holding one is refused.
  if (/[%!"\r\n]/.test(full)) return { error: 'it is a Windows script (' + path.basename(full) + ') in a folder whose path has a %, ! or " in it, which the Windows command line would read as a command. Rename the folder.' };
  const q = a => (/[\s]/.test(a) || a === '' ? '"' + a + '"' : a);
  return { exe: CMD, args: ['/d', '/s', '/c', '"' + ['"' + full + '"', ...args.map(q)].join(' ') + '"'], windowsVerbatimArguments: true };
}
// Settings › Update on a PC with no Git: winget (Windows' own installer) installs it in a window of its own, which the
// person watches and answers (winget asks before it changes anything, and Windows may ask for an administrator's yes).
// The window stays open (/k) so its last words can be read. Fixed text only; both programs by their full path.
const INSTALL_GIT = 'install --id Git.Git -e --source winget';
function installGitCommand(winget) { return 'winget ' + INSTALL_GIT + ' (in a new window' + (winget ? '' : '; winget not found') + ')'; }
function installGit() {
  const winget = onPath('winget');
  if (!winget) return { ok: false, fault: 'Windows\' own installer (winget) is not on this PC.', reason: 'It comes with App Installer, from the Microsoft Store.', wayOut: 'Download Git from git-scm.com and install it (the default options are fine), then press Check again.' };
  detached(CMD, ['/d', '/c', 'start', '"Install Git"', CMD, '/d', '/k', '""' + winget + '" ' + INSTALL_GIT + '"'], { windowsVerbatimArguments: true, cwd: WINDIR });
  return { ok: true };
}

function killCommand(pid, name) { return 'taskkill /PID ' + pid + ' /T /F (' + name + ')'; }
function killTree(pid) {
  try { execFileSync(SYS('taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
}

module.exports = {
  NAME, openUrl, findBrowser, pickFolder, onPath, terminalCommand, openTerminal, terminalLaunch, openFolder, revealFile,
  SHORTCUT_PLACES, shortcut, link, portOwners, drives, systemProcessWhy, killCommand, killTree, runnable, resolveProgram,
  installGit, installGitCommand,
};
