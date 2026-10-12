// The office inside the engine: its transcript reader (office/src, ES modules loaded as they are), its API under
// /api/office/*, and the one transcript pass that feeds both the office's staff and the token counts per project.
// The office keeps its own files in <data>/office. A demo and a test copy read <data>/transcripts (made-up threads, or
// none), never the real ones, unless AHO_TRANSCRIPTS names a folder.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const cfg = require('./config');
const { send, readBody } = require('./http');
const tokens = require('./tokens');
const { keyOf } = require('./projects');

const DATA = path.join(cfg.DATA, 'office');
const HOOK_SCRIPT = path.join(cfg.HERE, 'office', 'hook.mjs');
const TRANSCRIPTS = process.env.AHO_TRANSCRIPTS || (cfg.DEMO || cfg.DRY ? path.join(cfg.DATA, 'transcripts') : '');
// The desktop app's own thread records (the Open button on a card): a demo or test copy never reads the real ones.
if ((cfg.DEMO || cfg.DRY) && !process.env.AHO_APP_SESSIONS) process.env.AHO_APP_SESSIONS = path.join(cfg.DATA, 'app-sessions');
const SCAN_MS = 3000;
const BATCH = 10;

let mods = null; // { Office, shopOf, buy, setup }
let office = null;
let loading = null; // while the first read runs: { done, total, first }; null once every transcript is read
let lastScanError = '';
let tokenProjects = null; // the project list the token counts are split by: { sig, list }
const waiters = []; // refreshTokens calls waiting for the next count

const load = file => import(pathToFileURL(path.join(cfg.HERE, 'office', 'src', file)).href);

// The project list the token counts are split by. A new list makes the next read count every transcript again
// (only the token part; the office's own summaries carry on from where they were).
function setTokenProjects(projects) {
  const list = projects.map(p => ({ id: p.id, dir: p.dir })).filter(p => p.dir);
  const sig = crypto.createHash('sha1').update(list.map(p => p.id + '=' + p.dir).sort().join('|')).digest('hex').slice(0, 16);
  if (tokenProjects && tokenProjects.sig === sig) return;
  tokenProjects = { sig, list };
  if (office) office.setTokens(tokenRules());
}
function tokenRules() {
  if (!tokenProjects) return null;
  const match = tokens.makeMatcher(tokenProjects.list);
  const root = office.transcriptsDir;
  return { sig: tokenProjects.sig, match, hint: file => tokens.hintFromDirName(path.relative(root, file).split(path.sep)[0], tokenProjects.list) };
}

// Token counts per project: the office's pass over the AI app's transcripts, plus Codex sessions (read here, cached).
// Answers once the counts are complete: after the first read, or the next read when the project list changed.
function tokenTotals() {
  return new Promise(resolve => { waiters.push(resolve); if (office && !loading) tick(); });
}
function answerWaiters() {
  if (!waiters.length || !office || loading) return;
  const t = office.tokenTotals();
  if (!t) return;
  let codex = { total: {}, month: {} };
  try { codex = tokens.codexTotals(tokenProjects ? tokenProjects.list : []); } catch {}
  for (const k in codex.total) t.total[k] = (t.total[k] || 0) + codex.total[k];
  for (const k in codex.month) t.month[k] = (t.month[k] || 0) + codex.month[k];
  for (const w of waiters.splice(0)) w(t);
}

function tick() {
  if (loading || !office) return;
  try {
    office.scan();
    office.snapshot(); // keeps the ledger up to date even when no page is open
    office.save();
    lastScanError = '';
  } catch (e) {
    lastScanError = String((e && e.message) || e);
    console.error('[office scan]', e);
  }
  answerWaiters();
}

// The page opens at once; transcripts are read in batches behind it, newest first, so today's threads show within
// seconds while older history fills in. Until the first read is done the page shows a preview and nothing half-read
// is kept.
async function firstRead() {
  const list = office.listFiles();
  const first = !fs.existsSync(path.join(DATA, 'cache.json'));
  loading = { done: 0, total: list.length, first };
  const t0 = Date.now();
  if (first && list.length) console.log('Reading your AI threads for the first time (' + list.length + ' transcripts, newest first). This can take a minute; the office shows people as they are read.');
  for (let i = 0; i < list.length; i += BATCH) {
    try { office.readSome(list.slice(i, i + BATCH)); } catch (e) { lastScanError = String((e && e.message) || e); console.error('[office read]', e); }
    loading.done = Math.min(list.length, i + BATCH);
    if (loading.done % 100 === 0) { try { office.save(); } catch {} } // a window closed half way starts from there
    await new Promise(r => setImmediate(r)); // lets requests in between batches
  }
  loading = null;
  module.exports.firstReadMs = Date.now() - t0;
  tick(); // the first full count: seats, the ledger, what was deleted since last time, and the token counts
  if (list.length) console.log('The office has read every transcript (' + list.length + ' in ' + (module.exports.firstReadMs / 1000).toFixed(1) + ' s).');
  setInterval(tick, SCAN_MS).unref();
}

