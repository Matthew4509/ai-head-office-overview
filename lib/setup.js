// Setup and uninstall, in one place for install.cmd / uninstall.cmd (through tools/setup.js) and Settings › Setup
// (Run setup again, Uninstall). Three things, each for this Windows user only: the Start office link
// (ai-head-office://start), the desktop shortcut, and Start with Windows. Nothing here deletes the office's folder or
// its data: uninstall says where they are, and the person removes the folder themselves. Uninstall also takes advanced
// setup's hooks out of the AI app's settings (a copy of that file is kept first).
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const os = require('./platform');
const desktop = require('./desktop');

const NODE_MIN = 22;
const nodeMajor = () => Number(process.versions.node.split('.')[0]);

// The link goes through the same rule as the shortcuts: a test copy reports instead of changing Windows, unless a
// test gave it a throwaway place (AHO_LINK_KEY), and a demo only pretends.
function link(action) {
  if (cfg.DEMO) return { where: 'link', exists: true, here: true, ...(action === 'status' ? {} : { dryRun: 'demo, nothing changed' }) };
  if (cfg.DRY && action !== 'status' && !process.env.AHO_LINK_KEY) return { where: 'link', exists: false, dryRun: action + ' Start office link' };
  try { return os.link(action, cfg.HERE); } catch (e) { return { where: 'link', error: e.message }; }
}

async function status() {
  return {
    folder: cfg.HERE, data: cfg.DATA, system: os.NAME,
    node: { version: process.versions.node, min: NODE_MIN, ok: nodeMajor() >= NODE_MIN },
    link: link('status'),
    desktop: await desktop.shortcut('desktop', 'status'),
    startup: await desktop.shortcut('startup', 'status'),
  };
}

// want: { link, desktop, startup } as true (set up) / false (take away) / undefined (leave as it is).
async function apply(want) {
  const results = [];
  if (want.link !== undefined) results.push(link(want.link ? 'create' : 'remove'));
  for (const where of ['desktop', 'startup']) if (want[where] !== undefined) results.push(await desktop.shortcut(where, want[where] ? 'create' : 'remove'));
  return { results, errors: results.filter(r => r.error).map(r => NAMES[r.where] + ': ' + r.error) };
}
const NAMES = { link: 'Start office link', desktop: 'Desktop shortcut', startup: 'Start with Windows', hooks: 'Advanced setup hooks' };

/** Advanced setup's hooks in the AI app's settings (office/src/setup.mjs adds them): taken out on uninstall, so nothing
 * calls this folder's hook once it is deleted. Only the office's own entries go (marked --ai-head-office-hook), and a
 * copy of the file is kept beside it first. A test copy or the demo changes nothing unless AHO_SETTINGS names a copy. */
async function removeHooks() {
  const where = 'hooks';
  if ((cfg.DEMO || cfg.DRY) && !process.env.AHO_SETTINGS) return { where, dryRun: 'remove the advanced setup hooks' };
  const m = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'office', 'src', 'setup.mjs')).href);
  const file = m.settingsFile();
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { where, none: true }; }
  if (!text.includes('--ai-head-office-hook')) return { where, none: true };
  let data;
  try { data = JSON.parse(text); } catch { return { where, error: file + ' is not valid JSON, so it was not changed: remove the lines holding --ai-head-office-hook yourself' }; }
  try {
    const backup = file + '.before-ai-head-office-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(backup, text);
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(m.withoutOurs(data), null, 2) + '\n');
    fs.renameSync(tmp, file);
    return { where, removed: true, backup };
  } catch (e) { return { where, error: e.message }; }
}
async function uninstall() {
  const r = await apply({ link: false, desktop: false, startup: false });
  const h = await removeHooks();
  r.results.push(h);
  if (h.error) r.errors.push(NAMES.hooks + ': ' + h.error);
  return r;
}

module.exports = { status, apply, uninstall, NODE_MIN, NAMES };
