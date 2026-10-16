// Run by install.cmd and uninstall.cmd (they check Node.js first). Asks in the console window, then sets up or takes
// away the Start office link, the desktop shortcut and Start with Windows, for this Windows user only.
//   node tools/setup.js install            asks about the shortcut and Start with Windows (both Yes if Enter)
//   node tools/setup.js install --yes      no questions: link, shortcut and Start with Windows
//   node tools/setup.js uninstall          stops the office, takes all three away; the folder is left for you to delete
// Add --no-desktop / --no-startup to leave one out without being asked.
'use strict';
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const cmd = args[0];
const has = f => args.includes(f);
const setup = require('../lib/setup');
const say = s => console.log(' ' + s);

// One reader for the whole run (answers can arrive together when typed ahead or piped in by a test). No input left
// counts as Enter, that is Yes.
let rl = null, lines = [], waiting = null, closed = false;
async function ask(q) {
  if (has('--yes')) return true;
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin });
    rl.on('line', l => { if (waiting) { const w = waiting; waiting = null; w(l); } else lines.push(l); });
    rl.on('close', () => { closed = true; if (waiting) { const w = waiting; waiting = null; w(''); } });
  }
  process.stdout.write(' ' + q + ' [Y/n] ');
  const a = lines.length ? lines.shift() : closed ? '' : await new Promise(r => { waiting = r; });
  if (!process.stdin.isTTY) console.log(a);
  return !/^\s*n/i.test(a);
}

function report(r) {
  for (const x of r.results) {
    const name = setup.NAMES[x.where];
    if (x.error) say('  x ' + name + ': ' + x.error);
    else if (x.dryRun) say('  - ' + name + ': test copy, not changed (' + x.dryRun + ')');
    else if (x.where === 'hooks') say('  OK ' + name + (x.removed ? ' taken out of the AI app settings (a copy is kept: ' + x.backup + ')' : ': none were set up'));
    else say('  ' + (x.exists ? 'OK ' + name + (x.path ? ' (' + x.path + ')' : '') : 'OK ' + name + ' removed'));
  }
}

// install.cmd has just asked both questions: the office's first-start Welcome window must not ask them again (and its
// ticked boxes must not undo a no). Kept in the office's own settings file.
function welcomed() {
  try {
    const Settings = require('../lib/settings');
    const cfg = require('../lib/config');
    const s = Settings.load(cfg.SETTINGS_FILE, cfg.DEFAULT_ROOT);
    s.welcomed = true;
    Settings.save(cfg.SETTINGS_FILE, s);
  } catch { /* the Welcome then asks once more: no harm */ }
}

async function install() {
  const want = { link: true };
  want.desktop = has('--no-desktop') ? undefined : await ask('Put a AI Head Office Overview shortcut on your desktop?');
  want.startup = has('--no-startup') ? undefined : await ask('Start the office quietly when you sign in to Windows?');
  if (want.desktop === false) want.desktop = undefined; // "no" leaves an existing one alone; About can remove it
  if (want.startup === false) want.startup = undefined;
  console.log('');
  const r = await setup.apply(want);
  report(r);
  welcomed();
  if (r.errors.length) { say(''); say('Not everything could be set up. The office still works: start it with start.cmd.'); return 1; }
  return 0;
}

async function uninstall() {
  // Stop a running office first (it would put the link back the next time it starts).
  try { execFileSync(process.execPath, [path.join(__dirname, '..', 'server.js'), '--stop'], { stdio: 'ignore', timeout: 15000 }); } catch {}
  const r = await setup.uninstall();
  report(r);
  const s = await setup.status();
  say('');
  say('AI Head Office Overview is switched off and its links are gone. Its files are still in');
  say('  ' + s.folder);
  say('Delete that folder to remove it completely (your settings, audits and prompts are in its data folder).');
  return r.errors.length ? 1 : 0;
}

(async () => {
  if (cmd === 'install') process.exitCode = await install();
  else if (cmd === 'uninstall') process.exitCode = await uninstall();
  else { say('Use: node tools/setup.js install | uninstall'); process.exitCode = 2; }
  if (rl) rl.close();
})();
