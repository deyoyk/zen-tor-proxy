import 'dotenv/config';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { isPackaged, loadConfig, socksUrlForPort } from './config.js';
import { logger } from './logger.js';
import { MetricsStore } from './metrics.js';
import { IpChecker } from './net/ipCheck.js';
import { createProxyServer } from './proxy/server.js';
import type { UpstreamErrorInfo } from './proxy/upstream.js';
import { SocksAgentPool } from './proxy/socksAgent.js';
import { CircuitRotator } from './rotator.js';
import { TorManager } from './tor/torManager.js';

loadDotenv({
  path: path.join(isPackaged() ? path.dirname(process.execPath) : process.cwd(), '.env'),
});

const VERSION = '1.0.1';

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  logger.setLevel(cfg.LOG_LEVEL);

  const logFile =
    cfg.LOG_FILE ??
    path.join(isPackaged() ? path.dirname(process.execPath) : process.cwd(), 'zen-tor-proxy.log');
  logger.attachFile(logFile);
  logger.info(`Log file: ${logFile}`);

  if (cfg.HOST !== '127.0.0.1' && !cfg.LOCAL_AUTH_TOKEN) {
    logger.warn(
      'Proxy listens on a non-loopback address without LOCAL_AUTH_TOKEN — unauthenticated access'
    );
  }

  logger.info(`zen-tor-proxy v${VERSION} · node ${process.version} · ${process.platform}/${process.arch}`);

  const tor = new TorManager(cfg, logger);
  const runtime = await tor.start();

  const pool = new SocksAgentPool(socksUrlForPort(runtime.socksPort));
  const metrics = new MetricsStore();
  const ip = new IpChecker(cfg.IP_CHECK_PROVIDERS, logger);
  const rotator = new CircuitRotator({ cfg, tor, pool, metrics, ip, logger });

  tor.onRestart(() => {
    logger.warn('Tor restarted — swapping agent pool and rotating circuit');
    pool.swap();
    void rotator.rotate();
  });

  const bootIp = await ip.getIp(pool.agent);
  if (bootIp) {
    metrics.lastExitIp = bootIp;
    metrics.lastIpCheckedAt = Date.now();
    logger.info(`Tor exit IP: ${bootIp}`);
  } else {
    logger.warn('Could not determine the Tor exit IP at startup');
  }

  rotator.start();

  const onUpstreamError = async (info: UpstreamErrorInfo): Promise<boolean> => {
    if (!cfg.ROTATE_ON_UPSTREAM_ERROR) return false;
    const rotated = await rotator.rotateOnDemand();
    logger.debug(`Upstream error (${info.kind}${info.status !== null ? ` ${info.status}` : ''}) → on-demand rotation: ${rotated ? 'ok' : 'skipped'}`);
    return rotated;
  };

  const server = createProxyServer({
    cfg,
    pool,
    metrics,
    logger,
    onUpstreamError,
    health: () => {
      const torStatus = tor.getStatus();
      return {
        status: torStatus.running && metrics.lastExitIp !== null ? 'ok' : 'degraded',
        uptimeSec: metrics.uptimeSec,
        upstream: cfg.UPSTREAM_URL,
        tor: torStatus,
        exitIp: metrics.lastExitIp,
        lastIpCheckedAt: metrics.lastIpCheckedAt,
        nextRotationAt: rotator.nextRotationAt,
        rotateIntervalMs: cfg.IP_ROTATE_INTERVAL_MS,
        requests: metrics.requestsTotal,
        active: metrics.activeRequests,
        errors: metrics.errorsTotal,
        rotations: metrics.rotations,
        rotationFailures: metrics.rotationFailures,
        bytesUp: metrics.bytesUp,
        bytesDown: metrics.bytesDown,
      };
    },
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${cfg.PORT} is already in use — is another instance already running?`);
    } else {
      logger.error(`Server error: ${err.message}`);
    }
    process.exit(1);
  });
  server.listen(cfg.PORT, cfg.HOST, () => {
    logger.info(`Proxy listening on http://${cfg.HOST}:${cfg.PORT}`);
    logger.info(`OpenAI-compatible endpoint → http://${cfg.HOST}:${cfg.PORT}/v1/chat/completions`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal} — shutting down`);
    rotator.stop();
    const forceExit = setTimeout(() => process.exit(1), 8_000);
    forceExit.unref?.();
    server.close(() => {
      void (async () => {
        try {
          await tor.stop();
        } catch (err) {
          logger.warn(`Error while stopping Tor: ${err instanceof Error ? err.message : String(err)}`);
        }
        pool.destroy();
        logger.info('Shutdown complete');
        process.exit(0);
      })();
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', err => {
    logger.error(`Uncaught exception: ${err.stack ?? err.message}`);
  });
  process.on('unhandledRejection', reason => {
    logger.error(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  });
}

main().catch(err => {
  logger.error(`Fatal startup error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
