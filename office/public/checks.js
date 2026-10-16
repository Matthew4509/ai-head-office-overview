// Checks in the office: Audit, Git and Live for each project, as marks on its tile and windows in the office's look,
// and the extra rows of the one Needs attention list (git waiting, live sites down, Critical and High audit findings).
// It asks the engine's own API with the page's key (app.engine); the project list is projects.js's (app.engineData).
'use strict';

(() => {
  const app = window.aiOffice;
  const { el } = app;
  const eng = app.engineData;
  const sheet = document.getElementById('check');
  const proj = (id) => eng.projects.find((p) => p.id === id);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u || ''); } };
  const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const faultText = (e) => { const f = e?.error || {}; return f.fault ? `${f.fault} ${f.reason || ''}`.trim() : String(e?.message || e); };

  // ---- the window ----
  function open(title, body, buttons, wide = true) {
    const box = el('div', { class: `sheet-box check-box${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'check-title' },
      el('h2', { id: 'check-title', text: title }), ...body.flat().filter(Boolean), el('div', { class: 'row sheet-foot' }, ...buttons.filter(Boolean)));
    sheet.replaceChildren(box);
    sheet.hidden = false;
    sheet.onclick = (e) => { if (e.target === sheet) close(); };
    box.querySelector('button, textarea, input')?.focus();
  }
  function close() { sheet.hidden = true; sheet.replaceChildren(); }
  app.openWindow = open;
  app.closeWindow = close;
  const btn = (label, onclick, primary = false, extra = {}) => el('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, onclick, ...extra }, label);
  const closeBtn = () => btn('Close', close, true);
  const said = () => el('p', { class: 'note check-said', role: 'status' });
  async function copy(text, okWords, line) {
    try { await navigator.clipboard.writeText(text); line.textContent = okWords; } catch { line.textContent = 'Could not copy: the clipboard was blocked. Select the text and copy it.'; }
  }

  // ---- labels: a shape and a word for each state (never colour alone) ----
  function auditLabel(a) {
    if (!a) return { mark: '○', text: 'No audit', cls: 'm-none' };
    const c = a.counts || {};
    if (c.Critical || c.High) return { mark: '▲', text: [c.Critical && `${c.Critical} Critical`, c.High && `${c.High} High`].filter(Boolean).join(', '), cls: 'm-bad' };
    if (c.Medium) return { mark: '■', text: `${c.Medium} Medium`, cls: 'm-warn' };
    return { mark: '✓', text: 'Passed', cls: 'm-ok' };
  }
  function gitLabel(g) {
    if (!g) return { mark: '○', text: 'Git…', cls: 'm-none', say: 'Not read yet.' };
    switch (g.state) {
      case 'none': return { mark: '○', text: 'No git', cls: 'm-none', say: 'Not in git: no saved history and no backup copy.' };
      case 'empty': return { mark: '○', text: 'Nothing saved', cls: 'm-none', say: 'Git is set up here, but nothing has been saved (committed) yet.' };
      case 'local': return { mark: '▲', text: 'Only on this PC', cls: 'm-warn', say: 'Saved in git on this PC only. If this PC is lost, the history goes with it.' };
      case 'unpushed': return { mark: '▲', text: 'Not pushed', cls: 'm-warn', say: `Linked to ${g.remote}, but this PC has no record of a push, so the saved history may exist only here.` };
      case 'ahead': return { mark: '▲', text: `${g.ahead} not pushed`, cls: 'm-warn', say: `${plural(g.ahead, 'save is', 'saves are')} not on ${g.remote} yet. Push to back them up.` };
      case 'changes': return { mark: '▲', text: `${g.changes} unsaved`, cls: 'm-warn', say: `${plural(g.changes, 'file has', 'files have')} changes not saved in git yet${g.ahead ? `, and ${plural(g.ahead, 'save is', 'saves are')} not pushed` : ''}. Commit, then push, to back them up.` };
      case 'ok': return { mark: '●', text: 'Backed up', cls: 'm-ok', say: `Everything saved is on ${g.remote} (as of this PC's last push or fetch).` };
      default: return { mark: '?', text: 'Git error', cls: 'm-bad', say: g.reason || 'git could not read this folder.' };
    }
  }
  const LIVE = { up: { mark: '●', text: 'Live', cls: 'm-ok', word: 'Up' }, unsure: { mark: '▲', text: 'Live?', cls: 'm-warn', word: 'Unsure' }, down: { mark: '✕', text: 'Down', cls: 'm-bad', word: 'Down' } };
  const liveLabel = (p) => (p.liveUrl ? (p.live && LIVE[p.live.state]) || { mark: '○', text: 'Not checked', cls: 'm-none', word: 'Not checked yet' } : { mark: '+', text: 'Live URL', cls: 'm-none', word: 'None' });

  /** The three marks on a project tile (and a person's card): each opens its window. `after` (the tile's Browser and More) end the line. */
  app.checkMarks = (p, ...after) => {
    const mark = (l, label, what, title) => el('button', { type: 'button', class: `mark ${l.cls}`, title, 'aria-label': `${label}: ${l.text}`, onclick: () => what(p.id) }, el('span', { 'aria-hidden': 'true' }, l.mark), ` ${l.text}`);
    const a = auditLabel(p.audit), g = gitLabel(p.git), l = liveLabel(p);
    // On a tile, "No git" sits in its More menu instead (projects.js moreMenu); a person's card, with no More, keeps it here.
    const gitInMore = p.git?.state === 'none' && after.some((x) => x?.classList?.contains('more'));
    return el('div', { class: 'row marks' },
      mark(a, 'Audit', auditWindow, p.audit ? `Last audit ${when(p.audit.ranAt)}` : 'No audit yet: open to run one'),
      gitInMore ? null : mark(g, 'Git', gitWindow, g.say),
      mark(l, 'Live site', liveWindow, p.liveUrl ? `${hostOf(p.liveUrl)}: ${p.live ? p.live.reason : 'not checked yet'}` : 'Add the address this project is hosted at'), ...after);
  };

  // ---- Audit ----
  const SEV = { Critical: { mark: '◆ Critical', cls: 'm-bad' }, High: { mark: '▲ High', cls: 'm-bad' }, Medium: { mark: '■ Medium', cls: 'm-warn' }, Low: { mark: '○ Low', cls: 'm-none' }, Info: { mark: '· Info', cls: 'm-none' } };
  const minor = (f) => f.sev === 'Low' || f.sev === 'Info';
  // Copied text is flattened to one line per finding, so text from a live site cannot pose as separate instructions.
  const faultsText = (p, a) => `Audit of ${oneLine(p.name)} (folder ${oneLine(p.folder)}), ${a.ranAt}\n${a.findings.map((f) => `- [${f.sev}] ${f.rule} ${oneLine(f.title)} - ${oneLine(f.where)}${f.evidence ? ` - seen: ${oneLine(f.evidence)}` : ''} - fix: ${oneLine(f.fix)}`).join('\n')}`;

  async function auditWindow(id, lead = '') {
    const p = proj(id);
    if (!p) return;
    let a = null;
    try { a = (await app.engine(`/api/audit?id=${encodeURIComponent(id)}`)).audit; } catch (e) { return app.showFault(e); }
    if (!a) {
      return open(`Audit: ${p.name}`, [lead ? el('p', { text: lead }) : null, el('p', { text: `No audit of ${p.name} yet. An audit checks the code${p.running ? ', the running copy' : ''}${p.liveUrl ? ' and the live site' : ''} for common faults: secrets, injection, sign-in, uploads, exposed files, trackers and private details.` })],
        [btn('Run the audit', () => runAudit(id), true), btn('Close', close)]);
    }
    showAudit(p, a, lead);
  }
  app.auditWindow = auditWindow;

  async function runAudit(id) {
    const p = proj(id);
    open(`Checking ${p.name}…`, [el('p', { class: 'note', text: `Checking the code${p.running ? ' and the running copy' : ''}${p.liveUrl ? `, then comparing the live site (${hostOf(p.liveUrl)}), one page every 5 seconds: about a minute` : ''}.` })], []);
    try { const d = await app.engine('/api/audit', { id }); showAudit(p, d.audit, 'Audit done.'); } catch (e) { open(`The audit of ${p.name} did not finish`, [el('p', { text: faultText(e) })], [closeBtn()]); }
    app.loadProjects();
  }

  function showAudit(p, a, lead = '') {
    const c = a.counts || {};
    const head = c.Critical || c.High ? 'Fix the Critical and High faults before this goes live.' : c.Medium ? 'No Critical or High faults. Medium ones are warnings.' : (c.Low || c.Info) ? 'Passed: only low-priority findings.' : 'Passed every rule that ran.';
    const line = said();
    const item = (f) => el('li', { class: 'finding' }, el('span', { class: `sev ${(SEV[f.sev] || SEV.Medium).cls}`, text: (SEV[f.sev] || SEV.Medium).mark }),
      el('div', { class: 'what' }, el('b', { text: `${f.title}` }), f.knownAs ? el('span', { class: 'note', text: ` · already known as ${f.knownAs}` }) : null,
        el('span', { class: 'where', text: `${f.where}${f.also?.length ? ` (also ${plural(f.also.length, 'other place', 'other places')})` : ''} · ${f.rule}${f.evidence ? ` · seen: ${f.evidence}` : ''} · ${f.fix}` }),
        btn('Not a fault…', () => judge(p, a, f), false, { class: 'btn link' })));
    const major = a.findings.filter((f) => !minor(f)), low = a.findings.filter(minor);
    const setAside = a.setAside || a.accepted || [];
    open(`Audit: ${p.name}`, [
      lead ? el('p', { text: lead }) : null,
      el('p', { class: 'note', text: `${head} ${a.rules} rules over ${a.filesScanned} files in ${a.seconds} s, ${when(a.ranAt)}.${a.url ? (a.liveReached ? ` Checked ${a.url} too.` : ` ${a.url} did not answer, so it was not checked.`) : ''}` }),
      major.length ? el('ol', { class: 'findings' }, major.slice(0, 60).map(item)) : el('p', { class: 'm-ok', text: '✓ Nothing above Low.' }),
      major.length > 60 ? el('p', { class: 'note', text: `…and ${major.length - 60} more. Copy faults to see them all.` }) : null,
      low.length ? el('details', {}, el('summary', { text: `${plural(low.length, 'low-priority finding', 'low-priority findings')} (Low and Info)` }), el('ol', { class: 'findings' }, low.slice(0, 60).map(item))) : null,
      a.notes?.length ? el('details', {}, el('summary', { text: `${plural(a.notes.length, 'note', 'notes')} (checked, not counted)` }), el('ul', {}, a.notes.slice(0, 30).map((n) => el('li', { text: n })))) : null,
      setAside.length ? el('details', {}, el('summary', { text: `${setAside.length} set aside as not a fault (an edited line comes back)` }),
        el('ul', {}, setAside.map((f) => el('li', {}, `${f.rule} · ${f.where} — ${f.judged ? `${f.judged.why} (${f.judged.by || 'unnamed'})` : 'set aside in projects.json'} `,
          f.judged?.id ? btn('Bring back', () => unjudge(p, f.judged.id), false, { class: 'btn link' }) : null)))) : null,
      el('p', { class: 'note', text: 'A simple built-in check: it catches common faults, not everything.' }), line],
    [btn('Run again', () => runAudit(p.id)),
      a.findings.length ? btn('Copy faults', () => copy(faultsText(p, a), 'Faults copied. Paste them into the AI you use.', line)) : null,
      btn('Review with AI…', () => review(p, a)), btn('Import report-back…', () => importBack(p, a)), closeBtn()]);
  }

  function judge(p, a, f) {
    const why = el('textarea', { rows: '4', class: 'field-text', 'aria-label': 'Why it is not a fault' });
    const by = el('input', { type: 'text', class: 'field-text', maxlength: '60', placeholder: 'you', 'aria-label': 'Checked by', value: localStorage.getItem('aho-judged-by') || '' });
    const err = said();
    open(`Not a fault: ${f.rule}`, [el('p', { text: f.title }), el('p', { class: 'note', text: `${f.where}. Only this place is set aside, and only while its line stays the same.` }),
      el('label', { class: 'note', text: 'Why it is not a fault' }), why, el('label', { class: 'note', text: 'Checked by' }), by, err],
    [btn('Set aside', async () => {
      if (why.value.trim().length < 3) { err.textContent = 'Say why it is not a fault: the reason is kept with it.'; return why.focus(); }
      try { localStorage.setItem('aho-judged-by', by.value.trim()); } catch { /* fine */ }
      try { const d = await app.engine('/api/audit/judge', { id: p.id, rule: f.rule, where: f.where, fp: f.fp || null, why: why.value, by: by.value }); showAudit(p, d.audit, `${f.rule} at ${f.where} is set aside. It comes back if that line changes.`); app.loadProjects(); } catch (e) { err.textContent = faultText(e); }
    }, true), btn('Back to the audit', () => showAudit(p, a))], false);
  }
  async function unjudge(p, entry) {
    try { const d = await app.engine('/api/audit/unjudge', { id: p.id, entry }); showAudit(p, d.audit, 'Brought back: it counts again.'); app.loadProjects(); } catch (e) { app.showFault(e); }
  }

  async function review(p, a) {
    open(`Review with AI: ${p.name}`, [el('p', { class: 'note', text: 'Building the prompt from the project\'s files and the last audit…' })], []);
    let d;
    try { d = await app.engine(`/api/review?id=${encodeURIComponent(p.id)}`); } catch (e) { return open(`Review with AI: ${p.name}`, [el('p', { text: faultText(e) })], [closeBtn()]); }
    const text = el('textarea', { rows: '10', class: 'field-text', readonly: true, 'aria-label': 'Review prompt' });
    text.value = d.prompt;
    const faults = d.faults || [];
    const line = said();
    const STATE = { open: 'Open', fixed: '✓ Fixed', false: '✕ Not a fault' };
    const row = (f) => el('li', { class: 'finding' }, el('span', { class: `sev ${f.status === 'open' ? (SEV[f.sev] || SEV.Medium).cls : 'm-ok'}`, text: f.status === 'open' ? (SEV[f.sev] || SEV.Medium).mark : STATE[f.status] }),
      el('div', { class: 'what' }, el('b', { text: f.evidence }), el('span', { class: 'where', text: `${f.where} · ${f.ref || f.id} · ${f.fix}` }),
        el('span', {}, ...['open', 'fixed'].filter((s) => s !== f.status).map((s) => btn(s === 'open' ? 'Open again' : 'Mark fixed', async () => {
          try { await app.engine('/api/faults/set', { id: p.id, fault: f.id, status: s, why: '', by: localStorage.getItem('aho-judged-by') || '' }); review(p, a); } catch (e) { line.textContent = faultText(e); }
        }, false, { class: 'btn link' })))));
    open(`Review with AI: ${p.name}`, [
      el('p', { class: 'note', text: 'Rules find patterns; a reviewer finds judgement faults (money, access, promises, data). Copy this prompt into the AI you use, then paste its answer with Import report-back…. Nothing is sent from here.' }),
      text, el('h3', { text: faults.length ? `Faults from reviews: ${faults.filter((f) => f.status === 'open').length} open of ${faults.length}` : 'No faults from a review yet' }),
      faults.length ? el('ol', { class: 'findings' }, faults.map(row)) : null, line],
    [btn('Copy prompt', () => copy(d.prompt, 'Review prompt copied. Paste it into the AI you use.', line), true), btn('Import report-back…', () => importBack(p, a)), btn('Back to the audit', () => showAudit(p, a))]);
  }

  function importBack(p, a) {
    const text = el('textarea', { rows: '10', class: 'field-text', 'aria-label': 'Report-back' });
    const by = el('input', { type: 'text', class: 'field-text', maxlength: '60', placeholder: 'you', 'aria-label': 'Checked by', value: localStorage.getItem('aho-judged-by') || '' });
    const err = said();
    open('Import a report-back', [el('p', { class: 'note', text: 'Paste what an AI or a project thread wrote back. Its "Findings" table (Id | Severity | Category | Where | Evidence | Fix) goes on the fault list; its "False flags" table (Rule | Where | Verdict | Why | What the rule should do) sets scanner findings aside one place at a time.' }),
      text, el('label', { class: 'note', text: 'Checked by' }), by, err],
    [btn('Import', async () => {
      if (!text.value.trim()) { err.textContent = 'Paste the report-back first.'; return text.focus(); }
      try {
        const d = await app.engine('/api/audit/import', { id: p.id, text: text.value, by: by.value, source: '' });
        const good = d.results.filter((x) => x.ok).length;
        const fr = d.findings || { added: 0, again: 0, refused: [] };
        showAudit(p, d.audit || a, `Imported: ${good} of ${d.results.length} false flags judged; ${fr.added} new on the fault list${fr.again ? `, ${fr.again} already there` : ''}${fr.refused.length ? `; ${fr.refused.length} not imported` : ''}.`);
        app.loadProjects();
      } catch (e) { err.textContent = faultText(e); }
    }, true), btn('Back to the audit', () => (a ? showAudit(p, a) : close()))]);
  }

  // ---- Git (read only: the office never commits or pushes) ----
  function gitSteps(g) {
    const save = ['git status', 'git add -A', 'git commit -m "Save work"'];
    switch (g?.state) {
      case 'none': return ['To start a history here (skip it for scratch folders):', ['git init', 'git add -A', 'git commit -m "First save"']];
      case 'empty': return ['Make the first save:', ['git add -A', 'git commit -m "First save"']];
      case 'local': return [`Make an empty repository on GitHub (no README), then link it and push${g.changes ? ', after saving the changed files' : ''}:`, [...(g.changes ? save : []), 'git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git', 'git push -u origin HEAD']];
      case 'unpushed': return [`Push this branch to ${g.remote}:`, [...(g.changes ? save : []), `git push -u ${g.remoteName || 'origin'} HEAD`]];
      case 'ahead': return [`Push the saves to ${g.remote}:`, ['git push']];
      case 'changes': return ['Save the changed files, then push:', [...save, ...(g.remote ? ['git push'] : [])]];
      default: return null;
    }
  }
  function gitWindow(id) {
    const p = proj(id);
    if (!p) return;
    const g = p.git || {}, l = gitLabel(p.git);
    const fact = (k, v) => (v == null || v === '' ? null : el('div', { class: 'fact' }, el('span', { class: 'note', text: k }), el('span', { text: v })));
    const steps = gitSteps(g);
    const line = said();
    open(`${p.name}: git`, [
      el('p', {}, el('b', { class: l.cls, text: `${l.mark} ${l.text}` }), el('br'), l.say),
      fact('Branch', g.branch), fact('Changed files not saved', g.state === 'none' ? null : String(g.changes || 0)),
      fact('Last save (commit)', g.lastCommit ? when(g.lastCommit) : null), fact('Backup copy', g.remote || (g.state === 'none' || g.state === 'error' ? null : 'none')), fact('Folder', p.dir),
      steps ? [el('h3', { text: 'What to do' }), el('p', { text: steps[0] }), ...steps[1].map((c) => el('div', { class: 'git-cmd' }, el('code', { text: c }), btn('Copy', () => copy(c, 'Copied. Paste it into a terminal in the project folder.', line), false, { class: 'btn small' })))] : null,
      el('p', { class: 'note', text: 'The office only reads git here: it never commits, pushes or changes the folder.' }), line],
    [g.changes || g.state === 'empty' ? btn('See what changed', () => changes(p)) : null, btn('Terminal here', () => app.projectAct(p.id, 'terminal')), closeBtn()]);
  }
  app.gitWindow = gitWindow;

  async function changes(p) {
    let d;
    try { d = await app.engine(`/api/git/changes?id=${encodeURIComponent(p.id)}`); } catch (e) { return open(`${p.name}: what changed`, [el('p', { text: faultText(e) })], [btn('Back', () => gitWindow(p.id)), closeBtn()]); }
    if (!d.files.length) return open(`${p.name}: what changed`, [el('p', { text: 'Nothing has changed since the last save.' })], [btn('Back', () => gitWindow(p.id)), closeBtn()]);
    const cls = (l) => (l[0] === '+' ? 'df-add' : l[0] === '-' ? 'df-del' : l.startsWith('@@') ? 'df-hunk' : '');
    const add = d.files.reduce((n, f) => n + f.added, 0), rem = d.files.reduce((n, f) => n + f.removed, 0);
    const file = (f, i) => el('details', { class: 'df-file', open: i < 5 },
      el('summary', {}, el('span', { class: 'note', text: `${f.kind} ` }), el('b', { text: f.from ? `${f.from} → ${f.path}` : f.path }), f.binary ? ' (binary)' : el('span', { class: 'note', text: ` +${f.added} −${f.removed}` })),
      f.binary ? el('p', { class: 'note', text: 'A binary file: its contents are not shown.' }) : f.note ? el('p', { class: 'note', text: f.note })
        : el('pre', { class: 'df-lines' }, f.lines.map((l) => el('span', { class: cls(l), text: `${l}\n` })), f.cut ? el('span', { class: 'df-hunk', text: `… ${f.cut} more lines not shown` }) : null));
    open(`${p.name}: what changed`, [el('p', { text: `${plural(d.files.length, 'file', 'files')} changed since the ${d.against === 'last save' ? 'last save' : 'start (nothing is saved yet)'}: ${plural(add, 'line', 'lines')} added (+), ${rem} removed (−).${d.more ? ` The first 300 files are shown; ${d.more} more are not.` : ''}` }),
      el('p', { class: 'note', text: 'Read only: the office never saves, undoes or changes anything here.' }), ...d.files.map(file)],
    [btn('Back', () => gitWindow(p.id)), closeBtn()]);
  }

  // ---- Live site ----
  function liveState(p) {
    const l = p.live;
    if (!p.liveUrl) return null;
    if (!l) return el('p', { class: 'm-none', text: '○ Not checked yet.' });
    const s = LIVE[l.state] || LIVE.unsure;
    const bits = [`checked ${when(l.at)}`, l.status ? `answer ${l.status}` : '', l.ms != null ? `${(l.ms / 1000).toFixed(1)} s` : '', l.certTo ? `certificate until ${new Date(l.certTo).toLocaleDateString()}` : ''].filter(Boolean);
    return el('p', {}, el('b', { class: s.cls, text: `${s.mark} ${s.word}` }), ` ${l.reason}`, el('br'), el('span', { class: 'note', text: bits.join(' · ') }));
  }
  function liveWindow(id) {
    const p = proj(id);
    if (!p) return;
    const input = el('input', { type: 'text', class: 'field-text', inputmode: 'url', value: p.liveUrl || '', placeholder: 'example.com', 'aria-label': 'Live URL', spellcheck: 'false', autocomplete: 'off' });
    const err = said();
    const state = el('div', {}, liveState(p));
    const set = async (url) => {
      err.textContent = url ? `Checking ${url}…` : '';
      try {
        const d = await app.engine('/api/live/set', { id, url });
        await app.loadProjects();
        if (!d.url) { close(); app.say(`Live URL removed from ${p.name}.`); } else liveWindow(id);
      } catch (e) { err.textContent = faultText(e); }
    };
    open(`Live site: ${p.name}`, [el('p', { class: 'note', text: `Where ${p.name} is hosted on the internet. The office checks it when it starts and every ${eng.stats?.liveEvery || 15} minutes with one plain request, the same as opening the page: ● up, ▲ unsure, ✕ down.` }),
      input, state, err],
    [btn(p.liveUrl ? 'Save and check' : 'Add and check', () => { const v = input.value.trim(); if (!v) { err.textContent = p.liveUrl ? 'Use Remove address to take it off.' : 'Type the address the site is hosted at, like example.com.'; return input.focus(); } set(v); }, true),
      p.liveUrl ? btn('Check now', async () => { err.textContent = `Checking ${p.liveUrl}…`; try { await app.engine('/api/live/check', { id }); await app.loadProjects(); liveWindow(id); } catch (e) { err.textContent = faultText(e); } }) : null,
      p.liveUrl ? btn('Remove address', () => set('')) : null, btn('Close', close)], false);
  }
  app.liveWindow = liveWindow;

  // ---- the extra rows of Needs attention: git waiting, live down, Critical and High findings ----
  app.moreWaiting = (folder) => {
    const links = app.data?.links || {};
    const folderOf = Object.fromEntries(Object.entries(links).map(([f, id]) => [id, f]));
    const items = [];
    for (const p of eng.projects) {
      if (p.hiddenView) continue;
      // folder: one desk's folder, null for all, or a test (Filter by working folder) given the desk folder and the project.
      if (typeof folder === 'function' ? !folder(folderOf[p.id], p) : folder !== null && folderOf[p.id] !== folder) continue;
      if (p.liveUrl && p.live?.state === 'down') items.push({ kind: 'live', cls: 'm-bad', title: `✕ Live site down · ${p.name}`, sub: `${hostOf(p.liveUrl)}: ${p.live.reason}`, open: () => liveWindow(p.id), rank: 0 });
      const c = p.audit?.counts || {};
      if (c.Critical || c.High) items.push({ kind: 'audit', cls: 'm-bad', title: `▲ Audit · ${p.name}`, sub: `${[c.Critical && `${c.Critical} Critical`, c.High && `${c.High} High`].filter(Boolean).join(', ')}, from the audit ${when(p.audit.ranAt)}`, open: () => auditWindow(p.id), rank: 1 });
      const g = p.git;
      if (g && ['ahead', 'changes', 'unpushed', 'local'].includes(g.state)) items.push({ kind: 'git', cls: 'm-warn', title: `▲ Git · ${p.name}`, sub: gitLabel(g).say, open: () => gitWindow(p.id), rank: 2 });
    }
    return items.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  };
})();
