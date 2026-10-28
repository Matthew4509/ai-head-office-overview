// The To Do (lib/todo.js): its rows, zones, sizes, quick checks and the person's day. Projects are named by id only
// (a folder path in a request is never used); a row is named by its own id.
'use strict';
const { state, findProject } = require('../state');

const T = () => state.todo;
const bad = (fault, reason = '', wayOut = '') => ({ ok: false, fault, reason, wayOut });
const names = () => Object.fromEntries(state.projects.map(p => [p.id, p.name]));
const onList = id => state.projects.some(p => p.id === id);
const itemId = v => (typeof v === 'string' && /^[0-9a-f]{8,16}$/.test(v) ? v : null);

const get = {
  '/api/todo': () => ({ ok: true, ...T().view(names(), onList) }),
};

const post = {
  // { project (id), size, note, zone, every? }: a row, and (with every) the project's quick check too.
  '/api/todo/add': ({ body }) => {
    const p = typeof body.project === 'string' && findProject(body.project);
    if (!p) return bad('That project is not on the list.', '', 'Reload the page, then pick it again.');
    const r = T().add({ project: p.id, name: p.name, size: body.size, note: body.note, zone: body.zone });
    if (r.ok && (body.every === 'week' || body.every === 'month')) T().setCheck(p.id, body.every, p.name);
    return r;
  },
  '/api/todo/set': ({ body }) => T().set(itemId(body.item), { size: body.size, note: body.note }),
  '/api/todo/move': ({ body }) => T().move(itemId(body.item), body.zone, itemId(body.before)),
  '/api/todo/done': ({ body }) => T().done(itemId(body.item), body.done !== false),
  '/api/todo/remove': ({ body }) => T().remove(itemId(body.item)),
  // A project's quick check: { project (id), every: 'week' | 'month' | 'off' }.
  '/api/todo/check': ({ body }) => {
    const p = typeof body.project === 'string' && findProject(body.project);
    if (!p && body.every !== 'off') return bad('That project is not on the list.', '', 'Reload the page.');
    return T().setCheck(p ? p.id : body.project, body.every, p ? p.name : '');
  },
  '/api/todo/settings': ({ body }) => T().setSettings({ dayHours: body.dayHours, checksPerDay: body.checksPerDay, doneShow: body.doneShow }),
};

module.exports = { get, post };
