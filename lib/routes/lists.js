// The project list, the Folders page (working folders, projects added one by one, removed projects, My order) and the
// project planner's routes (scores, check-in answers, hours a day, categories and their care plans).
// Paths only: nothing typed here is ever run.
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const Settings = require('../settings');
const { keyOf } = require('../projects');
const { state, saveSettings, refreshProjects } = require('../state');
const { listView, settingsView, scanFolders, laptopStats } = require('../views');
const desktop = require('../desktop');
const Priorities = require('../priorities');

const has = (list, p) => list.some(x => keyOf(x) === keyOf(p));
const drop = (list, p) => list.filter(x => keyOf(x) !== keyOf(p));

const get = {
  '/api/projects': async ({ url }) => ({ projects: await listView(url.searchParams.get('fresh') === '1'), stats: laptopStats() }),
  '/api/settings': () => { refreshProjects(); return settingsView(); },
  // The project planner (lib/priorities.js): today's plan from the projects on the list, and each project's score,
  // stage and categories. A fresh office that has never saved anything in the planner writes nothing here.
  '/api/priorities': () => plannerView(Priorities.load(cfg.DATA)),
};

// ---- the project planner ----
const PLANNER_FILE = path.join(cfg.DATA, 'priorities.json');
const today = () => Priorities.dateOf(Date.now());
const gone = { ok: false, error: 'That project is not on the list any more. Reload the page.' };

/** The planner as the page draws it. Today's picks are kept the first time they are made each day (and a pick that
 * went is filled again), once the planner is in use: `keep` writes them, by default only when its file exists. */
function plannerView(st, keep = fs.existsSync(PLANNER_FILE)) {
  const day = today();
  const projects = state.projects.map(p => ({ id: p.id, key: keyOf(p.dir), name: p.name, updated: p.updated }));
  let changed = false;
  for (const p of projects) {
    const e = st.entries[p.key];
    const c = e && Priorities.clearWorkedFlag(e, p.updated);
    if (c && c !== e) { st.entries[p.key] = c; changed = true; }
  }
  const plan = Priorities.planDay({ projects, entries: st.entries, cats: st.categories, settings: st.settings, today: day, day: st.day });
  const picks = plan.picks;
  if (!st.day || st.day.date !== day) { st.day = { ...picks, made: Date.now(), answers: {} }; changed = true; }
  else if (picks.focus.join('|') !== st.day.focus.join('|') || picks.medium !== st.day.medium || picks.low !== st.day.low) { st.day = { ...st.day, ...picks }; changed = true; }
  if (changed && keep) Priorities.save(cfg.DATA, st);
  delete plan.picks;
  const rows = {};
  for (const p of projects) {
    const e = st.entries[p.key] || {};
    const s = Priorities.standing(e, st.categories, day, st.settings);
    const w = Priorities.waitingDays(e, p.updated, day);
    rows[p.id] = { key: p.key, score: Priorities.scoreOf(e.scores), scores: e.scores || {}, flag: e.flag === 'needs', deadline: e.deadline || null,
      stage: s.stage, day: s.day, of: s.of, care: s.care, careOwn: !!e.care, categories: e.categories || [], waiting: Number.isFinite(w) ? w : null,
      stageSince: e.stageSince || null, soldOn: e.soldOn || null, soldFrom: e.soldFrom || null, lastChecked: e.lastChecked || null };
  }
  const inCat = id => projects.filter(p => { const c = rows[p.id].categories; return id === Priorities.UNSORTED ? !c.length : c.includes(id); }).length;
  return { today: day, made: st.day.made, plan, settings: st.settings, rows, categories: st.categories.map(c => ({ ...c, count: inCat(c.id) })) };
}
const keyOfId = id => { const p = state.projects.find(x => x.id === id); return p ? keyOf(p.dir) : null; };
const nameOfKey = k => { const p = state.projects.find(x => keyOf(x.dir) === k); return p ? p.name : path.basename(k); };
/** A care plan sent from the Category window: every part must be there and in range (nothing is quietly dropped). */
function careFrom(c) {
  const clean = Priorities.cleanCare(c);
  if (!clean || Object.keys(clean).length !== 5) return null;
  return clean;
}

