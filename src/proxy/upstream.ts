import https from 'node:https';
import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { MetricsStore } from '../metrics.js';
import { writeJSON } from '../httpUtil.js';
import { sleep } from '../util.js';
import type { SocksAgentPool } from './socksAgent.js';

const SKIP_RESPONSE_HEADERS =
  /^(host|connection|transfer-encoding|keep-alive|upgrade|content-length|content-type|access-control-allow-origin|access-control-allow-headers|access-control-allow-methods|access-control-max-age)$/i;

export interface UpstreamErrorInfo {
  /** HTTP status of the error response, or null for connection-level failures. */
  status: number | null;
  /** Response body (may be empty for streams and network failures). */
  body: string;
  kind: 'http' | 'network';
}

export interface UpstreamRetryInfo {
  /** Whether the Tor exit IP was rotated for this attempt. */
  rotated: boolean;
  /** How long to wait before re-sending the request. */
  delayMs: number;
}

const QUOTA_ERROR_PATTERN =
  /free usage|usage limit|usage exceeded|quota|rate ?limit|too many requests|limit reached|exceeded|billing|credits|insufficient|subscription/i;

export function isQuotaError(status: number | null, body: string): boolean {
  if (status === 402 || status === 429) return true;
  return body.length > 0 && QUOTA_ERROR_PATTERN.test(body);
}

export function shouldRotateOnError(cfg: AppConfig, info: UpstreamErrorInfo): boolean {
  if (!cfg.ROTATE_ON_UPSTREAM_ERROR) return false;
  if (info.kind === 'network') return true;
  if (info.status === null) return false;
  if (isQuotaError(info.status, info.body)) return true;
  return cfg.ROTATE_ON_ANY_UPSTREAM_ERROR && info.status >= 400;
}

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
  model?: string | null;
  /** Invoked when the upstream errors; resolves when the exit IP was (possibly) rotated. */
  onUpstreamError?: (info: UpstreamErrorInfo) => Promise<UpstreamRetryInfo>;
  /** Internal — number of times this request has already been re-sent. */
  retryCount?: number;
  /** Internal — wall-clock deadline (epoch ms) after which retries stop. */
  retryDeadline?: number;
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
  const retryCount = args.retryCount ?? 0;
  const retryDeadline = args.retryDeadline ?? Date.now();
  const method = args.method ?? 'POST';
  const url = new URL(method === 'GET' ? modelsUrlFor(cfg.UPSTREAM_URL) : cfg.UPSTREAM_URL);
  const bodyBytes = Buffer.byteLength(args.bodyJson);
  const startedAt = Date.now();

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
  let retrying = false;
  let finalStatus: number | null = null;
  let finalBytesDown = 0;
  let finalError: string | undefined;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    metrics.requestFinished({
      status: finalStatus,
      bytesUp: bodyBytes,
      bytesDown: finalBytesDown,
      durationMs: Date.now() - startedAt,
      model: args.model ?? null,
      stream: args.isStream,
      retried: retryCount > 0,
      errorMsg: finalError,
    });
    pool.markEnd();
  };

  const complete = (bytesDown: number): void => {
    finalBytesDown = bytesDown;
    metrics.bytesDown += bytesDown;
    settle();
    releaseClientListener();
  };

  // A retried request reuses the same logical request — count metrics only once.
  if (retryCount === 0) {
    metrics.requestStarted(args.isStream);
    pool.markStart();
    metrics.bytesUp += bodyBytes;
  }

  let proxyReq: ClientRequest | null = null;
  const onClientClose = (): void => {
    if (!settled && !retrying && proxyReq) proxyReq.destroy();
  };
  res.on('close', onClientClose);
  const releaseClientListener = (): void => {
    res.removeListener('close', onClientClose);
  };

  /**
   * Rotate the exit IP and re-send the same request, up to ROTATE_MAX_RETRIES.
   * Returns true when the request was handed off to a new attempt.
   */
  const attemptRetry = async (
    kind: 'http' | 'network',
    status: number | null,
    body: string
  ): Promise<boolean> => {
    const windowMs = cfg.ROTATE_RETRY_WINDOW_MS;
    if (
      retrying ||
      !cfg.ROTATE_RETRY_REQUESTS ||
      retryCount >= cfg.ROTATE_MAX_RETRIES ||
      (windowMs > 0 && Date.now() - retryDeadline > windowMs) ||
      !args.onUpstreamError ||
      !shouldRotateOnError(cfg, { status, body, kind })
    ) {
      return false;
    }
    retrying = true;
    const retry = await args.onUpstreamError({ status, body, kind }).catch(() => null);
    retrying = false;
    if (!retry || res.destroyed) return false;
    metrics.retries += 1;
    releaseClientListener();
    await sleep(retry.delayMs);
    forwardToUpstream({ ...args, retryCount: retryCount + 1, retryDeadline });
    return true;
  };

  proxyReq = https.request(
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
      finalStatus = status;
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

      // Error responses are collected fully so we can retry or give up.
      if (status >= 400) {
        let data = '';
        let bytesDown = 0;
        proxyRes.on('data', chunk => {
          data += chunk;
          bytesDown += chunk.length;
        });
        proxyRes.on('error', err => {
          logger.warn(`Upstream response error: ${err.message}`);
          complete(bytesDown);
          if (!res.writableEnded) res.destroy();
        });
        proxyRes.on('end', () => {
          logUpstreamResult(args, status, data);
          void (async () => {
            if (await attemptRetry('http', status, data)) return;
            if (res.destroyed) {
              complete(bytesDown);
              return;
            }
            writeJSON(res, 500, { error: { message: 'internal error' } });
            complete(bytesDown);
          })();
        });
        return;
      }

      if (args.isStream) {
        res.writeHead(status, responseHeaders);
        let bytesDown = 0;

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
          complete(bytesDown);
        });
        return;
      }

      let data = '';
      let bytesDown = 0;
      proxyRes.on('data', chunk => {
        data += chunk;
        bytesDown += chunk.length;
      });
      proxyRes.on('error', err => {
        logger.warn(`Upstream response error: ${err.message}`);
        complete(bytesDown);
        if (!res.writableEnded) res.destroy();
      });
      proxyRes.on('end', () => {
        logUpstreamResult(args, status, data);
        res.writeHead(status, responseHeaders);
        res.end(data);
        complete(bytesDown);
      });
    }
  );

  let timedOut = false;
  proxyReq.setTimeout(cfg.UPSTREAM_TIMEOUT_MS, () => {
    timedOut = true;
    proxyReq?.destroy(new Error(`Upstream timeout after ${cfg.UPSTREAM_TIMEOUT_MS}ms`));
  });
  proxyReq.on('error', err => {
    if (settled || retrying) return;
    metrics.errorsTotal += 1;
    metrics.upstreamErrors += 1;
    finalStatus = timedOut ? 504 : null;
    finalError = err.message;
    logger.warn(`Upstream request failed: ${err.message}`);
    void (async () => {
      if (await attemptRetry('network', timedOut ? 504 : null, '')) return;
      settle();
      if (!res.headersSent && !res.destroyed) {
        writeJSON(res, 500, { error: { message: 'internal error' } });
      } else if (!res.writableEnded) {
        res.destroy();
      }
    })();
  });

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
