// The office itself: This PC numbers, first-start setup, Run setup again and Uninstall, the Git program check, shortcuts, Stop all, stopping a port another program
// holds, the folder picker, Scan folders, token recount, live check of every site, and Quit.
'use strict';
const { state, saveSettings, refreshTokens, commandPorts } = require('../state');
const { laptopStats, scanFolders } = require('../views');
const { checkAllLive, setLiveEvery } = require('../live-state');
const { foreignPorts, stopForeign, stopAllProjects } = require('../runner');
const { portBusy } = require('../ports');
const desktop = require('../desktop');
const { shutdown } = require('../lifecycle');
const cfg = require('../config');
const setup = require('../setup');
const gitProgram = require('../git-program');
const disclosure = require('../disclosure');
const update = require('../update');

// Audits › Private details: the page sees labels and lengths, never the values (they live in data/ only).
const privateDetails = () => ({ details: disclosure.listForPage(cfg.PRIVATE_FILE),
  auto: [...new Set(disclosure.autoDetails(state.settings.workingFolders || []).map(d => d.label))] });

const gitOnline = () => !!state.settings.gitOnlineCheck;

// Settings › Update. A demo or test copy runs from the same folder as the real office, so only the real one updates it.
const notHere = () => (cfg.DEMO || cfg.DRY ? { ok: false, fault: `The ${cfg.DEMO ? 'demo' : 'test copy'} does not update.`, reason: 'It runs from the same folder as your real office.', wayOut: 'Open the real office and use Settings › Update there.' } : null);
let updating = null;
const once = job => { if (!updating) updating = job().finally(() => { updating = null; }); return updating; };

const get = {
  '/api/stats': () => laptopStats(),
  '/api/setup': () => setup.status(),
  '/api/private-details': privateDetails,
  // The Git program's version. Asks GitHub for the newest one only when the person has ticked that on.
  '/api/git-program': ({ url }) => gitProgram.status({ online: gitOnline(), fresh: url.searchParams.get('fresh') === '1' }),
};

