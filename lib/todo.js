// The To Do (the right panel's third tab): what the person means to work on, put there by hand. Three zones, Today,
// This week and This month; each row a project, a size (a quick 15 min, or 1, 2, 4 or 8 hours) and an optional note.
// Nothing drops off by itself: a row stays until it is ticked done (an unfinished Today row is still there tomorrow,
// marked with the day it came in) or removed. Today's sizes add up against the person's day (8 h to start).
// Quick checks: a project can be checked every week or every month; each day up to 1 (or 2) that are due come into
// Today by themselves, the longest overdue first, so none is skipped; ticking one sets its next date.
// Kept in <data>/todo.json, written only when something changes (a fresh office's read writes nothing). A file that
// cannot be read is copied aside (todo.damaged-<time>.json) before anything replaces it. Nothing here touches a
// project's files. The pure parts take a state and today's date ("YYYY-MM-DD"), so the tests can set the day.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { saveJson } = require('./settings');

const ZONES = ['today', 'week', 'month'];
const ZONE_NAMES = { today: 'Today', week: 'This week', month: 'This month' };
const SIZES = [15, 60, 120, 240, 480]; // minutes: Quick, 1 h, 2 h, 4 h, 8 h
const EVERY = ['week', 'month'];
const MAX_ITEMS = 500;
const NOTE_MAX = 120;
const DONE_KEEP_DAYS = 35; // done rows are kept this long (Done this week shows the last 7 days), then dropped
// doneShow: the rows done before today, listed for this week, this month, or hidden (done today always shows).
const DEFAULT_SETTINGS = { dayHours: 8, checksPerDay: 1, doneShow: 'week' };
const DONE_SHOW = ['week', 'month', 'hide'];

const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v);
// A real calendar day only: Date.parse takes 2026-02-31 as 3 March, so the parts must come back the same.
const isDate = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d));
  return y >= 1970 && x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
};
/** A quick check's damaged date, mended: a day past the month's end becomes its last day (day 0 its first);
 * anything else becomes today, so the check comes up now instead of never. */
function mendDate(s, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (y >= 1970 && mo >= 1 && mo <= 12) {
      const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      return m[1] + '-' + m[2] + '-' + String(Math.min(Math.max(d, 1), last)).padStart(2, '0');
    }
  }
  return today;
}
const isId = s => typeof s === 'string' && /^[0-9a-f]{8,16}$/.test(s);
const isProject = s => typeof s === 'string' && s.length > 0 && s.length <= 80 && /^[\w.-]+$/.test(s) && !/^(__proto__|constructor|prototype)$/.test(s);
const newId = () => crypto.randomBytes(5).toString('hex');

/** A date as "YYYY-MM-DD" in this PC's time. */
function dayOf(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}
const toDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
/** The next check date: a week on, or the same day next month (the 31st becomes the month's last day). */
function nextDate(from, every) {
  const d = toDate(from);
  if (every === 'week') { d.setDate(d.getDate() + 7); return dayOf(d); }
  const want = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(want, last));
  return dayOf(d);
}
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
/** Monday of the week a date is in. */
function weekStart(day) { const d = toDate(day); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayOf(d); }

/** Text from the page, made safe to keep and show: one line, no control or direction characters, at most `max`. */
function cleanText(s, max) {
  return require('./input').oneLine(s, max);
}

/**
 * Whatever was read, kept to the shapes above: anything else (a row edited by hand, a stray key) is dropped. A quick
 * check with a damaged date is kept with its date mended (mendDate). `dropped` and `repaired` count what was not kept
 * as it was, so the store can copy the file aside first and the page can say so; they are not saved.
 */
