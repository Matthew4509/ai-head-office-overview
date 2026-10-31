// The publish guard (lib/gate.js, tools/gate.js): turned on and off per project, never touching a hook it did not
// write, refused (with the line to add by hand) where git would not run it, and a real git push through the hook:
// stopped while the audit says "fix first", let through when the project is ready.
// Run: node test/gate.test.js   (git on PATH; everything in a temp folder, the office's data folder too).
// The key is put together at run time, so no key-shaped text sits in this file.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-gate-'));
process.env.AHO_DATA = path.join(tmp, 'data'); // before lib/config is loaded: the hook names this data folder
process.env.AHO_ROOT = tmp; // the project list the check reads (the hook inherits it): this temp folder, never the real one
const gate = require('../lib/gate');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
function repo(name, files = { 'index.html': '<!doctype html><title>Shop</title>' }) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  // A noreply address: a real one in the commits is itself a finding (DISC-005), and would stop every push here.
  git(dir, 'config', 'user.email', '12345+tester@users.noreply.github.com'); git(dir, 'config', 'user.name', 'Tester'); git(dir, 'config', 'commit.gpgsign', 'false');
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'one');
  return dir;
}
const hook = dir => path.join(dir, '.git', 'hooks', 'pre-push');
const globalHooks = (() => { try { return git(tmp, 'config', '--global', '--get', 'core.hooksPath').trim(); } catch { return ''; } })();

