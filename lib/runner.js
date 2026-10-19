// Local copies: starting a project's own start command, stopping it, and the programs the office did NOT start that
// hold a project's port. Commands come only from the project's files (launch.json / project.json), never the page.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const cfg = require('./config');
const os = require('./platform');
const { state, refreshProjects, ownPortUser, commandPorts, projectName, saveSettings } = require('./state');
const { portBusy, busyPorts, waitForPort, localUrl } = require('./ports');
const { openBrowser } = require('./desktop');

const START_WAIT = 60000;

function readTail(file) {
  try { return fs.readFileSync(file, 'utf8').trim().slice(-400); } catch { return ''; }
}

// ---- Re-allocate: another program holds a project's start port, so it starts on a clean port instead ----
// Moves are kept (settings.portMoves, by project and command), so the same new port is used again while the old one
// stays taken: moves stay rare, and a project's address does not keep changing. The start port is always tried first.
const moveKey = (p, entry) => p.id + '|' + entry.key;
/** The command with its port changed: an argument that is the old port (5300), a port option (--port=5300) or an
 * address ending in it (localhost:5300) gets the new one, never a file name that happens to hold the digits; PORT is
 * set too (many dev servers read it) for a command that does not name its port. */
function onPort(cmd, from, to) {
  const re = new RegExp('^((?:--?[A-Za-z-]*port[A-Za-z-]*=)|(?:.*:))?' + from + '$', 'i');
  let named = false;
  const args = (cmd.args || []).map(a => String(a).replace(re, (m, pre) => { named = true; return (pre || '') + to; }));
  // The start file's own env (BROWSER=none, a data folder...) is kept; only PORT changes.
  return { ...cmd, port: to, args, env: { ...(cmd.env || {}), PORT: String(to) }, moved: { from, named } };
}
/** A clean port above `from`: free now, and not the start port of any project on the list or a copy the office runs. */
async function cleanPort(from) {
  const taken = new Set(state.projects.flatMap(x => commandPorts(x).map(c => c.port)));
  for (const r of state.running.values()) taken.add(r.port);
  for (let port = from + 1; port < from + 200 && port <= 65535; port++) {
    if (!taken.has(port) && !(await portBusy(port))) return port;
  }
  return null;
}

/** A start command's fingerprint: its program, arguments, folder, settings and the file it comes from (and the project).
 * Run asks the person once per fingerprint; a command that changes (a pull, an edit) asks again. */
