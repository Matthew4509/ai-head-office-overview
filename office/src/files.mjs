// The office's own data files (settings, seats, ledger, done, cache, purchases), read and written safely.
// A file that is there but cannot be read (cut short, edited by hand, held by another program) is copied aside first
// (<name>.damaged-<time>.json), so the next save cannot wipe what was in it: the ledger holds what was earned, the
// purchases what was bought. When even that copy cannot be made (the disk full, the folder read-only, the file held),
// the file is kept: no save writes over it for the rest of this run, and each save tries the copy again first
// (AHO-15, AHO-16).
import fs from 'node:fs';
import path from 'node:path';

const kept = new Set();
const keyOf = (file) => path.resolve(file).toLowerCase();
const damagedName = (file) => `${file.replace(/\.json$/i, '')}.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

/** Copies an unreadable file aside. Returns whether it is now safe to replace (copied, or not there at all). */
export function setAside(file) {
  try { fs.copyFileSync(file, damagedName(file)); kept.delete(keyOf(file)); return true; } catch (e) {
    if (e.code === 'ENOENT') { kept.delete(keyOf(file)); return true; }
    kept.add(keyOf(file));
    return false;
  }
}

/** A file's text; a virus scanner or editor holding it for a moment is waited out a few times. */
function readText(file) {
  for (let i = 0; ; i++) {
    try { return fs.readFileSync(file, 'utf8'); } catch (e) {
      if (!/^(EBUSY|EPERM|EACCES)$/.test(e.code) || i >= 9) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

/** Not there = `fallback`; there but unreadable = set aside (or kept), then `fallback`. */
export function readJson(file, fallback) {
  try { return JSON.parse(readText(file).replace(/^﻿/, '')); } catch (e) {
    if (e.code !== 'ENOENT') setAside(file);
    return fallback;
  }
}

/** Whether a save may write over this file now (false: it is kept, see above). */
export const isKept = (file) => kept.has(keyOf(file)) && !setAside(file);

/** Writes beside the file, then swaps it in, so a crash never leaves half a file. A kept file is not written over. */
export function writeJson(file, data, indent = 1) {
  if (isKept(file)) {
    const e = new Error(`${path.basename(file)} could not be read, and a safe copy of it could not be made, so it was not written over. Check the disk has room and nothing holds the file, then restart the office.`);
    e.code = 'EKEPT';
    throw e;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, indent));
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; }
}
