import http from 'node:http';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { MetricsStore } from '../metrics.js';
import { readBody, writeJSON } from '../httpUtil.js';
import type { SocksAgentPool } from './socksAgent.js';
import { forwardToUpstream, type UpstreamErrorInfo } from './upstream.js';

export interface HealthPayload {
  status: string;
  uptimeSec: number;
  upstream: string;
  tor: {
    running: boolean;
    binaryPath: string | null;
    socksPort: number | null;
    controlPort: number | null;
    startedAt: number | null;
    restarts: number;
  };
  exitIp: string | null;
  lastIpCheckedAt: number | null;
  nextRotationAt: number | null;
  rotateIntervalMs: number;
  requests: number;
  active: number;
  errors: number;
  rotations: number;
  rotationFailures: number;
  bytesUp: number;
  bytesDown: number;
}

export interface ProxyServerDeps {
  cfg: AppConfig;
  pool: SocksAgentPool;
  metrics: MetricsStore;
  logger: Logger;
  health: () => HealthPayload;
  onUpstreamError?: (info: UpstreamErrorInfo) => Promise<boolean>;
}

export function createProxyServer(deps: ProxyServerDeps): http.Server {
  const { cfg, metrics, logger } = deps;

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(err => {
      logger.error(
        `Request handler failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`
      );
      if (!res.headersSent) writeJSON(res, 500, { error: { message: 'Internal proxy error' } });
      else res.destroy();
    });
  });
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.on('clientError', (err, socket) => {
    logger.debug(`clientError: ${err.message}`);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && url === '/health') {
      writeJSON(res, 200, deps.health());
      return;
    }

    if (req.method === 'GET' && url === '/stats') {
      writeJSON(res, 200, metrics.snapshot());
      return;
    }

    if (url !== '/v1/chat/completions' && url !== '/v1/models') {
      writeJSON(res, 404, { error: { message: `Not found: ${req.method} ${url}` } });
      return;
    }

    if (cfg.LOCAL_AUTH_TOKEN && req.headers.authorization !== `Bearer ${cfg.LOCAL_AUTH_TOKEN}`) {
      writeJSON(res, 401, { error: { message: 'Unauthorized' } });
      return;
    }

    if (url === '/v1/models') {
      if (req.method !== 'GET') {
        writeJSON(res, 404, { error: { message: `Not found: ${req.method} ${url}` } });
        return;
      }
      logger.info('→ GET /v1/models');
      forwardToUpstream({
        cfg,
        pool: deps.pool,
        metrics,
        logger,
        req,
        res,
        bodyJson: '',
        isStream: false,
        method: 'GET',
        onUpstreamError: deps.onUpstreamError,
      });
      return;
    }

    if (req.method !== 'POST') {
      writeJSON(res, 404, { error: { message: `Not found: ${req.method} ${url}` } });
      return;
    }

    const body = await readBody(req);
    if (!body.ok) {
      writeJSON(res, body.status, { error: { message: body.message } });
      return;
    }

    const parsed = body.json as { model?: string; messages?: unknown[]; stream?: boolean };
    const isStream = parsed?.stream === true;
    logger.info(
      `→ ${parsed?.model ?? 'unknown'} · ${parsed?.messages?.length ?? 0} messages` +
        `${isStream ? ' · stream' : ''}`
    );

    forwardToUpstream({
      cfg,
      pool: deps.pool,
      metrics,
      logger,
      req,
      res,
      bodyJson: JSON.stringify(parsed),
      isStream,
      onUpstreamError: deps.onUpstreamError,
    });
  }

  return server;
}
