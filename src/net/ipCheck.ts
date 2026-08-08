import https from 'node:https';
import net from 'node:net';
import type { SocksProxyAgent } from 'socks-proxy-agent';
import type { Logger } from '../logger.js';

const USER_AGENT = 'zen-tor-proxy/1.0';

export class IpChecker {
  constructor(
    private readonly providers: string[],
    private readonly logger: Logger
  ) {}

  async getIp(agent: SocksProxyAgent, timeoutMs = 10_000): Promise<string | null> {
    for (const provider of this.providers) {
      try {
        const raw = await getText(provider, agent, timeoutMs);
        const ip = extractIp(raw);
        if (ip) return ip;
      } catch (err) {
        this.logger.debug(`IP check failed via ${provider}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return null;
  }
}

function getText(url: string, agent: SocksProxyAgent, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        agent,
        timeout: timeoutMs,
        headers: { 'User-Agent': USER_AGENT },
      },
      res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url);
          if (next.origin !== new URL(url).origin) {
            reject(new Error('Redirect to a different origin is not allowed'));
            return;
          }
          getText(next.toString(), agent, timeoutMs).then(resolve, reject);
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
      }
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

function extractIp(raw: string): string | null {
  let candidate: string | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      candidate = typeof obj.IP === 'string' ? obj.IP : typeof obj.ip === 'string' ? obj.ip : null;
    }
  } catch {
    candidate = raw.trim();
  }
  if (!candidate) return null;
  return net.isIP(candidate) > 0 ? candidate : null;
}
