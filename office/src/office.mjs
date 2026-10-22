// The office's memory and its view of the world. It reads the AI app's transcripts (only reads: nothing is ever written
// near them), keeps its own ledger in data/ (so a thread deleted in the app keeps its person, nickname and earnings),
// and answers one snapshot of everyone for the page.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyThread, readFrom, localDay } from './transcript.mjs';
import { newTally, tallyLine, monthOf } from './tokens.mjs';
import { folderOf, stateOf, assignSeats, defaultName, projectOf, normPath } from './people.mjs';
import { cleanLook } from './look.mjs';
import { AppLinks } from './applinks.mjs';

/** How long a finished thread on the Needs attention list stays there. */
const WAITING_DAYS = 7;
/** Bump when the summary's shape changes: the cache is then read again from the start. */
const CACHE_VERSION = 6;
/** Names that would reach Object.prototype if used as a key in the office's plain-object records (seats, hooks, done):
 * a folder or thread called one of these is refused. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const safeKey = (k) => !UNSAFE_KEYS.has(String(k));

/** A file of the office's own: not there = `fallback`; there but unreadable (cut short, edited by hand) = copied aside
 * first (<name>.damaged-<time>.json), so the next save cannot wipe what was in it (the ledger holds what was earned). */
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') try { fs.copyFileSync(file, `${file.replace(/\.json$/i, '')}.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}.json`); } catch { /* nothing to keep */ }
    return fallback;
  }
}

/** Writes beside the file, then swaps it in, so a crash never leaves half a file. */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

export class Office {
  /**
   * @param {{ dataDir: string, transcriptsDir?: string, now?: () => number, workingFolders?: () => string[] }} o
   * workingFolders: the head office's working folders (Settings › Folders), asked each time: the projects folder when
   * the office has none of its own set.
   */
  constructor(o) {
    this.dataDir = o.dataDir;
    this.transcriptsDir = o.transcriptsDir || path.join(os.homedir(), '.claude', 'projects');
    this.now = o.now || (() => Date.now());
    // Tokens added to the spending balance on top of what the AI wrote: only the demo has any (to try every reward).
    this.bonus = Math.max(0, Number(o.bonus) || 0);
    this.workingFolders = o.workingFolders || (() => []);
    this.file = (n) => path.join(this.dataDir, n);
    this.settings = readJson(this.file('settings.json'), {});
    if (!this.settings.openedAt) {
      this.settings.openedAt = new Date(this.now()).toISOString();
      this.saveSettings();
    }
    if (!this.settings.quietMinutes) this.settings.quietMinutes = 60;
    this.seatNames = readJson(this.file('seats.json'), {});
    this.ledger = readJson(this.file('ledger.json'), { threads: {} });
    this.done = readJson(this.file('done.json'), {});
    const cache = readJson(this.file('cache.json'), {});
    /** file path -> { offset, size, mtime, t } */
    this.files = cache.version === CACHE_VERSION && cache.since === this.settings.openedAt ? cache.files || {} : {};
    /** thread id -> newest hook event { kind, words, at } (advanced setup). */
    this.hooks = {};
    /** Token counting rules (setTokens) and, per file, the reply ids already counted. */
    this.tok = null;
    this.tokSeen = new Map();
    this.dirty = false;
    /** Links that open a thread in the AI desktop app (the open-thread button). */
    this.appLinks = o.appLinks || new AppLinks();
  }

  saveSettings() { writeJson(this.file('settings.json'), this.settings); }

  /** Reads what is new in every transcript. Answers the number of files that had something new. */
  scan() {
    const list = this.listFiles();
    let changed = this.readSome(list);
    const seen = new Set(list.map((f) => f.file));
    for (const f of Object.keys(this.files)) if (!seen.has(f)) { delete this.files[f]; changed++; }
    if (changed) this.dirty = true;
    return changed;
  }

