// Setup and uninstall, in one place for install.cmd / uninstall.cmd (through tools/setup.js) and Settings › Setup
// (Run setup again, Uninstall). Three things, each for this Windows user only: the Start office link
// (ai-head-office://start), the desktop shortcut, and Start with Windows. Nothing here deletes the office's folder or
// its data: uninstall says where they are, and the person removes the folder themselves.
'use strict';
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
const NAMES = { link: 'Start office link', desktop: 'Desktop shortcut', startup: 'Start with Windows' };

const uninstall = () => apply({ link: false, desktop: false, startup: false });

module.exports = { status, apply, uninstall, NODE_MIN, NAMES };
