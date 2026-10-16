// The project planner's rules and data (the engine only; its page comes next). Every project gets a score, the day
// is split once the hours are set, and nothing is forgotten: the top three get focus time, the last hour goes to the
// medium project and the low one that have waited longest (never at random), finished sites get their care check-ins,
// and paid care goes at the top of the day because it brings in money. Every number in a plan derives from the rules
// below; the worked examples in test/priorities.test.js are the ones the plan was agreed on.
//
// Kept in the office's data folder (never published): priorities.json (per project, keyed by its folder) and
// categories.json (the person's own project categories, each with an owner and a care plan). Both are read fresh,
// cleaned (anything unexpected is dropped, never trusted) and written whole through a temp file.
'use strict';
const fs = require('fs');
const path = require('path');

const DAY = 86400000;
const KEYS = ['p', 'd', 'm', 'c', 'k']; // profit, demand, meaning, few competitors, little marketing (each 0-10)
const WEIGHTS = { p: 3, d: 2.5, m: 2, c: 1.5, k: 1 }; // x10 = 30 + 25 + 20 + 15 + 10 = 100
const FLAG_LIFT = 20; // "Needs work" until it is worked on
const MEDIUM_MIN = 40;
const LOW_MIN = 20;
const STAGES = ['building', 'ready', 'handover', 'looked-after', 'handed-on', 'parked'];
const OWNERS = ['mine', 'company', 'client'];
const EVERY = ['day', 'week', 'none'];
const UNSORTED = 'unsorted';

/** The board's own settings. The ones he has not answered yet carry the plan's suggested defaults:
 * O3 (calendar or working days), O4 (a handover for his own sites), O5 (rescans for sold sites), and whether paid
 * care lifts a project's score (suggested: no, profit is already scored). */
const SETTINGS = { hoursPerDay: 8, handoverDays: 'calendar', ownHandover: true, rescanSold: false, paidLiftsScore: false };
/** A category's care plan when it sets none of its own (O6: the 15-minute defaults). */
const CARE = { handoverDays: 30, handoverMin: 15, checkEvery: 'week', checkMin: 15, paid: false };

// ---- the rules (pure: no files, no clock of their own) ----

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Score out of 100 from the five 0-10 marks (5 each when not set yet). */
function scoreOf(scores) {
  const s = scores && typeof scores === 'object' ? scores : {};
  return Math.round(KEYS.reduce((t, k) => t + clamp(num(s[k], 5), 0, 10) * WEIGHTS[k], 0) * 10) / 10;
}
/** The score the ranking uses: +20 while "Needs work" is on. */
const rankScore = e => scoreOf(e.scores) + (e.flag === 'needs' ? FLAG_LIFT : 0);

/** A local date ('YYYY-MM-DD') as the ms of its midnight, and back. */
const dayOf = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const dateOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dateOf(dayOf(s)) === s;
const weekend = ms => [0, 6].includes(new Date(ms).getDay());

/** Which day of a stage today is (the first day is 1): calendar days, or Monday-Friday only (O3). */
function dayNumber(since, today, working = false) {
  const a = dayOf(since), b = dayOf(today);
  if (b < a) return 0;
  if (!working) return Math.round((b - a) / DAY) + 1;
  let n = 0;
  for (let t = a; t <= b; t += DAY) if (!weekend(t)) n++;
  return n;
}

/** Days a project has waited: since it was last worked on (its newest file) or last checked, whichever is later. */
function waitingDays(e, updated, today) {
  const last = Math.max(num(updated, 0), e.lastChecked ? dayOf(e.lastChecked) : 0);
  return last ? Math.max(0, Math.round((dayOf(today) - dayOf(dateOf(last))) / DAY)) : Infinity;
}

/** A project's care plan: its own override, else its main category's, else the defaults. */
function careOf(e, cats) {
  const cat = cats.find(c => c.id === (e.categories || [])[0]) || cats.find(c => c.id === UNSORTED);
  return { ...CARE, ...(cat && cat.care), ...(e.care || {}), owner: (cat && cat.owner) || 'mine' };
}

/** Where a finished project stands today: its stage (a handover past its days becomes Looked after, or Handed on when
 * sold), the day of the handover, and the check-in due today, if any. */
