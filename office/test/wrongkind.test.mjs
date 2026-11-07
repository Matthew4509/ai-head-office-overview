// A data file that is valid JSON of the wrong kind (null, a number, [] where {} belongs) used to be handed back as it was,
// and the office never finished opening. It is now copied aside and the default is used, like a cut-short file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Office } from '../src/office.mjs';
import { readJson } from '../src/files.mjs';
import { tempHome } from './helpers.mjs';

test('readJson: the wrong kind of JSON is set aside and the fallback returned; the right kind is untouched', () => {
  const h = tempHome();
  fs.mkdirSync(h.data, { recursive: true });
  for (const [text, fallback] of [['null', {}], ['42', {}], ['"hi"', {}], ['[]', {}], ['{"a":1}', []]]) {
    const f = path.join(h.data, 'x' + Math.random().toString(36).slice(2) + '.json');
    fs.writeFileSync(f, text);
    assert.deepEqual(readJson(f, fallback), fallback, text);
    assert(fs.readdirSync(h.data).some(n => n.startsWith(path.basename(f, '.json') + '.damaged-')), 'copy of ' + text);
  }
  const ok = path.join(h.data, 'ok.json'); fs.writeFileSync(ok, '{"a":1}');
  assert.deepEqual(readJson(ok, {}), { a: 1 });
});

test('the office opens with a null settings file and an array ledger, and keeps copies of both', () => {
  const h = tempHome();
  fs.mkdirSync(h.data, { recursive: true });
  fs.writeFileSync(path.join(h.data, 'settings.json'), 'null');
  fs.writeFileSync(path.join(h.data, 'ledger.json'), '[]');
  const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts });
  assert(office.settings && typeof office.settings === 'object');
  assert.deepEqual(office.ledger, { threads: {} });
  const names = fs.readdirSync(h.data);
  assert(names.some(n => n.startsWith('settings.damaged-')) && names.some(n => n.startsWith('ledger.damaged-')), names.join());
});
