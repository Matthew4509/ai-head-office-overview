# Notes for agents (Claude and others) helping someone with AI Head Office Overview

AI Head Office Overview runs on the user's own PC (Windows). It reads Claude Code's transcripts
(`~/.claude/projects/**/*.jsonl`), draws each thread as a person in an office, and lists the user's projects with
their local copies, audits, git state and live sites. It sends nothing anywhere. These notes are for an agent asked to
install it, review it, update it from GitHub, or turn on **advanced setup** (hooks). Read the whole file before
changing anything.

Repository: https://github.com/Matthew4509/ai-head-office-overview (Windows, Node.js 22+, no npm packages).

## Ground rules for an agent
- Ask the user before each step that changes their PC: installing Node.js, cloning into a folder, shortcuts, Start
  with Windows, the start link, advanced setup. Say what will change first. Reading and testing need no permission.
- Never touch the office's `data` folder (the user's settings, audits, prompts, private details, the office's
  records) or `projects.json`. Both are git-ignored: a clone or pull never brings them and never changes them.
- Never send anything from `data`, the transcripts or `~/.claude/settings.json` anywhere, and never paste them into a
  report. Report what you checked, not the user's content.

## Install it (first time)
1. **Where:** ask the user for the folder their projects sit in (for example `C:\Users\<name>\projects`). The app
   lists the folders next to its own folder on its first start, so it belongs inside that folder.
2. **Node.js:** `node --version` must say v22 or newer. If not, ask, then `winget install --id OpenJS.NodeJS.LTS -e
   --source winget` (or point the user to https://nodejs.org). A new terminal is needed afterwards for the PATH.
3. **Get it:** from the projects folder,
   `git clone https://github.com/Matthew4509/ai-head-office-overview.git` (then work inside
   `ai-head-office-overview`). No git? `winget install --id Git.Git -e`, or download the repository's zip.
4. **Check it before running it** (see "Review it" below): at least `npm test` (about 6 minutes). Its data is made up
   and kept in temp folders; the setup test also uses a throwaway registry key (removed at the end) and briefly opens a
   minimised console window for its test copy (port 8881). Nothing of the user's is read or changed. A quicker look:
   `node tools/test-all.js office server` (about 2 minutes).
5. **Shortcuts (ask first):** `node tools/setup.js install --yes` sets up the start link, a desktop shortcut and
   Start with Windows for this Windows user only (no admin). Leave one out with `--no-desktop` or `--no-startup`.
   It never removes anything and never touches the user's data.
6. **Start it:** `cmd /c start "" start.cmd` (opens the app in its own Edge window; a minimised console window is the
   app itself), or `node server.js` in a terminal that stays open. Then `node server.js --status` must exit 0 and
   print that it is running; the page is http://127.0.0.1:8880/. The first start reads every transcript once (up to a
   minute); the page says "Loading" meanwhile, and shows a Welcome window the user answers.
7. Tell the user: Settings (the gear, top right) has Folders (add their projects folder if the list is empty), Setup (shortcuts,
   and advanced setup for hooks: see below), Update (a newer version from GitHub, taken in one click), Help and About
   (Quit, Uninstall).

## Update it (pull)
1. **See what is new before taking it:** in the app's folder,
   `git fetch origin` then `git log --oneline HEAD..origin/main` (the new commits) and
   `git diff --stat HEAD..origin/main` (the files they change). Read the diff of anything that runs on the user's PC
   (`lib/`, `office/`, `*.cmd`, `server.js`) and summarise it for the user before pulling.
2. **Stop it:** `node server.js --stop` (it also stops every local copy the app started).
3. **Take it:** `git pull --ff-only`. If git refuses because files were changed here, stop and tell the user: do not
   reset, stash or overwrite their changes without their word.
4. **Check and start:** `npm test`, then `cmd /c start "" start.cmd` and `node server.js --status`.
5. The user can also press **Update now** in Settings › Update: it does the same fast-forward, refuses when files here
   were changed or saved here, runs git with hooks off, and restarts the office. Prefer the steps above when asked to
   review an update first.
6. The version is in `lib/config.js` (`VERSION`) and Settings › About. The user's data stays as it was; a new version
   reads it as it is.

## Review it (what it does on this PC)
- **Listens** on 127.0.0.1 only (port 8880; 8881 tests, 8882 demo, 8883 test copy). Every API request needs the per-run
  key the page was served with; the one exception, `/api/office/hook`, takes only a JSON event. Code: `lib/routes/index.js`.
- **Reads:** `~/.claude/projects` (transcripts), `~/.codex/sessions` (token counts), the project folders in its
  working folders, and the Claude desktop app's thread records (the Open button). It never writes to any of them.
- **Writes:** its own `data` folder only; the AI app's `~/.claude/settings.json` only when the user turns advanced
  setup on or off (a copy is saved first; code: `office/src/setup.mjs`); shortcuts and the start link only through
  setup (`lib/setup.js`).
- **Runs:** a project's own start command from that project's `.claude/launch.json` or `project.json` (never text
  from the page; code: `lib/projects.js`, `lib/runner.js`), and only after the person has seen the whole command in a
  first-run window and said yes (asked again when the command changes; `trustCheck` in `lib/runner.js`); `git`
  read-only commands; and PowerShell helpers in `lib/platform/windows/`.