function standing(e, cats, today, settings = SETTINGS) {
  const care = careOf(e, cats);
  const working = settings.handoverDays === 'working';
  let stage = e.stage || 'building';
  let day = 0;
  if (stage === 'handover') {
    // O4: his own (or his company's) sites skip the handover when it is turned off, unless sold.
    if (!settings.ownHandover && care.owner !== 'client' && !e.soldOn) stage = 'looked-after';
    else {
      day = dayNumber(e.stageSince || today, today, working);
      if (day > care.handoverDays) { stage = e.soldOn ? 'handed-on' : 'looked-after'; day = 0; }
    }
  }
  let due = null;
  if (stage === 'handover' && !(working && weekend(dayOf(today)))) due = { kind: 'handover', min: care.handoverMin, paid: !!care.paid, movable: false };
  if (stage === 'looked-after' && care.checkEvery !== 'none') {
    const checkDay = Number.isInteger(e.checkDay) ? e.checkDay : new Date(dayOf(e.stageSince || today)).getDay();
    if (care.checkEvery === 'day' || new Date(dayOf(today)).getDay() === checkDay) due = { kind: care.checkEvery === 'day' ? 'daily' : 'weekly', min: care.checkMin, paid: !!care.paid, movable: care.checkEvery === 'week' };
  }
  return { stage, day, of: stage === 'handover' ? care.handoverDays : 0, due, care };
}

/** Focus minutes for the top three: #1 gets half, #2 and #3 split the rest by score; rounding leftovers go on #1. */
function splitFocus(total, scores) {
  const n = Math.min(3, scores.length);
  if (!n || total <= 0) return scores.slice(0, 3).map(() => 0);
  if (n === 1) return [total];
  const first = Math.round(total / 2);
  const rest = total - first;
  const tail = scores.slice(1, n);
  const sum = tail.reduce((a, b) => a + b, 0);
  const parts = tail.map(s => Math.round(sum ? (rest * s) / sum : rest / tail.length));
  return [total - parts.reduce((a, b) => a + b, 0), ...parts];
}

/** The longest-waiting project of a list (ties: the higher score). */
const longestWaiting = list => [...list].sort((a, b) => b.waiting - a.waiting || b.score - a.score)[0] || null;

/**
 * Today's plan. projects: [{ key, name, updated }] (key = the project's folder key); entries: { key: entry };
 * cats: the categories. Returns the day in its order (paid care, focus #1-#3, medium, check-ins, low check-in), the
 * ready-to-ship lane (no focus time), and plain notes when the bottom of the day squeezes the focus time.
 * day: today's picks once made ({ date, focus, medium, low, answers }). The last-hour pair is kept all day, so working
 * on it or answering its check-in never swaps it for another (its wait starts again, which would); one that is no
 * longer being built (parked, shipped, gone) is filled again by the same rule. The focus three and the minutes are
 * always worked out afresh, so a new score or a change of hours shows at once.
 */
