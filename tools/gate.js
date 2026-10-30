// The publish guard (lib/gate.js) as git's pre-push hook runs it: node tools/gate.js <project folder>
// Checks the project with the office's audit and exits 1 (git stops the push) while it says "fix first", else 0.
// A check that cannot run stops the push too, and says why: the guard never lets a push through unchecked silently.
// Also usable by hand: node tools/gate.js "C:\path\to\project"  (prints the same report).
'use strict';
// Git runs hooks with its own GIT_DIR and the like set; the audit's own git calls must find the project's repository
// the usual way, as when the office runs them.
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_QUARANTINE_PATH']) delete process.env[k];
const path = require('path');
const dir = path.resolve(process.argv.slice(2).find(a => !a.startsWith('--')) || process.cwd());

(async () => {
  let gate;
  try {
    gate = require('../lib/gate');
    process.stderr.write('Publish guard: checking ' + path.basename(dir) + ' with the AI Head Office Overview audit before the push…\n');
    const { p, a, ready } = await gate.gateAudit(dir);
    process.stderr.write(gate.report(p, a) + '\n');
    process.exit(ready ? 0 : 1);
  } catch (e) {
    process.stderr.write('Publish guard: the check could not run (' + ((e && e.message) || e) + '), so the push was stopped.\n'
      + 'Run it again, or turn the guard off in the office (the project\'s More › Publish guard…) if the office is no longer used.\n');
    process.exit(1);
  }
})();
