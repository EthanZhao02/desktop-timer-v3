const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..');
const archive = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
const shippedFiles = ['main.js', 'timer-core.js', 'preload.js', 'index.html', 'pet.html'];

assert.ok(fs.existsSync(archive), 'Build output is missing; run npm run build-portable');

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

for (const file of shippedFiles) {
  const source = fs.readFileSync(path.join(root, file));
  const packaged = asar.extractFile(archive, file);
  assert.equal(hash(packaged), hash(source), `${file} in app.asar is stale`);
}

const packagedPet = asar.extractFile(archive, 'pet.html').toString('utf8');
const packagedMain = asar.extractFile(archive, 'main.js').toString('utf8');
assert.match(packagedMain, /PET_WINDOW_WIDTH\s*=\s*280/, 'Packaged pet window width is stale');
assert.match(packagedMain, /PET_WINDOW_HEIGHT\s*=\s*340/, 'Packaged pet window height is stale');
assert.match(packagedPet, /width:\s*100vw;[\s\S]*height:\s*100vh;/, 'Pet surface contract is missing');
assert.match(packagedPet, /onpointercancel\s*=\s*finishDrag/, 'Pointer cancellation handling is missing');

console.log('Packaged application matches the reviewed source.');
