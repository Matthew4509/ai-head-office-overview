// Times the office: start-up (until it answers), the project list (first, again, and with fresh=1), and memory.
//   node tools/bench.js [working folder]      (default: the folder that holds the office's folder)
// Runs a dry-run office on port 8881 with a throwaway data folder, so nothing real is changed or opened.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HERE = path.resolve(__dirname, '..');
const PORT = 8881;
const ROOT = path.resolve(process.argv[2] || path.join(HERE, '..'));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-bench-'));
const base = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const t0 = performance.now();
  const child = spawn(process.execPath, ['server.js', '--dry-run', '--port=' + PORT], {
    cwd: HERE, stdio: 'ignore', env: { ...process.env, AHO_DATA: DATA, AHO_ROOT: ROOT, AHO_OPEN: '0', AHO_TRANSCRIPTS: path.join(DATA, 'transcripts') },
  });
  let page = null;
  for (let i = 0; i < 200 && !page; i++) {
    try { const r = await fetch(base + '/'); if (r.ok) page = await r.text(); } catch { await sleep(25); }
  }
  const startMs = performance.now() - t0;
  if (!page) { child.kill(); throw new Error('the office did not answer'); }
  const key = /name="aho-key" content="([^"]+)"/.exec(page)[1];
  const get = async q => {
    const t = performance.now();
    const r = await fetch(base + '/api/projects' + q, { headers: { 'X-AHO-Key': key } });
    const j = await r.json();
    return { ms: Math.round(performance.now() - t), n: j.projects.length };
  };
  const first = await get(''), again = await get(''), fresh = await get('?fresh=1');
  let rss = null;
  try {
    const out = require('child_process').execFileSync(process.platform === 'win32' ? 'tasklist' : 'ps',
      process.platform === 'win32' ? ['/FI', 'PID eq ' + child.pid, '/FO', 'CSV', '/NH'] : ['-o', 'rss=', '-p', String(child.pid)], { encoding: 'utf8' });
    const m = process.platform === 'win32' ? /"([\d,.\s]+) K"/.exec(out) : [0, out.trim()];
    if (m) rss = Math.round(Number(m[1].replace(/[^\d]/g, '')) / 1024);
  } catch {}
  child.kill();
  console.log(JSON.stringify({ projects: first.n, startMs: Math.round(startMs), listFirstMs: first.ms, listAgainMs: again.ms, listFreshMs: fresh.ms, memoryMB: rss }));
  await sleep(300);
  fs.rmSync(DATA, { recursive: true, force: true });
})().catch(e => { console.error(e.message); process.exit(1); });