function planDay({ projects, entries = {}, cats = [], settings = SETTINGS, today, day = null }) {
  const set = { ...SETTINGS, ...settings };
  const total = Math.round(clamp(num(set.hoursPerDay, 8), 1, 16) * 60);
  const rows = projects.map(p => {
    const e = entries[p.key] || {};
    const st = standing(e, cats, today, set);
    const liftPaid = set.paidLiftsScore && st.care.paid ? 10 : 0;
    return { key: p.key, name: p.name, entry: e, stage: st.stage, day: st.day, of: st.of, due: st.due,
      score: rankScore(e) + liftPaid, waiting: waitingDays(e, p.updated, today), deadline: isDate(e.deadline) ? e.deadline : null };
  });
  const ready = rows.filter(r => r.stage === 'ready');
  // Building projects, ranked: a hard date first (soonest first), then by score, then the longest waiting.
  const building = rows.filter(r => r.stage === 'building').sort((a, b) =>
    (a.deadline ? 0 : 1) - (b.deadline ? 0 : 1) || (a.deadline && b.deadline ? dayOf(a.deadline) - dayOf(b.deadline) : 0)
    || b.score - a.score || b.waiting - a.waiting);
  let top, medium, low;
  const kept = day && day.date === today ? day : null;
  if (!kept) {
    top = building.slice(0, 3);
    medium = longestWaiting(building.slice(3, 6));
    low = longestWaiting(building.slice(6));
  } else {
    // The focus three always follow the scores. The last-hour pair, picked by the longest wait, stays all day (unless
    // it went, or a score lifted it into the three); a gap is filled by the same rule from the rest of its band.
    top = building.slice(0, 3);
    const used = new Set(top.map(r => r.key));
    const take = k => { const r = k && !used.has(k) ? building.find(x => x.key === k) : null; if (r) used.add(k); return r || null; };
    medium = take(kept.medium);
    low = take(kept.low);
    if (!medium) { medium = longestWaiting(building.slice(3, 6).filter(r => !used.has(r.key))); if (medium) used.add(medium.key); }
    if (!low) low = longestWaiting(building.slice(6).filter(r => !used.has(r.key)));
  }
  const said = (key) => (kept && kept.answers && kept.answers[key]) || null;
  const dueRows = rows.filter(r => r.due);
  const paid = dueRows.filter(r => r.due.paid).map(r => ({ key: r.key, name: r.name, min: r.due.min, kind: r.due.kind, stage: r.stage, day: r.day, of: r.of, answer: said(r.key) }));
  const checkins = dueRows.filter(r => !r.due.paid).map(r => ({ key: r.key, name: r.name, min: r.due.min, kind: r.due.kind, movable: r.due.movable, stage: r.stage, day: r.day, of: r.of, answer: said(r.key) }));
  const topMin = paid.reduce((t, c) => t + c.min, 0);
  const bottomMin = (medium ? MEDIUM_MIN : 0) + checkins.reduce((t, c) => t + c.min, 0) + (low ? LOW_MIN : 0);
  const focusMin = Math.max(0, total - topMin - bottomMin);
  const split = splitFocus(focusMin, top.map(r => r.score));
  const focus = top.map((r, i) => ({ key: r.key, name: r.name, min: split[i], score: r.score, flagged: r.entry.flag === 'needs', deadline: r.deadline, rank: i + 1 }));
  const notes = [];
  const handovers = checkins.filter(c => c.kind === 'handover').length;
  if (checkins.length) notes.push(`${checkins.length} check-in${checkins.length === 1 ? '' : 's'} today${handovers ? ` (${handovers} handover)` : ''}: focus is ${hm(focusMin)}.`);
  if (checkins.some(c => c.movable)) notes.push('Weekly checks can move to tomorrow; daily handover checks stay, because they are promised for the handover.');
  if (total - topMin - bottomMin < 0) notes.push(`Today's care and check-ins need ${hm(topMin + bottomMin)}, more than the ${hm(total)} set: there is no focus time.`);
  return {
    today, totalMin: total, topMin, bottomMin, focusMin,
    ready: ready.map(r => ({ key: r.key, name: r.name })),
    paid, focus,
    medium: medium ? { key: medium.key, name: medium.name, min: MEDIUM_MIN, waiting: medium.waiting, score: medium.score } : null,
    checkins,
    low: low ? { key: low.key, name: low.name, min: LOW_MIN, waiting: low.waiting, score: low.score, answer: said(low.key) } : null,
    notes,
    // What to keep as today's picks (the route keeps them in priorities.json with the answers given today).
    picks: { date: today, focus: top.map(r => r.key), medium: medium ? medium.key : null, low: low ? low.key : null },
  };
}
const hm = min => (min % 60 ? `${Math.floor(min / 60)} h ${min % 60}` : `${min / 60} h`);

/** An answer to a check-in: Fine for now (the wait starts again), Needs work (+20 until worked on), Park it (off the board). */
function answer(e, what, today) {
  const next = { ...e };
  if (what === 'fine') { next.lastChecked = today; delete next.flag; delete next.flaggedAt; }
  else if (what === 'needs') { next.lastChecked = today; next.flag = 'needs'; next.flaggedAt = today; }
  else if (what === 'park') { next.stage = 'parked'; next.stageSince = today; }
  else throw new Error('Unknown answer: ' + what);
  return next;
}
/**
 * A change from the score window, checked: the five marks (whole numbers 0-10), a deadline ('' clears it), Needs work
 * on or off, the categories (the main one first, two at most), and the stage: building, ready (to ship), handover
 * (Shipped or Handed over), parked, or sold (moved to the buyer's category, `soldTo`, which starts its handover). A
 * stage that changes starts its days today. Returns { ok, entry } or { ok: false, error }.
 */
