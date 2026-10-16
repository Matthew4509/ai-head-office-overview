// The Prompts tab: prompts you use again and again, a tile per category (starred prompts above them). A tile opens its
// prompts, starred first, as tiles a third wide: a star, Copy, Edit (which
// can move it to another category), Remove. New category and Add prompt sit above the tiles; inside a category,
// Rename and Delete category. Search looks in names and text. Kept by the engine (/api/prompts) on this PC only.
'use strict';

(() => {
  const app = window.aiOffice;
  const { el, swap } = app;
  const box = document.getElementById('prompts-view');
  const sheet = document.getElementById('check');
  const st = { prompts: null, cats: [], cat: '', q: '' };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const fault = (e) => { const f = e?.error || {}; return f.fault || String(e?.message || e); };
  const catOf = (id) => st.cats.find((c) => c.id === id);
  const inCat = (id) => st.prompts.filter((p) => p.category === id);
  const btn = (label, onclick, primary = false) => el('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, onclick }, label);

  async function load() {
    try { const r = await app.engine('/api/prompts'); st.prompts = r.prompts; st.cats = r.categories; if (st.cat && !catOf(st.cat)) st.cat = ''; draw(); } catch (e) { app.showFault(e); }
  }
  app.loadPrompts = load;

  // The search box is made once and kept, so typing is never interrupted by a redraw.
  const search = el('input', { type: 'search', class: 'field-text prompt-search', 'aria-label': 'Search prompts', oninput: (e) => { st.q = e.target.value; draw(); } });

  function draw() {
    if (!st.prompts) { swap(box, el('p', { class: 'note', text: 'Reading your prompts…' })); return; }
    const cat = catOf(st.cat);
    const q = st.q.trim().toLowerCase();
    search.placeholder = cat ? `Search ${cat.name}` : 'Search all prompts';
    const head = el('div', { class: 'row prompt-head' },
      cat ? btn('← All categories', () => { st.cat = ''; draw(); }) : null,
      el('h2', { class: 'prompt-title', text: cat ? cat.name : 'Prompts' }),
      btn('Add prompt', () => promptWindow(), true),
      cat ? btn('Rename category', () => catWindow(cat)) : btn('New category', () => catWindow()),
      cat ? btn('Delete category', () => removeCat(cat)) : null);
    // Starred prompts first (in their saved order), then the rest.
    const starredFirst = (list) => [...list.filter((p) => p.starred), ...list.filter((p) => !p.starred)];
    const tiles = (list, withCat) => el('ul', { class: 'prompt-list' }, list.map((p) => el('li', { class: `prompt-row${p.starred ? ' starred' : ''}` },
      el('div', { class: 'prompt-txt' }, el('div', { class: 'prompt-name' }, el('b', { text: p.title }), starBtn(p)),
        withCat ? el('span', { class: 'note', text: catOf(p.category)?.name || '' }) : null, el('span', { class: 'prompt-text', text: p.text })),
      el('div', { class: 'row' }, btn('Copy', () => copy(p), true), btn('Edit', () => promptWindow(p)), btn('Remove', () => removePrompt(p))))));
    let body;
    if (!cat && !q) {
      // Starred prompts from every category sit above the category tiles, so a favourite is one click away.
      const starred = st.prompts.filter((p) => p.starred);
      body = el('div', {}, starred.length ? [el('h3', { class: 'prompt-group', text: '★ Starred' }), tiles(starred, true), el('h3', { class: 'prompt-group', text: 'Categories' })] : null,
        el('ul', { class: 'prompt-tiles' }, st.cats.map((c) => el('li', {}, el('button', { type: 'button', class: 'ptile', onclick: () => { st.cat = c.id; draw(); } }, el('b', { text: c.name }),
          el('span', { class: 'note', text: `${plural(inCat(c.id).length, 'prompt', 'prompts')}${inCat(c.id).some((p) => p.starred) ? ` · ${inCat(c.id).filter((p) => p.starred).length} ★` : ''}` }))))));
    } else {
      const pool = cat ? inCat(cat.id) : st.prompts;
      const shown = starredFirst(q ? pool.filter((p) => `${p.title}\n${p.text}`.toLowerCase().includes(q)) : pool);
      body = shown.length ? tiles(shown, !cat)
        : el('p', { class: 'empty', text: q ? `No prompt matches "${st.q.trim()}"${cat ? ` in ${cat.name}` : ''}. Search looks in the names and the text.` : `No prompts in ${cat.name} yet. Add prompt saves one.` });
    }
    // The search box is put back in place, not rebuilt: swap() would replace it and lose the cursor.
    const tail = el('div', {}, head, body);
    if (!box.contains(search)) box.replaceChildren(search, el('div', { class: 'prompt-body' }));
    swap(box.querySelector('.prompt-body'), tail);
  }
  app.drawPrompts = () => (st.prompts ? draw() : load());

  /** A prompt's star: starred prompts come first, and show under Starred above the categories. */
  function starBtn(p) {
    const on = !!p.starred;
    return el('button', { type: 'button', class: 'star-btn', 'aria-pressed': String(on), 'aria-label': `Star: ${p.title}`,
      title: on ? `"${p.title}" is starred: it comes first and shows under Starred. Click to take the star off.` : `Star "${p.title}": it comes first and shows under Starred, above the categories.`,
      onclick: async () => {
        try { await app.engine('/api/prompts/star', { id: p.id, on: !on }); p.starred = !on || undefined; draw(); } catch (e) { app.showFault(e); }
      } }, on ? '★' : '☆');
  }

  async function copy(p) {
    try { await navigator.clipboard.writeText(p.text); app.say(`Prompt "${p.title}" copied. Paste it into the AI you use.`); } catch { app.say('The clipboard was blocked: open Edit and copy the text from there.'); }
  }

  function open(title, kids, buttons) {
    sheet.replaceChildren(el('div', { class: 'sheet-box wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'check-title' }, el('h2', { id: 'check-title', text: title }), ...kids, el('div', { class: 'row sheet-foot' }, ...buttons)));
    sheet.hidden = false;
    sheet.onclick = (e) => { if (e.target === sheet) close(); };
    sheet.querySelector('input, textarea')?.focus();
  }
  function close() { sheet.hidden = true; sheet.replaceChildren(); }

  function promptWindow(p) {
    if (!st.cats.length) return catWindow(null, 'Make a category first, then add the prompt to it.');
    const title = el('input', { type: 'text', class: 'field-text', maxlength: '120', value: p ? p.title : '', placeholder: 'For example: Plan this project', 'aria-label': 'Name' });
    const start = p ? p.category : catOf(st.cat) ? st.cat : st.cats[0].id;
    const cat = el('select', { class: 'field-text', 'aria-label': 'Category' }, st.cats.map((c) => el('option', { value: c.id, selected: c.id === start }, c.name)));
    const text = el('textarea', { class: 'field-text', rows: '12', 'aria-label': 'Prompt', placeholder: 'Type or paste the prompt. Put the parts to fill in each time in [brackets].' });
    text.value = p ? p.text : '';
    const count = el('p', { class: 'note' });
    const err = el('p', { class: 'note check-said', role: 'alert' });
    const tally = () => { count.textContent = `${text.value.length.toLocaleString()} of 20,000 characters`; };
    text.addEventListener('input', tally); tally();
    open(p ? 'Edit prompt' : 'Add prompt', [el('label', { class: 'note', text: 'Name' }), title, el('label', { class: 'note', text: 'Category' }), cat, el('label', { class: 'note', text: 'Prompt' }), text, count, err],
      [btn(p ? 'Save' : 'Add prompt', async () => {
        try {
          const r = await app.engine('/api/prompts/save', { id: p ? p.id : undefined, category: cat.value, title: title.value, text: text.value });
          close(); app.say(`Prompt "${r.prompt.title}" ${p ? 'saved' : 'added'}${catOf(r.prompt.category) ? ` in ${catOf(r.prompt.category).name}` : ''}.`); load();
        } catch (e) { err.textContent = fault(e); }
      }, true), btn('Cancel', close)]);
  }
  function removePrompt(p) {
    open(`Remove "${p.title}"?`, [el('p', { text: 'The prompt is deleted and cannot be brought back. Copy it first if you might want it again.' })],
      [btn('Remove', async () => { try { await app.engine('/api/prompts/remove', { id: p.id }); close(); app.say(`Prompt "${p.title}" removed.`); load(); } catch (e) { close(); app.showFault(e); } }, true), btn('Copy first', () => copy(p)), btn('Cancel', close)]);
  }
  function catWindow(c, lead = '') {
    const name = el('input', { type: 'text', class: 'field-text', maxlength: '60', value: c ? c.name : '', placeholder: 'For example: Photography', 'aria-label': 'Name' });
    const err = el('p', { class: 'note check-said', role: 'alert' });
    open(c ? `Rename "${c.name}"` : 'New category', [lead ? el('p', { text: lead }) : null, el('label', { class: 'note', text: 'Name' }), name, err].filter(Boolean),
      [btn(c ? 'Rename' : 'Add category', async () => {
        try { const r = await app.engine('/api/prompts/category/save', { id: c ? c.id : undefined, name: name.value }); close(); app.say(c ? `Category renamed to "${r.category.name}".` : `Category "${r.category.name}" added.`); if (!c) st.cat = r.category.id; load(); } catch (e) { err.textContent = fault(e); }
      }, true), btn('Cancel', close)]);
  }
  function removeCat(c) {
    const n = inCat(c.id).length;
    open(`Delete "${c.name}"?`, [el('p', { text: n ? `The category and the ${plural(n, 'prompt', 'prompts')} in it are deleted and cannot be brought back. To keep a prompt, Edit it and move it to another category first.` : 'The category is empty. It is deleted.' })],
      [btn(n ? `Delete category and ${plural(n, 'prompt', 'prompts')}` : 'Delete category', async () => {
        try { await app.engine('/api/prompts/category/remove', { id: c.id }); close(); app.say(`Category "${c.name}" deleted.`); st.cat = ''; load(); } catch (e) { close(); app.showFault(e); }
      }, true), btn('Cancel', close)]);
  }
})();
