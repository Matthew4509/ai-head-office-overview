// Run by the ai-head-office://start link (index.html's Start office button), as
//   "<node.exe>" "<folder>\lib\platform\windows\link-start.js" "%1"
// The link's address arrives as an argument and is never read. This starts start.cmd with the fixed word "quiet":
// the office starts without opening its window, and starting it again while it runs does nothing.
'use strict';
const path = require('path');
const { spawn } = require('child_process');

const folder = path.resolve(__dirname, '..', '..', '..');
const cmd = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
// The full path: cmd.exe does not always look in the current folder (NoDefaultCurrentDirectoryInExePath).
spawn(cmd, ['/d', '/c', path.join(folder, 'start.cmd'), 'quiet'], { cwd: folder, detached: true, stdio: 'ignore', windowsHide: true }).unref();
