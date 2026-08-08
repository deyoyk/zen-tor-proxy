const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');

const rawOs = process.argv[2] ?? process.platform;
const arch = process.argv[3] ?? process.arch;
const nodeBin = path.resolve(process.argv[4] ?? process.execPath);

const os = { win32: 'windows', windows: 'windows', darwin: 'macos', macos: 'macos', linux: 'linux' }[rawOs];
if (!os) {
  console.error(`Unsupported OS: ${rawOs}`);
  process.exit(1);
}
if (arch !== 'x64' && arch !== 'arm64') {
  console.error(`Unsupported arch: ${arch}`);
  process.exit(1);
}

const ext = os === 'windows' ? '.exe' : '';
const outName = `zen-tor-proxy-${os}-${arch}${ext}`;
const outPath = path.join(distDir, outName);
const blobPath = path.join(distDir, 'sea-prep.blob');

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0) {
    console.error(`FAILED: ${cmd} ${args.join(' ')} (exit ${res.status})`);
    process.exit(1);
  }
}

function zeroCertificateTable(file) {
  const fd = fs.openSync(file, 'r+');
  const buf = Buffer.alloc(4096);
  fs.readSync(fd, buf, 0, 4096, 0);

  const peOffset = buf.readUInt32LE(0x3c);
  const sig = buf.toString('latin1', peOffset, peOffset + 4);
  if (sig !== 'PE\0\0') throw new Error('Not a PE file');

  const optOffset = peOffset + 4 + 20;
  const magic = buf.readUInt16LE(optOffset);
  if (magic !== 0x20b && magic !== 0x10b) throw new Error('Not PE32/PE32+');

  const certEntry = optOffset + 112 + 4 * 8;
  const certRva = buf.readUInt32LE(certEntry);
  const certSize = buf.readUInt32LE(certEntry + 4);

  if (certRva === 0 && certSize === 0) {
    console.log('No certificate table to strip');
    fs.closeSync(fd);
    return;
  }

  fs.writeSync(fd, Buffer.alloc(8), 0, 8, certEntry);
  fs.closeSync(fd);
  console.log(`Stripped certificate table (rva=${certRva}, size=${certSize})`);
}

fs.mkdirSync(distDir, { recursive: true });
console.log(`\nBuilding ${outName} (os=${os}, arch=${arch}, node=${nodeBin})`);

run(nodeBin, ['--experimental-sea-config', path.join(repoRoot, 'sea-config.json')], { cwd: repoRoot });

fs.copyFileSync(nodeBin, outPath);

if (os === 'windows') {
  zeroCertificateTable(outPath);
}
if (os !== 'windows') {
  fs.chmodSync(outPath, 0o755);
}

run(process.execPath, [
  require.resolve('postject/dist/cli.js'),
  outPath,
  'NODE_SEA_BLOB',
  blobPath,
  '--sentinel-fuse',
  SENTINEL,
]);

if (os === 'macos') {
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/codesign')) {
    run('/usr/bin/codesign', ['--sign', '-', outPath]);
  } else {
    console.log('WARNING: not on macOS — skipping codesign, binary will be unsigned');
  }
}

console.log(`Done: ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB)`);