function normalize(raw, today = dayOf()) {
  const s = { items: [], checks: {}, settings: { ...DEFAULT_SETTINGS } };
  Object.defineProperty(s, 'dropped', { value: 0, writable: true, enumerable: false });
  Object.defineProperty(s, 'repaired', { value: 0, writable: true, enumerable: false });
  if (!isPlain(raw)) return s;
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const rawChecks = isPlain(raw.checks) ? Object.keys(raw.checks).length : 0;
  const seen = new Set();
  for (const it of Array.isArray(raw.items) ? raw.items.slice(0, MAX_ITEMS) : []) {
    if (!isPlain(it) || !isId(it.id) || seen.has(it.id) || !isProject(it.project) || !ZONES.includes(it.zone) || !SIZES.includes(it.size)) continue;
    seen.add(it.id);
    s.items.push({
      id: it.id, project: it.project, name: cleanText(it.name, 100) || it.project, size: it.size, note: cleanText(it.note, NOTE_MAX),
      zone: it.zone, kind: it.kind === 'check' ? 'check' : 'task', added: isDate(it.added) ? it.added : today,
      // a done row with no real day would never be tidied away nor listed: it counts as done today
      today: isDate(it.today) ? it.today : null, done: it.done === true, doneAt: isDate(it.doneAt) ? it.doneAt : it.done === true ? today : null,
      ...(isDate(it.pulledOn) ? { pulledOn: it.pulledOn } : {}), ...(isDate(it.prevNext) ? { prevNext: it.prevNext } : {}),
    });
  }
  if (isPlain(raw.checks)) {
    for (const [k, c] of Object.entries(raw.checks)) {
      if (!isProject(k) || !isPlain(c) || !EVERY.includes(c.every)) continue;
      const next = isDate(c.next) ? c.next : mendDate(c.next, today);
      if (next !== c.next) s.repaired++;
      s.checks[k] = { every: c.every, next, name: cleanText(c.name, 100) || k };
    }
  }
  s.dropped = (rawItems.length - s.items.length) + (rawChecks - Object.keys(s.checks).length);
  if (isPlain(raw.settings)) {
    const h = Number(raw.settings.dayHours);
    if (Number.isFinite(h) && h >= 1 && h <= 16) s.settings.dayHours = Math.round(h * 4) / 4;
    if (raw.settings.checksPerDay === 1 || raw.settings.checksPerDay === 2) s.settings.checksPerDay = raw.settings.checksPerDay;
    if (DONE_SHOW.includes(raw.settings.doneShow)) s.settings.doneShow = raw.settings.doneShow;
  }
  return s;
}

const fault = (f, reason = '', wayOut = '') => ({ ok: false, fault: f, reason, wayOut });
const findItem = (s, id) => (isId(id) ? s.items.find(x => x.id === id) : null);

/** Add a row: { project, name, size, note, zone }. Today's rows remember the day they came into Today. */
function add(s, o, today) {
  if (!isProject(o.project)) return fault('No project was named.', '', 'Pick a project, then Add.');
  const zone = ZONES.includes(o.zone) ? o.zone : 'today';
  // No size means 1 h; a size that is given must be one of the sizes (as in set), never quietly turned into 1 h.
  if (o.size !== undefined && o.size !== null && o.size !== '' && !SIZES.includes(Number(o.size))) return fault('That is not one of the sizes.', 'Quick (15 min), 1 h, 2 h, 4 h or 8 h.');
  const size = SIZES.includes(Number(o.size)) ? Number(o.size) : 60;
  if (s.items.length >= MAX_ITEMS) return fault('The To Do is full.', `It keeps ${MAX_ITEMS} rows.`, 'Remove some done or old rows, then Add again.');
  const item = { id: newId(), project: o.project, name: cleanText(o.name, 100) || o.project, size, note: cleanText(o.note, NOTE_MAX), zone, kind: 'task', added: today, today: zone === 'today' ? today : null, done: false, doneAt: null };
  s.items.push(item);
  return { ok: true, item };
}

/** Change a row's size or note. */
function set(s, id, o, today) {
  const it = findItem(s, id);
  if (!it) return fault('That row is not on the To Do any more.', '', 'Reload the page.');
  if (o.size !== undefined) { if (!SIZES.includes(Number(o.size))) return fault('That is not one of the sizes.', 'Quick (15 min), 1 h, 2 h, 4 h or 8 h.'); it.size = Number(o.size); }
  if (o.note !== undefined) it.note = cleanText(o.note, NOTE_MAX);
  return { ok: true, item: it };
}

/** Move a row to a zone, before another row (`before`) or at the zone's end. */
function move(s, id, zone, before, today) {
  const it = findItem(s, id);
  if (!it) return fault('That row is not on the To Do any more.', '', 'Reload the page.');
  if (!ZONES.includes(zone)) return fault('That is not a part of the To Do.', 'Today, This week or This month.');
  if (it.zone !== zone) { it.zone = zone; it.today = zone === 'today' ? today : null; }
  s.items.splice(s.items.indexOf(it), 1);
  const at = before && before !== id ? s.items.findIndex(x => x.id === before) : -1;
  if (at >= 0) s.items.splice(at, 0, it);
  else s.items.push(it);
  return { ok: true, item: it };
}

