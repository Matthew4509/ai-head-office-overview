// One project's actions. The page sends the project's id (and a command number), never a path or command text;
// the dispatcher has already found the project (p) before any handler here runs.
'use strict';
const { keyOf } = require('../projects');
const { parseLiveUrl } = require('../live');
const { state, saveSettings, refreshProjects, findProject, ownPortUser } = require('../state');
const { localUrl } = require('../ports');
const { startProject, stopProject, siteUrlOf } = require('../runner');
const { lastAudit, auditProject, judge, unjudge, importReportBack, reviewPrompt, faultsOf, setFault } = require('../audit-store');
const { checkLive, forget } = require('../live-state');
const desktop = require('../desktop');
const { changes } = require('../gitstate');

// GET ?id=<project id>
const get = {
  '/api/audit': ({ p }) => ({ audit: lastAudit(p.id) }),
  // Review with AI: the prompt to copy (nothing is sent anywhere), and the faults a reviewer reported.
  '/api/review': ({ p }) => reviewPrompt(p),
  '/api/faults': ({ p }) => faultsOf(p),
  // See what changed: the project's changes since its last commit, read only.
  '/api/git/changes': ({ p }) => changes(p.dir),
};

// POST { id, ... }
const post = {
  '/api/start': async ({ p, body }) => {
    const r = await startProject(p, body.key, body.open !== false, body.move === true);
    if (r.ok && body.scan) r.audit = await auditProject(p, r.url);
    return r;
  },
  // Hide from display: stays on the list, shown only when "Show hidden" is on. Unhide puts it back.
  '/api/projects/hide': ({ p, body }) => {
    const { settings } = state;
    settings.hiddenView = settings.hiddenView.filter(x => keyOf(x) !== keyOf(p.dir));
    if (body.hidden !== false) settings.hiddenView.push(p.dir);
    saveSettings();
    return { ok: true, hidden: body.hidden !== false, name: p.name };
  },
  // Remove = off the office's list only. The folder and its files are not touched. A running copy is stopped.
  '/api/projects/remove': ({ p }) => {
    const { settings } = state;
    stopProject(p.id);
    if (p.added) settings.extraProjects = settings.extraProjects.filter(x => keyOf(x) !== keyOf(p.dir));
    else if (!settings.hidden.some(x => keyOf(x) === keyOf(p.dir))) settings.hidden.push(p.dir);
    settings.known = refreshProjects().map(x => x.dir);
    saveSettings();
    return { ok: true, name: p.name, dir: p.dir, wasAdded: p.added };
  },
  '/api/stop': ({ p }) => (stopProject(p.id) ? { ok: true } : { ok: true, note: 'Not running from the office.' }),
  '/api/open-browser': ({ p, body }) => {
    const r = state.running.get(p.id);
    const cmd = p.commands.find(c => c.key === String(body.key)) || p.commands[0];
    const target = r ? r.url : (cmd && cmd.port ? localUrl(cmd) : null);
    if (!target) return { ok: false, error: 'No address known for ' + p.name + ': it has no start command with a port.' };
    const other = !r && ownPortUser(cmd.port);
    if (other && other.id !== p.id) return { ok: false, error: 'Port ' + cmd.port + ' is ' + other.name + '\'s site right now (the office is running it there), not ' + p.name + '. Stop ' + other.name + ' first, then run ' + p.name + '.' };
    return { ok: true, url: target, ...desktop.openBrowser(target) };
  },
  '/api/audit': async ({ p }) => ({ ok: true, audit: await auditProject(p, await siteUrlOf(p)) }),
  // Judging: one finding of the last audit is not a fault (with a reason and who says so), or it comes back.
  '/api/audit/judge': ({ p, body }) => judge(p, body),
  '/api/audit/unjudge': ({ p, body }) => unjudge(p, body.entry),
  '/api/audit/import': ({ p, body }) => importReportBack(p, body),
  '/api/faults/set': ({ p, body }) => setFault(p, body),
  // Hosted live: set (or clear, with an empty address) where the project is hosted, then check it straight away.
  '/api/live/set': async ({ p, body }) => {
    const v = parseLiveUrl(body.url, { allowLocal: process.env.AHO_TEST_LOCAL_LIVE === '1' });
    if (v.error) return { ok: false, error: v.error };
    state.settings.liveUrls[keyOf(p.dir)] = v.url;
    saveSettings();
    refreshProjects();
    forget(p.dir);
    if (!v.url) return { ok: true, url: '', name: p.name };
    return { ok: true, url: v.url, name: p.name, live: await checkLive(findProject(p.id)) };
  },
  '/api/live/check': async ({ p }) => {
    if (!p.liveUrl) return { ok: false, error: p.name + ' has no live address. Add one with Hosted live.' };
    return { ok: true, live: await checkLive(p) };
  },
  '/api/open-terminal': ({ p }) => ({ ok: true, ...desktop.openTerminal(p.dir) }),
  '/api/open-folder': ({ p }) => ({ ok: true, ...desktop.openFolder(p.dir) }),
};

module.exports = { get, post };
