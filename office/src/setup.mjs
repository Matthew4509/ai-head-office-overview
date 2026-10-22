// Setup: easy (read the transcripts only, the default) or advanced (three small hooks in the AI app's own settings, so
// the app tells the office straight away when a thread gets a message, waits for you, or finishes). Advanced setup only
// adds its own entries beside whatever hooks are there already, saves a copy of the file first, and can be taken off
// again. Also the office's own settings: the projects folder and the gone-home time.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The hook events advanced setup adds, and what each tells the office. */
export const EVENTS = ['UserPromptSubmit', 'Notification', 'Stop'];
/** Every command this office writes contains this, so it can find (and remove) its own entries and no others. */
const MARK = 'ai-head-office-hook';

export function settingsFile() {
  return process.env.AHO_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
}

function readSettings(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { data: {}, text: '' };
    throw e;
  }
  try { return { data: JSON.parse(text || '{}'), text }; } catch {
    return { error: { fault: 'Claude\'s settings file could not be read.', reason: `${file} is not valid JSON, so the office will not touch it.`, wayOut: 'Fix the file (or let Claude fix it), then try again.' } };
  }
}

/** The command written into the AI app's settings for this office. The path sits in double quotes, which bash (Claude
 * Code runs hooks through Git Bash on Windows) still reads $ and backticks in, and cmd.exe reads % in: apply() refuses
 * a path holding one of those (or a ") before anything is written. */
export const UNSAFE_HOOK_PATH = /[$`"%\r\n]/;
export function hookCommand(hookScript, port) {
  return `node "${hookScript.replace(/\\/g, '/')}" ${port} --${MARK}`;
}

/** This office's own hook script: an entry that runs it is ours whatever mark it carries. */
export const OWN_HOOK = path.resolve(import.meta.dirname, '..', 'hook.mjs');
const slashes = (p) => String(p).replace(/\\/g, '/').toLowerCase();
/** Ours: this mark, or a hook that runs THIS office's hook.mjs (with a port and a --…-hook mark). Another app's hook
 * (its own hook.mjs, its own mark, such as AI Office Overview's) is never counted, changed or removed. */
const OLDER = /^node "([^"]+)" \d+ --[a-z-]+-hook$/;
const isOurs = (h, own = OWN_HOOK) => {
  if (typeof h?.command !== 'string') return false;
  if (h.command.includes(`--${MARK}`)) return true;
  const m = OLDER.exec(h.command);
  return !!m && slashes(m[1]) === slashes(own);
};

/** The AI app's settings without this office's entries (everything else exactly as it was). */
export function withoutOurs(data, own = OWN_HOOK) {
  const out = { ...data };
  if (!out.hooks || typeof out.hooks !== 'object') return out;
  const hooks = {};
  for (const [event, groups] of Object.entries(out.hooks)) {
    if (!Array.isArray(groups)) { hooks[event] = groups; continue; }
    const kept = groups.map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h, own)) } : g)).filter((g) => !Array.isArray(g?.hooks) || g.hooks.length);
    if (kept.length) hooks[event] = kept;
  }
  if (Object.keys(hooks).length) out.hooks = hooks;
  else delete out.hooks;
  return out;
}

/** The AI app's settings with this office's entries added (its old ones replaced, nobody else's touched). */
export function withOurs(data, command, own = OWN_HOOK) {
  const out = withoutOurs(data, own);
  out.hooks = { ...(out.hooks || {}) };
  for (const event of EVENTS) {
    const groups = Array.isArray(out.hooks[event]) ? out.hooks[event] : [];
    out.hooks[event] = [...groups, { hooks: [{ type: 'command', command, timeout: 3 }] }];
  }
  return out;
}

/** Whether advanced setup is on, from the AI app's settings file. */
export function status(office) {
  const file = settingsFile();
  const r = readSettings(file);
  const on = !r.error && Object.values(r.data.hooks || {}).some((groups) => Array.isArray(groups) && groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => isOurs(h))));
  return {
    mode: on ? 'advanced' : 'easy',
    settingsFile: file,
    readable: !r.error,
    lastHookAt: office.lastHookAt || 0,
    root: office.root(),
    rootSet: !!office.settings.root,
    quietMinutes: office.settings.quietMinutes,
    theme: THEMES.includes(office.settings.theme) ? office.settings.theme : '',
  };
}

/** The page's colours: auto (light from sunrise to sunset), dark, light, or "system" (follows Windows). */
const THEMES = ['auto', 'dark', 'light', 'system'];

/** Turns advanced setup on or off: { advanced: true | false }. A copy of the settings file is kept first. */
export function apply(office, b, { port, hookScript }) {
  const file = settingsFile();
  const r = readSettings(file);
  if (r.error) return r;
  if (b.advanced && UNSAFE_HOOK_PATH.test(String(hookScript))) {
    return { error: { fault: 'Advanced setup cannot be turned on from this folder.', reason: `The office's folder (${path.dirname(path.dirname(String(hookScript)))}) has a $, backtick, " or % in its path, which Claude's hook runner would read as part of a command.`, wayOut: 'Move the office to a folder whose path has none of those characters, then try again. Easy setup still works.' } };
  }
  const next = b.advanced ? withOurs(r.data, hookCommand(hookScript, port), hookScript) : withoutOurs(r.data, hookScript);
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (text === r.text) return { ok: true, status: status(office), unchanged: true };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let backup = '';
    if (r.text) {
      backup = `${file}.before-ai-head-office-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      fs.writeFileSync(backup, r.text);
    }
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    return { ok: true, backup, status: status(office) };
  } catch (e) {
    return { error: { fault: 'Claude\'s settings could not be changed.', reason: String(e?.message || e), wayOut: 'Check the file is not open elsewhere and that this user can write to it, then try again. Easy setup still works.' } };
  }
}

