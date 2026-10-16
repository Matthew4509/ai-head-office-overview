// Projects in the office: the Projects tab (a tile per project with its staff), Run / Stop / Folder / Terminal /
// Browser on a tile and on a person's card, the Running strip under the project chips, and the This PC line at the top.
// It asks the engine (/api/projects, /api/stats) with the same key as the rest of the page; the office's own data
// (people, desks) comes from app.js. A person's desk is linked to a project by the office (state.links: folder -> id).
'use strict';

(() => {
  const app = window.aiOffice;
  const { el, swap } = app;
  const KEY = document.querySelector('meta[name="aho-key"]')?.content || '';
  const eng = { projects: [], stats: null, rev: '', at: 0, busy: new Set() };
  app.engineData = eng;

  /** A request to the engine's own API (not /api/office/). Answers its JSON; a refusal throws { error: { fault } }. */
  async function engine(url, body) {
    const r = await fetch(url, body === undefined ? { cache: 'no-store', headers: { 'x-aho-key': KEY } }
      : { method: 'POST', headers: { 'x-aho-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 403) { setTimeout(() => location.reload(), 500); throw { error: { fault: 'The office was restarted.', reason: 'This page is from its earlier run.', wayOut: 'It reloads by itself.' } }; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) throw { error: d.fault ? { fault: d.fault, reason: d.reason || '', wayOut: d.wayOut || '' } : { fault: typeof d.error === 'string' ? d.error : `The office answered ${r.status}.`, reason: '', wayOut: '' } };
    return d;
  }
  app.engine = engine;

  const notice = document.getElementById('notice');
  let noticeTimer = 0;
  function say(text) {
    notice.textContent = text;
    notice.hidden = !text;
    clearTimeout(noticeTimer);
    if (text) noticeTimer = setTimeout(() => { notice.hidden = true; }, 8000);
  }
  app.say = say;

  const tokens = app.tokens;
  function ago(iso) {
    const ms = typeof iso === 'number' ? iso : Date.parse(iso || '');
    if (!ms) return '';
    const s = Math.max(0, Date.now() - ms) / 1000;
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  }
  const bytes = (n) => (n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

  async function loadProjects() {
    try {
      const d = await engine('/api/projects');
      eng.projects = d.projects || [];
      eng.stats = d.stats || eng.stats;
      eng.at = Date.now();
      app.draw();
      drawPC();
    } catch (e) { app.showFault(e); }
  }
  // The stats are cheap (every 3 s); the project list is read again when something it shows changed (a site
  // started or stopped, a port taken, tokens counted, a live check) and at least every 30 s.
  async function poll() {
    try {
      eng.stats = await engine('/api/stats');
      app.welcome?.(eng.stats);
      const rev = [eng.stats.rowsRev, eng.stats.tokensAt, eng.stats.liveRev].join('|');
      if (rev !== eng.rev || Date.now() - eng.at > 30000) { eng.rev = rev; await loadProjects(); }
      drawPC();
    } catch { /* app.js says when the office is not answering */ }
  }
  app.loadProjects = loadProjects;

  /** The engine project a desk (office folder) belongs to, or null. */
  function projectOfFolder(folder) {
    const id = app.data?.links?.[folder ?? ''];
    return id ? eng.projects.find((p) => p.id === id) || null : null;
  }
  app.projectOfFolder = projectOfFolder;
  /** The working folder (Settings › Folders) a desk's project sits in, or null (Consultants, or not on the list). */
  app.workingFolderOf = (folder) => projectOfFolder(folder)?.workingFolder || null;
  app.workingFolders = () => eng.stats?.workingFolders || [];

  // Copy prompt: the project's name and full folder, for the AI of the person's choice. A name can come from a
  // project.json in a downloaded folder: it is flattened to one line, without control or direction characters, so what
  // is pasted cannot carry hidden extra lines that read as separate instructions.
  const oneLine = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  async function copyPrompt(p) {
    const text = `Project: ${oneLine(p.name).slice(0, 100)}\nFull folder: ${p.dir}`;
    try { await navigator.clipboard.writeText(text); say(`Copied for ${p.name}: its name and folder. Paste it into the AI you use.`); } catch { say(`The clipboard was blocked. The folder is ${p.dir}`); }
  }

  /** One action on a project; the buttons are looked up again by id at click time, so a redrawn tile never acts on old data. */
  async function act(id, what) {
    const p = eng.projects.find((x) => x.id === id);
    if (!p || eng.busy.has(id)) return;
    eng.busy.add(id);
    app.draw();
    try {
      if (what === 'run' || what === 'move') {
        // Re-allocate (move): another program holds its port, so it starts on a clean one, kept for next time.
        const r = await engine('/api/start', { id, key: p.commands[0]?.key, open: true, move: what === 'move' });
        say(r.dryRun ? `Test copy: ${p.name} would start (${r.dryRun}).` : `${p.name} is running${r.url ? ` at ${r.url}` : ''}.${r.note ? ` ${r.note}` : ''}`);
      } else if (what === 'stop') {
        const r = await engine('/api/stop', { id });
        say(r.note ? `${p.name}: ${r.note}` : `${p.name} stopped.`);
      } else if (what === 'folder' || what === 'terminal') {
        const r = await engine(what === 'folder' ? '/api/open-folder' : '/api/open-terminal', { id });
        say(r.dryRun ? `Test copy, not opened: ${r.dryRun}` : `${what === 'folder' ? 'Folder' : 'Terminal'} opened for ${p.name}.`);
      } else if (what === 'browser') {
        const r = await engine('/api/open-browser', { id });
        say(r.dryRun ? `Test copy, not opened: ${r.dryRun}` : `Opened ${r.url}.`);
      } else if (what === 'copy') {
        await copyPrompt(p);
      } else if (what === 'hide' || what === 'unhide') {
        await engine('/api/projects/hide', { id, hidden: what === 'hide' });
        say(what === 'hide' ? `${p.name} is hidden: tick Show hidden to see it.` : `${p.name} is shown again.`);
      } else if (what === 'remove') {
        if (!confirm(`Take ${p.name} off the list? Its folder and files stay where they are${p.running ? `, and its local copy on port ${p.running.port} is stopped` : ''}. Bring it back under Settings › Folders.`)) return;
        await engine('/api/projects/remove', { id });
        say(`${p.name} is off the list. Its files were not touched.`);
      } else if (what === 'free-port') {
        // Name the program first and stop only that one: the pid lets the office refuse if another has the port now.
        const port = p.portInUse;
        const o = ((await engine('/api/port-owners', {})).owners || []).find((x) => x.port === port);
        if (!o) { say(`Port ${port} is not held by another program any more.`); return; }
        if (o.why) { say(`The program on port ${port} (${o.name}) is not stopped: ${o.why}.`); return; }
        if (!confirm(`Stop ${o.name} (program id ${o.pid})? It holds port ${port}, which ${p.name} needs. Anything unsaved in it is lost.`)) return;
        const r = await engine('/api/stop-port', { port, pid: o.pid });
        say(r.dryRun ? `Test copy, not stopped: ${r.dryRun}` : r.free ? `Port ${port} is free now.` : `${r.name || o.name} was stopped: port ${port} is free.`);
      }
      app.showFault(null);
    } catch (e) { app.showFault(e); } finally {
      eng.busy.delete(id);
      await loadProjects();
    }
  }
  app.projectAct = act;

  /** A small button on a project's tile, greyed while that project is busy. */
  const tileBtn = (p, what, label, title, primary) => el('button', { type: 'button', class: `btn small${primary ? ' primary' : ''}`, disabled: eng.busy.has(p.id), title, 'data-act': what, 'data-id': p.id,
    onclick: (e) => { const menu = e.currentTarget.closest('details'); if (menu) menu.open = false; act(p.id, what); } }, label);
  /** What Run does now: [what, label, title]. Re-allocate when another program holds its port (it starts on a clean
   * port instead of stopping that program; the move is kept, so it stays rare); null with no start command. */
  function runOf(p) {
    if (!p.commands.length) return null;
    const busy = eng.busy.has(p.id);
    if (p.portInUse) return ['move', busy ? 'Starting…' : 'Re-allocate', `Another program holds port ${p.portInUse}. Re-allocate starts ${p.name} on a clean port instead (the same one again next time, while ${p.portInUse} stays taken). To stop that program instead: Free port, under More.`];
    return ['run', busy ? 'Starting…' : 'Run', `Start ${p.name}'s local copy (${p.commands[0].name || 'its start command'}${p.commands[0].port ? `, port ${p.commands[0].port}` : ''}) and open it`];
  }
  /** Free port: stops the program holding the project's port (it asks first). Kept under More: Re-allocate comes first. */
  const freePortOf = (p) => (p.portInUse && !p.running ? ['free-port', `Free port ${p.portInUse}`, `Stop the program holding port ${p.portInUse} so ${p.name} can use its own port (it names the program and asks first)`] : null);
  /** Run, Re-allocate or Stop, on the tile's title line left of the port; nothing there when it has no start command. */
  function runButton(p) {
    if (p.running) return tileBtn(p, 'stop', 'Stop', `Stop ${p.name}'s local copy (port ${p.running.port})`);
    const r = runOf(p);
    return r ? tileBtn(p, ...r, true) : null;
  }
  /** Browser, at the end of the Audit / Git / Live marks: only when the project has a local address. */
  const browserButton = (p) => (p.running || p.commands.some((c) => c.port) ? tileBtn(p, 'browser', 'Browser', p.running ? `Open ${p.running.url}` : 'Open its local address') : null);
  /** Under the marks, only when the project has no start command. */
  function portLine(p) {
    return p.commands.length ? null : el('div', { class: 'row proj-actions' }, el('span', { class: 'note', title: 'No start command in the project\'s .claude/launch.json or project.json' }, 'No start command'));
  }
  /** The tile's More menu (Free port when shown, Copy prompt, Folder, Terminal, Hide, Remove from list), at the end of
   * the marks line. */
  function moreMenu(p, open) {
    const b = (what, label, title) => tileBtn(p, what, label, title);
    const more = el('details', { class: 'more', open: !!open, 'data-id': p.id,
      onkeydown: (e) => { if (e.key === 'Escape' && more.open) { more.open = false; more.querySelector('summary').focus(); } } },
    el('summary', { class: 'btn small', title: `More for ${p.name}`, 'data-act': 'more', 'data-id': p.id }, 'More'),
      el('div', { class: 'more-menu' }, freePortOf(p) ? b(...freePortOf(p)) : null, b('copy', 'Copy prompt', `Copies ${p.name}'s name and full folder, to paste into the AI you use`),
        b('folder', 'Folder', `Open ${p.name}'s folder`), b('terminal', 'Terminal', `A terminal in ${p.name}'s folder`),
        p.hiddenView ? b('unhide', 'Show again', `Show ${p.name} with the others`) : b('hide', 'Hide', `Keep ${p.name} on the list but out of view`),
        b('remove', 'Remove from list', `Take ${p.name} off the list; its files are not touched`)));
    return more;
  }
  /** On a person's card the same buttons sit in one Actions menu under EDIT: Run or Stop first, then the rest. A choice
   * closes the menu; Escape closes it and goes back to its button. `open`: it was open, so a redraw keeps it open. */
  function actionsMenu(p, open) {
    const busy = eng.busy.has(p.id);
    const b = (what, label, title) => el('button', { type: 'button', class: 'btn', disabled: busy, title, 'data-act': what, 'data-id': p.id,
      onclick: (e) => { e.currentTarget.closest('details').open = false; act(p.id, what); } }, label);
    const items = [
      p.running ? b('stop', 'Stop', `Stop ${p.name}'s local copy (port ${p.running.port})`) : runOf(p) ? b(...runOf(p)) : null,
      freePortOf(p) ? b(...freePortOf(p)) : null,
      b('copy', 'Copy prompt', `Copies ${p.name}'s name and full folder, to paste into the AI you use`),
      b('folder', 'Folder', `Open ${p.name}'s folder`),
      b('terminal', 'Terminal', `A terminal in ${p.name}'s folder`),
      p.running || p.commands.some((c) => c.port) ? b('browser', 'Browser', p.running ? `Open ${p.running.url}` : 'Open its local address') : null,
      p.hiddenView ? b('unhide', 'Show again', `Show ${p.name} with the others`) : b('hide', 'Hide', `Keep ${p.name} on the list but out of view`),
      b('remove', 'Remove from list', `Take ${p.name} off the list; its files are not touched`),
    ];
    const menu = el('details', { class: 'more card-actions', open: !!open,
      onkeydown: (e) => { if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); } } },
    el('summary', { class: 'btn', title: `Run, stop, open and more for ${p.name}` }, 'Actions'),
    el('div', { class: 'more-menu' }, ...items.filter(Boolean),
      p.commands.length ? null : el('span', { class: 'note', title: 'No start command in the project\'s .claude/launch.json or project.json' }, 'No start command')));
    return menu;
  }
  app.projectMenu = (folder, open) => { const p = projectOfFolder(folder); return p ? actionsMenu(p, open) : null; };
  /** A person's card: their project's heading (with its star, `star`, when given) and its Audit / Git / Live marks. */
  app.projectActions = (folder, star) => {
    const p = projectOfFolder(folder);
    return p ? el('div', { class: 'card-project' }, el('h3', { class: 'proj-heading' }, `Project: ${p.name}`, star || null), app.checkMarks?.(p)) : null;
  };

  /** The Projects tab: a tile per project, its staff on it; the projects with someone in today come first. */
  app.drawProjectTiles = (box, people) => {
    const byFolder = new Map();
    for (const p of people) { if (!byFolder.has(p.folder)) byFolder.set(p.folder, []); byFolder.get(p.folder).push(p); }
    const links = app.data?.links || {};
    const folderOfId = Object.fromEntries(Object.entries(links).map(([f, id]) => [id, f]));
    // Only what Filter by shows: one project, one working folder, or all of them.
    const shown = eng.projects.filter((p) => (app.showHidden || !p.hiddenView) && (app.inFilter?.(folderOfId[p.id] ?? p.folder, p) ?? true));
    const staffOf = (p) => byFolder.get(folderOfId[p.id]) || [];
    const sorted = [...shown].sort((a, b) => (staffOf(b).length > 0) - (staffOf(a).length > 0) || (!!b.running - !!a.running) || String(b.updated || '').localeCompare(String(a.updated || '')));
    const face = (p) => el('button', { type: 'button', class: `staff state-${p.state}`, title: `${p.name}: ${p.words || p.state}`, onclick: () => app.pick(p.key) }, app.face(p, 30));
    // The tiles are drawn again as tokens and times change: an open More menu stays open, and a focused tile button keeps
    // the focus, so Terminal, Hide and Remove are not pulled from under the pointer or the keyboard.
    const openMore = new Set([...box.querySelectorAll('details.more[open]')].map((d) => d.dataset.id));
    const had = box.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = had?.dataset.act ? `[data-act="${CSS.escape(had.dataset.act)}"][data-id="${CSS.escape(had.dataset.id || '')}"]` : '';
    // The top of a tile: its staff's faces on the left, its title, description and meta lines beside them.
    const top = (head, sub, meta, faces) => el('div', { class: 'proj-top' }, el('div', { class: 'staff-row' }, faces),
      el('div', { class: 'proj-text' }, head, el('span', { class: 'proj-sub', text: sub }), el('span', { class: 'proj-meta', text: meta })));
    const tile = (p) => {
      const staff = staffOf(p);
      return el('li', { class: `proj${p.running ? ' is-running' : ''}` },
        top(el('div', { class: 'proj-head' }, el('b', { class: 'proj-name', text: p.name, title: p.name }), app.projectStar?.(folderOfId[p.id] || p.folder, p.name),
          runButton(p), p.running ? el('span', { class: 'run-dot', title: `Running on port ${p.running.port}` }, `● ${p.running.port}`) : null),
        p.description || p.folder, [p.tokens ? `${tokens(p.tokens)} tokens` : '', p.updated ? `updated ${ago(p.updated)}` : ''].filter(Boolean).join(' · '),
        staff.length ? staff.map(face) : el('span', { class: 'note', text: 'Nobody in today' })),
        app.checkMarks?.(p, browserButton(p), moreMenu(p, openMore.has(p.id))), portLine(p));
    };
    // Desks with no project on the list (the projects folder itself: Consultants, or a folder elsewhere) keep a plain tile.
    const linked = new Set(Object.keys(links));
    const loose = [...byFolder.keys()].filter((f) => (!linked.has(f) || !eng.projects.some((p) => p.id === links[f])) && (app.inFilter?.(f) ?? true));
    const looseTile = (f) => el('li', { class: 'proj' }, top(el('div', { class: 'proj-head' }, el('b', { class: 'proj-name', text: f || 'Consultants' })),
      f ? 'Not on the project list' : 'Threads in the projects folder itself', '', byFolder.get(f).map(face)));
    const hiddenN = eng.projects.filter((p) => p.hiddenView).length;
    const toggle = el('div', { class: 'row note' }, el('label', {}, el('input', { type: 'checkbox', checked: app.showAll, onchange: (e) => { app.showAll = e.target.checked; app.draw(); } }), ' Show everyone, not only today'),
      hiddenN ? el('label', {}, el('input', { type: 'checkbox', checked: !!app.showHidden, onchange: (e) => { app.showHidden = e.target.checked; app.draw(); } }), ` Show hidden (${hiddenN})`) : null);
    const loading = !eng.at ? el('p', { class: 'note', text: 'Reading the project list…' }) : null;
    const drawn = swap(box, toggle, loading, el('ul', { class: 'proj-tiles' }, ...loose.map(looseTile), ...sorted.map(tile)),
      eng.at && !sorted.length && !loose.length ? el('p', { class: 'empty', text: eng.projects.length ? 'No project in what Filter by shows. Pick All projects to see them all.' : 'No projects yet. Add a working folder under Settings.' }) : null);
    if (drawn && focusKey) box.querySelector(focusKey)?.focus();
  };

  /** Projects open: every local copy the office started, in a window opened from "N projects open · View all" on the top
   * line. Each with its address, Open and Stop; Stop all at the foot. Open, it follows the list (a Stop takes the row away). */
  let openShown = false;
  let openKey = '';
  function viewOpen() { openShown = true; openKey = ''; drawRunning(true); }
  function drawRunning(first = false) {
    if (!openShown || !app.openWindow) return;
    const sheet = document.getElementById('check');
    // Closed (Close, Escape, a click beside it) or replaced by another window: it stays closed.
    if (!first && (sheet.hidden || sheet.firstElementChild?.dataset.kind !== 'running')) { openShown = false; return; }
    const list = eng.projects.filter((p) => p.running);
    // Drawn again only when what is open changes, so a pointer or keyboard on it is never interrupted.
    const key = list.map((p) => `${p.id}:${p.running.port}:${eng.busy.has(p.id)}`).join('|');
    if (!first && key === openKey) return;
    openKey = key;
    const since = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; return Number.isFinite(s) ? (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`) : ''; };
    const body = list.length ? [el('ul', { class: 'open-list' }, ...list.map((p) => el('li', { class: 'open-row' },
      el('div', { class: 'open-what' }, el('b', { text: p.name }), el('span', { class: 'note', text: [p.running.url || `port ${p.running.port}`, p.running.started ? `open for ${since(p.running.started)}` : ''].filter(Boolean).join(' · ') })),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn', onclick: () => act(p.id, 'browser'), title: `Open ${p.running.url || p.name} in the browser` }, 'Open'),
        el('button', { type: 'button', class: 'btn', onclick: () => act(p.id, 'stop'), title: `Stop ${p.name}'s local copy` }, 'Stop')))))]
      : [el('p', { class: 'note', text: 'Nothing is open now. Run a project from its Actions menu (on a person\'s card) or from the Projects tab.' })];
    const keepFocus = sheet.contains(document.activeElement) ? document.activeElement.textContent : null;
    app.openWindow(`Projects open (${list.length})`, body, [
      list.length > 1 ? el('button', { type: 'button', class: 'btn', onclick: stopAll, title: 'Stop every local copy the office started' }, 'Stop all') : null,
      el('button', { type: 'button', class: 'btn primary', onclick: () => { openShown = false; app.closeWindow(); } }, 'Close')]);
    sheet.firstElementChild.dataset.kind = 'running';
    if (keepFocus) [...sheet.querySelectorAll('button')].find((b) => b.textContent === keepFocus)?.focus();
  }
  async function stopAll() {
    try { const r = await engine('/api/stop-all', {}); say(`Stopped ${r.stopped?.length ?? 'every'} local ${r.stopped?.length === 1 ? 'copy' : 'copies'}.`); app.showFault(null); } catch (e) { app.showFault(e); }
    await loadProjects();
  }

  /** This PC, on the top line beside the name, as rings: CPU, memory, disk and GPU as the engine reads them (every 3 s),
   * each a ring filled to its share with the number in the middle and a short name under it; past 85% the ring turns
   * to the warning colour (the number says it too). The details are each ring's tooltip; the PC's own on its name. */
  const SVG = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
  function ring(label, pct, tip, shown) {
    const C = 2 * Math.PI * 26;
    const off = pct == null;
    const p = off ? 0 : Math.max(0, Math.min(100, Math.round(pct)));
    const text = off ? '—' : shown || `${p}%`;
    const pic = svg('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' });
    pic.append(svg('circle', { class: 'trk', cx: 32, cy: 32, r: 26, fill: 'none', 'stroke-width': 7 }),
      svg('circle', { class: 'val', cx: 32, cy: 32, r: 26, fill: 'none', 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-dasharray': C.toFixed(2), 'stroke-dashoffset': (C * (1 - p / 100)).toFixed(2), transform: 'rotate(-90 32 32)' }));
    return el('span', { class: `pc-ring${p > 85 ? ' hot' : ''}${off ? ' off' : ''}`, role: 'img', 'aria-label': `${label} ${off ? 'no reading' : text}`, title: tip },
      el('span', { class: 'pc-dial' }, pic, el('span', { class: 'pc-v', text })), el('span', { class: 'pc-k', text: label }));
  }
  function drawPC() {
    const line = document.getElementById('pc-line');
    if (!line) return;
    const s = eng.stats;
    if (!s) { swap(line, el('span', { class: 'note', text: 'Reading this PC…' })); return; }
    const up = s.uptime ? `${Math.floor(s.uptime / 86400)} d ${Math.floor((s.uptime % 86400) / 3600)} h` : '';
    const running = eng.projects.filter((p) => p.running).length;
    const about = [s.host, s.cpuModel, s.cores ? `${s.cores} cores` : '', up ? `on for ${up}` : ''].filter(Boolean).join('\n');
    const gpu = s.gpu || {};
    const card = gpu.adapters?.length ? `\n${gpu.adapters.join('\n')}` : '';
    swap(line,
      el('span', { class: 'pc-host', title: about }, el('b', { text: s.host || 'This PC' }), up ? el('span', { text: `on ${up}` }) : null),
      ring('CPU', s.cpuPct, `CPU ${Math.round(s.cpuPct || 0)}%${s.cores ? ` (${s.cores} cores)` : ''}${s.cpuModel ? `\n${s.cpuModel.trim()}` : ''}`),
      s.mem ? ring('Memory', (1 - s.mem.free / s.mem.total) * 100, `Memory ${bytes(s.mem.total - s.mem.free)} of ${bytes(s.mem.total)}`) : null,
      s.disk ? ring('Disk', (1 - s.disk.free / s.disk.total) * 100, `Disk ${bytes(s.disk.total - s.disk.free)} of ${bytes(s.disk.total)} (${bytes(s.disk.free)} free)`) : null,
      ring('GPU', typeof gpu.pct === 'number' ? gpu.pct : null, typeof gpu.pct === 'number' ? `GPU ${Math.round(gpu.pct)}%${card}` : `GPU: ${gpu.error || 'no reading yet'}${card}`),
      typeof s.temp?.c === 'number' ? ring('CPU heat', s.temp.c, `CPU temperature ${Math.round(s.temp.c)} °C (the full ring is 100 °C)`, `${Math.round(s.temp.c)}°`) : null,
      el('button', { type: 'button', class: 'pc-open', onclick: viewOpen, title: running ? 'See the local copies the office started, with Open, Stop and Stop all' : 'No local copy is open: run one from a project\'s Actions menu or the Projects tab' },
        el('span', {}, el('b', { text: String(running) }), ` ${running === 1 ? 'project' : 'projects'} open`), el('span', { class: 'pc-view', text: 'View all' })));
  }

  app.afterDraw = () => drawRunning();
  loadProjects();
  setInterval(poll, 3000);
})();
