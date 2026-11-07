// Museum: faults the scanner audit and the second code review found missed in AI-built Node apps. The tokens are put
// together here from parts, so this file holds no whole key.
'use strict';

const PG = 'postgres' + '://';
const hex = (n, seed) => { let s = ''; for (let i = 0; i < n; i++) s += '0123456789abcdef'[(i * 7 + seed * 3 + (i >> 2)) % 16]; return s; };
const alnum = (n, seed) => { let s = ''; const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; for (let i = 0; i < n; i++) s += a[(i * 11 + seed * 5 + (i >> 1) * 3) % a.length]; return s; };

module.exports = [
  {
    id: 'sec-service-token-formats', bucket: 'R', phase: 'H2', faults: 4, examples: ['scanner-audit-2026-11-08'],
    title: 'A Discord, Telegram, Shopify or DigitalOcean token is written into the code',
    at: 'src/bot.js',
    bad: { 'src/bot.js': `const discord = '${'M' + alnum(23, 1) + '9'}.${alnum(6, 2)}.${alnum(27, 3)}';\nconst shop = '${'shp' + 'at_' + hex(32, 4)}';\nconst tg = '${'584920173:AA' + alnum(33, 5)}';\nconst doc = '${'dop' + '_v1_' + hex(64, 6)}';\n` },
    good: { 'src/bot.js': `const discord = process.env.DISCORD_TOKEN;\nconst shop = process.env.SHOPIFY_TOKEN;\nconst tg = process.env.TELEGRAM_TOKEN;\nconst doc = process.env.DO_TOKEN;\n` },
  },
  {
    id: 'sec-bearer-in-header', bucket: 'R', phase: 'H2', faults: 1, examples: ['scanner-audit-2026-11-08'],
    title: 'An Authorization header holds the bearer token itself',
    at: 'src/api.js',
    bad: { 'src/api.js': `export const get = u => fetch(u, { headers: { Authorization: 'Bearer ${alnum(40, 7)}' } });\n` },
    good: { 'src/api.js': 'export const get = (u, token) => fetch(u, { headers: { Authorization: `Bearer ${token}` } });\n' },
  },
  {
    id: 'inj-eval-request-data', bucket: 'R', phase: 'H2', faults: 2, examples: ['scanner-audit-2026-11-08'],
    title: 'Request data is passed to eval or new Function on the server',
    at: 'server.js',
    bad: { 'server.js': `const express = require('express');\nconst app = express();\napp.use(express.json());\napp.post('/calc', (req, res) => res.json({ result: eval(req.body.expr) }));\napp.listen(3000);\n` },
    good: { 'server.js': `const express = require('express');\nconst app = express();\napp.use(express.json());\napp.post('/calc', (req, res) => res.json({ result: Number(req.body.a) + Number(req.body.b) }));\napp.listen(3000);\n` },
  },
  {
    id: 'auth-md5-password-js', bucket: 'R', phase: 'H2', faults: 1, examples: ['scanner-audit-2026-11-08'],
    title: 'A password is hashed with md5 in JavaScript',
    at: 'auth.js',
    bad: { 'auth.js': `const crypto = require('crypto');\nexports.hash = (req) => crypto.createHash('md5').update(req.body.password).digest('hex');\n` },
    good: { 'auth.js': `const bcrypt = require('bcrypt');\nexports.hash = (req) => bcrypt.hash(req.body.password, 12);\n` },
  },
  {
    id: 'sec-camel-password-short', bucket: 'R', phase: 'H2', faults: 3, examples: ['code-review-2-R3'],
    title: 'A password named dbPassword / smtp_password, or a {pass: ...} setting, of under 20 characters',
    at: 'src/db.js',
    bad: { 'src/db.js': `const dbPassword = 'Hq7mZp2x9Kd4';\nconst mail = { host: 'smtp.acme.io', pass: 'Wn4sTv8Lc2Rj' };\n` },
    good: { 'src/db.js': `const dbPassword = process.env.DB_PASSWORD;\nconst mail = { host: 'smtp.acme.io', pass: process.env.SMTP_PASS };\n` },
  },
  {
    id: 'sec-env-generic-secrets', bucket: 'R', phase: 'H2', faults: 4, examples: ['code-review-2-R9'],
    title: 'A .env holds a database address with a password, a JWT secret, an admin password and an APP_KEY',
    at: '.env',
    bad: { '.env': `DATABASE_URL=${PG}app:Hq7mZp2x9Kd4@db-prod.acme.io/shop\nJWT_SECRET=${alnum(32, 8)}\nadmin_password=Wn4sTv8Lc2Rj\nAPP_KEY=base64:${alnum(43, 9)}=\n`, 'app.js': 'console.log(1)\n' },
    good: { '.env': `DATABASE_URL=\nJWT_SECRET=\nadmin_password=\nAPP_KEY=\n`, 'app.js': 'console.log(1)\n' },
  },
  {
    id: 'sec-db-url-in-tests', bucket: 'R', phase: 'H2', faults: 1, examples: ['code-review-2-R4'],
    title: 'A test file holds the address and password of a real database',
    at: 'tests/db.test.js',
    bad: { 'tests/db.test.js': `const url = '${PG}admin:Hq7mZp2x9Kd4@latest-db.acme.io/shop';\ntest('connects', () => connect(url));\n` },
    good: { 'tests/db.test.js': `const url = '${PG}user:password@localhost/shop';\ntest('connects', () => connect(url));\n` },
  },
  {
    id: 'inj-padded-long-line', bucket: 'R', phase: 'H2', faults: 1, examples: ['code-review-2-R2'],
    title: 'A command injection followed by a very long comment on the same line',
    at: 'src/run.js',
    bad: { 'src/run.js': `const { exec } = require('child_process');\nmodule.exports = (req) => exec(req.query.cmd); // ${'x'.repeat(2200)}\n` },
    good: { 'src/run.js': `const { execFile } = require('child_process');\nmodule.exports = () => execFile('ls', ['-l']); // ${'x'.repeat(2200)}\n` },
  },
];