function runFingerprint(p, entry) {
  const what = [p.dir.toLowerCase(), entry.exe, entry.args || [], entry.cwd || '', entry.from || '', entry.env || null,
    (entry.alts || []).map(a => [a.exe || null, a.args || null, a.cwd || null, a.port, a.env || null]), whatRuns(p, entry)];
  return crypto.createHash('sha1').update(JSON.stringify(what)).digest('hex');
}
const sha = file => { try { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'); } catch { return ''; } };
/** What the command really starts: the program file Windows picks (one inside the project's own folder first, and then
 * its contents count too, so an edit asks again), and for npm / yarn / pnpm the package.json script it runs. */
function whatRuns(p, entry) {
  const cwd = entry.cwd || p.dir;
  const prog = os.resolveProgram(entry.exe, cwd);
  const out = { program: prog.full, local: prog.local, programHash: prog.local ? sha(prog.full) : '' };
  const tool = path.basename(String(entry.exe)).replace(/\.(cmd|bat|exe)$/i, '').toLowerCase();
  if (['npm', 'yarn', 'pnpm'].includes(tool)) {
    const args = (entry.args || []).map(String);
    const name = args[0] === 'run' || args[0] === 'run-script' ? args[1] : args[0];
    let scripts = {};
    try { scripts = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts || {}; } catch {}
    if (name && typeof scripts[name] === 'string') out.script = { name, text: scripts[name].slice(0, 400) };
  }
  return out;
}
/** Run starts a program from the project's own files, with this Windows user's rights: a folder downloaded from
 * anywhere could hold anything. So the first run of a command (or of a changed one) starts nothing: it answers with the
 * whole command for the page to show, and only a second request carrying that fingerprint (`trust`) runs it and keeps
 * the OK (settings.trustedRuns). The demo asks too (demo/demo.js says yes for the copies it starts itself). */
const ENV_RISKY = /^(PATH|PATHEXT|COMSPEC|NODE_OPTIONS|NODE_PATH|PYTHONPATH|PYTHONSTARTUP|PERL5OPT|RUBYOPT|JAVA_TOOL_OPTIONS)$/i;
function trustCheck(p, entry, trust) {
  const fp = runFingerprint(p, entry);
  const trusted = state.settings.trustedRuns || (state.settings.trustedRuns = []);
  if (trusted.includes(fp)) return null;
  if (trust !== fp) {
    const w = whatRuns(p, entry);
    // The start file's env is part of what runs: a PATH or NODE_OPTIONS there can change the program or what it loads
    // with the command itself unchanged, so every pair is shown and those names are pointed out.
    const env = Object.entries(entry.env || {}).map(([k, v]) => [k, String(v)]);
    const envRisky = env.map(([k]) => k).filter(k => ENV_RISKY.test(k));
    return { ok: true, needsTrust: { fp, name: p.name, exe: w.program, local: w.local, script: w.script || null, args: (entry.args || []).map(String), cwd: entry.cwd || p.dir, env, envRisky, from: entry.from || 'its start file',
      others: (entry.alts || []).filter(a => a.cwd && a.cwd !== (entry.cwd || p.dir)).map(a => a.cwd) } };
  }
  trusted.push(fp);
  if (trusted.length > 500) trusted.shift();
  saveSettings();
  return null;
}

async function startProject(p, key, open = true, move = false, trust = null) {
  const { running } = state;
  if (running.has(p.id)) { const r = running.get(p.id); return r.starting ? { ok: false, error: p.name + ' is already starting.' } : { ok: true, already: true, url: r.url }; }
  const entry = p.commands.find(c => c.key === String(key));
  if (!entry) return { ok: false, error: 'No start command for ' + p.name + '. Nothing in its .claude/launch.json or project.json tells the office how to run it. Add a "start" to project.json (see README), then try again.' };
  if (!entry.port) return { ok: false, error: '"' + entry.name + '" has no port in ' + entry.from + ', so the office cannot check it is free or open it. Add "port" there.' };
  const ask = trustCheck(p, entry, trust);
  if (ask) return ask;
  // The place is taken before the first await, so two clicks in a row cannot both start it.
  running.set(p.id, { starting: true, pid: null, port: entry.port, name: entry.name, started: new Date().toISOString(), url: localUrl(entry) });
  try { return await startChecked(p, entry, open, move); } finally { if (running.get(p.id)?.starting) running.delete(p.id); }
}
async function startChecked(p, entry, open, move) {
  const { running } = state;
  // One entry, or the same app on several ports (merged duplicates): the first free port wins.
  let cmd = null, note = '';
  for (const alt of entry.alts || [entry]) {
    if (!(await portBusy(alt.port))) { cmd = { ...entry, ...alt }; break; }
  }
  if (!cmd) {
    const all = (entry.alts || [entry]).map(a => a.port);
    const mine = all.map(ownPortUser).find(u => u && u.id !== p.id); // not this project's own "starting" place
    if (mine) return { ok: false, error: 'Port ' + mine.port + ' is used by ' + mine.name + ', which the office is running. Both projects start on that port, so stop ' + mine.name + ' first, then run ' + p.name + '.' };
    // Another program holds it: the port this project was moved to before, if it is free, else (asked) a clean one.
    const moves = state.settings.portMoves || (state.settings.portMoves = {});
    const kept = moves[moveKey(p, entry)];
    if (kept && !ownPortUser(kept) && !(await portBusy(kept))) {
      cmd = onPort(entry, entry.port, kept);
      note = 'Port ' + entry.port + ' is still held by another program, so it started on port ' + kept + ', where it was moved before.';
    } else if (move) {
      const to = await cleanPort(entry.port);
      if (!to) return { ok: false, portInUse: all[0], error: 'No clean port was free near ' + entry.port + ', so ' + p.name + ' was not started. Free port ' + entry.port + ' (under More), or close some programs, then try again.' };
      cmd = onPort(entry, entry.port, to);
      moves[moveKey(p, entry)] = to;
      saveSettings();
      note = 'Port ' + entry.port + ' is held by another program, so ' + p.name + ' was re-allocated to port ' + to + ' (kept for next time while ' + entry.port + ' stays taken).';
    } else {
      return { ok: false, portInUse: all[0], url: localUrl(entry), error: (all.length > 1 ? 'Ports ' + all.join(', ') + ' are all in use' : 'Port ' + all[0] + ' is already in use') + ', so ' + p.name + ' was not started. If it is already running, use Open in browser; otherwise Re-allocate starts it on a clean port.' };
    }
  }
  if (cmd.port !== entry.port && !note) note = 'Port ' + entry.port + ' was busy, so it started on ' + cmd.port + '.';
  if (!running.get(p.id)?.starting) return { ok: false, error: p.name + ' was stopped before it started.' }; // Stop clicked during the port check
  const log = path.join(cfg.DATA, 'logs', p.id + '.log');
  // A fresh log each run, opened to append: capLogs can then cut it while the program writes (it carries on at the end).
  fs.writeFileSync(log, '');
  const out = fs.openSync(log, 'a');
  let child;
  // npm, npx, yarn and pnpm are .cmd scripts on Windows, which cannot be started without a shell: the platform turns
  // them into node + the tool's own script, or refuses arguments a shell would read as commands.
  const run = os.runnable(cmd.exe, cmd.args, cmd.cwd || p.dir);
  if (run.error) { fs.closeSync(out); return { ok: false, error: 'Could not start "' + cmd.exe + '": ' + run.error + ' Check the entry in ' + cmd.from + '.' }; }
  try {
    child = spawn(run.exe, run.args, { cwd: cmd.cwd || p.dir, stdio: ['ignore', out, out], windowsHide: true, shell: false, windowsVerbatimArguments: !!run.windowsVerbatimArguments, env: cmd.env ? { ...process.env, ...cmd.env } : undefined });
  } catch (e) {
    fs.closeSync(out);
    return { ok: false, error: 'Could not start "' + cmd.exe + '": ' + e.message + '. Check the path in ' + cmd.from + '.' };
  }
  const url = localUrl(cmd);
  const rec = { child, pid: child.pid, port: cmd.port, name: cmd.name, started: new Date().toISOString(), log, url };
  running.set(p.id, rec);
  let spawnError = null, exited = false;
  // A program that cannot start fires "error" and never "exit", so the log handle is closed in both places.
  child.on('error', e => { spawnError = e; try { fs.closeSync(out); } catch {} });
  child.on('exit', code => { exited = true; rec.exitCode = code; if (running.get(p.id) === rec) running.delete(p.id); try { fs.closeSync(out); } catch {} });
  // Stops waiting as soon as the program fails to start, exits, or is stopped from the page. A React dev server
  // takes about 20 s to open its port on a busy PC, so a program that is still running gets a minute.
  const up = await waitForPort(cmd.port, START_WAIT, () => !!spawnError || exited || running.get(p.id) !== rec);
  if (!up) {
    const tail = readTail(log);
    if (running.get(p.id) !== rec && !exited && !spawnError) return { ok: false, error: p.name + ' was stopped before it answered.', log };
    if (!exited && !spawnError) os.killTree(child.pid);
    running.delete(p.id);
    const why = spawnError ? 'Could not start "' + cmd.exe + '" (' + spawnError.code + '). Check the path in ' + cmd.from + '.'
      : exited ? p.name + ' ended by itself' + (rec.exitCode ? ' with exit code ' + rec.exitCode : '') + ' before anything answered on port ' + cmd.port + '.'
      : p.name + ' started but nothing answered on port ' + cmd.port + ' within ' + START_WAIT / 1000 + ' seconds, so it was stopped.'
        + (cmd.moved && !cmd.moved.named ? ' Its start command does not name its port, so it may not take another one: set the port in ' + cmd.from + ', or Free port ' + cmd.moved.from + ' under More.' : '');
    return { ok: false, error: why + (tail ? ' Last output: ' + tail : ''), log };
  }
  return { ok: true, url, note, ...(open ? openBrowser(url) : {}) };
}

// ---- Log sizes: a local copy's output goes to data/logs/<project>.log, started afresh each run. A copy left running
// for days (or one printing a line a millisecond) is cut back once it passes LOG_MAX, with a note saying so. ----
const LOG_MAX = 5 * 1024 * 1024;
function capLogs(max = LOG_MAX) {
  for (const r of state.running.values()) {
    if (!r.log) continue;
    try {
      if (fs.statSync(r.log).size <= max) continue;
      fs.truncateSync(r.log, 0);
      fs.appendFileSync(r.log, '[' + new Date().toISOString() + '] The office cut this log at ' + Math.round(max / 1048576) + ' MB to keep it small. The newest output follows.\n');
    } catch {}
  }
}
setInterval(capLogs, 30000).unref();

// Stops a local copy the office started. false when it was not running from the office.
function stopProject(id) {
  const r = state.running.get(id);
  if (!r) return false;
  if (r.pid) os.killTree(r.pid); // a copy still starting has no process yet: its start sees the record go and gives up
  state.running.delete(id);
  return true;
}
function stopAllProjects() {
  const stopped = [];
  for (const id of [...state.running.keys()]) { stopProject(id); stopped.push(projectName(id)); }
  return stopped;
}

// Where a running site can be seen: its running copy, or a start port (alternates too) another program holds. A port
// the office is running ANOTHER project on is that project's site, never this one's (two projects can share a port).
async function siteUrlOf(p) {
  const r = state.running.get(p.id);
  if (r) return r.url;
  for (const c of commandPorts(p)) {
    const own = ownPortUser(c.port);
    if (own && own.id !== p.id) continue;
    if (await portBusy(c.port)) return localUrl(c);
  }
  return null;
}

// ---- programs the office did NOT start that hold a project's port (the "Port N in use" state) ----
// Only ports that belong to a project's start command can be looked up or stopped, and never the system's own
// processes, the office, or the window it runs in.
function protectedWhy(o) {
  if (o.pid === process.pid || o.pid === process.ppid) return 'it is the office itself';
  const sys = os.systemProcessWhy(o);
  if (sys) return sys;
  if (/\bserver\.js\b/i.test(o.cmd || '') && String(o.cmd).toLowerCase().includes(path.basename(cfg.HERE).toLowerCase())) return 'it is another copy of AI Head Office Overview';
  return null;
}
// Project start ports that something other than the office is holding, with the project(s) each belongs to.
async function foreignPorts() {
  const projects = refreshProjects();
  const mine = new Set([...state.running.values()].map(r => r.port));
  const byPort = new Map();
  for (const p of projects) for (const c of commandPorts(p)) { // alternate ports too: Free port is offered on them
    if (mine.has(c.port)) continue;
    if (!byPort.has(c.port)) byPort.set(c.port, []);
    if (!byPort.get(c.port).includes(p.name)) byPort.get(c.port).push(p.name);
  }
  const busy = [...(await busyPorts([...byPort.keys()]))];
  const owners = await os.portOwners(busy);
  return owners.map(o => ({ ...o, why: protectedWhy(o), projects: byPort.get(o.port) || [] }));
}
async function stopForeign(o) {
  if (o.why) return { port: o.port, name: o.name, ok: false, error: 'Not stopped: ' + o.why + '.' };
  if (cfg.DRY) return { port: o.port, name: o.name, ok: true, dryRun: os.killCommand(o.pid, o.name) };
  os.killTree(o.pid);
  for (let i = 0; i < 10 && await portBusy(o.port); i++) await new Promise(r => setTimeout(r, 300));
  const still = await portBusy(o.port);
  return { port: o.port, name: o.name, pid: o.pid, ok: !still, error: still ? 'Port ' + o.port + ' is still in use: the system may need a moment, or the program restarted itself.' : undefined };
}

module.exports = {
  runFingerprint, capLogs, startProject, stopProject, stopAllProjects, siteUrlOf, foreignPorts, stopForeign, onPort };
