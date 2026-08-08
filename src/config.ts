import path from 'node:path';
import { z } from 'zod';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function isPackaged(): boolean {
  if (typeof process === 'undefined') return false;
  if ((process as { pkg?: unknown }).pkg != null) return true;
  try {
    return (require('node:sea') as { isSea: () => boolean }).isSea();
  } catch {
    return false;
  }
}

export function defaultTorDataDir(): string {
  if (isPackaged()) {
    return path.join(path.dirname(process.execPath), 'data', 'tor');
  }
  return './data/tor';
}

const EnvSchema = z.object({
  ZEN_API_KEY: z.string().min(1).optional().default('public'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5678),
  HOST: z.string().min(1).default('127.0.0.1'),
  UPSTREAM_URL: z
    .string()
    .url()
    .default('https://opencode.ai/zen/v1/chat/completions'),
  LOCAL_AUTH_TOKEN: z.string().min(1).optional(),
  AUTO_INSTALL_TOR: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true'),
  TOR_BINARY_PATH: z.string().min(1).optional(),
  TOR_SOCKS_PORT: z.coerce.number().int().min(0).max(65535).default(9050),
  TOR_CONTROL_PORT: z.coerce.number().int().min(0).max(65535).default(9051),
  TOR_DATA_DIR: z.string().min(1).default(defaultTorDataDir()),
  TOR_BRIDGES: z.string().min(1).optional(),
  TOR_BOOTSTRAP_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  // Scheduled exit-IP rotation interval. 0 disables the timer; the proxy then
  // rotates on demand whenever the upstream model returns an error.
  IP_ROTATE_INTERVAL_MS: z.coerce.number().int().nonnegative().default(0),
  // Master switch for on-demand rotation triggered by upstream model errors.
  ROTATE_ON_UPSTREAM_ERROR: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true'),
  // When true, rotate on ANY 4xx/5xx response. When false, rotate only on
  // quota-style errors (402/429 or bodies mentioning usage limits).
  ROTATE_ON_ANY_UPSTREAM_ERROR: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true'),
  // Automatically resend the failed request once over the new exit IP.
  ROTATE_RETRY_REQUESTS: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true'),
  // Minimum gap between on-demand rotations (avoids hammering NEWNYM when
  // many requests fail at the same time).
  ROTATE_ON_ERROR_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(20_000),
  IP_CHECK_PROVIDERS: z
    .string()
    .default(
      'https://check.torproject.org/api/ip,https://api.ipify.org?format=json,https://ipinfo.io/ip'
    )
    .transform(value =>
      value
        .split(',')
        .map(provider => provider.trim())
        .filter(Boolean)
    ),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FILE: z.string().min(1).optional(),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    normalized[key] = value && value.length > 0 ? value : undefined;
  }
  const result = EnvSchema.safeParse(normalized);
  if (!result.success) {
    const detail = result.error.issues
      .map(issue => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${detail}`);
  }
  return result.data;
}

export function socksUrlForPort(port: number): string {
  return `socks5h://127.0.0.1:${port}`;
}
