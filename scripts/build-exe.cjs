const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const exePath = path.resolve(__dirname, '..', 'dist', 'zen-tor-proxy.exe');
const blobPath = path.resolve(__dirname, '..', 'dist', 'sea-prep.blob');

function zeroCertificateTable(file) {
  const fd = fs.openSync(file, 'r+');
  const buf = Buffer.alloc(4096);
  fs.readSync(fd, buf, 0, 4096, 0);

  const peOffset = buf.readUInt32LE(0x3c);
  const sig = buf.toString('latin1', peOffset, peOffset + 4);
  if (sig !== 'PE\0\0') throw new Error('Not a PE file');

  const coff = peOffset + 4;
  const optOffset = coff + 20;
  const magic = buf.readUInt16LE(optOffset);
  if (magic !== 0x20b && magic !== 0x10b) throw new Error('Not PE32/PE32+');

  const dataDirs = optOffset + 112;
  const certEntry = dataDirs + 4 * 8;
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

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`FAILED: ${cmd} ${args.join(' ')} (exit ${res.status})`);
    process.exit(1);
  }
}

fs.copyFileSync(process.execPath, exePath);
console.log('Copied node.exe -> zen-tor-proxy.exe');

zeroCertificateTable(exePath);

const postject = require.resolve('postject/dist/cli.js');
run(process.execPath, [postject, exePath, 'NODE_SEA_BLOB', blobPath, '--sentinel-fuse', SENTINEL]);

console.log('Done: dist/zen-tor-proxy.exe');
