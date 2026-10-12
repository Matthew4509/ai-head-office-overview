// AI Head Office Overview demo: made-up projects with real little websites, for screenshots and trying the office out.
//   node demo/demo.js          (or double-click start-demo.cmd)
// Builds data-demo/workspace (nine fictional projects), starts the office in demo mode on 127.0.0.1:8882, starts
// three of their sites (two by the office, one by "another program"), runs the audits, and opens the window.
// Press "Play demo" on its status line for the tour. About > Quit stops the demo and its sites.
// Every name, business and number here is made up.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const HERE = path.resolve(__dirname, '..');
const DATA = path.join(HERE, 'data-demo');
// A fresh workspace folder each run: the last run's can stay locked for a few seconds after its sites stop (or while
// an antivirus scans the new files), so it is tidied away when it can be, and never waited on.
const WS = path.join(DATA, 'workspace-' + Date.now().toString(36));
const PORT = 8882;
const SITE = path.join(__dirname, 'site.js');
const { writeThreads } = require('./threads');
const HOUR = 3600e3, DAY = 24 * HOUR;

// kind: landing | app | dashboard. start: 'office' = started by the office, 'other' = by another program.
const SITES = [
  { folder: 'nimbus-notes', name: 'Nimbus Notes', port: 5302, kind: 'app', c: '#2563eb', c2: '#dbeafe', ago: 0.05 * HOUR, start: 'office',
    desc: 'A fast note-taking app that syncs across your devices.', head: 'Your thoughts, everywhere', sub: 'Quick notes, checklists and ideas that follow you from phone to laptop.' },
  { folder: 'harbour-lane-bakery', name: 'Harbour Lane Bakery', port: 5301, kind: 'landing', c: '#c2410c', c2: '#fff1e6', ago: 0.4 * HOUR, start: 'office',
    desc: 'Online orders and daily specials for a neighbourhood bakery.', head: 'Fresh from the oven at 6 am', sub: 'Sourdough, pastries and celebration cakes, baked by the harbour every morning.', feats: ['Order ahead', 'Daily specials', 'Gift boxes'] },
  { folder: 'pixel-forge-studio', name: 'Pixel Forge Studio', port: 5304, kind: 'landing', c: '#7c3aed', c2: '#ede9fe', ago: 0.8 * HOUR, fault: 'high',
    desc: 'Portfolio site for a small game art studio.', head: 'Worlds, characters, pixels', sub: 'Hand-made pixel art and animation for indie games.', feats: ['Characters', 'Tilesets', 'Animation'] },
  { folder: 'lumen-analytics', name: 'Lumen Analytics', port: 5306, kind: 'dashboard', c: '#f59e0b', c2: '#1f2937', ago: 4 * HOUR, fault: 'medium',
    desc: 'A dashboard that turns shop sales into simple charts.', head: 'Sales this week', sub: 'Orders, revenue and best sellers at a glance.' },
  { folder: 'peak-trail-fitness', name: 'Peak Trail Fitness', port: 5303, kind: 'landing', c: '#16a34a', c2: '#dcfce7', ago: 7 * HOUR,
    desc: 'Class bookings and member plans for an outdoor fitness studio.', head: 'Train outside. Feel unstoppable.', sub: 'Small-group classes on the trails and by the beach.', feats: ['Book a class', 'Member plans', 'Coaches'] },
  { folder: 'tidewater-yoga', name: 'Tidewater Yoga', port: 5305, kind: 'landing', c: '#0d9488', c2: '#ccfbf1', ago: 1.2 * DAY,
    desc: 'Timetable and bookings for a beachside yoga school.', head: 'Breathe with the tide', sub: 'Morning flow, evening restore and beginner courses.', feats: ['Timetable', 'Courses', 'Retreats'] },
  { folder: 'atlas-travel-journal', name: 'Atlas Travel Journal', port: 5307, kind: 'app', c: '#0891b2', c2: '#cffafe', ago: 3 * DAY, start: 'other',
    desc: 'A map-based travel diary for sharing trips with family.', head: 'Every trip, on one map', sub: 'Pin places, add photos and share the story with the people at home.' },
  { folder: 'copper-kettle-cafe', name: 'Copper Kettle Cafe', port: 5308, kind: 'landing', c: '#b45309', c2: '#fef3c7', ago: 13 * DAY,
    desc: 'Menu and table bookings for a corner cafe.', head: 'Good coffee, slow mornings', sub: 'Breakfast all day and the best flat white on the corner.', feats: ['Menu', 'Book a table', 'Find us'] },
  { folder: 'field-notes', name: 'Field Notes', ago: 9 * DAY,
    desc: 'Research notes and drafts for a book about coastal walks; there is no website to run.' },
];

