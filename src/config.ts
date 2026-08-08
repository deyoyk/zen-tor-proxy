import path from 'node:path';
import { z } from 'zod';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function isPackaged(): boolean {
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
  TOR_BOOTSTRAP_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  IP_ROTATE_INTERVAL_MS: z.coerce.number().int().positive().default(600_000),
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