function setEntry(e, body, cats, today) {
  const next = { ...e };
  if (body.scores !== undefined) {
    if (!body.scores || typeof body.scores !== 'object') return { ok: false, error: 'No marks were sent. Move a slider and save again.' };
    next.scores = { ...(e.scores || {}) };
    for (const k of KEYS) {
      if (body.scores[k] === undefined) continue;
      const v = body.scores[k];
      if (!Number.isInteger(v) || v < 0 || v > 10) return { ok: false, error: `A mark must be a whole number from 0 to 10, not ${v}. Move the slider and save again.` };
      next.scores[k] = v;
    }
  }
  if (body.deadline !== undefined) {
    if (body.deadline === '' || body.deadline === null) delete next.deadline;
    else if (!isDate(body.deadline)) return { ok: false, error: 'The deadline is not a date. Pick one from the calendar, or clear it.' };
    else next.deadline = body.deadline;
  }
  if (body.flag !== undefined) {
    if (!body.flag) { delete next.flag; delete next.flaggedAt; } else if (next.flag !== 'needs') { next.flag = 'needs'; next.flaggedAt = today; }
  }
  if (body.categories !== undefined) {
    const ids = Array.isArray(body.categories) ? [...new Set(body.categories.filter(c => c && c !== UNSORTED))] : null;
    if (!ids) return { ok: false, error: 'No categories were sent. Pick them again and save.' };
    if (ids.length > 2) return { ok: false, error: `A project can be in two categories at most, not ${ids.length}. Take one off and save again.` };
    const gone = ids.find(id => !cats.some(c => c.id === id));
    if (gone) return { ok: false, error: 'One of those categories is not on the list any more. Reload the page.' };
    if (ids.length) next.categories = ids; else delete next.categories;
  }
  if (body.stage !== undefined) {
    const was = e.stage || 'building';
    if (body.stage === 'sold') {
      const to = cats.find(c => c.id === body.soldTo && c.id !== UNSORTED);
      if (!to) return { ok: false, error: 'Pick the category of whoever bought it. Make one under Categories first if it is not there.' };
      const [main, second] = next.categories || [];
      if (main === to.id) return { ok: false, error: `It is in ${to.name} already. Pick the buyer's category.` };
      const from = cats.find(c => c.id === (main || UNSORTED));
      next.soldFrom = from ? from.name : 'Not sorted';
      next.soldOn = today;
      next.categories = [to.id, ...(second && second !== to.id ? [second] : [])];
      next.stage = 'handover';
      next.stageSince = today;
    } else if (['building', 'ready', 'handover', 'parked'].includes(body.stage)) {
      if (body.stage !== was) { next.stage = body.stage; next.stageSince = today; }
    } else return { ok: false, error: 'That stage is not one the planner knows. Reload the page.' };
  }
  return { ok: true, entry: cleanEntry(next) };
}

/** "Needs work" comes off once the project has been worked on (a file changed) since it was flagged. */
function clearWorkedFlag(e, updated) {
  if (e.flag !== 'needs' || !e.flaggedAt || !(num(updated, 0) >= dayOf(e.flaggedAt) + DAY)) return e;
  const next = { ...e };
  delete next.flag;
  delete next.flaggedAt;
  return next;
}

/** What changing a category's care plan would change: the projects that follow it, and those with their own plan. */
function careChange(entries, catId) {
  const follows = [], own = [];
  for (const [key, e] of Object.entries(entries)) {
    if ((e.categories || [])[0] !== catId) continue;
    (e.care ? own : follows).push(key);
  }
  return { follows, own };
}
/** Changes a category's care plan. 'all': every project that follows it changes too. 'new': only projects added from now
 * on; the ones following it now keep the old plan as their own. */
