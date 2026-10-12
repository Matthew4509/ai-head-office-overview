// The demo's made-up office: AI threads written as transcripts the office reads, so the demo shows staff at their
// desks (working, waiting with a question, finished, gone home, a Consultant across two projects, two at one desk).
// Every name, question and file here is made up. Times are set from `now`, so the demo looks the same each run.
'use strict';
const fs = require('fs');
const path = require('path');

const MIN = 60e3;
// [id, folder or '' (the working folder itself), nickname, title, kind, minutes ago, output tokens]
//   kind: working (a tool step just now) | needs (a finished reply that asks you something) | idle (a finished reply)
//         | home (quiet for hours) | consultant (work in two projects)
const THREADS = [
  ['demo-0001', 'nimbus-notes', 'Wren', 'Offline notes sync', 'working', 1, 1_850_000],
  ['demo-0002', 'harbour-lane-bakery', 'Otto', 'Opening hours page', 'needs', 6, 920_000],
  ['demo-0003', 'pixel-forge-studio', 'Juno', 'Portfolio gallery', 'working', 2, 2_400_000],
  ['demo-0004', 'lumen-analytics', 'Basil', 'Weekly report email', 'idle', 22, 640_000],
  ['demo-0005', 'peak-trail-fitness', 'Mira', 'Class timetable', 'home', 300, 1_200_000],
  ['demo-0006', 'tidewater-yoga', 'Theo', 'Booking form', 'working', 1, 780_000],
  ['demo-0007', 'tidewater-yoga', 'Ivy', 'Teacher profiles', 'needs', 12, 450_000],
  ['demo-0008', '', 'Sage', 'Audit every site', 'consultant', 3, 3_100_000],
];
const QUESTIONS = {
  'demo-0002': 'The bakery closes early on Sundays. Should the opening hours show on the home page too, or only on Contact?',
  'demo-0007': 'Two teachers share a photo. Shall I use initials for one of them until a new photo comes?',
};

function writeThreads(transcripts, ws, officeData, now = Date.now()) {
  const dir = path.join(transcripts, 'demo-workspace');
  fs.mkdirSync(dir, { recursive: true });
  const ts = m => new Date(now - m * MIN).toISOString();
  const seats = {};
  let n = 0;
  for (const [id, folder, nick, title, kind, ago, out] of THREADS) {
    const where = folder ? path.join(ws, folder) : ws;
    const lines = [];
    const user = (m, text) => lines.push({ type: 'user', timestamp: ts(m), cwd: ws, sessionId: id, message: { role: 'user', content: text } });
    const tool = (m, name, input, o, open = false) => {
      lines.push({ type: 'assistant', timestamp: ts(m), cwd: ws, sessionId: id, message: { id: 'msg-' + (++n), stop_reason: 'tool_use', usage: { input_tokens: 40, cache_read_input_tokens: 9000, output_tokens: o }, content: [{ type: 'tool_use', name, input }] } });
      if (!open) lines.push({ type: 'user', timestamp: ts(m - 0.05), cwd: ws, sessionId: id, message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }); // open: the step is still running
    };
    const reply = (m, text, o) => lines.push({ type: 'assistant', timestamp: ts(m), cwd: ws, sessionId: id, message: { id: 'msg-' + (++n), stop_reason: 'end_turn', usage: { input_tokens: 40, cache_read_input_tokens: 9000, output_tokens: o }, content: [{ type: 'text', text }] } });
    lines.push({ type: 'custom-title', customTitle: title, sessionId: id });
    user(ago + 40, 'Please work on: ' + title.toLowerCase() + '.');
    tool(ago + 30, 'Read', { file_path: path.join(where, 'README.md') }, Math.round(out * 0.1));
    if (kind === 'consultant') {
      tool(ago + 20, 'Edit', { file_path: path.join(ws, 'nimbus-notes', 'public', 'index.html') }, Math.round(out * 0.3));
      tool(ago, 'Edit', { file_path: path.join(ws, 'lumen-analytics', 'public', 'index.html') }, Math.round(out * 0.6), true);
    } else {
      tool(ago + 10, 'Edit', { file_path: path.join(where, 'public', 'index.html') }, Math.round(out * 0.5));
      if (kind === 'working') tool(ago, 'Bash', { command: 'npm test', description: 'Run the tests' }, Math.round(out * 0.4), true);
      else reply(ago, kind === 'needs' ? 'Done with the first part.\n\n' + QUESTIONS[id] : 'Done: the page is updated and the tests pass.', Math.round(out * 0.4));
    }
    fs.writeFileSync(path.join(dir, id + '.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    (seats[folder] = seats[folder] || {})[String(1 + Object.keys(seats[folder]).length)] = { nick };
  }
  // The office opened three days ago (so the threads' tokens are in the purse), with the staff's names on their seats.
  fs.mkdirSync(officeData, { recursive: true });
  fs.writeFileSync(path.join(officeData, 'settings.json'), JSON.stringify({ openedAt: new Date(now - 3 * 24 * 60 * MIN).toISOString(), quietMinutes: 60, root: ws }, null, 1));
  fs.writeFileSync(path.join(officeData, 'seats.json'), JSON.stringify(seats, null, 1));
}

module.exports = { writeThreads, THREADS };
