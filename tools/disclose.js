// The disclosure pass on one folder, from the command line:
//   node tools/disclose.js [folder]        (default: the office's own folder)
// Uses the private details you listed in the office (data/private-details.json), this PC's own details, and the names
// of the other folders beside it and in your working folders, all from the main copy of the office when this is a
// second working copy (tools/privacy-context.js). Prints labels and places only, never the values.
// Exit code 1 when anything is found; 2 when nothing was found but the check had gaps (no list, no project names).
'use strict';
const path = require('path');
const { disclosurePass } = require('../lib/disclosure');
const { privacyContext } = require('./privacy-context');

const HERE = path.resolve(__dirname, '..');
const dir = path.resolve(process.argv[2] || HERE);
const ctx = privacyContext(HERE, dir);
const { details, others, gaps } = ctx;
const app = dir.toLowerCase() === HERE.toLowerCase() || dir.toLowerCase() === ctx.main.toLowerCase();

(async () => {
  for (const g of gaps) console.log('WARNING, not a complete check: ' + g + '.');
  const r = await disclosurePass(dir, { details, others, own: [path.basename(dir), ...(app ? [path.basename(ctx.main)] : [])] });
  // This app's own AGENTS.md and CLAUDE.md ship on purpose (they tell a person's AI helper how to set it up).
  // One of them alone, or the two grouped ("(2 files, e.g. AGENTS.md)"), at the top of this folder or of a zip baked
  // from it; a third such file would read "3 files" and stay.
  if (app) r.findings = r.findings.filter(f => !(f.rule === 'DISC-003' && /^(_releases\/ai-head-office-overview-[\d.]+\.zip > ai-head-office-overview\/ ?)?((AGENTS|CLAUDE)\.md|\(2 files, e\.g\. (AGENTS|CLAUDE)\.md\))$/.test(f.where)));
  console.log('Disclosure pass on ' + path.basename(dir) + ': ' + r.read.files + ' files, ' + r.read.zips + ' zips, ' + r.read.commits + ' commits, '
    + r.read.versions + ' past file versions; ' + ctx.listed + ' details from your list, ' + new Set(details.map(d => d.label)).size + ' kinds of private detail in all, '
    + others.length + ' other project names.');
  for (const f of r.findings) console.log('  [' + f.sev + '] ' + f.rule + '  ' + f.title + '\n         ' + f.where);
  for (const n of r.notes) console.log('  note: ' + n);
  if (r.findings.length) console.log(r.findings.length + ' found.');
  else if (gaps.length) console.log('Nothing found in what was checked, but this was NOT a complete check: ' + gaps.join('; ') + '.');
  else console.log('Nothing found.');
  process.exit(r.findings.length ? 1 : gaps.length ? 2 : 0);
})();
