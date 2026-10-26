// Windows' own programs are started by their full path, never by a bare name: Windows looks for a bare name in the
// working folder first, and for Open terminal that is the project's folder (a downloaded project could ship its own
// cmd.exe). Nothing is started here: child_process is replaced before lib/platform/windows.js reads it. Then the office
// itself is checked to work from its own folder, wherever it was started from.
// Run: node test/platform.test.js   (Windows; no packages)
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const assert = require('assert');
const { EventEmitter } = require('events');
const cp = require('child_process');

const realSpawnSync = cp.spawnSync;
let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// Every program the platform file asks Windows to start, and what where.exe answers for "wt" (null: not installed).
const started = [];
let wtAt = null;
cp.spawn = (exe, args, opts) => {
  started.push({ exe, args, opts });
  const c = new EventEmitter();
  c.unref = () => {};
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
  c.stdout.setEncoding = c.stderr.setEncoding = () => {};
  setImmediate(() => c.emit('close', 0));
  return c;
};
cp.execFileSync = (exe, args, opts) => {
  started.push({ exe, args, opts });
  if (args[0] === 'wt') { if (wtAt) return wtAt + '\r\n'; throw Object.assign(new Error('not found'), { status: 1 }); }
  return '';
};
process.env.AHO_LINK_KEY = 'HKCU\\Software\\Classes\\aho-platform-test-never-written';
const win = require('../lib/platform/windows');

const WINDIR = process.env.SystemRoot || 'C:\\Windows';
const CMD = path.join(WINDIR, 'System32', 'cmd.exe');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-platform-test-'));
// A made-up downloaded project that ships its own cmd.exe (and a ; in its name, so Open terminal takes the cmd way).
const project = path.join(tmp, 'odd;project');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'cmd.exe'), 'not a program');
const bare = s => typeof s === 'string' && /\.exe$/i.test(s) && !path.isAbsolute(s);

async function main() {
  await check('Open terminal without Windows Terminal: cmd.exe from System32 (both of them), the project only as the working folder', () => {
    started.length = 0; wtAt = null;
    win.openTerminal(project);
    const t = started.find(s => s.opts && s.opts.detached);
    assert(t, 'a terminal was started');
    assert.strictEqual(t.exe.toLowerCase(), CMD.toLowerCase());
    assert(t.args.some(a => String(a).toLowerCase() === CMD.toLowerCase()), 'the cmd that start opens is named in full: ' + t.args.join(' '));
    assert(!t.args.some(bare), 'no bare program name in ' + t.args.join(' '));
    assert.strictEqual(t.opts.cwd, project);
  });

  await check('Open terminal with Windows Terminal: wt where Windows found it, cmd.exe from System32', () => {
    started.length = 0; wtAt = path.join(tmp, 'apps', 'wt.exe');
    const plain = path.join(tmp, 'plain project');
    win.openTerminal(plain);
    const t = started.find(s => s.opts && s.opts.detached);
    assert.strictEqual(t.exe, wtAt);
    assert.deepStrictEqual(t.args.map(String), ['-d', plain, CMD, '/k']);
    wtAt = null;
  });

  await check('every Windows program the office starts is named by its full path, and is there', async () => {
    started.length = 0;
    win.openUrl('https://example.test/');
    win.openFolder(tmp);
    win.revealFile(path.join(project, 'cmd.exe'));
    win.killTree(999999);
    win.onPath('git');
    win.link('query', tmp);
    await win.portOwners([65000]);
    await win.drives();
    const r = win.runnable('serve', [], (() => { const d = path.join(tmp, 'scripted'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'serve.cmd'), '@echo off\r\n'); return d; })());
    assert(started.length >= 8, 'each call started its program (' + started.length + ')');
    for (const s of started) {
      assert(path.isAbsolute(s.exe), 'bare program name: ' + s.exe);
      assert(fs.existsSync(s.exe), 'not on this PC: ' + s.exe);
    }
    assert.strictEqual(r.exe.toLowerCase(), CMD.toLowerCase(), 'a project\'s .cmd runs through System32\'s cmd.exe');
  });

  await check('the office works from its own folder, wherever it is started from', async () => {
    const elsewhere = path.join(tmp, 'started from here');
    fs.mkdirSync(elsewhere);
    const probe = path.join(tmp, 'probe.js');
    fs.writeFileSync(probe, "process.on('exit', () => require('fs').writeSync(1, '\\nCWD=' + process.cwd() + '\\n'));\n");
    // --status on a port nobody answers: the quickest way through server.js, and it starts no office.
    const r = realSpawnSync(process.execPath, ['-r', probe, path.join(__dirname, '..', 'server.js'), '--status', '--port=' + await freePort()], { cwd: elsewhere, encoding: 'utf8', timeout: 20000 });
    const m = /CWD=(.+)/.exec(r.stdout || '');
    assert(m, 'no answer: ' + (r.stdout || '') + (r.stderr || ''));
    assert.strictEqual(m[1].trim().toLowerCase(), path.resolve(__dirname, '..').toLowerCase());
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
}
main();