/** Tick (or untick) a row. A quick check ticked sets its project's next check; unticked, it goes back. */
function done(s, id, on, today) {
  const it = findItem(s, id);
  if (!it) return fault('That row is not on the To Do any more.', '', 'Reload the page.');
  if (on === it.done) return { ok: true, item: it };
  it.done = !!on;
  it.doneAt = on ? today : null;
  const c = it.kind === 'check' ? s.checks[it.project] : null;
  if (c && on) { it.prevNext = c.next; c.next = nextDate(today, c.every); }
  if (c && !on && it.prevNext) { c.next = it.prevNext; delete it.prevNext; }
  return { ok: true, item: it };
}

function remove(s, id) {
  const it = findItem(s, id);
  if (!it) return fault('That row is not on the To Do any more.', '', 'Reload the page.');
  s.items.splice(s.items.indexOf(it), 1);
  return { ok: true };
}

/** A project's quick check: every 'week' or 'month' (first one due today), or 'off'. */
function setCheck(s, project, every, name, today) {
  if (!isProject(project)) return fault('No project was named.');
  if (every === 'off') { delete s.checks[project]; return { ok: true, check: null }; }
  if (!EVERY.includes(every)) return fault('A quick check is every week or every month.');
  const had = s.checks[project];
  s.checks[project] = { every, next: had ? had.next : today, name: cleanText(name, 100) || had?.name || project };
  return { ok: true, check: s.checks[project] };
}

function setSettings(s, o) {
  if (o.dayHours !== undefined) {
    const h = Number(o.dayHours);
    if (!Number.isFinite(h) || h < 1 || h > 16) return fault('A day is 1 to 16 hours.', '', 'Pick the hours you work in a day.');
    s.settings.dayHours = Math.round(h * 4) / 4;
  }
  if (o.checksPerDay !== undefined) {
    if (o.checksPerDay !== 1 && o.checksPerDay !== 2) return fault('Quick checks come 1 or 2 a day.');
    s.settings.checksPerDay = o.checksPerDay;
  }
  if (o.doneShow !== undefined) {
    if (!DONE_SHOW.includes(o.doneShow)) return fault('Earlier done rows show for this week, this month, or not at all.');
    s.settings.doneShow = o.doneShow;
  }
  return { ok: true, settings: s.settings };
}

/**
 * Today's quick checks: those due (their date today or earlier) come into Today, the longest overdue first, until
 * today has had its 1 (or 2). A project whose check is already on the To Do and not done is not added again (it
 * stays where it is, still due). Returns how many came in; the state changes only when one did.
 */
function pullChecks(s, today, has = () => true) {
  const inToday = s.items.filter(x => x.kind === 'check' && x.pulledOn === today).length;
  let room = s.settings.checksPerDay - inToday;
  if (room <= 0) return 0;
  const open = new Set(s.items.filter(x => x.kind === 'check' && !x.done).map(x => x.project));
  const due = Object.entries(s.checks).filter(([k, c]) => c.next <= today && !open.has(k) && has(k))
    .sort((a, b) => a[1].next.localeCompare(b[1].next) || a[1].name.localeCompare(b[1].name));
  let n = 0;
  for (const [k, c] of due) {
    if (room-- <= 0 || s.items.length >= MAX_ITEMS) break;
    s.items.push({ id: newId(), project: k, name: c.name, size: 15, note: '', zone: 'today', kind: 'check', added: today, today, done: false, doneAt: null, pulledOn: today });
    n++;
  }
  return n;
}

/** Done rows older than DONE_KEEP_DAYS go. Returns how many went. */
function tidy(s, today) {
  const before = s.items.length;
  s.items = s.items.filter(x => !x.done || !x.doneAt || daysBetween(x.doneAt, today) <= DONE_KEEP_DAYS);
  return before - s.items.length;
}

