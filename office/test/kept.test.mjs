// AHO-15, AHO-16 (1 Nov): an office file that cannot be read, and whose safe copy cannot be made, is never written
// over: the ledger keeps what was earned, the shop what was bought. The copy is made to fail here (no disk is filled).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Office } from '../src/office.mjs';
import { buy } from '../src/shop.mjs';
import { tempHome } from './helpers.mjs';

function copiesFail() {
  const real = fs.copyFileSync;
  fs.copyFileSync = (a, b, ...r) => { if (String(b).includes('.damaged-')) { const e = new Error('denied'); e.code = 'EPERM'; throw e; } return real(a, b, ...r); };
  return () => { fs.copyFileSync = real; };
}

test('AHO-15: a damaged ledger whose copy cannot be made is not written over; once the copy works, it is', () => {
  const h = tempHome();
  const restore = copiesFail();
  try {
    fs.mkdirSync(h.data, { recursive: true });
    const ledger = path.join(h.data, 'ledger.json');
    fs.writeFileSync(ledger, '{"threads": {"a": cut short');
    const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts });
    office.dirty = true;
    assert.throws(() => office.save(), /not written over/);
    assert.equal(fs.readFileSync(ledger, 'utf8'), '{"threads": {"a": cut short', 'the ledger is as it was');
    restore();
    office.dirty = true;
    office.save();
    assert.ok(fs.readdirSync(h.data).some((n) => /^ledger\.damaged-.*\.json$/.test(n)), 'copied aside first');
  } finally {
    restore();
    h.done();
  }
});

test('AHO-16: damaged purchases whose copy cannot be made: the shop refuses, and the file is as it was', () => {
  const h = tempHome();
  const restore = copiesFail();
  try {
    fs.mkdirSync(h.data, { recursive: true });
    const file = path.join(h.data, 'office.json');
    fs.writeFileSync(file, '{"bought": [ cut short');
    const office = new Office({ dataDir: h.data, transcriptsDir: h.transcripts });
    office.snapshot = () => ({ earned: 1e9 });
    const r = buy(office, 'coffee');
    assert.ok(r.error, JSON.stringify(r));
    assert.match(r.error.fault, /closed/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"bought": [ cut short');
  } finally {
    restore();
    h.done();
  }
});
