// What the office holds while it runs: its settings, the project list, the local copies it started, token counts.
// One copy for the whole server (a Node module is loaded once), so every route sees the same state.
'use strict';
const cfg = require('./config');
const Settings = require('./settings');
const { listProjects, listProjectsAsync, projectFolders } = require('./projects');

const state = {
  settings: Settings.load(cfg.SETTINGS_FILE, cfg.DEFAULT_ROOT),
  projects: [],
  running: new Map(), // id -> { child, pid, port, name, started, log, url }
  tokens: { per: {}, month: {}, at: null, busy: false, error: null },
};

function saveSettings() { Settings.save(cfg.SETTINGS_FILE, state.settings); }
function refreshProjects(fresh) { state.projects = listProjects(state.settings, { appDir: cfg.HERE, fresh }); return state.projects; }
async function refreshProjectsAsync(fresh) { state.projects = await listProjectsAsync(state.settings, { appDir: cfg.HERE, fresh }); return state.projects; }
// The folders the list will hold, without reading them (cheap): lets slow reads start before the list is built.
function projectDirs() { return projectFolders(state.settings, { appDir: cfg.HERE }).map(f => f.dir); }
function findProject(id) { return state.projects.find(p => p.id === id) || refreshProjects().find(p => p.id === id); }
const projectName = id => { const p = state.projects.find(x => x.id === id); return p ? p.name : id; };

// The project the office itself is running on a port, if any: { id, name, port }.
function ownPortUser(port) {
  for (const [id, r] of state.running) if (r.port === port) return { id, name: projectName(id), port };
  return null;
}
// Every port a project's start commands use, merged alternates included (the same app on the next port).
const commandPorts = p => p.commands.flatMap(c => (c.alts || [c]).map(a => ({ ...c, ...a }))).filter(c => c.port);

// The counts come from the office's own read of the transcripts (lib/office.js): one pass gives the staff and the
// tokens per project, and each later read takes in only what the transcripts gained. A changed project list makes
// that read count every transcript again (tokens only).
// A demo's projects have no transcripts: steady made-up numbers from each project's id (80M to 2.5B, 5-25% this month).
function demoTokens() {
  const per = {}, month = {};
  for (const p of state.projects) {
    let h = 0; for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    per[p.id] = 80e6 + (h % 2400) * 1e6 + (h % 997) * 1e3;
    month[p.id] = Math.round(per[p.id] * (0.05 + (h % 21) / 100));
  }
  state.tokens = { per, month, at: new Date().toISOString(), busy: false, error: null };
}
// A count asked for while one is under way (a folder added during the start-up count, Recount pressed twice) runs
// again when that one answers, over the list as it is then, so no project is left showing 0 as a finished count.
let countAgain = false;
function refreshTokens() {
  if (cfg.DEMO) return demoTokens();
  const office = require('./office');
  office.setTokenProjects(state.projects);
  if (state.tokens.busy) { countAgain = true; return; }
  state.tokens.busy = true;
  const again = () => { if (countAgain) { countAgain = false; refreshTokens(); } };
  office.tokenTotals().then(m => { state.tokens = { per: m.total, month: m.month, at: new Date().toISOString(), busy: false, error: null }; again(); },
    e => { state.tokens = { ...state.tokens, busy: false, error: String((e && e.message) || e) }; again(); });
}

module.exports = { state, saveSettings, refreshProjects, refreshProjectsAsync, projectDirs, findProject, projectName, ownPortUser, commandPorts, refreshTokens, demoTokens };
