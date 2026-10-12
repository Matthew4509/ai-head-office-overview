// Starting the office: listen on 127.0.0.1 only, read the project list, start the counters and live checks.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const cfg = require('./config');
const Sensors = require('./sensors');
const { state, refreshProjectsAsync, refreshTokens } = require('./state');
const { scanFolders } = require('./views');
const { scheduleLive } = require('./live-state');
const { openAppWindow } = require('./desktop');
const { shutdown } = require('./lifecycle');
const { handle } = require('./routes');
const office = require('./office');

// A fault in one background job (a project file nobody expected, a live check, a token count) is written down and
// the office keeps running: it must never take every local copy and the window down with it.
function logFault(kind, e) {
  const line = new Date().toISOString() + ' ' + kind + ': ' + ((e && e.stack) || e) + '\n';
  console.error('The office hit an error and kept running (' + kind + '): ' + ((e && e.message) || e));
  try { fs.mkdirSync(path.join(cfg.DATA, 'logs'), { recursive: true }); fs.appendFileSync(path.join(cfg.DATA, 'logs', 'errors.log'), line); } catch {}
}

function start() {
  const server = http.createServer(handle);
  process.on('unhandledRejection', e => logFault('unhandled rejection', e));
  process.on('uncaughtException', e => logFault('uncaught exception', e));

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown); // the office window was closed

  // One office at a time: starting it again while it runs just opens its window.
  server.on('error', e => {
    if (e.code !== 'EADDRINUSE') { console.error(e); process.exit(1); }
    // A program that takes the connection and never answers would leave this window waiting for ever: 3 s.
    const probe = http.get({ host: '127.0.0.1', port: cfg.PORT, path: '/', headers: { Host: '127.0.0.1:' + cfg.PORT }, timeout: 3000 }, res => {
      let b = ''; res.on('data', c => { b += c; });
      res.on('end', () => {
        if (/name="aho-key"/.test(b)) {
          console.log('The office is already running; opening its window.');
          if (process.env.AHO_OPEN === '1') openAppWindow();
          setTimeout(() => process.exit(0), 500);
        } else {
          console.error('Port ' + cfg.PORT + ' is used by another program, so the office cannot start. Close that program, or start the office with AHO_PORT set to a free port.');
          process.exit(1);
        }
      });
    });
    probe.on('timeout', () => probe.destroy(new Error('no answer')));
    probe.on('error', () => { console.error('Port ' + cfg.PORT + ' is taken by a program that does not answer, so the office cannot start. Close that program (or wait a moment and try again), or start the office with AHO_PORT set to a free port.'); process.exit(1); });
  });

  server.listen(cfg.PORT, '127.0.0.1', async () => {
    try { fs.writeFileSync(cfg.RUN_FILE, JSON.stringify({ pid: process.pid, port: cfg.PORT, key: cfg.KEY, started: new Date().toISOString() })); } catch {}
    Sensors.gpuStats(); if (Sensors.CPU_TEMP) Sensors.tempStats(); // first readings ready by the time the window asks
    console.log('AI Head Office Overview ' + cfg.VERSION + ' on http://127.0.0.1:' + cfg.PORT + '/  - working folders: ' + state.settings.workingFolders.join('; ') + (cfg.DRY ? '  [dry run]' : ''));
    console.log('Keep this window open (you can minimise it). Closing it stops the office and every local copy it started.');
    if (process.env.AHO_OPEN === '1') openAppWindow();
    // The window opens straight away; the folders are read meanwhile, without holding up the server.
    try {
      await refreshProjectsAsync();
      if (!state.settings.lastScan) scanFolders(false); // first run: today's folders are the baseline, so nothing shows as "New"
    } catch (e) { logFault('reading the projects', e); }
    // The office's first read starts once the project list is known, so the same read also splits the tokens.
    try { office.setTokenProjects(state.projects); await office.start(); refreshTokens(); } catch (e) { logFault('opening the office', e); }
    // Live addresses: checked a few seconds after start, then every 5, 10 or 15 minutes (Live sites panel).
    scheduleLive(3000);
  });
  return server;
}

module.exports = { start };
