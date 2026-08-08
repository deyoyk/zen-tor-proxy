import { appendFileSync } from 'node:fs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  private level: LogLevel = 'info';
  private filePath: string | null = null;

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  attachFile(filePath: string): void {
    try {
      appendFileSync(filePath, '', { flag: 'a' });
      this.filePath = filePath;
    } catch {
      this.filePath = null;
    }
  }

  get file(): string | null {
    return this.filePath;
  }

  debug(message: string, meta?: unknown): void {
    this.write('debug', message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.write('error', message, meta);
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const timestamp = new Date().toISOString().slice(11, 23);
    const suffix = meta === undefined ? '' : ` ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`;
    const line = `[${timestamp}] [${level.toUpperCase()}] [zen-tor-proxy] ${message}${suffix}`;
    if (this.filePath) {
      try {
        appendFileSync(this.filePath, `${line}\n`, { flag: 'a' });
      } catch {
        /* file logging is best-effort */
      }
    }
    if (level === 'error' || level === 'warn') {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}

export const logger = new Logger();
