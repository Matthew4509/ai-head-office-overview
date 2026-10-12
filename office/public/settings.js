// Settings: one window for everything that is not the office itself. Folders (working folders, projects added one by
// one, projects taken off the list), Setup (the start link, desktop shortcut and Start with Windows; advanced setup,
// the AI app's hooks, as its last step), Office (projects folder, gone-home time, live checks), Private details, Help
// and About (version, the Git program, Quit, Uninstall). Opened by Settings at the top. The welcome on the first start
// is here too.
'use strict';

(() => {
  const app = window.aiOffice;
  const { el } = app;
  const sheet = document.getElementById('setup');
  const SECTIONS = [['folders', 'Folders'], ['setup', 'Setup'], ['office', 'Office'], ['private', 'Private details'], ['help', 'Help'], ['about', 'About']];
  let section = 'folders';
  const said = el('p', { class: 'note check-said', role: 'status', 'aria-live': 'polite' });
  const say = (t) => { said.textContent = t; };
  const fault = (e) => { const f = e?.error || {}; return f.fault ? `${f.fault} ${f.reason || ''} ${f.wayOut || ''}`.trim() : 'The office did not answer. Check that AI Head Office Overview is still running.'; };
  const btn = (label, onclick, primary = false, extra = {}) => el('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, onclick, ...extra }, label);
  const row = (title, sub, ...acts) => el('div', { class: 'set-row' }, el('div', { class: 'set-txt' }, el('b', { text: title }), sub ? el('span', { class: 'note', text: sub }) : null), el('div', { class: 'row set-acts' }, ...acts));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  async function show(which) {
    if (which) section = which;
    const tabs = el('div', { class: 'side-tabs', role: 'tablist', 'aria-label': 'Settings' }, SECTIONS.map(([id, name]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(section === id), onclick: () => { say(''); show(id); } }, name)));
    const body = el('div', { class: 'set-body' }, el('p', { class: 'note', text: 'Reading…' }));
    const box = el('div', { class: 'sheet-box wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'setup-title' },
      el('h2', { id: 'setup-title', text: 'Settings' }), tabs, said, body,
      el('div', { class: 'row sheet-foot' }, btn('Close', close, true)));
    sheet.replaceChildren(box);
    sheet.hidden = false;
    try { body.replaceChildren(...[await DRAW[section]()].flat().filter(Boolean)); } catch (e) { body.replaceChildren(el('p', { text: fault(e) })); }
  }
  function close() { sheet.hidden = true; sheet.replaceChildren(); }
  app.openSettings = show;

  // ---- Folders ----
  async function folderPicker(purpose, okLabel, submit) {
    const input = el('input', { type: 'text', class: 'field-text', placeholder: 'C:\\Users\\you\\projects', 'aria-label': 'Folder path', spellcheck: 'false' });
    const go = async () => {
      if (!input.value.trim()) { say('Choose a folder with Browse, or type its path.'); return input.focus(); }
      try { await submit(input.value.trim()); } catch (e) { say(fault(e)); }
    };
    return el('div', { class: 'row' }, input,
      btn('Browse…', async () => { try { const r = await app.engine('/api/pick-folder', { purpose }); if (r.path) input.value = r.path; else if (r.dryRun) say(`Test copy: ${r.dryRun} (type a path instead).`); else if (r.error) say(r.error); } catch (e) { say(fault(e)); } }),
      btn(okLabel, go, true));
  }
  async function drawFolders() {
    const f = await app.engine('/api/settings');
    const after = async (words) => { say(words); await app.loadProjects(); show('folders'); };
    return [
      el('h3', { text: 'Working folders' }),
      el('p', { class: 'note', text: 'Every folder inside a working folder is a project.' }),
      ...f.workingFolders.map((w) => row(w.path, w.exists ? plural(w.projects, 'project', 'projects') : 'Not found: the folder was moved or deleted',
        btn('Open', async () => { try { const r = await app.engine('/api/folders/open', { path: w.path }); if (r.dryRun) say(`Test copy, not opened: ${r.dryRun}`); } catch (e) { say(fault(e)); } }),
        btn('Remove', async () => { if (!confirm(`Take ${w.path} off the working folders? Its projects leave the list; the folder and its files are not touched.`)) return; try { await app.engine('/api/folders/remove', { path: w.path }); after('Working folder removed. Its files were not touched.'); } catch (e) { say(fault(e)); } }))),
      await folderPicker('working', 'Add working folder', async (p) => { const r = await app.engine('/api/folders/add', { path: p }); after(`Added ${r.path}: ${plural(r.projects, 'project', 'projects')} found.`); }),
      el('div', { class: 'row' }, btn('Scan folders', async () => {
        try { const r = await app.engine('/api/scan', {}); after(`Scan finished: ${plural(r.total, 'project', 'projects')}.${r.added.length ? ` New: ${r.added.join(', ')}.` : ''}${r.gone.length ? ` Gone: ${r.gone.join(', ')}.` : ''}${!r.added.length && !r.gone.length ? ' Nothing new since the last scan.' : ''}`); } catch (e) { say(fault(e)); }
      }), el('span', { class: 'note', text: f.lastScan ? `Last scan ${new Date(f.lastScan).toLocaleString()}` : '' })),
      el('h3', { text: 'Projects added one by one' }),
      el('p', { class: 'note', text: 'For a project kept outside your working folders. The office only reads the folder; it never changes its files.' }),
      ...f.extraProjects.map((x) => row(x.name, x.exists ? x.path : `${x.path} (not found)`, btn('Remove', async () => {
        const p = app.engineData.projects.find((r) => r.dir.toLowerCase() === x.path.toLowerCase());
        try { if (p) await app.engine('/api/projects/remove', { id: p.id }); else await app.engine('/api/projects/forget', { path: x.path }); after(`${x.name} is off the list. Its files were not touched.`); } catch (e) { say(fault(e)); }
      }))),
      await folderPicker('project', 'Add project', async (p) => { const r = await app.engine('/api/projects/add', { path: p }); after(`${r.name} added to the list.`); }),
      el('h3', { text: 'Taken off the list' }),
      f.hidden.length ? f.hidden.map((x) => row(x.name, x.path + (x.exists ? '' : ' (not found)'), btn('Show again', async () => { try { await app.engine('/api/projects/show', { path: x.path }); after(`${x.name} is back on the list.`); } catch (e) { say(fault(e)); } })))
        : el('p', { class: 'note', text: 'Nothing. A project taken off the list (Remove, on its tile) shows here, to bring back.' }),
    ];
  }

  // ---- Setup: the start link, the desktop shortcut, Start with Windows; then advanced setup (hooks) ----
  const ITEMS = [['link', 'Start link', 'The office\'s launcher page (index.html) starts the office with it (ai-head-office://start). start.cmd sets it up each time it starts.'],
    ['desktop', 'Desktop shortcut', 'Double-click it to open the office.'], ['startup', 'Start with Windows', 'Starts the office quietly when you sign in.']];
  async function drawSetup() {
    const s = await app.engine('/api/setup');
    const isOn = (k) => !!(s[k] && s[k].exists && (k !== 'link' || s.link.here !== false));
    const ticks = ITEMS.map(([k, name, note]) => el('label', { class: 'tick-row' }, el('input', { type: 'checkbox', 'data-k': k, checked: isOn(k) }), el('span', {}, el('b', { text: name }), el('br'), el('span', { class: 'note', text: note }))));
    const st = app.data?.setup || {};
    const advanced = st.mode === 'advanced';
    const heard = st.lastHookAt ? `Last heard from the AI app ${new Date(st.lastHookAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : 'Nothing heard from the AI app yet since the office started.';
    return [
      el('h3', { text: 'Step 1: shortcuts and the start link' }),
      el('p', { class: 'note', text: `Node.js ${s.node.version}${s.node.ok ? '' : ` is too old (needs ${s.node.min} or newer): quit and run install.cmd, which can update it`}. Ticked = set up, unticked = taken away, for your Windows user only; your projects and settings are not touched.` }),
      ...ticks,
      el('div', { class: 'row' }, btn('Apply', async () => {
        const body = {};
        for (const t of ticks) { const i = t.querySelector('input'); if (i.checked !== isOn(i.dataset.k)) body[i.dataset.k] = i.checked; }
        if (!Object.keys(body).length) return say('Nothing to change: everything is already as ticked.');
        try {
          const r = await app.engine('/api/setup', body);
          const dry = r.results.filter((x) => x.dryRun).map((x) => x.dryRun);
          say(dry.length ? `Test copy, nothing changed: ${dry.join('; ')}.` : `Setup done: ${ITEMS.filter(([k]) => k in body).map(([k, n]) => `${n} ${body[k] ? 'on' : 'off'}`).join(', ')}.`);
          show('setup');
        } catch (e) { say(fault(e)); }
      }, true)),
      el('p', { class: 'note', text: `The office's folder: ${s.folder}. If you moved it, Apply points the shortcuts and the link at the new place.` }),
      el('h3', { text: 'Step 2 (advanced): hooks in the AI app' }),
      el('p', {}, el('b', { text: advanced ? 'Now: advanced setup is on.' : 'Now: easy setup.' }), ` ${heard}`),
      el('p', { text: 'Easy setup (the default) reads the AI app\'s transcripts on this PC every 3 seconds and changes nothing in the app. What it cannot do: "Needs you" is worked out from the last reply (one whose last lines ask a question), a permission prompt may not show at all, and what someone is doing can be up to 3 seconds behind.' }),
      el('p', { text: `Advanced setup also adds three small hooks to the AI app's settings file (${st.settingsFile || '~/.claude/settings.json'}): when a thread gets a message, waits for your permission, or finishes a reply, the app runs a small script that tells the office straight away. It sends only to this PC (127.0.0.1), prints nothing back, and gives up in under a second if the office is closed. Hooks you already have stay as they are, a copy of the file is saved first, and going back to easy setup takes out only this office's three.` }),
      el('div', { class: 'row' }, btn(advanced ? 'Go back to easy setup' : 'Turn on advanced setup', async (e) => {
        e.currentTarget.disabled = true;
        try {
          const r = await app.api('/api/setup', { advanced: !advanced });
          await app.refresh();
          say(r.dryRun ? `Test copy, nothing changed: ${r.dryRun}.` : r.unchanged ? 'Nothing needed changing.' : advanced
            ? `Advanced setup is off: the office's hooks were taken out, yours are as they were.${r.backup ? ` A copy of the file from before is at ${r.backup}.` : ''}`
            : `Advanced setup is on. Threads started from now on report straight away (a thread already open picks it up when it next starts).${r.backup ? ` A copy of the file from before is at ${r.backup}.` : ''}`);
          show('setup');
        } catch (err) { say(fault(err)); e.currentTarget.disabled = false; }
      }, !advanced)),
      el('details', {}, el('summary', { text: 'What advanced setup adds to the file' }),
        el('pre', { class: 'code', text: JSON.stringify({ hooks: Object.fromEntries(['UserPromptSubmit', 'Notification', 'Stop'].map((ev) => [ev, [{ hooks: [{ type: 'command', command: st.hookCommand || 'node "<ai head office overview folder>/office/hook.mjs" 8880 --ai-head-office-hook', timeout: 3 }] }]])) }, null, 2) })),
    ];
  }

  // ---- Office: projects folder, gone-home time, live checks ----
  async function drawOffice() {
    const st = app.data?.setup || {};
    const rootIn = el('input', { type: 'text', class: 'field-text', value: st.root || '', 'aria-label': 'Projects folder', spellcheck: 'false' });
    const quietIn = el('input', { type: 'number', class: 'field-text short', min: '5', max: '1440', value: String(st.quietMinutes || 60), 'aria-label': 'Gone-home time in minutes' });
    const every = el('select', { class: 'field-text short', 'aria-label': 'Check the live sites every' }, [5, 10, 15].map((m) => el('option', { value: String(m), selected: (app.engineData.stats?.liveEvery || 15) === m }, `${m} minutes`)));
    const save = (body, done) => async () => { try { await app.api('/api/settings', body()); await app.refresh(); say(done); } catch (e) { say(fault(e)); } };
    return [
      el('h3', { text: 'Projects folder' }),
      el('p', { class: 'note', text: 'The folder your project folders sit in: each folder in it is a desk, and a thread working in the folder itself is a Consultant. Empty = the folder most threads start in.' }),
      el('div', { class: 'row' }, rootIn, btn('Save folder', save(() => ({ root: rootIn.value }), 'Projects folder saved.'), true)),
      el('h3', { text: 'Gone home' }),
      el('div', { class: 'row' }, el('span', { text: 'After' }), quietIn, el('span', { text: 'minutes with nothing happening.' }), btn('Save time', save(() => ({ quietMinutes: quietIn.value }), 'Gone-home time saved.'), true)),
      el('h3', { text: 'Live sites' }),
      el('div', { class: 'row' }, el('span', { text: 'Check every live address every' }), every, btn('Save', async () => {
        try { const r = await app.engine('/api/live/every', { minutes: Number(every.value) }); say(`Live sites are checked every ${r.every} minutes.`); } catch (e) { say(fault(e)); }
      }, true), btn('Check all now', async () => { try { await app.engine('/api/live/check-all', {}); say('Checking the live sites, one at a time…'); } catch (e) { say(fault(e)); } })),
    ];
  }

  // ---- Private details: what the audit looks for in what you would publish; a saved value is never shown again ----
  async function drawPrivate() {
    const s = await app.engine('/api/private-details');
    const list = el('div', { class: 'pd-list' });
    const line = (d) => {
      const label = el('input', { type: 'text', class: 'field-text pd-label', maxlength: '80', value: d ? d.label : '', placeholder: 'Label, e.g. my phone', 'aria-label': 'Label', spellcheck: 'false', autocomplete: 'off' });
      const value = el('input', { type: 'text', class: 'field-text pd-value', maxlength: '300', placeholder: d ? `Saved (${d.length} characters). Type to replace it` : 'The detail itself', 'aria-label': 'Detail', spellcheck: 'false', autocomplete: 'off' });
      const r = el('div', { class: 'row pd-row', 'data-id': d ? d.id : '' }, label, value, btn('Remove', () => r.remove()));
      return r;
    };
    list.append(...s.details.map(line));
    if (!s.details.length) list.append(line(null));
    return [
      el('p', { text: 'What should never appear in a project you publish: your email, phone, street, full name, a customer\'s name. Every audit looks for them in the files git would publish, the git history, commit emails and release zips.' }),
      el('p', { class: 'note', text: 'Kept on this PC only, in the office\'s data folder. A finding shows the label, never the detail, so a report is safe to paste into an AI. Once saved, a detail is not shown again.' }),
      list,
      el('div', { class: 'row' }, btn('Add detail', () => { const r = line(null); list.append(r); r.querySelector('input').focus(); }), btn('Save', async () => {
        const details = [...list.querySelectorAll('.pd-row')].map((r) => ({ id: r.dataset.id || undefined, label: r.querySelector('.pd-label').value, value: r.querySelector('.pd-value').value })).filter((d) => d.id || d.label.trim() || d.value.trim());
        try { const r = await app.engine('/api/private-details', { details }); say(r.details.length ? `Saved ${plural(r.details.length, 'private detail', 'private details')}. The next audit of each project looks for them.` : 'No private details saved; the audit still looks for this PC\'s own.'); show('private'); } catch (e) { say(fault(e)); }
      }, true)),
      el('p', { class: 'note', text: `Also looked for, read from this PC each time: ${s.auto.join(', ')}; and the names of your other projects.` }),
    ];
  }

  // ---- Help ----
  function drawHelp() {
    const h3 = (t) => el('h3', { text: t });
    const p = (t) => el('p', { text: t });
    const li = (...t) => el('ul', {}, t.map((x) => el('li', { text: x })));
    return [
      p('AI Head Office Overview shows your AI coding threads as staff in an office, beside your projects: their local copies, audits, git backups and live sites. It runs only on this PC.'),
      h3('The office'),
      li('Each thread is one person at their project\'s desk: the project folder they write in, or the one their first message says START HERE in. Work in two or more projects makes a Consultant.',
        'Working is at the desk. A thread that stopped to ask you something stands with a "?" and goes on Needs attention. After an hour with nothing happening they go home.',
        'Click someone for their card: what they are doing, their last messages, Open in the AI app, EDIT (name and look), Favourite, and their project\'s buttons.',
        'Staff rewards: every token written since the office opened goes into a purse to spend on the office.'),
      h3('Projects'),
      li('The Projects tab has a tile per project with its staff, its Audit, Git and Live marks, and Run (starts its own dev server, from its .claude/launch.json or project.json, and opens it), Stop, Folder, Terminal and Browser.',
        'The Running strip lists every local copy the office started, with Open, Stop and Stop all.',
        'Needs attention: threads waiting for an answer, then projects: a live site down, Critical or High audit findings, git waiting for a save or push. Click a row to open it.'),
      h3('Audit, Git and Live'),
      li('Audit checks the code (and the running copy and live site, when there are) against about 130 rules: keys, injection, sign-in and payment gaps, uploads, exposed files, trackers, private details. It catches common faults, not everything. Not a fault… sets one place aside with your reason; Review with AI… builds a prompt to paste into the AI you use.',
        'Git: ● backed up, ▲ unsaved or not pushed or only on this PC, ○ no git. The window gives the exact commands to copy, and See what changed shows every changed line. The office only reads git: it never commits, pushes or changes a folder.',
        'Live: the address a project is hosted at, checked when the office starts and every 5, 10 or 15 minutes with one plain request: ● up, ▲ unsure, ✕ down.'),
      h3('Prompts'),
      p('Prompts you use again and again, a tile per category: Copy, Edit (which can move it), Remove; New category, Add prompt, Rename and Delete category. Words in [brackets] are yours to fill in. Kept on this PC only.'),
      h3('What leaves this PC'),
      p('Nothing about you or your projects. The only requests that leave this PC are plain page requests to the live addresses you add, and, only if you tick it under About, one request a day to GitHub for the newest Git version. Transcripts are read, never changed or sent.'),
      h3('If something goes wrong'),
      li('The page says the office is not answering: it stopped. Double-click start.cmd (or the desktop shortcut); the page catches up by itself.',
        '"Needs Node.js 22 or newer": double-click install.cmd; it offers to install it.',
        'Port 8880 is taken by another program: start it with node server.js --port=8885 (any free port).',
        'A project shows "No start command": add a start for it in the office\'s projects.json (see README.md).',
        'Your folders or prompts are suddenly back to the start: the file that held them could not be read; the office kept it in its data folder as settings.damaged-….json or prompts.damaged-….json.'),
      h3('Uninstall'),
      p('About › Uninstall (or uninstall.cmd) stops the office and removes its desktop shortcut, Start with Windows and the start link. Your files stay: delete the office\'s folder yourself to remove it completely. Its data folder holds your settings, audits, prompts and the office\'s own records.'),
    ];
  }

  // ---- About ----
  async function drawAbout() {
    const stats = app.engineData.stats || await app.engine('/api/stats');
    let git = null;
    try { git = await app.engine('/api/git-program'); } catch { /* shown as unknown */ }
    const gitLine = !git ? 'The Git version could not be read.' : git.missing ? 'Git is not installed: the git marks and See what changed need it (winget install --id Git.Git -e).'
      : !git.installed ? `The Git version could not be read${git.error ? `: ${git.error}` : '.'}`
        : git.judge?.old ? `▲ Git ${git.installed} is older than ${git.judge.fixedIn} (${git.judge.when}), which has the fixes for ${git.judge.what}. Update it: winget upgrade --id Git.Git -e, or download it from git-scm.com.`
          : `● Git ${git.installed}: has every security fix this office knows about (up to ${git.judge?.when || 'its release'}).`;
    const online = el('input', { type: 'checkbox', checked: !!git?.online });
    online.addEventListener('change', async () => { try { const r = await app.engine('/api/git-online', { on: online.checked }); say(r.git.latest?.version ? `Newest Git: ${r.git.latest.version}.` : online.checked ? 'The office will ask GitHub once a day.' : 'Off: nothing is asked online.'); } catch (e) { say(fault(e)); } });
    return [
      row(`AI Head Office Overview ${stats.version}${stats.dryRun ? ' (test copy: windows are reported, not opened)' : ''}${stats.demo ? ' (demo)' : ''}`, 'Runs only on this PC (127.0.0.1). PolyForm Noncommercial License 1.0.0.'),
      row('Git', gitLine),
      el('label', { class: 'tick-row' }, online, el('span', { text: 'Check online for a newer Git (asks GitHub once a day; off until you tick it)' })),
      row('Quit the office', 'Stops the office and every local copy it started. Start it again with start.cmd or the desktop shortcut.', btn('Quit', async () => {
        if (!confirm('Quit the office? It stops, and so does every local copy it started.')) return;
        try { await app.engine('/api/quit', {}); } catch { /* it is stopping */ }
        document.body.replaceChildren(el('p', { class: 'empty stopped', text: 'The office has stopped. You can close this window.' }));
      })),
      row('Uninstall', 'Stops the office and removes its desktop shortcut, Start with Windows and the start link. Your files are not deleted.', btn('Uninstall…', async () => {
        if (!confirm('Uninstall AI Head Office Overview? It stops, and its shortcuts and start link are removed. Nothing is deleted: its folder stays, and you can remove it yourself.')) return;
        try {
          const r = await app.engine('/api/uninstall', {});
          const dry = r.results.filter((x) => x.dryRun).map((x) => x.dryRun);
          document.body.replaceChildren(el('div', { class: 'stopped' }, el('h2', { text: 'AI Head Office Overview is uninstalled' }),
            el('p', { text: dry.length ? `Test copy, nothing on Windows changed: ${dry.join('; ')}.` : 'The desktop shortcut, Start with Windows and the start link are gone, and the office has stopped.' }),
            el('p', { text: `Its files are still in ${r.folder}. Delete that folder to remove it completely; its data folder holds your settings, audits, prompts and the office's records, so keep a copy of anything you want.` }),
            el('p', { class: 'note', text: 'Changed your mind? Double-click install.cmd in that folder.' })));
        } catch (e) { say(fault(e)); }
      })),
    ];
  }

  const DRAW = { folders: drawFolders, setup: drawSetup, office: drawOffice, private: drawPrivate, help: drawHelp, about: drawAbout };

  // ---- The first start: Start with Windows and a desktop shortcut, offered ticked, asked once ----
  let welcomed = false;
  app.welcome = (stats) => {
    if (welcomed || !stats || stats.welcomed || stats.demo) return;
    welcomed = true;
    const tick = (k, label, note) => el('label', { class: 'tick-row' }, el('input', { type: 'checkbox', 'data-k': k, checked: true }), el('span', {}, el('b', { text: label }), el('br'), el('span', { class: 'note', text: note })));
    const ticks = [tick('startup', 'Start the office when I sign in to Windows', 'It runs quietly in the background; open it from the desktop shortcut or a bookmark.'), tick('desktop', 'Put an AI Head Office Overview shortcut on my desktop', 'Double-click it any time to open the office.')];
    const answer = async (yes) => {
      const body = Object.fromEntries(ticks.map((t) => { const i = t.querySelector('input'); return [i.dataset.k, yes && i.checked]; }));
      close();
      try {
        const r = await app.engine('/api/welcome', body);
        const dry = r.results.filter((x) => x.dryRun).map((x) => x.dryRun);
        app.say(dry.length ? `Test copy, nothing changed: ${dry.join('; ')}.` : body.startup || body.desktop ? 'Done. You can change these any time under Settings › Setup.' : 'No problem. You can turn these on any time under Settings › Setup.');
      } catch (e) { app.showFault(e); }
    };
    sheet.replaceChildren(el('div', { class: 'sheet-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'welcome-title' },
      el('h2', { id: 'welcome-title', text: 'Welcome to AI Head Office Overview' }),
      el('p', { text: 'Your AI threads as an office, with your projects, local copies and audits, on this PC only.' }),
      el('p', { class: 'note', text: 'So you never have to start it by hand:' }), ...ticks,
      el('div', { class: 'row sheet-foot' }, btn('Done', () => answer(true), true), btn('Not now', () => answer(false)))));
    sheet.hidden = false;
  };

  document.getElementById('open-setup').addEventListener('click', () => { say(''); show(); });
  sheet.addEventListener('click', (e) => { if (e.target === sheet && !sheet.querySelector('#welcome-title')) close(); });
})();
