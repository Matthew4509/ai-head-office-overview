// Demo mode shows no real path or user name: the office's own folders, the home folder, and a path typed by hand
// (a git remote such as /Users/<name>/repo) all read as "demo".
// Run: node test/demo-mask.test.js
'use strict';
const assert = require('assert');
const os = require('os');
const path = require('path');

process.argv.push('--demo');
const { send } = require('../lib/http');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
const answer = (body) => { let out = ''; send({ writeHead() {}, end(t) { out = t; } }, 200, body); return out; };
const user = path.basename(os.homedir());

check('a hand-typed /Users/<name>/ path (either slash, any case) is masked', () => {
  const out = answer({ a: '/Users/' + user + '/repo.git', b: 'file:///users/' + user.toUpperCase() + '/x', c: 'C:\\Users\\' + user + '\\p' });
  assert(!new RegExp('users[\\\\/]+' + user + '(?![\\w-])', 'i').test(out), out);
  assert(/\/Users\/demo\/repo\.git/.test(out), out);
});
check('another user name that only starts the same is left alone', () => {
  assert(answer({ a: '/Users/' + user + 'x/y' }).includes('/Users/' + user + 'x/y'));
});

console.log(failures ? failures + ' FAILED' : 'all passed');
process.exit(failures ? 1 : 0);