function changeCare(store, catId, care, mode) {
  const cat = store.categories.find(c => c.id === catId);
  if (!cat) return { ok: false, error: 'That category is not on the list any more. Reload the page.' };
  const old = { ...CARE, ...cat.care };
  const { follows } = careChange(store.entries, catId);
  if (mode === 'new') for (const key of follows) store.entries[key] = { ...store.entries[key], care: old };
  else if (mode !== 'all') return { ok: false, error: 'Choose Change all or Only projects added from now on.' };
  cat.care = cleanCare(care);
  return { ok: true, changed: mode === 'all' ? follows.length : 0, kept: mode === 'new' ? follows.length : 0 };
}

// ---- the data: cleaned on the way in, written whole ----

function cleanCare(c) {
  if (!c || typeof c !== 'object') return undefined;
  const out = {};
  if (Number.isInteger(c.handoverDays) && c.handoverDays >= 0 && c.handoverDays <= 365) out.handoverDays = c.handoverDays;
  if (Number.isInteger(c.handoverMin) && c.handoverMin >= 0 && c.handoverMin <= 480) out.handoverMin = c.handoverMin;
  if (EVERY.includes(c.checkEvery)) out.checkEvery = c.checkEvery;
  if (Number.isInteger(c.checkMin) && c.checkMin >= 0 && c.checkMin <= 480) out.checkMin = c.checkMin;
  if (typeof c.paid === 'boolean') out.paid = c.paid;
  return Object.keys(out).length ? out : undefined;
}
function cleanEntry(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const out = {};
  if (e.scores && typeof e.scores === 'object') {
    out.scores = {};
    for (const k of KEYS) if (Number.isFinite(e.scores[k])) out.scores[k] = clamp(Math.round(e.scores[k]), 0, 10);
  }
  if (e.flag === 'needs') out.flag = 'needs';
  for (const k of ['deadline', 'lastChecked', 'flaggedAt', 'stageSince', 'soldOn']) if (isDate(e[k])) out[k] = e[k];
  if (STAGES.includes(e.stage)) out.stage = e.stage;
  if (Array.isArray(e.categories)) out.categories = [...new Set(e.categories.filter(c => typeof c === 'string' && c))].slice(0, 2);
  if (typeof e.soldFrom === 'string') out.soldFrom = e.soldFrom.slice(0, 80);
  if (Number.isInteger(e.checkDay) && e.checkDay >= 0 && e.checkDay <= 6) out.checkDay = e.checkDay;
  const care = cleanCare(e.care);
  if (care) out.care = care;
  if (typeof e.lastReviewedModel === 'string') out.lastReviewedModel = e.lastReviewedModel.slice(0, 80);
  if (isDate(e.lastReviewedAt)) out.lastReviewedAt = e.lastReviewedAt;
  return out;
}
function cleanCategory(c) {
  if (!c || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name.trim()) return null;
  return { id: c.id.slice(0, 40), name: c.name.trim().replace(/\s+/g, ' ').slice(0, 60), owner: OWNERS.includes(c.owner) ? c.owner : 'mine',
    ...(cleanCare(c.care) ? { care: cleanCare(c.care) } : {}), rescan: c.rescan !== false, order: Number.isInteger(c.order) ? c.order : 0 };
}
const NOT_SORTED = { id: UNSORTED, name: 'Not sorted', owner: 'mine', rescan: true, order: 0 };

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}
/** Both files, cleaned. "Not sorted" is always there; a project naming a category that is gone goes back to it. */
function load(dir) {
  const p = readJson(path.join(dir, 'priorities.json')) || {};
  const c = readJson(path.join(dir, 'categories.json')) || {};
  const settings = { ...SETTINGS };
  if (p.settings && typeof p.settings === 'object') {
    if (Number.isFinite(p.settings.hoursPerDay)) settings.hoursPerDay = clamp(p.settings.hoursPerDay, 1, 16);
    if (['calendar', 'working'].includes(p.settings.handoverDays)) settings.handoverDays = p.settings.handoverDays;
    for (const k of ['ownHandover', 'rescanSold', 'paidLiftsScore']) if (typeof p.settings[k] === 'boolean') settings[k] = p.settings[k];
  }
  const seen = new Set();
  const categories = [NOT_SORTED, ...(Array.isArray(c.categories) ? c.categories : []).map(cleanCategory)
    .filter(x => x && x.id !== UNSORTED && !seen.has(x.id.toLowerCase()) && seen.add(x.id.toLowerCase()))];
  const ids = new Set(categories.map(x => x.id));
  const entries = {};
  for (const [key, e] of Object.entries(p.projects && typeof p.projects === 'object' ? p.projects : {})) {
    const clean = cleanEntry(e);
    if (!clean) continue;
    if (clean.categories) clean.categories = clean.categories.filter(id => ids.has(id));
    entries[key.toLowerCase()] = clean;
  }
  return { settings, categories, entries, day: cleanDay(p.day) };
}
/** Today's kept picks, and the check-in answers given today. */
function cleanDay(d) {
  if (!d || typeof d !== 'object' || !isDate(d.date)) return null;
  const key = k => (typeof k === 'string' && k ? k.toLowerCase().slice(0, 400) : null);
  const answers = {};
  for (const [k, v] of Object.entries(d.answers && typeof d.answers === 'object' ? d.answers : {})) if (['fine', 'needs', 'park'].includes(v)) answers[k.toLowerCase()] = v;
  return { date: d.date, made: Number.isFinite(d.made) ? d.made : 0, focus: (Array.isArray(d.focus) ? d.focus : []).map(key).filter(Boolean).slice(0, 3),
    medium: key(d.medium), low: key(d.low), answers };
}
function writeWhole(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  require('./settings').swapIn(tmp, file);
}
function save(dir, store) {
  writeWhole(path.join(dir, 'priorities.json'), { settings: store.settings, projects: store.entries, ...(store.day ? { day: store.day } : {}) });
  writeWhole(path.join(dir, 'categories.json'), { categories: store.categories.filter(c => c.id !== UNSORTED) });
}

