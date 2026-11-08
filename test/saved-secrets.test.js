// AGENT-023: a password, key or token saved in an AI settings file (.claude/settings.local.json, settings.json, .mcp.json).
// Claude Code's "Yes, and don't ask again" keeps the approved command word for word, a typed password included.
// Found: the shapes real files hold. Quiet: variable references, placeholders, wildcard rules. The value is never printed.
// Run: node test/saved-secrets.test.js   (no packages). Secrets here are made up and put together at run time.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { checkSkill, agentAudit } = require('../lib/agents');
const { runAudit } = require('../lib/audit');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aho-saved-'));
const j = (...parts) => parts.join('');
const PW = j('Rk7p', 'Q2mX', 'v9Lw');                       // a made-up password
const GH = j('gh', 'p_', 'Q7wErT1yUi0pAsDfGh2jKlZxCvBn3mQwErTy');  // shaped like a GitHub token, made up
const AWS = j('AK', 'IA', 'Q7WERT1YUI0PASDF');              // shaped like an AWS key id, made up
let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + (e && e.message)); } };
const settings = o => checkSkill({ text: JSON.stringify(o, null, 2), name: 'settings.local.json' });
const mcp = o => checkSkill({ text: JSON.stringify({ mcpServers: o }, null, 2), name: '.mcp.json' });
const hits = r => (r.findings || []).filter(f => f.rule === 'AGENT-023');
const allow = (...a) => settings({ permissions: { allow: a } });

