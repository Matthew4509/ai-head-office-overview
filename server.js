// AI Head Office Overview: your local projects, their local copies and a simple audit, on this computer only.
// Copyright (c) 2026 Matthew4509. PolyForm Noncommercial License 1.0.0 (see LICENSE); no warranty.
// One row per project folder: token usage, last updated, run localhost, simple audit, Copy prompt.
// Safety: listens on 127.0.0.1 only; runs ONLY commands stored in the project's own files (launch.json /
// project.json); the page sends a project id and a command number, never command text. Requests must carry the
// per-launch key the page was served with (a custom header other sites cannot send) and a local Host header.
// No npm packages: Node 22+ only.
//
// Where things are:
//   lib/config.js        version, port, mode, data folder        lib/routes/      every API route, by area
//   lib/state.js         settings, project list, running copies   lib/views.js     what the page is sent
//   lib/runner.js        start/stop local copies, port owners     lib/desktop.js   windows/browsers (dry run aware)
//   lib/platform/        every operating-system call              public/          the page, app.css, js/
'use strict';
// The office works from its own folder, however it was started: Windows looks for a program named without its path
// (git) in the working folder first, and a folder the office does not own must not get to choose it.
process.chdir(__dirname);
const cli = require('./lib/cli');
if (cli.wanted()) cli.runCli();
else {
  require('./lib/config').ensureDataDirs();
  require('./lib/app').start();
}
