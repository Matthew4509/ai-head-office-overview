// The project planner on the page, in its own tab (shown once ticked in Settings › Office): Today, then every project
// by priority with its score and plan marks, the search box, the Score, Categories and Hours and rules windows, Filter
// by Category, and today's check-ins in Needs attention (Fine for now / Needs work / Park it). The rules and the data
// are the engine's (lib/priorities.js, /api/priorities): this file draws them and sends what is changed, nothing more.
'use strict';

(() => {
  const app = window.aiOffice;
  const { el } = app;
  const eng = app.engineData;
  const pl = { data: null, byKey: {} };
  app.planner = pl;

  const MARKS = [
    ['p', 'Profit', 30, 'How much money it brings in, or could'],
    ['d', 'Demand', 25, 'How many people want it'],
    ['m', 'What it means to you', 20, 'How much you care about it'],
    ['c', 'Few competitors', 15, '10 = nobody else does this; 0 = everybody does'],
    ['k', 'Little marketing needed', 10, '10 = it sells itself; 0 = it needs a lot of marketing'],
  ];
  const OWNER = { mine: 'Mine', company: 'My company', client: 'Client' };
  const CARE = { handoverDays: 30, handoverMin: 15, checkEvery: 'week', checkMin: 15, paid: false };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const hm = (min) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min / 60} h`);
  const dateWords = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { day: 'numeric', month: 'short' }); };
  const faultText = (e) => app.faultText(e);
  const careText = (c) => `${c.handoverDays ? `${plural(c.handoverDays, 'day', 'days')} of handover at ${c.handoverMin} min a day, then ` : ''}${c.checkEvery === 'none' ? 'no check-ins' : `${c.checkEvery === 'week' ? 'a weekly' : 'a daily'} check of ${c.checkMin} min`}${c.paid ? ' (paid: at the top of the day)' : ''}`;

  // ---- the data ----
  function set(d) {
    pl.data = d;
    pl.byKey = Object.fromEntries(Object.entries(d.rows || {}).map(([id, r]) => [r.key, id]));
    app.draw();
  }
  async function load() {
    try { set(await app.engine('/api/priorities')); } catch { /* app.js says when the office is not answering */ }
  }
  pl.load = load;
  /** Sends a change; the answer is the whole planner again, drawn at once. Throws the office's refusal. */
  async function send(url, body, words) {
    const d = await app.engine(url, body);
    set(d);
    if (words) app.say(words);
    return d;
  }
  const rowOf = (id) => pl.data?.rows?.[id] || null;
  const projOfKey = (key) => eng.projects.find((p) => p.id === pl.byKey[key]) || null;
  const catOf = (id) => (pl.data?.categories || []).find((c) => c.id === id) || null;
  const cats = () => pl.data?.categories || [];
  /** A project's categories for Filter by and the search: its own, or Not sorted. */
  app.plannerCats = (id) => { const r = rowOf(id); return r ? (r.categories.length ? r.categories : ['unsorted']) : []; };

  // ---- what a project is doing today (one place, so the band and the tiles always agree) ----
  function todayRole(key) {
    const plan = pl.data?.plan;
    if (!plan) return null;
    const f = plan.focus.find((x) => x.key === key);
    if (f) return { kind: 'focus', shape: ['①', '②', '③'][f.rank - 1], tag: `◷ Today · #${f.rank} · ${hm(f.min)}`, row: f, what: 'Polish' };
    if (plan.ready.some((x) => x.key === key)) return { kind: 'ready', shape: '📦', tag: '📦 Ready to ship', what: 'Waiting only for an upload' };
    const paid = plan.paid.find((x) => x.key === key);
    if (paid) return { kind: 'paid', shape: '◆', tag: `◆ Paid care today · ${hm(paid.min)}`, row: paid, what: `Paid care · ${checkWords(paid)}`, answerable: true };
    if (plan.medium?.key === key) return { kind: 'medium', shape: '◷', tag: `◷ Today · last hour · ${hm(plan.medium.min)}`, row: plan.medium, what: 'Solid' };
    const c = plan.checkins.find((x) => x.key === key);
    if (c) return { kind: 'care', shape: '📋', tag: `📋 ${checkWords(c)} today · ${hm(c.min)}`, row: c, what: checkWords(c), answerable: true };
    if (plan.low?.key === key) return { kind: 'low', shape: '📋', tag: `📋 Check-in today · ${hm(plan.low.min)}`, row: plan.low, what: 'Check-in: still works?', answerable: true };
    return null;
  }
  function checkWords(c) {
    if (c.kind === 'handover') return `Handover check · day ${c.day} of ${c.of}`;
    return c.kind === 'daily' ? 'Daily check' : 'Weekly check';
  }
  const ANSWER = { fine: '✓ Fine for now', needs: '⚑ Needs work', park: '⏸ Parked' };

  async function answer(id, what) {
    const p = eng.projects.find((x) => x.id === id);
    if (!p) return;
    const words = { fine: `${p.name}: fine for now. Its wait starts again.`, needs: `${p.name}: needs work. It counts 20 more until someone works on it.`, park: `${p.name} is parked: off the board until you bring it back (its score window, Bring it back).` }[what];
    try { await send('/api/priorities/answer', { id, what }, words); app.showFault(null); } catch (e) { app.showFault(e); }
  }
  /** Fine for now / Needs work / Park it, as three small buttons; once answered today, the answer in words. */
  function answers(id, said) {
    if (said) return el('span', { class: 'plan-said', text: ANSWER[said] });
    const b = (what, label, title) => el('button', { type: 'button', class: 'btn small', 'data-act': `answer-${what}`, 'data-id': id, title, onclick: () => answer(id, what) }, label);
    return el('span', { class: 'plan-answers' },
      b('fine', 'Fine for now', 'It still works: back to the end of the queue (its wait starts again)'),
      b('needs', '⚑ Needs work', 'Flag it: +20 to its score until someone works on it'),
      b('park', 'Park it', 'Off the board until you bring it back'));
  }

  // ---- the Today band (top of the Projects tab) ----
  /** `shown`: is a project in what Filter by and the search show? The day's rows outside it are left out, and the
   * band says so (the hours are the whole day's either way). */
  app.plannerBand = (shown) => {
    const d = pl.data;
    if (!d) return el('section', { class: 'plan-band' }, el('p', { class: 'note', text: 'Reading the project planner…' }));
    const plan = d.plan;
    let all = 0;
    const rows = [];
    const add = (label, keys) => {
      const list = keys.map((k) => ({ k, p: projOfKey(k) })).filter((x) => x.p);
      all += list.length;
      const vis = list.filter((x) => shown(x.p));
      if (vis.length) rows.push(el('li', { class: 'plan-sub', text: label }), ...vis.map((x) => bandRow(x.p, x.k)));
    };
    add('Ready to ship first', plan.ready.map((x) => x.key));
    add('Paid care', plan.paid.map((x) => x.key));
    add('Focus', plan.focus.map((x) => x.key));
    add('End of the day', [plan.medium?.key, ...plan.checkins.map((x) => x.key), plan.low?.key].filter(Boolean));
    const made = d.made ? new Date(d.made).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const day = (() => { const [y, m, dd] = d.today.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }); })();
    const unscored = !Object.values(d.rows).some((r) => Object.keys(r.scores).length);
    const btn = (label, onclick, title, act) => el('button', { type: 'button', class: 'btn small', onclick, title, 'data-act': act, 'data-id': 'band' }, label);
    const shownN = rows.filter((r) => r.classList.contains('plan-row')).length;
    return el('section', { class: 'plan-band', 'aria-labelledby': 'plan-title' },
      el('div', { class: 'plan-head' }, el('h2', { id: 'plan-title', text: 'Today' }),
        el('span', { class: 'note', text: `${day} · ${hm(plan.totalMin)} a day${plan.focusMin ? ` · focus ${hm(plan.focusMin)}` : ''}${made ? ` · planned at ${made}` : ''}` }),
        el('span', { class: 'plan-tools' },
          btn('Plan again', replan, 'Pick today\'s last-hour pair again, by the longest wait as it is now (today\'s check-in answers start again too). The focus three always follow the scores.', 'replan'),
          btn('Hours and rules…', rulesWindow, 'Hours a day, handover days, and the planner\'s other rules', 'rules'),
          btn('Categories…', categoriesWindow, 'Your project categories: who each project is for, and its care plan once it is finished', 'categories'))),
      ...plan.notes.map((n) => el('p', { class: 'note plan-note', text: n })),
      unscored ? el('p', { class: 'note plan-note', text: 'Every project counts 50 of 100 until it is scored, so today is picked by the longest wait. Press the number on a project to score it.' }) : null,
      rows.length ? el('ol', { class: 'plan-rows' }, ...rows) : el('p', { class: 'empty', text: all ? 'None of today\'s projects is in what Filter by or the search shows.' : 'Nothing planned: no project is being built, ready to ship or due a check-in.' }),
      all > shownN && shownN ? el('p', { class: 'note', text: `Showing ${shownN} of today's ${all}: Filter by or the search is on. The hours are for the whole day.` }) : null);
  };
  function bandRow(p, key) {
    const r = rowOf(p.id) || {};
    const role = todayRole(key);
    const main = catOf(r.categories?.[0]);
    const time = role.kind === 'ready' ? '—' : hm(role.row.min);
    const when = role.kind === 'focus' || role.kind === 'ready' ? (p.updated ? `updated ${ago(p.updated)}` : '') : r.lastChecked === pl.data.today ? 'checked today' : r.waiting == null ? 'never worked on' : r.waiting ? `waiting ${plural(r.waiting, 'day', 'days')}` : 'worked on today';
    return el('li', { class: `plan-row plan-${role.kind}` },
      el('span', { class: 'plan-shape', 'aria-hidden': 'true', text: role.shape }),
      el('button', { type: 'button', class: 'plan-name', 'data-act': 'band-score', 'data-id': p.id, title: `Score, stage and categories of ${p.name}`, onclick: () => scoreWindow(p.id) },
        main ? el('span', { class: 'note', text: `${main.name} · ` }) : null, p.name),
      el('span', { class: 'score-chip', title: `Score ${r.score} of 100${r.flag ? ', +20 while Needs work is on' : ''}` }, String(Math.round(r.score)), r.flag ? el('span', { class: 'm-warn', text: ' ⚑' }) : null),
      el('b', { class: 'plan-time', text: time }),
      el('span', { class: 'plan-what', text: role.what }),
      el('span', { class: 'note plan-when', text: when }),
      role.answerable ? answers(p.id, role.row.answer) : el('span'));
  }
  function ago(ms) {
    const s = Math.max(0, Date.now() - ms) / 1000;
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${plural(Math.round(s / 86400), 'day', 'days')} ago`;
  }
  async function replan() {
    if (!confirm('Pick today\'s last-hour pair again, by the longest wait as it is now? Today\'s check-in answers start again. (The focus three always follow the scores.)')) return;
    try { await send('/api/priorities/replan', {}, 'Today is planned again.'); app.showFault(null); } catch (e) { app.showFault(e); }
  }

  // ---- on each tile: the score (it opens the score window) and the plan marks ----
  app.plannerBadge = (p) => {
    const r = rowOf(p.id);
    if (!r) return null;
    return el('button', { type: 'button', class: 'score-badge', 'data-act': 'score', 'data-id': p.id, onclick: () => scoreWindow(p.id), 'aria-label': `Score ${Math.round(r.score)} of 100: open ${p.name}'s score`,
      title: `Score ${r.score} of 100${r.flag ? ' (+20 while Needs work is on)' : ''}. Open to change the score, deadline, stage and categories.` }, String(Math.round(r.score)));
  };
  app.plannerTags = (p) => {
    const r = rowOf(p.id);
    if (!r) return null;
    const role = todayRole(r.key);
    const tag = (text, cls = '', title = '') => el('span', { class: `tag ${cls}`, text, title });
    const stage = { handover: `Handover · day ${r.day} of ${r.of}`, 'looked-after': r.care.checkEvery === 'none' ? 'Looked after' : `Looked after · ${r.care.checkEvery === 'week' ? 'weekly' : 'daily'} check`, 'handed-on': 'Handed on', parked: '⏸ Parked' }[r.stage];
    const [c1, c2] = r.categories.map(catOf);
    const bits = [
      role ? tag(role.tag, role.kind === 'ready' ? 'm-ok' : 'tag-today') : null,
      r.flag ? tag('⚑ Needs work +20', 'm-warn', 'Flagged: it counts 20 more until someone works on it') : null,
      stage && !(role && role.kind === 'care') ? tag(stage, r.stage === 'parked' ? 'm-none' : '', r.soldOn ? `Sold from ${r.soldFrom} on ${dateWords(r.soldOn)}` : '') : null,
      r.deadline ? tag(`Due ${dateWords(r.deadline)}`, 'm-warn', 'A hard date puts it at the top') : null,
      r.waiting >= 2 && !(role && /^(focus|ready)$/.test(role.kind)) && r.stage === 'building' ? tag(`waiting ${r.waiting} days`, 'm-none', 'Days since it was last worked on or checked') : null,
      c1 ? tag(c1.name, 'tag-cat', `Category: ${c1.name}`) : null,
      c2 ? tag(`also in ${c2.name}`, 'tag-cat', `Also in ${c2.name} (for finding it; the care plan is ${c1?.name || 'Not sorted'}'s)`) : null,
    ].filter(Boolean);
    return bits.length ? el('div', { class: 'row plan-tags' }, ...bits) : null;
  };

  // ---- the Project planner tab: the search box (built once, so typing is never interrupted), Today, then every
  // project by priority ----
  app.projSearch = '';
  let bar = null;
  function plannerBar() {
    if (bar) return bar;
    const search = el('input', { type: 'search', class: 'field-text proj-search', placeholder: 'Search a name or category', 'aria-label': 'Search projects by name or category',
      oninput: (e) => { app.projSearch = e.target.value; app.draw(); } });
    bar = el('div', { class: 'row proj-bar' }, search);
    return bar;
  }
  /** Does a project match the search (its name, folder, or either category)? */
  function matches(p) {
    const q = app.projSearch.trim().toLowerCase();
    if (!q) return true;
    return [p.name, p.folder, ...app.plannerCats(p.id).map((id) => catOf(id)?.name || '')].some((n) => String(n || '').toLowerCase().includes(q));
  }
  /** By priority: a hard date first (soonest first), then the score (+20 while Needs work is on), then the longest
   * wait; parked last. */
  function byPriority(list) {
    const rank = (p) => { const r = rowOf(p.id) || { score: 0 }; return { parked: r.stage === 'parked' ? 1 : 0, due: r.deadline || '9999', s: r.score + (r.flag ? 20 : 0), w: r.waiting ?? 1e6 }; };
    return [...list].sort((a, b) => { const x = rank(a), y = rank(b); return x.parked - y.parked || x.due.localeCompare(y.due) || y.s - x.s || y.w - x.w; });
  }
  app.drawPlanner = (box) => {
    if (!box) return;
    let body = box.querySelector(':scope > .proj-body');
    if (!body) { body = el('div', { class: 'proj-body' }); box.replaceChildren(plannerBar(), body); }
    if (!pl.data) { app.swap(body, el('p', { class: 'note', text: 'Reading the project planner…' })); return; }
    const links = app.data?.links || {};
    const folderOfId = Object.fromEntries(Object.entries(links).map(([f, id]) => [id, f]));
    // What Filter by and the search show.
    const inView = (p) => (app.inFilter?.(folderOfId[p.id] ?? p.folder, p) ?? true) && matches(p);
    const list = byPriority(eng.projects.filter(inView));
    // Drawn again every few seconds: a focused button keeps the focus.
    const had = body.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = had?.dataset.act ? `[data-act="${CSS.escape(had.dataset.act)}"][data-id="${CSS.escape(had.dataset.id || '')}"]` : '';
    const row = (p) => el('li', { class: 'plan-item' }, app.plannerBadge(p),
      el('div', { class: 'plan-item-text' }, el('b', { text: p.name }), el('span', { class: 'note', text: p.description || p.folder })),
      app.plannerTags(p) || el('span'));
    const searching = app.projSearch.trim();
    const drawn = app.swap(body, app.plannerBand(inView),
      el('h2', { class: 'plan-list-title', text: `All projects by priority (${list.length})` }),
      el('p', { class: 'note', text: 'The number is the score out of 100: press it to change the score, deadline, stage and categories.' }),
      list.length ? el('ol', { class: 'plan-list' }, ...list.map(row))
        : el('p', { class: 'empty', text: searching ? `No project's name or category has "${searching}" in it. Clear the search to see them all.` : 'No project in what Filter by shows. Pick All projects to see them all.' }));
    if (drawn && focusKey) body.querySelector(focusKey)?.focus();
  };
  /** Settings › Office: show or hide the planner. Hidden, its tab, its check-ins and Filter by › Category go; its
   * scores and categories are kept. */
  app.setPlannerOn = (on) => {
    try { localStorage.setItem('aho-planner', on ? 'on' : 'off'); } catch { /* fine */ }
    document.getElementById('tab-planner').hidden = !on;
    if (!on && app.view === 'planner') app.setView('list');
    if (on) load(); else app.draw();
  };
  document.getElementById('tab-planner').hidden = !app.plannerOn();

  // ---- the score window ----
  function scoreWindow(id) {
    const p = eng.projects.find((x) => x.id === id);
    const r = rowOf(id);
    if (!p || !r) return;
    const said = el('p', { class: 'note check-said', role: 'status' });
    const marks = Object.fromEntries(MARKS.map(([k]) => [k, Number.isInteger(r.scores[k]) ? r.scores[k] : 5]));
    const total = el('b', { class: 'score-total' });
    const score = () => Math.round(MARKS.reduce((t, [k, , w]) => t + marks[k] * w / 10, 0) * 10) / 10;
    const showTotal = () => { total.textContent = String(score()); };
    const sliders = MARKS.map(([k, name, w, hint]) => {
      const out = el('span', { class: 'mark-of', text: `${marks[k]} of 10` });
      const pts = el('b', { class: 'mark-pts', text: String(marks[k] * w / 10) });
      const range = el('input', { type: 'range', min: '0', max: '10', step: '1', value: String(marks[k]), 'aria-label': `${name}, 0 to 10`,
        oninput: (e) => { marks[k] = Number(e.target.value); out.textContent = `${marks[k]} of 10`; pts.textContent = String(marks[k] * w / 10); showTotal(); } });
      return el('div', { class: 'mark-row' }, el('div', {}, el('b', { text: name }), el('span', { class: 'note', text: ` counts for ${w}` }), el('span', { class: 'note mark-hint', text: hint })), range, out, pts);
    });
    showTotal();
    let flag = r.flag;
    const flagBtn = el('button', { type: 'button', class: 'btn', 'aria-pressed': String(flag), onclick: () => { flag = !flag; flagBtn.setAttribute('aria-pressed', String(flag)); flagBtn.textContent = flag ? '⚑ Needs work is on' : '⚑ Needs work'; } }, flag ? '⚑ Needs work is on' : '⚑ Needs work');
    const deadline = el('input', { type: 'date', class: 'field-text short', value: r.deadline || '', 'aria-label': 'Deadline' });
    const catSelect = (label, value, none) => el('select', { class: 'filter-by', 'aria-label': label },
      el('option', { value: '', selected: !value }, none), ...cats().filter((c) => c.id !== 'unsorted').map((c) => el('option', { value: c.id, selected: c.id === value }, c.name)));
    const cat1 = catSelect('Category', r.categories[0], 'Not sorted');
    const cat2 = catSelect('Also in', r.categories[1], 'None');
    const body = () => ({ id, scores: { ...marks }, deadline: deadline.value, flag, categories: [cat1.value, cat2.value].filter(Boolean) });
    const save = async (extra = {}, words = `${p.name} is saved.`) => {
      if (cat1.value && cat1.value === cat2.value) { said.textContent = 'The two categories are the same. Pick another one under Also in, or None.'; return cat2.focus(); }
      try { await send('/api/priorities/set', { ...body(), ...extra }, words); app.showFault(null); app.closeWindow(); } catch (e) { said.textContent = faultText(e); }
    };
    // The stage: what it is now, and the buttons that move it on (each saves the window too).
    const care = r.care;
    const stageWords = { building: 'Being built', ready: '📦 Ready to ship: built, waiting only for an upload', handover: `Handover · day ${r.day} of ${r.of}`, 'looked-after': `Looked after: ${care.checkEvery === 'none' ? 'no check-ins' : `${care.checkEvery === 'week' ? 'a weekly' : 'a daily'} check of ${care.checkMin} min`}`, 'handed-on': 'Handed on: no check-ins', parked: '⏸ Parked: off the board' }[r.stage];
    const stageBtn = (label, stage, title, words) => el('button', { type: 'button', class: 'btn small', title, onclick: () => save({ stage }, words) }, label);
    const buyer = el('select', { class: 'filter-by', 'aria-label': 'Sold to' }, el('option', { value: '' }, 'Sold to…'),
      ...cats().filter((c) => c.id !== 'unsorted' && c.id !== r.categories[0]).map((c) => el('option', { value: c.id }, c.name)));
    const sold = el('button', { type: 'button', class: 'btn small', title: 'Moves it to the buyer\'s category and starts its handover', onclick: () => {
      if (!buyer.value) { said.textContent = 'Pick the category of whoever bought it first. Make one under Categories if it is not there.'; return buyer.focus(); }
      save({ stage: 'sold', soldTo: buyer.value }, `${p.name} is sold to ${catOf(buyer.value)?.name}: its handover starts today.`);
    } }, 'Sold');
    const finished = ['handover', 'looked-after', 'handed-on'].includes(r.stage);
    const stageBtns = r.stage === 'parked' ? [] : [
      r.stage === 'building' ? stageBtn('📦 Ready to ship', 'ready', 'Built and waiting only for an upload: it goes in the Ready to ship lane, cleared first', `${p.name} is ready to ship.`) : null,
      !finished ? stageBtn('Shipped', 'handover', 'It is live: its handover starts today', `${p.name} is shipped: its handover starts today.`) : null,
      !finished ? stageBtn('Handed over', 'handover', 'Handed to its owner: the handover starts today', `${p.name} is handed over: its handover starts today.`) : null,
      r.stage !== 'building' ? stageBtn('Back to building', 'building', 'Work on it again: it goes back on the board', `${p.name} is back to being built.`) : null,
    ];
    const careFrom = r.careOwn ? 'its own' : `from ${catOf(r.categories[0])?.name || 'Not sorted'}`;
    const lastWorked = p.updated ? new Date(p.updated).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';
    app.openWindow(`${p.name}: score`, [
      el('p', { class: 'note', text: 'Each slider is 0 to 10. The points add up to a score out of 100; the higher, the more of the day it gets.' }),
      el('div', { class: 'mark-rows' }, ...sliders),
      el('p', { class: 'score-line' }, 'Score ', total, el('span', { class: 'note', text: ` was ${r.score}` })),
      el('div', { class: 'row' }, flagBtn, el('span', { class: 'note', text: 'Needs work counts 20 more until someone works on it (a file changes after today).' })),
      el('div', { class: 'fact' }, el('b', { text: 'Deadline' }), el('div', { class: 'row' }, deadline, el('button', { type: 'button', class: 'btn small', onclick: () => { deadline.value = ''; } }, 'Clear'), el('span', { class: 'note', text: 'A hard date puts it at the top of the board.' }))),
      el('div', { class: 'fact' }, el('b', { text: 'Category' }), el('div', { class: 'row' }, cat1, el('span', { class: 'note', text: 'Also in' }), cat2, el('button', { type: 'button', class: 'btn small', onclick: categoriesWindow }, 'Categories…'))),
      el('p', { class: 'note', text: `The first category sets who it is for and its care plan once finished; the second is only for finding it. Care: ${careFrom} (${careText(care)}).` }),
      el('div', { class: 'fact' }, el('b', { text: 'Stage' }), el('div', {}, el('span', { text: stageWords }),
        r.soldOn ? el('span', { class: 'note', text: ` · sold from ${r.soldFrom} on ${dateWords(r.soldOn)}` }) : null,
        el('div', { class: 'row' }, ...stageBtns, r.stage === 'parked' ? null : buyer, r.stage === 'parked' ? null : sold))),
      el('p', { class: 'note', text: `Last worked on ${lastWorked || 'never'}${p.tokens ? ` · ${app.tokens(p.tokens)} tokens so far` : ''}. Shown here only: neither counts in the score.` }),
      said],
    [r.stage === 'parked' ? el('button', { type: 'button', class: 'btn', onclick: () => save({ stage: 'building' }, `${p.name} is back on the board.`), title: 'Back on the board, as being built' }, 'Bring it back')
      : el('button', { type: 'button', class: 'btn', onclick: () => save({ stage: 'parked' }, `${p.name} is parked: off the board until you bring it back.`), title: 'Off the board until you bring it back' }, '⏸ Park it'),
    el('button', { type: 'button', class: 'btn', onclick: app.closeWindow }, 'Cancel'),
    el('button', { type: 'button', class: 'btn primary', onclick: () => save() }, 'Save')]);
  }
  app.scoreWindow = scoreWindow;

  // ---- Hours and rules ----
  function rulesWindow() {
    const s = pl.data?.settings;
    if (!s) return;
    const said = el('p', { class: 'note check-said', role: 'status' });
    const hours = el('input', { type: 'number', class: 'field-text short', min: '1', max: '16', step: '0.25', value: String(s.hoursPerDay), 'aria-label': 'Hours a day' });
    const days = el('select', { class: 'filter-by', 'aria-label': 'Handover days' },
      el('option', { value: 'calendar', selected: s.handoverDays === 'calendar' }, 'Calendar days (every day counts)'),
      el('option', { value: 'working', selected: s.handoverDays === 'working' }, 'Working days (Monday to Friday; no check at weekends)'));
    const tick = (on, label) => el('input', { type: 'checkbox', checked: on, 'aria-label': label });
    const own = tick(s.ownHandover, 'A handover for my own sites');
    const paid = tick(s.paidLiftsScore, 'Paid care lifts the score');
    app.openWindow('Hours and rules', [
      el('div', { class: 'fact' }, el('b', { text: 'Hours a day' }), el('div', {}, hours, el('p', { class: 'note', text: 'The time the planner splits: paid care at the top, then the focus three (#1 gets half), then the last hour and the check-ins.' }))),
      el('div', { class: 'fact' }, el('b', { text: 'Handover days' }), el('div', {}, days)),
      el('div', { class: 'fact' }, el('b', { text: 'My own sites' }), el('label', {}, own, ' Give my own and my company\'s sites a handover too (unticked: they go straight to Looked after)')),
      el('div', { class: 'fact' }, el('b', { text: 'Paid care' }), el('label', {}, paid, ' Paid care also adds 10 to the project\'s score (its profit is already scored, so this is off to start with)')),
      said],
    [el('button', { type: 'button', class: 'btn', onclick: app.closeWindow }, 'Cancel'),
      el('button', { type: 'button', class: 'btn primary', onclick: async () => {
        try { await send('/api/priorities/settings', { hoursPerDay: Number(hours.value), handoverDays: days.value, ownHandover: own.checked, paidLiftsScore: paid.checked }, 'The planner\'s hours and rules are saved.'); app.closeWindow(); } catch (e) { said.textContent = faultText(e); }
      } }, 'Save')], false);
  }

  // ---- Categories ----
  function categoriesWindow() {
    const said = el('p', { class: 'note check-said', role: 'status' });
    const row = (c) => el('li', { class: 'cat-row' },
      el('div', {}, el('b', { text: c.name }), el('span', { class: 'note', text: ` · ${OWNER[c.owner] || 'Mine'} · ${plural(c.count, 'project', 'projects')}` }),
        el('span', { class: 'note cat-care', text: `Care: ${careText({ ...CARE, ...c.care })}` })),
      c.id === 'unsorted' ? el('span', { class: 'note', text: 'Always here' }) : el('span', { class: 'row' },
        el('button', { type: 'button', class: 'btn small', onclick: () => categoryWindow(c) }, 'Edit…'),
        el('button', { type: 'button', class: 'btn small', onclick: async () => {
          if (!confirm(`Delete the category ${c.name}? ${c.count ? `Its ${plural(c.count, 'project goes', 'projects go')} back to Not sorted (or lose it as their second one). ` : ''}No project or file is deleted.`)) return;
          try { await send('/api/priorities/category/remove', { id: c.id }, `${c.name} is deleted.`); categoriesWindow(); } catch (e) { said.textContent = faultText(e); }
        } }, 'Delete')));
    app.openWindow('Project categories', [
      el('p', { class: 'note', text: 'Group projects by who they are for: My projects, My boss\'s projects, a client. A category carries its owner and the care plan its finished projects get. A project can be in two: the first sets its care, the second is for finding it.' }),
      el('ul', { class: 'cat-list' }, ...cats().map(row)), said],
    [el('button', { type: 'button', class: 'btn', onclick: () => categoryWindow(null) }, 'New category…'), el('button', { type: 'button', class: 'btn primary', onclick: app.closeWindow }, 'Close')], false);
  }
  app.categoriesWindow = categoriesWindow;

  /** A new category (c = null) or one to change: its name, owner and care plan. A care change that reaches projects
   * opens a window naming them first. */
  function categoryWindow(c) {
    const said = el('p', { class: 'note check-said', role: 'status' });
    const care = { ...CARE, ...(c?.care || {}) };
    const name = el('input', { type: 'text', class: 'field-text', maxlength: '60', value: c?.name || '', placeholder: 'My projects', 'aria-label': 'Category name' });
    const owner = el('select', { class: 'filter-by', 'aria-label': 'Owner' }, ...Object.entries(OWNER).map(([v, w]) => el('option', { value: v, selected: (c?.owner || 'mine') === v }, w)));
    const num = (v, max, label) => el('input', { type: 'number', class: 'field-text short', min: '0', max: String(max), step: '1', value: String(v), 'aria-label': label });
    const hDays = num(care.handoverDays, 365, 'Handover days');
    const hMin = num(care.handoverMin, 480, 'Handover minutes a day');
    const every = el('select', { class: 'filter-by', 'aria-label': 'Check-ins after the handover' },
      ...[['week', 'Weekly'], ['day', 'Daily'], ['none', 'None']].map(([v, w]) => el('option', { value: v, selected: care.checkEvery === v }, w)));
    const cMin = num(care.checkMin, 480, 'Check-in minutes');
    const paid = el('input', { type: 'checkbox', checked: care.paid, 'aria-label': 'Paid care' });
    const read = () => ({ handoverDays: Number(hDays.value), handoverMin: Number(hMin.value), checkEvery: every.value, checkMin: Number(cMin.value), paid: paid.checked });
    const same = (a, b) => ['handoverDays', 'handoverMin', 'checkEvery', 'checkMin', 'paid'].every((k) => a[k] === b[k]);
    async function save() {
      const next = read();
      if (![next.handoverDays, next.handoverMin, next.checkMin].every((n) => Number.isInteger(n) && n >= 0)) { said.textContent = 'The days and minutes must be whole numbers, 0 or more. Change them and save again.'; return; }
      try {
        let id = c?.id;
        if (!c || name.value.trim() !== c.name || owner.value !== c.owner) id = (await send('/api/priorities/category/save', { id, name: name.value, owner: owner.value })).category.id;
        if (same(next, care)) { app.say(`${name.value.trim()} is saved.`); return categoriesWindow(); }
        const look = await app.engine('/api/priorities/category/care', { id, care: next });
        if (!look.follows.length) { await send('/api/priorities/category/care', { id, care: next, mode: 'all' }, `${name.value.trim()} is saved with its new care plan.`); return categoriesWindow(); }
        careConfirm(id, name.value.trim(), look);
      } catch (e) { said.textContent = faultText(e); name.focus(); }
    }
    app.openWindow(c ? `Category: ${c.name}` : 'New category', [
      el('div', { class: 'fact' }, el('b', { text: 'Name' }), name),
      el('div', { class: 'fact' }, el('b', { text: 'Who it is for' }), owner),
      el('h3', { text: 'Care plan for its finished projects' }),
      el('div', { class: 'fact' }, el('b', { text: 'Handover' }), el('div', { class: 'row' }, hDays, el('span', { text: 'days at' }), hMin, el('span', { text: 'min a day' }))),
      el('div', { class: 'fact' }, el('b', { text: 'Then' }), el('div', { class: 'row' }, every, el('span', { text: 'check-ins of' }), cMin, el('span', { text: 'min' }))),
      el('div', { class: 'fact' }, el('b', { text: 'Paid' }), el('label', {}, paid, ' The owner pays for this care: it goes at the top of the day')),
      said],
    [el('button', { type: 'button', class: 'btn', onclick: categoriesWindow }, 'Back'), el('button', { type: 'button', class: 'btn primary', onclick: save }, 'Save')], false);
    name.focus();
  }
  /** A care change that reaches projects: who changes, who keeps their own plan, and the choice. Nothing changes before. */
  function careConfirm(id, name, look) {
    const said = el('p', { class: 'note check-said', role: 'status' });
    const n = look.follows.length;
    const go = async (mode, words) => { try { await send('/api/priorities/category/care', { id, care: look.to, mode }, words); categoriesWindow(); } catch (e) { said.textContent = faultText(e); } };
    app.openWindow(`${name}: change the care plan?`, [
      el('p', { text: `${name}'s care plan changes from ${careText(look.from)} to ${careText(look.to)}.` }),
      el('p', { text: `This changes ${plural(n, 'project', 'projects')}: ${look.follows.join(', ')}.` }),
      look.own.length ? el('p', { class: 'note', text: `${plural(look.own.length, 'project has', 'projects have')} a care plan of their own and stay as they are: ${look.own.join(', ')}.` }) : null,
      el('p', { class: 'note', text: `Only projects added from now on: ${n === 1 ? 'the project above keeps the plan it has' : `the ${n} projects above keep the plan they have`} now, as ${n === 1 ? 'its' : 'their'} own.` }), said],
    [el('button', { type: 'button', class: 'btn primary', onclick: () => go('all', `${name}'s new care plan is on for ${n === 1 ? look.follows[0] : `all ${n}`}.`) }, n === 1 ? `Change ${look.follows[0]}` : `Change all ${n}`),
      el('button', { type: 'button', class: 'btn', onclick: () => go('new', `${name}'s new care plan is for projects added from now on; ${n === 1 ? `${look.follows[0]} keeps its` : `the ${n} there now keep theirs`}.`) }, 'Only projects added from now on'),
      el('button', { type: 'button', class: 'btn', onclick: categoriesWindow }, 'Cancel')], false);
  }

  // ---- Needs attention: today's check-ins not answered yet ----
  app.plannerCheckins = (inFilter) => {
    const plan = pl.data?.plan;
    if (!plan || !app.plannerOn()) return [];
    const links = app.data?.links || {};
    const folderOf = Object.fromEntries(Object.entries(links).map(([f, id]) => [id, f]));
    const due = [...plan.paid, ...plan.checkins, ...(plan.low ? [plan.low] : [])].filter((c) => !c.answer);
    return due.map((c) => ({ c, p: projOfKey(c.key) })).filter(({ p }) => p && !p.hiddenView && inFilter(folderOf[p.id] ?? p.folder, p)).map(({ c, p }) => {
      const role = todayRole(c.key);
      const r = rowOf(p.id);
      const question = role.kind === 'low' ? 'Does it still work? A quick look only: open it, try the main page, nothing more.' : 'Is it up, are there new errors, did the owner ask anything?';
      return el('li', {}, el('div', { class: 'wait wait-checkin' },
        el('button', { type: 'button', class: 'plan-name', 'data-act': 'checkin-score', 'data-id': p.id, onclick: () => scoreWindow(p.id), title: `Score, stage and categories of ${p.name}` },
          el('b', { text: `📋 ${role.kind === 'low' ? 'Check-in' : role.what} · ${p.name}` })),
        el('span', { class: 'meta', text: `on today for ${hm(c.min)}${r?.waiting != null ? ` · last worked on or checked ${r.waiting ? plural(r.waiting, 'day', 'days') + ' ago' : 'today'}` : ''}` }),
        el('span', { text: question }), answers(p.id, null)));
    });
  };

  // Read only while the planner is shown.
  if (app.plannerOn()) load();
  setInterval(() => { if (app.plannerOn()) load(); }, 15000);
})();
