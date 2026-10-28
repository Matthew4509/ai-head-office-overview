// Windows, browsers, terminals and shortcuts the office opens on the desktop. This is the one place that decides
// whether to really do it: a dry run (tests) reports what it would have done, and a demo only pretends.
'use strict';
const path = require('path');
const cfg = require('./config');
const os = require('./platform');

function openBrowser(url) {
  if (cfg.DRY) return { dryRun: 'browser ' + url };
  os.openUrl(url);
  return {};
}

// The office's own window: the browser in app mode (no address bar or tabs, its own taskbar button and icon).
// Without it, the default browser opens instead.
function openAppWindow() {
  const url = 'http://127.0.0.1:' + cfg.PORT + '/';
  const browser = os.findBrowser();
  if (!browser) return openBrowser(url);
  if (cfg.DRY) return { dryRun: 'app window ' + browser + ' --app=' + url };
  require('child_process').spawn(browser, ['--app=' + url, '--window-size=1280,840'], { detached: true, stdio: 'ignore' }).unref();
  return {};
}

const PICK_TITLES = { working: 'Choose a working folder (a folder that holds projects)', project: 'Choose a project folder to add', backup: 'Choose where backups go (a USB drive is best)' };
function pickFolder(purpose) {
  const title = PICK_TITLES[purpose] || PICK_TITLES.project;
  if (cfg.DRY) return Promise.resolve({ dryRun: 'folder picker: ' + title });
  return os.pickFolder(title);
}

// A plain terminal in the project folder. The office starts no AI tool: Copy prompt gives the person a line to paste
// into the AI of their choice.
function openTerminal(dir) {
  if (cfg.DRY) return { dryRun: os.terminalCommand(dir) };
  os.openTerminal(dir);
  return {};
}

function openFolder(dir) {
  if (cfg.DRY) return { dryRun: 'explorer ' + dir };
  os.openFolder(dir);
  return {};
}
function revealFile(file) {
  if (cfg.DRY || cfg.DEMO) return { dryRun: 'explorer /select,' + file };
  os.revealFile(file);
  return {};
}

// Desktop shortcut and Start with Windows. AHO_SHORTCUT_DIR: tests use a temp folder instead of the real ones.
function shortcut(where, action) {
  where = where === 'startup' ? 'startup' : 'desktop';
  action = ['create', 'remove'].includes(action) ? action : 'status';
  const testDir = process.env.AHO_SHORTCUT_DIR ? path.join(process.env.AHO_SHORTCUT_DIR, where) : '';
  if (cfg.DRY && action !== 'status' && !testDir) return Promise.resolve({ where, exists: false, dryRun: action + ' ' + where + ' shortcut' });
  if (cfg.DEMO) return Promise.resolve({ where, exists: true, path: 'C:\\Users\\demo\\' + os.SHORTCUT_PLACES[where] + '\\AI Head Office Overview.lnk', ...(action === 'status' ? {} : { dryRun: 'demo, nothing changed' }) });
  return os.shortcut(where, action, testDir);
}

// Settings › About › Update with no Git: Windows' own installer, in a window the person watches. A test copy only says so.
function installGit() {
  if (cfg.DRY || cfg.DEMO) return { ok: true, dryRun: os.installGitCommand(os.onPath('winget')) };
  return os.installGit();
}

module.exports = { openBrowser, openAppWindow, pickFolder, openTerminal, openFolder, revealFile, shortcut, installGit };
