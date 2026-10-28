// Signing a release (run by tools/bake.js after every zip it makes; also on its own):
//   node tools/sign-release.js tag    the signed message for the annotated tag v<version> on the commit you are on
//   node tools/sign-release.js zip    signs _releases/ai-head-office-overview-<version>.zip again (writes its .zip.sig)
// The release key's private half lives outside the repository: at AHO_RELEASE_KEY when that is set, otherwise in the
// private folder in your home folder (KEY_DEFAULT below). The first bake with no key makes one, saves the private half
// there and writes the public half into lib/release.js. Every signature is checked against the public half the office
// carries before it is written, so a wrong key is caught here, not on every PC.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const HERE = path.resolve(__dirname, '..');
const RELEASE_JS = path.join(HERE, 'lib', 'release.js');
const KEY_DEFAULT = path.join(os.homedir(), 'claude-private', 'aho-release-key.pem');
const keyPath = () => process.env.AHO_RELEASE_KEY || KEY_DEFAULT;
const versionOf = text => (/const VERSION = '([^']+)'/.exec(text) || [])[1];
const carried = (file = RELEASE_JS) => (/const RELEASE_KEY = '([^']*)';/.exec(fs.readFileSync(file, 'utf8')) || [])[1];

// The public half the office carries, written into lib/release.js (the one line that names it).
function writeCarried(spki, file = RELEASE_JS) {
  const text = fs.readFileSync(file, 'utf8');
  const next = text.replace(/const RELEASE_KEY = '[^']*';/, "const RELEASE_KEY = '" + spki + "';");
  if (next === text && carried(file) !== spki) throw new Error('lib/release.js has no RELEASE_KEY line to write the key into');
  fs.writeFileSync(file, next);
}

/**
 * The release key, made the first time. Returns { pem, made, said } or { error }.
 * newKey: the key is lost, so a new pair replaces the one the office carries (that one version is installed by hand).
 */
function ensureKey({ file = keyPath(), releaseJs = RELEASE_JS, newKey = false } = {}) {
  const pub = carried(releaseJs);
  const { publicOf } = require('../lib/release');
  if (fs.existsSync(file)) {
    const pem = fs.readFileSync(file, 'utf8');
    let mine;
    try { mine = publicOf(pem); } catch { return { error: 'The release key at ' + file + ' could not be read as a key. Put the right file back there (or set AHO_RELEASE_KEY to where it is).' }; }
    if (!pub) { writeCarried(mine, releaseJs); return { pem, made: false, said: 'The office now carries the public half of the release key at ' + file + ' (written into lib/release.js).' }; }
    if (pub !== mine && !newKey) return { error: 'The release key at ' + file + ' is not the one the office carries in lib/release.js. Put the right key there; or, only if the right one is lost, run the bake with --new-key.' };
    if (pub === mine) return { pem, made: false };
  } else if (pub && !newKey) {
    return { error: 'The release key is not at ' + file + ', and the office already carries one. Found it? Put it back there (or set AHO_RELEASE_KEY to where it is). Lost it? Run the bake with --new-key: that one version is then installed by hand once, and updates work again from it on.' };
  }
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  if (fs.existsSync(file)) fs.renameSync(file, file + '.replaced-' + Date.now());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pem, { mode: 0o600 });
  writeCarried(publicOf(pem), releaseJs);
  return { pem, made: true, said: 'Made the release key: ' + file + ' (keep a copy of this file somewhere safe; it never goes in the repository or a zip). Its public half is now in lib/release.js.' };
}

const sha256Of = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Writes <zip>.sig, checked against the key the office carries first. Returns the sentence to print, or throws. */
function signZip(zip, version, pem, releaseJs = RELEASE_JS) {
  const { signRelease, zipCheck } = require('../lib/release');
  const sha = sha256Of(zip);
  const sig = signRelease(pem, version, sha);
  // Read from the file now: the key may have been written there a moment ago, after release.js was loaded.
  const c = zipCheck(sig, version, sha, carried(releaseJs));
  if (c.code) throw new Error('not signed: ' + c.why + '. The key used is not the one lib/release.js carries.');
  fs.writeFileSync(zip + '.sig', JSON.stringify(sig, null, 1) + '\n');
  return 'Signed: ' + path.relative(HERE, zip) + '.sig (sha256 ' + sha.slice(0, 16) + '…).';
}

