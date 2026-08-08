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
// Short grace period after NEWNYM before a retried request goes out, giving Tor
// a moment to build a fresh circuit with a (likely) different exit IP.
const ON_DEMAND_GRACE_MS = 1_500;

export class CircuitRotator {
  private timer: NodeJS.Timeout | null = null;
  private rotating = false;
  private lastOnDemandAt = 0;
  nextRotationAt: number | null = null;

  constructor(private readonly deps: RotatorDeps) {}

  start(): void {
    if (this.timer) return;
    const interval = this.deps.cfg.IP_ROTATE_INTERVAL_MS;
    if (interval <= 0) {
      this.deps.logger.info(
        'Scheduled exit-IP rotation disabled — rotating on demand when the upstream model errors'
      );
      return;
    }
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

  /**
   * Rotate the exit IP on demand (triggered by an upstream model error).
   * Returns true when a rotation was actually performed; false when skipped
   * (cooldown, rotation in progress, or feature disabled).
   */
  async rotateOnDemand(): Promise<boolean> {
    if (!this.deps.cfg.ROTATE_ON_UPSTREAM_ERROR) return false;
    const cooldown = this.deps.cfg.ROTATE_ON_ERROR_COOLDOWN_MS;
    const elapsed = Date.now() - this.lastOnDemandAt;
    if (elapsed < cooldown) {
      this.deps.logger.debug(
        `On-demand rotation skipped — ${Math.max(0, cooldown - elapsed)}ms left in cooldown`
      );
      return false;
    }
    this.lastOnDemandAt = Date.now();
    return this.rotateFast();
  }

  private async rotateFast(): Promise<boolean> {
    if (this.rotating) {
      this.deps.logger.debug('On-demand rotation skipped — another rotation is in progress');
      return false;
    }
    this.rotating = true;
    try {
      const runtime = this.deps.tor.runtime;
      if (!runtime) throw new Error('Tor is not running');
      const before = this.deps.metrics.lastExitIp;
      await this.deps.tor.signalNewNym();
      await sleep(ON_DEMAND_GRACE_MS);
      this.deps.pool.swap();
      this.deps.metrics.rotations += 1;
      this.deps.metrics.lastRotationAt = Date.now();
      this.deps.logger.warn('Tor exit IP rotated on demand (upstream error)', {
        before: before ?? 'unknown',
      });
      void this.refreshExitIp();
      return true;
    } catch (err) {
      this.deps.metrics.rotationFailures += 1;
      this.deps.logger.warn(
        `On-demand rotation failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    } finally {
      this.rotating = false;
    }
  }

  private async refreshExitIp(): Promise<void> {
    try {
      const ip = await this.deps.ip.getIp(this.deps.pool.agent);
      this.deps.metrics.lastIpCheckedAt = Date.now();
      if (ip) {
        this.deps.metrics.lastExitIp = ip;
        this.deps.logger.info('Exit IP refreshed after on-demand rotation', { ip });
      }
    } catch (err) {
      this.deps.logger.debug('Exit IP refresh failed', {
        error: err instanceof Error ? err.message : String(err),
      });
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