const sizeText = m => (m < 60 ? 'Quick' : `${m / 60} h`);
const hm = m => (m % 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m / 60} h`);
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * What the page shows: the three zones with their open rows, Done today (always), the rows done earlier (this week,
 * this month, or none, as doneShow says), Today's total against the day (what is left plus what was done today), and
 * the quick checks. `projects`: { id: name } of the projects on the list now (a row whose project left the list keeps its
 * name and says so).
 */
function view(s, today, projects = {}) {
  const row = it => ({
    id: it.id, project: it.project, name: projects[it.project] || it.name, gone: !projects[it.project], size: it.size, sizeText: sizeText(it.size),
    note: it.note, kind: it.kind, done: it.done, doneAt: it.doneAt,
    from: it.zone === 'today' && !it.done && it.today && it.today < today ? WEEKDAY[toDate(it.today).getDay()] + ' ' + toDate(it.today).getDate() : null,
    check: it.kind === 'check' && s.checks[it.project] ? s.checks[it.project].every : null,
  });
  const zones = ZONES.map(z => ({ zone: z, name: ZONE_NAMES[z], items: s.items.filter(x => x.zone === z && !x.done).map(row) }));
  const leftMin = s.items.filter(x => x.zone === 'today' && !x.done).reduce((t, x) => t + x.size, 0);
  const doneTodayRows = s.items.filter(x => x.done && x.doneAt === today);
  const doneMin = doneTodayRows.reduce((t, x) => t + x.size, 0);
  const todayMin = leftMin + doneMin;
  const dayMin = Math.round(s.settings.dayHours * 60);
  const newest = (a, b) => b.doneAt.localeCompare(a.doneAt);
  const show = s.settings.doneShow;
  const from = show === 'month' ? today.slice(0, 8) + '01' : weekStart(today);
  const earlier = show === 'hide' ? [] : s.items.filter(x => x.done && x.doneAt && x.doneAt < today && x.doneAt >= from).sort(newest).map(row);
  const hiddenEarlier = show === 'hide' ? s.items.filter(x => x.done && x.doneAt && x.doneAt < today && x.doneAt >= weekStart(today)).length : 0;
  const checks = Object.entries(s.checks).map(([k, c]) => ({ project: k, name: projects[k] || c.name, every: c.every, next: c.next, due: c.next <= today }))
    .sort((a, b) => a.next.localeCompare(b.next));
  const over = todayMin - dayMin;
  return {
    today, zones, doneToday: doneTodayRows.map(row), doneEarlier: { show, name: show === 'month' ? 'Done earlier this month' : 'Done earlier this week', items: earlier, hidden: hiddenEarlier },
    checks, settings: s.settings, sizes: SIZES.map(m => ({ min: m, text: m < 60 ? 'Quick · 15 min' : sizeText(m) })),
    total: { todayMin, leftMin, doneMin, dayMin, text: `Today ${hm(todayMin)} of ${hm(dayMin)}` + (over > 0 ? `: ${hm(over)} over` : '') + (doneMin ? ` · ${hm(doneMin)} done` : '') },
    open: zones[0].items.length,
  };
}

/** The store: read once, kept in memory, saved whole and safely after each change. */
function create({ dataDir, today = () => dayOf() }) {
  const file = path.join(dataDir, 'todo.json');
  let s = null;
  let damaged = 0; // rows or checks not kept as they were in the file read (a copy of it was set aside)
  function load() {
    if (s) return s;
    let raw = null;
    try { raw = JSON.parse(require('./settings').readText(file).replace(/^\uFEFF/, '')); }
    catch (e) { if (e.code !== 'ENOENT') setAside(); }
    if (raw !== null && !isPlain(raw)) setAside();
    s = normalize(raw, today());
    damaged = s.dropped + s.repaired;
    // Anything dropped or mended would be gone from the file at the next save: keep the file as it was first.
    if (damaged) setAside();
    return s;
  }
  function setAside() {
    require('./settings').setAside(file); // one that cannot be copied aside is then never written over (swapIn)
  }
  const plain = st => ({ items: st.items, checks: st.checks, settings: st.settings });
  /**
   * Run a change on a copy; the copy is saved and only then takes the place of what is in memory. A change refused
   * part-way (one field fine, the next not) or a save that fails leaves memory and the file exactly as they were.
   */
  const change = fn => {
    const cur = load();
    const copy = structuredClone(plain(cur));
    const r = fn(copy, today());
    if (r && r.ok !== false) { saveJson(file, { version: 1, ...copy }); s = copy; }
    return r;
  };
  return {
    file,
    view(projects, has) {
      const t = today();
      const copy = structuredClone(plain(load()));
      if (pullChecks(copy, t, has) + tidy(copy, t)) { saveJson(file, { version: 1, ...copy }); s = copy; }
      return { ...view(s, t, projects), damaged };
    },
    add: o => change((st, t) => add(st, o, t)),
    set: (id, o) => change((st, t) => set(st, id, o, t)),
    move: (id, zone, before) => change((st, t) => move(st, id, zone, before, t)),
    done: (id, on) => change((st, t) => done(st, id, on, t)),
    remove: id => change(st => remove(st, id)),
    setCheck: (project, every, name) => change((st, t) => setCheck(st, project, every, name, t)),
    setSettings: o => change(st => setSettings(st, o)),
    checkOf: project => load().checks[project] || null,
  };
}

module.exports = { create, normalize, add, set, move, done, remove, setCheck, setSettings, pullChecks, tidy, view, nextDate, weekStart, dayOf, cleanText, ZONES, SIZES };