/** A new category (or a rename). The name is needed and must not be one already used (any case). */
function saveCategory(store, body) {
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) return { ok: false, error: 'Give the category a name, for example My projects or the client\'s name.' };
  if (name.length > 60) return { ok: false, error: `The name is ${name.length} characters; the most is 60. Shorten it and save again.` };
  if (store.categories.some(c => c.id !== body.id && c.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `There is a category called ${name} already. Pick another name, or use that one.` };
  if (body.id) {
    const c = store.categories.find(x => x.id === body.id);
    if (!c) return { ok: false, error: 'That category is not on the list any more. Reload the page.' };
    if (c.id === UNSORTED) return { ok: false, error: 'Not sorted keeps its name: it holds the projects not in a category yet.' };
    c.name = name;
    if (OWNERS.includes(body.owner)) c.owner = body.owner;
    return { ok: true, category: c };
  }
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'category';
  let unique = id;
  for (let i = 2; store.categories.some(c => c.id === unique); i++) unique = `${id}-${i}`;
  const c = { id: unique, name, owner: OWNERS.includes(body.owner) ? body.owner : 'mine', rescan: true, order: store.categories.length };
  store.categories.push(c);
  return { ok: true, category: c };
}
/** Deleting a category: its projects go back to Not sorted (as their main one) or lose it as their second one. */
function removeCategory(store, id) {
  if (id === UNSORTED) return { ok: false, error: 'Not sorted cannot be deleted: it holds the projects not in a category yet.' };
  const i = store.categories.findIndex(c => c.id === id);
  if (i < 0) return { ok: false, error: 'That category is not on the list any more. Reload the page.' };
  const [gone] = store.categories.splice(i, 1);
  let moved = 0;
  for (const e of Object.values(store.entries)) {
    if (!(e.categories || []).includes(id)) continue;
    e.categories = e.categories.filter(c => c !== id);
    if (!e.categories.length) delete e.categories;
    moved++;
  }
  return { ok: true, removed: gone, projects: moved };
}

module.exports = {
  SETTINGS, CARE, UNSORTED, MEDIUM_MIN, LOW_MIN, FLAG_LIFT,
  scoreOf, rankScore, splitFocus, waitingDays, dayNumber, careOf, standing, planDay, answer, clearWorkedFlag, setEntry,
  careChange, changeCare, load, save, saveCategory, removeCategory, cleanEntry, cleanCare, dateOf, isDate,
};
