import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { access, constants, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import * as path from 'node:path';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { sleep } from '../util.js';
import {
  controlCommand,
  getBootstrapProgress,
  signalNewNym as sendNewNym,
  type ControlOptions,
} from './control.js';
import { installTor } from './installer.js';

export interface TorRuntime {
  binaryPath: string;
  dataDir: string;
  socksPort: number;
  controlPort: number;
  pid: number;
  startedAt: number;
}

export interface TorStatus {
  running: boolean;
  binaryPath: string | null;
  socksPort: number | null;
  controlPort: number | null;
  startedAt: number | null;
  restarts: number;
}

export class TorManager {
  private child: ChildProcess | null = null;
  private current: TorRuntime | null = null;
  private controlPassword = '';
  private stopping = false;
  private restarts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private readonly events = new EventEmitter();
  private readonly torrcPath: string;

  constructor(
    private readonly cfg: AppConfig,
    private readonly logger: Logger
  ) {
    this.torrcPath = path.join(path.resolve(cfg.TOR_DATA_DIR), 'torrc');
  }

  get runtime(): TorRuntime | null {
    return this.current;
  }

  getStatus(): TorStatus {
    const running =
      this.current !== null &&
      this.child !== null &&
      this.child.exitCode === null &&
      !this.stopping;
    return {
      running,
      binaryPath: this.current?.binaryPath ?? null,
      socksPort: this.current?.socksPort ?? null,
      controlPort: this.current?.controlPort ?? null,
      startedAt: this.current?.startedAt ?? null,
      restarts: this.restarts,
    };
  }

  onRestart(listener: (runtime: TorRuntime) => void): void {
    this.events.on('restart', listener);
  }

  async start(): Promise<TorRuntime> {
    const dataDir = path.resolve(this.cfg.TOR_DATA_DIR);
    await mkdir(dataDir, { recursive: true });

    const binaryPath = await this.resolveBinary();
    const socksPort = await this.pickPort(this.cfg.TOR_SOCKS_PORT, 'SOCKS');
    const controlPort = await this.pickPort(this.cfg.TOR_CONTROL_PORT, 'control');
    const controlPassword = randomBytes(24).toString('base64url');
    const hashedPassword = await this.hashPassword(binaryPath, controlPassword);
    this.controlPassword = controlPassword;

    const torrc = [
      `SocksPort 127.0.0.1:${socksPort}`,
      `ControlPort 127.0.0.1:${controlPort}`,
      `HashedControlPassword ${hashedPassword}`,
      `DataDirectory "${dataDir.replace(/\\/g, '/')}"`,
      'ExitRelay 0',
      'BridgeRelay 0',
    ].join('\n');
    await writeFile(this.torrcPath, torrc, 'utf8');

    this.logger.info('Launching Tor', { binaryPath, socksPort, controlPort, dataDir });
    const child = spawn(binaryPath, ['-f', this.torrcPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => this.logger.debug(`[tor] ${String(chunk).trimEnd()}`));
    child.stderr?.on('data', chunk => this.logger.debug(`[tor] ${String(chunk).trimEnd()}`));
    child.on('error', err => {
      this.logger.error(`Failed to launch Tor: ${err.message}`);
    });
    child.on('exit', (code, signal) => {
      const wasStopping = this.stopping;
      this.child = null;
      this.current = null;
      if (!wasStopping) {
        this.logger.error(
          `Tor exited unexpectedly (code=${code ?? 'null'} signal=${signal ?? 'null'})`
        );
        this.scheduleRestart();
      }
    });

    await this.waitForControl(controlPort, controlPassword);
    await this.waitForBootstrap(controlPort, controlPassword);

    this.current = {
      binaryPath,
      dataDir,
      socksPort,
      controlPort,
      pid: child.pid ?? -1,
      startedAt: Date.now(),
    };
    this.logger.info(`Tor is ready (SOCKS ${socksPort}, control ${controlPort}, pid ${child.pid})`);
    return this.current;
  }

  async signalNewNym(): Promise<void> {
    const options = this.controlOptions;
    if (!options) throw new Error('Tor is not running');
    await sendNewNym(options);
    this.logger.debug('NEWNYM signal accepted');
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return;
    this.logger.info('Stopping Tor');
    child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>(resolve => {
        child.once('exit', () => resolve());
      }),
      sleep(5_000),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
    this.current = null;
  }

  private get controlOptions(): ControlOptions | null {
    const runtime = this.current;
    if (!runtime) return null;
    return { host: '127.0.0.1', port: runtime.controlPort, password: this.controlPassword };
  }

  private async resolveBinary(): Promise<string> {
    if (this.cfg.TOR_BINARY_PATH) {
      await assertBinary(this.cfg.TOR_BINARY_PATH);
      return this.cfg.TOR_BINARY_PATH;
    }
    const fromPath = findOnPath();
    if (fromPath) return fromPath;
    for (const candidate of knownLocations()) {
      if (await fileExists(candidate)) return candidate;
    }
    if (this.cfg.AUTO_INSTALL_TOR) {
      this.logger.info('Tor binary not found — installing Tor expert bundle automatically');
      return installTor(this.cfg, this.logger);
    }
    throw new Error(
      'Tor binary not found. Install Tor manually, set TOR_BINARY_PATH, or enable AUTO_INSTALL_TOR.'
    );
  }

  private async hashPassword(binaryPath: string, password: string): Promise<string> {
    const stdout = await execCapture(binaryPath, ['--hash-password', password]);
    const match = stdout.match(/^16:[0-9A-Fa-f]+$/m);
    if (!match) {
      throw new Error(
        `Could not generate Tor control password hash from output: ${stdout.trim().slice(0, 300)}`
      );
    }
    return match[0];
  }

  private async pickPort(configured: number, label: string): Promise<number> {
    if (configured > 0 && (await isPortFree(configured))) return configured;
    const port = await findFreePort();
    if (configured > 0) {
      this.logger.warn(`${label} port ${configured} is busy — using ${port} instead`);
    }
    return port;
  }

  private async waitForControl(controlPort: number, controlPassword: string): Promise<void> {
    const deadline = Date.now() + 30_000;
    let lastError = 'not started';
    while (Date.now() < deadline) {
      try {
        const options: ControlOptions = {
          host: '127.0.0.1',
          port: controlPort,
          password: controlPassword,
        };
        await controlCommand(options, 'GETINFO version');
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await sleep(300);
      }
    }
    throw new Error(`Tor control port ${controlPort} did not become ready: ${lastError}`);
  }

  private async waitForBootstrap(controlPort: number, controlPassword: string): Promise<void> {
    const deadline = Date.now() + this.cfg.TOR_BOOTSTRAP_TIMEOUT_MS;
    let lastProgress = -1;
    while (Date.now() < deadline) {
      try {
        const progress = await getBootstrapProgress({
          host: '127.0.0.1',
          port: controlPort,
          password: controlPassword,
        });
        if (progress >= 100) return;
        lastProgress = progress;
      } catch (err) {
        this.logger.debug(`Bootstrap probe failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(1_000);
    }
    throw new Error(
      `Tor bootstrap did not reach 100% within ${Math.round(this.cfg.TOR_BOOTSTRAP_TIMEOUT_MS / 1000)}s ` +
        `(last progress ${lastProgress}%)`
    );
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer) return;
    this.restarts += 1;
    const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(this.restarts, 5));
    this.logger.warn(`Restarting Tor in ${Math.round(delayMs / 1000)}s (attempt ${this.restarts})`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.restart();
    }, delayMs);
    this.restartTimer.unref?.();
  }

  private async restart(): Promise<void> {
    try {
      const runtime = await this.start();
      this.events.emit('restart', runtime);
    } catch (err) {
      this.logger.error(`Tor restart failed: ${err instanceof Error ? err.message : String(err)}`);
      this.scheduleRestart();
    }
  }
}

function findOnPath(): string | null {
  const binary = process.platform === 'win32' ? 'tor.exe' : 'tor';
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, [binary], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const first = result.stdout.split(/\r?\n/)[0]?.trim();
  return first || null;
}

function knownLocations(): string[] {
  const locations: string[] = [];
  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    const localAppData = process.env.LOCALAPPDATA ?? '';
    locations.push(
      path.join(programFiles, 'Tor Browser', 'Browser', 'TorBrowser', 'Tor', 'tor.exe')
    );
    if (localAppData) {
      locations.push(
        path.join(localAppData, 'Tor Browser', 'Browser', 'TorBrowser', 'Tor', 'tor.exe')
      );
    }
  } else if (process.platform === 'darwin') {
    locations.push('/Applications/Tor Browser.app/Contents/Resources/TorBrowser/Tor/tor');
  } else {
    locations.push('/usr/bin/tor', '/usr/local/bin/tor');
  }
  return locations;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertBinary(file: string): Promise<void> {
  if (!(await fileExists(file))) {
    throw new Error(`TOR_BINARY_PATH does not exist or is not readable: ${file}`);
  }
}

function execCapture(exe: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Command timed out: ${exe} ${args.join(' ')}`));
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Command failed (exit ${code ?? '?'}): ${stderr.trim().slice(0, 500)}`));
    });
  });
}

export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a free port'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
