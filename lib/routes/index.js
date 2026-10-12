// Every request goes through here, in this order: local Host only, the page and its files, then the API, which
// needs the per-run key. API routes live in the files beside this one, as tables of path -> handler.
// A handler gets { req, res, url, body, p } and returns the JSON to send (or nothing, when it answered itself).
'use strict';
const cfg = require('../config');
const { send, readBody, servePublic } = require('../http');
const { findProject } = require('../state');
const system = require('./system');
const lists = require('./lists');
const prompts = require('./prompts');
const project = require('./project');
const office = require('../office');

const GET = { ...system.get, ...lists.get, ...prompts.get };
const POST = { ...system.post, ...lists.post, ...prompts.post };
const ALLOWED_HOSTS = new Set(['127.0.0.1:' + cfg.PORT, 'localhost:' + cfg.PORT]);

async function reply(res, out) {
  const v = await out;
  if (v !== undefined && !res.headersSent) send(res, 200, v);
}

async function handle(req, res) {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host || '')) return send(res, 421, { error: 'The office only answers on 127.0.0.1:' + cfg.PORT + '.' });
    const url = new URL(req.url, 'http://127.0.0.1');
    if (servePublic(req, res, url.pathname)) return;
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    // The AI app's hook (office/hook.mjs, advanced setup) has no page and no key: it may only report an event, as
    // JSON, which a web page elsewhere cannot send here (that needs a cross-site check this server never passes).
    if (url.pathname === '/api/office/hook') {
      if (req.method !== 'POST' || !String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 403, { error: 'Not accepted.' });
      return await office.handle(req, res, 'hook');
    }
    if (req.headers['x-aho-key'] !== cfg.KEY) return send(res, 403, { error: 'This page is from an older office run. Reload the page.' });
    if (url.pathname.startsWith('/api/office/')) return await office.handle(req, res, url.pathname.slice('/api/office/'.length));
    const ctx = { req, res, url, body: {} };

    if (req.method === 'GET') {
      if (GET[url.pathname]) return await reply(res, GET[url.pathname](ctx));
      if (project.get[url.pathname]) {
        const p = findProject(url.searchParams.get('id'));
        return p ? await reply(res, project.get[url.pathname]({ ...ctx, p })) : send(res, 404, { error: 'Unknown project.' });
      }
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

    // A pasted report-back table can be long; everything else is small.
    ctx.body = await readBody(req, url.pathname.startsWith('/api/prompts/') ? prompts.BODY_LIMIT : url.pathname === '/api/audit/import' ? 200000 : 10000);
    if (POST[url.pathname]) return await reply(res, POST[url.pathname](ctx));
    if (project.post[url.pathname]) {
      const p = findProject(ctx.body.id);
      return p ? await reply(res, project.post[url.pathname]({ ...ctx, p })) : send(res, 404, { error: 'Unknown project. Reload the list.' });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    if (res.headersSent) return;
    if (e && e.status) return send(res, e.status, { error: e.message });
    send(res, 500, { error: 'The office hit an error: ' + (e.message || e) + '. Try again; if it repeats, see the office window.' });
  }
}

module.exports = { handle };
