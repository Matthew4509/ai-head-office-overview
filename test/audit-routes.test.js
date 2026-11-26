// Server and API routes, attacked: data files that are damaged, held by another program or read-only, a stale
// run.json, a slow live check overtaken by a newer one, and odd values from the page. Each test is named after the
// fault it proves; a test marked todo is a lesser fault (P1/P2) that the suite reports without failing.
// It starts its own test copy (dry run, port 8890) over made-up projects in its own temp folder, with a stand-in
// live site on 127.0.0.1:8894. Nothing outside that temp folder is read or changed. Windows only (PowerShell holds a file).
// Run: node test/audit-routes.test.js
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 8890;
const LIVE_PORT = 8894;
const NODE = process.execPath;
const SERVER = path.join(__dirname, '..', 'server.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-audit-routes-'));
const DATA = path.join(TMP, 'data');
const WS = path.join(TMP, 'projects');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const portOpen = port => new Promise(r => { const s = net.connect(port, '127.0.0.1'); s.setTimeout(1000, () => { s.destroy(); r(false); }); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });

function envFor(data, port) {
  return { ...process.env, AHO_PORT: String(port), AHO_DATA: data, AHO_SETTINGS: path.join(TMP, 'claude-settings.json'), AHO_APP_SESSIONS: path.join(TMP, 'app-sessions'),
    AHO_TRANSCRIPTS: path.join(TMP, 'transcripts'), AHO_ROOT: WS, AHO_SHORTCUT_DIR: path.join(TMP, 'shortcuts'),
    AHO_LINK_KEY: 'HKCU\\Software\\Classes\\aho-audit-routes-test-throwaway', AHO_OPEN: '0', AHO_TEST_LOCAL_LIVE: '1', AHO_LOG: '0' };
}
function killTree(pid) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }

let srv = null, KEY = '';
function call(method, p, body, headers = {}) {
  return new Promise(resolve => {
    const h = { Host: '127.0.0.1:' + PORT, 'X-AHO-Key': KEY, ...headers };
    if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: h, timeout: 30000 }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', c => { b += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: b, json }); });
    });
    r.on('error', e => resolve({ status: 0, body: String(e.code || e.message), json: null }));
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}
const get = p => call('GET', p);
const post = (p, b) => call('POST', p, b);
const dataFile = n => path.join(DATA, n);
const readJson = n => JSON.parse(fs.readFileSync(dataFile(n), 'utf8'));

// Another program holding a file with no sharing (as a virus scanner or a sync tool can): PowerShell opens it for
// `seconds`. Resolves once the file really is held (Node then cannot open it).
function hold(file, seconds) {
  const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    "$f=[System.IO.File]::Open('" + file.replace(/'/g, "''") + "','Open','ReadWrite','None'); Start-Sleep -Seconds " + seconds + '; $f.Close()'], { stdio: 'ignore' });
  const done = new Promise(r => ps.on('exit', r));
  return (async () => {
    for (let i = 0; i < 100; i++) {
      try { fs.readFileSync(file); } catch (e) { if (e.code === 'EBUSY' || e.code === 'EPERM') return { done }; }
      await sleep(100);
    }
    throw new Error('could not hold ' + file);
  })();
}

