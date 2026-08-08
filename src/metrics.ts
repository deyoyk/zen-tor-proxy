export interface RequestLogEntry {
  at: number;
  model: string | null;
  stream: boolean;
  status: number | null;
  durationMs: number;
  bytesUp: number;
  bytesDown: number;
  retried: boolean;
  kind: 'ok' | 'error' | 'network' | 'timeout';
}

export interface HistoryPoint {
  t: number;
  requests: number;
  errors: number;
  bytesUp: number;
  bytesDown: number;
}

export interface RequestFinishedInfo {
  status: number | null;
  bytesUp: number;
  bytesDown: number;
  durationMs: number;
  model: string | null;
  stream: boolean;
  retried: boolean;
  errorMsg?: string;
}

const MAX_RECENT = 200;
const MAX_HISTORY = 240;

export class MetricsStore {
  readonly startedAt = Date.now();

  requestsTotal = 0;
  activeRequests = 0;
  streamingRequests = 0;
  errorsTotal = 0;
  upstreamErrors = 0;
  retries = 0;
  bytesUp = 0;
  bytesDown = 0;
  rotations = 0;
  rotationFailures = 0;
  lastRotationAt: number | null = null;
  lastExitIp: string | null = null;
  lastIpCheckedAt: number | null = null;
  peakActiveRequests = 0;
  totalDurationMs = 0;
  longestRequestMs = 0;
  lastRequestAt: number | null = null;
  lastErrorAt: number | null = null;
  lastError: string | null = null;

  readonly statusCounts: Record<number, number> = {};
  readonly models: Record<string, number> = {};
  readonly recent: RequestLogEntry[] = [];
  readonly history: HistoryPoint[] = [];

  private lastSampleRequests = 0;
  private lastSampleErrors = 0;
  private lastSampleBytesUp = 0;
  private lastSampleBytesDown = 0;

  get uptimeSec(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  get avgDurationMs(): number {
    return this.requestsTotal > 0 ? Math.round(this.totalDurationMs / this.requestsTotal) : 0;
  }

  get successRate(): number {
    const ok = this.requestsTotal - this.errorsTotal;
    return this.requestsTotal > 0 ? Math.round((ok / this.requestsTotal) * 1000) / 10 : 100;
  }

  requestStarted(streaming: boolean): void {
    this.requestsTotal += 1;
    this.activeRequests += 1;
    if (streaming) this.streamingRequests += 1;
    if (this.activeRequests > this.peakActiveRequests) this.peakActiveRequests = this.activeRequests;
  }

  requestFinished(info: RequestFinishedInfo): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.lastRequestAt = Date.now();
    this.totalDurationMs += info.durationMs;
    if (info.durationMs > this.longestRequestMs) this.longestRequestMs = info.durationMs;

    const kind =
      info.status === null
        ? 'network'
        : info.status === 504
          ? 'timeout'
          : info.status >= 400
            ? 'error'
            : 'ok';

    if (kind !== 'ok') {
      this.lastErrorAt = Date.now();
      if (info.errorMsg) this.lastError = info.errorMsg;
    }
    if (info.status !== null) {
      this.statusCounts[info.status] = (this.statusCounts[info.status] ?? 0) + 1;
    }
    if (info.model) {
      this.models[info.model] = (this.models[info.model] ?? 0) + 1;
    }

    this.recent.push({
      at: Date.now(),
      model: info.model,
      stream: info.stream,
      status: info.status,
      durationMs: info.durationMs,
      bytesUp: info.bytesUp,
      bytesDown: info.bytesDown,
      retried: info.retried,
      kind,
    });
    if (this.recent.length > MAX_RECENT) this.recent.splice(0, this.recent.length - MAX_RECENT);
  }

  /** Append a one-second sampling point. Call from a 1s interval. */
  sample(): void {
    const requests = this.requestsTotal - this.lastSampleRequests;
    const errors = this.errorsTotal - this.lastSampleErrors;
    const bytesUp = this.bytesUp - this.lastSampleBytesUp;
    const bytesDown = this.bytesDown - this.lastSampleBytesDown;
    this.lastSampleRequests = this.requestsTotal;
    this.lastSampleErrors = this.errorsTotal;
    this.lastSampleBytesUp = this.bytesUp;
    this.lastSampleBytesDown = this.bytesDown;

    this.history.push({ t: Date.now(), requests, errors, bytesUp, bytesDown });
    if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY);
  }

  snapshot(): Record<string, unknown> {
    return {
      startedAt: this.startedAt,
      uptimeSec: this.uptimeSec,
      requestsTotal: this.requestsTotal,
      activeRequests: this.activeRequests,
      peakActiveRequests: this.peakActiveRequests,
      streamingRequests: this.streamingRequests,
      errorsTotal: this.errorsTotal,
      upstreamErrors: this.upstreamErrors,
      retries: this.retries,
      bytesUp: this.bytesUp,
      bytesDown: this.bytesDown,
      rotations: this.rotations,
      rotationFailures: this.rotationFailures,
      lastRotationAt: this.lastRotationAt,
      lastExitIp: this.lastExitIp,
      lastIpCheckedAt: this.lastIpCheckedAt,
      avgDurationMs: this.avgDurationMs,
      longestRequestMs: this.longestRequestMs,
      successRate: this.successRate,
      lastRequestAt: this.lastRequestAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
    };
  }
}
