// Bakes the shareable zip: _releases/ai-head-office-overview-<version>.zip, one folder "ai-head-office-overview" inside.
//   node tools/bake.js            (--check: the privacy check only, no zip; --again: replace an existing zip of this
//                                 version, only when it was never shared)
// Only the files in SHIP go in (an allow list: anything new stays out until it is added here), projects.json goes in
// EMPTY (the real one holds this PC's project names), and data/, test copies, notes and handovers never go in.
// Before zipping, every shipped file goes through the disclosure pass's matcher: private details read from THIS PC at
// bake time and from your list in data/, the names of the project folders next to the office, an AI or prompt trail,
// and local paths; plus dated notes. None of the values are written in this file or printed. Any hit stops the bake.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeMatcher, autoDetails, readPrivateList } = require('../lib/disclosure');

const HERE = path.resolve(__dirname, '..');
const VERSION = /const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(HERE, 'lib', 'config.js'), 'utf8'))[1];
// Whole folders by kind of file (a stray file dropped in one stays out); anything else must be named here.
const under = (dir, ok) => fs.readdirSync(path.join(HERE, dir), { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? under(dir + '/' + e.name, ok) : ok(e.name) ? [dir + '/' + e.name] : []);
// .gitignore ships too: unzipped inside a git repository, the office's data/ (private details in plain text) must not
// be offered for a commit. AGENTS.md and CLAUDE.md ship on purpose: they tell a person's AI helper how to set it up.
const SHIP = ['server.js', 'index.html', 'start.cmd', 'install.cmd', 'uninstall.cmd', 'start-demo.cmd', 'README.md', 'LICENSE',
  'AGENTS.md', 'CLAUDE.md', 'package.json', 'projects.example.json', '.gitignore', '.gitattributes', 'office/hook.mjs', 'office/tools/people.mjs',
  ...under('lib', f => /\.(js|ps1)$/.test(f)), ...under('office/src', f => /\.mjs$/.test(f)),
  ...under('office/public', f => /^(index\.html|app\.ico|icon\.svg|[\w-]+\.(css|js))$/.test(f)),
  ...under('test', f => /\.test\.js$/.test(f)).filter(f => !f.startsWith('test/museum/')), ...under('test/museum', f => /\.(js|json)$/.test(f)),
  ...under('office/test', f => /\.mjs$/.test(f)), ...under('tools', f => /\.js$/.test(f)), ...under('demo', f => /\.js$/.test(f)),
  ...(fs.existsSync(path.join(HERE, 'screenshots')) ? under('screenshots', f => /\.png$/.test(f)) : [])];
const EMPTY_PROJECTS = {
  note: 'The office\'s own list of names, descriptions and live addresses, keyed by project folder name. Nothing here is written into any project\'s folder. See README.md, "Names and descriptions".',
};

const out = path.join(HERE, '_releases');
const stage = path.join(out, 'stage-' + VERSION);
const root = path.join(stage, 'ai-head-office-overview');
const zip = path.join(out, 'ai-head-office-overview-' + VERSION + '.zip');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
for (const rel of SHIP) {
  const to = path.join(root, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(HERE, rel), to);
}
fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify(EMPTY_PROJECTS, null, 2) + '\n');

// ---- private details: the disclosure pass's own matcher (lib/disclosure.js), so the bake and the audit agree ----
// This PC's details are read now, never stored; the list you keep in the office (data/private-details.json) is added.
const projectsDir = path.dirname(HERE);
const details = [...readPrivateList(path.join(HERE, 'data', 'private-details.json')), ...autoDetails([projectsDir])];
const others = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== path.basename(HERE) && !/^[._-]/.test(e.name)).map(e => e.name); // .claude, _backups: tool folders, not projects
const scan = makeMatcher({ details, others, own: [path.basename(HERE), 'ai-head-office-overview', 'ai-head-office'] });
const hits = [];
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else check(f); } };
function check(f) {
  if (/\.(ico|png)$/i.test(f)) return;
  const at = path.relative(f.startsWith(root) ? root : HERE, f);
  const text = fs.readFileSync(f, 'utf8');
  for (const h of scan(text)) hits.push(scan.redact(at) + ':' + h.line + '  [' + h.rule + (h.labels.size ? ': ' + [...h.labels].join(', ') : '') + ']');
  for (const h of scan.inName(at)) hits.push(scan.redact(at) + '  [' + h.rule + ' in the file name' + (h.labels.size ? ': ' + [...h.labels].join(', ') : '') + ']');
  // Notes from building it: dated remarks (the shipped files carry no dates).
  text.split(/\r?\n/).forEach((l, i) => { if (/\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 20\d\d\b/i.test(l)) hits.push(at + ':' + (i + 1) + '  [dated note]'); });
}
walk(root);
// The git repo publishes more than the zip (tests, tools ...): every tracked file gets the same check.
let tracked = [];
try { tracked = execFileSync('git', ['ls-files'], { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(f => f && !SHIP.includes(f)); } catch {}
for (const f of tracked) check(path.join(HERE, f));
// .cmd files must keep Windows line endings
for (const c of SHIP.filter(f => /\.(cmd|ps1)$/.test(f))) if (/[^\r]\n/.test(fs.readFileSync(path.join(root, c), 'latin1'))) hits.push(c + '  [line endings]  needs CRLF');
if (hits.length) {
  fs.rmSync(stage, { recursive: true, force: true });
  console.error('Bake stopped: ' + hits.length + ' possible private detail(s) in the shipped files (labels only, never the values):\n  ' + hits.join('\n  '));
  process.exit(1);
}
// --check: the private-details check on exactly what would ship, without making (or replacing) a zip.
if (process.argv.includes('--check')) {
  fs.rmSync(stage, { recursive: true, force: true });
  console.log('Check only: ' + SHIP.length + ' files would ship; private-details check: ' + new Set(details.map(d => d.label)).size + ' kinds of detail, ' + others.length + ' project names, 0 hits. No zip made.');
  process.exit(0);
}

// A zip of this version already exists: once shared it is spent (a new bake needs a new version), so it is never
// replaced by accident. --again replaces it when it was never shared.
if (fs.existsSync(zip) && !process.argv.includes('--again')) {
  fs.rmSync(stage, { recursive: true, force: true });
  console.error('Bake stopped: ' + path.relative(HERE, zip) + ' already exists. If it was shared, bump the version in lib/config.js first; if it was never shared, run again with --again to replace it.');
  process.exit(1);
}
fs.rmSync(zip, { force: true });
// Windows' own tar (bsdtar) writes a real zip with forward slashes; Git's GNU tar on the PATH reads "C:" as a host.
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(TAR, ['-a', '-c', '-f', zip, 'ai-head-office-overview'], { cwd: stage });
fs.rmSync(stage, { recursive: true, force: true });
const n = execFileSync(TAR, ['-t', '-f', zip], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(x => !x.endsWith('/')).length;
console.log('Baked ' + path.relative(HERE, zip) + ': ' + n + ' files, ' + Math.round(fs.statSync(zip).size / 1024) + ' KB. Private-details check: ' + new Set(details.map(d => d.label)).size + ' kinds of detail, ' + others.length + ' project names, 0 hits.');
