// Times reading the AI app's transcripts two ways and checks they agree:
//   before: the office reads them for its staff, and the token count reads them all again (lib/tokens.js);
//   after:  one read gives both (the office's read with the token count riding along).
//   node tools/bench-read.js [working folder]      (default: the folder that holds this app's folder)
// Only reads the transcripts. Its own files go in a temp folder, removed at the end.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { listProjects } = require('../lib/projects');
const tokens = require('../lib/tokens');

const HERE = path.resolve(__dirname, '..');
const root = path.resolve(process.argv[2] || path.dirname(HERE));
const transcripts = process.env.AHO_TRANSCRIPTS || path.join(os.homedir(), '.claude', 'projects');

(async () => {
  const { Office } = await import(pathToFileURL(path.join(HERE, 'office', 'src', 'office.mjs')).href);
  const projects = listProjects({ workingFolders: [root] }, { appDir: HERE }).map(p => ({ id: p.id, dir: p.dir }));
  const rules = office => ({ sig: 'bench', match: tokens.makeMatcher(projects), hint: f => tokens.hintFromDirName(path.relative(office.transcriptsDir, f).split(path.sep)[0], projects) });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-bench-read-'));
  try {
    // before
    let t0 = Date.now();
    const a = new Office({ dataDir: path.join(tmp, 'a'), transcriptsDir: transcripts });
    a.readSome(a.listFiles());
    const officeMs = Date.now() - t0;
    t0 = Date.now();
    const old = tokens.tokenTotals(projects, { claude: true, codex: false });
    const tokensMs = Date.now() - t0;
    // after
    t0 = Date.now();
    const b = new Office({ dataDir: path.join(tmp, 'b'), transcriptsDir: transcripts });
    b.setTokens(rules(b));
    b.readSome(b.listFiles());
    const oneMs = Date.now() - t0;
    const now = b.tokenTotals();
    // agreement, per project
    const ids = new Set([...Object.keys(old.total), ...Object.keys(now.total)]);
    let sumOld = 0, sumNew = 0, worst = { id: '', pct: 0 };
    for (const id of ids) {
      const o = old.total[id] || 0, n = now.total[id] || 0;
      sumOld += o; sumNew += n;
      const pct = Math.abs(n - o) / Math.max(1, o) * 100;
      if (o > 1e6 && pct > worst.pct) worst = { id, pct };
    }
    const files = a.listFiles().length;
    console.log('Transcripts: ' + files + ' files; projects: ' + projects.length + '.');
    console.log('Before: office read ' + (officeMs / 1000).toFixed(1) + ' s + token count ' + (tokensMs / 1000).toFixed(1) + ' s = ' + ((officeMs + tokensMs) / 1000).toFixed(1) + ' s (two reads).');
    console.log('After:  one read ' + (oneMs / 1000).toFixed(1) + ' s.');
    console.log('Tokens: before ' + (sumOld / 1e6).toFixed(1) + 'M, after ' + (sumNew / 1e6).toFixed(1) + 'M (' + ((sumNew - sumOld) / Math.max(1, sumOld) * 100).toFixed(3) + '%); largest difference on one project over 1M: ' + worst.pct.toFixed(3) + '%.');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