(async () => {
  const P = { name: 'Shop' };
  const clean = { findings: [], partly: false, notRead: [], cut: [] };
  check('the report: a clean audit is ready, with no word about what was not read', () => {
    assert(/is ready to publish \(no Critical or High finding\)/.test(gate.report(P, clean)));
    assert.strictEqual(gate.isReady({ ...clean, verdict: 'passed' }), true);
  });
  check('the report: partly checked does not say a plain ready, and lists what was not read; the push may go', () => {
    const a = { findings: [], partly: true, notRead: ['Code files over 800 KB: 2'], cut: [], verdict: 'passed' };
    const t = gate.report(P, a);
    assert(/PARTLY CHECKED/.test(t) && /Code files over 800 KB: 2/.test(t), t);
    assert(!/is ready to publish \(no Critical/.test(t), t);
    assert.strictEqual(gate.isReady(a), true);
  });
  check('the report: a part that stopped or crashed is not ready, even with no finding', () => {
    const a = { findings: [], partly: true, notRead: ['The code check stopped after 125 s, so what it found is lost'], cut: ['The code check stopped after 125 s, so what it found is lost'], verdict: 'passed' };
    const t = gate.report(P, a);
    assert.strictEqual(gate.isReady(a), false);
    assert(/NOT READY TO PUBLISH/.test(t) && /did not finish/.test(t) && /125 s/.test(t), t);
    assert(/do not use --no-verify/.test(t), t);
  });
  check('the report: faults and a stopped part together name both', () => {
    const f = { sev: 'High', rule: 'SEC-001', where: 'a.js:1', title: 'A key', fix: 'Remove it.' };
    const a = { findings: [f], partly: true, notRead: ['The AI agent files check crashed, so what it found is lost'], cut: ['The AI agent files check crashed, so what it found is lost'], verdict: 'fix-first' };
    const t = gate.report(P, a);
    assert(/1 fault to fix first/.test(t) && /did not finish/.test(t), t);
    assert.strictEqual(gate.isReady(a), false);
  });
  check('the report: an audit saved before these fields reads as it did', () => {
    assert(/is ready to publish \(/.test(gate.report(P, { findings: [] })));
    assert.strictEqual(gate.isReady({ findings: [], verdict: 'passed' }), true);
  });

  const plain = path.join(tmp, 'plain'); fs.mkdirSync(plain);
  check('a folder that is not a git repository has no guard to add', () => assert.strictEqual(gate.guardState(plain).state, 'no-git'));

  if (globalHooks) console.log('skip the on/off and push checks: this PC sends every hook to ' + globalHooks + ' (core.hooksPath)');
  else {
    const a = repo('a');
    check('off at first; Turn on writes .git/hooks/pre-push with the mark, and says on (current)', () => {
      assert.strictEqual(gate.guardState(a).state, 'off');
      assert.strictEqual(gate.turnOn(a).ok, true);
      const text = fs.readFileSync(hook(a), 'utf8');
      assert(text.includes(gate.MARK));
      // the data folder the office reads (lib/config.js AHO_DATA), so a push is judged with this office's judgements
      assert(text.includes("AHO_DATA='" + process.env.AHO_DATA.replace(/\\/g, '/') + "'; export AHO_DATA"), text);
      assert.deepStrictEqual(gate.guardState(a), { state: 'on', current: true });
    });
    check('Turn off removes only its own hook', () => {
      assert.strictEqual(gate.turnOff(a).ok, true);
      assert(!fs.existsSync(hook(a)));
      assert.strictEqual(gate.guardState(a).state, 'off');
    });
    const b = repo('b');
    fs.writeFileSync(hook(b), '#!/bin/sh\necho mine\n');
    check('a pre-push hook of the project\'s own is never changed or removed; the line to add is given', () => {
      const s = gate.guardState(b);
      assert.strictEqual(s.state, 'other');
      assert(s.line && s.line.includes('gate.js'));
      assert.strictEqual(gate.turnOn(b).ok, false);
      assert.strictEqual(gate.turnOff(b).ok, false);
      assert.strictEqual(fs.readFileSync(hook(b), 'utf8'), '#!/bin/sh\necho mine\n');
    });
    const c = repo('c');
    git(c, 'config', 'core.hooksPath', '.husky');
    check('hooks sent elsewhere (core.hooksPath, as Husky does): not added, the line to add is given', () => {
      const s = gate.guardState(c);
      assert.strictEqual(s.state, 'unsupported');
      assert(s.line);
      assert.strictEqual(gate.turnOn(c).ok, false);
      assert(!fs.existsSync(hook(c)));
    });

    // The guard was turned on, then git was told to take hooks from elsewhere: every push goes unchecked with no word.
    const store = require('../lib/audit-store');
    fs.mkdirSync(path.join(process.env.AHO_DATA, 'audits'), { recursive: true });
    const proj = (dir, name) => ({ id: name, dir, folder: name, name, auditSkip: [], auditSkipOwn: [], auditInclude: [] });
    const guardFinding = a => a.findings.find(f => f.rule === 'GATE-001');
    const h1 = repo('h1');
    gate.turnOn(h1);
    git(h1, 'config', 'core.hooksPath', '.husky');
    const ga = await store.auditProject(proj(h1, 'h1'), null);
    check('guard on, hooks sent elsewhere: a High finding says pushes are not checked, and gives the line', () => {
      const f = guardFinding(ga);
      assert(f && f.sev === 'High' && f.where === '.git/hooks/pre-push' && /not being checked/.test(f.title), JSON.stringify(ga.findings.map(x => x.rule)));
      assert(f.line && f.line.includes('gate.js') && /\.husky/.test(f.fix), JSON.stringify(f));
      assert.strictEqual(ga.verdict, 'fix-first');
    });
    const gg = await gate.gateAudit(h1);
    check('the guard\'s own audit does not add it (a push is not stopped over its own hook)', () => assert(!guardFinding(gg.a), JSON.stringify(gg.a.findings.map(x => x.rule))));
    const h2 = repo('h2');
    git(h2, 'config', 'core.hooksPath', '.husky');
    const gb = await store.auditProject(proj(h2, 'h2'), null);
    check('never turned on: quiet', () => assert(!guardFinding(gb)));
    const h3 = repo('h3');
    gate.turnOn(h3);
    git(h3, 'config', 'core.hooksPath', '.husky');
    const line3 = gate.guardState(h3).line;
    fs.mkdirSync(path.join(h3, '.husky'), { recursive: true });
    fs.writeFileSync(path.join(h3, '.husky', 'pre-push'), line3 + ' || exit 1\n');
    const gc = await store.auditProject(proj(h3, 'h3'), null);
    check('.husky/pre-push already holds the line: quiet', () => assert(!guardFinding(gc), JSON.stringify(gc.findings.map(x => x.rule))));
    const h4 = repo('h4');
    gate.turnOn(h4);
    git(h4, 'config', 'core.hooksPath', '.husky/_');
    fs.mkdirSync(path.join(h4, '.husky', '_'), { recursive: true });
    fs.writeFileSync(path.join(h4, '.husky', 'pre-push'), line3 + ' || exit 1\n');
    const gd = await store.auditProject(proj(h4, 'h4'), null);
    check('newer Husky (.husky/_ runs .husky/pre-push) with the line: quiet', () => assert(!guardFinding(gd), JSON.stringify(gd.findings.map(x => x.rule))));
    const h5 = repo('h5');
    gate.turnOn(h5);
    const ge = await store.auditProject(proj(h5, 'h5'), null);
    check('guard on and running: quiet', () => assert(!guardFinding(ge)));
    const gj = await store.auditProject({ ...proj(h1, 'h1') }, null);
    const j1 = guardFinding(gj);
    const stateMod = require('../lib/state');
    check('it can be judged: the finding has a fingerprint', () => assert(j1 && j1.fp));

    // A project's own project.json cannot leave anything out of what a push is held to.
    const liveKey = 'const k = "' + 'sk_' + 'live_' + 'Q3x9Lm2Vb7Tn4Rk8Wd5Hj6Zp' + '";\n';
    const h6 = repo('h6', { 'index.js': 'let a = 1;\n', 'src/pay.js': liveKey, 'project.json': JSON.stringify({ auditSkip: ['src'] }) });
    const realList = stateMod.refreshProjects;
    stateMod.refreshProjects = () => [{ ...proj(h6, 'h6'), auditSkip: ['src'], auditSkipOwn: ['src'] }];
    const gs = await gate.gateAudit(h6);
    stateMod.refreshProjects = () => [{ ...proj(h6, 'h6'), auditSkip: ['src'], auditSkipOwn: [] }];
    const gp2 = await gate.gateAudit(h6);
    stateMod.refreshProjects = realList;
    check('the guard ignores a skip the project asks for itself: the key in it stops the push', () => {
      assert(gs.a.findings.some(f => f.rule === 'SEC-003' && f.where === 'src/pay.js:1') && gs.ready === false, JSON.stringify(gs.a.findings.map(f => f.rule + '@' + f.where)));
      assert(!gs.a.notRead.some(n => /project\.json/.test(n)), JSON.stringify(gs.a.notRead));
    });
    check('a skip the person set in the office stays deliberate for the code rules', () => assert(!gp2.a.notRead.some(n => /project\.json/.test(n)), JSON.stringify(gp2.a.notRead)));

    // A real push through the hook, to a bare repository beside it.
    const remote = path.join(tmp, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', remote], { windowsHide: true });
    const d = repo('d');
    git(d, 'remote', 'add', 'origin', remote);
    gate.turnOn(d);
    const push = () => spawnSync('git', ['-C', d, 'push', 'origin', 'HEAD:main'], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    const ok = push();
    check('a ready project is pushed, and the guard says it is ready', () => {
      assert.strictEqual(ok.status, 0, ok.stderr);
      assert(/ready to publish/.test(ok.stderr), ok.stderr);
    });
    fs.writeFileSync(path.join(d, 'pay.js'), 'const k = "' + 'sk_' + 'live_' + 'Q3x9Lm2Vb7Tn4Rk8Wd5Hj6Zp' + '";\n');
    git(d, 'add', '-A'); git(d, 'commit', '-qm', 'two');
    const before = git(remote, 'rev-parse', 'main').trim();
    const stopped = push();
    check('a push holding a live key is stopped: the hook fails, the remote is unchanged, the fault is named', () => {
      assert.notStrictEqual(stopped.status, 0);
      assert.strictEqual(git(remote, 'rev-parse', 'main').trim(), before);
      assert(/NOT READY TO PUBLISH/.test(stopped.stderr) && /SEC-003/.test(stopped.stderr) && /pay\.js:1/.test(stopped.stderr), stopped.stderr);
      assert(/do not use --no-verify/.test(stopped.stderr));
    });
    // The office it was turned on from is gone: the push stops and says how to take the guard off.
    const e = repo('e');
    git(e, 'remote', 'add', 'origin', remote);
    gate.turnOn(e);
    fs.writeFileSync(hook(e), fs.readFileSync(hook(e), 'utf8').replace(/^GATE=.*$/m, "GATE='" + tmp.replace(/\\/g, '/') + "/no-such-office/tools/gate.js'"));
    const gone = spawnSync('git', ['-C', e, 'push', 'origin', 'HEAD:other'], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    check('a guard whose office is gone stops the push and says how to turn it off', () => {
      assert.notStrictEqual(gone.status, 0);
      assert(/is gone/.test(gone.stderr) && /delete \.git\/hooks\/pre-push/.test(gone.stderr), gone.stderr);
    });
    // A check that crashed or ran out of time knows nothing about what it did not read: the push stops, and says so.
    const g = repo('g');
    git(g, 'remote', 'add', 'origin', remote);
    gate.turnOn(g);
    const cutPush = spawnSync('git', ['-C', g, 'push', 'origin', 'HEAD:cut'], { encoding: 'utf8', windowsHide: true, timeout: 120000, env: { ...process.env, AHO_TEST_AUDIT_SLOW: 'code=crash' } });
    check('a part of the audit that crashed stops the push, and the report says what was not checked', () => {
      assert.notStrictEqual(cutPush.status, 0, cutPush.stderr);
      assert(/did not finish/.test(cutPush.stderr) && /The code check crashed/.test(cutPush.stderr), cutPush.stderr);
      assert(!/ready to publish \(/.test(cutPush.stderr), cutPush.stderr);
    });
    // The line the window gives for a project's own hook, added by hand as a person would: it runs as written (node
    // usually sits under "C:/Program Files", so each part must be quoted for sh).
    const f = repo('f');
    git(f, 'remote', 'add', 'origin', remote);
    fs.writeFileSync(hook(f), '#!/bin/sh\necho mine >&2\n');
    const line = gate.guardState(f).line;
    fs.writeFileSync(hook(f), '#!/bin/sh\necho mine >&2\n' + line + ' || exit 1\n');
    const byHand = spawnSync('git', ['-C', f, 'push', 'origin', 'HEAD:byhand'], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    check('the line to add by hand runs from a project\'s own hook', () => {
      assert.strictEqual(byHand.status, 0, byHand.stderr);
      assert(/mine/.test(byHand.stderr) && /ready to publish/.test(byHand.stderr), byHand.stderr);
    });
  }

  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