// ---------- the fake websites ----------
const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const favicon = s => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${s.c}"/><text x="32" y="44" font-family="Segoe UI,Arial,sans-serif" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">${esc(s.name[0])}</text></svg>`;
const shell = (s, body, bg) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(s.name)}</title>
<link rel="icon" href="/favicon.svg"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;font:16px/1.5 "Segoe UI",system-ui,sans-serif;color:#1f2937;background:${bg || '#fff'}}
a{color:inherit;text-decoration:none}.nav{display:flex;align-items:center;gap:28px;padding:18px 56px}.logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px}
.logo i{width:34px;height:34px;border-radius:10px;background:${s.c};display:inline-block}.nav .sp{flex:1}.nav a{font-size:15px;opacity:.8}
.btn{display:inline-block;padding:12px 22px;border-radius:999px;background:${s.c};color:#fff;font-weight:600}.ghost{background:transparent;color:${s.c};border:2px solid ${s.c}}
</style></head><body>${body}</body></html>`;
function landing(s) {
  const art = `<svg viewBox="0 0 420 300" width="420" height="300" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.c}"/><stop offset="1" stop-color="${s.c2}"/></linearGradient></defs>
<rect x="20" y="20" width="380" height="260" rx="36" fill="url(#g)"/><circle cx="300" cy="100" r="46" fill="#fff" opacity=".85"/><rect x="60" y="170" width="220" height="22" rx="11" fill="#fff" opacity=".9"/>
<rect x="60" y="210" width="150" height="22" rx="11" fill="#fff" opacity=".6"/><circle cx="110" cy="100" r="30" fill="#fff" opacity=".35"/></svg>`;
  return shell(s, `<div class="nav"><a class="logo" href="/"><i></i>${esc(s.name)}</a><span class="sp"></span><a href="#">About</a><a href="#">Prices</a><a href="#">Contact</a><a class="btn" href="#">${esc(s.feats[0])}</a></div>
<section style="display:flex;align-items:center;gap:40px;padding:56px 56px 40px;background:${s.c2}"><div style="flex:1"><h1 style="font-size:52px;line-height:1.1;margin:0 0 16px;color:#111827">${esc(s.head)}</h1>
<p style="font-size:20px;margin:0 0 28px;max-width:520px">${esc(s.sub)}</p><a class="btn" href="#">${esc(s.feats[0])}</a> <a class="btn ghost" href="#">Learn more</a></div>${art}</section>
<section style="display:flex;gap:24px;padding:40px 56px">${s.feats.map((f, i) => `<div style="flex:1;padding:24px;border-radius:18px;border:1px solid #e5e7eb"><div style="width:44px;height:44px;border-radius:12px;background:${s.c};opacity:${1 - i * 0.25}"></div><h3 style="margin:14px 0 6px">${esc(f)}</h3><p style="margin:0;color:#6b7280">Simple, friendly and ready when you are.</p></div>`).join('')}</section>`);
}
function app(s) {
  const notes = ['Weekend plans', 'Shopping list', 'Ideas for the garden', 'Book club picks', 'Trip packing list', 'Recipe: lemon cake'];
  return shell(s, `<div style="display:flex;min-height:100vh"><aside style="width:250px;background:${s.c};color:#fff;padding:24px"><div class="logo" style="margin-bottom:28px"><i style="background:#fff"></i>${esc(s.name)}</div>
${['All notes', 'Favourites', 'Shared', 'Trips', 'Archive'].map((x, i) => `<div style="padding:10px 12px;border-radius:10px;margin-bottom:4px;${i ? 'opacity:.8' : 'background:rgba(255,255,255,.2);font-weight:600'}">${x}</div>`).join('')}</aside>
<main style="flex:1;padding:32px 40px;background:${s.c2}"><h1 style="margin:0 0 6px;font-size:34px">${esc(s.head)}</h1><p style="margin:0 0 24px;color:#4b5563">${esc(s.sub)}</p>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px">${notes.map((n, i) => `<div style="background:#fff;border-radius:16px;padding:20px;box-shadow:0 2px 10px rgba(0,0,0,.06)"><b>${n}</b>
<div style="height:10px;border-radius:5px;background:#e5e7eb;margin:14px 0 8px;width:${90 - i * 7}%"></div><div style="height:10px;border-radius:5px;background:#e5e7eb;width:${60 + i * 5}%"></div></div>`).join('')}</div></main></div>`, s.c2);
}
function dashboard(s) {
  const bars = [42, 58, 51, 74, 66, 88, 95];
  return shell(s, `<div class="nav" style="background:#111827;color:#f9fafb"><span class="logo"><i></i>${esc(s.name)}</span><span class="sp"></span><a href="#">Overview</a><a href="#">Products</a><a href="/login.html">Sign in</a></div>
<div style="padding:32px 56px;background:${s.c2};color:#f9fafb;min-height:100vh"><h1 style="margin:0 0 4px;font-size:32px">${esc(s.head)}</h1><p style="margin:0 0 24px;color:#9ca3af">${esc(s.sub)}</p>
<div style="display:flex;gap:18px;margin-bottom:22px">${[['Orders', '1,284'], ['Revenue', '$48,210'], ['Avg order', '$37.55'], ['Returning', '64%']].map(([k, v]) => `<div style="flex:1;background:#111827;border-radius:16px;padding:18px"><div style="color:#9ca3af;font-size:14px">${k}</div><div style="font-size:28px;font-weight:700">${v}</div></div>`).join('')}</div>
<div style="background:#111827;border-radius:16px;padding:24px;display:flex;align-items:flex-end;gap:22px;height:260px">${bars.map(b => `<div style="flex:1;height:${b}%;border-radius:10px 10px 4px 4px;background:linear-gradient(${s.c},#b45309)"></div>`).join('')}</div></div>`, '#1f2937');
}