const git = (dir, args) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'safe.bareRepository=explicit', '-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) } }).trim();

/**
 * The tag message for the commit you are on, written to _releases/ai-head-office-overview-<v>.tag.txt; or why not
 * (files not committed, or the commit says another version). Returns { file, commit } or { why }.
 */
function writeTag(version, pem, { dir = HERE, releaseJs = RELEASE_JS } = {}) {
  const { signTag, tagMessage, tagCheck } = require('../lib/release');
  let commit, tree, changed, atHead;
  try {
    commit = git(dir, ['rev-parse', 'HEAD']); tree = git(dir, ['rev-parse', 'HEAD^{tree}']);
    changed = git(dir, ['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=all']);
    atHead = versionOf(git(dir, ['show', 'HEAD:lib/config.js']));
  } catch { return { why: 'this folder is not a git repository with a commit, so there is no tag to sign' }; }
  if (changed) return { why: 'files are changed but not committed (' + changed.split('\n').length + '), so the commit is not what was baked. Commit, then run  node tools/sign-release.js tag' };
  if (atHead !== version) return { why: 'the commit you are on says version ' + atHead + ', not ' + version + '. Commit the version change, then run  node tools/sign-release.js tag' };
  const s = signTag(pem, version, commit, tree);
  const c = tagCheck(s, version, commit, tree, carried(releaseJs));
  if (c.code) return { why: 'not signed: ' + c.why };
  const file = path.join(dir, '_releases', 'ai-head-office-overview-' + version + '.tag.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, tagMessage(s));
  return { file, commit };
}

/** The steps that stay yours: the tag, the push, the GitHub Release. */
function nextSteps(version, tag) {
  const { REPO, ZIP_NAME } = require('../lib/release');
  const lines = [];
  if (tag.file) lines.push('Signed tag message: ' + path.relative(HERE, tag.file) + ' (commit ' + tag.commit.slice(0, 7) + '). To publish it:',
    '  git tag -a v' + version + ' -F "' + path.relative(HERE, tag.file) + '"', '  git push origin v' + version);
  else lines.push('No tag message yet: ' + tag.why + '.');
  lines.push('Settings › About › Update offers a version only once its signed tag v' + version + ' is on GitHub.',
    'A GitHub Release is optional: https://github.com/' + REPO + '/releases/new  Tag: v' + version + '  Title: AI Head Office Overview ' + version,
    '  Attach both files: _releases/' + ZIP_NAME(version) + ' and _releases/' + ZIP_NAME(version) + '.sig, then Publish release.');
  return lines.join('\n');
}

module.exports = { ensureKey, signZip, writeTag, nextSteps, sha256Of, KEY_DEFAULT };

if (require.main === module) {
  const version = versionOf(fs.readFileSync(path.join(HERE, 'lib', 'config.js'), 'utf8'));
  const what = process.argv[2];
  if (what !== 'tag' && what !== 'zip') { console.log('Use: node tools/sign-release.js tag   or   node tools/sign-release.js zip'); process.exit(2); }
  const k = ensureKey();
  if (k.error) { console.error(k.error); process.exit(1); }
  if (k.said) console.log(k.said);
  try {
    if (what === 'zip') {
      const zip = path.join(HERE, '_releases', 'ai-head-office-overview-' + version + '.zip');
      if (!fs.existsSync(zip)) { console.error(path.relative(HERE, zip) + ' is not there: run  node tools/bake.js  first.'); process.exit(1); }
      console.log(signZip(zip, version, k.pem));
    }
    const tag = writeTag(version, k.pem);
    console.log(nextSteps(version, tag));
    if (what === 'tag' && tag.why) process.exit(1);
  } catch (e) { console.error(e.message); process.exit(1); }
}
