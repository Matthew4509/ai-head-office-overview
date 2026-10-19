// End-to-end test of the office server in DRY RUN on port 8881 (never opens windows or browsers).
// Every project it sees is made up, in a temp folder (AHO_ROOT): it starts one, scans it, stops it, and checks
// the guards. Nothing on this PC outside that folder is listed, started or changed. Windows only (PowerShell, netstat).
// Run: node test/server.test.js
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const net = require('net');
const fs = require('fs');
const os = require('os');

const PORT = 8881;
const BASE = 'http://127.0.0.1:' + PORT;
const NODE = process.execPath;
const SITE = path.join(__dirname, '..', 'demo', 'site.js'); // a little static site server (serves <folder>/public)
let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
const portOpen = (port, host = '127.0.0.1') => new Promise(r => { const s = net.connect(port, host); s.setTimeout(1500, () => { s.destroy(); r(false); }); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- the made-up working folder ----
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-ws-'));
function make(folder, files) {
  const d = path.join(WS, folder);
  fs.mkdirSync(d, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(d, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return d;
}
const PAGE = '<!doctype html><html><head><title>Test site</title></head><body><p>A made-up site.</p></body></html>';

async function main() {
  const pAlpha = await freePort(), pBeta = await freePort(), pEps1 = await freePort(), pEps2 = await freePort();
  const alphaDir = make('alpha-site', {
    'README.md': '# Alpha\n\nAlpha Site is a made-up website that only exists for this test.\n',
    'public/index.html': PAGE,
    '.claude/launch.json': JSON.stringify({ version: '0.0.1', configurations: [{ name: 'alpha', runtimeExecutable: NODE, runtimeArgs: [SITE, String(pAlpha), '.'], port: pAlpha }] }),
  });
  make('beta-site', {
    'public/index.html': PAGE,
    'project.json': JSON.stringify({ name: 'Beta Site', description: 'A second made-up site.', start: { name: 'beta', exe: NODE, args: [SITE, String(pBeta), '.'], port: pBeta } }),
  });
  // One app with two start entries that differ only by port: the office merges them into one entry with alternates.
  make('epsilon-site', {
    'public/index.html': PAGE,
    '.claude/launch.json': JSON.stringify({ configurations: [{ name: 'eps', runtimeExecutable: NODE, runtimeArgs: [SITE, String(pEps1), '.'], port: pEps1 },
      { name: 'eps-2', runtimeExecutable: NODE, runtimeArgs: [SITE, String(pEps2), '.'], port: pEps2 }] }),
  });
  make('gamma-notes', { 'README.md': '# Gamma\n\nGamma Notes is a folder of plain notes with no start command at all.\n' });
  // A port that is not a number must never reach an address or a command line.
  make('delta-site', { '.claude/launch.json': JSON.stringify({ configurations: [{ name: 'delta', runtimeExecutable: NODE, runtimeArgs: ['x.js'], port: '1@elsewhere.example' }] }) });
  // Windows allows ; & ^ % ( ) in folder names: Windows Terminal reads ; as "next command", cmd.exe reads & as one.
  const oddDir = make('odd;name&more', { 'README.md': '# Odd\n\nA folder whose name holds characters that command lines treat as their own.\n' });

  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-data-')); // fresh settings: a first run
  // One made-up thread for the office: started in the working folder, it writes a file in alpha-site, so its person
  // sits at alpha-site's desk and the office links that desk to the alpha-site project.
  const tx = path.join(DATA, 'transcripts', 'made-up-folder');
  fs.mkdirSync(tx, { recursive: true });
  const at = new Date().toISOString();
  fs.writeFileSync(path.join(tx, 'thread-one.jsonl'), [
    { type: 'user', timestamp: at, cwd: WS, sessionId: 'thread-one', message: { role: 'user', content: 'Tidy the alpha page' } },
    { type: 'assistant', timestamp: at, cwd: WS, sessionId: 'thread-one', message: { id: 'm1', stop_reason: 'tool_use', usage: { input_tokens: 5, output_tokens: 7 }, content: [{ type: 'tool_use', name: 'Write', input: { file_path: path.join(alphaDir, 'notes.md') } }] } },
  ].map(l => JSON.stringify(l)).join('\n') + '\n');
  // A stand-in LibreHardwareMonitor on 8085 (when free) counts requests from THIS test's office (matched by the
  // sender's process id, since another office running on the PC may ask 8085 too), so a switched-off CPU temp is proven unread.
  let lhmHits = 0, srvPid = 0;
  const lhm = await new Promise(r => {
    const s = require('http').createServer((q, res) => {
      const from = '127.0.0.1:' + q.socket.remotePort;
      const line = require('child_process').execFileSync('netstat.exe', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }).split(/\r?\n/).find(l => l.trim().split(/\s+/)[1] === from);
      if (line && Number(line.trim().split(/\s+/).pop()) === srvPid) lhmHits++;
      res.end('{}');
    });
    s.on('error', () => r(null)); s.listen(8085, '127.0.0.1', () => r(s));
  });
  if (await portOpen(PORT)) { console.log('Port ' + PORT + ' is in use: stop whatever holds it, then run the test again.'); process.exit(1); }
  const srv = spawn(NODE, [path.join(__dirname, '..', 'server.js'), '--dry-run'], { env: { ...process.env, AHO_TEST_LOCAL_LIVE: '1', AHO_PORT: String(PORT), AHO_DATA: DATA, AHO_ROOT: WS, AHO_SHORTCUT_DIR: path.join(DATA, 'shortcuts') }, stdio: ['ignore', 'pipe', 'pipe'] });
  srvPid = srv.pid;
  let out = ''; srv.stdout.on('data', d => { out += d; }); srv.stderr.on('data', d => { out += d; });
  for (let i = 0; i < 50 && !(await portOpen(PORT)); i++) await sleep(200);

  const pageRes = await fetch(BASE + '/');
  const page = await pageRes.text();
  const key = (page.match(/name="aho-key" content="([0-9a-f]+)"/) || [])[1];
  // The page comes in its theme (none chosen yet: the default, Auto, already light or dark by the sun), so it never
  // flashes light before turning dark.
  assert.ok(/<html lang="en" data-theme-choice="light" data-theme="light">/.test(page), 'the page is served with its theme on <html>: light (day) until one is chosen');
  const raw = async (p, body, headers = {}) => {
    const res = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'X-AHO-Key': key, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  // Run asks first for a command not seen before: the tests' made-up projects are their own, so the helper says yes.
  const api = async (p, body, headers) => {
    const r = await raw(p, body, headers);
    return p === '/api/start' && r.json && r.json.needsTrust ? raw(p, { ...body, trust: r.json.needsTrust.fp }, headers) : r;
  };

  // ----- the guards -----
  await check('page carries a per-run key', () => assert(key && key.length === 36));
  // A script that does not parse leaves a page that loads, says "connected" and lists nothing (a raw U+2028 in a
  // regex did exactly that once). The page's scripts are separate files: each must parse, and all of them together
  // too (one global scope: the same name declared in two files stops the second file at load).
  // The office is the one page; its scripts are separate files in office/public.
  for (const [name, html, at, least] of [['office page', page, '/', 7]]) {
    const scriptSrcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)].map(m => m[1]);
    const scriptTexts = await Promise.all(scriptSrcs.map(async s => { const r = await fetch(BASE + at + s); assert.strictEqual(r.status, 200, s); return r.text(); }));
    await check('the ' + name + "'s own scripts parse, alone and together", () => {
      assert(scriptSrcs.length >= least, 'expected the page scripts, found ' + scriptSrcs.join(', '));
      scriptSrcs.forEach((s, i) => { try { new Function(scriptTexts[i]); } catch (e) { throw new Error(s + ': ' + e.message); } });
      new Function(scriptTexts.map(t => t.replace(/^'use strict';$/m, '')).join('\n;\n'));
    });
    await check('no inline script on the ' + name, () => assert.strictEqual([...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].length, 0, 'inline <script> found'));
  }
  await check('the office is the home page; the old project page is gone', async () => {
    assert(/id="office"/.test(page) && /AI Head Office Overview<\/title>/.test(page), 'office page');
    for (const p of ['/classic', '/classic/', '/classic/js/core.js', '/js/core.js']) assert.strictEqual((await fetch(BASE + p)).status, 404, p);
  });
  await check('office API: needs the key, answers the staff with it', async () => {
    assert.strictEqual((await fetch(BASE + '/api/office/state')).status, 403);
    const r = await api('/api/office/state');
    assert(r.status === 200 && Array.isArray(r.json.people) && r.json.setup && /office[\\/]hook\.mjs" 8881 --ai-head-office-hook$/.test(r.json.setup.hookCommand), JSON.stringify(r.json.setup));
  });
  await check('the office links a desk to its project, and its thread\'s tokens count for that project', async () => {
    let s;
    for (let i = 0; i < 40; i++) { s = (await api('/api/office/state')).json; if (!s.loading && s.links && s.links['alpha-site']) break; await sleep(250); }
    const alpha = (await api('/api/projects')).json.projects.find(p => p.folder === 'alpha-site');
    assert(alpha && s.links['alpha-site'] === alpha.id, JSON.stringify(s.links));
    assert(s.people.some(p => p.folder === 'alpha-site'), 'nobody at the alpha-site desk');
    let tokens = 0;
    for (let i = 0; i < 40 && !tokens; i++) { await api('/api/refresh-tokens', {}); await sleep(250); tokens = (await api('/api/projects')).json.projects.find(p => p.folder === 'alpha-site').tokens; }
    assert.strictEqual(tokens, 12);
  });
  await check('office hook: JSON without a key is taken; anything else is refused', async () => {
    const ok = await fetch(BASE + '/api/office/hook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'Stop', session: 'abc' }) });
    const form = await fetch(BASE + '/api/office/hook', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    const other = await fetch(BASE + '/api/office/nickname', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.deepStrictEqual([ok.status, form.status, other.status], [200, 403, 403]);
  });
  await check('office advanced setup in a test copy only reports: the real AI app settings are never written', async () => {
    const r = await api('/api/office/setup', { advanced: true });
    assert(r.status === 200 && /advanced setup on/.test(r.json.dryRun), JSON.stringify(r.json));
  });
  await check('the theme chosen in Settings is the one the page comes in (Auto as light or dark); an unknown one is refused', async () => {
    const tag = async () => (await (await fetch(BASE + '/')).text()).match(/<html lang="en" data-theme-choice="(\w+)" data-theme="(\w+)">/);
    const page = async () => (await tag())?.[1];
    assert.strictEqual((await api('/api/office/settings', { theme: 'dark' })).json.status.theme, 'dark');
    assert.strictEqual(await page(), 'dark');
    const bad = await api('/api/office/settings', { theme: '"><script>' });
    assert(bad.status === 400 && bad.json.error.fault, JSON.stringify(bad.json));
    assert.strictEqual(await page(), 'dark');
    await api('/api/office/settings', { theme: 'system' });
    assert.strictEqual(await page(), 'system');
    // Auto: served already light or dark by the sun where this PC's time zone is.
    await api('/api/office/settings', { theme: 'auto' });
    const t = await tag();
    assert(t && t[1] === 'auto' && ['light', 'dark'].includes(t[2]), String(t));
  });
  await check('no inline script on the page, and the CSP allows none', () => {
    const csp = pageRes.headers.get('content-security-policy') || '';
    assert(/script-src 'self'(;|$)/.test(csp), csp);
  });
  await check('only the page\'s own .css/.js files are served, nothing else from the office folder', async () => {
    assert.strictEqual((await fetch(BASE + '/app.css')).status, 200);
    for (const p of ['/server.js', '/lib/config.js', '/js/../../server.js', '/projects.example.json', '/index.html', '/js/', '/README.md'])
      assert.notStrictEqual((await fetch(BASE + p)).status, 200, p);
  });
  await check('page cannot be framed by another site, and loads nothing from outside', () => {
    assert.strictEqual(pageRes.headers.get('x-frame-options'), 'DENY');
    const csp = pageRes.headers.get('content-security-policy') || '';
    assert(/frame-ancestors 'none'/.test(csp) && /default-src 'self'/.test(csp) && /connect-src 'self'/.test(csp), csp);
  });
  await check('API without the key is refused', async () => { const r = await fetch(BASE + '/api/projects'); assert.strictEqual(r.status, 403); });
  await check('a form post from another site (no key, text/plain) is refused and changes nothing', async () => {
    const r = await fetch(BASE + '/api/folders/add', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ path: os.tmpdir() }) });
    assert.strictEqual(r.status, 403);
  });
  await check('wrong Host header is refused (DNS rebinding)', async () => {
    const status = await new Promise(resolve => {
      const req = require('http').request({ host: '127.0.0.1', port: PORT, path: '/', headers: { Host: 'evil.example:' + PORT } }, res => resolve(res.statusCode));
      req.end();
    });
    assert.strictEqual(status, 421);
  });
  await check('listens on 127.0.0.1 only', async () => {
    assert(/127\.0\.0\.1:8881/.test(out), out);
    // This PC's own network address must not reach it.
    const lan = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
    if (lan) assert(!(await portOpen(PORT, lan.address)), 'answered on ' + lan.address);
    else console.log('     (no network address on this PC: only the log line was checked)');
  });

  // ----- the list -----
  const { json } = await api('/api/projects');
  const byFolder = f => json.projects.find(p => p.folder === f);
  await check('project list is the made-up working folder, nothing else', () => {
    assert.deepStrictEqual(json.projects.map(p => p.folder).sort(), ['alpha-site', 'beta-site', 'delta-site', 'epsilon-site', 'gamma-notes', 'odd;name&more']);
  });
  await check('name and description come from project.json, else the folder name and the README', () => {
    assert.strictEqual(byFolder('beta-site').name, 'Beta Site');
    assert.strictEqual(byFolder('beta-site').description, 'A second made-up site.');
    assert.strictEqual(byFolder('gamma-notes').name, 'gamma-notes');
    assert(/^Gamma Notes is a folder of plain notes/.test(byFolder('gamma-notes').description), byFolder('gamma-notes').description);
  });
  await check("the office's own projects.json wins over a project's project.json", () => {
    const { listProjects } = require('../lib/projects');
    const f = path.join(DATA, 'overrides-test.json');
    fs.writeFileSync(f, JSON.stringify({ projects: { 'beta-site': { name: 'Named by the office' } } }));
    const rows = listProjects({ workingFolders: [WS] }, { overridesFile: f });
    assert.strictEqual(rows.find(p => p.folder === 'beta-site').name, 'Named by the office');
  });
  await check('start commands are found, but their text (exe/args) is NEVER sent to the page — only a key and a port', () => {
    const a = byFolder('alpha-site').commands[0], b = byFolder('beta-site').commands[0];
    assert(a.port === pAlpha && a.from === '.claude/launch.json' && b.port === pBeta && b.from === 'project.json', JSON.stringify([a, b]));
    for (const c of [a, b]) assert(!('exe' in c) && !('args' in c) && !('run' in c) && !('cwd' in c), 'the page must not receive command text: ' + JSON.stringify(c));
  });
  await check('a port that is not a number is dropped, so it never becomes part of an address', async () => {
    const d = byFolder('delta-site');
    assert(d.commands.length === 1 && d.commands[0].port === null, JSON.stringify(d.commands));
    const r = (await api('/api/open-browser', { id: d.id, key: d.commands[0].key })).json;
    assert(!r.ok && !r.dryRun, JSON.stringify(r));
  });
  await check('first run: a general folder (Downloads, home, a drive) is not taken as the projects folder', () => {
    const Settings = require('../lib/settings');
    const first = root => { const f = path.join(os.tmpdir(), 'aho-first-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json'); const s = Settings.load(f, root); fs.unlinkSync(f); return s.workingFolders.length; };
    assert.strictEqual(first(path.join(os.homedir(), 'Downloads')), 0);
    assert.strictEqual(first(os.homedir()), 0);
    assert.strictEqual(first(path.parse(os.homedir()).root), 0);
    assert.strictEqual(first(WS), 1);
  });
  await check("the office's own folder cannot be added as a project", async () => {
    const r = (await api('/api/projects/add', { path: path.join(__dirname, '..') })).json;
    assert(!r.ok && /own folder/.test(r.error), JSON.stringify(r));
  });
  await check('stats include RAM and disk', () => assert(json.stats.mem.total > 0 && json.stats.disk && json.stats.disk.total > 0));

  await check('unknown project id is refused', async () => { const r = await api('/api/start', { id: '../../windows', key: '0' }); assert.strictEqual(r.status, 404); });
  await check('command text from the page is ignored (only a number is used)', async () => {
    const r = await api('/api/start', { id: byFolder('alpha-site').id, key: 'calc.exe', exe: 'calc.exe' });
    assert(r.json.ok === false && /No start command/.test(r.json.error), JSON.stringify(r.json));
  });

  await check('Run asks first: the whole command is shown and nothing starts until the person says yes', async () => {
    const p = byFolder('beta-site');
    const first = (await raw('/api/start', { id: p.id, key: p.commands[0].key, open: false })).json;
    assert(first.ok && first.needsTrust && /^[0-9a-f]{40}$/.test(first.needsTrust.fp) && first.needsTrust.exe === NODE, JSON.stringify(first));
    assert(first.needsTrust.args.some(a => /site\.js$/.test(a)) && /project\.json/.test(first.needsTrust.from), 'program, arguments and the file it comes from are shown');
    assert(!(await api('/api/projects')).json.projects.find(x => x.id === p.id).running, 'nothing started on the first ask');
    const wrong = (await raw('/api/start', { id: p.id, key: p.commands[0].key, open: false, trust: 'f'.repeat(40) })).json;
    assert(wrong.needsTrust, 'a fingerprint for another command is not a yes');
    const yes = (await raw('/api/start', { id: p.id, key: p.commands[0].key, open: false, trust: first.needsTrust.fp })).json;
    assert(yes.ok && yes.url && !yes.needsTrust, JSON.stringify(yes));
    await raw('/api/stop', { id: p.id });
    const again = (await raw('/api/start', { id: p.id, key: p.commands[0].key, open: false })).json;
    assert(again.ok && !again.needsTrust, 'the yes is kept for the same command');
    await raw('/api/stop', { id: p.id });
  });

  // ----- a port held by another program: reported, not fought over -----
  const alpha = byFolder('alpha-site'), acmd = alpha.commands[0];
  const hold = port => spawn(NODE, ['-e', "require('http').createServer((q,s)=>s.end('hog')).listen(" + port + ",'127.0.0.1')"], { stdio: 'ignore' });
  const waitOpen = async port => { for (let i = 0; i < 25 && !(await portOpen(port)); i++) await sleep(200); };
  {
    const hog = hold(pAlpha);
    await waitOpen(pAlpha);
    await check('busy port is reported, not fought over', async () => {
      const r = await api('/api/start', { id: alpha.id, key: acmd.key });
      assert(r.json.ok === false && r.json.portInUse === pAlpha && /already in use/.test(r.json.error), JSON.stringify(r.json));
    });
    hog.kill();
    for (let i = 0; i < 25 && await portOpen(pAlpha); i++) await sleep(200);
  }

  // ----- Run local copy -----
  await check('Run local copy + Scan app starts it and returns an audit', async () => {
    const r = await api('/api/start', { id: alpha.id, key: acmd.key, scan: true });
    assert(r.json.ok, JSON.stringify(r.json));
    assert(r.json.audit && r.json.audit.liveReached === true, 'audit did not reach localhost');
    assert(/^browser http:\/\//.test(r.json.dryRun), 'browser open not reported');
  });
  await check('list shows it running', async () => { const r = await api('/api/projects'); assert(r.json.projects.find(p => p.id === alpha.id).running); });
  await check('last audit is saved and readable', async () => { const r = await api('/api/audit?id=' + alpha.id); assert(r.json.audit && r.json.audit.url); });
  await check('Private details: saved, sent back as label and length only, and Scan app runs the disclosure pass', async () => {
    const value = 'wren.' + 'tester' + '@mailbox.test';
    const s = await api('/api/private-details', { details: [{ label: 'test email', value }] });
    assert(s.json.ok && s.json.details[0].length === value.length && !JSON.stringify(s.json).includes(value), JSON.stringify(s.json));
    assert(!JSON.stringify((await api('/api/private-details')).json).includes(value), 'GET returned the value');
    assert(!(await api('/api/private-details', { details: 'x' })).json.ok, 'a non-list was accepted');
    const a = (await api('/api/audit', { id: alpha.id })).json.audit;
    assert(a.disclosure === true, 'the disclosure pass did not run');
    // Delete all: the file itself goes, not just the list in it.
    const file = path.join(DATA, 'private-details.json');
    assert(fs.existsSync(file) && s.json.stored === true && s.json.file === file, 'the page is told where they are kept');
    const d = (await api('/api/private-details/delete', {})).json;
    assert(d.ok && d.stored === false && !d.details.length && !fs.existsSync(file), JSON.stringify(d));
  });
  await check('Stop ends the process and frees the port', async () => {
    await api('/api/stop', { id: alpha.id });
    await sleep(800);
    assert(!(await portOpen(pAlpha)));
  });

  // Copy prompt only copies text: no route starts an AI app.
  await check('there is no route that opens an AI app', async () => {
    const r = await api('/api/open-ai', { id: alpha.id, tool: 'claude' });
    assert.strictEqual(r.status, 404, JSON.stringify(r.json));
  });
  await check('Open terminal here: a plain terminal started IN the folder; the folder is never part of the command line', async () => {
    for (const p of [alpha, byFolder('odd;name&more')]) {
      const r = (await api('/api/open-terminal', { id: p.id })).json;
      // The folder appears only in the "(in <dir>)" note, never before "cmd.exe /k" where cmd could re-parse it.
      assert(r.ok && /cmd\.exe \/k \(in /.test(r.dryRun) && r.dryRun.endsWith('(in ' + p.dir + ')'), JSON.stringify(r));
      assert(!/&|\^|;/.test(r.dryRun.replace(/\(in .*\)$/, '')), 'a folder metacharacter reached the command part: ' + r.dryRun);
    }
    assert(byFolder('odd;name&more').dir === oddDir);
  });

  // ----- folders and the project list -----
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-extra-'));
  const wf = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-wf-'));
  fs.mkdirSync(path.join(wf, 'site-one')); fs.mkdirSync(path.join(wf, 'site-two'));
  const list = async () => (await api('/api/projects')).json.projects;
  await check('first run: the default working folder is there, scan baseline set', async () => {
    const s = (await api('/api/settings')).json;
    assert(s.workingFolders.length === 1 && s.workingFolders[0].path.toLowerCase() === WS.toLowerCase() && s.lastScan, JSON.stringify(s));
  });
  await check('a whole drive is refused as a working folder', async () => { const r = (await api('/api/folders/add', { path: 'C:\\' })).json; assert(!r.ok && /whole drive/.test(r.error), JSON.stringify(r)); });
  await check('the Windows folder is refused', async () => { const r = (await api('/api/folders/add', { path: process.env.SystemRoot || 'C:\\Windows' })).json; assert(!r.ok && /system folder/.test(r.error), JSON.stringify(r)); });
  await check('a missing folder is refused with a way out', async () => { const r = (await api('/api/folders/add', { path: path.join(WS, 'no-such-folder-' + Date.now(), 'inside') })).json; assert(!r.ok && /not found/.test(r.error)); });
  await check('a relative path is refused', async () => { const r = (await api('/api/folders/add', { path: 'projects' })).json; assert(!r.ok && /whole path/.test(r.error)); });
  await check('add working folder lists its sub-folders as projects', async () => {
    const r = (await api('/api/folders/add', { path: wf })).json;
    assert(r.ok && r.projects === 2, JSON.stringify(r));
    const l = await list(); assert(l.some(p => p.folder === 'site-one') && l.some(p => p.folder === 'site-two'));
  });
  await check('every project row carries its git state (a plain folder: "none")', async () => {
    const p = (await list()).find(p => p.folder === 'site-one');
    assert(p.git && p.git.state === 'none', JSON.stringify(p.git));
  });
  await check('adding it twice is refused', async () => { const r = (await api('/api/folders/add', { path: wf })).json; assert(!r.ok && /already/.test(r.error)); });
  await check('Scan folders reports a new folder, then a gone one', async () => {
    fs.mkdirSync(path.join(wf, 'site-three'));
    let r = (await api('/api/scan', {})).json;
    assert(r.added.includes('site-three'), JSON.stringify(r));
    assert((await list()).find(p => p.folder === 'site-three').isNew === false, 'still New after the scan that found it');
    fs.rmdirSync(path.join(wf, 'site-three'));
    r = (await api('/api/scan', {})).json;
    assert(r.gone.includes('site-three'), JSON.stringify(r));
  });
  await check('a folder that appears between scans is tagged New', async () => {
    fs.mkdirSync(path.join(wf, 'site-four'));
    assert((await list()).find(p => p.folder === 'site-four').isNew === true);
    await api('/api/scan', {});
  });
  await check('add a single project from elsewhere', async () => {
    const r = (await api('/api/projects/add', { path: extra })).json;
    assert(r.ok, JSON.stringify(r));
    const p = (await list()).find(p => p.dir.toLowerCase() === path.resolve(extra).toLowerCase());
    assert(p && p.added);
  });
  await check('adding a project already on the list is refused', async () => { const r = (await api('/api/projects/add', { path: path.join(wf, 'site-one') })).json; assert(!r.ok && /already/.test(r.error)); });
  await check('remove a project: off the list, files untouched, listed under Removed', async () => {
    const p = (await list()).find(p => p.folder === 'site-one');
    const r = (await api('/api/projects/remove', { id: p.id })).json;
    assert(r.ok && fs.existsSync(path.join(wf, 'site-one')), 'folder must still exist');
    assert(!(await list()).some(x => x.folder === 'site-one'));
    assert((await api('/api/settings')).json.hidden.some(h => h.name === 'site-one'));
  });
  await check('Show again brings it back', async () => {
    const hid = (await api('/api/settings')).json.hidden.find(h => h.name === 'site-one');
    assert((await api('/api/projects/show', { path: hid.path })).json.ok);
    assert((await list()).some(x => x.folder === 'site-one'));
  });
  await check('Hide from display: stays on the list, marked hidden; Unhide clears it', async () => {
    const p = (await list()).find(p => p.folder === 'site-two');
    assert((await api('/api/projects/hide', { id: p.id, hidden: true })).json.ok);
    let q = (await list()).find(x => x.id === p.id);
    assert(q && q.hiddenView === true, 'should still be listed, marked hidden');
    await api('/api/projects/hide', { id: p.id, hidden: false });
    q = (await list()).find(x => x.id === p.id);
    assert(q.hiddenView === false);
  });
  await check('My order is saved and survives a reload of the list', async () => {
    const l = await list();
    const a = l.find(p => p.folder === 'site-one'), b = l.find(p => p.folder === 'site-two');
    assert((await api('/api/projects/order', { ids: [b.id, a.id] })).json.ok);
    const l2 = await list();
    const oa = l2.find(p => p.id === a.id).order, ob = l2.find(p => p.id === b.id).order;
    assert(ob === 0 && oa === 1, 'order a=' + oa + ' b=' + ob);
    assert((await api('/api/projects/order', { ids: [a.id, b.id] })).json.ok);
    const l3 = await list();
    assert(l3.find(p => p.id === a.id).order === 0 && l3.find(p => p.id === b.id).order === 1);
  });
  await check('an unknown id in the order is ignored, not stored', async () => {
    await api('/api/projects/order', { ids: ['no-such-project'] });
    assert(!(await list()).some(p => p.order != null && !p.dir));
  });
  await check('remove an added project takes it out of "added one by one"', async () => {
    const p = (await list()).find(p => p.added);
    await api('/api/projects/remove', { id: p.id });
    assert(!(await api('/api/settings')).json.extraProjects.length && fs.existsSync(extra));
  });
  await check('remove working folder: its projects leave, files untouched', async () => {
    const r = (await api('/api/folders/remove', { path: wf })).json;
    assert(r.ok && !(await list()).some(p => p.folder === 'site-two') && fs.existsSync(path.join(wf, 'site-two')));
  });
  await check('Open on a working folder opens that folder, not one of its projects', async () => {
    const s = (await api('/api/settings')).json;
    const r = (await api('/api/folders/open', { path: s.workingFolders[0].path })).json;
    assert(r.ok && r.dryRun === 'explorer ' + s.workingFolders[0].path, JSON.stringify(r));
    assert(!(await api('/api/folders/open', { path: 'C:\\Windows' })).json.ok, 'a folder not on the list must be refused');
  });
  await check('Browse (dry run) reports the folder window instead of opening it', async () => { const r = (await api('/api/pick-folder', { purpose: 'working' })).json; assert(/folder picker/.test(r.dryRun)); });
  await check('settings were written to the test data folder, not the real one', () => assert(fs.existsSync(path.join(DATA, 'settings.json'))));

  // ----- ports held by other programs, Stop all -----
  // A separate process stands in for "another program" on a project port. (Not this test process: it is the office's
  // parent, which the office rightly refuses to stop as "the office itself".)
  {
    const hog = hold(pBeta);
    await waitOpen(pBeta);
    await check('port owners: a project port held by another program is found, with its program', async () => {
      const o = (await api('/api/port-owners', {})).json.owners.find(x => x.port === pBeta);
      assert(o && o.pid === hog.pid && /node/i.test(o.name) && o.projects.includes('Beta Site') && !o.why, JSON.stringify(o));
    });
    await check('stop-port in a test copy reports, and does not stop the program', async () => {
      const r = (await api('/api/stop-port', { port: pBeta, pid: hog.pid })).json;
      assert(r.ok && /taskkill \/PID \d+/.test(r.dryRun), JSON.stringify(r));
      assert(await portOpen(pBeta), 'the program must still be running');
    });
    await check('stop-port with only the port (no program named) stops nothing and says why', async () => {
      const r = (await api('/api/stop-port', { port: pBeta })).json;
      assert(!r.ok && /Nothing was stopped/.test(r.error) && !r.dryRun, JSON.stringify(r));
      assert(await portOpen(pBeta), 'the program must still be running');
    });
    await check('stop-port refuses when a different program holds the port now', async () => {
      const r = (await api('/api/stop-port', { port: pBeta, pid: 999999 })).json;
      assert(!r.ok && /different program/.test(r.error), JSON.stringify(r));
    });
    await check('Stop all with "also stop others" only touches the programs that were listed', async () => {
      const r = (await api('/api/stop-all', { others: true, listed: [] })).json;
      assert(r.ok && r.others.length === 0, JSON.stringify(r));
      const r2 = (await api('/api/stop-all', { others: true, listed: [{ port: pBeta, pid: hog.pid }] })).json;
      assert(r2.others.length === 1 && r2.others[0].dryRun, JSON.stringify(r2));
    });
    hog.kill();
  }
  // Free port on an alternate start port (the second of two entries merged into one): found and stoppable.
  {
    const hog = hold(pEps2);
    await waitOpen(pEps2);
    await check('an alternate start port held by another program is listed, and Free port can stop it', async () => {
      const o = (await api('/api/port-owners', {})).json.owners.find(x => x.port === pEps2);
      assert(o && o.pid === hog.pid && o.projects.length === 1 && !o.why, JSON.stringify(o));
      const r = (await api('/api/stop-port', { port: pEps2, pid: hog.pid })).json;
      assert(r.ok && /taskkill \/PID \d+/.test(r.dryRun), JSON.stringify(r));
      assert(await portOpen(pEps2), 'the program must still be running (test copy)');
    });
    hog.kill();
  }
  await check('stop-port refuses a port that is not a project start port', async () => {
    const r = (await api('/api/stop-port', { port: 1, pid: 4 })).json;
    assert(!r.ok, JSON.stringify(r));
  });
  await check('stop-port on a project port that is already free says so as a success, not a fault', async () => {
    if (await portOpen(pAlpha)) return console.log('     (skipped: port busy)');
    const r = (await api('/api/stop-port', { port: pAlpha })).json;
    assert(r.ok && r.free && r.port === pAlpha && !r.error, JSON.stringify(r));
  });
  await check('Stop all stops what the office started', async () => {
    if (await portOpen(pAlpha)) return console.log('     (skipped: port busy)');
    assert((await api('/api/start', { id: alpha.id, key: acmd.key })).json.ok);
    const r = (await api('/api/stop-all', { others: false })).json;
    assert(r.stopped.includes(alpha.name), JSON.stringify(r));
    await sleep(800);
    assert(!(await portOpen(pAlpha)), 'port should be free');
  });

  // ----- Hosted live (a little server on this PC stands in for the live site; the test run allows local addresses) -----
  const liveSrv = require('http').createServer((q, s) => { s.writeHead(q.url === '/' ? 200 : 404, { 'Content-Type': 'text/html' }); s.end('<html><head><title>Alpha</title></head><body>hi</body></html>'); });
  await new Promise(r => liveSrv.listen(0, '127.0.0.1', r));
  const liveAddr = 'http://127.0.0.1:' + liveSrv.address().port + '/';
  await check('Hosted live: a bad address is refused with a way out', async () => {
    const r = (await api('/api/live/set', { id: alpha.id, url: 'ftp://nope' })).json;
    assert(!r.ok && /http/.test(r.error), JSON.stringify(r));
  });
  await check('Hosted live: set an address, checked at once (plain http = unsure, with the reason)', async () => {
    const r = (await api('/api/live/set', { id: alpha.id, url: liveAddr })).json;
    assert(r.ok && r.url === liveAddr && r.live && r.live.state === 'unsure' && /plain http/.test(r.live.reason), JSON.stringify(r));
  });
  await check('Hosted live: the list carries the address and the light; settings keep it', async () => {
    const p = (await list()).find(x => x.id === alpha.id);
    assert(p.liveUrl === liveAddr && p.live && p.live.state === 'unsure', JSON.stringify(p.live));
    assert(JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).liveUrls, 'liveUrls not saved');
  });
  await check('Hosted live: Check all runs in the background and moves liveRev on', async () => {
    const before = (await api('/api/stats')).json.liveRev;
    assert((await api('/api/live/check-all', {})).json.ok);
    for (let i = 0; i < 20 && (await api('/api/stats')).json.liveBusy; i++) await sleep(200);
    assert((await api('/api/stats')).json.liveRev > before);
  });
  await check('Hosted live: a site that stops answering turns red', async () => {
    await new Promise(r => liveSrv.close(r));
    const r = (await api('/api/live/check', { id: alpha.id })).json;
    assert(r.ok && r.live.state === 'down', JSON.stringify(r));
  });
  await check('Hosted live: Scan app with a live address runs the compare and reports why it stopped', async () => {
    const r = (await api('/api/audit', { id: alpha.id })).json;
    assert(r.audit.compare && r.audit.compare.stopped && /did not answer/.test(r.audit.compare.stopped), JSON.stringify(r.audit.compare));
  });
  await check('Hosted live: Remove address clears it', async () => {
    assert((await api('/api/live/set', { id: alpha.id, url: '' })).json.ok);
    const p = (await list()).find(x => x.id === alpha.id);
    assert(p.liveUrl === '' && !p.live);
  });

  // ----- Review with AI (T6): prompt to copy, findings imported to the fault list, status changes -----
  await check('Review with AI: the prompt names the project by folder only and asks for the Findings table', async () => {
    const r = (await api('/api/review?id=' + alpha.id)).json;
    assert(r.ok && /## Findings/.test(r.prompt) && /\| Id \| Severity \| Category \| Where \| Evidence \| Fix \|/.test(r.prompt), JSON.stringify(r).slice(0, 300));
    assert(!r.prompt.includes(alphaDir) && !r.prompt.includes(alphaDir.split(path.sep).join('/')) && Array.isArray(r.faults), 'the prompt holds the full path');
  });
  await check('Import report-back: a Findings table goes on the fault list; a row with no place is refused', async () => {
    const text = '## Findings\n| Id | Severity | Category | Where | Evidence | Fix |\n|---|---|---|---|---|---|\n| AI-1 | High | 1 | index.html:1 | a total is never checked against the payment | compare them |\n| AI-2 | High | 1 | everywhere | vague | none |\n';
    const r = (await api('/api/audit/import', { id: alpha.id, text, by: 'tester' })).json;
    assert(r.ok && r.findings.added === 1 && r.findings.refused.length === 1 && r.faults.length === 1, JSON.stringify(r).slice(0, 400));
    const f = (await api('/api/faults?id=' + alpha.id)).json.faults[0];
    assert(f.status === 'open' && f.where === 'index.html:1');
    const bad = (await api('/api/faults/set', { id: alpha.id, fault: f.id, status: 'false', why: '' })).json;
    assert(bad.ok === false && /why/.test(bad.error));
    const ok = (await api('/api/faults/set', { id: alpha.id, fault: f.id, status: 'fixed', by: 'tester' })).json;
    assert(ok.ok && ok.faults[0].status === 'fixed');
  });

  // ----- This PC -----
  await check('This PC is on the top line, between the name and the buttons; the right panel no longer has its tab', () => {
    assert(/<\/h1>\s*<p id="pc-line"[^>]*><\/p>\s*<div class="top-right">\s*<button type="button" id="purse"/.test(page), 'pc-line sits right after the name; the balance and the gear on the right');
    assert(!/id="running"/.test(page), 'the Running row is gone: N projects open on the top line opens the list');
    assert(!/id="tab-pc"|id="side-pc"/.test(page), 'the This PC tab is gone from the right panel');
  });
  await check('stats carry GPU use; CPU temperature only when its switch is on', async () => {
    const s = (await api('/api/stats')).json;
    assert(s.gpu && 'pct' in s.gpu && Array.isArray(s.gpu.adapters), JSON.stringify(s.gpu));
    const on = require('../lib/sensors').CPU_TEMP;
    if (on) assert(s.temp && (typeof s.temp.c === 'number' || (s.temp.c === null && s.temp.port === 8085)), JSON.stringify(s.temp));
    else assert(!('temp' in s), 'CPU temp is switched off but stats still carry it: ' + JSON.stringify(s.temp));
    if (lhm) {
      await sleep(5000); await api('/api/stats'); await sleep(2000);
      lhm.close();
      if (on) assert(lhmHits > 0, 'CPU temp is on but the office never asked port 8085');
      else assert.strictEqual(lhmHits, 0, 'CPU temp is switched off but the office asked port 8085 ' + lhmHits + ' time(s)');
    } else console.log('     (port 8085 busy: the "asked or not" part was skipped)');
  });

  // ----- first start: the one-click welcome (temp folder, never the real desktop or Startup) -----
  await check('a new install has not been welcomed yet', async () => assert.strictEqual((await api('/api/stats')).json.welcomed, false));
  await check('welcome Done: Start with Windows + desktop shortcut made, asked only once', async () => {
    const r = (await api('/api/welcome', { startup: true, desktop: true })).json;
    assert(r.ok && r.results.length === 2 && r.results.every(x => x.exists), JSON.stringify(r));
    assert(fs.existsSync(path.join(DATA, 'shortcuts', 'startup', 'AI Head Office Overview.lnk')) && fs.existsSync(path.join(DATA, 'shortcuts', 'desktop', 'AI Head Office Overview.lnk')));
    assert.strictEqual((await api('/api/stats')).json.welcomed, true);
    await api('/api/shortcut', { where: 'startup', on: false }); await api('/api/shortcut', { where: 'desktop', on: false });
  });
  await check('welcome Not now makes nothing', async () => {
    const r = (await api('/api/welcome', {})).json;
    assert(r.ok && r.results.length === 0 && !fs.existsSync(path.join(DATA, 'shortcuts', 'desktop', 'AI Head Office Overview.lnk')));
  });

  // ----- desktop shortcut / Start with Windows (temp folder, never the real desktop) -----
  await check('desktop shortcut: add, see it, remove', async () => {
    const s = (await api('/api/shortcuts', {})).json;
    assert(s.desktop.exists === false && s.desktop.path.startsWith(DATA), JSON.stringify(s));
    assert((await api('/api/shortcut', { where: 'desktop', on: true })).json.exists === true);
    assert(fs.existsSync(path.join(DATA, 'shortcuts', 'desktop', 'AI Head Office Overview.lnk')));
    assert((await api('/api/shortcut', { where: 'desktop', on: false })).json.exists === false);
  });
  await check('Start with Windows: on and off (the shortcut starts it quietly)', async () => {
    assert((await api('/api/shortcut', { where: 'startup', on: true })).json.exists === true);
    const lnk = path.join(DATA, 'shortcuts', 'startup', 'AI Head Office Overview.lnk');
    const args = require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-Command', "(New-Object -ComObject WScript.Shell).CreateShortcut('" + lnk.replace(/'/g, "''") + "').Arguments"], { encoding: 'utf8' }).trim();
    assert.strictEqual(args, 'quiet');
    assert((await api('/api/shortcut', { where: 'startup', on: false })).json.exists === false);
  });

  // ----- the same app listed on several ports (a tool adds an entry per busy port) becomes one entry -----
  await check('same app on several ports is ONE entry that starts on the first free port; a --dev variant stays separate', async () => {
    // Its own .claude/launch.json, added one by one.
    const site = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-dup-'));
    fs.writeFileSync(path.join(site, 'serve.js'), "require('http').createServer((q, s) => s.end('dup')).listen(+process.argv[2], '127.0.0.1')");
    const [pA, pB, pC] = [await freePort(), await freePort(), await freePort()];
    const node = NODE.replace(/\\/g, '/');
    fs.mkdirSync(path.join(site, '.claude'));
    fs.writeFileSync(path.join(site, '.claude', 'launch.json'), JSON.stringify({ version: '0.0.1', configurations: [
      { name: 'dup', runtimeExecutable: node, runtimeArgs: ['serve.js', String(pA)], port: pA },
      { name: 'dup-' + pB, runtimeExecutable: node, runtimeArgs: [path.join(site, 'serve.js'), String(pB)], port: pB }, // same file, written as a full path
      { name: 'dup-dev', runtimeExecutable: node, runtimeArgs: ['serve.js', String(pC), '--dev'], port: pC },
    ] }));
    assert((await api('/api/projects/add', { path: site })).json.ok);
    const find = async () => (await api('/api/projects?fresh=1')).json.projects.find(x => x.dir.toLowerCase() === site.toLowerCase());
    let p = await find();
    assert.deepStrictEqual(p.commands.map(c => [c.name, c.ports || c.port]), [['dup', [pA, pB]], ['dup-dev', pC]]);
    const hogA = hold(pA);
    try {
      await waitOpen(pA);
      const r = (await api('/api/start', { id: p.id, key: p.commands[0].key, open: false })).json;
      assert(r.ok && r.url.includes(':' + pB + '/') && new RegExp('was busy, so it started on ' + pB).test(r.note), JSON.stringify(r));
      assert.strictEqual(await (await fetch('http://127.0.0.1:' + pB + '/')).text(), 'dup');
      p = await find();
      assert(p.running && p.running.port === pB, JSON.stringify(p.running));
      // Another project whose start file uses the port this one now runs on: NOT "another program" (no Stop offered).
      const twin = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-twin-'));
      fs.mkdirSync(path.join(twin, '.claude'));
      fs.writeFileSync(path.join(twin, '.claude', 'launch.json'), JSON.stringify({ configurations: [{ name: 'twin', runtimeExecutable: node, runtimeArgs: ['x.js'], port: pB }] }));
      assert((await api('/api/projects/add', { path: twin })).json.ok);
      const t = (await api('/api/projects?fresh=1')).json.projects.find(x => x.dir.toLowerCase() === twin.toLowerCase());
      assert(t.portInUse === null && t.portSharedWith && t.portSharedWith.port === pB, JSON.stringify([t.portInUse, t.portSharedWith]));
      const tr = (await api('/api/start', { id: t.id, key: t.commands[0].key, open: false })).json;
      assert(!tr.ok && /is used by .*which the office is running/.test(tr.error), JSON.stringify(tr));
      await api('/api/projects/remove', { id: t.id }); fs.rmSync(twin, { recursive: true, force: true });
      await api('/api/stop', { id: p.id });
      const hogB = hold(pB);
      try {
        await waitOpen(pB);
        const all = (await api('/api/start', { id: p.id, key: p.commands[0].key, open: false })).json;
        assert(!all.ok && new RegExp('Ports ' + pA + ', ' + pB + ' are all in use').test(all.error), JSON.stringify(all));
      } finally { hogB.kill(); }
    } finally { hogA.kill(); const q = await find(); if (q) await api('/api/projects/remove', { id: q.id }); fs.rmSync(site, { recursive: true, force: true }); }
  });

  // ----- saved prompts -----
  const promptFile = path.join(DATA, 'prompts.json');
  let firstId = null;
  let catId = null;
  const mine = list => list.filter(p => p.category === catId);
  await check('prompts: a fresh office has its start-line prompt first, then the nine starter categories, five prompts each', async () => {
    const r = (await api('/api/prompts')).json;
    assert.strictEqual(r.categories.length, 10);
    assert.strictEqual(r.categories[0].name, 'AI Head Office Overview');
    assert.strictEqual(r.prompts.filter(p => p.category === r.categories[0].id).length, 1);
    assert(r.categories.some(c => c.name === 'Photographer'));
    for (const c of r.categories.slice(1)) assert.strictEqual(r.prompts.filter(p => p.category === c.id).length, 5, c.name);
    assert.deepStrictEqual((await api('/api/prompts')).json, r, 'reading twice gives the same list');
  });
  await check('project planner: today\'s plan comes from the projects on the list, and reading it writes nothing', async () => {
    const r = (await api('/api/priorities')).json;
    assert(r.plan && Array.isArray(r.plan.focus) && r.plan.totalMin === 480 && r.categories[0].id === 'unsorted', JSON.stringify(r).slice(0, 300));
    assert.strictEqual(r.plan.focusMin + r.plan.topMin + r.plan.bottomMin, 480);
    assert(!fs.existsSync(path.join(DATA, 'priorities.json')), 'a fresh office writes no planner file on a read');
  });
  await check('project planner: a score, Needs work and a category are saved; bad marks, dates and unknown projects are refused', async () => {
    const list = (await api('/api/projects')).json.projects;
    const alpha = list.find(p => p.folder === 'alpha-site'), beta = list.find(p => p.folder === 'beta-site');
    const cat = (await api('/api/priorities/category/save', { name: '  Company   B ', owner: 'client' })).json;
    assert(cat.ok && cat.category.name === 'Company B' && cat.category.owner === 'client', JSON.stringify(cat).slice(0, 300));
    assert(/name/.test((await api('/api/priorities/category/save', { name: '' })).json.error), 'an empty name is refused, with a way out');
    const r = (await api('/api/priorities/set', { id: alpha.id, scores: { p: 10, d: 10, m: 10, c: 10, k: 10 }, flag: true, categories: [cat.category.id] })).json;
    assert(r.ok && r.rows[alpha.id].score === 100 && r.rows[alpha.id].flag && r.rows[alpha.id].categories[0] === cat.category.id, JSON.stringify(r).slice(0, 300));
    assert.strictEqual(r.plan.focus[0].key, r.rows[alpha.id].key, 'the top score is #1');
    assert.strictEqual(r.categories.find(c => c.id === cat.category.id).count, 1);
    assert(/whole number/.test((await api('/api/priorities/set', { id: alpha.id, scores: { p: 11 } })).json.error));
    assert(/not a date/.test((await api('/api/priorities/set', { id: alpha.id, deadline: 'soon' })).json.error));
    assert(/not on the list/.test((await api('/api/priorities/set', { id: 'nope', scores: {} })).json.error));
    const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'priorities.json'), 'utf8'));
    assert.deepStrictEqual(saved.projects[r.rows[alpha.id].key].scores, { p: 10, d: 10, m: 10, c: 10, k: 10 });
    // Ready to ship takes it out of the focus three; Back to building puts it back.
    const ready = (await api('/api/priorities/set', { id: beta.id, stage: 'ready' })).json;
    assert(ready.plan.ready.some(x => x.key === ready.rows[beta.id].key) && !ready.plan.focus.some(x => x.key === ready.rows[beta.id].key));
    await api('/api/priorities/set', { id: beta.id, stage: 'building' });
  });
  await check('project planner: hours a day, a check-in answer, and a care change that names who changes before it changes', async () => {
    const alpha = (await api('/api/projects')).json.projects.find(p => p.folder === 'alpha-site');
    let r = (await api('/api/priorities/settings', { hoursPerDay: 6 })).json;
    assert(r.ok && r.plan.totalMin === 360 && r.plan.focusMin + r.plan.topMin + r.plan.bottomMin === 360, JSON.stringify(r.plan).slice(0, 200));
    assert(/1 to 16/.test((await api('/api/priorities/settings', { hoursPerDay: 30 })).json.error));
    r = (await api('/api/priorities/answer', { id: alpha.id, what: 'fine' })).json;
    assert(r.ok && r.rows[alpha.id].lastChecked === r.today && !r.rows[alpha.id].flag, 'Fine for now starts the wait again and takes the flag off');
    assert(/Answer/.test((await api('/api/priorities/answer', { id: alpha.id, what: 'maybe' })).json.error));
    const catId = r.rows[alpha.id].categories[0];
    const care = { handoverDays: 30, handoverMin: 15, checkEvery: 'week', checkMin: 30, paid: true };
    const look = (await api('/api/priorities/category/care', { id: catId, care })).json;
    assert(look.ok && look.follows.length === 1 && look.follows[0] === alpha.name && look.from.checkMin === 15, JSON.stringify(look));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(DATA, 'categories.json'), 'utf8')).categories[0].care, undefined, 'looking changes nothing');
    assert(/not complete/.test((await api('/api/priorities/category/care', { id: catId, care: { checkMin: 30 } })).json.error));
    r = (await api('/api/priorities/category/care', { id: catId, care, mode: 'all' })).json;
    assert(r.ok && r.changed === 1 && r.rows[alpha.id].care.checkMin === 30 && r.rows[alpha.id].care.paid, JSON.stringify(r).slice(0, 300));
    r = (await api('/api/priorities/category/remove', { id: catId })).json;
    assert(r.ok && r.rows[alpha.id].categories.length === 0, 'its projects go back to Not sorted');
    await api('/api/priorities/settings', { hoursPerDay: 8 });
  });
  await check('prompts: a star is kept, taken off again, and refused for a prompt that is gone', async () => {
    const first = (await api('/api/prompts')).json.prompts[3];
    assert.strictEqual((await api('/api/prompts/star', { id: first.id, on: true })).json.prompt.starred, true);
    assert.strictEqual((await api('/api/prompts')).json.prompts.find(p => p.id === first.id).starred, true);
    await api('/api/prompts/star', { id: first.id, on: false });
    assert.strictEqual((await api('/api/prompts')).json.prompts.find(p => p.id === first.id).starred, undefined);
    const gone = await api('/api/prompts/star', { id: 'nope', on: true });
    assert(gone.json.ok === false && /not on the list/.test(gone.json.error), JSON.stringify(gone.json));
  });
  await check('prompts: a new category goes at the end; a name already used (any case) or empty is refused', async () => {
    const r = (await api('/api/prompts/category/save', { name: '  My   tests ' })).json;
    assert(r.ok && r.category.name === 'My tests', JSON.stringify(r));
    catId = r.category.id;
    assert.strictEqual((await api('/api/prompts')).json.categories.slice(-1)[0].id, catId);
    const a = (await api('/api/prompts/category/save', { name: 'my TESTS' })).json;
    const b = (await api('/api/prompts/category/save', { name: ' ' })).json;
    const c = (await api('/api/prompts/category/save', { name: 'x'.repeat(61) })).json;
    assert(!a.ok && /already/.test(a.error) && !b.ok && /no name/.test(b.error) && !c.ok && /60/.test(c.error), JSON.stringify([a, b, c]));
  });
  await check('prompts: add keeps the text exactly (line breaks as \\n, trailing blank lines dropped)', async () => {
    const r = (await api('/api/prompts/save', { category: catId, title: '  Review a change ', text: 'Line one\r\n  - indented "quoted" <b>\r\n\r\n' })).json;
    assert(r.ok, JSON.stringify(r));
    assert.strictEqual(r.prompt.title, 'Review a change');
    assert.strictEqual(r.prompt.text, 'Line one\n  - indented "quoted" <b>');
    firstId = r.prompt.id;
    assert.strictEqual(JSON.parse(fs.readFileSync(promptFile, 'utf8')).prompts[0].id, firstId);
  });
  await check('prompts: a prompt needs a category that exists', async () => {
    const a = (await api('/api/prompts/save', { title: 'x', text: 'y' })).json;
    const b = (await api('/api/prompts/save', { category: 'nope', title: 'x', text: 'y' })).json;
    assert(!a.ok && /category/.test(a.error) && !b.ok && /Reload/.test(b.error), JSON.stringify([a, b]));
  });
  await check('prompts: a new one goes to the top', async () => {
    assert((await api('/api/prompts/save', { category: catId, title: 'Second', text: 'two' })).json.ok);
    const list = mine((await api('/api/prompts')).json.prompts);
    assert.deepStrictEqual(list.map(p => p.title), ['Second', 'Review a change']);
  });
  await check('prompts: edit changes that prompt in place and keeps its id', async () => {
    const r = (await api('/api/prompts/save', { id: firstId, category: catId, title: 'Review it', text: 'new text' })).json;
    assert(r.ok && r.prompt.id === firstId, JSON.stringify(r));
    const list = mine((await api('/api/prompts')).json.prompts);
    assert.deepStrictEqual(list.map(p => [p.title, p.text]), [['Second', 'two'], ['Review it', 'new text']]);
  });
  await check('prompts: no name / empty text / too long are refused with a way out, nothing saved', async () => {
    const before = fs.readFileSync(promptFile, 'utf8');
    const a = (await api('/api/prompts/save', { category: catId, title: ' ', text: 'x' })).json;
    const b = (await api('/api/prompts/save', { category: catId, title: 'x', text: ' \n ' })).json;
    const c = (await api('/api/prompts/save', { category: catId, title: 'x', text: 'y'.repeat(20001) })).json;
    const d = (await api('/api/prompts/save', { category: catId, title: 'x'.repeat(121), text: 'y' })).json;
    assert(!a.ok && /no name/.test(a.error) && !b.ok && /empty/.test(b.error) && !c.ok && /20000/.test(c.error) && !d.ok && /120/.test(d.error), JSON.stringify([a, b, c, d]));
    assert.strictEqual(fs.readFileSync(promptFile, 'utf8'), before);
  });
  await check('prompts: a 20,000-character prompt fits (bigger body than the other routes)', async () => {
    const r = (await api('/api/prompts/save', { category: catId, title: 'Long', text: 'é"\n'.repeat(6666) + 'xy' })).json;
    assert(r.ok && r.prompt.text.length === 20000, JSON.stringify(r).slice(0, 200));
  });
  await check('prompts: editing or removing a prompt that is gone is refused', async () => {
    const a = (await api('/api/prompts/save', { id: 'nope', category: catId, title: 'x', text: 'y' })).json;
    const b = (await api('/api/prompts/remove', { id: 'nope' })).json;
    assert(!a.ok && /Reload/.test(a.error) && !b.ok && /Reload/.test(b.error));
  });
  await check('prompts: remove takes only that one', async () => {
    assert((await api('/api/prompts/remove', { id: firstId })).json.ok);
    const list = mine((await api('/api/prompts')).json.prompts);
    assert(!list.some(p => p.id === firstId) && list.length === 2);
  });
  await check('prompts: rename keeps the id; a prompt can move to another category', async () => {
    const r = (await api('/api/prompts/category/save', { id: catId, name: 'Renamed' })).json;
    assert(r.ok && r.category.id === catId && r.category.name === 'Renamed', JSON.stringify(r));
    const p = mine((await api('/api/prompts')).json.prompts)[0];
    assert((await api('/api/prompts/save', { id: p.id, category: 'starter-photo', title: p.title, text: p.text })).json.ok);
    const all = (await api('/api/prompts')).json.prompts;
    assert.strictEqual(all.find(x => x.id === p.id).category, 'starter-photo');
    assert.strictEqual(mine(all).length, 1);
    assert((await api('/api/prompts/remove', { id: p.id })).json.ok);
  });
  await check('prompts: deleting a category deletes the prompts in it and nothing else', async () => {
    const before = (await api('/api/prompts')).json;
    const r = (await api('/api/prompts/category/remove', { id: catId })).json;
    assert(r.ok && r.prompts === 1, JSON.stringify(r));
    const after = (await api('/api/prompts')).json;
    assert.strictEqual(after.categories.length, before.categories.length - 1);
    assert.strictEqual(after.prompts.length, before.prompts.length - 1);
    const again = (await api('/api/prompts/category/remove', { id: catId })).json;
    assert(!again.ok && /Reload/.test(again.error));
  });
  await check('prompts: the list needs the per-run key', async () => { const r = await fetch(BASE + '/api/prompts'); assert.strictEqual(r.status, 403); });
  await check('live checks: every 15 minutes to start; 5 and 10 can be chosen and are kept; anything else is refused', async () => {
    assert.strictEqual((await api('/api/stats')).json.liveEvery, 15);
    const bad = (await api('/api/live/every', { minutes: 7 })).json;
    assert(!bad.ok && /5, 10 or 15/.test(bad.error), JSON.stringify(bad));
    const r = (await api('/api/live/every', { minutes: 5 })).json;
    assert(r.ok && r.every === 5 && (await api('/api/stats')).json.liveEvery === 5);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).liveEveryMin, 5);
    assert((await api('/api/live/every', { minutes: 15 })).json.ok);
  });

  await check('a second office on the same port exits cleanly (one office at a time)', async () => {
    const code = await new Promise(res => { const b = spawn(NODE, [path.join(__dirname, '..', 'server.js'), '--dry-run'], { env: { ...process.env, AHO_PORT: String(PORT), AHO_DATA: DATA, AHO_ROOT: WS }, stdio: 'ignore' }); b.on('exit', res); });
    assert.strictEqual(code, 0);
  });
  await check('Quit stops the office', async () => {
    await api('/api/quit', {});
    let up = true;
    for (let i = 0; i < 30 && up; i++) { await sleep(200); up = await portOpen(PORT); }
    assert(!up, 'the office was still listening on ' + PORT + ' after Quit');
  });

  srv.kill();
  for (const d of [DATA, extra, wf, WS]) fs.rmSync(d, { recursive: true, force: true });
  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
}
main();