const planner = {
  // The score window: marks, deadline, Needs work, categories, stage (see Priorities.setEntry).
  '/api/priorities/set': ({ body }) => {
    const key = keyOfId(body.id);
    if (!key) return gone;
    const st = Priorities.load(cfg.DATA);
    const r = Priorities.setEntry(st.entries[key] || {}, body, st.categories, today());
    if (!r.ok) return r;
    st.entries[key] = r.entry;
    Priorities.save(cfg.DATA, st);
    return { ok: true, ...plannerView(st, true) };
  },
  // A check-in answered: Fine for now, Needs work or Park it. The answer is kept with today's picks, so the day stays.
  '/api/priorities/answer': ({ body }) => {
    const key = keyOfId(body.id);
    if (!key) return gone;
    if (!['fine', 'needs', 'park'].includes(body.what)) return { ok: false, error: 'Answer Fine for now, Needs work or Park it.' };
    const st = Priorities.load(cfg.DATA);
    plannerView(st, false); // today's picks, made now if this is the day's first look
    st.entries[key] = Priorities.answer(st.entries[key] || {}, body.what, today());
    st.day.answers = { ...st.day.answers, [key]: body.what };
    Priorities.save(cfg.DATA, st);
    return { ok: true, ...plannerView(st, true) };
  },
  // Plan again: today's last-hour pair is picked afresh by the longest wait (today's answers start again too).
  '/api/priorities/replan': () => {
    const st = Priorities.load(cfg.DATA);
    st.day = null;
    return { ok: true, ...plannerView(st, true) };
  },
  '/api/priorities/settings': ({ body }) => {
    const st = Priorities.load(cfg.DATA);
    const h = Number(body.hoursPerDay);
    if (body.hoursPerDay !== undefined) {
      if (!Number.isFinite(h) || h < 1 || h > 16 || Math.round(h * 4) !== h * 4) return { ok: false, error: `Hours a day must be from 1 to 16 (quarter hours are fine), not ${body.hoursPerDay}. Change it and save again.` };
      st.settings.hoursPerDay = h;
    }
    if (body.handoverDays !== undefined) {
      if (!['calendar', 'working'].includes(body.handoverDays)) return { ok: false, error: 'Pick calendar days or working days for a handover.' };
      st.settings.handoverDays = body.handoverDays;
    }
    for (const k of ['ownHandover', 'paidLiftsScore']) if (typeof body[k] === 'boolean') st.settings[k] = body[k];
    Priorities.save(cfg.DATA, st);
    return { ok: true, ...plannerView(st, true) };
  },
  '/api/priorities/category/save': ({ body }) => {
    const st = Priorities.load(cfg.DATA);
    const r = Priorities.saveCategory(st, body);
    if (!r.ok) return r;
    Priorities.save(cfg.DATA, st);
    return { ok: true, category: r.category, ...plannerView(st, true) };
  },
  '/api/priorities/category/remove': ({ body }) => {
    const st = Priorities.load(cfg.DATA);
    const r = Priorities.removeCategory(st, String(body.id || ''));
    if (!r.ok) return r;
    Priorities.save(cfg.DATA, st);
    return { ok: true, projects: r.projects, ...plannerView(st, true) };
  },
  // A category's care plan. Without `mode`: what would change (the projects that follow it, and those with their own
  // plan), so the page can name them before anything changes. With mode 'all' or 'new': the change itself.
  '/api/priorities/category/care': ({ body }) => {
    const st = Priorities.load(cfg.DATA);
    if (body.id === Priorities.UNSORTED) return { ok: false, error: 'Not sorted keeps the usual care plan. Put projects in a category of their own to give them a different one.' };
    const cat = st.categories.find(c => c.id === body.id);
    if (!cat) return { ok: false, error: 'That category is not on the list any more. Reload the page.' };
    const care = careFrom(body.care);
    if (!care) return { ok: false, error: 'The care plan is not complete: handover days 0-365, minutes 0-480, and how often to check in. Fill them in and save again.' };
    if (!body.mode) {
      const { follows, own } = Priorities.careChange(st.entries, cat.id);
      return { ok: true, from: { ...Priorities.CARE, ...cat.care }, to: care, follows: follows.map(nameOfKey), own: own.map(nameOfKey) };
    }
    const r = Priorities.changeCare(st, cat.id, care, body.mode);
    if (!r.ok) return r;
    Priorities.save(cfg.DATA, st);
    return { ok: true, changed: r.changed, kept: r.kept, ...plannerView(st, true) };
  },
};