(async () => {
  await check('a database password typed into an approved command is found, High, and the value is not repeated', () => {
    const r = allow('Bash(PGPASSWORD=' + PW + ' psql -h db.acme.test -U app -c "select 1")');
    const f = hits(r);
    assert.strictEqual(f.length, 1, JSON.stringify(r.findings));
    assert.strictEqual(f[0].sev, 'High');
    assert(!JSON.stringify(r).includes(PW), 'the password is in the report');
    assert(/permissions\.allow\[0\]/.test(f[0].title), f[0].title);
  });
  const shapes = {
    'sshpass -p': 'Bash(sshpass -p ' + PW + ' ssh root@203.0.113.5)',
    'sshpass -p quoted': 'Bash(sshpass -p \'' + PW + '\' ssh root@203.0.113.5)',
    'mysql -p': 'Bash(mysql -u root -p' + PW + ' -h db.acme.test)',
    'curl -u': 'Bash(curl -u admin:' + PW + ' https://api.acme.test/x)',
    'bearer header': 'Bash(curl -H "Authorization: Bearer ' + j('eyJ', 'hbGciOiJIUzI1NiJ9') + '.abc" https://api.acme.test)',
    'api key header': 'Bash(curl -H "X-Api-Key: ' + PW + 'ab" https://api.acme.test)',
    'login in an address': 'Bash(psql postgres://app:' + PW + '@db.acme.test:5432/main)',
    '--password option': 'Bash(mongosh --host db.acme.test --password ' + PW + ')',
    '--token=': 'Bash(npm publish --token=' + PW + 'xyz)',
    'a request body': 'Bash(curl -d \'{"email":"a@b.acme","password":"' + PW + '"}\' https://api.acme.test/login)',
    'a GitHub token': 'Bash(git clone https://' + GH + '@github.com/acme/app.git)',
    'an AWS key id': 'Bash(AWS_ACCESS_KEY_ID=' + AWS + ' aws s3 ls)',
    'a password in env of a PowerShell line': 'Bash(powershell -c "$env:DB_PASSWORD=\'' + PW + '\'; run.ps1")',
    'export': 'Bash(export API_TOKEN=' + PW + 'zz && node sync.js)',
    'a short password': 'Bash(PGPASSWORD=ab12! psql -h db.acme.test)',
    'redis-cli -a': 'Bash(redis-cli -h cache.acme.test -a ' + PW + ' ping)',
    'mongosh -p': 'Bash(mongosh --host db.acme.test -u app -p ' + PW + ')',
    'ldapsearch -w': 'Bash(ldapsearch -x -D cn=admin -w ' + PW + ' -b dc=acme)',
    'docker login -p': 'Bash(docker login -u app -p ' + PW + ' registry.acme.test)',
    'az login -p': 'Bash(az login -u app@acme.test -p ' + PW + ')',
    'a password piped to docker login': 'Bash(echo ' + PW + ' | docker login --username app --password-stdin registry.acme.test)',
    'npm _authToken': 'Bash(npm config set //registry.acme.test/:_authToken ' + PW + 'ab)',
    'openssl pass:': 'Bash(openssl enc -aes-256-cbc -in a -out b -pass pass:' + PW + ')',
    'zip -P': 'Bash(zip -P ' + PW + ' out.zip secrets.txt)',
    '7z -p': 'Bash(7z a -p' + PW + ' out.7z secrets.txt)',
    'gpg --passphrase': 'Bash(gpg --batch --passphrase ' + PW + ' -d file.gpg)',
    'htpasswd -b': 'Bash(htpasswd -b .htpasswd admin ' + PW + ')',
    'net use': 'Bash(net use Z: \\\\srv\\share ' + PW + ' /user:acme\\app)',
    'ConvertTo-SecureString': 'Bash(powershell -c "ConvertTo-SecureString \'' + PW + '\' -AsPlainText -Force")',
    'sqlplus': 'Bash(sqlplus app/' + PW + '@db.acme.test)',
    'a key in an address': 'Bash(curl "https://api.acme.test/v1/list?api_key=' + PW + 'ab")',
    '--client_secret': 'Bash(tool --client_secret ' + PW + ')',
  };
  for (const [name, rule] of Object.entries(shapes)) {
    await check('found: ' + name, () => { const r = allow(rule); assert.strictEqual(hits(r).length, 1, rule + ' -> ' + JSON.stringify(r.findings)); assert(!JSON.stringify(r).includes(PW), 'value repeated'); });
  }
  await check('found: a literal key in env, hooks and an MCP server (args, env, headers)', () => {
    assert.strictEqual(hits(settings({ env: { STRIPE_API_KEY: PW + 'abcd' } })).length, 1);
    assert.strictEqual(hits(settings({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'PGPASSWORD=' + PW + ' pg_dump app' }] }] } })).length, 1);
    assert.strictEqual(hits(mcp({ db: { command: 'npx', args: ['-y', 'db-mcp', '--password', PW] } })).length, 1);
    assert.strictEqual(hits(mcp({ gh: { command: 'npx', args: ['gh-mcp'], env: { GITHUB_TOKEN: GH } } })).length, 1);
    assert.strictEqual(hits(mcp({ api: { url: 'https://mcp.acme.test/sse', headers: { Authorization: 'Bearer ' + PW + 'abcdef' } } })).length, 1);
  });
  await check('found: a damaged file is read line by line, and nothing throws', () => {
    const r = checkSkill({ text: '{ "permissions": { "allow": [ "Bash(PGPASSWORD=' + PW + ' psql)",\n', name: 'settings.local.json' });
    assert.strictEqual(hits(r).length, 1, JSON.stringify(r.findings));
    assert(!JSON.stringify(r).includes(PW));
  });
  await check('found: padding in front of the secret does not hide it, and an echoing key helper is found', () => {
    assert.strictEqual(hits(allow('Bash(echo ' + 'a'.repeat(4500) + ' && PGPASSWORD=' + PW + ' psql)')).length, 1);
    assert.strictEqual(hits(settings({ apiKeyHelper: 'echo ' + j('Aq7Zx', '9Lm2Kp4Vb8Nc1Rt6Yh3') })).length, 1);
    assert.strictEqual(hits(settings({ apiKeyHelper: '~/bin/get-key.sh' })).length, 0);
  });
  await check('one finding per file, counting every place', () => {
    const r = allow('Bash(PGPASSWORD=' + PW + ' psql)', 'Bash(sshpass -p ' + PW + ' ssh h)', 'Bash(npm test:*)');
    assert.strictEqual(hits(r).length, 1);
    assert(/2 places/.test(hits(r)[0].title), hits(r)[0].title);
  });

  const quiet = {
    'a variable': 'Bash(PGPASSWORD=$DB_PASSWORD psql -h db.acme.test)',
    'a quoted variable': 'Bash(PGPASSWORD="${DB_PASSWORD}" psql)',
    'a PowerShell variable': 'Bash(powershell -c "$env:TOKEN = $env:MY_TOKEN")',
    'a wildcard rule': 'Bash(PGPASSWORD=* psql:*)',
    'a pattern rule': 'Bash(npm run test:*)',
    'sshpass with the password in the environment': 'Bash(sshpass -e ssh root@203.0.113.5)',
    'mysql prompting for the password': 'Bash(mysql -u root -p -h db.acme.test)',
    'mysql pattern rule': 'Bash(mysql:*)',
    'a placeholder': 'Bash(PGPASSWORD=your_password_here psql)',
    'the word password': 'Bash(mysqladmin --password=password status)',
    'a local dev address': 'Bash(psql postgres://postgres:postgres@localhost:5432/dev)',
    'a plain curl': 'Bash(curl -s https://api.acme.test/health)',
    'a token file option': 'Bash(tool --password-file ./pw.txt)',
    'reading a secret file is protection': 'Read(./.env)',
    'a path under a secret-like name': 'Read(./secrets/keys.json)',
    'a branch name that starts like a key': 'Bash(git checkout feature/sk-integration-with-a-long-branch-name-here)',
    'a port flag on docker run': 'Bash(docker run -p 8080:80 nginx)',
    'a plain address with a query': 'Bash(curl "https://api.acme.test/v1/list?page=2&limit=50")',
    'tar and mkdir -p': 'Bash(mkdir -p out && tar -xpf a.tar)',
    'mongosh with no password': 'Bash(mongosh --host db.acme.test)',
  };
  for (const [name, rule] of Object.entries(quiet)) await check('quiet: ' + name, () => { const r = allow(rule); assert.strictEqual(hits(r).length, 0, rule + ' -> ' + JSON.stringify(hits(r))); });
  await check('quiet: references and placeholders in env, and a key name holding a path', () => {
    assert.strictEqual(hits(settings({ env: { DB_PASSWORD: '${DB_PASSWORD}', API_KEY: '$API_KEY', STRIPE_API_KEY: 'your-key-here', SSH_KEY_FILE: '~/.ssh/id_work', PASSWORD_FILE: '/run/secrets/db' } })).length, 0);
    assert.strictEqual(hits(mcp({ gh: { command: 'npx', args: ['gh-mcp'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } } })).length, 0);
  });
  await check('quiet: a settings file with no secrets, and an empty one', () => {
    assert.strictEqual(hits(settings({ permissions: { allow: ['Bash(git status:*)', 'WebFetch(domain:docs.acme.test)'] }, enableAllProjectMcpServers: false })).length, 0);
    assert.strictEqual(hits(checkSkill({ text: '', name: 'settings.local.json' })).length, 0);
  });

  // --- inside a project audit: the real file name, the real folder ---
  const proj = path.join(tmp, 'site');
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'index.html'), '<!doctype html><title>x</title><p>hi</p>\n');
  fs.writeFileSync(path.join(proj, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test:*)', 'Bash(PGPASSWORD=' + PW + ' psql -h db.acme.test)'] } }, null, 2) + '\n');
  await check('a project audit finds it in .claude/settings.local.json, names the line, and never shows the value', async () => {
    const a = agentAudit(proj);
    const f = a.findings.filter(x => x.rule === 'AGENT-023');
    assert.strictEqual(f.length, 1, JSON.stringify(a.findings));
    assert.strictEqual(f[0].where, '.claude/settings.local.json:5');
    const full = await runAudit(proj, null);
    assert(full.findings.some(x => x.rule === 'AGENT-023'), 'the full audit (and so the publish guard) does not carry it');
    assert(!JSON.stringify(full).includes(PW), 'the password is in the audit result');
  });
  await check('the same file with no secret raises nothing', async () => {
    fs.writeFileSync(path.join(proj, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test:*)', 'Bash(PGPASSWORD=$DB_PASSWORD psql:*)'] } }, null, 2) + '\n');
    assert(!(await runAudit(proj, null)).findings.some(x => x.rule === 'AGENT-023'));
  });

  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