// ---------- the "live" copies (Hosted live) ----------
// Made-up .example addresses, answered on this PC by demo/live-sites.js. Bakery's live copy has been "tampered
// with" (an outside script and a hidden link its local copy does not have), so its audit shows the live-vs-local
// check; Tidewater answers with a firewall page (amber); Copper Kettle's address answers nothing (red).
const LIVE = [
  { folder: 'nimbus-notes', host: 'nimbusnotes.example', port: 5321 },
  { folder: 'harbour-lane-bakery', host: 'harbourlanebakery.example', port: 5322, tampered: true },
  { folder: 'peak-trail-fitness', host: 'peaktrailfitness.example', port: 5323 },
  { folder: 'lumen-analytics', host: 'lumenanalytics.example', port: 5324 },
  { folder: 'tidewater-yoga', host: 'tidewateryoga.example', port: 5325, mode: 'firewall' },
  { folder: 'copper-kettle-cafe', host: 'copperkettlecafe.example', port: null },
];
const LIVE_HTTP_PORT = 5320;
function buildLive() {
  const sites = [];
  for (const l of LIVE.filter(x => x.port)) {
    const dir = path.join(WS + '-live', l.folder);
    let html = fs.readFileSync(path.join(WS, l.folder, 'public', 'index.html'), 'utf8');
    if (l.tampered) html = html.replace('</head>', '<script src="https://cdn.fastpixel-stats.example/t.js"></script></head>')
      .replace('</body>', '<div style="position:absolute;left:-9999px"><a href="https://cheap-watches.example/">replica watches</a></div></body>');
    write(path.join(dir, 'public', 'index.html'), html);
    sites.push({ host: l.host, port: l.port, dir, mode: l.mode || null });
  }
  fs.writeFileSync(path.join(DATA, 'live-sites.json'), JSON.stringify({ sites, httpPort: LIVE_HTTP_PORT }, null, 2));
}

