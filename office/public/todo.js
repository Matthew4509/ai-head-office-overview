// The To Do (the right panel's third tab, lib/todo.js): Today, This week and This month, each row a project, a size
// and an optional note, put there by hand. Drag a project's name from a tile (Projects tab) or the Favourites tab onto
// a part of it (over the To Do tab, it opens), or use + Add / a tile's More › Add to To Do…. Rows are dragged between
// parts, or moved from their ⋯ menu (keyboard and touch). A tick moves a row to Done today (always in view); rows done before today show for this week, this month, or not at all (Show earlier). Quick checks (a
// project checked every week or month) come into Today by themselves, 1 or 2 a day. My day sets the day's hours.
'use strict';

(() => {
  const app = window.aiOffice;
  const { el } = app;
  const eng = app.engineData;
  const ITEM = 'application/x-aho-todo';
  const PROJECT = 'application/x-aho-project';
  const SIZE = 'application/x-aho-size';
  let data = null;
  let at = 0;
  let loadedDay = '';
  const dayNow = () => new Date().toDateString();

  async function load() {
    try {
      data = await app.engine('/api/todo');
      at = Date.now();
      loadedDay = dayNow();
    } catch (e) { app.showFault(e); }
    app.draw();
  }
  // Read at start, after every change, and once a minute (a new day brings carried rows and quick checks).
  load();
  setInterval(() => { if (Date.now() - at > 60000 || dayNow() !== loadedDay) load(); }, 15000);
  app.todoOpen = () => data?.open || 0;

  async function call(url, body, said) {
    try {
      const r = await app.engine(url, body);
      if (said) app.say(typeof said === 'function' ? said(r) : said);
      app.showFault(null);
    } catch (e) { app.showFault(e); }
    await load();
  }
  const zoneName = (z) => ({ today: 'Today', week: 'This week', month: 'This month' }[z] || z);
  const btn = (label, onclick, cls = 'btn small', extra = {}) => el('button', { type: 'button', class: cls, onclick, ...extra }, label);
  const closeMenu = (e) => { const m = e.currentTarget.closest('details'); if (m) m.open = false; };
  const projectName = (id) => eng.projects.find((p) => p.id === id)?.name || id;

  /** The projects for a picker: the favourite projects first (stars and favourite staff), then the rest by name. */
  function pickList() {
    const links = app.data?.links || {};
    const favFolders = new Set([...(app.data?.favProjects || []), ...(app.data?.people || []).filter((p) => p.fav).map((p) => p.folder)]);
    const fav = new Set([...favFolders].map((f) => links[f]).filter(Boolean));
    const all = [...eng.projects].filter((p) => !p.hiddenView).sort((a, b) => a.name.localeCompare(b.name));
    return { favs: all.filter((p) => fav.has(p.id)), rest: all.filter((p) => !fav.has(p.id)) };
  }
  const options = (list, chosen) => list.map((p) => el('option', { value: p.id, selected: p.id === chosen }, p.name));
  // On a row the sizes are short ("Quick", "2 h"); in the Add window they say what Quick is.
  const sizeSelect = (value, label, short = false) => el('select', { class: 'field-text short', 'aria-label': label },
    ...(data?.sizes || []).map((s) => el('option', { value: String(s.min), selected: s.min === value }, short && s.min < 60 ? 'Quick' : s.text)));
  const zoneSelect = (value) => el('select', { class: 'field-text short', 'aria-label': 'Where' },
    ...['today', 'week', 'month'].map((z) => el('option', { value: z, selected: z === value }, zoneName(z))));
  const checkOf = (project) => data?.checks?.find((c) => c.project === project)?.every || 'off';
  const everySelect = (value) => el('select', { class: 'field-text short', 'aria-label': 'Quick check' },
    el('option', { value: 'off', selected: value === 'off' }, 'No quick check'),
    el('option', { value: 'week', selected: value === 'week' }, 'Quick check every week'),
    el('option', { value: 'month', selected: value === 'month' }, 'Quick check every month'));
  const field = (label, input) => el('label', { class: 'todo-field' }, el('span', { class: 'note', text: label }), input);

  /** + Add / Add to To Do…: a project (favourites first), where, the size, a note, and its quick check. */
  function addWindow(project = null, zone = 'today') {
    const { favs, rest } = pickList();
    const chosen = project || favs[0]?.id || rest[0]?.id || '';
    const pick = el('select', { class: 'field-text', 'aria-label': 'Project' },
      favs.length ? el('optgroup', { label: 'Favourites' }, ...options(favs, chosen)) : null,
      el('optgroup', { label: favs.length ? 'All projects' : 'Projects' }, ...options(rest, chosen)));
    const where = zoneSelect(zone);
    const size = sizeSelect(60, 'Size');
    const note = el('input', { type: 'text', class: 'field-text', maxlength: '120', placeholder: 'What to do (optional), e.g. fix the header', 'aria-label': 'Note', autocomplete: 'off' });
    const every = everySelect(checkOf(chosen));
    pick.onchange = () => { every.value = checkOf(pick.value); };
    const go = async () => {
      if (!pick.value) return;
      const name = projectName(pick.value);
      app.closeWindow();
      const was = checkOf(pick.value);
      await call('/api/todo/add', { project: pick.value, zone: where.value, size: Number(size.value), note: note.value, ...(every.value !== 'off' ? { every: every.value } : {}) },
        `${name} is on the To Do: ${zoneName(where.value)}.`);
      if (every.value === 'off' && was !== 'off') await call('/api/todo/check', { project: pick.value, every: 'off' });
      app.showTab?.('todo');
    };
    note.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    app.openWindow('Add to the To Do', [
      field('Project', pick), el('div', { class: 'row todo-fields' }, field('Where', where), field('Size', size)), field('Note', note),
      field('Quick check', every),
      el('p', { class: 'note', text: 'A quick check comes into Today by itself when it is due (15 min), so a project is never forgotten. It stays until you tick it.' }),
    ], [btn('Cancel', () => app.closeWindow(), 'btn'), btn('Add', go, 'btn primary')], false);
    (project ? where : pick).focus();
  }
  app.todoAdd = (project) => (data ? addWindow(project) : load().then(() => addWindow(project)));

  function noteWindow(it) {
    const note = el('input', { type: 'text', class: 'field-text', maxlength: '120', value: it.note, 'aria-label': 'Note', autocomplete: 'off' });
    const save = () => { app.closeWindow(); call('/api/todo/set', { item: it.id, note: note.value }); };
    note.onkeydown = (e) => { if (e.key === 'Enter') save(); };
    app.openWindow(`Note for ${it.name}`, [field('Note (one line, up to 120 characters)', note)], [btn('Cancel', () => app.closeWindow(), 'btn'), btn('Save', save, 'btn primary')], false);
    note.focus();
  }

  /** My day: the hours in a day, how many quick checks a day, and every quick check with its next date. */
  function dayWindow() {
    const s = data.settings;
    const hours = el('select', { class: 'field-text short', 'aria-label': 'Hours in my day' },
      ...Array.from({ length: 25 }, (_, i) => 4 + i / 2).map((h) => el('option', { value: String(h), selected: h === s.dayHours }, `${h} h`)));
    const per = el('select', { class: 'field-text short', 'aria-label': 'Quick checks a day' },
      el('option', { value: '1', selected: s.checksPerDay === 1 }, '1 a day'), el('option', { value: '2', selected: s.checksPerDay === 2 }, '2 a day'));
    const fmt = (d) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    const rows = (data.checks || []).map((c) => el('li', { class: 'todo-check-row' },
      el('span', {}, el('b', { text: c.name }), ` · every ${c.every} · `, c.due ? el('span', { class: 'm-warn', text: 'due now' }) : `next ${fmt(c.next)}`),
      btn('Off', async () => { await call('/api/todo/check', { project: c.project, every: 'off' }, `No more quick checks for ${c.name}.`); dayWindow(); }, 'btn small', { title: `Stop the quick checks for ${c.name}` })));
    const save = () => { app.closeWindow(); call('/api/todo/settings', { dayHours: Number(hours.value), checksPerDay: Number(per.value) }, 'My day is saved.'); };
    app.openWindow('My day', [
      el('div', { class: 'row todo-fields' }, field('Hours in my day', hours), field('Quick checks into Today', per)),
      el('p', { class: 'note', text: 'Today adds up the sizes of its rows against your day, and says so when it goes over. Nothing is refused.' }),
      el('h3', { text: 'Quick checks' }),
      rows.length ? el('ul', { class: 'todo-checks' }, ...rows) : el('p', { class: 'note', text: 'None yet. Add one from + Add, or a row\'s ⋯ menu.' }),
    ], [btn('Cancel', () => app.closeWindow(), 'btn'), btn('Save', save, 'btn primary')], false);
  }

  // The Favourites part: every favourite project not on the To Do yet, each with the size it goes in at (kept in this
  // browser), dragged onto a part or put there from its ⋯ menu. Once on the To Do it leaves Favourites; ticked or
  // removed, it is back.
  const favSizes = (() => { try { return JSON.parse(localStorage.getItem('aho-todo-fav-sizes') || '{}') || {}; } catch { return {}; } })();
  const saveFavSizes = () => { try { localStorage.setItem('aho-todo-fav-sizes', JSON.stringify(favSizes)); } catch { /* fine */ } };
  const sizeWords = (m) => (m < 60 ? 'Quick' : `${m / 60} h`);
  const favSizeOf = (id) => ((data?.sizes || []).some((s) => s.min === favSizes[id]) ? favSizes[id] : 60);
  function favRow(p, open) {
    const size = sizeSelect(favSizeOf(p.id), `Size ${p.name} goes in at`, true);
    size.onchange = () => { favSizes[p.id] = Number(size.value); saveFavSizes(); };
    const put = (z) => btn(`Put in ${zoneName(z)}`, (e) => {
      closeMenu(e);
      call('/api/todo/add', { project: p.id, zone: z, size: Number(size.value) }, `${p.name} is on the To Do: ${zoneName(z)}, ${sizeWords(Number(size.value))}.`);
    });
    const menu = el('details', { class: 'more todo-menu', open: open?.has(`fav:${p.id}`) || null },
      el('summary', { class: 'btn small', title: `Put ${p.name} on the To Do`, 'aria-label': `Put ${p.name} on the To Do` }, '⋯'),
      el('div', { class: 'more-menu' }, put('today'), put('week'), put('month')));
    return el('li', { class: 'todo-row todo-fav', draggable: 'true', 'data-todo-project': p.id, 'data-fav': `fav:${p.id}`, title: `Drag ${p.name} onto Today, This week or This month` },
      el('span', { class: 'todo-star', 'aria-hidden': 'true', text: '★' }), el('span', { class: 'todo-text' }, el('b', { text: p.name })), size, menu);
  }

  /** A row: done tick, the project (and note), its size, and ⋯ (move, note, quick check, remove). */
  function row(it, zone, open) {
    const tick = el('input', { type: 'checkbox', checked: it.done, 'aria-label': `Done: ${it.name}`,
      onchange: (e) => call('/api/todo/done', { item: it.id, done: e.target.checked }, e.target.checked ? `Done: ${it.name}.` : '') });
    const size = sizeSelect(it.size, `Size of ${it.name}`, true);
    size.onchange = () => call('/api/todo/set', { item: it.id, size: Number(size.value) });
    const move = (z) => btn(`Move to ${zoneName(z)}`, (e) => { closeMenu(e); call('/api/todo/move', { item: it.id, zone: z }); });
    const every = checkOf(it.project);
    const setEvery = (v, label) => btn(label, (e) => { closeMenu(e); call('/api/todo/check', { project: it.project, every: v }, v === 'off' ? `No more quick checks for ${it.name}.` : `${it.name}: a quick check every ${v}.`); }, 'btn small', { 'aria-pressed': String(every === v) });
    const menu = it.done ? null : el('details', { class: 'more todo-menu', open: open?.has(it.id) || null },
      el('summary', { class: 'btn small', title: `More for this row (${it.name})`, 'aria-label': `More for ${it.name}` }, '⋯'),
      el('div', { class: 'more-menu' },
        ...['today', 'week', 'month'].filter((z) => z !== zone).map(move),
        btn(it.note ? 'Edit note…' : 'Add a note…', (e) => { closeMenu(e); noteWindow(it); }),
        setEvery('week', 'Quick check every week'), setEvery('month', 'Quick check every month'), every !== 'off' ? setEvery('off', 'No quick check') : null,
        btn('Remove', (e) => { closeMenu(e); call('/api/todo/remove', { item: it.id }, `${it.name} is off the To Do.`); })));
    const label = el('span', { class: 'todo-text', title: it.note ? `${it.name}: ${it.note}` : it.name },
      it.kind === 'check' ? el('span', { class: 'note', text: 'Quick check: ' }) : null,
      el('b', { text: it.name }), it.gone ? el('span', { class: 'note', text: ' (not on the list)' }) : null,
      it.note ? ` · ${it.note}` : null,
      it.from ? el('span', { class: 'todo-from', text: ` from ${it.from}` }) : null,
      it.done && it.doneAt && it.doneAt !== data.today ? el('span', { class: 'note', text: ` · ${new Date(`${it.doneAt}T12:00:00`).toLocaleDateString([], { weekday: 'short' })}` }) : null);
    return el('li', { class: `todo-row${it.done ? ' is-done' : ''}`, draggable: it.done ? null : 'true', 'data-item': it.id }, tick, label, it.done ? el('span', { class: 'note', text: it.sizeText }) : size, menu);
  }

  /** The whole tab. Drawn only when something in it changed (swap compares), so a row is never rebuilt under the pointer. */
  app.drawTodo = (pane) => {
    if (!data) { app.swap(pane, el('p', { class: 'note', text: 'Reading the To Do…' })); return; }
    const t = data.total;
    const over = t.todayMin > t.dayMin;
    // An open ⋯ menu stays open when the tab is drawn again.
    const open = new Set([...pane.querySelectorAll('details.todo-menu[open]')].map((d) => { const r = d.closest('[data-item], [data-fav]'); return r?.dataset.item || r?.dataset.fav; }));
    const head = el('div', { class: 'row todo-head' }, el('b', { class: over ? 'm-warn' : '', text: t.text }),
      btn('My day…', dayWindow, 'btn small', { title: 'The hours in your day, and your quick checks' }));
    const zones = data.zones.map((z) => el('section', { class: 'todo-zone', 'data-zone': z.zone, 'aria-label': z.name },
      el('div', { class: 'row todo-zone-head' }, el('h3', { text: z.name }),
        btn('+ Add', () => addWindow(null, z.zone), 'btn small', { title: `Put a project in ${z.name}` })),
      z.items.length ? el('ul', { class: 'todo-list' }, ...z.items.map((it) => row(it, z.zone, open)))
        : el('p', { class: 'note todo-empty', text: z.zone === 'today' ? 'Nothing for today yet. Drag a project\'s name here, or + Add.' : 'Drag a project\'s name here, or + Add.' })));
    // Done today: always in view, under the three parts. Done before today: this week, this month, or hidden (Show earlier).
    const doneToday = data.doneToday.length ? el('section', { class: 'todo-zone todo-done-today', 'aria-label': 'Done today' },
      el('div', { class: 'row todo-zone-head' }, el('h3', { text: `Done today (${data.doneToday.length})` })),
      el('ul', { class: 'todo-list' }, ...data.doneToday.map((it) => row(it, null)))) : null;
    const e = data.doneEarlier;
    const showSel = el('select', { class: 'field-text short', 'aria-label': 'Show rows done before today' },
      ...[['week', 'This week'], ['month', 'This month'], ['hide', 'Hide']].map(([v, t]) => el('option', { value: v, selected: e.show === v }, t)));
    showSel.onchange = () => call('/api/todo/settings', { doneShow: showSel.value });
    const earlierList = e.items.length ? el('details', { class: 'todo-done', open: pane.querySelector('details.todo-done')?.open || null },
      el('summary', { text: `${e.name} (${e.items.length})` }), el('ul', { class: 'todo-list' }, ...e.items.map((it) => row(it, null))))
      : el('span', { class: 'note', text: e.show === 'hide' ? `Earlier done rows are hidden${e.hidden ? ` (${e.hidden} this week)` : ''}.` : `${e.name}: none.` });
    const done = el('div', { class: 'row todo-earlier' }, earlierList, el('label', { class: 'note todo-show' }, 'Show earlier ', showSel));
    const onTodo = new Set(data.zones.flatMap((z) => z.items.map((it) => it.project)));
    const favs = pickList().favs.filter((p) => !onTodo.has(p.id));
    const favPart = el('section', { class: 'todo-zone todo-favs', 'aria-label': 'Favourites' },
      el('div', { class: 'row todo-zone-head' }, el('h3', { text: `Favourites${favs.length ? ` (${favs.length})` : ''}` })),
      favs.length ? el('ul', { class: 'todo-list' }, ...favs.map((p) => favRow(p, open)))
        : el('p', { class: 'note todo-empty', text: pickList().favs.length ? 'Every favourite is on the To Do.' : 'No favourites yet: star a project (☆ beside its name) and it waits here.' }));
    const hint = el('p', { class: 'note', text: 'Drag a favourite (or a project\'s name from the Projects or Favourites tab) onto Today, This week or This month. Nothing drops off: a row stays until you tick it.' });
    app.swap(pane, head, ...zones, favPart, doneToday, done, hint);
  };

  // ---- dragging ----
  // From a project's name (a tile, the Favourites tab) or a row; onto a part of the To Do. Over the To Do tab, it opens.
  document.addEventListener('dragstart', (e) => {
    const p = e.target.closest?.('[data-todo-project]');
    const r = e.target.closest?.('.todo-row[data-item]');
    if (p) {
      e.dataTransfer.setData(PROJECT, p.dataset.todoProject);
      e.dataTransfer.setData('text/plain', (p.querySelector('b') || p).textContent.trim());
      // A favourite in the To Do carries the size picked on it.
      const sz = p.classList.contains('todo-fav') ? p.querySelector('select')?.value : '';
      if (sz) e.dataTransfer.setData(SIZE, sz);
      e.dataTransfer.effectAllowed = 'copy';
    }
    else if (r) { e.dataTransfer.setData(ITEM, r.dataset.item); e.dataTransfer.effectAllowed = 'move'; r.classList.add('is-dragging'); }
  });
  document.addEventListener('dragend', () => { for (const n of document.querySelectorAll('.is-dragging, .todo-zone.is-over')) n.classList.remove('is-dragging', 'is-over'); });
  const ours = (e) => e.dataTransfer && (e.dataTransfer.types.includes(ITEM) || e.dataTransfer.types.includes(PROJECT));
  const tab = document.getElementById('tab-todo');
  tab.addEventListener('dragenter', (e) => { if (ours(e) && app.sideTab !== 'todo') app.showTab('todo'); });
  tab.addEventListener('dragover', (e) => { if (ours(e)) e.preventDefault(); });
  const pane = document.getElementById('side-todo');
  pane.addEventListener('dragover', (e) => {
    const z = e.target.closest('.todo-zone[data-zone]');
    if (!z || !ours(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(ITEM) ? 'move' : 'copy';
    for (const o of pane.querySelectorAll('.todo-zone.is-over')) if (o !== z) o.classList.remove('is-over');
    z.classList.add('is-over');
  });
  pane.addEventListener('drop', (e) => {
    const z = e.target.closest('.todo-zone[data-zone]');
    if (!z || !ours(e)) return;
    e.preventDefault();
    z.classList.remove('is-over');
    const zone = z.dataset.zone;
    const item = e.dataTransfer.getData(ITEM);
    const project = e.dataTransfer.getData(PROJECT);
    if (item) {
      const before = e.target.closest('.todo-row[data-item]')?.dataset.item;
      call('/api/todo/move', { item, zone, ...(before && before !== item ? { before } : {}) });
    } else if (project) {
      const size = Number(e.dataTransfer.getData(SIZE)) || 60;
      call('/api/todo/add', { project, zone, size }, `${projectName(project)} is on the To Do: ${zoneName(zone)}, ${sizeWords(size)}.${size === 60 ? ' Change its size on the row.' : ''}`);
    }
  });
})();
