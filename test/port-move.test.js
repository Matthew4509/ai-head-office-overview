// Tests for Re-allocate (lib/runner.js onPort): a start command moved to a clean port names the new port wherever it
// named the old one as a whole number, and nowhere else. Run: node test/port-move.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
// lib/state reads (and on a first run writes) the settings in the data folder: a throwaway one here.
process.env.AHO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-move-'));
const { onPort } = require('../lib/runner');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };

check('the port in the arguments is swapped: alone, after a host, after = and inside a flag', () => {
  const c = onPort({ exe: 'node', args: ['serve.js', '5307', '127.0.0.1:5307', '--port=5307', '-p', '5307'], port: 5307 }, 5307, 5309);
  assert.deepStrictEqual(c.args, ['serve.js', '5309', '127.0.0.1:5309', '--port=5309', '-p', '5309']);
  assert(c.port === 5309 && c.env.PORT === '5309' && c.moved.named === true && c.moved.from === 5307, JSON.stringify(c));
});
check('a longer number, or a file name, that only contains the port is left alone', () => {
  const c = onPort({ args: ['53070', '15307', 'v5307x', 'serve-5307.js'], port: 5307 }, 5307, 5309);
  assert.deepStrictEqual(c.args, ['53070', '15307', 'v5307x', 'serve-5307.js']);
});
check('the port alone, a port option, or an address ending in it is moved', () => {
  const c = onPort({ args: ['5307', '--port=5307', 'localhost:5307', 'http://127.0.0.1:5307'], port: 5307 }, 5307, 5309);
  assert.deepStrictEqual(c.args, ['5309', '--port=5309', 'localhost:5309', 'http://127.0.0.1:5309']);
});
check('a command that does not name its port is moved through PORT only, and says so', () => {
  const c = onPort({ exe: 'npm', args: ['run', 'dev'], port: 3000 }, 3000, 3001);
  assert(c.args.join(' ') === 'run dev' && c.env.PORT === '3001' && c.moved.named === false, JSON.stringify(c));
});
check('a start file\'s own env is kept on a move; only PORT changes (also when the env named the old port)', () => {
  const c = onPort({ exe: 'npx', args: ['craco', 'start'], port: 3010, env: { PORT: '3010', BROWSER: 'none', DATA_DIR: 'data' } }, 3010, 3011);
  assert.deepStrictEqual(c.env, { PORT: '3011', BROWSER: 'none', DATA_DIR: 'data' });
});
try { fs.rmSync(process.env.AHO_DATA, { recursive: true, force: true }); } catch { /* left in temp */ }
console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
