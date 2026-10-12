// node server.js --status | --stop  (for index.html's command tools and scripts). Nothing here starts an office.
// A running office writes <data>/run.json (pid, port, key); --stop uses the key to ask it to Quit, so it stops its
// local copies as well. With --port=N, the run.json of whichever office (real, test copy or demo) is on that port is
// used, so `--stop --port=8883` stops a test copy without also passing --dry-run.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const cfg = require('./config');

function findRun() {
  const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const own = read(cfg.RUN_FILE);
  const portAsked = process.argv.some(a => /^--port=\d+$/.test(a));
  if (!portAsked || (own && own.port === cfg.PORT)) return own;
  for (const mode of ['real', 'dry', 'demo']) {
    const r = read(path.join(cfg.dataDirFor(mode), 'run.json'));
    if (r && r.port === cfg.PORT) return r;
  }
  return null;
}

function runCli() {
  const stop = process.argv.includes('--stop');
  const run = findRun();
  const port = run ? run.port : cfg.PORT;
  // --status asks for the office's stats with the key from run.json: only THIS office answers 200. Any other program
  // that answers on the port is named as such, not taken for the office.
  const req = http.request({ host: '127.0.0.1', port, path: stop ? '/api/quit' : '/api/stats', method: stop ? 'POST' : 'GET',
    headers: { Host: '127.0.0.1:' + port, 'X-AHO-Key': run ? run.key : '', 'Content-Type': 'application/json' }, timeout: 3000 }, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', c => { if (body.length < 100000) body += c; });
    res.on('end', () => {
      const json = (() => { try { return JSON.parse(body); } catch { return null; } })();
      if (!stop) {
        // 200 alone is not enough: the answer must be the office's own stats (with its version).
        if (res.statusCode === 200 && json && typeof json.version === 'string') { console.log('The office is running: http://127.0.0.1:' + port + '/'); process.exit(0); }
        if (res.statusCode === 403 && json && /older office run/.test(json.error || '')) { console.log('An office is running on port ' + port + ', but not the one this folder started (its key differs). Open http://127.0.0.1:' + port + '/ to see it.'); process.exit(0); }
        console.log('The office is not running: port ' + port + ' is used by another program.');
        process.exit(1);
      }
      if (res.statusCode === 200) { console.log('The office is stopping (and every local copy it started).'); process.exit(0); }
      console.log('The office is running but did not accept the stop (it may have been started from another folder). Use Settings › About › Quit in its window.');
      process.exit(1);
    });
  });
  req.on('error', () => { console.log('The office is not running.' + (stop ? ' Nothing to stop.' : ' Start it with start.cmd.')); process.exit(stop ? 0 : 1); });
  req.on('timeout', () => req.destroy());
  req.end(stop ? '{}' : undefined);
}

const wanted = () => process.argv.includes('--status') || process.argv.includes('--stop');

module.exports = { runCli, wanted };