  /** Every transcript (and helper transcript), newest first: { file, id, parent, mtime }. */
  listFiles() {
    const out = [];
    let dirs = [];
    try { dirs = fs.readdirSync(this.transcriptsDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { dirs = []; }
    const add = (file, id, parent) => {
      let mtime = 0;
      try { mtime = fs.statSync(file).mtimeMs; } catch { return; }
      out.push({ file, id, parent, mtime });
    };
    for (const d of dirs) {
      const dir = path.join(this.transcriptsDir, d.name);
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.jsonl')) add(path.join(dir, e.name), e.name.slice(0, -6), null);
        else if (e.isDirectory()) {
          const sub = path.join(dir, e.name, 'subagents');
          let helpers = [];
          try { helpers = fs.readdirSync(sub).filter((n) => n.endsWith('.jsonl')); } catch { helpers = []; }
          for (const h of helpers) add(path.join(sub, h), h.slice(0, -6), e.name);
        }
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  /** Reads what is new in the files given (from listFiles). Answers how many had something new. */
  readSome(list) {
    let changed = 0;
    for (const f of list) changed += this.readFile(f.file, f.id, f.parent);
    if (changed) this.dirty = true;
    return changed;
  }

  /**
   * Token counts per project, counted in the same read as the staff (see tokens.mjs). rules: { sig, match(text),
   * hint(file) }, or null for none. A new sig (the project list changed) counts every file again, tokens only.
   */
  setTokens(rules) {
    this.tok = rules || null;
    if (!this.tokSeen) this.tokSeen = new Map();
  }

  /** { total: { id: n }, month: { id: n } } from every transcript read so far, or null when not counting. */
  tokenTotals() {
    if (!this.tok) return null;
    const total = {}, month = {};
    const thisMonth = monthOf(this.now()); // this PC's calendar month, as the replies are filed (tokens.mjs)
    for (const r of Object.values(this.files)) {
      if (!r.tok || r.tok.sig !== this.tok.sig) continue;
      for (const [id, n] of Object.entries(r.tok.per)) total[id] = (total[id] || 0) + n;
      for (const [k, n] of Object.entries(r.tok.months)) {
        const cut = k.lastIndexOf('|');
        if (k.slice(cut + 1) === thisMonth) month[k.slice(0, cut)] = (month[k.slice(0, cut)] || 0) + n;
      }
    }
    return { total, month };
  }

  readFile(file, id, parent) {
    let st;
    try { st = fs.statSync(file); } catch { return 0; }
    const had = this.files[file];
    const tokOk = !this.tok || (had?.tok && had.tok.sig === this.tok.sig);
    if (had && had.size === st.size && had.mtime === st.mtimeMs && tokOk) return 0;
    const fresh = !(had && st.size >= had.size);
    const rec = fresh ? { offset: 0, t: emptyThread(id, this.settings.openedAt) } : had;
    rec.parent = parent;
    let also = null;
    if (this.tok) {
      if (fresh || !rec.tok || rec.tok.sig !== this.tok.sig) {
        rec.tok = { sig: this.tok.sig, offset: 0, ...newTally(this.tok.hint(file)) };
        this.tokSeen.set(file, new Set());
      }
      // The reply ids already counted are kept while the app runs, not in the cache (it would grow with every reply).
      if (!this.tokSeen.has(file)) this.tokSeen.set(file, new Set());
      const { match } = this.tok, tok = rec.tok, seen = this.tokSeen.get(file);
      also = { from: tok.offset, fn: (o) => tallyLine(tok, o, match, seen) };
    } else delete rec.tok;
    rec.offset = readFrom(file, rec.t, rec.offset, also);
    if (rec.tok) rec.tok.offset = rec.offset;
    rec.size = st.size;
    rec.mtime = st.mtimeMs;
    if (!parent && !rec.t.title) {
      const ct = readJson(path.join(path.dirname(file), id, 'custom-title.json'), null);
      if (ct?.customTitle) rec.t.title = String(ct.customTitle);
    }
    this.files[file] = rec;
    return 1;
  }

  /**
   * The projects folder: the setting; else the working folder (Settings › Folders) most threads started in or under
   * (the first one when no thread has started yet); else the folder most threads started in, or, when threads start
   * inside each project's own folder (siblings), the folder those sit in. Taking one project's folder as the root
   * would make every other project's threads Consultants.
   */
  root() {
    if (this.settings.root) return this.settings.root;
    const starts = [];
    for (const r of Object.values(this.files)) if (!r.parent && r.t.startCwd) starts.push(r.t.startCwd);
    const under = (p, dir) => { const n = normPath(p), d = normPath(dir); return !!d && (n === d || n.startsWith(`${d}/`)); };
    const wfs = (() => { try { return (this.workingFolders() || []).filter((w) => typeof w === 'string' && w.trim()); } catch { return []; } })();
    if (wfs.length) {
      const ranked = wfs.map((w, i) => ({ w, i, n: starts.filter((s) => under(s, w)).length })).sort((a, b) => b.n - a.n || a.i - b.i);
      if (ranked[0].n || !starts.length) return ranked[0].w;
    }
    const count = new Map();
    for (const s of starts) {
      const k = normPath(s);
      const c = count.get(k) || { path: s, n: 0 };
      c.n++;
      count.set(k, c);
    }
    const best = [...count.values()].sort((a, b) => b.n - a.n)[0];
    if (!best) return '';
    // Start folders grouped by the folder they sit in: two or more siblings holding more threads than the top one.
    const parents = new Map();
    for (const c of count.values()) {
      const parent = path.dirname(c.path);
      if (!parent || normPath(parent) === normPath(c.path) || /^[a-z]:[\\/]?$/i.test(parent) || parent === '/') continue;
      const k = normPath(parent);
      const g = parents.get(k) || { path: parent, kids: 0, n: 0 };
      g.kids++;
      g.n += c.n;
      parents.set(k, g);
    }
    const group = [...parents.values()].filter((g) => g.kids >= 2).sort((a, b) => b.n - a.n)[0];
    return group && group.n > best.n ? group.path : best.path;
  }

  /** The folders in the projects folder, as they are spelt on disk. */
  folderNames(root) {
    try { return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  }

  /** Remembers a hook event (advanced setup) for a thread. */
  hook(id, kind, words = '') {
    if (!id || !safeKey(id)) return;
    this.hooks[id] = { kind, words, at: this.now() };
  }

  setNickname(folder, seat, nick) {
    const f = String(folder ?? '');
    if (!safeKey(f)) return false;
    const s = String(Math.max(1, Math.floor(Number(seat) || 1)));
    const name = String(nick || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    this.seatNames[f] = this.seatNames[f] || {};
    if (name) this.seatNames[f][s] = { ...(this.seatNames[f][s] || {}), nick: name };
    else if (this.seatNames[f][s]) delete this.seatNames[f][s].nick;
    writeJson(this.file('seats.json'), this.seatNames);
    return true;
  }

  /**
   * Favourites. A person (a seat) or a whole project can be a favourite: a favourite who goes home stays at the office
   * on a beach towel, and is listed in the Favourites tab. `hidden` takes an old favourite off that tab and the beach
   * (the star is kept). The project stars are kept in the office's settings, the seat ones beside the nickname.
   */
  setFavourite(folder, seat, on) {
    const f = String(folder ?? '');
    if (!safeKey(f)) return false;
    const s = String(Math.max(1, Math.floor(Number(seat) || 1)));
    this.seatNames[f] = this.seatNames[f] || {};
    const rec = { ...(this.seatNames[f][s] || {}) };
    if (on) rec.fav = true;
    else delete rec.fav;
    delete rec.favHidden;
    this.seatNames[f][s] = rec;
    writeJson(this.file('seats.json'), this.seatNames);
    return true;
  }
  setFavouriteProject(folder, on) {
    const f = String(folder ?? '');
    const list = new Set(Array.isArray(this.settings.favProjects) ? this.settings.favProjects.map(String) : []);
    if (on) list.add(f);
    else list.delete(f);
    this.settings.favProjects = [...list].sort();
    this.saveSettings();
  }
  setFavouriteHidden(folder, seat, hidden) {
    const f = String(folder ?? '');
    if (!safeKey(f)) return false;
    const s = String(Math.max(1, Math.floor(Number(seat) || 1)));
    this.seatNames[f] = this.seatNames[f] || {};
    const rec = { ...(this.seatNames[f][s] || {}) };
    if (hidden) rec.favHidden = true;
    else delete rec.favHidden;
    this.seatNames[f][s] = rec;
    writeJson(this.file('seats.json'), this.seatNames);
    return true;
  }

  /** A seat's look (EDIT on the card): a checked look, or null for the made-up one again. Answers false if refused. */
  setLook(folder, seat, look) {
    const f = String(folder ?? '');
    if (!safeKey(f)) return false;
    const s = String(Math.max(1, Math.floor(Number(seat) || 1)));
    this.seatNames[f] = this.seatNames[f] || {};
    const rec = { ...(this.seatNames[f][s] || {}) };
    if (look === null) delete rec.look;
    else {
      const clean = cleanLook(look);
      if (!clean) return false;
      rec.look = clean;
    }
    this.seatNames[f][s] = rec;
    writeJson(this.file('seats.json'), this.seatNames);
    return true;
  }

  /**
   * When a thread last needed you: its newest transcript line, or a newer hook event (advanced setup: a permission
   * prompt leaves no line in the transcript). "Answered" is kept against this, so a later need shows again.
   */
  needKey(id, lastAt) {
    const h = this.hooks[id];
    const t = Date.parse(lastAt) || 0;
    return h && h.at > t ? `hook:${h.at}` : lastAt || '';
  }

  /** Takes a thread off the Needs attention list until it needs you again (a new reply, or a new hook event). */
  markDone(id) {
    if (!safeKey(id) || !Object.hasOwn(this.ledger.threads, id)) return false;
    const rec = this.ledger.threads[id];
    this.done[id] = this.needKey(id, rec.lastAt);
    writeJson(this.file('done.json'), this.done);
    return true;
  }

  /** Saves the ledger and the read positions, if anything changed. */
  save() {
    if (!this.dirty) return;
    writeJson(this.file('ledger.json'), this.ledger);
    writeJson(this.file('cache.json'), { version: CACHE_VERSION, since: this.settings.openedAt, files: this.files });
    this.dirty = false;
  }

  /** Everyone, every project, and who is waiting: what the page draws. */
  snapshot({ preview = false } = {}) {
    // A preview (while the first read is still going) works on a copy: nothing half-read is kept as a seat or a total.
    const ledger = preview ? structuredClone(this.ledger) : this.ledger;
    const now = this.now();
    this.appLinks.refresh();
    const quietMs = this.settings.quietMinutes * 60 * 1000;
    const root = this.root();
    const names = this.folderNames(root);
    const today = localDay(new Date(now).toISOString());
    const helpersOf = {};
    const mains = [];
    for (const r of Object.values(this.files)) {
      if (r.parent) (helpersOf[r.parent] = helpersOf[r.parent] || []).push(r.t);
      else mains.push(r.t);
    }
    const live = {};
    for (const t of mains) {
      if (!t.startedAt) continue; // nothing said yet
      const helpers = helpersOf[t.id] || [];
      const counted = helpers.filter((h) => h.worked);
      const st = stateOf(t, now, quietMs, helpers, this.hooks[t.id]);
      const outByDay = { ...t.outByDay };
      for (const h of counted) for (const [d, n] of Object.entries(h.outByDay)) outByDay[d] = (outByDay[d] || 0) + n;
      live[t.id] = {
        id: t.id,
        folder: folderOf(t, root, names, helpers),
        title: t.title || firstLine(t.firstPrompt) || 'Untitled thread',
        startedAt: t.startedAt,
        lastAt: [t.lastAt, ...helpers.map((h) => h.lastAt)].sort().pop(),
        out: t.out + counted.reduce((a, h) => a + h.out, 0),
        outSince: t.outSince + counted.reduce((a, h) => a + h.outSince, 0),
        outByDay,
        asked: t.asked,
        snag: t.snag || null,
        event: t.event || null,
        steps: t.steps,
        msgs: t.msgs || [],
        helpers: helpers.length,
        ...st,
      };
    }
    // Seats: threads still on disk, plus those only the ledger remembers (deleted in the app: they keep their seat).
    const kept = {};
    for (const [id, r] of Object.entries(ledger.threads)) kept[id] = { folder: r.folder, seat: r.seat, lastAt: r.lastAt };
    const spans = Object.values(live).map((x) => ({ id: x.id, folder: x.folder, startedAt: x.startedAt, lastAt: x.lastAt, active: x.state !== 'home' }));
    for (const [id, r] of Object.entries(ledger.threads)) if (!live[id]) spans.push({ id, folder: r.folder, startedAt: r.startedAt, lastAt: r.lastAt, active: false });
    const seats = assignSeats(spans, kept, quietMs, now);
    for (const x of Object.values(live)) {
      const s = seats[x.id];
      const old = ledger.threads[x.id];
      const rec = { folder: s.folder, seat: s.seat, title: x.title, startedAt: x.startedAt, lastAt: x.lastAt, out: x.out, outSince: x.outSince, outByDay: x.outByDay, asked: x.asked };
      if (old && (old.folder !== rec.folder || old.seat !== rec.seat) && process.env.AHO_LOG !== '0') {
        if (!preview) console.log(`[seat] ${x.id.slice(0, 8)} "${x.title}" moved from ${old.folder || 'Consultants'} ${old.seat} to ${rec.folder || 'Consultants'} ${rec.seat}`);
      }
      if (!old || JSON.stringify(old) !== JSON.stringify(rec)) { ledger.threads[x.id] = rec; if (!preview) this.dirty = true; }
    }
    // People: one per seat that has ever had a thread or a nickname.
    const people = {};
    const person = (folder, seat) => {
      const key = `${folder}#${seat}`;
      if (!people[key]) {
        const kept = this.seatNames[folder]?.[seat] || {};
        const nick = kept.nick || '';
        const look = kept.look || null;
        // A favourite: the seat itself, or every seat of a favourite project.
        const favSeat = !!kept.fav;
        const favProject = favProjects.has(folder);
        people[key] = { key, folder, seat, name: nick || defaultName(folder, seat), nick, look, fav: favSeat || favProject, favSeat, favProject, favHidden: !!kept.favHidden, state: 'home', words: 'Gone home', since: 0, thread: null, recent: null, threads: 0, out: 0, outSince: 0, today: 0, lastAt: '' };
      }
      return people[key];
    };
    const favProjects = new Set(Array.isArray(this.settings.favProjects) ? this.settings.favProjects.map(String) : []);
    for (const [folder, bySeat] of Object.entries(this.seatNames)) for (const seat of Object.keys(bySeat)) if (bySeat[seat]?.nick || bySeat[seat]?.look || bySeat[seat]?.fav) person(folder, Number(seat));
    const rank = { working: 4, thinking: 3, needs: 2, idle: 1, home: 0 };
    for (const [id, r] of Object.entries(ledger.threads)) {
      const p = person(r.folder, r.seat);
      p.threads++;
      p.out += r.out || 0;
      p.outSince += r.outSince || 0;
      p.today += r.outByDay?.[today] || 0;
      if ((r.lastAt || '') > p.lastAt) p.lastAt = r.lastAt;
      // Their newest thread still on disk, working or not: its title and last messages for the card.
      const lx = live[id];
      if (lx && (!p.recent || (lx.lastAt || '') > (p.recent.lastAt || ''))) p.recent = { id, open: this.appLinks.open(id), title: lx.title, lastAt: lx.lastAt, msgs: lx.msgs };
      const x = live[id];
      if (!x || x.state === 'home') continue;
      const better = !p.thread || rank[x.state] > rank[p.state] || (rank[x.state] === rank[p.state] && x.lastAt > p.thread.lastAt);
      if (better) {
        p.state = x.state;
        p.words = x.words;
        p.since = x.since;
        p.snag = x.snag;
        p.event = x.event;
        p.thread = { id, open: this.appLinks.open(id), title: x.title, startedAt: x.startedAt, lastAt: x.lastAt, asked: x.asked, steps: x.steps, helpers: x.helpers, out: x.out };
      }
    }
    // Projects: every folder with a thread today or one still active.
    const projects = {};
    for (const p of Object.values(people)) {
      const today_ = (p.lastAt && localDay(p.lastAt) === today) || p.state !== 'home';
      if (!today_) continue;
      const pr = projects[p.folder] || (projects[p.folder] = { folder: p.folder, name: p.folder || 'Consultants', people: [], working: 0, thinking: 0, needs: 0, idle: 0, home: 0 });
      pr.people.push(p.key);
      pr[p.state]++;
    }
    // Needs attention: every thread whose last reply asked something, longest waiting first.
    const waiting = [];
    const cutoff = now - WAITING_DAYS * 24 * 3600 * 1000;
    for (const [id, r] of Object.entries(ledger.threads)) {
      const x = live[id];
      if (!x) continue; // deleted in the app: nothing to go back to
      const needsNow = x.state === 'needs';
      const goneWaiting = x.state === 'home' && !!x.asked;
      if (!needsNow && !goneWaiting) continue;
      const asked = x.asked || x.words;
      const lastMs = Date.parse(r.lastAt) || 0;
      if (lastMs < cutoff) continue;
      if (this.done[id] && this.done[id] === this.needKey(id, r.lastAt)) continue;
      const p = person(r.folder, r.seat);
      waiting.push({ id, person: p.key, name: p.name, folder: r.folder, title: r.title, asked, since: (needsNow && x.since) || lastMs, gone: goneWaiting });
    }
    waiting.sort((a, b) => a.since - b.since);
    let purse = 0;
    for (const r of Object.values(ledger.threads)) purse += r.outSince || 0;
    return {
      now,
      root,
      openedAt: this.settings.openedAt,
      quietMinutes: this.settings.quietMinutes,
      people: Object.values(people).sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || '')),
      projects: Object.values(projects).sort((a, b) => a.name.localeCompare(b.name)),
      favProjects: [...favProjects].sort(),
      waiting,
      earned: purse + this.bonus,
    };
  }
}

function firstLine(s) {
  return String(s || '').split('\n').map((x) => x.trim()).find(Boolean)?.slice(0, 120) || '';
}

export { projectOf };
