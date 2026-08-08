import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, constants, mkdir, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import * as path from 'node:path';
import https from 'node:https';
import * as tar from 'tar';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';

const USER_AGENT = 'zen-tor-proxy/1.0';

export interface PlatformTarget {
  name: string;
  dir: string;
  exe: string;
}

export function platformTarget(platform: NodeJS.Platform, arch: string): PlatformTarget | null {
  if (platform === 'win32') return { name: 'windows-x86_64', dir: 'tor', exe: 'tor.exe' };
  if (platform === 'linux' && arch === 'x64') return { name: 'linux-x86_64', dir: 'tor', exe: 'tor' };
  if (platform === 'linux' && arch === 'arm64')
    return { name: 'linux-aarch64', dir: 'tor', exe: 'tor' };
  if (platform === 'darwin' && arch === 'x64')
    return { name: 'macos-x86_64', dir: 'tor', exe: 'tor' };
  if (platform === 'darwin' && arch === 'arm64')
    return { name: 'macos-aarch64', dir: 'tor', exe: 'tor' };
  return null;
}

interface BundleInfo {
  url: string;
  version: string;
  sha256?: string;
}

export async function installTor(cfg: AppConfig, logger: Logger): Promise<string> {
  const target = platformTarget(process.platform, process.arch);
  if (!target) {
    throw new Error(
      `Automatic Tor installation is not supported on ${process.platform}/${process.arch}. ` +
        'Install Tor manually and set TOR_BINARY_PATH.'
    );
  }

  const baseDir = path.resolve(cfg.TOR_DATA_DIR, 'dist');
  const info = await getLatestBundle(target, logger);
  const versionDir = path.join(baseDir, info.version);
  const binPath = path.join(versionDir, target.dir, target.exe);

  if (await fileExists(binPath)) {
    logger.info(`Using cached Tor ${info.version} at ${binPath}`);
    return binPath;
  }

  const tmpDir = path.join(versionDir, `.tmp-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });
  const tarball = path.join(tmpDir, 'bundle.tar.gz');

  logger.info(`Downloading Tor expert bundle ${info.version}`, { url: info.url });
  await downloadFile(info.url, tarball, info.sha256);

  logger.info('Extracting Tor expert bundle');
  await tar.x({ file: tarball, cwd: tmpDir, preservePaths: false });

  const extractedBin = path.join(tmpDir, target.dir, target.exe);
  if (!(await fileExists(extractedBin))) {
    throw new Error('Tor bundle extracted but the binary was not found inside');
  }

  await mkdir(versionDir, { recursive: true });
  await rm(path.join(versionDir, target.dir), { recursive: true, force: true });
  await rename(path.join(tmpDir, target.dir), path.join(versionDir, target.dir));
  await rm(tmpDir, { recursive: true, force: true });

  if (process.platform !== 'win32') {
    await chmod(binPath, 0o755);
  }

  logger.info(`Tor installed at ${binPath}`);
  return binPath;
}

async function getLatestBundle(target: PlatformTarget, logger: Logger): Promise<BundleInfo> {
  try {
    const info = await latestFromDownloadsJson(target);
    if (info) return info;
  } catch (err) {
    logger.warn(`Could not read Tor update manifest: ${err instanceof Error ? err.message : String(err)}`);
  }
  const fallback = await latestFromDistIndex(target);
  if (fallback) return fallback;
  throw new Error(
    'Could not locate a Tor expert bundle download. Install Tor manually and set TOR_BINARY_PATH.'
  );
}

async function latestFromDownloadsJson(target: PlatformTarget): Promise<BundleInfo | null> {
  const json = await httpGetText(
    'https://aus1.torproject.org/torbrowser/update_3/release/downloads.json'
  );
  const data = JSON.parse(json) as Record<string, unknown>;
  const versions = data.versions;
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) return null;

  const versionKeys = Object.keys(versions).sort((a, b) => compareVersions(b, a));
  for (const version of versionKeys) {
    const platforms = (versions as Record<string, unknown>)[version];
    if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) continue;
    for (const entry of Object.values(platforms as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const obj = entry as Record<string, unknown>;
      const candidates = [obj.url, ...(Array.isArray(obj.urls) ? obj.urls : [])].filter(
        (candidate): candidate is string => typeof candidate === 'string'
      );
      for (const url of candidates) {
        if (
          url.includes('expert-bundle') &&
          url.includes(target.name) &&
          url.endsWith('.tar.gz')
        ) {
          return { url, version, sha256: parseSha256(obj.digest) };
        }
      }
    }
  }
  return null;
}

async function latestFromDistIndex(target: PlatformTarget): Promise<BundleInfo | null> {
  const html = await httpGetText('https://dist.torproject.org/torbrowser/');
  const versions = Array.from(html.matchAll(/href="([^"]+)\/"/g))
    .map(match => match[1] ?? '')
    .filter(version => /^\d+\.\d+\.\d+/.test(version));
  versions.sort((a, b) => compareVersions(b, a));
  const version = versions[0];
  if (!version) return null;
  const url = `https://dist.torproject.org/torbrowser/${version}/tor-expert-bundle-${target.name}-${version}.tar.gz`;
  try {
    await httpHead(url);
  } catch {
    return null;
  }
  return { url, version };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function parseSha256(digest: unknown): string | undefined {
  if (typeof digest !== 'string') return undefined;
  const match = digest.match(/^sha256:([0-9a-fA-F]{64})$/);
  return match?.[1];
}

function httpGetText(url: string, redirectsLeft = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': USER_AGENT } }, res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          httpGetText(new URL(res.headers.location, url).toString(), redirectsLeft - 1).then(
            resolve,
            reject
          );
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode ?? '?'} from ${url}`));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

function httpHead(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } }, res => {
      res.resume();
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) resolve();
      else reject(new Error(`HEAD returned ${res.statusCode ?? '?'}`));
    });
    req.on('error', reject);
    req.end();
  });
}

function downloadFile(url: string, dest: string, expectedSha256?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const out = createWriteStream(dest);
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      out.destroy();
      void rm(dest, { force: true }).catch(() => undefined);
      reject(error);
    };

    https
      .get(url, { headers: { 'User-Agent': USER_AGENT } }, res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fail(new Error(`Unexpected redirect in download: ${res.headers.location}`));
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume();
          fail(new Error(`Download failed: HTTP ${res.statusCode ?? '?'} from ${url}`));
          return;
        }
        res.on('data', chunk => hash.update(chunk));
        res.pipe(out);
      })
      .on('error', fail);

    out.on('error', fail);
    out.on('finish', () => {
      if (settled) return;
      const actual = hash.digest('hex');
      if (expectedSha256 && actual !== expectedSha256.toLowerCase()) {
        fail(new Error(`SHA256 mismatch for ${dest}`));
        return;
      }
      settled = true;
      resolve();
    });
  });
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
