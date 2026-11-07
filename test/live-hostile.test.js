// Self-test: a hostile live page (400 KB of unfinished tags) must not freeze the office (audit 8 Nov, R1).
// lib/live.js finds tags with a linear scanner; each parse below must finish in well under a second.
// Run: node test/live-hostile.test.js   (no packages; nothing is fetched).
'use strict';
const assert = require('assert');
const { pageRefs, judge } = require('../lib/live');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
const timed = fn => { const t = Date.now(); const r = fn(); return { r, ms: Date.now() - t }; };

const HOSTILE = { '<title ': 57000, '<a ': 133000, '<meta ': 66000, '<link ': 66000, '<script ': 50000, '<script>': 50000, '<div hidden>': 33000, '<a href=x>': 40000, '<': 400000 };
for (const [piece, n] of Object.entries(HOSTILE)) {
  const body = piece.repeat(n);
  check('400 KB of ' + piece + ' parses fast (pageRefs and judge)', () => {
    const a = timed(() => pageRefs(body, 'https://example.com/'));
    const b = timed(() => judge('https://example.com/', { status: 200, ms: 50, body, headers: {}, finalUrl: 'https://example.com/' }));
    assert(a.ms < 500, 'pageRefs took ' + a.ms + ' ms');
    assert(b.ms < 500, 'judge took ' + b.ms + ' ms');
    assert(b.r.state === 'up' || b.r.state === 'unsure');
  });
}
check('a normal page is still read: title, links, hidden link, inline script host', () => {
  const html = '<html><head><title> My  shop </title></head><body><a href="/x">x</a><div style="display:none"><a href="https://spam.example/p">s</a></div><script>var u="https://cdn.evil.example/a.js"; document.write(u)</script></body></html>';
  const refs = pageRefs(html, 'https://shop.example/');
  assert(refs.some(r => r.host === 'shop.example' && !r.hidden));
  assert(refs.some(r => r.host === 'spam.example' && r.hidden));
  assert(refs.some(r => r.host === 'cdn.evil.example' && r.kind === 'inline-script'));
  const j = judge('https://shop.example/', { status: 200, ms: 50, body: '<title>Welcome to nginx!</title>', headers: {}, finalUrl: 'https://shop.example/' });
  assert(/default server page/.test(j.reason), j.reason);
});
console.log(failures ? failures + ' FAILED' : 'all passed');
process.exit(failures ? 1 : 0);
