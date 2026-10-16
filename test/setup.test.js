// Phase 3: setup, uninstall and the Git checks. Windows only (cmd, reg, PowerShell shortcuts).
// Nothing real is changed: shortcuts go to a temp folder (AHO_SHORTCUT_DIR), the Start office link to a throwaway
// registry key (AHO_LINK_KEY, removed at the end), the office it starts is a test copy on port 8881 with its own
// temp data, and "GitHub" is a stand-in on this PC that counts every request it gets.
// Run: node test/setup.test.js
'use strict';
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const assert = require('assert');

const HERE = path.join(__dirname, '..');
const PORT = 8881;
const TEST_KEY = 'HKCU\\Software\\AiHeadOfficeTest\\ai-head-office';
let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const portOpen = port => new Promise(r => { const s = net.connect(port, '127.0.0.1'); s.setTimeout(1500, () => { s.destroy(); r(false); }); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
const waitPort = async (port, up, tries = 75) => { for (let i = 0; i < tries; i++) { if (await portOpen(port) === up) return true; await sleep(200); } return false; };
const regValue = key => { try { const m = /REG_SZ\s+(.*)$/m.exec(execFileSync('reg.exe', ['query', key, '/ve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); return m ? m[1].trim() : null; } catch { return null; } };
const regClean = () => { try { execFileSync('reg.exe', ['delete', 'HKCU\\Software\\AiHeadOfficeTest', '/f'], { stdio: 'ignore' }); } catch {} };
const linkHere = '"' + process.execPath + '" "' + path.join(HERE, 'lib', 'platform', 'windows', 'link-start.js') + '" "%1"';

// Runs a program with input typed in, and returns { code, out }. Waits for the program to EXIT, not for its output
// to close: the office install.cmd starts inherits the output pipe and keeps it open while it runs.
function run(exe, args, { env, input = '', cwd = HERE, timeout = 60000 } = {}) {
  return new Promise(resolve => {
    const p = spawn(exe, args, { cwd, env, windowsHide: true });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    const t = setTimeout(() => p.kill(), timeout);
    p.on('exit', code => { clearTimeout(t); setTimeout(() => resolve({ code, out }), 300); });
    p.stdin.end(input);
  });
}

(async () => {
  const gp = require('../lib/git-program');
  const v = s => gp.parseVersion(s);

  // ---- the Git version rules ----
  await check('git --version text is read, Git for Windows builds recognised', () => {
    const a = v('git version 2.55.0.windows.3'), b = v('git version 2.43.0');
    assert(a.windows && a.text === '2.55.0.windows.3' && a.parts.join() === '2,55,0,3', JSON.stringify(a));
    assert(!b.windows && b.parts.join() === '2,43,0,0' && v('no version here') === null);
  });
  await check('Git for Windows: older than the last known fix warns, that fix and newer do not', () => {
    assert(gp.judge(v('2.55.0.windows.1')).old && gp.judge(v('2.53.0.windows.3')).old && gp.judge(v('2.45.1.windows.1')).old);
    assert(!gp.judge(v('2.55.0.windows.3')).old && !gp.judge(v('2.56.0.windows.1')).old && !gp.judge(v('3.0.0.windows.1')).old);
  });
  await check('other Git: older than 2.50.1 warns, unless its release line got the fix (backport)', () => {
    for (const o of ['2.50.0', '2.49.0', '2.45.3', '2.39.2', '2.42.9']) assert(gp.judge(v(o)).old, o + ' should warn');
    for (const o of ['2.50.1', '2.51.0', '2.49.1', '2.45.4', '2.43.7', '2.47.5']) assert(!gp.judge(v(o)).old, o + ' should not warn');
  });

  // ---- tools/setup.js (what install.cmd and uninstall.cmd run) ----
  const SC = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-setup-sc-'));
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-setup-data-'));
  const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-setup-ws-'));
  fs.mkdirSync(path.join(WS, 'some-project'));
  // AHO_SETTINGS: a throwaway copy of the AI app's settings, so uninstall's hook removal never touches the real one.
  const CLAUDE_SETTINGS = path.join(DATA, 'claude-settings.json');
  const env = { ...process.env, AHO_SHORTCUT_DIR: SC, AHO_LINK_KEY: TEST_KEY, AHO_DATA: DATA, AHO_PORT: String(PORT), AHO_ROOT: WS, AHO_TRANSCRIPTS: path.join(DATA, 'transcripts'), AHO_SETTINGS: CLAUDE_SETTINGS };
  const lnk = where => path.join(SC, where, 'AI Head Office Overview.lnk');
  regClean();
  if (await portOpen(PORT)) { console.log('Port ' + PORT + ' is in use: stop whatever holds it, then run the test again.'); process.exit(1); }

  await check('setup install: answering n to both leaves them out, the link is still set up', async () => {
    const r = await run(process.execPath, ['tools/setup.js', 'install'], { env, input: 'n\nn\n' });
    assert(r.code === 0, r.out);
    assert(!fs.existsSync(lnk('desktop')) && !fs.existsSync(lnk('startup')), 'a shortcut was made after "n"');
    assert.strictEqual(regValue(TEST_KEY + '\\shell\\open\\command'), linkHere);
  });
  await check('setup install: Enter (yes) to both makes the desktop shortcut and Start with Windows', async () => {
    const r = await run(process.execPath, ['tools/setup.js', 'install'], { env, input: '\n\n' });
    assert(r.code === 0 && fs.existsSync(lnk('desktop')) && fs.existsSync(lnk('startup')), r.out);
  });
  await check('setup uninstall: shortcuts, link and the office\'s own hooks gone (others kept), folder named, nothing deleted', async () => {
    const ours = { type: 'command', command: 'node "C:/x/office/hook.mjs" 8880 --ai-head-office-hook', timeout: 3 };
    const theirs = { type: 'command', command: 'play-a-sound.cmd' };
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify({ hooks: { Stop: [{ hooks: [theirs] }, { hooks: [ours] }], UserPromptSubmit: [{ hooks: [ours] }] } }, null, 2));
    const r = await run(process.execPath, ['tools/setup.js', 'uninstall'], { env });
    assert(r.code === 0, r.out);
    const after = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
    assert(!JSON.stringify(after).includes('--ai-head-office-hook') && JSON.stringify(after).includes('play-a-sound.cmd'), JSON.stringify(after));
    assert(fs.readdirSync(DATA).some(n => n.startsWith('claude-settings.json.before-ai-head-office-')), 'a copy of the file is kept first');
    assert(!fs.existsSync(lnk('desktop')) && !fs.existsSync(lnk('startup')) && regValue(TEST_KEY + '\\shell\\open\\command') === null, r.out);
    assert(r.out.includes(HERE) && fs.existsSync(path.join(HERE, 'server.js')));
  });

  // ---- install.cmd, start to finish, as a new user would (fresh data folder: the Welcome would show) ----
  await check('install.cmd: Node found, both answered yes, then the office starts and answers', async () => {
    const r = await run('cmd.exe', ['/d', '/c', path.join(HERE, 'install.cmd')], { env: { ...env, AHO_DRYRUN: '1' }, input: 'y\ny\n' });
    assert(r.code === 0 && /Node\.js v\d+/.test(r.out) && /Starting the office/.test(r.out), r.out);
    assert(fs.existsSync(lnk('desktop')) && fs.existsSync(lnk('startup')), 'shortcuts missing\n' + r.out);
    assert(await waitPort(PORT, true), 'the office did not start on ' + PORT);
    const page = await (await fetch('http://127.0.0.1:' + PORT + '/')).text();
    assert(/<title>AI Head Office Overview<\/title>/.test(page) && /id="office"/.test(page));
    assert.strictEqual(regValue(TEST_KEY + '\\shell\\open\\command'), linkHere); // start.cmd set it up again, in the test key
  });
  await check('install.cmd asked already, so the office it started does not show the Welcome again', async () => {
    const run = JSON.parse(fs.readFileSync(path.join(DATA, 'run.json'), 'utf8'));
    const s = await (await fetch('http://127.0.0.1:' + PORT + '/api/stats', { headers: { 'X-AHO-Key': run.key } })).json();
    assert(s.welcomed === true && s.dryRun === true, JSON.stringify({ welcomed: s.welcomed, dryRun: s.dryRun }));
  });
  await check('uninstall.cmd stops that office and removes everything', async () => {
    const r = await run('cmd.exe', ['/d', '/c', path.join(HERE, 'uninstall.cmd')], { env: { ...env, AHO_INSTALL_NO_START: '1' } });
    assert(r.code === 0, r.out);
    assert(await waitPort(PORT, false), 'still listening on ' + PORT);
    assert(!fs.existsSync(lnk('desktop')) && !fs.existsSync(lnk('startup')) && regValue(TEST_KEY + '\\shell\\open\\command') === null, r.out);
  });
  await check('install.cmd with no Node.js: says so, points to nodejs.org, changes nothing, exits 1', async () => {
    const sys = process.env.SystemRoot || 'C:\\Windows';
    const noNode = { ...env, PATH: [sys + '\\System32', sys, path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps')].join(';') };
    const r = await run('cmd.exe', ['/d', '/c', path.join(HERE, 'install.cmd')], { env: noNode, input: 'n\n\n' });
    assert(r.code === 1 && /needs Node\.js 22 or newer/.test(r.out) && /nodejs\.org/.test(r.out), r.out);
    assert(!/winget install/.test(r.out.replace(/with winget\?/g, '')) , 'winget ran after "n"');
    assert(!fs.existsSync(lnk('desktop')) && regValue(TEST_KEY + '\\shell\\open\\command') === null, 'something was set up without Node.js');
  });

  // ---- the server: Run setup again, Git program, online check off until ticked, Uninstall ----
  let hits = 0;
  const gh = await new Promise(r => { const s = http.createServer((q, res) => { hits++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ tag_name: 'v9.9.0.windows.1' })); }); s.listen(0, '127.0.0.1', () => r(s)); });
  const srv = spawn(process.execPath, [path.join(HERE, 'server.js'), '--dry-run'], { env: { ...env, AHO_GIT_LATEST_URL: 'http://127.0.0.1:' + gh.address().port + '/latest' }, stdio: 'ignore' });
  await waitPort(PORT, true);
  const page = await (await fetch('http://127.0.0.1:' + PORT + '/')).text();
  const key = (page.match(/name="aho-key" content="([0-9a-f]+)"/) || [])[1];
  const api = async (p, body) => (await fetch('http://127.0.0.1:' + PORT + p, { method: body ? 'POST' : 'GET', headers: { 'X-AHO-Key': key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();

  await check('every page load and read the window makes asks the internet nothing while the Git tick is off', async () => {
    for (const p of ['/api/projects', '/api/stats', '/api/setup', '/api/git-program', '/api/git-program?fresh=1', '/api/settings', '/api/shortcuts']) await (p === '/api/shortcuts' ? api(p, {}) : api(p));
    const g = await api('/api/git-program?fresh=1');
    assert(g.installed && g.judge && g.online === false && g.latest === null, JSON.stringify(g));
    assert.strictEqual(hits, 0, 'requests to "GitHub" with the tick off: ' + hits);
  });
  await check('ticked: one request, the newest version read and compared; a day\'s cache, no second request', async () => {
    const r = await api('/api/git-online', { on: true });
    assert(r.ok && r.git.online && r.git.latest.version === '9.9.0.windows.1' && r.git.latest.newer === true, JSON.stringify(r));
    await api('/api/git-program'); await api('/api/git-program');
    assert.strictEqual(hits, 1);
  });
  await check('unticked again: the setting is saved off and nothing more is asked', async () => {
    const r = await api('/api/git-online', { on: false });
    const g = await api('/api/git-program?fresh=1');
    assert(r.ok && g.online === false && g.latest === null && hits === 1, JSON.stringify(g));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).gitOnlineCheck, false);
  });
  await check('Run setup again: status, then each of the three as ticked', async () => {
    const s = await api('/api/setup');
    assert(s.node.ok && s.folder === HERE && s.link.exists === false && s.desktop.exists === false, JSON.stringify(s));
    const r = await api('/api/setup', { link: true, desktop: true, startup: false });
    assert(r.ok && r.status.link.here && r.status.desktop.exists && !r.status.startup.exists, JSON.stringify(r));
    assert(fs.existsSync(lnk('desktop')) && !fs.existsSync(lnk('startup')));
  });
  await check('Run setup again ignores anything that is not true/false', async () => {
    const r = await api('/api/setup', { desktop: 'no', startup: 1, other: true });
    assert(r.ok && r.results.length === 0 && fs.existsSync(lnk('desktop')), JSON.stringify(r));
  });
  await check('Uninstall from About: everything removed, folder named, the office stops', async () => {
    const r = await api('/api/uninstall', {});
    assert(r.ok && r.folder === HERE, JSON.stringify(r));
    assert(!fs.existsSync(lnk('desktop')) && regValue(TEST_KEY + '\\shell\\open\\command') === null);
    assert(await waitPort(PORT, false), 'still listening after Uninstall');
  });

  srv.kill(); gh.close(); regClean();
  for (const d of [SC, DATA, WS]) fs.rmSync(d, { recursive: true, force: true });
  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
