// The demo's "live" websites: made-up .example addresses answered on this PC, so Hosted live and the live-vs-local
// compare have something to show without sending a request off the PC.
//   node demo/live-sites.js <live-sites.json> <demo office port>
// live-sites.json: { sites: [{ host, port, dir, mode }], httpPort }. mode "firewall" answers 403 with a firewall page.
// httpPort answers every plain http:// request with a move to https://, as a real host would.
// Stops by itself once the demo office has stopped answering.
'use strict';
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const officePort = Number(process.argv[3]);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
};

for (const s of cfg.sites) {
  const root = path.join(s.dir, 'public');
  http.createServer((req, res) => {
    if (s.mode === 'firewall') {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!DOCTYPE html><html><head><title>Access Denied</title></head><body><h1>Access Denied</h1><p>Your request was blocked by the security rules of this server.</p></body></html>');
    }
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, path.normalize(rel));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403, HEADERS); return res.end('Forbidden'); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { ...HEADERS, 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  }).listen(s.port, '127.0.0.1');
}
http.createServer((req, res) => {
  res.writeHead(301, { Location: 'https://' + (req.headers.host || 'example.invalid') + req.url });
  res.end();
}).listen(cfg.httpPort, '127.0.0.1');

// Stop once this demo run is over: the demo office stopped answering (two misses, 5 s apart), or a new demo run
// started (its run.json holds a different key).
const runFile = path.join(path.dirname(process.argv[2]), 'run.json');
const runKey = () => { try { return JSON.parse(fs.readFileSync(runFile, 'utf8')).key; } catch { return null; } };
const myRun = process.argv[4] || runKey();
let misses = 0;
setInterval(() => {
  if (myRun && runKey() && runKey() !== myRun) process.exit(0);
  const s = net.connect(officePort, '127.0.0.1');
  s.setTimeout(1000, () => { s.destroy(); if (++misses >= 2) process.exit(0); });
  s.on('connect', () => { misses = 0; s.destroy(); });
  s.on('error', () => { if (++misses >= 2) process.exit(0); });
}, 5000);
console.log('Demo live sites: ' + cfg.sites.map(s => s.host + ' on :' + s.port).join(', '));
