// Everything the office decides once at start: version, port, mode (real / dry run / demo) and where its data lives.
// Read from the command line and environment only; nothing here changes while it runs.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = path.resolve(__dirname, '..'); // the office's own folder
const VERSION = '0.1.1';
const argPort = (process.argv.find(a => /^--port=\d+$/.test(a)) || '').slice(7);
// Demo mode (node demo/demo.js starts it): made-up projects for screenshots. Its own port and data folder, made-up
// token numbers, "DEMO-PC", paths shown as C:\Users\demo\..., and the desktop / Start with Windows shortcuts are
// only pretended, so a demo never touches the real ones.
const DEMO = process.argv.includes('--demo');
// Tests and trying things out: report windows, browsers and stops instead of doing them.
const DRY = process.env.AHO_DRYRUN === '1' || process.argv.includes('--dry-run');
const PORT = Number(argPort || process.env.AHO_PORT || (DEMO ? 8882 : 8880));
// First run only: the working folder to start with (the folder that holds the office's own folder).
const DEFAULT_ROOT = path.resolve(process.env.AHO_ROOT || path.join(HERE, '..'));
// A dry run and a demo keep their own data, so trying Add/Remove never changes the real list.
const dataDirFor = mode => path.join(HERE, mode === 'demo' ? 'data-demo' : mode === 'dry' ? 'data-dryrun' : 'data');
const DATA = path.resolve(process.env.AHO_DATA || dataDirFor(DEMO ? 'demo' : DRY ? 'dry' : 'real'));

module.exports = {
  HERE, VERSION, PORT, DEMO, DRY, DEFAULT_ROOT, DATA, dataDirFor,
  SETTINGS_FILE: path.join(DATA, 'settings.json'),
  RUN_FILE: path.join(DATA, 'run.json'),
  LIVE_FILE: path.join(DATA, 'live.json'),
  PROMPTS_FILE: path.join(DATA, 'prompts.json'),
  PRIVATE_FILE: path.join(DATA, 'private-details.json'), // what the disclosure pass looks for; never shipped, never sent
  JUDGED_FILE: path.join(DATA, 'judged.json'), // findings a person judged wrong (lib/judged.js); never shipped
  KEY: crypto.randomBytes(18).toString('hex'), // per run; the page is served with it and must send it back
  STARTED: Date.now(),
  // The data folder carries its own .gitignore of "*": wherever the office is unpacked (inside a git repository too),
  // private details, settings and audits are never offered for a commit.
  ensureDataDirs() {
    for (const d of ['audits', 'logs']) fs.mkdirSync(path.join(DATA, d), { recursive: true });
    const gi = path.join(DATA, '.gitignore');
    try { if (!fs.existsSync(gi)) fs.writeFileSync(gi, '# Made by the office: everything here stays on this PC.\n*\n'); } catch {}
  },
};
