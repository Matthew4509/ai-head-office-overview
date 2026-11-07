// Small decisions the page makes, kept apart from the drawing so they can be tested in Node (test/pagelogic.test.js): the
// gone-home time a box may hold, which tab an arrow key goes to, how many rows of a pasted report-back would set
// findings aside, and the guard that lets only the newest answer to a repeated request be drawn. The same file runs on
// the page (window.pageLogic) and in Node.
'use strict';

(function (root, make) {
  const logic = make();
  if (typeof module === 'object' && module.exports) module.exports = logic;
  else root.pageLogic = logic;
})(typeof self !== 'undefined' ? self : this, () => {
  /** Staff go home after this many minutes with nothing happening: the same range the office accepts (5 minutes to 24 hours). */
  const QUIET_MIN = 5;
  const QUIET_MAX = 1440;

  /** What a typed gone-home time comes to: { ok: true, value } (a whole number of minutes in range), or { ok: false, message }. */
  function quietMinutes(raw, min = QUIET_MIN, max = QUIET_MAX) {
    const text = String(raw ?? '').trim();
    const n = Number(text);
    if (!text || !Number.isFinite(n)) return { ok: false, message: `"${text.slice(0, 20)}" is not a number of minutes. Type a number from ${min} to ${max}.` };
    const m = Math.round(n);
    if (m < min || m > max) return { ok: false, message: `${text.slice(0, 20)} minutes cannot be used: staff go home after ${min} minutes to 24 hours (${max} minutes).` };
    return { ok: true, value: m };
  }

  /** The tab an arrow key moves to in a row of `count` tabs: Left and Right wrap round, Home and End go to the ends.
   * -1 for any other key (nothing moves). */
  function nextTab(key, index, count) {
    if (!(count > 0)) return -1;
    if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
    if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return -1;
  }

  /** More than this many findings set aside by one pasted report-back are shown to the person first. */
  const JUDGE_CONFIRM_ABOVE = 10;

  /** How many findings a pasted report-back would set aside: the rows of its "False flags" table (or, with no such heading,
   * every table row) whose verdict is "false", "not a fault" or "duplicate of <id>", counting each place of a row that
   * names several ("a.php:3, b.php:9" is two). The same reading as the office's own, so the number is what it will do. */
  function judgeRows(text) {
    const t = String(text || '');
    const sec = /^#{1,4}[ \t]*(?:\d+\.?[ \t]+|\d*\.[ \t]*)?False flags.*$([\s\S]*?)(?=^#{1,4}\s|(?![\s\S]))/im.exec(t);
    const body = sec ? sec[1] : t;
    let n = 0;
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.startsWith('|') || /^\|[\s:|-]+\|?$/.test(line)) continue;
      const c = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim().replace(/^`+|`+$/g, ''));
      if (c.length < 4 || /^(rule|none)?$/i.test(c[0]) || /^none\b/i.test(c[0])) continue;
      const verdict = c[2];
      if (!(/duplicate(?:\s+of)?\s*:?\s*([A-Za-z]{1,6}-?\d{1,5})/i.test(verdict) || /^\W*(false|not a fault|not-a-fault)\b/i.test(verdict))) continue;
      n += c[1].split(/[,;]\s+(?=[^,;]*:\d+\b)/).map((s) => s.trim()).filter(Boolean).length;
    }
    return n;
  }

  /** A guard for a request that is repeated: begin() before asking, isLatest(token) when the answer comes. An answer to an
   * earlier ask that arrives after a newer one was started is not drawn, so a slow old answer never replaces a newer one. */
  function sequence() {
    let n = 0;
    return { begin: () => ++n, isLatest: (token) => token === n };
  }

  return { QUIET_MIN, QUIET_MAX, quietMinutes, nextTab, JUDGE_CONFIRM_ABOVE, judgeRows, sequence };
});
