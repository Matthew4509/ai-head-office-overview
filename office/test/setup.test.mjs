import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { apply, status, onHook, withOurs, withoutOurs, hookCommand, settings, OWN_HOOK } from '../src/setup.mjs';
import { Office } from '../src/office.mjs';
import { tempHome, lines, ROOT } from './helpers.mjs';

const BEEPS = {
  model: 'opus',
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: '[console]::beep(659,90)', shell: 'powershell', timeout: 5 }] }],
    Notification: [{ hooks: [{ type: 'command', command: '[console]::beep(988,130)', shell: 'powershell', timeout: 5 }] }],
  },
};

function withSettings(h, data) {
  const file = path.join(h.dir, 'settings.json');
  if (data !== undefined) fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  process.env.AHO_SETTINGS = file;
  return file;
}

test('advanced setup adds its three hooks beside the ones already there, keeps a copy, and comes off cleanly', () => {
  const h = tempHome();
  try {
    const file = withSettings(h, BEEPS);
    const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts });
    const on = apply(office, { advanced: true }, { port: 8884, hookScript: 'C:\\x\\harbour notes\\hook.mjs' });
    assert.equal(on.ok, true);
    assert.equal(on.status.mode, 'advanced');
    assert.ok(fs.existsSync(on.backup), 'a copy of the file from before');
    assert.deepEqual(JSON.parse(fs.readFileSync(on.backup, 'utf8')), BEEPS);
    const now = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(now.model, 'opus', 'other settings untouched');
    assert.equal(now.hooks.Stop[0].hooks[0].command, '[console]::beep(659,90)', 'the beep stays first');
    assert.equal(now.hooks.Stop.length, 2);
    assert.equal(now.hooks.UserPromptSubmit.length, 1);
    assert.match(now.hooks.Stop[1].hooks[0].command, /^node "C:\/x\/harbour notes\/hook\.mjs" 8884 --ai-head-office-hook$/);
    // Turning it on twice does not add it twice.
    apply(office, { advanced: true }, { port: 8884, hookScript: 'C:\\x\\harbour notes\\hook.mjs' });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.Stop.length, 2);
    const off = apply(office, { advanced: false }, { port: 8884, hookScript: 'x' });
    assert.equal(off.status.mode, 'easy');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), BEEPS, 'back exactly as it was');
  } finally {
    delete process.env.AHO_SETTINGS;
    h.done();
  }
});

test('a hook that runs this office\'s own hook.mjs under another mark still counts as ours: on, replaced, and taken off', () => {
  const h = tempHome();
  try {
    const old = (ev) => ({ hooks: [{ type: 'command', command: `node "${OWN_HOOK.replace(/\\/g, '/')}" 8884 --old-office-hook`, timeout: 3 }] });
    const file = withSettings(h, { ...BEEPS, hooks: { ...BEEPS.hooks, Stop: [...BEEPS.hooks.Stop, old()], Notification: [...BEEPS.hooks.Notification, old()], UserPromptSubmit: [old()] } });
    const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts });
    assert.equal(status(office).mode, 'advanced');
    apply(office, { advanced: true }, { port: 8884, hookScript: OWN_HOOK });
    const now = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(now.hooks.Stop.length, 2, 'the old one replaced, not added beside');
    assert.match(now.hooks.Stop[1].hooks[0].command, /--ai-head-office-hook$/);
    fs.writeFileSync(file, JSON.stringify({ ...BEEPS, hooks: { ...BEEPS.hooks, Stop: [...BEEPS.hooks.Stop, old()] } }));
    apply(office, { advanced: false }, { port: 8884, hookScript: OWN_HOOK });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), BEEPS, 'the old one taken off, the beeps kept');
  } finally {
    delete process.env.AHO_SETTINGS;
    h.done();
  }
});

test('another app\'s hooks (AI Office Overview\'s, its own hook.mjs and mark) are never counted, changed or removed', () => {
  const h = tempHome();
  try {
    const theirs = { hooks: [{ type: 'command', command: 'node "C:/x/other office app/hook.mjs" 8870 --ai-office-overview-hook', timeout: 3 }] };
    const before = { ...BEEPS, hooks: { ...BEEPS.hooks, Stop: [...BEEPS.hooks.Stop, theirs], UserPromptSubmit: [theirs] } };
    const file = withSettings(h, before);
    const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts });
    assert.equal(status(office).mode, 'easy', 'their hooks do not make this office "advanced"');
    apply(office, { advanced: true }, { port: 8884, hookScript: OWN_HOOK });
    const on = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(on.hooks.UserPromptSubmit[0], theirs, 'theirs kept when ours go on');
    assert.equal(on.hooks.Stop.length, 3);
    apply(office, { advanced: false }, { port: 8884, hookScript: OWN_HOOK });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), before, 'theirs kept when ours come off: back exactly as it was');
    assert.deepEqual(withoutOurs(before), before, 'uninstall\'s clean-up leaves them too');
  } finally {
    delete process.env.AHO_SETTINGS;
    h.done();
  }
});

