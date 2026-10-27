// Signed updates: what a release of the office is signed with, and how a signature is checked. The private half of the
// release key never ships and never sits in the repository; the office carries only the public half, RELEASE_KEY
// below (written here by the bake the first time it makes the key). A git release is signed as its version plus the
// exact commit and tree, carried in the annotated tag's message; a zip as its version plus its SHA-256. Nothing here
// reads the network or the disk: lib/update.js does, and test/update.test.js checks these parts.
'use strict';
const crypto = require('crypto');

/** The release key's public half (Ed25519, SPKI, base64). Empty until the first bake makes the key. */
const RELEASE_KEY = 'MCowBQYDK2VwAyEAfveUyFY7t2dhd5GQmCyQ/CatkdJUSAy9jRyPLc8RfWw=';

// Where updates come from: fixed here, never read from a file or the folder's own git settings.
const GIT_URL = 'https://github.com/Matthew4509/ai-head-office-overview.git';
const REPO = GIT_URL.slice('https://github.com/'.length, -'.git'.length);
const ZIP_NAME = v => 'ai-head-office-overview-' + v + '.zip';
const TAG_MARK = 'aho-release ';

const isVersion = v => /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(v || ''));
// 0.1.10 is newer than 0.1.9: compared part by part as numbers.
function compareVersions(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}
const newer = (a, b) => isVersion(a) && isVersion(b) && compareVersions(a, b) > 0;

/** What a zip's signature covers: one version, one zip. */
const signedText = (version, sha256) => 'AI Head Office Overview release ' + version + '\nsha256 ' + String(sha256).toLowerCase() + '\n';
/** What a git release's signature covers: one version, one commit and its tree. */
const gitSignedText = (version, commit, tree) => 'AI Head Office Overview release ' + version + '\ncommit ' + commit + '\ntree ' + tree + '\n';

const keyOf = spki => crypto.createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' });
/** The public half (SPKI base64) of a private key in PEM. */
const publicOf = privatePem => crypto.createPublicKey(crypto.createPrivateKey(privatePem)).export({ type: 'spki', format: 'der' }).toString('base64');
const signWith = (privatePem, text) => crypto.sign(null, Buffer.from(text), crypto.createPrivateKey(privatePem)).toString('base64');
function verifies(spki, text, signature) {
  try { return crypto.verify(null, Buffer.from(text), keyOf(spki), Buffer.from(String(signature), 'base64')); } catch { return false; }
}

/** The .zip.sig beside a release zip. `key` names the public half it was made with (so a new key can be told apart). */
function signRelease(privatePem, version, sha256) {
  return { version, sha256: String(sha256).toLowerCase(), key: publicOf(privatePem), signature: signWith(privatePem, signedText(version, sha256)) };
}
/** The signed part of a git release's tag message. */
function signTag(privatePem, version, commit, tree) {
  return { version, commit, tree, key: publicOf(privatePem), signature: signWith(privatePem, gitSignedText(version, commit, tree)) };
}
/** The whole message of the annotated tag v<version>: a title line, then the signed part on one line. */
const tagMessage = s => 'AI Head Office Overview ' + s.version + '\n\n' + TAG_MARK + JSON.stringify(s) + '\n';
/** The signed part back out of a tag object (as `git cat-file tag` prints it), or null. */
function tagSigOf(tagObject) {
  const line = String(tagObject || '').split('\n').find(l => l.startsWith(TAG_MARK));
  try { const v = JSON.parse(line.slice(TAG_MARK.length)); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

// The reasons a signature does not pass, each with a code:
//   none     no signature came with it              format  it is not a signature the office's maker makes
//   version  it is for another version              changed the zip (or commit) is not the one that was signed
//   newkey   made with a key this office does not carry, but whole (the maker may have changed keys)
//   bad      it does not check out with any key it names
//   nokey    this office carries no release key at all
function check(sig, text, version, fields, key) {
  if (sig == null) return { code: 'none', why: 'no signature came with it' };
  const s = typeof sig === 'object' ? sig : {};
  if (typeof s.signature !== 'string' || typeof s.version !== 'string' || fields.some(([f]) => typeof s[f] !== 'string')) return { code: 'format', why: 'its signature is not one the office\'s maker makes' };
  if (s.version !== version) return { code: 'version', why: 'its signature is for AI Head Office Overview ' + s.version.slice(0, 20) + ', not ' + version };
  for (const [f, want, what] of fields) if (s[f].toLowerCase() !== String(want).toLowerCase()) return { code: 'changed', why: what };
  if (!key) return { code: 'nokey', why: 'this office carries no release key, so it cannot check any signature' };
  if (verifies(key, text, s.signature)) return { code: '', why: '' };
  if (typeof s.key === 'string' && s.key !== key && verifies(s.key, text, s.signature)) return { code: 'newkey', why: 'it is signed with a key this office does not know (the office\'s maker may have changed keys)' };
  return { code: 'bad', why: 'its signature was not made with the office\'s release key' };
}
/** A zip's signature: { code, why }, code '' when it passes. */
function zipCheck(sig, version, sha256, key = RELEASE_KEY) {
  return check(sig, signedText(version, String(sha256).toLowerCase()), version, [['sha256', sha256, 'the zip is not the one that was signed (it was changed, or cut short)']], key);
}
/** A git release's signature: { code, why }. commit and tree are what the tag really points at. */
function tagCheck(sig, version, commit, tree, key = RELEASE_KEY) {
  return check(sig, gitSignedText(version, commit, tree), version, [
    ['commit', commit, 'the tag points at another commit than the one that was signed'],
    ['tree', tree, 'the files in the tagged commit are not the ones that were signed'],
  ], key);
}

module.exports = {
  RELEASE_KEY, REPO, GIT_URL, ZIP_NAME, isVersion, compareVersions, newer, signedText, gitSignedText, publicOf,
  signRelease, signTag, tagMessage, tagSigOf, zipCheck, tagCheck,
};