async function start() {
  const [o, shop, setup] = await Promise.all([load('office.mjs'), load('shop.mjs'), load('setup.mjs')]);
  mods = { Office: o.Office, shopOf: shop.shopOf, buy: shop.buy, setup };
  if (TRANSCRIPTS) fs.mkdirSync(TRANSCRIPTS, { recursive: true });
  office = new mods.Office({ dataDir: DATA, transcriptsDir: TRANSCRIPTS || undefined });
  office.setTokens(tokenRules());
  firstRead().catch(e => { loading = null; lastScanError = String((e && e.message) || e); console.error('[office]', e); });
}

const fail = (res, code, fault, reason, wayOut) => send(res, code, { error: { fault, reason, wayOut } });

// Which project on the list each desk belongs to: a desk is a folder in the office's projects folder, so it is the
// project whose folder sits there under that name. { folder: project id }
function linksFor(root) {
  const links = {};
  if (!root) return links;
  const { state } = require('./state');
  for (const p of state.projects) if (p.dir && keyOf(path.dirname(p.dir)) === keyOf(root)) links[path.basename(p.dir)] = p.id;
  return links;
}

// What the setup step shows: the office's own status, plus the exact hook line for this copy.
function setupStatus() {
  return { ...mods.setup.status(office), hookCommand: mods.setup.hookCommand(HOOK_SCRIPT, cfg.PORT) };
}

// /api/office/<name>. The page's key was checked already, except for hook (see routes/index.js).
async function handle(req, res, name) {
  if (!office) return fail(res, 503, 'The office is still opening.', 'Its reader is being loaded.', 'Wait a moment; the page tries again by itself.');
  if (req.method === 'GET' && name === 'state') {
    const s = office.snapshot({ preview: !!loading });
    return send(res, 200, { ...s, loading, shop: mods.shopOf(office, s.earned), scanError: lastScanError, setup: setupStatus(), links: linksFor(s.root) });
  }
  if (req.method !== 'POST') return fail(res, 405, 'That cannot be done here.', 'The office does not take that kind of request.', 'Use the office page.');
  const b = await readBody(req, 16384);
  switch (name) {
    case 'nickname':
      office.setNickname(b.folder ?? '', b.seat, b.nick);
      return send(res, 200, { ok: true });
    case 'favourite':
      // A star on a person ({ folder, seat, on }) or a whole project ({ folder, project: true, on }); or an old
      // favourite hidden from the Favourites tab and the beach ({ folder, seat, hidden }).
      if (typeof b.hidden === 'boolean') office.setFavouriteHidden(b.folder ?? '', b.seat, b.hidden);
      else if (b.project === true) office.setFavouriteProject(b.folder ?? '', !!b.on);
      else office.setFavourite(b.folder ?? '', b.seat, !!b.on);
      return send(res, 200, { ok: true });
    case 'edit':
      // EDIT on a card: the seat's nickname and look together. look: an object, or null for the made-up look again.
      if (b.look !== undefined && !office.setLook(b.folder ?? '', b.seat, b.look)) return fail(res, 400, 'That look could not be kept.', 'One of its parts is not one the office knows.', 'Pick the parts again in the editor, then save.');
      if (b.nick !== undefined) office.setNickname(b.folder ?? '', b.seat, b.nick);
      return send(res, 200, { ok: true });
    case 'done':
      if (!office.markDone(String(b.id || ''))) return fail(res, 404, 'That thread could not be taken off the list.', 'The office has no record of it.', 'Refresh the page and try again.');
      return send(res, 200, { ok: true });
    case 'buy': {
      if (loading) return send(res, 409, { error: { fault: 'The shop opens once every transcript is read.', reason: 'The office has read ' + loading.done + ' of ' + loading.total + ' so far, so the purse is not counted yet.', wayOut: 'Try again in a moment.' } });
      const r = mods.buy(office, String(b.item || ''));
      return send(res, r.error ? 409 : 200, r.error ? { error: r.error } : r);
    }
    case 'hook':
      mods.setup.onHook(office, b);
      return send(res, 200, { ok: true });
    case 'setup': {
      // A test copy never writes the real AI app settings: only a throwaway file named in AHO_SETTINGS.
      if (cfg.DRY && !process.env.AHO_SETTINGS) return send(res, 200, { ok: true, dryRun: 'advanced setup ' + (b.advanced ? 'on' : 'off'), status: setupStatus() });
      if (cfg.DEMO) return send(res, 200, { ok: true, dryRun: 'demo, nothing changed', status: setupStatus() });
      const r = mods.setup.apply(office, b, { port: cfg.PORT, hookScript: HOOK_SCRIPT });
      return send(res, r.error ? 409 : 200, r.error ? { error: r.error } : { ...r, status: setupStatus() });
    }
    case 'settings': {
      const r = mods.setup.settings(office, b);
      return send(res, r.error ? 400 : 200, r.error ? { error: r.error } : { ...r, status: setupStatus() });
    }
  }
  return fail(res, 404, 'Nothing here.', 'That address is not part of the office.', 'Use the office page.');
}

module.exports = { start, handle, setTokenProjects, tokenTotals, isLoading: () => !!loading, firstReadMs: 0 };
