// The office stays up and points at the right site when projects are odd: bad start entries, two projects on one
// port, a merged alternate port, npm/npx and other Windows scripts, folders added beside each other, names that
// resolve to this PC, other tenants of a shared host, a port holder that never answers, oversized requests.
// Everything runs over a made-up working folder in a temp folder and a test copy on a free port (dry run).
// Run: node test/robust.test.js   (Windows; no packages)
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const { listProjects, projectId } = require('../lib/projects');
const platform = require('../lib/platform');
const live = require('../lib/live');

const NODE = process.execPath;
const SERVER = path.join(__dirname, '..', 'server.js');
const SITE = path.join(__dirname, '..', 'demo', 'site.js');
let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const portOpen = port => new Promise(r => { const s = net.connect(port, '127.0.0.1'); s.setTimeout(1000, () => { s.destroy(); r(false); }); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
const PAGE = '<!doctype html><title>Made-up</title><p>A made-up site.</p>';

const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-robust-'));
function make(folder, files) {
  const d = path.join(WS, folder);
  fs.mkdirSync(d, { recursive: true });
  for (const [rel, text] of Object.entries(files)) { const p = path.join(d, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
  return d;
}
const launch = (...configs) => JSON.stringify({ version: '0.0.1', configurations: configs });

async function main() {
  // ---- 1. The list: bad start entries (S1), root entries (S7), stable ids (S5) ----
  make('bad-object', { '.claude/launch.json': '{"configurations":{}}' });
  make('bad-null', { '.claude/launch.json': '{"configurations":[null]}' });
  make('bad-args', { 'project.json': '{"start":{"exe":"node","args":"server.js","port":5000}}' });
  make('bad-exe', { '.claude/launch.json': launch({ name: 'x', runtimeExecutable: 42, port: 5001 }) });
  make('array-project', { 'project.json': '[1,2,3]' });
  make('good', { '.claude/launch.json': launch({ name: 'good', runtimeExecutable: 'node', runtimeArgs: ['server.js'], port: 5002 }) });
  make('dev', { 'README.md': '# A project that happens to be called dev\n' });
  make('public', { 'index.html': PAGE });
  make('shop', { 'server.js': '// made-up\n' });
  make('.claude', { 'launch.json': launch(
    { name: 'root-dev', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 5100 },
    { name: 'root-vite', runtimeExecutable: 'npx', runtimeArgs: ['vite', 'dev'], port: 5104 },
    { name: 'root-public', runtimeExecutable: 'npx', runtimeArgs: ['serve', 'public'], port: 5101 },
    { name: 'root-shop', runtimeExecutable: 'node', runtimeArgs: ['shop/server.js'], port: 5102 },
    { name: 'root-missing', runtimeExecutable: 'node', runtimeArgs: ['shop/missing.js'], port: 5103 },
    null,
  ) });
  const settings = { workingFolders: [WS], extraProjects: [], hidden: [], liveUrls: {} };
  const opts = { overridesFile: path.join(WS, 'none.json') };
  let rows;
  await check('S1: a folder of odd project files still lists every project, nothing throws', () => {
    rows = listProjects(settings, opts);
    for (const f of ['bad-object', 'bad-null', 'bad-args', 'bad-exe', 'array-project', 'good']) assert(rows.some(r => r.folder === f), f + ' missing');
  });
  const row = f => rows.find(r => r.folder === f);
  await check('S1: a bad start entry is skipped and counted, never trusted', () => {
    for (const f of ['bad-null', 'bad-args', 'bad-exe']) { assert.strictEqual(row(f).commands.length, 0, f); assert(row(f).startSkipped.length, f + ' not counted'); }
    assert.strictEqual(row('bad-object').commands.length, 0);
    assert.strictEqual(row('good').commands.length, 1);
  });
  await check('S7: "npm run dev" and "vite dev" in the root launch.json do not attach to a folder called dev', () => assert.strictEqual(row('dev').commands.length, 0, JSON.stringify(row('dev').commands)));
  await check('S7: a root entry attaches where its argument is a path inside the folder (serve public, shop/server.js)', () => {
    assert.deepStrictEqual(row('public').commands.map(c => c.name), ['root-public']);
    assert.deepStrictEqual(row('shop').commands.map(c => c.name), ['root-shop']);
  });
  const before = new Map(rows.map(r => [r.folder, r.id]));
  make('my-site', { 'README.md': '# one\n' });
  const myId = listProjects(settings, opts).find(r => r.folder === 'my-site').id;
  make('my site', { 'README.md': '# two\n' });
  make('Ωμέγα', { 'README.md': '# three\n' });
  make('Δέλτα', { 'README.md': '# four\n' });
  const after = listProjects(settings, opts);
  await check('S5: adding "my site" beside "my-site" leaves every existing id as it was', () => {
    assert.strictEqual(after.find(r => r.folder === 'my-site').id, myId);
    for (const [f, id] of before) assert.strictEqual(after.find(r => r.folder === f).id, id, f);
    assert.notStrictEqual(after.find(r => r.folder === 'my site').id, myId);
  });
  await check('S5: two folders with no plain letters get two different ids', () => {
    const a = after.find(r => r.folder === 'Ωμέγα').id, b = after.find(r => r.folder === 'Δέλτα').id;
    assert(a !== b && /^project-[0-9a-f]{6}$/.test(a), a + ' / ' + b);
  });
  await check('S5: the id is the same for the same folder however the path is written', () => assert.strictEqual(projectId(path.join(WS, 'good')), projectId(path.join(WS, 'GOOD') + path.sep)));

  // ---- 2. Windows scripts (S3) ----
  await check('S3: npm and npx become node + their own script (no shell)', () => {
    if (process.platform !== 'win32' || !platform.onPath('npm')) return;
    const r = platform.runnable('npm', ['run', 'dev']);
    assert(/node(\.exe)?$/i.test(r.exe) && /npm-cli\.js$/.test(r.args[0]) && r.args[1] === 'run', JSON.stringify(r));
    assert(/npx-cli\.js$/.test(platform.runnable('npx', ['serve']).args[0]));
  });
  await check('S3: a .cmd script with an argument cmd would read as a command is refused, with the reason', () => {
    if (process.platform !== 'win32') return;
    const r = platform.runnable(path.join(WS, 'tool.cmd'), ['a&calc']);
    assert(r.error && /command/.test(r.error), JSON.stringify(r));
  });

  // ---- 3. Live addresses (L1, S11) ----
  await check('L1: another tenant of a shared host is not "the site itself"', () => {
    assert(!live.isOwn('mallory.github.io', 'alice.github.io'));
    assert(!live.isOwn('evil.netlify.app', 'shop.netlify.app'));
    assert(live.isOwn('cdn.alice.github.io', 'alice.github.io'));
    assert(live.isOwn('www.example.com', 'example.com'));
  });
  await check('L1: a private address is never the site itself', () => assert(!live.isOwn('192.168.1.20', 'example.com') && !live.isOwn('10.0.0.5', 'example.com')));
  await check('S11: a public-looking name that resolves to this PC is refused when the request is made', async () => {
    const r = await live.get('http://127.0.0.1.nip.io:9/', { timeout: 4000 });
    if (r.error && /ENOTFOUND|EAI_AGAIN/.test(r.error.code)) return console.log('     (offline: name not resolved; checked the address test instead)'), assert(live.isPrivateIp('127.0.0.1') && live.isPrivateIp('::ffff:192.168.0.4') && live.isPrivateIp('fd00::1') && !live.isPrivateIp('93.184.216.34'));
    assert(r.error && r.error.code === 'BLOCKED', JSON.stringify(r.error));
  });

  // ---- 4. A test copy of the office over this folder ----
  const pA = await freePort(), pAlt1 = await freePort(), pAlt2 = await freePort();
  // Two projects on one port (S2), and one app on two ports (S9).
  make('alpha', { 'public/index.html': PAGE, '.claude/launch.json': launch({ name: 'alpha', runtimeExecutable: NODE, runtimeArgs: [SITE, String(pA), '.'], port: pA }) });
  make('beta', { 'public/index.html': PAGE, '.claude/launch.json': launch({ name: 'beta', runtimeExecutable: NODE, runtimeArgs: [SITE, String(pA), '.'], port: pA }) });
  make('gamma', { 'public/index.html': PAGE, '.claude/launch.json': launch(
    { name: 'gamma', runtimeExecutable: NODE, runtimeArgs: [SITE, String(pAlt1), '.'], port: pAlt1 },
    { name: 'gamma-2', runtimeExecutable: NODE, runtimeArgs: [SITE, String(pAlt2), '.'], port: pAlt2 }) });
  // An npm-style .cmd start (S3): a Windows script that starts node.
  const pCmd = await freePort();
  make('cmd-site', { 'public/index.html': PAGE, 'serve.cmd': '@echo off\r\n"' + NODE + '" "' + SITE + '" %1 .\r\n',
    '.claude/launch.json': launch({ name: 'cmd', runtimeExecutable: 'serve.cmd', runtimeArgs: [String(pCmd)], port: pCmd }) });
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-robust-data-'));
  const PORT = await freePort();
  const env = { ...process.env, AHO_TEST_LOCAL_LIVE: '1', AHO_PORT: String(PORT), AHO_DATA: DATA, AHO_ROOT: WS, AHO_TRANSCRIPTS: path.join(DATA, 'transcripts') };
  const srv = spawn(NODE, [SERVER, '--dry-run'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; srv.stdout.on('data', d => { out += d; }); srv.stderr.on('data', d => { out += d; });
  const outside = [];
  try {
    for (let i = 0; i < 50 && !(await portOpen(PORT)); i++) await sleep(200);
    const BASE = 'http://127.0.0.1:' + PORT;
    const key = ((await (await fetch(BASE + '/')).text()).match(/name="aho-key" content="([0-9a-f]+)"/) || [])[1];
    const post = async (p, body, raw) => {
      const res = await fetch(BASE + p, { method: body !== undefined ? 'POST' : 'GET', headers: { 'X-AHO-Key': key, 'Content-Type': 'application/json' }, body: raw || (body !== undefined ? JSON.stringify(body) : undefined) });
      return { status: res.status, json: await res.json().catch(() => ({})) };
    };
    // Run asks first for a command not seen before: these made-up projects are the test's own, so the helper says yes.
    const api = async (p, body, raw) => {
      const r = await post(p, body, raw);
      return p === '/api/start' && r.json && r.json.needsTrust ? post(p, { ...body, trust: r.json.needsTrust.fp }) : r;
    };
    const list = async () => (await api('/api/projects?fresh=1')).json.projects;
    const idOf = async folder => (await list()).find(p => p.folder === folder).id;

    await check('S1: the office starts over the odd folders and lists them', async () => { const l = await list(); assert(l.some(p => p.folder === 'bad-null') && l.some(p => p.folder === 'good')); });
    await check('G2: the data folder gets a .gitignore of everything', () => assert(/^\*$/m.test(fs.readFileSync(path.join(DATA, '.gitignore'), 'utf8'))));
    await check('S1: a bad file written while it runs, then a fresh list and Check now: the office stays up', async () => {
      make('late-bad', { '.claude/launch.json': '{"configurations":[null, 7, "x"]}', 'project.json': '{"start":{"exe":["node"]}}' });
      const site = http.createServer((q, s) => s.end(PAGE)); await new Promise(r => site.listen(0, '127.0.0.1', r)); outside.push(site);
      const set = await api('/api/live/set', { id: await idOf('good'), url: 'http://127.0.0.1:' + site.address().port + '/' });
      assert(set.json.ok, JSON.stringify(set.json));
      assert((await api('/api/live/check-all', {})).json.ok);
      await sleep(1500);
      assert(await portOpen(PORT), 'the office stopped');
      assert((await list()).some(p => p.folder === 'late-bad'));
    });
    await check('U2: an oversized request is answered 413 with a reason, not a dropped connection', async () => {
      const r = await api('/api/scan', null, JSON.stringify({ pad: 'x'.repeat(20000) }));
      assert.strictEqual(r.status, 413); assert(/more than the office takes/.test(r.json.error), JSON.stringify(r.json));
    });

    const alpha = await idOf('alpha'), beta = await idOf('beta');
    await check('S2: with alpha running on the shared port, beta\'s Open and Scan do not use alpha\'s site', async () => {
      const s = await api('/api/start', { id: alpha, key: '0', open: false });
      assert(s.json.ok, JSON.stringify(s.json));
      const o = (await api('/api/open-browser', { id: beta, key: '0' })).json;
      assert(!o.ok && /alpha/i.test(o.error), JSON.stringify(o));
      const a = (await api('/api/audit', { id: beta })).json;
      assert(!a.audit.url, 'beta was audited against ' + a.audit.url);
      const a2 = (await api('/api/audit', { id: alpha })).json;
      assert(a2.audit.url && a2.audit.url.includes(':' + pA + '/'), 'alpha was not audited on its own site');
      await api('/api/stop', { id: alpha });
    });
    await check('S9: a merged alternate port held by another program is the site that gets scanned', async () => {
      const gamma = (await list()).find(p => p.folder === 'gamma');
      assert.strictEqual(gamma.commands.length, 1, 'the two gamma entries were not merged');
      const site = http.createServer((q, s) => s.end(PAGE)); await new Promise(r => site.listen(pAlt2, '127.0.0.1', r)); outside.push(site);
      const a = (await api('/api/audit', { id: gamma.id })).json;
      assert(a.audit.url && a.audit.url.includes(':' + pAlt2 + '/'), 'audited ' + a.audit.url);
    });
    await check('S3: a project started by a Windows .cmd script comes up (no 20 s wait, no ENOENT)', async () => {
      if (process.platform !== 'win32') return;
      const t = Date.now();
      const s = (await api('/api/start', { id: await idOf('cmd-site'), key: '0', open: false })).json;
      assert(s.ok, JSON.stringify(s));
      assert(Date.now() - t < 15000);
      await api('/api/stop', { id: await idOf('cmd-site') });
    });
    await check('S3: a program that does not exist fails at once, not after 20 s', async () => {
      make('no-such-program', { '.claude/launch.json': launch({ name: 'x', runtimeExecutable: 'no-such-program-' + Date.now() + '.exe', port: await freePort() }) });
      const t = Date.now();
      const s = (await api('/api/start', { id: await idOf('no-such-program'), key: '0', open: false })).json;
      assert(!s.ok && /Could not start/.test(s.error), JSON.stringify(s));
      assert(Date.now() - t < 8000, 'took ' + (Date.now() - t) + ' ms');
    });
    await check('S4: a program that ends at once is reported at once, with its exit code, not after 20 s', async () => {
      make('ends-at-once', { '.claude/launch.json': launch({ name: 'x', runtimeExecutable: NODE, runtimeArgs: ['-e', 'process.exit(3)'], port: await freePort() }) });
      const t = Date.now();
      const s = (await api('/api/start', { id: await idOf('ends-at-once'), key: '0', open: false })).json;
      assert(!s.ok && /ended by itself/.test(s.error) && /exit code 3/.test(s.error), JSON.stringify(s));
      assert(Date.now() - t < 6000, 'took ' + (Date.now() - t) + ' ms');
      assert(!(await list()).find(p => p.folder === 'ends-at-once').running, 'still shown as running');
    });
    await check('S5: two Run requests at once start one copy; the other is told it is already starting', async () => {
      const port = await freePort();
      make('double-run', { '.claude/launch.json': launch({ name: 'x', runtimeExecutable: NODE, runtimeArgs: ['-e', "require('http').createServer((q, s) => s.end('ok')).listen(" + port + ", '127.0.0.1')"], port }) });
      const id = await idOf('double-run');
      // The yes to its first-run question, taken first (the question itself starts nothing).
      const trust = (await post('/api/start', { id, key: '0', open: false })).json.needsTrust.fp;
      // Two separate connections, sent together (one connection would carry them one after the other).
      const startOnOwnConnection = () => new Promise((resolve, reject) => {
        const body = JSON.stringify({ id, key: '0', open: false, trust });
        const req = http.request(BASE + '/api/start', { method: 'POST', agent: false, headers: { 'X-AHO-Key': key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
          let t = ''; res.on('data', c => { t += c; }); res.on('end', () => { try { resolve(JSON.parse(t)); } catch (e) { reject(e); } });
        });
        req.on('error', reject);
        req.end(body);
      });
      const answers = await Promise.all([startOnOwnConnection(), startOnOwnConnection()]);
      assert.strictEqual(answers.filter(r => r.ok && !r.already).length, 1, JSON.stringify(answers));
      assert(answers.some(r => /already starting/.test(r.error || '') || r.already), JSON.stringify(answers));
      assert((await list()).find(p => p.folder === 'double-run').running, 'the one copy is shown as running');
      await api('/api/stop', { id });
      for (let i = 0; i < 20 && (await new Promise(r => { const c = net.connect(port, '127.0.0.1', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); })); i++) await new Promise(r => setTimeout(r, 250));
      const still = await new Promise(r => { const c = net.connect(port, '127.0.0.1', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); });
      assert(!still, 'a second copy was left running on port ' + port + ' after Stop');
    });
    await check('U3: a character split between two network chunks comes through whole', async () => {
      const { readBody } = require('../lib/http');
      const { EventEmitter } = require('events');
      const req = new EventEmitter();
      const bytes = Buffer.from(JSON.stringify({ text: 'café — ok' }), 'utf8');
      const cut = bytes.indexOf(Buffer.from('é', 'utf8')) + 1; // between the two bytes of é
      const p = readBody(req, 1000);
      req.emit('data', bytes.subarray(0, cut)); req.emit('data', bytes.subarray(cut)); req.emit('end');
      assert.strictEqual((await p).text, 'café — ok');
    });
    await check('U4: projects.json keys match a folder in any letter case', async () => {
      const ovf = path.join(WS, 'overrides-case.json');
      fs.writeFileSync(ovf, JSON.stringify({ projects: { 'GOOD': { name: 'Good Named' } } }));
      const rows = listProjects({ workingFolders: [WS], extraProjects: [], hidden: [], known: [], hiddenView: [], order: [] }, { overridesFile: ovf });
      assert.strictEqual((rows.find(p => p.folder === 'good') || {}).name, 'Good Named');
    });
    await check('U1: an added project whose folder is gone can be taken off by its path', async () => {
      const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-robust-added-'));
      assert((await api('/api/projects/add', { path: elsewhere })).json.ok);
      fs.rmSync(elsewhere, { recursive: true, force: true });
      assert((await api('/api/settings')).json.extraProjects.some(x => !x.exists));
      assert((await api('/api/projects/forget', { path: elsewhere })).json.ok);
      assert(!(await api('/api/settings')).json.extraProjects.length);
    });
    await check('S10: the list revision moves when another program starts on a project port (within ~35 s)', async () => {
      const rev0 = (await api('/api/stats')).json.rowsRev;
      const pGood = (await list()).find(p => p.folder === 'beta').commands[0].port;
      const site = http.createServer((q, s) => s.end(PAGE)); await new Promise(r => site.listen(pGood, '127.0.0.1', r)); outside.push(site);
      let rev = rev0;
      for (let i = 0; i < 40 && rev === rev0; i++) { await sleep(1000); rev = (await api('/api/stats')).json.rowsRev; }
      assert.notStrictEqual(rev, rev0, 'rowsRev never moved');
    });
    await check('S4: --status names a running office as running', () => {
      const r = spawnSync(NODE, [SERVER, '--status', '--port=' + PORT], { env, encoding: 'utf8', timeout: 15000 });
      assert(/The office is running/.test(r.stdout) && r.status === 0, r.stdout + r.stderr);
    });
  } finally {
    for (const s of outside) s.close();
    try { await fetch('http://127.0.0.1:' + PORT + '/api/quit', { method: 'POST' }); } catch {}
    srv.kill();
  }

  // ---- 5. Start-up and --status against a port that is not the office (S4, S8) ----
  // Its own process: spawnSync below holds this one's event loop, so a server here could not answer.
  const pOther = await freePort();
  const other = spawn(NODE, ['-e', "require('http').createServer((q, s) => s.end('hello')).listen(" + pOther + ", '127.0.0.1')"], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await portOpen(pOther)); i++) await sleep(100);
  await check('S4: --status does not take another program on the port for the office', () => {
    const r = spawnSync(NODE, [SERVER, '--status', '--port=' + pOther], { env: { ...process.env, AHO_DATA: DATA }, encoding: 'utf8', timeout: 15000 });
    assert(/another program/.test(r.stdout) && r.status === 1, r.stdout + r.stderr);
  });
  other.kill();
  // Takes the connection and never answers, in its own process (spawnSync below freezes this one).
  const pSilent = await freePort();
  const silent = spawn(NODE, ['-e', "const k=[];require('net').createServer(s=>k.push(s)).listen(" + pSilent + ", '127.0.0.1')"], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await portOpen(pSilent)); i++) await sleep(100);
  await check('S8: a port holder that never answers does not leave start-up waiting (gone in a few seconds, with the reason)', () => {
    const t = Date.now();
    const s8 = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-robust-s8-'));
    const r = spawnSync(NODE, [SERVER, '--dry-run'], { env: { ...process.env, AHO_PORT: String(pSilent), AHO_DATA: s8, AHO_ROOT: WS }, encoding: 'utf8', timeout: 20000 });
    fs.rmSync(s8, { recursive: true, force: true });
    assert(Date.now() - t < 12000, 'took ' + (Date.now() - t) + ' ms');
    assert(/does not answer/.test(r.stderr + r.stdout), r.stdout + r.stderr);
  });
  silent.kill();

  // ---- 6. The link with an & in the folder name (S6) ----
  await check('S6: start.cmd registers the link through the office\'s own code, never a hand-quoted reg line', () => {
    const cmd = fs.readFileSync(path.join(__dirname, '..', 'start.cmd'), 'utf8');
    assert(!/^\s*reg add/im.test(cmd) && /link\('create', process\.cwd\(\)\)/.test(cmd));
  });
  await check('S6: a folder named with & is registered whole, as one quoted path', () => {
    if (process.platform !== 'win32') return;
    const key = 'HKCU\\Software\\Classes\\aho-robust-test-' + process.pid;
    const dir = path.join(WS, 'odd & folder');
    const r = spawnSync(NODE, ['-e', "console.log(JSON.stringify(require('./lib/platform').link('create', process.argv[1])))", dir], { cwd: path.join(__dirname, '..'), env: { ...process.env, AHO_LINK_KEY: key }, encoding: 'utf8' });
    const q = spawnSync('reg.exe', ['query', key + '\\shell\\open\\command', '/ve'], { encoding: 'utf8' });
    spawnSync('reg.exe', ['delete', key, '/f'], { stdio: 'ignore' });
    assert(JSON.parse(r.stdout).here, r.stdout + r.stderr);
    assert(q.stdout.includes('"' + process.execPath + '" "' + path.join(dir, 'lib', 'platform', 'windows', 'link-start.js') + '" "%1"'), q.stdout);
  });
  await check('S7: the link runs node with link-start.js, which never reads the address it is given', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'platform', 'windows', 'link-start.js'), 'utf8').replace(/\/\/.*$/gm, '');
    assert(!/process\.argv|process\.env\.(?!SystemRoot)/.test(src), 'link-start.js reads its arguments or the environment');
    assert(/\['\/d', '\/c', path\.join\(folder, 'start\.cmd'\), 'quiet'\]/.test(src), 'start.cmd is started with the fixed word quiet only');
  });

  await check('data files: a save cut short leaves the old file as it was; a damaged file is set aside, never wiped', () => {
    const { saveJson, loadJson } = require('../lib/settings');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-save-'));
    try {
      const f = path.join(dir, 'judged.json');
      saveJson(f, { projects: { a: [1] } });
      assert.throws(() => saveJson(f, { big: 1n }), 'a value that cannot be written');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { projects: { a: [1] } }, 'the old file is untouched');
      assert.deepStrictEqual(fs.readdirSync(dir), ['judged.json'], 'no temporary file left behind');
      fs.writeFileSync(f, '{"projects": {"a": [1');
      assert.strictEqual(loadJson(f, null), null);
      const aside = fs.readdirSync(dir).filter(n => /^judged\.damaged-.*\.json$/.test(n));
      assert.strictEqual(aside.length, 1, 'the damaged file is copied aside before anything replaces it');
      assert.strictEqual(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), '{"projects": {"a": [1');
      assert.strictEqual(loadJson(path.join(dir, 'none.json'), 'fallback'), 'fallback', 'a file not there is simply empty');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await check('logs: a local copy\'s log past its limit is cut back, with a note saying so', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-logcap-'));
    try {
      const log = path.join(dir, 'site.log');
      fs.writeFileSync(log, 'x'.repeat(5000));
      // In its own process with its own data folder: loading the office's state writes a settings file.
      const script = "const { state } = require('./lib/state'); state.running.set('t', { log: process.argv[1] }); require('./lib/runner').capLogs(1000);";
      const r = require('child_process').spawnSync(NODE, ['-e', script, log], { cwd: path.join(__dirname, '..'), env: { ...process.env, AHO_DATA: dir, AHO_ROOT: dir }, encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stderr);
      const text = fs.readFileSync(log, 'utf8');
      assert(text.length < 300 && /cut this log at/.test(text) && !text.includes('xxx'), text.slice(0, 200));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  try { fs.rmSync(WS, { recursive: true, force: true }); fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
