// What the bake and the command-line disclosure pass check shipped files against, taken from the MAIN copy of this
// repository: a second working copy (a git worktree) has no data/ of its own, and the folder
// above it is not the projects folder. From the main copy: your list in data/private-details.json, the working
// folders in data/settings.json, and the project folders in each of them and beside the main copy.
// gaps lists what could not be checked (no list, no other project names): a check with gaps is never "all clear".
'use strict';
const fs = require('fs');
const path = require('path');
const { gitSync } = require('../lib/gitstate');
const { autoDetails, readPrivateList } = require('../lib/disclosure');

const keyOf = p => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();

// The folder that holds the repository's own .git folder; here itself when it is not a git copy.
function mainCopy(here) {
  if (!fs.existsSync(path.join(here, '.git'))) return here;
  try {
    const common = path.resolve(here, gitSync(here, ['rev-parse', '--git-common-dir']).trim());
    return path.basename(common).toLowerCase() === '.git' ? path.dirname(common) : here;
  } catch { return here; }
}

// here: the app's folder (this copy). scanned: the folder being checked (the app itself, or another project).
function privacyContext(here, scanned = here) {
  const main = mainCopy(here);
  const listFile = path.join(main, 'data', 'private-details.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(path.join(main, 'data', 'settings.json'), 'utf8')); } catch {}
  const saved = (Array.isArray(settings.workingFolders) ? settings.workingFolders : []).filter(w => typeof w === 'string' && w.trim());
  // The app's own folder names (main copy, this copy) are not "other projects" when the app is what is checked; nor
  // is the folder a worktree sits in (it holds other copies of the app, not projects).
  const app = keyOf(scanned) === keyOf(here) || keyOf(scanned) === keyOf(main);
  const working = [];
  for (const w of [path.dirname(main), ...(app ? [] : [path.dirname(scanned)]), ...saved]) if (!working.some(x => keyOf(x) === keyOf(w))) working.push(path.resolve(w));
  const own = new Set([keyOf(scanned), keyOf(main), keyOf(here)]);
  const names = new Map();
  for (const w of working) {
    let ents = []; try { ents = fs.readdirSync(w, { withFileTypes: true }); } catch {}
    for (const e of ents) {
      if (!e.isDirectory() || /^[._-]/.test(e.name) || own.has(keyOf(path.join(w, e.name)))) continue; // dot and underscore folders are tools, not projects
      names.set(e.name.toLowerCase(), e.name);
    }
  }
  if (!app) names.set(path.basename(main).toLowerCase(), path.basename(main));
  const others = [...names.values()];
  const listed = readPrivateList(listFile);
  const listMissing = !fs.existsSync(listFile);
  const gaps = [];
  if (!listed.length) gaps.push(listMissing
    ? 'your private-details list is missing (data/private-details.json in the main copy, ' + path.basename(main) + '/): add your details in the office under Settings › Private details'
    : 'your private-details list (data/private-details.json in ' + path.basename(main) + '/) has no details in it');
  if (!others.length) gaps.push('no other project folders were found to check names against (' + working.length + ' folder' + (working.length === 1 ? '' : 's') + ' looked in)');
  return { main, working, others, listed: listed.length, details: [...listed, ...autoDetails(working)], gaps };
}

module.exports = { privacyContext, mainCopy };