- **Sends:** nothing about the user. The only requests that leave the PC are plain GETs to the live addresses the user
  adds (`lib/live.js`, `lib/audit.js`) and, only if ticked under About, one request a day to GitHub for the newest Git
  version (`lib/git-program.js`), and, when the user opens Settings › Update, one `git fetch` of this repository
  (`lib/update.js`). To check: search the code for `fetch(`, `http.get`, `http.request`, `git fetch`.
- **Its own privacy check:** `node tools/disclose.js` scans the folder, its git history and any zip for private
  details, other project names, AI trail and local paths; it prints labels and places only. "Nothing found" is clean;
  a WARNING line and exit code 2 mean it had no private-details list or no project names to check against.
- A test copy that changes nothing: `node server.js --dry-run --port=8883` (reports windows, shortcuts and hooks
  instead of making them; reads no real transcripts). Stop it with `node server.js --stop --port=8883`.

## First, check the basics
1. Node.js 22 or newer: `node --version`.
2. The office runs: double-click `start.cmd` (or `install.cmd` the first time), or run `node server.js` from this
   folder. Then open http://127.0.0.1:8880/. The very first start reads every transcript once, which can take a minute;
   the page says "Loading" meanwhile.
3. `npm test` passes (no dependencies to install; it runs every test, a few minutes).

## Easy setup or advanced setup
- **Easy** (the default) needs nothing: the office reads the transcripts every 3 seconds.
  - Limit: "Needs you" is guessed from the last reply (a last line that ends with "?").
  - Limit: a permission prompt is not in the transcript at all.
- **Advanced** adds three hooks to Claude Code's user settings. Claude then tells the office at once when a thread
  gets a message, waits for permission, or finishes a reply.

## Turning on advanced setup: the preferred way
Ask the user to open the office, press **Settings** (the gear, top right), then **Setup**, then **Turn on advanced setup**. That button does
everything below safely:
- it saves a copy of the settings file first;
- it keeps every hook already there and adds only its own three;
- **Go back to easy setup** removes only those three.

Prefer this over editing the file yourself. The user presses it; do not press it for them without their word.

## Turning it on by hand (only if the button cannot be used)
The settings file is `~/.claude/settings.json` (Windows: `C:\Users\<name>\.claude\settings.json`).

1. **Ask the user first**, and say what will change: three entries added under `hooks`, nothing else touched.
2. **Back up the file** (copy it beside itself with a date in the name) and tell the user where the copy is.
3. **Read it as JSON.** If it is not valid JSON, stop and tell the user; do not "fix" it without asking.
4. **Add, never replace.** For each event, `UserPromptSubmit`, `Notification` and `Stop`, append one group to that
   event's array, creating the array if it is missing:

   ```json
   { "hooks": [ { "type": "command", "command": "node \"<full path to this folder>/office/hook.mjs\" 8880 --ai-head-office-hook", "timeout": 3 } ] }
   ```

   - Use the folder's full path with forward slashes, in double quotes (the path may contain spaces). Settings › Setup
     shows the exact line for this copy under "What advanced setup adds to the file".
   - `8880` is the office's port (change it only if the office runs on another port).
   - `--ai-head-office-hook` is the marker the office uses to find and remove its own entries. Keep it.
   - The user's existing groups (a sound on Stop, another app's hooks) must stay exactly as they were, in their place.
5. **Write the file back** as JSON (2-space indent) and read it again to check it parses.
6. **Test it** without waiting for a real event:

   ```bash
   echo '{"hook_event_name":"Notification","session_id":"<a thread id>","message":"Claude needs your permission to use Bash"}' | node office/hook.mjs 8880
   ```

   - It must print nothing and end with exit code 0.
   - With the office running, that thread's person shows "Needs you · Waiting for your permission" at once.
   - The thread id is a transcript's file name without `.jsonl`.
7. Threads that are **already open** pick up new hooks only when they next start. Say so.

## Undoing it
Use **Settings › Setup › Go back to easy setup**. By hand: remove every hook whose command contains
`--ai-head-office-hook` (and any group or event array left empty by that), and nothing else. Or restore the backup copy.

## What the hook does (so you can explain it)
`office/hook.mjs` reads the event Claude Code gives it and sends `{ event, session, message }` to
`http://127.0.0.1:<port>/api/office/hook`.
- It prints nothing, so it never adds to what Claude sees.
- It gives up in under a second and always exits 0, so Claude carries on as normal if the office is closed.
- It sends only to this PC.
- A "waiting for your input" notification counts as finished, not as "Needs you": it comes after every reply.

## "Open in Claude" (the button on a person's card)
- This needs no hooks. The Claude desktop app keeps a record per thread, `claude-code-sessions/<account>/<org>/local_<id>.json`.
  Its `cliSessionId` is the transcript id, and `claude://claude.ai/epitaxy/local_<id>` opens the thread in the app.
- On Windows the desktop app is a packaged app. Its files are in
  `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\`, and only programs started from inside Claude see them at
  `%APPDATA%\Claude\`. The office looks in both. If the button is missing, check both places.
- The app keeps records only for threads in its sidebar. Older, deleted, or command-line threads have no button.

## Do not
- Do not write to `~/.claude/projects` (the transcripts) or the Claude app's folders. The office only reads them.
- Do not change the user's existing hooks, permissions or other settings while adding these.
- Do not send transcript text, the settings file, or the office's `data/` folder anywhere. They hold the user's own work.
- Do not test advanced setup on the user's real settings file when a copy will do: run a test copy
  (`node server.js --dry-run --port=8883`), which writes nothing unless `AHO_SETTINGS` names a copy of the file, and
  point `AHO_DATA` at a scratch folder (see README, "For developers").