function write(f, text) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
function touchAll(dir, when) {
  const t = new Date(when);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) touchAll(f, when);
    fs.utimesSync(f, t, t);
  }
  fs.utimesSync(dir, t, t);
}
function build() {
  fs.mkdirSync(DATA, { recursive: true });
  for (const e of fs.readdirSync(DATA)) if (/^workspace/.test(e)) try { fs.rmSync(path.join(DATA, e), { recursive: true, force: true }); } catch {}
  fs.rmSync(path.join(DATA, 'live.json'), { force: true });
  for (const s of SITES) {
    const dir = path.join(WS, s.folder);
    write(path.join(dir, 'README.md'), `# ${s.name}\n\n${s.desc}\n`);
    write(path.join(dir, 'project.json'), JSON.stringify({ name: s.name }, null, 2) + '\n');
    if (s.port) {
      write(path.join(dir, 'public', 'index.html'), s.kind === 'app' ? app(s) : s.kind === 'dashboard' ? dashboard(s) : landing(s));
      write(path.join(dir, 'public', 'favicon.svg'), favicon(s));
      // Each project carries its own little server and a launch.json with relative paths only (it runs in the
      // project's folder), and keeps .claude/ out of what it would publish, as a real project should: no path of
      // this PC lands in a demo project, so the audit shows no made-up "AI trail" or "local path" faults.
      write(path.join(dir, 'serve.js'), '// A little static server for this project\'s public/ folder.   node serve.js <port> .\n'
        + fs.readFileSync(SITE, 'utf8').replace(/^(\/\/.*\r?\n)+/, ''));
      write(path.join(dir, '.claude', 'launch.json'), JSON.stringify({ version: '0.0.1', configurations: [
        { name: s.folder, runtimeExecutable: 'node', runtimeArgs: ['serve.js', String(s.port), '.'], port: s.port }] }, null, 2));
      write(path.join(dir, '.gitignore'), '.claude/\n');
    } else {
      write(path.join(dir, 'notes', 'chapter-1.md'), '# The north headland\n\nDraft notes.\n');
    }
    // Planted faults, so the audit has something to show: a database dump left in the web folder (High) and a sign-in
    // form with no CSRF token (Medium).
    if (s.fault === 'high') write(path.join(dir, 'public', 'old-orders.sql'), '-- made-up demo data\nCREATE TABLE orders (id INT, total DECIMAL(8,2));\n');
    if (s.fault === 'medium') write(path.join(dir, 'public', 'login.html'), '<!DOCTYPE html><title>Sign in</title><form method="post" action="/login"><input name="user"><input name="pass" type="password"><button>Sign in</button></form>\n');
    touchAll(dir, Date.now() - s.ago);
  }
}

