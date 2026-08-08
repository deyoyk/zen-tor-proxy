export class MetricsStore {
  readonly startedAt = Date.now();

  requestsTotal = 0;
  activeRequests = 0;
  streamingRequests = 0;
  errorsTotal = 0;
  upstreamErrors = 0;
  bytesUp = 0;
  bytesDown = 0;
  rotations = 0;
  rotationFailures = 0;
  lastRotationAt: number | null = null;
  lastExitIp: string | null = null;
  lastIpCheckedAt: number | null = null;

  get uptimeSec(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  requestStarted(streaming: boolean): void {
    this.requestsTotal += 1;
    this.activeRequests += 1;
    if (streaming) this.streamingRequests += 1;
  }

  requestFinished(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
  }

  snapshot(): Record<string, unknown> {
    return {
      startedAt: this.startedAt,
      uptimeSec: this.uptimeSec,
      requestsTotal: this.requestsTotal,
      activeRequests: this.activeRequests,
      streamingRequests: this.streamingRequests,
      errorsTotal: this.errorsTotal,
      upstreamErrors: this.upstreamErrors,
      bytesUp: this.bytesUp,
      bytesDown: this.bytesDown,
      rotations: this.rotations,
      rotationFailures: this.rotationFailures,
      lastRotationAt: this.lastRotationAt,
      lastExitIp: this.lastExitIp,
      lastIpCheckedAt: this.lastIpCheckedAt,
    };
  }
}