const post = {
  '/api/refresh-tokens': () => { refreshTokens(); return { ok: true }; },
  '/api/pick-folder': ({ body }) => desktop.pickFolder(body.purpose),
  '/api/scan': async () => ({ ok: true, ...(await scanFolders()) }),
  '/api/port-owners': async () => ({ ok: true, owners: await foreignPorts() }),
  '/api/live/check-all': () => {
    if (!state.projects.some(p => p.liveUrl)) return { ok: false, error: 'No project has a live address yet: use a project\'s … menu › Hosted live.' };
    checkAllLive().catch(e => console.error('Live checks stopped: ' + ((e && e.message) || e)));
    return { ok: true, busy: true };
  },
  '/api/live/every': ({ body }) => setLiveEvery(body.minutes),
  // First start: one click sets up Start with Windows and the desktop shortcut (both offered ticked), so from then on
  // the office is simply running and index.html / the shortcut open it. Asked once, either answer.
  '/api/welcome': async ({ body }) => {
    // Both at once: each is a PowerShell run of several seconds on a busy PC.
    const results = await Promise.all([body.startup && desktop.shortcut('startup', 'create'), body.desktop && desktop.shortcut('desktop', 'create')].filter(Boolean));
    state.settings.welcomed = true;
    saveSettings();
    const bad = results.filter(r => r.error);
    return { ok: !bad.length, results, error: bad.length ? 'Not everything could be set up: ' + bad.map(r => r.error).join('; ') + '. Try again under Settings › Setup.' : undefined };
  },
  // Run setup again (About): each of the three as ticked. Node.js is already fine, or this would not be running.
  '/api/setup': async ({ body }) => {
    const want = {};
    for (const k of ['link', 'desktop', 'startup']) if (typeof body[k] === 'boolean') want[k] = body[k];
    const r = await setup.apply(want);
    return { ok: !r.errors.length, results: r.results, error: r.errors.length ? 'Not everything could be changed: ' + r.errors.join('; ') + '.' : undefined, status: await setup.status() };
  },
  // Uninstall (About): links and shortcuts away, then the office stops. The folder and its data stay; the reply
  // says where they are so the person can delete them.
  '/api/uninstall': async () => {
    const r = await setup.uninstall();
    if (!r.errors.length) setTimeout(shutdown, 300); // the reply below is already built, so it goes out first
    return { ok: !r.errors.length, results: r.results, folder: cfg.HERE, error: r.errors.length ? 'Not everything could be removed: ' + r.errors.join('; ') + '. The office is still running; try again, or use uninstall.cmd.' : undefined };
  },
  // [{ id?, label, value? }]: a row with an id and no value keeps the saved value.
  '/api/private-details': ({ body }) => {
    if (!Array.isArray(body.details) || body.details.length > 50) return { ok: false, error: 'Send a list of up to 50 details.' };
    const r = disclosure.savePrivateList(cfg.PRIVATE_FILE, body.details);
    return r.ok ? { ok: true, ...privateDetails() } : r;
  },
  '/api/git-online': async ({ body }) => {
    state.settings.gitOnlineCheck = body.on === true;
    saveSettings();
    return { ok: true, git: await gitProgram.status({ online: gitOnline(), fresh: gitOnline() }) };
  },
  '/api/shortcuts': async () => ({ ok: true, desktop: await desktop.shortcut('desktop', 'status'), startup: await desktop.shortcut('startup', 'status') }),
  // "Show me": the file manager opens the folder with the shortcut selected, for when it is lost among desktop icons.
  '/api/shortcut-show': async ({ body }) => {
    const r = await desktop.shortcut(body.where, 'status');
    if (!r.exists) return { ok: false, error: 'There is no shortcut to show: use Add shortcut.' };
    const done = desktop.revealFile(r.path);
    return done.dryRun ? { ok: true, dryRun: done.dryRun } : { ok: true, path: r.path };
  },
  '/api/shortcut': async ({ body }) => {
    const r = await desktop.shortcut(body.where, body.on ? 'create' : 'remove');
    return r.error ? { ok: false, error: 'The shortcut could not be ' + (body.on ? 'made' : 'removed') + ': ' + r.error + '.' } : { ok: true, ...r };
  },
  // Stops only the program the page named: the page asks /api/port-owners first, shows the program in a question,
  // and sends its pid. Without a pid, or with another program on the port now, nothing is stopped.
  '/api/stop-port': async ({ body }) => {
    const port = Number(body.port);
    const o = (await foreignPorts()).find(x => x.port === port);
    // Already closed (it stopped by itself, or another click got there first): what was wanted, so not a fault.
    if (!o && state.projects.some(p => commandPorts(p).some(c => c.port === port)) && !(await portBusy(port))) return { ok: true, free: true, port };
    if (!o) return { ok: false, error: 'Port ' + body.port + ' is not held by another program any more (or is not a project port).' };
    if (!Number.isInteger(Number(body.pid)) || !Number(body.pid)) return { ok: false, error: 'Nothing was stopped: the office needs to know which program to stop. Press Free port again to see what holds port ' + o.port + ' first.' };
    if (Number(body.pid) !== o.pid) return { ok: false, error: 'A different program holds port ' + o.port + ' now (' + o.name + '). Look again before stopping it.' };
    return stopForeign(o);
  },
  // Stop all: everything the office started; with others=true, also the other programs holding project ports (only
  // the ones the page listed, by port and program id, so nothing new is stopped unseen).
  '/api/stop-all': async ({ body }) => {
    const stopped = stopAllProjects();
    const others = [];
    if (body.others && Array.isArray(body.listed)) {
      const listed = new Set(body.listed.map(x => x.port + ':' + x.pid));
      for (const o of await foreignPorts()) if (listed.has(o.port + ':' + o.pid)) others.push(await stopForeign(o));
    }
    return { ok: true, stopped, others };
  },
  '/api/quit': () => { setTimeout(shutdown, 200); return { ok: true }; },
  // Asks GitHub (only now) what is newer; then takes it (a fast-forward only), and restarts to use it.
  '/api/update/check': () => notHere() || once(() => update.check(cfg.HERE)),
  '/api/update/pull': () => notHere() || once(() => update.pull(cfg.HERE)),
  '/api/update/restart': () => {
    if (notHere()) return notHere();
    update.restartAfterExit();
    setTimeout(shutdown, 200);
    return { ok: true };
  },
};

module.exports = { get, post };
