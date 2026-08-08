import { SocksProxyAgent } from 'socks-proxy-agent';
import { socksUrlForPort, type AppConfig } from './config.js';
import type { Logger } from './logger.js';
import type { MetricsStore } from './metrics.js';
import type { IpChecker } from './net/ipCheck.js';
import type { SocksAgentPool } from './proxy/socksAgent.js';
import type { TorManager } from './tor/torManager.js';
import { sleep } from './util.js';

export interface RotatorDeps {
  cfg: AppConfig;
  tor: TorManager;
  pool: SocksAgentPool;
  metrics: MetricsStore;
  ip: IpChecker;
  logger: Logger;
}

const NEW_EXIT_IP_ATTEMPTS = 10;
const NEW_EXIT_IP_WAIT_MS = 3_000;

export class CircuitRotator {
  private timer: NodeJS.Timeout | null = null;
  private rotating = false;
  nextRotationAt: number | null = null;

  constructor(private readonly deps: RotatorDeps) {}

  start(): void {
    if (this.timer) return;
    const interval = this.deps.cfg.IP_ROTATE_INTERVAL_MS;
    this.deps.logger.info(`Tor exit-IP rotation every ${Math.round(interval / 1000)}s`);
    this.timer = setInterval(() => {
      void this.rotate();
    }, interval);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async rotate(): Promise<void> {
    if (this.rotating) return;
    this.rotating = true;
    try {
      const runtime = this.deps.tor.runtime;
      if (!runtime) throw new Error('Tor is not running');
      const probe = new SocksProxyAgent(socksUrlForPort(runtime.socksPort));
      try {
        const before = await this.deps.ip.getIp(probe);
        await this.deps.tor.signalNewNym();
        const after = await this.awaitNewExitIp(before, probe);
        this.deps.pool.swap();
        this.deps.metrics.rotations += 1;
        this.deps.metrics.lastExitIp = after ?? before;
        this.deps.metrics.lastRotationAt = Date.now();
        this.deps.metrics.lastIpCheckedAt = Date.now();
        this.nextRotationAt = Date.now() + this.deps.cfg.IP_ROTATE_INTERVAL_MS;
        this.deps.logger.info('Tor exit IP rotated (NEWNYM)', {
          before: before ?? 'unknown',
          after: after ?? 'unknown',
        });
        if (!after) this.deps.metrics.rotationFailures += 1;
      } finally {
        probe.destroy();
      }
    } catch (err) {
      this.deps.metrics.rotationFailures += 1;
      this.deps.logger.warn(`Exit-IP rotation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.rotating = false;
    }
  }

  private async awaitNewExitIp(before: string | null, probe: SocksProxyAgent): Promise<string | null> {
    for (let attempt = 0; attempt < NEW_EXIT_IP_ATTEMPTS; attempt += 1) {
      await sleep(NEW_EXIT_IP_WAIT_MS);
      const ip = await this.deps.ip.getIp(probe);
      if (ip && ip !== before) return ip;
    }
    return null;
  }
}
