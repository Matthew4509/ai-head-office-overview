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

// The audit a push is held to: the Audit window's, from the project's files only (no localhost, no live site).
async function gateAudit(dir) {
  const { runAudit } = require('./audit');
  const store = require('./audit-store');
  const { refreshProjects } = require('./state');
  const { keyOf } = require('./projects');
  const p = refreshProjects().find(x => keyOf(x.dir) === keyOf(dir)) || { id: null, dir, folder: path.basename(dir), name: path.basename(dir) };
  const a = await runAudit(p.dir, null, { skip: p.auditSkip, skipOwn: p.auditSkipOwn, include: p.auditInclude, judged: store.judgedFor(p), disclosure: store.disclosureContext(p) });
  return { p, a, ready: a.verdict !== 'fix-first' };
}

// What the hook prints: a verdict, what to fix, and the way to set a false finding aside. A line for an AI agent
// that ran the push says not to go round the guard: the person decides that, not the agent.
function report(p, a) {
  const stop = a.findings.filter(f => f.sev === 'Critical' || f.sev === 'High');
  const warn = a.findings.filter(f => f.sev === 'Medium');
  const lines = [];
  if (!stop.length) {
    lines.push('Publish guard: ' + p.name + ' is ready to publish (no Critical or High finding).' + (warn.length ? ' ' + warn.length + ' warning' + (warn.length === 1 ? '' : 's') + ' to look at when you can: open the project\'s audit in the office.' : ''));
    return lines.join('\n');
  }
  lines.push('Publish guard: ' + p.name + ' is NOT READY TO PUBLISH. The push was stopped.', '');
  lines.push(stop.length + ' fault' + (stop.length === 1 ? '' : 's') + ' to fix first:');
  for (const f of stop.slice(0, 20)) lines.push('  ' + f.sev.padEnd(9) + f.rule.padEnd(10) + f.where, '           ' + f.title, '           Fix: ' + f.fix);
  if (stop.length > 20) lines.push('  …and ' + (stop.length - 20) + ' more: see the project\'s audit in the office.');
  lines.push('', 'Fix them and push again. A finding that is not a fault: set it aside in the office (the project\'s Audit › Not a fault…), and the guard leaves it alone.');
  lines.push('To push anyway, knowing what it holds: git push --no-verify');
  lines.push('If you are an AI assistant running this push: do not use --no-verify. Tell the person what the guard found and fix the faults, or ask them.');
  return lines.join('\n');
}

module.exports = { guardState, turnOn, turnOff, gateAudit, report, hookText, MARK };
