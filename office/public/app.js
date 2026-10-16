// AI Head Office Overview page: asks the office (/api/office/state) for everyone every 3 seconds and draws the projects strip,
// the right panel's tabs (Needs attention, Staff rewards) and a person's card. The office drawing itself is
// office.js (window.officeView); the Projects tab, Run / Stop and the Running strip are projects.js.
'use strict';

(() => {
  const STATES = {
    working: { icon: '▶', word: 'Working' },
    thinking: { icon: '💭', word: 'Thinking' },
    needs: { icon: '?', word: 'Needs you' },
    idle: { icon: '☕', word: 'Idle' },
    home: { icon: '⌂', word: 'Gone home' },
  };
  const ORDER = ['needs', 'working', 'thinking', 'idle', 'home'];
  const app = {
    data: null,
    project: null, // folder key of the project picked in the strip, or null for all
    picked: null, // person key
    editing: false,
    showAll: false,
    view: 'office',
  };
  window.aiOffice = app;

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  app.el = el;

  /** Puts new contents in a box only when they differ: a box rebuilt under the pointer loses the click. */
  function swap(box, ...kids) {
    const next = document.createElement(box.tagName);
    next.append(...kids.flat().filter(Boolean));
    if (next.innerHTML === box.innerHTML) return false;
    box.replaceChildren(...next.childNodes);
    return true;
  }
  app.swap = swap;

  const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n || 0));
  app.tokens = tokens;
  function ago(ms) {
    if (!ms) return '';
    const s = Math.max(0, (app.data?.now || Date.now()) - ms) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  }
  function lasted(ms) {
    if (!ms) return '';
    const s = Math.max(0, (app.data?.now || Date.now()) - ms) / 1000;
    if (s < 60) return 'under a minute';
    if (s < 3600) return `${Math.round(s / 60)} min`;
    return `${(s / 3600).toFixed(1)} h`;
  }
  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const projectName = (folder) => folder || 'Consultants';
  const where = (p) => `${p.folder || 'Projects folder'}, seat ${p.seat}`;

  function stateTag(state) {
    const s = STATES[state] || STATES.home;
    return el('span', { class: `state state-${state}` }, `${s.icon} ${s.word}`);
  }

  function face(p, size = 34) {
    // The look is written on the box: a drawing is not in the page's text, so without it a changed look would look
    // "the same" to swap() and the old picture would stay.
    const box = el('span', { class: 'face', 'aria-hidden': 'true', 'data-look': p.look ? Object.values(p.look).join('.') : 'made-up' });
    const pic = window.officeLook?.portrait?.(p, size);
    if (pic) box.append(pic);
    else box.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
    return box;
  }
  app.face = face;

  function showFault(e) {
    const box = document.getElementById('fault');
    if (!e) { box.hidden = true; return; }
    const f = e.error || {};
    box.textContent = f.fault ? `${f.fault} ${f.reason || ''} ${f.wayOut || ''}`.trim()
      : 'The office is not answering. It may still be starting (its first read of your transcripts can take a minute), or its window was closed. Keep the AI Head Office Overview window open, or start it again with start.cmd: this page catches up by itself.';
    box.hidden = false;
  }
  app.showFault = showFault;

  // Every request carries the key this page was served with; the office's own API lives under /api/office/.
  const KEY = document.querySelector('meta[name="aho-key"]')?.content || '';
  async function api(url, body) {
    const to = url.replace(/^\/api\/(?!office\/)/, '/api/office/');
    const headers = { 'x-aho-key': KEY };
    const r = await fetch(to, body === undefined ? { cache: 'no-store', headers } : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    // A key from an earlier run: the app was restarted, so this page is reloaded to get the new one.
    if (r.status === 403) { setTimeout(() => location.reload(), 500); throw { error: { fault: 'The office was restarted.', reason: 'This page is from its earlier run.', wayOut: 'It reloads by itself.' } }; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw d.error ? d : new Error(`answer ${r.status}`);
    return d;
  }
  app.api = api;

  // What is shown: everyone, one project (app.project, a desk's folder) or every project in one working folder
  // (app.folder, a path from Settings › Folders). app.filterBy says which list Filter by shows.
  app.filterBy = 'project';
  app.folder = null;
  // Above Filter by: Show names (the staff's names in the office) and PC name (the project's name above each desk's
  // computer), both on until unticked, to see the staff better or for a screenshot. Kept in this browser only.
  const remembered = (k) => { try { return localStorage.getItem(k) !== 'off'; } catch { return true; } };
  app.showNames = remembered('aho-show-names');
  app.showPcName = remembered('aho-show-pc-name');
  try { if (localStorage.getItem('aho-filter-by') === 'folder') app.filterBy = 'folder'; } catch { /* fine */ }
  const sameFolder = (a, b) => !!a && !!b && a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();
  /** Is a desk's folder (and its project, when known) in what is shown? */
  function inFilter(folder, project) {
    if (app.folder !== null) return sameFolder(project ? project.workingFolder : app.workingFolderOf?.(folder), app.folder);
    return app.project === null || folder === app.project;
  }
  app.inFilter = inFilter;
  // Consultants (the projects folder itself) is the folder "", so "all" is written apart from it: picking Consultants is a
  // change of filter, not "everyone left".
  app.filterKey = () => `${app.project === null ? '*' : `p:${app.project}`}|${app.folder ?? ''}`;

  function people() {
    const all = app.data?.people || [];
    const today = new Set((app.data?.projects || []).flatMap((pr) => pr.people));
    return all.filter((p) => inFilter(p.folder) && (app.showAll || today.has(p.key) || p.state !== 'home'));
  }
  app.visiblePeople = people;
  /** Everyone the office draws: the people above, and the favourites who have gone home (not hidden), in what is shown. */
  function officePeople() {
    const ps = people();
    const have = new Set(ps.map((p) => p.key));
    const favs = (app.data?.people || []).filter((p) => p.fav && !p.favHidden && !have.has(p.key) && inFilter(p.folder));
    return [...ps, ...favs];
  }

  /** Filter by, down the left of the office: a choice of Project or Working folder, then the list for it. Projects: All
   * projects, then each project with someone in today and who is doing what in words ("1 working · 1 needs you").
   * Working folders: All folders, then each folder from Settings › Folders with its projects and people today. */
  function drawProjects() {
    const nav = document.getElementById('projects');
    const prs = app.data.projects;
    const row = (on, pick, name, sub, title) => el('li', {}, el('button', { type: 'button', class: 'filter-item', 'aria-pressed': String(on), title, onclick: pick },
      el('span', { class: 'filter-name', text: name }), sub ? el('span', { class: 'filter-sub' }, sub) : null));
    const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    const says = (pr) => ORDER.filter((s) => pr[s]).map((s) => el('span', { class: `state-${s}` }, `${pr[s]} ${STATES[s].word.toLowerCase()}`)).flatMap((x, i) => (i ? [' · ', x] : [x]));
    const peopleIn = (list) => list.reduce((k, pr) => k + pr.people.length, 0);
    const choose = el('select', { id: 'filter-by', class: 'filter-by', 'aria-label': 'Filter by', onchange: (e) => setFilterBy(e.target.value) },
      el('option', { value: 'project', selected: app.filterBy === 'project' }, 'Project'),
      el('option', { value: 'folder', selected: app.filterBy === 'folder' }, 'Working folder'));
    let items;
    if (app.filterBy === 'folder') {
      const folders = app.workingFolders?.() || [];
      const deskIn = (f) => prs.filter((pr) => sameFolder(app.workingFolderOf?.(pr.folder), f));
      items = [row(app.folder === null, () => pickFolder(null), 'All folders', `${n(folders.length, 'working folder', 'working folders')} · ${n(peopleIn(prs), 'person', 'people')}`, 'Show everyone in every working folder'),
        ...folders.map((f) => {
          const name = f.split(/[\\/]/).filter(Boolean).pop() || f;
          const desks = deskIn(f);
          return row(sameFolder(app.folder, f), () => pickFolder(f), name, `${n(desks.length, 'project', 'projects')} in today · ${n(peopleIn(desks), 'person', 'people')}`, `Show only the projects in ${f}`);
        })];
    } else {
      items = [row(app.project === null, () => pickProject(null), 'All projects', `${n(prs.length, 'project', 'projects')} · ${n(peopleIn(prs), 'person', 'people')}`, 'Show everyone in every project'),
        ...prs.map((pr) => row(app.project === pr.folder, () => pickProject(pr.folder), projectName(pr.folder), says(pr), `Show only ${projectName(pr.folder)}: ${n(pr.people.length, 'person', 'people')}`))];
    }
    const tick = (label, on, key, set) => el('label', { class: 'name-tick' }, el('input', { type: 'checkbox', checked: on,
      onchange: (e) => { set(e.target.checked); try { localStorage.setItem(key, e.target.checked ? 'on' : 'off'); } catch { /* fine */ } } }), ` ${label}`);
    const ticks = el('div', { class: 'name-ticks' },
      tick('Show names', app.showNames, 'aho-show-names', (on) => { app.showNames = on; window.officeView?.refresh?.(); }),
      tick('PC name', app.showPcName, 'aho-show-pc-name', (on) => { app.showPcName = on; window.officeView?.refresh?.(); }));
    swap(nav, ticks, el('div', { class: 'filter-head' }, el('h2', { id: 'filter-title', text: 'Filter by' }), choose),
      el('ul', { class: 'filter-list' }, ...items),
      prs.length ? null : el('p', { class: 'empty', text: 'No threads today yet.' }));
  }

  /** Project or Working folder: switching shows everyone again, then the new list to pick from. */
  function setFilterBy(by) {
    app.filterBy = by === 'folder' ? 'folder' : 'project';
    try { localStorage.setItem('aho-filter-by', app.filterBy); } catch { /* fine */ }
    app.project = null;
    app.folder = null;
    draw();
    document.getElementById('filter-by')?.focus();
  }
  app.pickProject = (folder) => pickProject(folder);
  function pickProject(folder) {
    app.project = folder;
    app.folder = null;
    // A desk clicked in the office while the list shows working folders: the list turns to projects, to show which.
    if (folder !== null && app.filterBy !== 'project') { app.filterBy = 'project'; try { localStorage.setItem('aho-filter-by', 'project'); } catch { /* fine */ } }
    draw();
  }
  function pickFolder(path) {
    app.folder = path;
    app.project = null;
    draw();
  }

  function personRow(p) {
    // The note: what they asked (needs you), the step they are on, or when they were last seen.
    const asked = p.state === 'needs' ? (app.data?.waiting || []).find((w) => w.person === p.key)?.asked : '';
    const note = asked || (p.state === 'home' ? (p.lastAt ? `Last seen ${ago(Date.parse(p.lastAt))}` : '') : p.words);
    return el('li', {}, el('button', {
      type: 'button',
      class: 'person',
      'aria-current': String(app.picked === p.key),
      onclick: () => pick(p.key),
    },
    // Every tile the same size: picture on the left, name over folder beside it; then the status; then the note,
    // whose two lines are kept even when empty, so a tile never grows or shrinks as its note comes and goes.
    el('span', { class: 'tile-top' }, face(p, 40), el('span', { class: 'tile-who' }, el('b', { class: 'tile-name', text: p.name }), el('span', { class: 'tile-sub', text: projectName(p.folder) }))),
    el('span', { class: 'tile-action' }, stateTag(p.state)),
    el('span', { class: 'tile-note', text: note && note !== STATES[p.state]?.word ? note : '' })));
  }

  function drawList() {
    const box = document.getElementById('list-view');
    const ps = people();
    if (app.drawProjectTiles) return app.drawProjectTiles(box, ps);
    const groups = ORDER.map((s) => ({ s, list: ps.filter((p) => p.state === s) })).filter((g) => g.list.length);
    const toggle = el('label', { class: 'row note' }, el('input', { type: 'checkbox', checked: app.showAll, onchange: (e) => { app.showAll = e.target.checked; draw(); } }), 'Show everyone, not only today');
    swap(box, toggle, ...groups.map((g) => el('section', { class: 'group' }, el('h2', {}, stateTag(g.s), ` (${g.list.length})`), el('ul', { class: 'people' }, g.list.map(personRow)))), groups.length ? null : el('p', { class: 'empty', text: 'Nobody here today. Start a thread in Claude and they come in.' }));

  }

  const TABS = { needs: 'Needs attention', rewards: 'Staff rewards' };
  app.sideTab = 'needs';
  try { const s = localStorage.getItem('aho-side'); if (s === 'rewards') app.sideTab = s; } catch { /* fine */ }

  /** The right panel: its two tabs, or a person's card (or their nickname box) in their place. */
  function drawSide() {
    const showCard = app.editing || !!app.picked;
    document.querySelector('.side-tabs').hidden = showCard;
    document.getElementById('side-card').hidden = !showCard;
    const needsPane = document.getElementById('side-needs');
    const rewardsPane = document.getElementById('side-rewards');
    const wasHidden = rewardsPane.hidden;
    needsPane.hidden = showCard || app.sideTab !== 'needs';
    rewardsPane.hidden = showCard || app.sideTab !== 'rewards';
    for (const [id, word] of Object.entries(TABS)) {
      const b = document.getElementById(`tab-${id}`);
      b.setAttribute('aria-selected', String(app.sideTab === id));
      const label = id === 'needs' ? `${word} (${waitingList().length + (app.moreWaiting?.(inFilter) || []).length})` : word;
      if (b.textContent !== label) b.textContent = label;
    }
    if (showCard) return;
    if (app.sideTab === 'needs') drawWaiting();
    // Staff rewards is drawn when it is opened (and after a purchase); while open only its purse line changes.
    else if (wasHidden || !rewardsPane.childElementCount) window.officeView?.rewards?.(rewardsPane);
  }

  function showTab(id) {
    app.sideTab = id;
    try { localStorage.setItem('aho-side', id); } catch { /* fine */ }
    app.picked = null;
    app.editing = false;
    drawSide();
  }
  app.showTab = showTab;
  document.getElementById('tab-needs').addEventListener('click', () => showTab('needs'));
  document.getElementById('tab-rewards').addEventListener('click', () => showTab('rewards'));
  document.getElementById('purse').addEventListener('click', () => showTab('rewards'));

  const waitingList = () => (app.data?.waiting || []).filter((w) => inFilter(w.folder));

  /**
   * Favourites: each project with a favourite, its name as a subtitle and its favourite staff in a row. A favourite who
   * has gone home has a small Hide box (hidden ones leave this tab and the beach, and come back with "Show hidden").
   */
  function drawFavs() {
    const box = document.getElementById('favs-view');
    const favs = (app.data?.people || []).filter((p) => p.fav && inFilter(p.folder));
    const hiddenCount = favs.filter((p) => p.favHidden && p.state === 'home').length;
    const shown = favs.filter((p) => app.showHiddenFavs || !p.favHidden || p.state !== 'home');
    const folders = [...new Set(shown.map((p) => p.folder))].sort((a, b) => projectName(a).localeCompare(projectName(b)));
    const hideBox = (p) => el('label', { class: 'fav-hide note' }, el('input', {
      type: 'checkbox',
      checked: !!p.favHidden,
      onchange: async (e) => {
        try { await api('/api/favourite', { folder: p.folder, seat: p.seat, hidden: e.target.checked }); showFault(null); await refresh(); } catch (err) { showFault(err); }
      },
    }), 'Hide');
    const tile = (p) => {
      const li = personRow(p);
      if (p.state === 'home') li.append(hideBox(p));
      return li;
    };
    const groups = folders.map((f) => {
      const list = shown.filter((p) => p.folder === f).sort((a, b) => a.seat - b.seat);
      const whole = (app.data.favProjects || []).includes(f);
      return el('section', { class: 'group' }, el('h2', {}, projectName(f), whole ? el('span', { class: 'note', text: ' · the whole project' }) : null), el('ul', { class: 'people' }, list.map(tile)));
    });
    const toggle = hiddenCount || app.showHiddenFavs ? el('label', { class: 'row note' }, el('input', { type: 'checkbox', checked: !!app.showHiddenFavs, onchange: (e) => { app.showHiddenFavs = e.target.checked; draw(); } }), `Show hidden (${hiddenCount})`) : null;
    const intro = el('p', { class: 'note', text: 'Favourites stay on call, so they are either in the office or on the beach until needed.' });
    const picked = app.project !== null || app.folder !== null;
    swap(box, intro, toggle, ...groups, groups.length ? null : el('p', { class: 'empty', text: picked ? 'No favourites in what Filter by shows. Pick All projects to see them all.' : 'No favourites yet. Open someone\'s card and press Favourite, or Favourite project for everyone in that project.' }));
  }

  function drawWaiting() {
    const pane = document.getElementById('side-needs');
    const list = waitingList();
    const items = list.map((w) => el('li', {}, el('button', { type: 'button', class: 'wait', onclick: () => pick(w.person) },
      el('b', { text: `${w.name} · ${projectName(w.folder)}` }),
      el('span', { class: 'meta', text: `${w.gone ? 'Gone home, still waiting · ' : ''}asked ${ago(w.since)} · ${w.title}` }),
      el('q', { text: w.asked }))));
    // One list: threads waiting for an answer first, then projects waiting (live site down, High findings, git to save or push).
    // Each row opens its window; the row is found again by its place in the list at click time.
    const more = app.moreWaiting?.(inFilter) || [];
    const moreItems = more.map((m, i) => el('li', {}, el('button', { type: 'button', class: `wait wait-${m.kind}`, 'data-i': String(i), onclick: () => (app.moreWaiting?.(inFilter) || [])[i]?.open() },
      el('b', { class: m.cls, text: m.title }), el('span', { class: 'meta', text: m.sub }))));
    swap(pane, items.length ? el('ul', { class: 'waiting' }, items) : el('p', { class: 'empty', text: 'Nobody is waiting for an answer.' }),
      moreItems.length ? el('h3', { text: 'Projects' }) : null, moreItems.length ? el('ul', { class: 'waiting' }, moreItems) : null);
  }

  function drawCard(p) {
    const side = document.getElementById('side-card');
    const t = p.thread;
    const back = el('button', { type: 'button', class: 'btn link', onclick: () => pick(null) }, `← Back to ${TABS[app.sideTab]}`);
    const edit = el('button', { type: 'button', class: 'btn edit-btn', onclick: () => editPerson(app.data.people.find((x) => x.key === p.key) || p), 'aria-label': `Edit ${p.name}: name and look` }, 'EDIT');
    const waiting = (app.data.waiting || []).find((w) => w.person === p.key);
    const dl = el('dl', {},
      el('dt', { text: 'Now' }), el('dd', {}, stateTag(p.state), p.state === 'home' ? '' : ` ${p.words}`, p.since ? el('span', { class: 'note' }, ` · for ${lasted(p.since)}`) : ''),
      el('dt', { text: 'Thread' }), el('dd', { text: t ? t.title : (p.lastAt ? `None open; last seen ${ago(Date.parse(p.lastAt))}` : 'None yet') }));
    // Earnings: helpers and tokens, folded under one line that says today's figure; open, it stays open as the card ticks.
    const live0 = side.dataset.card === p.key ? side.querySelector(':scope > .card-live') : null;
    const earnOpen = !!live0?.querySelector('details.earnings[open]');
    const earnings = el('details', { class: 'earnings', open: earnOpen },
      el('summary', {}, el('b', { text: 'Earnings' }), el('span', { class: 'note', text: ` · ${tokens(p.today)} tokens today` })),
      el('dl', {},
        el('dt', { text: 'Helpers' }), el('dd', { text: t ? String(t.helpers || 0) : '0' }),
        el('dt', { text: 'Today' }), el('dd', { text: `${tokens(p.today)} tokens written` }),
        el('dt', { text: 'Earned' }), el('dd', { text: `${tokens(p.outSince)} tokens since the office opened (they go into the Staff rewards purse)` }),
        el('dt', { text: 'Before' }), el('dd', { text: `${tokens(Math.max(0, p.out - p.outSince))} tokens before the office opened (shown, not spent)` }),
        el('dt', { text: 'All time' }), el('dd', { text: `${tokens(p.out)} tokens in ${p.threads} ${p.threads === 1 ? 'thread' : 'threads'}` })));
    const asked = (waiting || (t && t.asked)) ? el('div', { class: 'asked' }, el('b', { text: 'Asked you: ' }), (waiting?.asked || t.asked)) : null;
    const doneBtn = waiting ? el('div', { class: 'row' }, el('button', {
      type: 'button',
      class: 'btn primary',
      onclick: async () => {
        try { await api('/api/done', { id: waiting.id }); showFault(null); await refresh(); } catch (e) { showFault(e); }
      },
    }, 'Answered: take off the list'), el('span', { class: 'note', text: 'It comes back if they ask again.' })) : null;
    const steps = t && t.steps?.length ? el('ol', { class: 'steps', reversed: true }, [...t.steps].reverse().map((s) => el('li', {}, el('time', { datetime: s.at, text: clock(s.at) }), s.words))) : null;
    // Two parts, each redrawn only when it changes: the top (name and buttons) stays put while the live part ticks.
    let head = side.querySelector(':scope > .card-head');
    let live = side.querySelector(':scope > .card-live');
    if (!head || !live || side.dataset.card !== p.key) {
      head = el('div', { class: 'card card-head' });
      live = el('div', { class: 'card card-live' });
      side.replaceChildren(head, live);
      side.dataset.card = p.key;
    }
    // EDIT, and under it the project's Actions menu (kept open across a redraw if it was open).
    const wasOpen = !!head.querySelector('details.card-actions[open]');
    const projectHead = app.projectActions?.(p.folder, projStar(p)) || null;
    swap(head, back,
      el('div', { class: 'card-title' }, face(p, 48), el('div', { class: 'card-name' }, el('h2', { class: 'name-heading' }, p.name, personStar(p)), el('p', { class: 'sub', text: where(p) + (p.nick ? ` · first called ${defaultName(p)}` : '') })),
        el('div', { class: 'card-buttons' }, edit, app.projectMenu?.(p.folder, wasOpen))),
      favRow(p, !projectHead), openRow(p), asked, doneBtn, projectHead);
    // Their newest thread's last messages, in the order they were said (also once they have gone home).
    const r = p.recent;
    const msgs = r?.msgs?.length ? el('ol', { class: 'msgs' }, r.msgs.slice(-6).map((m) => el('li', { class: `msg msg-${m.who === 'you' ? 'you' : 'ai'}` },
      el('span', { class: 'msg-who' }, m.who === 'you' ? 'You' : 'Claude', el('time', { datetime: m.at, text: ` ${clock(m.at)}` })),
      el('span', { class: 'msg-text', text: m.text })))) : null;
    const msgsHead = msgs ? el('h3', { text: t ? 'Recent messages' : `Recent messages: ${r.title}` }) : null;
    swap(live, dl, earnings, msgsHead, msgs, steps ? el('h3', { text: 'Last steps' }) : null, steps);
  }

  /** The card's stars: this person (a button under the name), and their whole project (a star on the project's heading,
   * projStar). `withProject`: no project heading to put the project's star on, so it sits here as a button. */
  const star = (on) => (on ? '★' : '☆');
  const favToggle = (body) => async () => {
    try { await api('/api/favourite', body()); showFault(null); await refresh(); } catch (e) { showFault(e); }
  };
  function favRow(p, withProject) {
    if (!withProject) return null;
    const now = () => app.data.people.find((x) => x.key === p.key) || p;
    return el('div', { class: 'row fav-row' }, el('button', { type: 'button', class: 'btn fav-btn', 'aria-pressed': String(!!p.favProject), title: `Everyone in ${projectName(p.folder)} is a favourite`, onclick: favToggle(() => ({ folder: now().folder, project: true, on: !now().favProject })) }, `${star(p.favProject)} Favourite project`));
  }
  /** This person's star, beside their name: filled when they are a favourite; the tooltip says what a click does. */
  function personStar(p) {
    const now = () => app.data.people.find((x) => x.key === p.key) || p;
    const hint = p.favSeat
      ? `${p.name} is a favourite: they stay at the office on a beach towel after going home, and are listed under Favourites. Click to take them off.`
      : `Click to make ${p.name} a favourite: they stay at the office on a beach towel after going home, and are listed under Favourites.`;
    return el('button', { type: 'button', class: 'star-btn', 'aria-pressed': String(!!p.favSeat), 'aria-label': `Favourite: ${p.name}`, title: hint,
      onclick: favToggle(() => ({ folder: now().folder, seat: now().seat, on: !now().favSeat })) }, star(p.favSeat));
  }
  /** A project's star (on a person's card and on each tile of the Projects tab): filled when it is a favourite project;
   * the tooltip says what a click does. `folder`: the project's desk folder; `name`: what to call it. */
  function projectStar(folder, name) {
    const on = () => (app.data?.favProjects || []).includes(folder);
    const hint = on()
      ? `${name} is a favourite project: everyone in it stays at the office on a beach towel after going home. Click to take it off.`
      : `Click to make ${name} a favourite project: everyone in it stays at the office on a beach towel after going home, and is listed under Favourites.`;
    return el('button', { type: 'button', class: 'star-btn', 'aria-pressed': String(on()), 'aria-label': `Favourite project: ${name}`, title: hint,
      onclick: favToggle(() => ({ folder, project: true, on: !on() })) }, star(on()));
  }
  app.projectStar = projectStar;
  const projStar = (p) => projectStar(p.folder, projectName(p.folder));

  /** The open-thread button: their thread (the open one, else their newest) in the AI desktop app, when the app has it. */
  function openRow(p) {
    const link = p.thread?.open || p.recent?.open;
    if (!link) return null;
    const title = p.thread ? 'Opens this thread in the Claude desktop app' : `Opens their last thread in the Claude desktop app: ${p.recent.title}`;
    return el('div', { class: 'row open-row' }, el('a', { class: 'btn primary', href: link, title }, 'Open in Claude'));
  }

  function defaultName(p) {
    const base = p.folder || 'Consultant';
    return p.seat > 1 ? `${base} ${p.seat}` : base;
  }

  /**
   * EDIT on a card: the seat's name and look in one window (the look editor). Both are kept by seat, so every
   * thread that sits there later has them too. Nothing is kept until Save.
   */
  function editPerson(p) {
    const sheet = document.getElementById('edit');
    const L = window.officeLook;
    let look = { ...L.lookOf(p.key, p.look) };
    let madeUp = !p.look;
    const said = el('p', { class: 'note', 'aria-live': 'polite' });
    const input = el('input', { type: 'text', maxlength: '40', value: p.nick || '', placeholder: defaultName(p), 'aria-label': 'Name' });
    const editor = L.editor({ look, onChange: (l) => { look = l; madeUp = false; } });
    const close = () => { sheet.hidden = true; sheet.replaceChildren(); };
    const save = async (e) => {
      e.preventDefault();
      try {
        await api('/api/edit', { folder: p.folder, seat: p.seat, nick: input.value, ...(madeUp ? {} : { look }) });
        close();
        await refresh();
      } catch (err) {
        const f = err?.error || {};
        said.textContent = f.fault ? `${f.fault} ${f.reason || ''} ${f.wayOut || ''}` : 'The office did not answer: nothing was saved. Check that AI Head Office Overview is still running, then try again.';
      }
    };
    const resetLook = p.look ? el('button', {
      type: 'button',
      class: 'btn',
      onclick: async () => {
        try { await api('/api/edit', { folder: p.folder, seat: p.seat, look: null }); close(); await refresh(); } catch (err) { said.textContent = 'The office did not answer: nothing was changed.'; }
      },
    }, 'Use a made-up look again') : null;
    const form = el('form', { class: 'sheet-box edit-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'edit-title', onsubmit: save },
      el('h2', { id: 'edit-title', text: `Edit ${p.name}` }),
      el('p', { class: 'note', text: `${where(p)}. The name and look belong to the seat: every thread that sits here, now and later, has them.` }),
      el('label', { class: 'edit-label', text: 'Name' }), el('div', { class: 'row nick-form' }, input),
      el('p', { class: 'note', text: `Leave it empty to go back to "${defaultName(p)}".` }),
      el('h3', { text: 'Look' }), editor,
      said,
      el('div', { class: 'row' }, el('button', { type: 'submit', class: 'btn primary' }, 'Save'), el('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), resetLook));
    sheet.replaceChildren(form);
    sheet.hidden = false;
    sheet.onclick = (e) => { if (e.target === sheet) close(); };
    input.focus();
  }

  function pick(key) {
    app.picked = key;
    app.editing = false;
    draw();
    window.officeView?.select?.(key);
  }
  app.pick = pick;

  function drawPurse() {
    const b = document.getElementById('purse');
    const shop = app.data.shop;
    if (!shop) { b.hidden = true; return; }
    b.hidden = false;
    b.textContent = `Spending balance ${tokens(shop.purse.left)}`;
    b.title = 'Tokens the AI has written since the office opened, less what was spent: open Staff rewards to spend them';
  }

  function draw() {
    if (!app.data) return;
    drawProjects();
    drawPurse();
    // The office first: it also takes in the shop, which the right panel's Staff rewards tab is drawn from.
    window.officeView?.update?.(app.data, officePeople());
    if (app.view === 'list') drawList();
    if (app.view === 'favs') drawFavs();
    if (app.view === 'prompts') app.drawPrompts?.();
    if (!app.editing) {
      const p = app.picked && app.data.people.find((x) => x.key === app.picked);
      if (!p) app.picked = null;
      drawSide();
      if (p) drawCard(p);
    }
    app.afterDraw?.();
    fitSide();
  }
  app.draw = draw;

  /**
   * The right panel never makes the page taller than the window: it is capped to the room under it and scrolls inside,
   * so there is one scroll bar, not two. When the middle column is itself taller than the window the page scrolls
   * anyway, and the panel (stuck 12 px from the top) may then use the whole window.
   */
  function fitSide() {
    const side = document.getElementById('side');
    if (window.innerWidth <= 900) { side.style.maxHeight = ''; return; }
    const layout = document.querySelector('.layout');
    const middle = document.querySelector('.middle');
    const top = layout.getBoundingClientRect().top + window.scrollY + 16;
    const pageScrolls = middle.getBoundingClientRect().bottom + window.scrollY + 16 > window.innerHeight;
    const room = pageScrolls ? window.innerHeight - 24 : window.innerHeight - top - 16;
    const px = `${Math.max(240, Math.floor(room))}px`;
    if (side.style.maxHeight !== px) side.style.maxHeight = px;
    // Fractional heights above can leave the page a pixel too tall, which is a scroll bar: take that pixel off.
    if (!pageScrolls) {
      const over = document.documentElement.scrollHeight - window.innerHeight;
      if (over > 0 && over <= 8) side.style.maxHeight = `${Math.max(240, Math.floor(room) - over)}px`;
    }
  }
  // After a resize the office canvas re-fits on its next frame: the panel is fitted once that has happened.
  window.addEventListener('resize', () => requestAnimationFrame(() => requestAnimationFrame(fitSide)));

  /** The line under the title while the transcripts are being read (newest first, so today's people come in first). */
  function drawLoading(l) {
    const box = document.getElementById('loading');
    if (!l) { box.hidden = true; return; }
    box.hidden = false;
    const words = l.first
      ? `Loading: reading your Claude transcripts for the first time, ${l.done} of ${l.total}. This can take a minute the first time; people come in as they are read, today's first.`
      : `Loading: catching up on your Claude transcripts, ${l.done} of ${l.total}.`;
    const w = document.getElementById('loading-words');
    if (w.textContent !== words) w.textContent = words;
    document.getElementById('loading-bar').value = l.total ? l.done / l.total : 0;
  }

  async function refresh() {
    try {
      app.data = await api('/api/state');
      drawLoading(app.data.loading);
      showFault(app.data.scanError ? { error: { fault: 'Some transcripts could not be read.', reason: app.data.scanError, wayOut: 'The office keeps trying every few seconds.' } } : null);
      draw();
    } catch (e) {
      showFault(e);
    }
  }
  app.refresh = refresh;

  function setView(v) {
    app.view = v;
    document.getElementById('tab-office').setAttribute('aria-selected', String(v === 'office'));
    document.getElementById('tab-list').setAttribute('aria-selected', String(v === 'list'));
    document.getElementById('tab-favs').setAttribute('aria-selected', String(v === 'favs'));
    document.getElementById('tab-prompts').setAttribute('aria-selected', String(v === 'prompts'));
    document.getElementById('office-view').hidden = v !== 'office';
    document.getElementById('list-view').hidden = v !== 'list';
    document.getElementById('favs-view').hidden = v !== 'favs';
    document.getElementById('prompts-view').hidden = v !== 'prompts';
    try { localStorage.setItem('aho-view', v); } catch { /* fine */ }
    draw();
  }
  document.getElementById('tab-office').addEventListener('click', () => setView('office'));
  // The title is the home page: the office with all projects, nobody picked.
  document.getElementById('home').addEventListener('click', (e) => {
    e.preventDefault();
    app.project = null;
    app.folder = null;
    app.picked = null;
    app.editing = false;
    window.officeView?.select?.(null);
    setView('office');
    window.scrollTo(0, 0);
  });
  document.getElementById('tab-list').addEventListener('click', () => setView('list'));
  document.getElementById('tab-favs').addEventListener('click', () => setView('favs'));
  document.getElementById('tab-prompts').addEventListener('click', () => setView('prompts'));
  app.setView = setView;
  let saved = 'office';
  try { saved = localStorage.getItem('aho-view') || 'office'; } catch { /* fine */ }
  // An address can name the tab: /#projects, /#prompts, /#favourites or /#office.
  saved = { '#projects': 'list', '#prompts': 'prompts', '#favourites': 'favs', '#office': 'office' }[location.hash] || saved;
  if (!window.officeView) saved = 'list';
  setView(['list', 'favs', 'prompts'].includes(saved) ? saved : 'office');
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const id of ['setup', 'edit', 'check']) {
      const sheet = document.getElementById(id);
      sheet.hidden = true;
      if (id !== 'setup') sheet.replaceChildren(); // the look editor's turning figure stops drawing once it is gone
    }
  });

  refresh();
  setInterval(refresh, 3000);
})();
