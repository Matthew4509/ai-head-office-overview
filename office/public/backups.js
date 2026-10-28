// Backups on the page (the engine is lib/backup.js): a Backup tick box and a backup mark on each project tile, Back up
// now in its More and Actions menus, "Run backups now" on the Projects tab's top line (a window listing every project
// ticked, with its size, the time it should take and the drive's free space, then the run itself), a project's
// backups window, Settings › Backups (drawn here, shown by settings.js), and the backup rows of Needs attention.
'use strict';

(() => {
  const app = window.aiOffice;
  const { el } = app;
  const eng = app.engineData;
  const sheet = document.getElementById('check');
  const proj = (id) => eng.projects.find((p) => p.id === id);
  const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const size = (n) => (n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
  const dur = (s) => (s == null ? '' : s < 60 ? 'under a minute' : s < 3600 ? `about ${Math.round(s / 60)} min` : `about ${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);
  const ago = (ms) => {
    const s = Math.max(0, Date.now() - ms) / 1000;
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    const d = Math.round(s / 86400); return `${d} ${d === 1 ? 'day' : 'days'} ago`;
  };
  const when = (ms) => new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const faultText = (e) => app.faultText(e);
  const btn = (label, onclick, primary = false, extra = {}) => el('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, onclick, ...extra }, label);
  const closeMenu = (e) => { const m = e.currentTarget.closest('details'); if (m) m.open = false; };
  const driveKind = (d) => (d.network ? 'network folder' : d.removable ? 'USB / removable' : 'fixed drive');
  const driveName = (d) => `${d.name}${d.label ? ` "${d.label}"` : ''}${d.letter ? ` (${d.letter}:)` : ''}`;

  async function setListed(ids, on) {
    try { await app.engine('/api/backup/list', { ids, on }); } catch (e) { app.showFault(e); }
    await app.loadProjects();
  }

  // ---- on a tile ----
  /** The Backup tick box (on the backup list or not) and, once there is something to say, the backups' state beside it in
   * the same pill as a symbol (● ▲ ○ ✕, or ◐ and the percent while it runs), so the tile's marks stay on one line. The
   * symbol opens the project's backups window; its words are in its tooltip. */
  app.backupTick = (p) => {
    const l = markOf(p);
    const tick = el('label', { class: 'bk-check', title: p.backup?.listed ? `${p.name} is on the backup list: Run backups now takes it` : `Put ${p.name} on the backup list` },
      el('input', { type: 'checkbox', checked: !!p.backup?.listed, 'data-act': 'backup-tick', 'data-id': p.id, onchange: (e) => setListed([p.id], e.target.checked) }), 'Backup');
    const tip = l ? tipOf(p) : '';
    const state = l ? el('button', { type: 'button', class: `bk-state ${l.cls}`, title: tip === 'No backup yet' ? l.text : `${l.text}. ${tip}`, 'aria-label': `Backup: ${l.text}`, 'data-act': 'backup', 'data-id': p.id, onclick: () => history(p.id) },
      el('span', { 'aria-hidden': 'true' }, p.backup.busy ? `${l.mark}${p.backup.busy.state === 'waiting' ? '' : ` ${p.backup.busy.pct}%`}` : l.mark)) : null;
    return el('span', { class: 'mark bk-tick' }, tick, state);
  };
  /** What the backups say: running now, failed, changed since, backed up, or never. Opens the project's backups window. */
  function markOf(p) {
    const b = p.backup;
    if (!b) return null;
    if (b.busy) return { mark: '◐', text: b.busy.state === 'waiting' ? 'Backup waiting' : `${b.busy.state === 'checking' ? 'Checking' : 'Backing up'} ${b.busy.pct}%`, cls: 'm-none' };
    if (b.fault) return { mark: '✕', text: 'Backup failed', cls: 'm-bad' };
    if (b.last && b.changed) return { mark: '▲', text: `Changed since ${ago(b.last.at)}`, cls: 'm-warn' };
    if (b.last) return { mark: '●', text: `Backed up ${ago(b.last.at)}`, cls: 'm-ok' };
    if (b.listed) return { mark: '○', text: 'Never backed up', cls: 'm-none' };
    return null;
  }
  /** The backups' tooltip: the failure, or each drive's last backup with what it did not follow or read. */
  function tipOf(p) {
    const b = p.backup;
    const left = (d) => [d.links ? `${d.links} ${d.links === 1 ? 'link or junction' : 'links or junctions'} not followed` : '', d.skipped ? `${d.skipped} ${d.skipped === 1 ? 'file' : 'files'} not read` : ''].filter(Boolean).join(', ');
    return b.fault ? `${b.fault.fault} ${b.fault.reason || ''}` : b.drives?.length ? `Last backups: ${b.drives.map((d) => `${ago(d.at)} on ${d.drive}${left(d) ? ` (${left(d)}: listed in the .txt beside the zip)` : ''}`).join(' · ')}` : 'No backup yet';
  }
  /** Back up now, in a tile's More menu and a person's Actions menu. */
  app.backupMenuItems = (p, cls = 'btn small') => [el('button', { type: 'button', class: cls, 'data-act': 'backup-now', 'data-id': p.id, title: `Zip ${p.name} to your backup drive now (it shows the size and time first)`,
    onclick: (e) => { closeMenu(e); openRun([p.id]); } }, 'Back up now…')];

  /** The Projects tab's top line: how many are on the list, Run backups now, Tick all / Untick all (of what is shown). */
  app.backupBar = (shown) => {
    const listed = eng.projects.filter((p) => p.backup?.listed);
    const ticked = shown.filter((p) => p.backup?.listed).length;
    return el('div', { class: 'row bk-bar' },
      el('b', { text: 'Backups' }), el('span', { class: 'note', text: listed.length ? `${plural(listed.length, 'project', 'projects')} on the list` : 'Tick Backup on a project to put it on the list' }),
      btn('Run backups now…', () => openRun(), !!listed.length, { class: `btn small${listed.length ? ' primary' : ''}`, title: 'See every project on the backup list, its size and how long it should take, then start' }),
      shown.length && ticked < shown.length ? btn('Tick all', () => setListed(shown.map((p) => p.id), true), false, { class: 'btn small', title: 'Put every project shown on the backup list' }) : null,
      ticked ? btn('Untick all', () => setListed(shown.filter((p) => p.backup?.listed).map((p) => p.id), false), false, { class: 'btn small', title: 'Take every project shown off the backup list' }) : null);
  };

  // ---- adding a drive (Settings › Backups, and the Run window when none is set up) ----
  /** The folder window (or `typed`, a path). Answers the words to show, and whether a drive was added. */
  async function addDrive(typed) {
    try {
      const r = await app.engine('/api/backup/drive/add', typed ? { path: typed } : {});
      if (r.cancelled) return { words: '' };
      if (r.dryRun) return { words: `Test copy: ${r.dryRun} would open. Type the folder instead.` };
      const d = r.drive;
      const extra = [r.already ? `${d.name} was already added.` : '', r.imported ? `It already holds ${plural(r.imported, 'backup', 'backups')}, now counted here too.` : '', ...(r.warnings || [])].filter(Boolean).join(' ');
      return { added: true, words: `Backups go to ${d.path} (${d.name}${d.free != null ? `, ${size(d.free)} free` : ''}). ${extra}`.trim() };
    } catch (e) { return { words: faultText(e) }; }
  }
  function typedPath(onAdd, label = 'Use this folder') {
    const input = el('input', { type: 'text', class: 'field-text', placeholder: 'E:\\ or E:\\Backups', 'aria-label': 'Backup folder path', spellcheck: 'false' });
    return el('details', { class: 'bk-typed' }, el('summary', { class: 'note', text: 'Or type the folder' }),
      el('div', { class: 'row' }, input, btn(label, () => (input.value.trim() ? onAdd(input.value.trim()) : input.focus()))));
  }

  // ---- Run backups now ----
  let run = null; // { ids, off: Set, drive, plan }
  let poll = 0;
  const isOpen = () => !sheet.hidden && sheet.firstElementChild?.dataset.kind === 'backup';
  const markWindow = () => { if (sheet.firstElementChild) sheet.firstElementChild.dataset.kind = 'backup'; };
  async function openRun(ids) {
    clearTimeout(poll);
    // A run under way: its progress, whatever was asked.
    let st = null;
    try { st = (await app.engine('/api/backup/status')).job; } catch { /* drawn as not running */ }
    if (st && !st.finished) return drawJob(st);
    const list = ids || eng.projects.filter((p) => p.backup?.listed).map((p) => p.id);
    run = { ids: list, off: new Set(), drive: run?.drive || null, plan: null };
    if (!list.length) {
      app.openWindow('Run backups now', [el('p', { text: 'No project is on the backup list yet.' }),
        el('p', { class: 'note', text: 'Tick Backup on each project tile you want backed up (or Tick all on the top line), then come back here. The list is kept.' })],
      [btn('Close', app.closeWindow, true)]);
      return markWindow();
    }
    await planAndDraw();
  }
  app.openBackupRun = openRun;
  async function planAndDraw(note = '') {
    app.openWindow('Run backups now', [el('p', { class: 'note', text: `Working out the size of ${plural(run.ids.length, 'project', 'projects')}…` })], [btn('Close', app.closeWindow, true)]);
    markWindow();
    try { run.plan = await app.engine('/api/backup/plan', { ids: run.ids, drive: run.drive }); } catch (e) {
      app.openWindow('Run backups now', [el('p', { text: faultText(e) })], [btn('Close', app.closeWindow, true)]);
      return markWindow();
    }
    if (run.plan.drive) run.drive = run.plan.drive.id;
    drawPlan(note);
  }
  function drawPlan(note = '') {
    const pl = run.plan;
    const said = el('p', { class: 'note check-said', role: 'status', text: note });
    const look = btn('Look again', () => planAndDraw());
    // No drive yet: one click to choose where.
    if (!pl.drives.length) {
      const add = async (typed) => { const r = await addDrive(typed); if (r.added) return planAndDraw(r.words); said.textContent = r.words; };
      app.openWindow('Run backups now', [
        el('p', { text: 'Backups are not turned on yet: choose where they go first. A USB drive is best, so a copy survives this PC.' }), said,
        el('div', { class: 'row' }, btn('Choose where backups go…', () => add(), true)), typedPath(add)],
      [btn('Close', app.closeWindow)]);
      return markWindow();
    }
    const here = pl.drives.filter((d) => d.here);
    let driveLine;
    if (pl.choose || (run.drive && !pl.drive)) {
      const pick = el('select', { class: 'field-text short', 'aria-label': 'Backup drive', onchange: (e) => { run.drive = e.target.value || null; planAndDraw(); } },
        el('option', { value: '', text: 'Choose a drive…' }), ...here.map((d) => el('option', { value: d.id, text: `${driveName(d)} · ${size(d.free || 0)} free` })));
      driveLine = el('div', { class: 'row' }, el('b', { text: `${here.length} backup drives are plugged in: back up to` }), pick);
    } else if (!pl.drive || !pl.drive.here) {
      driveLine = el('div', {}, el('p', { class: 'm-warn', text: `▲ No backup drive is plugged in. ${pl.drives.map(driveName).join(', ')} ${pl.drives.length > 1 ? 'are' : 'is'} not found on this PC now.` }),
        el('p', { class: 'note', text: 'Plug one in and press Look again, or add another drive under Settings › Backups.' }));
    } else {
      const d = pl.drive;
      driveLine = el('p', {}, el('b', { text: `To ${driveName(d)}` }), ` · ${driveKind(d)} · ${size(d.free || 0)} free${d.movedFrom ? ` · found under ${d.letter}: (it was ${d.movedFrom}: before)` : ''}`,
        here.length > 1 ? el('button', { type: 'button', class: 'btn link', onclick: () => { run.drive = null; run.plan.choose = true; drawPlan(); } }, ' Change drive') : null);
    }
    const on = (r) => !r.error && !run.off.has(r.id);
    const rows = pl.rows.map((r) => el('li', { class: 'open-row bk-row' },
      el('label', { class: 'bk-pick' }, el('input', { type: 'checkbox', checked: on(r), disabled: !!r.error, onchange: (e) => { if (e.target.checked) run.off.delete(r.id); else run.off.add(r.id); drawPlan(); } }),
        el('span', { class: 'open-what' }, el('b', { text: r.name }),
          el('span', { class: r.error ? 'm-bad' : 'note', text: r.error ? `✕ ${r.error}` : `${plural(r.files, 'file', 'files')} · ${size(r.bytes)}${r.sure ? `, zip about ${size(r.zip)}` : ''}${Object.keys(r.leftOut || {}).length ? ` · leaves out ${Object.keys(r.leftOut).join(', ')}` : ''}` }))),
      el('span', { class: 'note bk-when', text: [r.secs != null ? dur(r.secs) : '', r.last ? `last ${ago(r.last.at)} on ${r.last.drive}` : 'never backed up'].filter(Boolean).join(' · ') })));
    const picked = pl.rows.filter(on);
    const tot = { bytes: picked.reduce((s, r) => s + r.bytes, 0), zip: picked.reduce((s, r) => s + r.zip, 0), secs: picked.reduce((s, r) => s + (r.secs || 0), 0) };
    const d = pl.drive && pl.drive.here ? pl.drive : null;
    const left = d && d.free != null ? d.free - tot.zip : null;
    const fits = left == null ? null : left >= 256e6;
    const sum = !picked.length ? el('p', { class: 'note', text: 'Nothing ticked.' }) : el('div', { class: 'bk-sum' },
      el('p', {}, el('b', { text: `${plural(picked.length, 'project', 'projects')} · ${size(tot.bytes)}${d ? ` · ${dur(tot.secs)}` : ''}` }),
        d && pl.firstGuess ? el('span', { class: 'note', text: ' (a first guess: the time is learnt from this drive\'s first backup)' }) : null),
      d ? el('p', { class: fits ? 'note' : 'm-bad', text: fits
        ? `Needs up to ${size(tot.zip)}; ${d.name} has ${size(d.free)} free, so about ${size(left)} is left after.`
        : `✕ It will not fit: it needs up to ${size(tot.zip)}, and ${d.name} has ${size(d.free)} free. Nothing is ever deleted to make room: untick some projects, or plug in another drive and add it under Settings › Backups.` }) : null);
    const start = btn('Start', async (e) => {
      const b = e.currentTarget;
      b.disabled = true; b.textContent = 'Starting…'; // the drive is looked for again first (a few seconds)
      try { const r = await app.engine('/api/backup/start', { ids: picked.map((r) => r.id), drive: run.drive }); drawJob(r.job); app.loadProjects(); } catch (err) { said.textContent = faultText(err); b.disabled = false; b.textContent = 'Start'; }
    }, true, { disabled: !(d && fits && picked.length), title: 'Each project is zipped, then read back and checked, one at a time. The office keeps working meanwhile.' });
    const kind = el('p', { class: 'note', text: pl.full ? 'Full backup: the rebuildable folders (node_modules and the like) go in too. Settings › Backups › What is in a backup.' : 'Rebuildable folders (node_modules and the like) are left out. Settings › Backups › Full backup takes them too.' });
    app.openWindow('Run backups now', [driveLine, said, el('ul', { class: 'open-list' }, rows), sum, kind,
      el('p', { class: 'note', text: 'Each zip is read back and every file checked before it counts. Backups are only added: nothing on the drive is deleted.' })],
    [look, btn('Close', app.closeWindow), start]);
    markWindow();
  }

  const STATE = { waiting: ['○', 'Waiting', 'm-none'], zipping: ['◐', 'Zipping', 'm-none'], checking: ['◑', 'Checking', 'm-none'], done: ['✓', 'Checked', 'm-ok'], failed: ['✕', 'Failed', 'm-bad'], skipped: ['–', 'Not done', 'm-warn'], cancelled: ['–', 'Cancelled', 'm-none'] };
  function drawJob(j) {
    clearTimeout(poll);
    if (!j) return;
    const busy = !j.finished;
    const rows = j.items.map((i) => {
      const [mark, word, cls] = STATE[i.state] || ['?', i.state, 'm-none'];
      const detail = i.state === 'done' ? [size(i.bytes), plural(i.files, 'file', 'files'), i.secs != null ? `${i.secs} s` : ''].filter(Boolean).join(' · ')
        : ['zipping', 'checking'].includes(i.state) ? `${i.pct}%` : i.state === 'waiting' && i.est != null ? dur(i.est) : i.note || '';
      return el('li', { class: 'open-row bk-row' }, el('span', { class: 'open-what' }, el('b', { text: i.name }),
        el('span', { class: cls, text: `${mark} ${word}${detail ? ` · ${detail}` : ''}` }),
        ['zipping', 'checking'].includes(i.state) ? el('progress', { class: 'bk-progress', max: '100', value: String(i.pct), 'aria-label': `${i.name} ${i.pct}%` }) : null,
        i.state === 'done' && i.note ? el('span', { class: 'note', text: i.note }) : null,
        i.fault ? el('span', { class: 'note', text: [i.fault.fault, i.fault.reason, i.fault.wayOut].filter(Boolean).join(' ') }) : null));
    });
    const done = j.items.filter((i) => i.state === 'done').length;
    const head = busy ? el('p', {}, el('b', { text: `Backing up to ${j.drive}…` }), el('span', { class: 'note', text: ' You can close this window: the backup goes on, and its progress shows on each tile.' }))
      : el('p', {}, el('b', { text: `${done} of ${j.items.length} backed up and checked on ${j.drive}.` }),
        done && j.removable ? el('span', { class: 'note', text: ' Safe to unplug the drive once Windows says so (the eject icon by the clock).' }) : null);
    app.openWindow('Run backups now', [head, el('ul', { class: 'open-list' }, rows)],
      busy ? [btn('Cancel', async (e) => { e.currentTarget.disabled = true; try { await app.engine('/api/backup/cancel', {}); } catch (err) { app.showFault(err); } }, false, { title: 'Stops after the file being written: the unfinished zip is removed' }), btn('Close', app.closeWindow, true)]
        : [btn('Back up again…', () => openRun(j.items.map((i) => i.id))), btn('Close', app.closeWindow, true)]);
    markWindow();
    if (busy) poll = setTimeout(async () => {
      if (!isOpen()) return;
      try { drawJob((await app.engine('/api/backup/status')).job); } catch { /* the office is restarting */ }
    }, 700);
    else app.loadProjects();
  }

  // ---- one project's backups ----
  async function history(id) {
    let h;
    try { h = await app.engine(`/api/backup/history?id=${encodeURIComponent(id)}`); } catch (e) { return app.showFault(e); }
    const p = proj(id) || { id, name: h.name };
    const b = h.backup;
    const body = [
      b.fault ? el('p', { class: 'm-bad', text: `✕ The last try failed: ${[b.fault.fault, b.fault.reason, b.fault.wayOut].filter(Boolean).join(' ')}` }) : null,
      b.changed ? el('p', { class: 'm-warn', text: `▲ ${h.name} changed after its last backup (${ago(b.last.at)}).` }) : null,
      h.history.length ? el('ul', { class: 'open-list' }, h.history.map((x) => el('li', { class: 'open-row bk-row' },
        el('span', { class: 'open-what' }, el('b', { text: when(x.at) }), el('span', { class: 'note', text: `${x.driveName} · ${x.file}` })),
        el('span', { class: x.checked ? 'm-ok' : 'm-warn', text: `${x.checked ? '✓ checked' : 'not checked'} · ${size(x.bytes)} · ${plural(x.files, 'file', 'files')}` }))))
        : el('p', { class: 'note', text: 'No backup yet.' }),
      el('label', { class: 'tick-row' }, el('input', { type: 'checkbox', checked: b.listed, onchange: async (e) => { await setListed([id], e.target.checked); } }),
        el('span', { text: `On the backup list (Run backups now takes ${h.name})` })),
    ];
    app.openWindow(`Backups · ${h.name}`, body, [btn('Back up now…', () => openRun([p.id]), true), btn('Close', app.closeWindow)]);
  }
  app.backupHistory = history;

  // ---- Settings › Backups (settings.js shows it; say() is its status line, again() draws the tab again) ----
  app.drawBackupSettings = async (say, again) => {
    const v = await app.engine('/api/backup');
    const after = async (r) => { say(r.words); if (r.added) { await app.loadProjects(); again(); } };
    const add = async (typed) => after(await addDrive(typed));
    const keep = el('select', { class: 'field-text short', 'aria-label': 'How many backups to keep', title: 'Only zips the office made and recorded are ever deleted, and only after a newer one passed its check.' },
      [[0, 'Keep every backup (nothing is deleted)'], [3, 'Keep the last 3 per project'], [5, 'Keep the last 5 per project'], [10, 'Keep the last 10 per project']].map(([n, t]) => el('option', { value: String(n), selected: v.keepLast === n, text: t })));
    // Saved as soon as it is picked.
    keep.addEventListener('change', async () => { try { const r = await app.engine('/api/backup/keep', { keep: Number(keep.value) }); say(r.keepLast ? `The last ${r.keepLast} backups of each project are kept on each drive; older ones are deleted after a new one passes its check.` : 'Every backup is kept. Nothing is deleted.'); } catch (e) { say(faultText(e)); } });
    const more = (...a) => app.settingsMore(...a);
    const note = (t) => el('p', { class: 'note', text: t });
    const listed = eng.projects.filter((p) => p.backup?.listed).length;
    const driveRow = (d) => el('div', { class: 'set-row' },
      el('div', { class: 'set-txt' }, el('b', { text: driveName(d) }),
        el('span', { class: 'note', text: d.here
          ? [driveKind(d), d.free != null ? `${size(d.free)} free of ${size(d.total)}` : '', plural(d.backups, 'backup', 'backups'), d.lastAt ? `last ${ago(d.lastAt)}` : '', d.movedFrom ? `now ${d.letter}:, was ${d.movedFrom}:` : ''].filter(Boolean).join(' · ')
          : `Not plugged in · ${plural(d.backups, 'backup', 'backups')} on it${d.lastAt ? `, the last ${ago(d.lastAt)}` : ''}` }),
        el('span', { class: 'note', text: d.path || '' })),
      el('div', { class: 'row set-acts' },
        d.here ? btn('Open', async () => { try { const r = await app.engine('/api/backup/drive/open', { drive: d.id }); if (r.dryRun) say(`Test copy, not opened: ${r.dryRun}`); } catch (e) { say(faultText(e)); } }) : null,
        btn('Forget', async () => {
          if (!confirm(`Forget ${d.name}? The office stops using it. Its backups stay on the drive, and adding it again brings them back.`)) return;
          try { await app.engine('/api/backup/drive/forget', { drive: d.id }); say(`${d.name} is forgotten. Its backups were not touched.`); await app.loadProjects(); again(); } catch (e) { say(faultText(e)); }
        })));
    return [
      note('Zips of your projects on a drive you choose (a USB drive is best), each read back and checked.'),
      v.drives.length ? null : el('div', { class: 'row' }, btn('Turn on backups: choose where they go…', () => add(), true)),
      v.drives.length ? null : typedPath(add),
      v.drives.length ? el('h3', { text: 'Backup drives' }) : null,
      ...v.drives.map(driveRow),
      v.drives.length ? el('div', { class: 'row' }, btn('Add another drive…', () => add()), typedPath(add, 'Add this folder')) : null,
      v.drives.length ? note('A full drive keeps its backups: plug in another and add it here.') : null,
      v.drives.length ? more('How drives work', note('Backups are only ever added. When a drive is full, plug in another and add it here: the full one keeps its backups and stays on this list. With two plugged in, Run backups now asks which to use. A drive is known by its serial number, so a new letter (E: one day, F: the next) does not matter.')) : null,
      el('h3', { text: 'The backup list' }),
      el('div', { class: 'row' }, el('span', { text: listed ? `${plural(listed, 'project', 'projects')} on the list.` : 'No project on the list yet: tick Backup on a project tile.' }),
        btn('Run backups now…', () => { document.getElementById('setup').hidden = true; openRun(); }, !!listed)),
      el('div', { class: 'row set-line' }, el('span', { class: 'set-label', text: 'Keep' }), keep),
      el('h3', { text: 'What goes in' }),
      note(v.full ? 'Everything in the project\'s folder, with its git history and the rebuildable folders.' : 'Everything in the project\'s folder, with its git history. Left out: folders a project rebuilds by itself (node_modules and the like).'),
      el('label', { class: 'tick-row' }, el('input', { type: 'checkbox', checked: v.full, 'data-act': 'backup-full', onchange: async (e) => {
        try { const r = await app.engine('/api/backup/full', { on: e.target.checked }); say(r.full ? 'Full backup is on: the rebuildable folders go in too, so backups are bigger and slower.' : 'Full backup is off: the rebuildable folders are left out again.'); again(); } catch (err) { say(faultText(err)); e.target.checked = !e.target.checked; }
      } }), el('span', {}, el('b', { text: 'Full backup' }), el('span', { class: 'note', text: ': take those too (bigger and slower, nothing to rebuild)' }))),
      note('To restore: right-click a zip › Extract All.'),
      more('What is left out, and where it goes',
        v.full ? null : note(`Left out unless Full backup is ticked: ${v.leaveOut}.`),
        note('A file that is locked or in use is listed in the .txt beside the zip; the rest still go in.'),
        note(`On the drive: ${v.folderName}\\<project>\\<project>-<date>-<time>.zip, a .txt beside each saying what is in it, and an index the office reads when the drive is added on another PC.`)),
    ];
  };

  // ---- Needs attention: projects on the backup list that failed, were never backed up, or changed a week ago ----
  const before = app.moreWaiting;
  app.moreWaiting = (folder) => {
    const items = before ? before(folder) : [];
    const links = app.data?.links || {};
    const folderOf = Object.fromEntries(Object.entries(links).map(([f, id]) => [id, f]));
    const mine = [];
    for (const p of eng.projects) {
      const a = p.backup?.attention;
      if (!a || p.hiddenView) continue;
      if (typeof folder === 'function' ? !folder(folderOf[p.id], p) : folder !== null && folder !== undefined && folderOf[p.id] !== folder) continue;
      const sub = a === 'failed' ? `${p.backup.fault.fault} ${p.backup.fault.wayOut || ''}` : a === 'never' ? 'On the backup list, never backed up.' : `Changed since its last backup, ${ago(p.backup.last.at)}.`;
      mine.push({ kind: 'backup', cls: a === 'failed' ? 'm-bad' : 'm-warn', title: `${a === 'failed' ? '✕' : '▲'} Backup · ${p.name}`, sub, open: () => history(p.id), rank: 3 });
    }
    return [...items, ...mine.sort((x, y) => x.title.localeCompare(y.title))];
  };
})();