const post = {
  '/api/folders/add': async ({ body }) => {
    const bad = Settings.checkFolder(body.path, 'a working folder');
    if (bad) return { ok: false, error: bad };
    const dir = path.resolve(body.path.trim());
    if (has(state.settings.workingFolders, dir)) return { ok: false, error: dir + ' is already a working folder.' };
    state.settings.workingFolders.push(dir);
    saveSettings();
    const scan = await scanFolders();
    return { ok: true, path: dir, projects: state.projects.filter(p => p.workingFolder && keyOf(p.workingFolder) === keyOf(dir)).length, scan };
  },
  '/api/folders/open': ({ body }) => {
    const f = state.settings.workingFolders.find(x => keyOf(x) === keyOf(String(body.path || '')));
    if (!f) return { ok: false, error: 'That folder is not on the list any more. Reload the page.' };
    return { ok: true, ...desktop.openFolder(f) };
  },
  '/api/folders/remove': async ({ body }) => {
    if (!has(state.settings.workingFolders, String(body.path || ''))) return { ok: false, error: 'That folder is not on the list any more. Reload the page.' };
    state.settings.workingFolders = drop(state.settings.workingFolders, body.path);
    saveSettings();
    return { ok: true, scan: await scanFolders() };
  },
  '/api/projects/add': async ({ body }) => {
    const bad = Settings.checkFolder(body.path, 'a project');
    if (bad) return { ok: false, error: bad };
    const dir = path.resolve(body.path.trim());
    if (keyOf(dir) === keyOf(cfg.HERE)) return { ok: false, error: 'That is the office\'s own folder.' };
    const { settings } = state;
    const wasHidden = has(settings.hidden, dir);
    settings.hidden = drop(settings.hidden, dir);
    const projects = refreshProjects();
    if (!wasHidden && projects.some(p => keyOf(p.dir) === keyOf(dir))) return { ok: false, error: path.basename(dir) + ' is already on the list.' };
    if (!projects.some(p => keyOf(p.dir) === keyOf(dir))) settings.extraProjects.push(dir);
    saveSettings();
    await scanFolders();
    const p = state.projects.find(x => keyOf(x.dir) === keyOf(dir));
    return { ok: true, id: p && p.id, name: p ? p.name : path.basename(dir) };
  },
  // My order: the page sends the project ids in the order the person wants; stored as folder paths.
  '/api/projects/order': ({ body }) => {
    if (!Array.isArray(body.ids)) return { ok: false, error: 'No order was sent.' };
    const byId = new Map(refreshProjects().map(p => [p.id, p.dir]));
    const dirs = body.ids.map(id => byId.get(id)).filter(Boolean);
    // projects not in the list sent (e.g. added a moment ago) keep their place after the ones sent
    const sent = new Set(dirs.map(keyOf));
    state.settings.order = [...dirs, ...state.settings.order.filter(d => !sent.has(keyOf(d)))];
    saveSettings();
    return { ok: true };
  },
  // An added project whose folder is gone (it is not on the list, so it has no id): taken off by its path.
  '/api/projects/forget': ({ body }) => {
    if (!has(state.settings.extraProjects, String(body.path || ''))) return { ok: false, error: 'That project is not on the list any more. Reload the page.' };
    state.settings.extraProjects = drop(state.settings.extraProjects, body.path);
    saveSettings();
    return { ok: true };
  },
  '/api/projects/show': async ({ body }) => {
    if (!has(state.settings.hidden, String(body.path || ''))) return { ok: false, error: 'That project is not in the removed list any more. Reload the page.' };
    state.settings.hidden = drop(state.settings.hidden, body.path);
    saveSettings();
    await scanFolders();
    return { ok: true };
  },
  ...planner,
};

module.exports = { get, post };
