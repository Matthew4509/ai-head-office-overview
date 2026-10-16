// Answering the page: JSON replies with the office's safety headers, request bodies, images, and the page's own files.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('./config');

// Scripts only from the office itself, never inline: the page's script lives in public/js/. Inline styles stay
// allowed (style attributes); they cannot run code.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP };

// Demo: real paths are shown as C:\Users\demo\... in every JSON answer.
const DEMO_MASKS = cfg.DEMO ? [[cfg.DEFAULT_ROOT, 'C:\\Users\\demo\\Projects'], [cfg.HERE, 'C:\\Users\\demo\\ai-head-office'], [os.homedir(), 'C:\\Users\\demo']]
  .flatMap(([real, shown]) => [[JSON.stringify(real).slice(1, -1), JSON.stringify(shown).slice(1, -1)], [real.replace(/\\/g, '/'), shown.replace(/\\/g, '/')]])
  .sort((a, b) => b[0].length - a[0].length) : [];
function demoMask(text) {
  for (const [real, shown] of DEMO_MASKS) text = text.split(real).join(shown).split(real.toLowerCase()).join(shown);
  return text;
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, ...HEADERS });
  const text = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.end(cfg.DEMO && typeof body === 'object' && !Buffer.isBuffer(body) ? demoMask(text) : text);
}

function readBody(req, limit = 10000) {
  return new Promise((resolve, reject) => {
    // Chunks are kept as bytes and decoded once at the end: a character split between two chunks must come through whole.
    const chunks = [];
    let size = 0;
    // Too big: the rest is read and dropped, then a 413 with a reason (dropping the connection showed as Connection lost).
    let over = false;
    req.on('data', c => { if (over) return; const b = Buffer.isBuffer(c) ? c : Buffer.from(String(c), 'utf8'); chunks.push(b); size += b.length; if (size > limit * 4) { over = true; chunks.length = 0; } });
    req.on('end', () => {
      const b = over ? '' : Buffer.concat(chunks).toString('utf8');
      if (over || b.length > limit) return reject(Object.assign(new Error('That is more than the office takes in one go (' + limit.toLocaleString('en') + ' characters). Make it shorter and try again.'), { status: 413 }));
      // Only an object is a request: null, a number or a list is read as an empty one, so each route refuses it plainly.
      try { const v = b ? JSON.parse(b) : {}; resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {}); } catch { reject(Object.assign(new Error('The request was not readable (not JSON). Reload the page and try again.'), { status: 400 })); }
    });
  });
}

// The page and its files, read once at start (a running office keeps serving the page it started with).
// Only .css, .js and .svg files inside office/public are served, by exact name; nothing else on disk can be asked for.
const OFFICE_PUBLIC = path.join(cfg.HERE, 'office', 'public');
const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const withKey = file => fs.readFileSync(file, 'utf8').replace('__AHO_KEY__', cfg.KEY);
const PAGE = withKey(path.join(OFFICE_PUBLIC, 'index.html'));
const ICON = fs.readFileSync(path.join(OFFICE_PUBLIC, 'app.ico'));
const FILES = new Map();
function collect(dir, at) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) collect(path.join(dir, e.name), at + e.name + '/');
    else if (TYPES[path.extname(e.name)]) FILES.set(at + e.name, { type: TYPES[path.extname(e.name)], body: fs.readFileSync(path.join(dir, e.name)) });
  }
}
collect(OFFICE_PUBLIC, '/');

// true when it answered (a page, a page file, or the icon).
function servePublic(req, res, pathname) {
  if (req.method !== 'GET') return false;
  // The page comes in its theme, so it never shows light for a moment before turning dark. Required here, not at the
  // top: the office module itself answers with send() from this file.
  if (pathname === '/') { send(res, 200, PAGE.replace('<html lang="en">', `<html lang="en" data-theme="${require('./office').theme()}">`), 'text/html; charset=utf-8'); return true; }
  // The icon doubles as the "is the office running?" check for the launcher page (index.html opened as a file:
  // it can load an image from 127.0.0.1, but not read an API answer). It holds nothing private.
  if (pathname === '/app.ico') {
    res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    res.end(ICON);
    return true;
  }
  const f = FILES.get(pathname);
  if (!f) return false;
  send(res, 200, f.body, f.type);
  return true;
}

module.exports = { send, readBody, servePublic };
