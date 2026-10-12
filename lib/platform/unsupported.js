// Any system without its own platform file yet: the office still lists projects, runs local copies, audits and checks
// live sites; the actions that need the desktop answer with a plain "not on this system yet" instead of failing.
'use strict';
const { execFileSync } = require('child_process');
const NAME = process.platform;
const NOT_YET = 'This is not available on ' + NAME + ' yet.';
const no = () => { throw new Error(NOT_YET); };

module.exports = {
  NAME,
  openUrl: no,
  findBrowser: () => null,
  pickFolder: async () => ({ error: NOT_YET + ' Type the folder path instead.' }),
  onPath: () => null,
  terminalCommand: dir => 'terminal (in ' + dir + ')',
  openTerminal: no,
  openFolder: no,
  revealFile: no,
  SHORTCUT_PLACES: { desktop: 'Desktop', startup: 'autostart' },
  shortcut: async where => ({ where, error: NOT_YET }),
  link: () => ({ where: 'link', error: NOT_YET }),
  portOwners: async () => [],
  systemProcessWhy: o => (!o.pid || o.pid <= 1 ? 'it is part of the system' : null),
  killCommand: (pid, name) => 'kill -TERM ' + pid + ' (' + name + ')',
  runnable: (exe, args) => ({ exe, args }),
  killTree: pid => { try { process.kill(pid, 'SIGTERM'); } catch {} try { execFileSync('pkill', ['-TERM', '-P', String(pid)], { stdio: 'ignore' }); } catch {} },
};
