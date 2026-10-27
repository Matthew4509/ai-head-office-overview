// Stopping the office: every local copy it started goes with it, and run.json is removed (only if it is this run's).
'use strict';
const fs = require('fs');
const cfg = require('./config');
const Sensors = require('./sensors');
const { stopAllProjects } = require('./runner');

function shutdown() {
  stopAllProjects();
  Sensors.stopGpu();
  // A backup under way (the window was closed, or Windows is shutting down: Quit itself waits instead) is cancelled and
  // its half-written zip removed, so nothing on the drive looks like a backup that is not one.
  try { require('./state').state.backups.stopNow(); } catch {}
  try { if (JSON.parse(fs.readFileSync(cfg.RUN_FILE, 'utf8')).pid === process.pid) fs.unlinkSync(cfg.RUN_FILE); } catch {}
  process.exit(0);
}

module.exports = { shutdown };
