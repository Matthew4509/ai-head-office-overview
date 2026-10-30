// The project's More › Publish guard…: a git pre-push hook that checks the project with the office's audit before
// every push and stops the push while it says "fix first" (lib/gate.js). Turned on and off here, per project; and
// Ready to publish? runs the same check now and shows it in the Audit window (checks.js).
'use strict';

(() => {
  const app = window.aiOffice;
  const { el } = app;
  const proj = (id) => app.engineData.projects.find((p) => p.id === id);
  const btn = (label, onclick, primary = false) => el('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, onclick }, label);
  const hasGit = (p) => !!p?.git && p.git.state !== 'none';

  async function gateWindow(id) {
    const p = proj(id);
    if (!p) return;
    let s;
    try { s = await app.engine(`/api/gate?id=${encodeURIComponent(id)}`); } catch (e) { return app.showFault(e); }
    const err = el('p', { class: 'note check-said', role: 'status' });
    const said = {
      on: ['m-ok', `● On: every push of ${p.name} is checked first.`],
      off: ['m-warn', `○ Off: pushes of ${p.name} are not checked.`],
      other: ['m-warn', `▲ Not added: ${s.why}`],
      unsupported: ['m-warn', `▲ Not added: ${s.why}`],
      'no-git': ['m-none', `○ ${s.why}`],
    }[s.state] || ['m-none', s.state];
    const set = (on) => async () => {
      err.textContent = '';
      try {
        const x = await app.engine(`/api/gate/${on ? 'on' : 'off'}`, { id });
        if (x.dryRun) { err.textContent = `Dry run: ${x.dryRun}.`; return; }
        app.say(on ? `Publish guard on for ${p.name}: every push is checked first.` : `Publish guard off for ${p.name}.`);
        gateWindow(id);
      } catch (e) { err.textContent = app.faultText(e); }
    };
    const lineBox = s.line ? el('textarea', { rows: '2', class: 'field-text', readonly: true, 'aria-label': 'Line for your pre-push hook', spellcheck: 'false' }) : null;
    if (lineBox) lineBox.value = s.line;
    app.openWindow(`Publish guard: ${p.name}`, [
      el('p', { text: `Checks ${p.name} with the office's audit before every git push, from any tool (Claude Code, GitHub Desktop, a terminal), and stops the push while the audit says "fix first". Waiting to fix is better than publishing a fault.` }),
      el('p', {}, el('b', { class: said[0], text: said[1] })),
      lineBox,
      el('p', { class: 'note', text: 'Turning it on writes one file in this project, .git/hooks/pre-push (git never uploads it). It is the only file the office writes in a project, and Turn off removes it again. A finding you set aside as not a fault no longer stops a push. To push anyway, knowing what it holds: git push --no-verify.' }),
      err],
    [btn('Ready to publish?', () => gateCheck(id), true),
      s.state === 'off' ? btn('Turn on', set(true)) : null,
      s.state === 'on' ? btn('Turn off', set(false)) : null,
      btn('Close', app.closeWindow)]);
  }
  app.gateWindow = gateWindow;

  async function gateCheck(id) {
    const p = proj(id);
    if (!p) return;
    app.openWindow(`Checking ${p.name}…`, [el('p', { class: 'note', text: 'The same check a push gets: the project\'s files, its AI agent files and what publishing would give away (no live site).' })], []);
    try {
      const d = await app.engine('/api/gate/check', { id });
      app.showAudit(p, d.audit, d.ready ? 'Ready to publish: no Critical or High finding.' : 'Not ready to publish: fix the Critical and High findings first. With the publish guard on, a push is stopped until then.');
    } catch (e) { app.openWindow('The check did not finish', [el('p', { text: app.faultText(e) })], [btn('Close', app.closeWindow, true)]); }
  }

  /** Publish guard… in a project's More menu (and a person's Actions), for a git repository only. */
  app.gateMenuItems = (p, cls = 'btn small') => (hasGit(p) ? [el('button', { type: 'button', class: cls, 'data-act': 'gate', 'data-id': p.id, title: `Check ${p.name} with the audit before every git push`,
    onclick: (e) => { const m = e.currentTarget.closest('details'); if (m) m.open = false; gateWindow(p.id); } }, 'Publish guard…')] : []);
  app.gateHasGit = hasGit;
})();