test('a settings file that is not valid JSON is never touched', () => {
  const h = tempHome();
  try {
    const file = withSettings(h, '{ "hooks": ');
    const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts });
    const r = apply(office, { advanced: true }, { port: 8884, hookScript: 'x' });
    assert.match(r.error.fault, /could not be read/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ "hooks": ');
    assert.equal(status(office).readable, false);
  } finally {
    delete process.env.AHO_SETTINGS;
    h.done();
  }
});

test('X-03: an office folder whose path bash or cmd would read ($, backtick, ", %) is refused, and the file is untouched', () => {
  const h = tempHome();
  try {
    const file = withSettings(h, BEEPS);
    const before = fs.readFileSync(file, 'utf8');
    const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts });
    for (const bad of ['C:\\x\\$(calc)\\office\\hook.mjs', 'C:\\x\\`calc`\\office\\hook.mjs', 'C:\\x\\a"b\\office\\hook.mjs', 'C:\\x\\100%\\office\\hook.mjs']) {
      const r = apply(office, { advanced: true }, { port: 8884, hookScript: bad });
      assert.match(r.error?.fault || '', /cannot be turned on/, bad);
      assert.match(r.error.wayOut, /Move the office/);
    }
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    // Going back to easy setup is never refused for the path.
    assert.ok(apply(office, { advanced: false }, { port: 8884, hookScript: 'C:\\x\\$y\\office\\hook.mjs' }).ok);
  } finally {
    delete process.env.AHO_SETTINGS;
    h.done();
  }
});

test('no settings file yet: advanced setup makes one with only its hooks', () => {
  const merged = withOurs({}, hookCommand('C:/a/hook.mjs', 8884));
  assert.deepEqual(Object.keys(merged.hooks).sort(), ['Notification', 'Stop', 'UserPromptSubmit']);
  assert.deepEqual(withoutOurs(merged), {});
});

test('a permission prompt from a hook makes the thread "Needs you" at once; "waiting for input" alone does not', () => {
  const h = tempHome();
  try {
    lines('t1').prompt(0, 'go').tool(1, 'Bash', { command: 'npm test', description: 'Run the tests' }, 10, `${ROOT}\\harbour notes`).write(path.join(h.transcripts, 'C--Work-projects', 't1.jsonl'));
    let now = Date.parse('2026-10-12T00:01:05Z');
    const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts, now: () => now });
    office.settings.root = ROOT;
    office.scan();
    const me = () => office.snapshot().people.find((p) => p.folder === 'harbour notes');
    assert.equal(me().state, 'working');
    onHook(office, { event: 'Notification', session: 't1', message: 'Claude needs your permission to use Bash' });
    assert.equal(me().state, 'needs');
    assert.equal(me().words, 'Waiting for your permission');
    now += 1000;
    onHook(office, { event: 'Notification', session: 't1', message: 'Claude is waiting for your input' });
    assert.equal(me().state, 'idle');
  } finally {
    h.done();
  }
});

test('the hook script ends cleanly and prints nothing when the office is closed', () => {
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'hook.mjs'), '1', '--ai-head-office-hook'], { input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'x' }), timeout: 5000 });
  assert.equal(r.status, 0);
  assert.equal(String(r.stdout), '');
});

test('the theme is kept in the office settings: dark, light or system, and nothing else', () => {
  const h = tempHome();
  try {
    const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts });
    assert.equal(status(office).theme, '');
    assert.equal(settings(office, { theme: 'dark' }).ok, true);
    assert.equal(status(office).theme, 'dark');
    assert.equal(JSON.parse(fs.readFileSync(path.join(h.data, 'settings.json'), 'utf8')).theme, 'dark');
    const bad = settings(office, { theme: 'purple' });
    assert.match(bad.error.fault, /theme/);
    assert.equal(status(office).theme, 'dark', 'a refused theme leaves the one chosen before');
    assert.equal(settings(office, { theme: 'system' }).ok, true);
    assert.equal(new Office({ dataDir: h.data, transcriptsDir: h.transcripts }).settings.theme, 'system', 'read back after a restart');
  } finally {
    h.done();
  }
});
