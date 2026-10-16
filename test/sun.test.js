// Tests for office/public/sun.js (the Auto theme): sunrise and sunset close to the published times, the polar days,
// and where a time zone puts the sun. Run: node test/sun.test.js
'use strict';
const assert = require('assert');
const sun = require('../office/public/sun.js');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message); } };
// Minutes past midnight UTC of a time in ms.
const utcMin = ms => { const d = new Date(ms); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const near = (got, want, slack, what) => assert(Math.abs(got - want) <= slack, `${what}: ${got} minutes, expected about ${want}`);

check('London at the June solstice: up about 03:43 UTC, down about 20:21 UTC (within 10 minutes)', () => {
  const t = sun.times(Date.UTC(2026, 5, 21, 12), 51.51, -0.13);
  near(utcMin(t.rise), 223, 10, 'sunrise');
  near(utcMin(t.set), 1221, 10, 'sunset');
});
check('Sydney at the December solstice: a day of about 14 h 25 min', () => {
  const t = sun.times(Date.UTC(2026, 11, 21, 2), -33.87, 151.21);
  near(Math.round((t.set - t.rise) / 60000), 865, 12, 'day length');
});
check('the far north: no sunset in June, no sunrise in December', () => {
  assert.strictEqual(sun.times(Date.UTC(2026, 5, 21, 12), 78, 15).polar, 'day');
  assert.strictEqual(sun.times(Date.UTC(2026, 11, 21, 12), 78, 15).polar, 'night');
});
check('a listed zone gives its city; an unlisted one a rough place from its region', () => {
  const s = sun.place('Australia/Sydney');
  assert(s.city === 'Sydney' && !s.rough && s.lat < 0, JSON.stringify(s));
  const r = sun.place('Europe/Nowhere');
  assert(r.rough && r.lat === 50 && r.city === 'Nowhere', JSON.stringify(r));
});
check('Auto means light or dark; the other choices stay as they are', () => {
  assert(['light', 'dark'].includes(sun.resolve('auto')));
  for (const c of ['light', 'dark', 'system']) assert.strictEqual(sun.resolve(c), c);
});

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