async function startOffice(data, port) {
  const child = spawn(NODE, [SERVER, '--dry-run', '--port=' + port], { cwd: path.join(__dirname, '..'), env: envFor(data, port), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  let exited = null; child.on('exit', c => { exited = c; });
  for (let i = 0; i < 50 && exited === null && !(await portOpen(port)); i++) await sleep(200);
  return { child, out: () => out, exited: () => exited };
}

before(async () => {
  for (const d of ['alpha-site', 'beta-notes']) {
    fs.mkdirSync(path.join(WS, d), { recursive: true });
    fs.writeFileSync(path.join(WS, d, 'README.md'), '# ' + d + '\n\nA made-up project for this test.\n');
  }
  fs.mkdirSync(path.join(TMP, 'transcripts'), { recursive: true });
  fs.mkdirSync(DATA, { recursive: true });
  if (await portOpen(PORT)) throw new Error('Port ' + PORT + ' is in use: stop whatever holds it, then run the test again.');
  if (await portOpen(LIVE_PORT)) throw new Error('Port ' + LIVE_PORT + ' is in use: stop whatever holds it, then run the test again.');
});

after(() => {
  if (srv) killTree(srv.child.pid);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

// ---- before the main test copy starts: a stale run.json ----
test('R-10: a stale run.json naming another port and a process id that is now some other program does not stop the office from starting', { todo: 'P1' }, async () => {
  const data = path.join(TMP, 'data-stale');
  fs.mkdirSync(data, { recursive: true });
  // The office that wrote this ran on another port and was killed without tidying up; Windows has since given its
  // process id to another program (here: this test's own process, which is certainly running).
  fs.writeFileSync(path.join(data, 'run.json'), JSON.stringify({ pid: process.pid, port: 8899, key: 'x'.repeat(36), started: new Date(0).toISOString() }));
  const o = await startOffice(data, PORT);
  try {
    const up = await portOpen(PORT);
    assert.ok(up, 'the office refused to start: ' + o.out().trim().split('\n').pop());
  } finally { killTree(o.child.pid); for (let i = 0; i < 20 && await portOpen(PORT); i++) await sleep(200); }
});

test('main test copy starts', async () => {
  srv = await startOffice(DATA, PORT);
  assert.ok(await portOpen(PORT), 'office did not start: ' + srv.out());
  const page = (await get('/')).body;
  KEY = (page.match(/name="aho-key" content="([0-9a-f]+)"/) || [])[1];
  assert.ok(KEY, 'page carries the key');
  // wait for the project list
  for (let i = 0; i < 50; i++) { const r = await get('/api/projects'); if (r.json && r.json.projects && r.json.projects.length >= 2) break; await sleep(200); }
});

const idOf = async name => (await get('/api/projects')).json.projects.find(p => p.name === name).id;

test('R-01: a damaged categories.json does not wipe every project\'s categories out of priorities.json on the next planner save', async () => {
  const alpha = await idOf('alpha-site'), beta = await idOf('beta-notes');
  const c = await post('/api/priorities/category/save', { name: 'Clients' });
  assert.ok(c.json && c.json.ok, c.body);
  const cat = c.json.category.id;
  const s = await post('/api/priorities/set', { id: alpha, categories: [cat] });
  assert.ok(s.json && s.json.ok, s.body);
  const keyAlpha = Object.keys(readJson('priorities.json').projects).find(k => k.endsWith('alpha-site'));
  assert.deepStrictEqual(readJson('priorities.json').projects[keyAlpha].categories, [cat]);
  // categories.json is cut short (the PC turned off mid-write by another tool, an edit by hand): it is set aside...
  fs.writeFileSync(dataFile('categories.json'), '{"categories": [ {"id": "' + cat + '", "name": "Cli');
  // ...and the person scores a different project.
  await post('/api/priorities/set', { id: beta, scores: { p: 5 } });
  const after = readJson('priorities.json').projects[keyAlpha];
  assert.deepStrictEqual(after && after.categories, [cat], 'alpha-site\'s category was removed from priorities.json, with no copy of that file kept: ' + JSON.stringify(after));
});

test('R-09: a prompt entry edited by hand into the wrong shape is not dropped from prompts.json unseen on the next save', { todo: 'P1' }, async () => {
  const F = dataFile('prompts.json');
  const before = (await get('/api/prompts')).json; // the starters, written once
  const cat = before.categories[0].id;
  const file = JSON.parse(fs.readFileSync(F, 'utf8'));
  file.prompts.push({ id: 'handmade1', title: 42, text: 'a prompt whose name was typed as a number', category: cat });
  fs.writeFileSync(F, JSON.stringify(file, null, 2));
  const r = await post('/api/prompts/save', { title: 'New one', text: 'Some text', category: cat });
  assert.ok(r.json && r.json.ok, r.body);
  const onDisk = JSON.parse(fs.readFileSync(F, 'utf8')).prompts.some(p => p.id === 'handmade1');
  const copy = fs.readdirSync(DATA).some(n => /^prompts\.damaged-/.test(n) && fs.readFileSync(path.join(DATA, n), 'utf8').includes('handmade1'));
  assert.ok(onDisk || copy, 'the hand-edited prompt is gone from prompts.json and no copy of the file was set aside');
});

test('R-02: while another program holds prompts.json, the prompts list says it cannot be read instead of showing only the starter prompts', { todo: 'P1 (downgraded by the disprove pass)' }, async () => {
  const cat = (await get('/api/prompts')).json.categories[0].id;
  const mine = await post('/api/prompts/save', { title: 'Mine, saved before the hold', text: 'kept text', category: cat });
  assert.ok(mine.json && mine.json.ok, mine.body);
  const h = await hold(dataFile('prompts.json'), 4);
  const r = await get('/api/prompts');
  await h.done;
  const shownMine = !!(r.json && Array.isArray(r.json.prompts) && r.json.prompts.some(p => p.title === 'Mine, saved before the hold'));
  const saysWhy = r.status !== 200 || !!(r.json && (r.json.error || r.json.fault || r.json.held || r.json.damaged));
  assert.ok(shownMine || saysWhy, 'the list answered 200 with ' + (r.json && r.json.prompts ? r.json.prompts.length : '?') + ' prompts (the starters), without the saved one and without saying the file could not be read');
});

test('R-06: a held data file does not freeze every other request while the office waits for it', { todo: 'P1' }, async () => {
  const h = await hold(dataFile('prompts.json'), 4);
  const slow = get('/api/prompts');
  await sleep(30);
  const t = Date.now();
  await get('/api/stats');
  const ms = Date.now() - t;
  await slow; await h.done;
  assert.ok(ms < 300, 'This PC numbers waited ' + ms + ' ms behind the prompts read');
});

test('R-03: the To Do still opens while todo.json is read-only and a quick check is due (the failed write is reported, the list still shows)', { todo: 'P1 (downgraded by the disprove pass)' }, async () => {
  const beta = await idOf('beta-notes');
  const c = await post('/api/todo/check', { project: beta, every: 'week' }); // due today, pulled into Today on the next look
  assert.ok(c.json && c.json.ok, c.body);
  fs.chmodSync(dataFile('todo.json'), 0o444);
  let r;
  try { r = await get('/api/todo'); } finally { fs.chmodSync(dataFile('todo.json'), 0o666); }
  assert.strictEqual(r.status, 200, 'the To Do could not be opened at all: ' + r.body.slice(0, 160));
  // The planner has the same shape: a new day writes today's picks before it answers.
  const p = readJson('priorities.json');
  if (p.day) { p.day.date = '2000-01-01'; fs.writeFileSync(dataFile('priorities.json'), JSON.stringify(p)); }
  fs.chmodSync(dataFile('priorities.json'), 0o444);
  let q;
  try { q = await get('/api/priorities'); } finally { fs.chmodSync(dataFile('priorities.json'), 0o666); }
  assert.strictEqual(q.status, 200, 'the planner could not be opened at all: ' + q.body.slice(0, 160));
});

test('R-04: a change whose save failed is not shown as kept after a reload', { todo: 'P1' }, async () => {
  const beta = await idOf('beta-notes');
  fs.chmodSync(dataFile('settings.json'), 0o444);
  let r;
  try { r = await post('/api/projects/hide', { id: beta, hidden: true }); } finally { fs.chmodSync(dataFile('settings.json'), 0o666); }
  assert.notStrictEqual(r.status, 200, 'the save was expected to fail on a read-only file');
  const shown = (await get('/api/projects')).json.projects.find(p => p.id === beta).hiddenView;
  const onDisk = readJson('settings.json').hiddenView.some(d => /beta-notes$/i.test(d));
  assert.strictEqual(shown, onDisk, 'the page shows beta-notes hidden=' + shown + ' after the reload, but the file says ' + onDisk);
});

test('R-05: a failed save says what to do in plain words, once, without the raw system error and both temp paths', { todo: 'P1' }, async () => {
  const beta = await idOf('beta-notes');
  fs.chmodSync(dataFile('settings.json'), 0o444);
  let r;
  try { r = await post('/api/projects/hide', { id: beta, hidden: false }); } finally { fs.chmodSync(dataFile('settings.json'), 0o666); }
  const msg = (r.json && (typeof r.json.error === 'string' ? r.json.error : JSON.stringify(r.json.error))) || r.body;
  assert.ok(!/EPERM|rename '|\.tmp'/.test(msg), 'raw system error in the reply: ' + msg.slice(0, 200));
  assert.ok(!/\.\.\s|Try again; if it repeats/.test(msg) || !/restart the office/.test(msg), 'two instructions in one reply');
});

test('R-07: a slow live check of an old address does not wipe the result of the address set after it', { todo: 'P1' }, async () => {
  const alpha = await idOf('alpha-site');
  const site = http.createServer((q, s) => {
    const wait = q.url.startsWith('/slow') ? 3000 : 0;
    setTimeout(() => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end('<!doctype html><title>stand-in</title><p>stand-in site</p>'); }, wait);
  });
  await new Promise(r => site.listen(LIVE_PORT, '127.0.0.1', r));
  try {
    const first = post('/api/live/set', { id: alpha, url: 'http://127.0.0.1:' + LIVE_PORT + '/slow' });
    await sleep(300);
    const second = await post('/api/live/set', { id: alpha, url: 'http://127.0.0.1:' + LIVE_PORT + '/fast' });
    assert.ok(second.json && second.json.ok, second.body);
    await first;
    const p = (await get('/api/projects')).json.projects.find(x => x.id === alpha);
    assert.strictEqual(p.liveUrl, 'http://127.0.0.1:' + LIVE_PORT + '/fast');
    assert.ok(p.live, 'the newer address shows as never checked: the older check\'s answer replaced its result');
  } finally {
    await post('/api/live/set', { id: alpha, url: '' });
    await new Promise(r => site.close(r));
  }
});

test('R-08: the office\'s projects folder (Settings › Office) refuses a whole drive, the Windows folder and a network path', { todo: 'P1' }, async () => {
  const win = process.env.SystemRoot || 'C:\\Windows';
  for (const root of [path.parse(win).root, win]) {
    const r = await post('/api/office/settings', { root });
    assert.notStrictEqual(r.status, 200, root + ' was taken as the projects folder');
  }
  await post('/api/office/settings', { root: '' });
});

test('R-11: an unknown API address says it is not found (404), not "Method not allowed"', { todo: 'P2' }, async () => {
  const r = await get('/api/no-such-thing');
  assert.strictEqual(r.status, 404, r.status + ' ' + r.body);
});

test('R-12: a seat number that is not a whole number is refused, not put on seat 1 or a made-up seat', { todo: 'P2' }, async () => {
  for (const seat of ['abc', 1e308, -3, 2.5]) {
    const r = await post('/api/office/nickname', { folder: 'alpha-site', seat, nick: 'Odd seat' });
    assert.notStrictEqual(r.status, 200, 'seat ' + seat + ' was accepted');
  }
});

test('guards still hold: no key, a foreign Host and a keyless non-JSON hook are refused; the server answers after hostile bodies', async () => {
  assert.strictEqual((await call('GET', '/api/stats', undefined, { 'X-AHO-Key': '' })).status, 403);
  assert.strictEqual((await call('GET', '/api/stats', undefined, { Host: 'attacker.example:' + PORT })).status, 421);
  assert.strictEqual((await call('POST', '/api/office/hook', '{"event":"Stop","session":"x"}', { 'X-AHO-Key': '', 'Content-Type': 'text/plain' })).status, 403);
  assert.strictEqual((await call('OPTIONS', '/api/office/hook', undefined, { 'X-AHO-Key': '', Origin: 'http://attacker.example', 'Access-Control-Request-Method': 'POST' })).status, 403);
  assert.strictEqual((await post('/api/prompts/save', '{not json')).status, 400);
  assert.strictEqual((await post('/api/todo/add', 'x'.repeat(50000))).status, 413);
  assert.strictEqual((await get('/api/stats')).status, 200);
});
