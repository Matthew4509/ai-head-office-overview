// Projects in the office: the Projects tab (a tile per project with its staff), Run / Stop / Folder / Terminal /
// Browser on a tile and on a person's card, the Running strip under the project chips, and the This PC panel.
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
    if (!r.ok || d.ok === false) throw { error: { fault: typeof d.error === 'string' ? d.error : `The office answered ${r.status}.`, reason: '', wayOut: '' } };
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
    } catch (e) { app.showFault(e); }
  }
  // The stats are cheap (every 3 s); the project list is read again when something it shows changed (a site
  // started or stopped, a port taken, tokens counted, a live check) and at least every 30 s.
  async function poll() {
    try {
      eng.stats = await engine('/api/stats');
      app.welcome?.(eng.stats);
      const rev = [eng.stats.rowsRev, eng.stats.tokensAt, eng.stats.liveRev].join('|');
      if (rev !== eng.rev || Date.now() - eng.at > 30000) { eng.rev = rev; await loadProjects(); } else if (app.sideTab === 'pc') app.draw();
    } catch { /* app.js says when the office is not answering */ }
  }
  app.loadProjects = loadProjects;

  /** The engine project a desk (office folder) belongs to, or null. */
  function projectOfFolder(folder) {
    const id = app.data?.links?.[folder ?? ''];
    return id ? eng.projects.find((p) => p.id === id) || null : null;
  }
  app.projectOfFolder = projectOfFolder;

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
      if (what === 'run') {
        const r = await engine('/api/start', { id, key: p.commands[0]?.key, open: true });
        say(r.dryRun ? `Test copy: ${p.name} would start (${r.dryRun}).` : `${p.name} is running${r.url ? ` at ${r.url}` : ''}.`);
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
        const r = await engine('/api/stop-port', { port: p.portInUse });
        say(r.free ? `Port ${p.portInUse} is free now.` : `The program on port ${p.portInUse} was stopped.`);
      }
      app.showFault(null);
    } catch (e) { app.showFault(e); } finally {
      eng.busy.delete(id);
      await loadProjects();
    }
  }
  app.projectAct = act;

  /** The buttons for one project: Run or Stop, Folder, Terminal, Browser (and a way to free its port). */
  function actions(p, compact = false) {
    const busy = eng.busy.has(p.id);
    const b = (what, label, title, primary) => el('button', { type: 'button', class: `btn${primary ? ' primary' : ''}${compact ? ' small' : ''}`, disabled: busy, title, 'data-act': what, 'data-id': p.id, onclick: () => act(p.id, what) }, label);
    const canRun = p.commands.length > 0;
    const run = p.running ? b('stop', 'Stop', `Stop ${p.name}'s local copy (port ${p.running.port})`, false)
      : canRun ? b('run', busy ? 'Starting…' : 'Run', `Start ${p.name}'s local copy (${p.commands[0].name || 'its start command'}${p.commands[0].port ? `, port ${p.commands[0].port}` : ''}) and open it`, true)
        : el('span', { class: 'note', title: 'No start command in the project\'s .claude/launch.json or project.json' }, 'No start command');
    const port = p.portInUse && !p.running ? b('free-port', `Free port ${p.portInUse}`, `Another program holds port ${p.portInUse}: stop it so ${p.name} can run`, false) : null;
    const more = el('details', { class: 'more' }, el('summary', { class: `btn${compact ? ' small' : ''}`, title: `More for ${p.name}` }, 'More'),
      el('div', { class: 'more-menu' }, p.hiddenView ? b('unhide', 'Show again', `Show ${p.name} with the others`) : b('hide', 'Hide', `Keep ${p.name} on the list but out of view`),
        b('remove', 'Remove from list', `Take ${p.name} off the list; its files are not touched`)));
    return el('div', { class: 'row proj-actions' }, run, port, b('copy', 'Copy prompt', `Copies ${p.name}'s name and full folder, to paste into the AI you use`),
      b('folder', 'Folder', `Open ${p.name}'s folder`), b('terminal', 'Terminal', `A terminal in ${p.name}'s folder`),
      p.running || p.commands.some((c) => c.port) ? b('browser', 'Browser', p.running ? `Open ${p.running.url}` : `Open its local address`) : null, more);
  }
  app.projectActions = (folder) => {
    const p = projectOfFolder(folder);
    return p ? el('div', { class: 'card-project' }, el('h3', { text: `Project: ${p.name}` }), app.checkMarks?.(p), actions(p)) : null;
  };

  /** The Projects tab: a tile per project, its staff on it; the projects with someone in today come first. */
  app.drawProjectTiles = (box, people) => {
    const byFolder = new Map();
    for (const p of people) { if (!byFolder.has(p.folder)) byFolder.set(p.folder, []); byFolder.get(p.folder).push(p); }
    const links = app.data?.links || {};
    const folderOfId = Object.fromEntries(Object.entries(links).map(([f, id]) => [id, f]));
    const shown = eng.projects.filter((p) => app.showHidden || !p.hiddenView);
    const staffOf = (p) => byFolder.get(folderOfId[p.id]) || [];
    const sorted = [...shown].sort((a, b) => (staffOf(b).length > 0) - (staffOf(a).length > 0) || (!!b.running - !!a.running) || String(b.updated || '').localeCompare(String(a.updated || '')));
    const face = (p) => el('button', { type: 'button', class: `staff state-${p.state}`, title: `${p.name}: ${p.words || p.state}`, onclick: () => app.pick(p.key) }, app.face(p, 30));
    const tile = (p) => {
      const staff = staffOf(p);
      return el('li', { class: `proj${p.running ? ' is-running' : ''}` },
        el('div', { class: 'proj-head' }, el('b', { class: 'proj-name', text: p.name }), p.running ? el('span', { class: 'run-dot', title: `Running on port ${p.running.port}` }, `● ${p.running.port}`) : null),
        el('span', { class: 'proj-sub', text: p.description || p.folder }),
        el('span', { class: 'proj-meta', text: [p.tokens ? `${tokens(p.tokens)} tokens` : '', p.updated ? `updated ${ago(p.updated)}` : ''].filter(Boolean).join(' · ') }),
        el('div', { class: 'staff-row' }, staff.length ? staff.map(face) : el('span', { class: 'note', text: 'Nobody in today' })),
        app.checkMarks?.(p), actions(p, true));
    };
    // Desks with no project on the list (the projects folder itself: Consultants, or a folder elsewhere) keep a plain tile.
    const linked = new Set(Object.keys(links));
    const loose = [...byFolder.keys()].filter((f) => !linked.has(f) || !eng.projects.some((p) => p.id === links[f]));
    const looseTile = (f) => el('li', { class: 'proj' }, el('div', { class: 'proj-head' }, el('b', { class: 'proj-name', text: f || 'Consultants' })),
      el('span', { class: 'proj-sub', text: f ? 'Not on the project list' : 'Threads in the projects folder itself' }), el('span', { class: 'proj-meta', text: '' }),
      el('div', { class: 'staff-row' }, byFolder.get(f).map(face)));
    const hiddenN = eng.projects.filter((p) => p.hiddenView).length;
    const toggle = el('div', { class: 'row note' }, el('label', {}, el('input', { type: 'checkbox', checked: app.showAll, onchange: (e) => { app.showAll = e.target.checked; app.draw(); } }), ' Show everyone, not only today'),
      hiddenN ? el('label', {}, el('input', { type: 'checkbox', checked: !!app.showHidden, onchange: (e) => { app.showHidden = e.target.checked; app.draw(); } }), ` Show hidden (${hiddenN})`) : null);
    const loading = !eng.at ? el('p', { class: 'note', text: 'Reading the project list…' }) : null;
    swap(box, toggle, loading, el('ul', { class: 'proj-tiles' }, ...loose.map(looseTile), ...sorted.map(tile)),
      eng.at && !sorted.length && !loose.length ? el('p', { class: 'empty', text: 'No projects yet. Add a working folder under Settings.' }) : null);
  };

  /** The Running strip: every local copy the office started, with Open and Stop, and Stop all. */
  function drawRunning() {
    const box = document.getElementById('running');
    const list = eng.projects.filter((p) => p.running);
    box.hidden = !list.length;
    if (!list.length) { box.replaceChildren(); return; }
    swap(box, el('b', { text: `Running (${list.length})` }),
      ...list.map((p) => el('span', { class: 'run-chip' }, el('span', { text: `${p.name} · ${p.running.port}` }),
        el('button', { type: 'button', class: 'btn small', onclick: () => act(p.id, 'browser'), title: `Open ${p.running.url}` }, 'Open'),
        el('button', { type: 'button', class: 'btn small', onclick: () => act(p.id, 'stop'), title: `Stop ${p.name}` }, 'Stop'))),
      list.length > 1 ? el('button', { type: 'button', class: 'btn small', onclick: stopAll }, 'Stop all') : null);
  }
  async function stopAll() {
    try { const r = await engine('/api/stop-all', {}); say(`Stopped ${r.stopped?.length ?? 'every'} local ${r.stopped?.length === 1 ? 'copy' : 'copies'}.`); app.showFault(null); } catch (e) { app.showFault(e); }
    await loadProjects();
  }

  /** This PC: the processor, memory, disk and graphics card, as the engine reads them. */
  app.drawPC = (pane) => {
    const s = eng.stats;
    if (!s) { swap(pane, el('p', { class: 'note', text: 'Reading this PC…' })); return; }
    const bar = (label, pct, text) => el('div', { class: 'pc-row' }, el('span', { class: 'pc-label', text: label }),
      el('meter', { min: '0', max: '100', low: '70', high: '90', optimum: '0', value: String(Math.round(pct || 0)), 'aria-label': label }), el('span', { class: 'pc-val', text }));
    const mem = s.mem ? (1 - s.mem.free / s.mem.total) * 100 : 0;
    const disk = s.disk ? (1 - s.disk.free / s.disk.total) * 100 : 0;
    const gpu = s.gpu && typeof s.gpu.pct === 'number' ? s.gpu : null;
    const up = s.uptime ? `${Math.floor(s.uptime / 86400)} d ${Math.floor((s.uptime % 86400) / 3600)} h` : '';
    swap(pane, el('h2', { text: s.host || 'This PC' }),
      el('p', { class: 'note', text: [s.cpuModel, s.cores ? `${s.cores} cores` : '', up ? `on for ${up}` : ''].filter(Boolean).join(' · ') }),
      bar('Processor', s.cpuPct, `${Math.round(s.cpuPct || 0)}%`),
      s.mem ? bar('Memory', mem, `${bytes(s.mem.total - s.mem.free)} of ${bytes(s.mem.total)}`) : null,
      s.disk ? bar('Disk', disk, `${bytes(s.disk.free)} free of ${bytes(s.disk.total)}`) : null,
      gpu ? bar('Graphics', gpu.pct, `${Math.round(gpu.pct)}%${gpu.adapters?.length ? ` · ${gpu.adapters[0]}` : ''}`) : el('p', { class: 'note', text: 'Graphics card: no reading yet.' }),
      typeof s.temp?.c === 'number' ? el('p', { class: 'note', text: `Processor heat: ${Math.round(s.temp.c)} °C` }) : null,
      el('p', { class: 'note', text: `Running from this office: ${eng.projects.filter((p) => p.running).length} local ${eng.projects.filter((p) => p.running).length === 1 ? 'copy' : 'copies'}.` }));
  };

  app.afterDraw = () => drawRunning();
  loadProjects();
  setInterval(poll, 3000);
})();
