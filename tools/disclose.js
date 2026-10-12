// The disclosure pass on one folder, from the command line:
//   node tools/disclose.js [folder]        (default: the office's own folder)
// Uses the private details you listed in the office (data/private-details.json), this PC's own details, and the names
// of the other folders beside it and in your working folders. Prints labels and places only, never the values.
// Exit code 1 when anything is found.
'use strict';
const fs = require('fs');
const path = require('path');
const { disclosurePass, autoDetails, readPrivateList } = require('../lib/disclosure');

const HERE = path.resolve(__dirname, '..');
const dir = path.resolve(process.argv[2] || HERE);
let settings = {};
try { settings = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'settings.json'), 'utf8')); } catch {}
const working = [...new Set([path.dirname(dir), ...(settings.workingFolders || [])].map(w => path.resolve(w)))];
const others = [];
for (const w of working) {
  try { for (const e of fs.readdirSync(w, { withFileTypes: true })) if (e.isDirectory() && !/^[._-]/.test(e.name) && path.join(w, e.name) !== dir) others.push(e.name); } catch {}
}
if (dir !== HERE) others.push(path.basename(HERE));

(async () => {
  const details = [...readPrivateList(path.join(HERE, 'data', 'private-details.json')), ...autoDetails(working)];
  const r = await disclosurePass(dir, { details, others, own: [path.basename(dir)] });
  // This app's own AGENTS.md and CLAUDE.md ship on purpose (they tell a person's AI helper how to set it up).
  // One of them alone, or the two grouped ("(2 files, e.g. AGENTS.md)"), at the top of this folder or of a zip baked
  // from it; a third such file would read "3 files" and stay.
  if (dir === HERE) r.findings = r.findings.filter(f => !(f.rule === 'DISC-003' && /^(_releases\/ai-head-office-overview-[\d.]+\.zip > ai-head-office-overview\/ ?)?((AGENTS|CLAUDE)\.md|\(2 files, e\.g\. (AGENTS|CLAUDE)\.md\))$/.test(f.where)));
  console.log('Disclosure pass on ' + path.basename(dir) + ': ' + r.read.files + ' files, ' + r.read.zips + ' zips, ' + r.read.commits + ' commits, '
    + r.read.versions + ' past file versions; ' + new Set(details.map(d => d.label)).size + ' kinds of private detail, ' + others.length + ' other project names.');
  for (const f of r.findings) console.log('  [' + f.sev + '] ' + f.rule + '  ' + f.title + '\n         ' + f.where);
  for (const n of r.notes) console.log('  note: ' + n);
  console.log(r.findings.length ? r.findings.length + ' found.' : 'Nothing found.');
  process.exit(r.findings.length ? 1 : 0);
})();
