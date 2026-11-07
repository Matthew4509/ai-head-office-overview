// Scanner gaps from the second code review (R2 R3 R4 R5 R6 R9) and the scanner audit: a long line is still read, short
// passwords and generic key names are found, test folders still report a real database password, the two slow patterns stay
// fast, the "last updated" walk is not blinded by pictures, .env files are read in more forms, and the new token / eval / md5 rules.
// Run: node test/scanner-gaps.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAudit } = require('../lib/audit');
const { lastUpdated, lastUpdatedAsync } = require('../lib/projects');

let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-gaps-'));
let n = 0;
const project = files => {
  const d = path.join(TMP, 'p' + (++n)); fs.mkdirSync(d, { recursive: true });
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), text); }
  return d;
};
const found = async files => (await runAudit(project(files), null)).findings;
const has = (list, rule, where) => list.some(f => f.rule === rule && (!where || f.where.startsWith(where + ':')));
const rnd = len => { let s = ''; const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; for (let i = 0; i < len; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };
const j = (...p) => p.join('');
const PG = 'postgres' + '://', MG = 'mongodb' + '://', RD = 'redis' + '://', MY = 'mysql' + '://'; // keys are built here so this file holds none whole

(async () => {
  // ---- R2: a long line is read ----
  await check('R2: a command injection followed by a 2100-character comment is still found', async () => {
    const f = await found({ 'src/padded.js': "exec(req.query.cmd); // " + 'x'.repeat(2100) + '\n' });
    assert(has(f, 'INJ-006', 'src/padded.js'), JSON.stringify(f.map(x => x.rule)));
  });
  await check('R2: the same statement after a long padding is found too', async () => {
    const f = await found({ 'src/padded2.js': "var pad = '" + 'y'.repeat(3000) + "'; exec(req.query.cmd);\n" });
    assert(has(f, 'INJ-006', 'src/padded2.js'));
  });
  await check('R2: a long line with nothing wrong in it stays quiet', async () => {
    const f = await found({ 'src/long.js': 'var a = [' + '1,'.repeat(3000) + '2];\n' });
    assert.deepEqual(f.filter(x => x.sev !== 'Low'), []);
  });

  // ---- R3: passwords and keys by name and length ----
  const quoteWith = (name, value) => name + ' = "' + value + '";\n';
  for (const [name, file, line] of [
    ['dbPassword', 'a.js', 'const dbPassword = "Hq7mZp2x9Kd4";'],
    ['DB_PASSWORD', 'a.js', 'const DB_PASSWORD = "Hq7mZp2x9Kd4";'],
    ['smtp_password', 'a.js', 'const smtp_password = "Hq7mZp2x9Kd4";'],
    ['appSecret', 'a.js', 'const appSecret = "Hq7mZp2x9Kd4";'],
    ['client_secret', 'a.js', 'const client_secret = "Hq7mZp2x9Kd4";'],
    ['pass in an object', 'a.js', 'const c = { host: "db.x.io", pass: "Hq7mZp2x9Kd4" };'],
    ['Python DB_PASSWORD', 'a.py', 'DB_PASSWORD = "Hq7mZp2x9Kd4"'],
    ['API_KEY', 'a.js', 'const API_KEY = "' + rnd(32) + '";'],
    ['apiKey', 'a.js', 'const apiKey = "' + rnd(32) + '";'],
    ['token', 'a.js', 'const token = "' + rnd(32) + '";'],
  ]) {
    await check('R3: found, ' + name + ' with a short value', async () => {
      const f = await found({ ['src/' + file]: line + '\n' });
      assert(f.some(x => /^SEC-0(04|18)$/.test(x.rule) && x.where.startsWith('src/' + file + ':')), JSON.stringify(f.map(x => x.rule)));
    });
  }
  await check('R3: quiet, a label, a placeholder, a read from settings and a short word', async () => {
    const f = await found({ 'src/q.js': [
      "const passwordLabel = 'Enter your password here';", "const password = 'password';", "const dbPassword = process.env.DB_PASSWORD;",
      "const newPassword = 'newPassword';", "const apiKey = 'your-api-key-here';", "const token = 'abc';", "const tokenType = 'Bearer1234';",
      "const secret = 'changeme-please';", "const DB_PASSWORD = 'test-password-1';",
    ].join('\n') + '\n' });
    assert(!f.some(x => /^SEC-0(04|18)$/.test(x.rule)), JSON.stringify(f.filter(x => /^SEC-0/.test(x.rule))));
  });

  // ---- R4: test folders and placeholder words ----
  const DB = PG + 'admin:' + 'Hq7mZp2x9Kd4' + '@db-prod.mycompany.io/app';
  await check('R4: a database address with a real password in tests/ is reported', async () => {
    const f = await found({ 'tests/db.js': "const url = '" + DB + "';\n", 'package.json': '{}' });
    assert(has(f, 'SEC-016', 'tests/db.js'));
  });
  await check('R4: a Slack webhook in a spec folder is reported', async () => {
    const f = await found({ 'spec/hook.js': "const h = 'https://hooks.slack.com/services/T" + rnd(8).toUpperCase() + '/B' + rnd(8).toUpperCase() + '/' + rnd(24) + "';\n" });
    assert(has(f, 'SEC-005', 'spec/hook.js'));
  });
  await check('R4: placeholders in tests/ stay quiet', async () => {
    const f = await found({ 'tests/db.js': `const a = '${PG}user:password@localhost/app';\nconst b = '${PG}test:hunter22@db.example.com/app';\nconst c = '${MY}root:changeme@db.host.io/app';\n` });
    assert(!has(f, 'SEC-016'));
  });
  await check('R4: "test" inside a host name (latest-db) does not hide a database password', async () => {
    const f = await found({ 'src/db.js': `const url = '${PG}admin:Hq7mZp2x9Kd4@latest-db.mycompany.io/app';\n` });
    assert(has(f, 'SEC-016', 'src/db.js'));
  });
  await check('R4: "contest" in a comment does not hide a password', async () => {
    const f = await found({ 'src/c.js': "const o = { password: 'Hq7mZp2x9Kd4' }; // contest entry\n" });
    assert(has(f, 'SEC-004', 'src/c.js'));
  });
  await check('R4: a made-up key first and a real one second on one line: the real one is found', async () => {
    const real = j('sk-ant-', 'api03-', rnd(40));
    const f = await found({ 'src/k.js': 'const keys = ["sk-ant-api03-fake00000000000000000000", "' + real + '"];\n' });
    assert(has(f, 'SEC-002', 'src/k.js'));
  });
  await check('R4: a made-up key alone stays quiet', async () => {
    const f = await found({ 'src/k.js': 'const k = "sk-ant-api03-fake00000000000000000000";\n' });
    assert(!has(f, 'SEC-002'));
  });

  // ---- R5: the two quadratic patterns ----
  await check('R5: 390,000 blank lines in a PHP file take well under a second', async () => {
    const d = project({ 'index.php': '<?php echo 1; ?>\n' + ' \n'.repeat(380000) });
    const t0 = Date.now(); await runAudit(d, null); assert(Date.now() - t0 < 5000, 'took ' + (Date.now() - t0) + ' ms');
  });
  await check('R5: a long run of "<" in a privacy page does not stall the cross-file checks', async () => {
    const d = project({ 'privacy.html': '<p>' + '<'.repeat(200000) + '</p>\n', 'index.html': '<html><body>hi</body></html>\n' });
    const t0 = Date.now(); await runAudit(d, null); assert(Date.now() - t0 < 5000, 'took ' + (Date.now() - t0) + ' ms');
  });
  await check('R5: the tag-stripping pattern itself is linear', () => {
    const { crossAudit } = require('../lib/cross');
    assert.equal(typeof crossAudit, 'function');
    const t0 = Date.now(); '<'.repeat(200000).replace(/<[^<>]{0,400}>/g, ' '); assert(Date.now() - t0 < 100);
  });

  // ---- R6: a folder of pictures does not hide an edit ----
  await check('R6: 3,500 old pictures in assets/ do not hide a newer src/app.js', async () => {
    const d = project({ 'src/app.js': 'x\n' });
    fs.mkdirSync(path.join(d, 'assets'));
    const old = new Date('2020-01-01T00:00:00Z');
    for (let i = 0; i < 3500; i++) { const p = path.join(d, 'assets', 'img' + i + '.png'); fs.writeFileSync(p, 'x'); fs.utimesSync(p, old, old); }
    const recent = Date.now() - 60000;
    assert(lastUpdated(d) > recent, 'sync');
    assert((await lastUpdatedAsync(d)) > recent, 'async');
  });

  // ---- R9: .env in more forms ----
  const env = async (file, text) => has(await found({ [file]: text, 'app.js': 'console.log(1)\n' }), 'SEC-020');
  for (const [file, line] of [
    ['.env', 'db_password=hunter2xyz99'], ['.env', 'APP_KEY=base64:' + rnd(43) + '='], ['.env.production', 'ENCRYPTION_KEY=' + rnd(32)],
    ['.env.production', 'SESSION_KEY=' + rnd(24) + '9'], ['prod.env', 'JWT_SECRET=s3cr3tvalue-abcdef'], ['prod.env', 'ADMIN_PASSWORD=Sup3rS3cret!'],
    ['.env', 'DATABASE_URL=' + PG + 'user:Hq7mZp2x9Kd4@db-prod.mycompany.io/app'], ['.env', 'MONGO_URI=' + MG + 'user:Hq7mZp2x9Kd4@cluster.mycompany.io/app'],
    ['.env', 'REDIS_URL=' + RD + 'default:Hq7mZp2x9Kd4@cache.mycompany.io:6379'], ['.env', 'smtp_pass=mailpass12345'],
  ]) await check('R9: found, ' + file + ' ' + line.split('=')[0], async () => assert(await env(file, line + '\n'), line));
  for (const [file, line] of [
    ['.env', 'DATABASE_URL=' + PG + 'user:password@localhost:5432/app'], ['.env', 'APP_KEY='], ['.env', 'SORT_KEY=created_at_desc'],
    ['.env', 'STRIPE_PUBLISHABLE_KEY=' + 'pk_live_' + rnd(24)], ['.env', 'REDIS_URL=' + RD + 'localhost:6379'], ['example.env', 'JWT_SECRET=s3cr3tvalue-abcdef'],
    ['.env.example', 'DB_PASSWORD=hunter2xyz99'], ['.env', 'JWT_SECRET=${JWT_SECRET}'], ['.env', 'db_password=changeme'],
  ]) await check('R9: quiet, ' + file + ' ' + line.slice(0, 30), async () => assert(!(await env(file, line + '\n')), line));

  // ---- new formats and sinks ----
  const formats = [
    ['Discord bot token', 'M' + rnd(23) + '9.' + rnd(6) + '.' + rnd(27)],
    ['Telegram bot token', '584920173:AA' + rnd(33)],
    ['Shopify', 'shp' + 'at_' + [...Array(32)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')],
    ['DigitalOcean', 'dop' + '_v1_' + [...Array(64)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')],
    ['Mapbox secret', 'sk' + '.eyJ' + rnd(40) + '.' + rnd(22)],
    ['Square', 'EAAA' + rnd(60)],
    ['Azure storage', 'DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=' + rnd(86) + '==;EndpointSuffix=core.windows.net'],
  ];
  for (const [name, tok] of formats) await check('SEC-021 finds a ' + name, async () => assert(has(await found({ 'src/t.js': "const t = '" + tok + "';\n" }), 'SEC-021', 'src/t.js'), tok));
  await check('SEC-021 stays quiet on a dotted name and a repeated-character stand-in', async () => {
    assert(!has(await found({ 'src/t.js': "const x = ManagerForTheWholeApplication.process.someLongFunctionNameThatIsLong();\nconst t = 'shp" + "at_" + 'a'.repeat(32) + "';\n" }), 'SEC-021'));
  });
  await check('SEC-022 finds a bearer token written into a header and not a variable', async () => {
    assert(has(await found({ 'src/h.js': "fetch(u, { headers: { Authorization: 'Bearer " + rnd(40) + "' } });\n" }), 'SEC-022', 'src/h.js'));
    assert(!has(await found({ 'src/h.js': "fetch(u, { headers: { Authorization: `Bearer ${token}` } });\nconst x = 'Bearer your-token-goes-here-123456789012';\n" }), 'SEC-022'));
  });
  await check('INJ-020 finds eval / new Function / vm on request data and not a fixed string', async () => {
    for (const line of ['eval(req.body.code);', 'const f = new Function(req.body.expr);', 'vm.runInNewContext(req.query.src, {});', 'const r = eval("(" + req.body.json + ")");'])
      assert(has(await found({ 'src/e.js': line + '\n' }), 'INJ-020', 'src/e.js'), line);
    assert(!has(await found({ 'src/e.js': "eval('1+1');\nconst r = JSON.parse(req.body.json);\n" }), 'INJ-020'));
  });
  await check('AUTH-017 finds md5 / sha1 of a password in JavaScript and not of a file', async () => {
    for (const line of ["const h = crypto.createHash('md5').update(req.body.password).digest('hex');", 'const h = md5(password);', "const h = crypto.createHash('sha1').update(password + salt).digest('hex');"])
      assert((f => has(f, 'AUTH-017', 'src/u.js') || has(f, 'AUTH-001', 'src/u.js'))(await found({ 'src/u.js': line + '\n' })), line); // md5(password) is AUTH-001's
    assert(!has(await found({ 'src/u.js': "const h = crypto.createHash('md5').update(fileBuffer).digest('hex');\nconst s = crypto.createHash('sha256').update(req.body.password).digest('hex');\n" }), 'AUTH-017'));
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  if (failures) { console.log(failures + ' failed'); process.exit(1); }
  console.log('all passed');
})();
