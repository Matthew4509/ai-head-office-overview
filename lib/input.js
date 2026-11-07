// What arrives from the page, a data file or a project folder is cut to a safe shape once, here, and not again in each
// route: text with no hidden or control characters and a length, a whole number in a range, a word from a list.
// A wrong type is never turned into text with String() (an object would become "[object Object]"): it is empty, or null.
'use strict';

// Characters that draw nothing, or change the order things are drawn in, and the control characters. None belongs in a
// name, a note or a line of a prompt: a Windows folder can be named with them, and an AI that reads the line sees them
// when the person does not (the Unicode "tag" characters U+E0000-E007F spell hidden text). Left in on purpose: U+200D
// (zero width joiner) and U+FE0F (emoji form), which an emoji such as a family or a flag needs.
const HIDDEN = /[\u{0}-\u{1f}\u{7f}-\u{9f}\u{ad}\u{34f}\u{61c}\u{115f}\u{1160}\u{17b4}\u{17b5}\u{180b}-\u{180f}\u{200b}\u{200c}\u{200e}\u{200f}\u{2028}-\u{202e}\u{2060}-\u{206f}\u{3164}\u{fe00}-\u{fe0e}\u{feff}\u{ffa0}\u{fff9}-\u{fffb}\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;
// With the u flag a surrogate that has no partner is matched alone; it cannot be written as UTF-8, so it becomes U+FFFD.
const LONE = /[\u{d800}-\u{dfff}]/gu;

const str = v => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
// Cut to `max` characters (code points: an emoji is not split in two).
const cut = (s, max) => (s.length <= max ? s : Array.from(s).slice(0, max).join(''));

/** One line: hidden and control characters, line breaks and runs of spaces become a single space; at most `max` characters. */
function oneLine(v, max = 200) {
  return cut(str(v).replace(LONE, '\u{fffd}').replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim(), max);
}
/** Text of several lines (a saved prompt, a pasted note): hidden characters go, line breaks and tabs stay. */
function clean(v) {
  return str(v).replace(LONE, '\u{fffd}').replace(HIDDEN, m => (m === '\n' || m === '\r' || m === '\t' ? m : ''));
}
/** A whole number from min to max: a number, or text of digits only. Anything else (1.5, "", NaN, "0x10", true, [8]) is null. */
function int(v, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d{1,15}$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
/** One of a list (compared as is, never as text), or null. */
const oneOf = (v, list) => (list.includes(v) ? v : null);
/** A plain object (not null, not a list), or null. */
const plain = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

module.exports = { oneLine, clean, int, oneOf, plain, HIDDEN };
