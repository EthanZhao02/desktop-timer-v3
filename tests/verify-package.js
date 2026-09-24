const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..');
const archive = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
const shippedFiles = [
  'main.js',
  'timer-core.js',
  'preload.js',
  'index.html',
  'styles.css',
  'renderer.js',
  'pet.html',
  'pet.css',
  'pet.js',
];

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
const packagedIndex = asar.extractFile(archive, 'index.html').toString('utf8');
const packagedPetCss = asar.extractFile(archive, 'pet.css').toString('utf8');
const packagedMain = asar.extractFile(archive, 'main.js').toString('utf8');
const packagedPackage = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(packagedPackage.version, sourcePackage.version, 'Packaged application version is stale');
assert.match(packagedMain, /PET_WINDOW_WIDTH\s*=\s*220/, 'Packaged pet window width is stale');
assert.match(packagedMain, /PET_WINDOW_HEIGHT\s*=\s*280/, 'Packaged pet window height is stale');
assert.match(packagedMain, /PET_PANEL_WIDTH\s*=\s*440/, 'Packaged pet panel width is stale');
assert.match(packagedMain, /PET_PANEL_HEIGHT\s*=\s*600/, 'Packaged pet panel height is stale');
assert.match(packagedMain, /process\.platform\s*!==\s*['"]win32['"]/, 'macOS platform guard is missing');
// 回归防线：set-window-pos 的 clamp 调用必须带 display.workArea，
// 否则 clampWindowPosition 内部访问 workArea.x 抛 TypeError，宠物永远拖不动。
assert.match(
  packagedMain,
  /clampWindowPosition\([\s\S]{0,400}?display\.workArea/,
  'set-window-pos clamp call is missing display.workArea (pet drag regression)',
);
assert.ok(sourcePackage.build && sourcePackage.build.mac, 'macOS build configuration is missing');
assert.match(packagedPetCss, /width:\s*100vw;[\s\S]*height:\s*100vh;/, 'Pet surface contract is missing');
assert.match(
  asar.extractFile(archive, 'pet.js').toString('utf8'),
  /addEventListener\(['"]pointercancel['"]/,
  'Pointer cancellation handling is missing',
);
assert.doesNotMatch(packagedIndex, /unsafe-inline/, 'Packaged index CSP still allows inline code');
assert.doesNotMatch(packagedPet, /unsafe-inline/, 'Packaged pet CSP still allows inline code');

// ---- 校验 asarUnpack 资源：窗口/托盘图标与 mediapipe 必须解到真实文件系统 ----
const unpackedRoot = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar.unpacked');
const requiredUnpacked = [
  'assets/icon.ico',
  'assets/icon.png',
  'assets/tray-icon.png',
  'assets/mediapipe/face_landmarker.task',
  'assets/mediapipe/vision_bundle.js',
];
for (const rel of requiredUnpacked) {
  assert.ok(
    fs.existsSync(path.join(unpackedRoot, rel)),
    `Unpacked resource missing: ${rel}（nativeImage / MediaPipe 无法从 asar 读取）`,
  );
}

// ---- 校验 files 排除规则：未引用的超大原图不应打入安装包 ----
const asarFiles = asar.listPackage(archive);
assert.ok(
  !asarFiles.some((f) => /zhiyu-character-source\.png$/.test(f)),
  'assets/zhiyu-character-source.png should be excluded from the package',
);

console.log('Packaged application matches the reviewed source.');
