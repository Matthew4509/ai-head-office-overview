// SEC-020: a filled-in password, token or key in a .env file is found; a template, a reference, a number, a placeholder and
// a browser-public name are not. 
// Run: node test/envsecret.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAudit } = require('../lib/audit');

let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-env-'));
const project = (name, files) => {
  const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true });
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(d, f), text);
  return d;
};
const rules = async d => (await runAudit(d, null)).findings.filter(f => f.rule === 'SEC-020');

(async () => {
  await check('a .env with a real password, secret, token or key: found', async () => {
    for (const line of ['DB_PASSWORD=hunter2xyz99', 'JWT_SECRET="s3cr3tvalue-abcdef"', 'export ADMIN_PASSWORD=Sup3rS3cret!', 'SMTP_PASS=mailpass12345', 'STRIPE_API_KEY=abcd1234efgh5678']) {
      const f = await rules(project('bad' + Math.random().toString(36).slice(2), { '.env': line + '\n', 'app.js': 'console.log(1)\n' }));
      assert.equal(f.length, 1, line);
      assert.equal(f[0].where, '.env:1');
    }
  });
  await check('a template, a reference, a number, a placeholder, a public name, a URL setting: not a finding', async () => {
    const d = project('quiet', {
      '.env': 'DB_PASSWORD=${DB_PASSWORD}\nTOKEN_EXPIRY=86400000\nAPI_KEY=changeme_please\nNEXT_PUBLIC_API_KEY=abcdefgh12345\nTOKEN_URL=https://example.com/oauth/token\nPASSWORD=password\n',
      '.env.example': 'DB_PASSWORD=hunter2xyz99\n', 'app.js': 'console.log(1)\n' });
    assert.deepEqual(await rules(d), []);
  });
  fs.rmSync(TMP, { recursive: true, force: true });
  if (failures) { console.log(failures + ' failed'); process.exit(1); }
  console.log('all passed');
})();