// ---------- running it ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
function call(key, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: body ? 'POST' : 'GET', timeout: 120000,
      headers: { Host: '127.0.0.1:' + PORT, 'X-AHO-Key': key, 'Content-Type': 'application/json' } }, res => {
      let t = ''; res.setEncoding('utf8'); res.on('data', c => { t += c; });
      res.on('end', () => { try { resolve(JSON.parse(t)); } catch { resolve({}); } });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(data || undefined);
  });
}
function killPidFile(f) { try { const pid = Number(fs.readFileSync(f, 'utf8')); if (pid) execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} try { fs.unlinkSync(f); } catch {} }
function findEdge() {
  return [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean)
    .map(b => path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(p => fs.existsSync(p)) || null;
}

async function main() {
  console.log('AI Head Office Overview demo: made-up projects, for screenshots.');
  // A demo already running: stop it (and its sites) first, so every run starts the same way.
  try { execFileSync(process.execPath, [path.join(HERE, 'server.js'), '--demo', '--stop'], { stdio: 'ignore' }); } catch {}
  killPidFile(path.join(DATA, 'other-site.pid'));
  killPidFile(path.join(DATA, 'live-sites.pid')); // the last run's made-up live sites
  await sleep(800);
  // Fresh settings, audits and logs each time; site pictures are kept (they take a few seconds each).
  for (const f of ['settings.json', 'run.json']) fs.rmSync(path.join(DATA, f), { force: true });
  for (const d of ['audits', 'logs', 'office', 'transcripts']) fs.rmSync(path.join(DATA, d), { recursive: true, force: true });
  build();
  // The made-up office: threads at the projects' desks, read by the office from data-demo/transcripts.
  writeThreads(path.join(DATA, 'transcripts'), WS, path.join(DATA, 'office'));

  const log = fs.openSync(path.join(DATA, 'office.log'), 'w');
  spawn(process.execPath, [path.join(HERE, 'server.js'), '--demo'], { cwd: HERE, env: { ...process.env, AHO_ROOT: WS, AHO_OPEN: '0' },
    detached: true, stdio: ['ignore', log, log], windowsHide: true }).unref();
  let key = null;
  for (let i = 0; i < 60 && !key; i++) { await sleep(250); try { key = JSON.parse(fs.readFileSync(path.join(DATA, 'run.json'), 'utf8')).key; } catch {} }
  if (!key) { console.log('The demo office did not start: see data-demo\\office.log'); process.exit(1); }
  console.log('Demo office on http://127.0.0.1:' + PORT + '/');

  await call(key, '/api/welcome', {});
  await call(key, '/api/scan', {});
  const list = (await call(key, '/api/projects')).projects || [];
  const byFolder = f => list.find(p => p.folder === f);

  // Hosted live: the made-up live sites, then each project's live address (checked as it is set).
  buildLive();
  const liveKid = spawn(process.execPath, [path.join(__dirname, 'live-sites.js'), path.join(DATA, 'live-sites.json'), String(PORT), key], { detached: true, stdio: 'ignore', windowsHide: true });
  liveKid.unref();
  fs.writeFileSync(path.join(DATA, 'live-sites.pid'), String(liveKid.pid));
  await sleep(600);
  for (const l of LIVE) {
    const r = await call(key, '/api/live/set', { id: byFolder(l.folder).id, url: 'https://' + l.host + '/' });
    console.log('  live address for ' + l.folder + ': ' + (r.ok ? r.live.state : r.error));
  }

  // "Another program": one site started outside the office, so an amber satellite shows.
  for (const s of SITES.filter(x => x.start === 'other')) {
    const dir = path.join(WS, s.folder);
    const child = spawn(process.execPath, [SITE, String(s.port), dir], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    fs.writeFileSync(path.join(DATA, 'other-site.pid'), String(child.pid));
  }
  for (const s of SITES.filter(x => x.start === 'office')) {
    const p = byFolder(s.folder);
    const r = await call(key, '/api/start', { id: p.id, key: p.commands[0].key, scan: true, open: false });
    console.log('  started ' + s.name + ': ' + (r.ok ? r.url : r.error));
  }
  for (const s of SITES.filter(x => x.fault || x.folder === 'tidewater-yoga')) {
    const p = byFolder(s.folder);
    const r = await call(key, '/api/audit', { id: p.id });
    const c = r.audit ? r.audit.counts : {};
    console.log('  audited ' + s.name + ': ' + ((c.Critical || 0) + (c.High || 0)) + ' Critical/High, ' + (c.Medium || 0) + ' Medium');
  }

  if (process.argv.includes('--no-window')) return console.log('\nReady at http://127.0.0.1:' + PORT + '/ (no window opened).');
  const edge = findEdge(), url = 'http://127.0.0.1:' + PORT + '/#projects';
  if (edge) spawn(edge, ['--app=' + url, '--window-size=1440,900'], { detached: true, stdio: 'ignore' }).unref();
  else spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
  console.log('\nThe demo window is open. Press "Play demo" on its status line for the tour.');
  console.log('About > Quit stops the demo and its sites. Your real office and its settings are not touched.');
}
main().catch(e => { console.error('Demo failed: ' + e.message); process.exit(1); });
