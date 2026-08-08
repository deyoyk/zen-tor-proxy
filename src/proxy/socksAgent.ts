import { SocksProxyAgent } from 'socks-proxy-agent';

export class SocksAgentPool {
  private current: SocksProxyAgent;
  private retired: SocksProxyAgent[] = [];
  private active = 0;

  constructor(private readonly proxyUrl: string) {
    this.current = new SocksProxyAgent(proxyUrl);
  }

  get agent(): SocksProxyAgent {
    return this.current;
  }

  markStart(): void {
    this.active += 1;
  }

  markEnd(): void {
    this.active = Math.max(0, this.active - 1);
    this.drain();
  }

  swap(): void {
    const next = new SocksProxyAgent(this.proxyUrl);
    const previous = this.current;
    this.current = next;
    this.retired.push(previous);
    this.drain();
    setTimeout(() => {
      const index = this.retired.indexOf(previous);
      if (index !== -1 && this.active === 0) {
        previous.destroy();
        this.retired.splice(index, 1);
      }
    }, 120_000).unref?.();
  }

  destroy(): void {
    this.current.destroy();
    for (const agent of this.retired) agent.destroy();
    this.retired = [];
  }

  private drain(): void {
    const busy: SocksProxyAgent[] = [];
    for (const agent of this.retired) {
      if (this.active === 0) {
        agent.destroy();
      } else {
        busy.push(agent);
      }
    }
    this.retired = busy;
  }
}
