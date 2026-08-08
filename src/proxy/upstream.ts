import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { MetricsStore } from '../metrics.js';
import { writeJSON } from '../httpUtil.js';
import type { SocksAgentPool } from './socksAgent.js';

const SKIP_RESPONSE_HEADERS =
  /^(host|connection|transfer-encoding|keep-alive|upgrade|content-length|content-type|access-control-allow-origin|access-control-allow-headers|access-control-allow-methods|access-control-max-age)$/i;

export interface ForwardRequestArgs {
  cfg: AppConfig;
  pool: SocksAgentPool;
  metrics: MetricsStore;
  logger: Logger;
  req: IncomingMessage;
  res: ServerResponse;
  bodyJson: string;
  isStream: boolean;
  method?: 'GET' | 'POST';
}

export function modelsUrlFor(upstream: string): string {
  const url = new URL(upstream);
  const marker = '/chat/completions';
  if (url.pathname.endsWith(marker)) {
    url.pathname = url.pathname.slice(0, -marker.length) + '/models';
  } else {
    url.pathname = url.pathname.replace(/\/+$/, '') + '/models';
  }
  return url.toString();
}

export function forwardToUpstream(args: ForwardRequestArgs): void {
  const { cfg, pool, metrics, logger, res } = args;
  const method = args.method ?? 'POST';
  const url = new URL(method === 'GET' ? modelsUrlFor(cfg.UPSTREAM_URL) : cfg.UPSTREAM_URL);
  const bodyBytes = Buffer.byteLength(args.bodyJson);

  const headers: Record<string, string> = {
    Accept: args.req.headers['accept'] ?? 'application/json',
    'User-Agent': 'zen-tor-proxy/1.0',
    'X-Zen-Proxy': 'true',
  };
  if (method === 'POST') {
    headers['Content-Type'] = args.req.headers['content-type'] ?? 'application/json';
    headers['Content-Length'] = String(bodyBytes);
  }
  const clientAuth = args.req.headers.authorization;
  const auth = clientAuth ?? (cfg.ZEN_API_KEY ? `Bearer ${cfg.ZEN_API_KEY}` : undefined);
  if (auth) headers.Authorization = auth;

  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    metrics.requestFinished();
    pool.markEnd();
  };

  metrics.requestStarted(args.isStream);
  pool.markStart();

  const proxyReq = https.request(
    {
      hostname: url.hostname,
      port: url.port || '443',
      path: url.pathname + url.search,
      method,
      headers,
      agent: pool.agent,
    },
    proxyRes => {
      const status = proxyRes.statusCode ?? 502;
      const responseHeaders: Record<string, string> = {
        'content-type': proxyRes.headers['content-type'] ?? 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'Content-Type, Authorization',
        'x-zen-proxy': 'true',
      };
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (SKIP_RESPONSE_HEADERS.test(key) || value === undefined) continue;
        responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
      }
      if (status >= 400) {
        metrics.errorsTotal += 1;
        metrics.upstreamErrors += 1;
      }
      res.writeHead(status, responseHeaders);

      let bytesDown = 0;
      const onClientClose = (): void => {
        if (!settled) proxyReq.destroy();
      };
      res.on('close', onClientClose);

      const finish = (): void => {
        metrics.bytesDown += bytesDown;
        settle();
        res.removeListener('close', onClientClose);
      };

      if (args.isStream) {
        proxyRes.on('data', chunk => {
          bytesDown += chunk.length;
        });
        proxyRes.on('error', err => {
          logger.warn(`Upstream stream error: ${err.message}`);
          if (!res.writableEnded) res.destroy();
        });
        proxyRes.pipe(res);
        proxyRes.on('end', () => {
          logger.debug(`Stream finished · ${status} · ${bytesDown} bytes`);
          finish();
        });
      } else {
        let data = '';
        proxyRes.on('data', chunk => {
          data += chunk;
          bytesDown += chunk.length;
        });
        proxyRes.on('end', () => {
          logUpstreamResult(args, status, data);
          res.end(data);
          finish();
        });
      }
    }
  );

  let timedOut = false;
  proxyReq.setTimeout(cfg.UPSTREAM_TIMEOUT_MS, () => {
    timedOut = true;
    proxyReq.destroy(new Error(`Upstream timeout after ${cfg.UPSTREAM_TIMEOUT_MS}ms`));
  });
  proxyReq.on('error', err => {
    if (settled) return;
    metrics.errorsTotal += 1;
    metrics.upstreamErrors += 1;
    settle();
    logger.warn(`Upstream request failed: ${err.message}`);
    if (!res.headersSent) {
      writeJSON(res, timedOut ? 504 : 502, {
        error: { message: timedOut ? 'Upstream timeout' : `Proxy error: ${err.message}` },
      });
    } else if (!res.writableEnded) {
      res.destroy();
    }
  });

  metrics.bytesUp += bodyBytes;
  if (method === 'POST') proxyReq.write(args.bodyJson);
  proxyReq.end();
}

function logUpstreamResult(args: ForwardRequestArgs, status: number, data: string): void {
  if (status === 402 || status === 403 || status === 429) {
    const match = data.match(/retrying in (\d+)h (\d+)m/);
    if (match) {
      const minutes = parseInt(match[1] ?? '0', 10) * 60 + parseInt(match[2] ?? '0', 10);
      const retryAt = new Date(Date.now() + minutes * 60_000);
      args.logger.warn(`Upstream quota exhausted · retry at ~${retryAt.toISOString()}`);
      return;
    }
  }
  if (status >= 400) {
    args.logger.warn(`Upstream returned ${status} · ${data.length} bytes`);
  } else {
    args.logger.info(`Upstream ${status} · ${data.length} bytes`);
  }
}
