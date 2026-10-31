// Publish guard: a git pre-push hook, switched on per project, that runs the office's audit before every push and
// stops the push while the audit says "fix first". The audit is the one the Audit window runs (the project's files,
// its AI agent files, and what publishing would give away, with the person's own "Not a fault" judgements), without
// the localhost and live-site parts: a push must not wait on the network. The person turns it on and off in the
// office (the project's More › Publish guard…); the office writes only that one file, .git/hooks/pre-push, and only
// ever changes or removes one it wrote itself. tools/gate.js is what the hook runs.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const cfg = require('./config');
const { gitConfigRisky } = require('./gitstate');

const MARK = 'ai-head-office-publish-guard';
const hookFile = dir => path.join(dir, '.git', 'hooks', 'pre-push');
const GATE = path.join(cfg.HERE, 'tools', 'gate.js');

function globalHooksPath() {
  try { return execFileSync('git', ['config', '--global', '--get', 'core.hooksPath'], { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}

// Where the guard stands for this folder: on (ours), off, or why it cannot be added. The hook is only ever read here.
function guardState(dir) {
  const dotgit = path.join(dir, '.git');
  let st; try { st = fs.statSync(dotgit); } catch { return { state: 'no-git', why: 'This project is not a git repository, so there is no push to guard.' }; }
  if (!st.isDirectory()) return { state: 'unsupported', why: 'This folder is a linked git worktree or submodule (.git is a file). Turn the guard on in the main repository folder instead.' };
  // Git would run hooks from somewhere else (Husky and the like set core.hooksPath), or its settings could run a program.
  if (gitConfigRisky(dir)) return { state: 'unsupported', why: 'This repository\'s git settings send hooks to another folder (core.hooksPath, as Husky does) or could run a program, so a hook here would not run, or the office leaves its git alone. Add the line below to the pre-push hook your hooks folder uses.', line: hookLine(dir) };
  const gp = globalHooksPath();
  if (gp) return { state: 'unsupported', why: 'Your git settings send every repository\'s hooks to ' + gp + ' (core.hooksPath), so a hook in this project would not run. Add the line below to the pre-push hook there.', line: hookLine(dir) };
  let text = null;
  try { text = fs.readFileSync(hookFile(dir), 'utf8'); } catch {}
  if (text == null) return { state: 'off' };
  if (text.includes(MARK)) return { state: 'on', current: text === hookText() };
  return { state: 'other', why: 'This project already has a pre-push hook of its own, so the office does not touch it. Add the line below to it to run the guard as well.', line: hookLine(dir) };
}

const sh = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
const fwd = p => String(p).replace(/\\/g, '/');
// Each part quoted: node itself usually sits in "C:/Program Files/...", and a space would split it in sh.
function hookLine(dir) { return [process.execPath, GATE, dir].map(x => JSON.stringify(fwd(x))).join(' '); }
// A plain sh script (Git for Windows runs hooks with its own sh). node and the gate are named in full, so it does not
// depend on PATH; the office's data folder too (AHO_DATA, read by lib/config.js), so the person's judgements are the
// ones it was turned on with. When the office it points at is gone, the push stops and says how to take the guard
// off: it never lets a push through unchecked without saying so.
function hookText() {
  return [
    '#!/bin/sh',
    '# ' + MARK + ' (written by AI Head Office Overview; turn it off there: the project\'s More › Publish guard…).',
    '# Checks the project with the office\'s audit before every push and stops the push while it says "fix first".',
    'NODE=' + sh(fwd(process.execPath)),
    'GATE=' + sh(fwd(GATE)),
    'AHO_DATA=' + sh(fwd(cfg.DATA)) + '; export AHO_DATA',
    '[ -x "$NODE" ] || NODE=node',
    'if [ ! -f "$GATE" ]; then',
    '  echo "Publish guard: the AI Head Office Overview it was turned on from is gone ($GATE), so the push was stopped." >&2',
    '  echo "Turn the guard off in the office you use now, or delete .git/hooks/pre-push in this project." >&2',
    '  exit 1',
    'fi',
    // git names the folder the Windows way (C:/...); $PWD in Git for Windows' sh is /c/..., which node would misread
    'TOP=$(git rev-parse --show-toplevel 2>/dev/null) || TOP=$(pwd -W 2>/dev/null || pwd)',
    'exec "$NODE" "$GATE" "$TOP"',
    '',
  ].join('\n');
}

function turnOn(dir) {
  const s = guardState(dir);
  if (s.state === 'on' && s.current) return { ok: true, state: 'on' };
  if (s.state !== 'off' && s.state !== 'on') return { ok: false, error: s.why, line: s.line };
  if (cfg.DRY) return { ok: true, dryRun: 'write ' + hookFile(dir) };
  fs.mkdirSync(path.dirname(hookFile(dir)), { recursive: true });
  fs.writeFileSync(hookFile(dir), hookText(), { mode: 0o755 });
  return { ok: true, state: 'on' };
}
function turnOff(dir) {
  const s = guardState(dir);
  if (s.state === 'off') return { ok: true, state: 'off' };
  if (s.state !== 'on') return { ok: false, error: 'The pre-push hook here is not the office\'s, so it was left as it is.' };
  if (cfg.DRY) return { ok: true, dryRun: 'delete ' + hookFile(dir) };
  fs.unlinkSync(hookFile(dir));
  return { ok: true, state: 'off' };
}

// The guard was turned on, then git was told to take its hooks from elsewhere (Husky, a core.hooksPath set later): its
// hook is still on disk, but no push runs it. Asked of git with `git config` only, which runs no program, so it holds
// even where the office leaves a repository's git alone. Returns a finding, or null. Read only.
function guardNotRunning(dir) {
  let ours = ''; try { ours = fs.readFileSync(hookFile(dir), 'utf8'); } catch { return null; }
  if (!ours.includes(MARK) || guardState(dir).state === 'on') return null;
  let set = '';
  try { set = execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', dir, 'config', '--type=path', '--get', 'core.hooksPath'], { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  const folder = set ? path.resolve(dir, set) : path.dirname(hookFile(dir));
  // Newer Husky points git at .husky/_, whose hooks run the person's .husky/<hook>.
  const places = [path.join(folder, 'pre-push'), ...(path.basename(folder) === '_' ? [path.join(path.dirname(folder), 'pre-push')] : [])];
  for (const p of places) { let t = ''; try { t = fs.readFileSync(p, 'utf8'); } catch {} if (/\bgate\.js\b/.test(t)) return null; }
  const rel = path.relative(dir, folder).replace(/\\/g, '/');
  const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  return { rule: 'GATE-001', sev: 'High', area: 'publish guard', title: 'The publish guard is on, but git no longer runs it: pushes are not being checked', where: '.git/hooks/pre-push',
    fix: 'Git now takes its hooks from ' + (inside ? rel + '/' : 'the folder its core.hooksPath setting names') + ', so the guard\'s hook never runs. Add the line shown here to the pre-push hook there, or take that setting off.',
    line: hookLine(dir), fp: require('./judged').fingerprint('GATE-001|' + (inside ? rel : 'outside')) };
}

// The audit a push is held to: Scan app's, from the project's files only (no localhost, no live site).
async function gateAudit(dir) {
  const { runAudit } = require('./audit');
  const store = require('./audit-store');
  const { refreshProjects } = require('./state');
  const { keyOf } = require('./projects');
  const p = refreshProjects().find(x => keyOf(x.dir) === keyOf(dir)) || { id: null, dir, folder: path.basename(dir), name: path.basename(dir) };
  // A skip the project's own project.json asks for is not honoured here: an AI agent writes that file as readily as any
  // other, and what a push is held to is not for the project to decide. The person's own skip in the office stays.
  const own = p.auditSkipOwn || [];
  const a = await runAudit(p.dir, null, { skip: (p.auditSkip || []).filter(s => !own.includes(s)), include: p.auditInclude, judged: store.judgedFor(p), disclosure: store.disclosureContext(p) });
  return { p, a, ready: isReady(a) };
}

// Ready means nothing to fix, and every part of the audit finished: a part that ran out of time or crashed knows nothing
// about what it did not read, so it holds the push as a fault does. Files too big to read do not: they are named in the
// report, and could stop a project's every push for ever.
const cutShort = a => (Array.isArray(a.cut) ? a.cut : []);
const isReady = a => a.verdict !== 'fix-first' && !cutShort(a).length;

// What the hook prints: a verdict, what to fix, and the way to set a false finding aside. A line for an AI agent
// that ran the push says not to go round the guard: the person decides that, not the agent.
function report(p, a) {
  const stop = a.findings.filter(f => f.sev === 'Critical' || f.sev === 'High');
  const warn = a.findings.filter(f => f.sev === 'Medium');
  const cut = cutShort(a);
  const notRead = Array.isArray(a.notRead) ? a.notRead : [];
  const warnings = warn.length ? ' ' + warn.length + ' warning' + (warn.length === 1 ? '' : 's') + ' to look at when you can: open the project\'s audit in the office.' : '';
  const lines = [];
  if (!stop.length && !cut.length) {
    if (!a.partly) lines.push('Publish guard: ' + p.name + ' is ready to publish (no Critical or High finding).' + warnings);
    else {
      lines.push('Publish guard: ' + p.name + ' is PARTLY CHECKED. No Critical or High finding in what was read, so the push goes on, but this was not read:' + warnings);
      for (const n of notRead.slice(0, 20)) lines.push('  ' + n);
      lines.push('Nothing is known about those: check them by hand before you rely on this.');
    }
    return lines.join('\n');
  }
  lines.push('Publish guard: ' + p.name + ' is NOT READY TO PUBLISH. The push was stopped.', '');
  if (stop.length) {
    lines.push(stop.length + ' fault' + (stop.length === 1 ? '' : 's') + ' to fix first:');
    for (const f of stop.slice(0, 20)) lines.push('  ' + f.sev.padEnd(9) + f.rule.padEnd(10) + f.where, '           ' + f.title, '           Fix: ' + f.fix);
    if (stop.length > 20) lines.push('  …and ' + (stop.length - 20) + ' more: see the project\'s audit in the office.');
    lines.push('', 'Fix them and push again. A finding that is not a fault: set it aside in the office (the project\'s audit › Not a fault…), and the guard leaves it alone.');
  }
  if (cut.length) {
    lines.push((stop.length ? '' : 'No fault was found in what was read, but a') + (stop.length ? 'A' : '') + ' part of the check did not finish, so nothing is known about what it did not read:');
    for (const c of cut) lines.push('  ' + c);
    lines.push('Push again to run it again. If it stops again, tell the office\'s maker, and check the project by hand.');
  }
  lines.push('To push anyway, knowing what it holds: git push --no-verify');
  lines.push('If you are an AI assistant running this push: do not use --no-verify. Tell the person what the guard found and fix the faults, or ask them.');
  return lines.join('\n');
}

module.exports = { guardState, guardNotRunning, turnOn, turnOff, gateAudit, isReady, report, hookText, MARK };