/** A hook event from hook.mjs: what it says about the thread. */
export function onHook(office, b) {
  const id = String(b.session || '').replace(/[^\w-]/g, '').slice(0, 80);
  if (!id) return;
  office.lastHookAt = office.now();
  const event = String(b.event || '');
  if (event === 'UserPromptSubmit') office.hook(id, 'working', 'Reading your message');
  else if (event === 'Stop') office.hook(id, 'done');
  // A permission prompt needs you. "Waiting for your input" comes a minute after every finished reply, asked or not:
  // the reply itself says whether it asked something, so it counts as finished.
  else if (event === 'Notification') office.hook(id, /permission/i.test(b.message) ? 'needs' : 'done', /permission/i.test(b.message) ? 'Waiting for your permission' : '');
}

/** The office's own settings: { root, quietMinutes, theme }. */
export function settings(office, b) {
  if (b.theme !== undefined) {
    if (!THEMES.includes(b.theme)) return { error: { fault: 'That theme is not one the office has.', reason: `It knows ${THEMES.join(', ')}.`, wayOut: 'Pick Auto, Dark, Light or Match Windows in Settings › Office.' } };
    office.settings.theme = b.theme;
  }
  if (b.root !== undefined) {
    const root = String(b.root || '').trim();
    if (root) {
      let ok = false;
      try { ok = fs.statSync(root).isDirectory(); } catch { ok = false; }
      if (!ok) return { error: { fault: 'That projects folder was not found.', reason: `${root} is not a folder on this PC.`, wayOut: 'Paste the full path of the folder your project folders sit in.' } };
      office.settings.root = root;
    } else delete office.settings.root;
  }
  if (b.quietMinutes !== undefined) {
    const m = Math.round(Number(b.quietMinutes));
    if (!(m >= 5 && m <= 1440)) return { error: { fault: 'That gone-home time cannot be used.', reason: 'It must be between 5 minutes and 24 hours (1440 minutes).', wayOut: 'Type a number of minutes from 5 to 1440.' } };
    office.settings.quietMinutes = m;
  }
  office.saveSettings();
  office.dirty = true;
  return { ok: true, status: status(office) };
}
