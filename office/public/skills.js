// Settings › Check a skill (drawn here, shown by settings.js): a Claude Code skill, plugin or agent folder checked
// before it is installed (lib/agents.js). Paste its SKILL.md, or choose its folder or zip. The engine reads it on this
// PC and runs nothing in it; the answer is a verdict, the findings, and what the skill does (the scripts and hooks it
// runs, the services and keys it uses).
'use strict';

(() => {
  const app = window.aiOffice;
  const { el } = app;
  const SEV = { Critical: { mark: '◆ Critical', cls: 'm-bad' }, High: { mark: '▲ High', cls: 'm-bad' }, Medium: { mark: '■ Medium', cls: 'm-warn' }, Low: { mark: '○ Low', cls: 'm-none' }, Info: { mark: '· Info', cls: 'm-none' } };
  const btn = (label, onclick, primary = false, extra = {}) => el('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, onclick, ...extra }, label);
  const note = (t) => el('p', { class: 'note', text: t });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function result(r) {
    const cls = r.verdict === 'do-not-install' ? 'm-bad' : r.verdict === 'read-first' ? 'm-warn' : 'm-ok';
    const item = (f) => el('li', { class: 'finding' }, el('span', { class: `sev ${(SEV[f.sev] || SEV.Medium).cls}`, text: (SEV[f.sev] || SEV.Medium).mark }),
      el('div', { class: 'what' }, el('b', { text: f.title }), el('span', { class: 'where', text: `${f.where} · ${f.rule} · ${f.fix}` })));
    const d = r.does || {};
    const doesRows = [
      d.runs?.length ? ['Scripts it runs', d.runs] : null,
      d.hooks?.length ? ['Runs on its own (hooks)', d.hooks] : null,
      d.hosts?.length ? ['Services it talks to', d.hosts] : null,
      d.keys?.length ? ['Keys it reads', d.keys] : null,
    ].filter(Boolean);
    return [
      el('h3', {}, el('span', { class: cls, text: r.headline })),
      note(`${r.counts.Critical} critical, ${r.counts.High} high, ${r.counts.Medium} to read first · ${r.rules} checks over ${plural(r.filesRead.length, 'file', 'files')}.`),
      r.findings.length ? el('ol', { class: 'findings' }, r.findings.slice(0, 60).map(item)) : null,
      doesRows.length ? el('details', { open: true }, el('summary', { text: 'What it does' }),
        el('ul', {}, doesRows.map(([k, v]) => el('li', {}, el('b', { text: `${k}: ` }), `${v.slice(0, 20).join(', ')}${v.length > 20 ? '…' : ''}`)))) : null,
      ...(r.notes || []).map(note),
      note('This check knows the common shapes of these attacks, not every one. A skill it passes can still do harm: install skills from makers you trust, and read what a skill runs.'),
    ];
  }

  app.drawSkillCheck = (say) => {
    const text = el('textarea', { class: 'field-text', rows: '8', placeholder: 'Paste the SKILL.md (or CLAUDE.md, AGENTS.md, a command) here', 'aria-label': 'Skill text', spellcheck: 'false' });
    const input = el('input', { type: 'text', class: 'field-text', placeholder: 'or the folder or .zip / .skill file, e.g. C:\\Users\\you\\Downloads\\some-skill', 'aria-label': 'Skill folder or zip', spellcheck: 'false' });
    const out = el('div', { class: 'skill-result', 'aria-live': 'polite' });
    const check = async (e) => {
      const body = text.value.trim() ? { text: text.value } : input.value.trim() ? { path: input.value.trim() } : null;
      if (!body) { say('Paste the skill\'s text, or choose its folder or zip.'); return text.focus(); }
      const b = e.currentTarget;
      b.disabled = true; say('Checking…');
      try {
        const r = await app.engine('/api/skill-check', body);
        if (r.error) say(r.error);
        else { say(`Checked: ${r.headline}.`); out.replaceChildren(...result(r).filter(Boolean)); }
      } catch (err) { say(app.faultText(err)); }
      b.disabled = false;
    };
    return [
      note('Before you install a skill, plugin or agent file from someone else, check it here for the known attacks: instructions hidden where the agent reads them and you do not, keys or files sent away, a program downloaded and run, a change that starts it again later.'),
      text,
      el('div', { class: 'row' }, input,
        btn('Browse…', async () => { try { const r = await app.engine('/api/pick-folder', { purpose: 'skill' }); if (r.path) input.value = r.path; else if (r.dryRun) say(`Test copy: ${r.dryRun} (type a path instead).`); else if (r.error) say(r.error); } catch (err) { say(app.faultText(err)); } }),
        btn('Check', check, true)),
      note('Read on this PC only. Nothing in it is run, and nothing is sent anywhere.'),
      out,
    ];
  };
})();
