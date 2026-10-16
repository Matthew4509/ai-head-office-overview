// Token counts per project, worked out line by line while the office reads a transcript, so the staff and the
// project list's token numbers come from one read. Each line moves "the project this thread is in" (its folder, or
// a folder a tool call names: the rules object's match decides) and every reply adds its tokens there: fresh input
// + cache write + cache read + output. A reply written over several lines is counted once, at its first line.

/** "YYYY-MM" in this PC's own calendar, not UTC: east of Greenwich the first hours of a month are still last month in
 * UTC. A stamp that cannot be read keeps its first seven characters. */
export const monthOf = (ts) => { const d = new Date(ts); return isNaN(d) ? String(ts).slice(0, 7) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** A fresh count for one transcript. `start`: the project its folder name points at, if any. */
export function newTally(start = null) {
  return { cur: start, per: {}, months: {} };
}

/**
 * Adds one parsed transcript line. `match(text)` answers a project id or null. `seen`: the reply ids of this file
 * counted so far (a thread that is rewound writes earlier replies again, far down the file; they count once).
 */
export function tallyLine(tok, o, match, seen) {
  if (!o || typeof o !== 'object') return;
  if (o.cwd) { const c = match(o.cwd); if (c) tok.cur = c; }
  const msg = o.message;
  if (!msg || !Array.isArray(msg.content)) return;
  for (const part of msg.content) {
    if (part && part.type === 'tool_use') { const c = match(JSON.stringify(part.input || {})); if (c) tok.cur = c; }
  }
  const u = msg.usage;
  if (o.type !== 'assistant' || !u || !tok.cur) return;
  if (msg.id) {
    if (seen.has(msg.id)) return;
    seen.add(msg.id);
  }
  const n = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  tok.per[tok.cur] = (tok.per[tok.cur] || 0) + n;
  if (o.timestamp) {
    const k = `${tok.cur}|${monthOf(o.timestamp)}`;
    tok.months[k] = (tok.months[k] || 0) + n;
  }
}
