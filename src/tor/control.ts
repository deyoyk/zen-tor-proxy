import net from 'node:net';

export interface ControlOptions {
  host: string;
  port: number;
  password?: string;
}

export interface ControlReply {
  status: number;
  lines: string[];
}

export class TorControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TorControlError';
  }
}

export function controlCommand(options: ControlOptions, command: string): Promise<ControlReply> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: options.host, port: options.port });
    const lines: string[] = [];
    let buffer = '';
    let authenticated = false;
    let settled = false;
    let timer: NodeJS.Timeout;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
    };

    timer = setTimeout(() => {
      finish(new TorControlError(`Tor control timeout for: ${command}`));
    }, 20_000);

    socket.setEncoding('utf8');

    socket.on('connect', () => {
      if (options.password) {
        socket.write(`AUTHENTICATE "${options.password}"\r\n`);
      } else {
        socket.write(`${command}\r\n`);
      }
    });

    socket.on('data', chunk => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!line) continue;
        const status = parseInt(line.slice(0, 3), 10);
        const rest = line.slice(4);
        if (Number.isNaN(status)) continue;

        if (!authenticated) {
          if (status === 250) {
            authenticated = true;
            socket.write(`${command}\r\n`);
          } else {
            finish(new TorControlError(`AUTHENTICATE failed (${status}): ${rest}`));
            return;
          }
          continue;
        }

        lines.push(rest);
        if (line[3] === '-') continue;
        if (status !== 250) {
          finish(new TorControlError(`${command} failed (${status}): ${rest}`));
          return;
        }
        clearTimeout(timer);
        settled = true;
        socket.end();
        resolve({ status, lines });
        return;
      }
    });

    socket.on('error', err => finish(err));
  });
}

export async function signalNewNym(options: ControlOptions): Promise<void> {
  await controlCommand(options, 'SIGNAL NEWNYM');
}

export async function getBootstrapProgress(options: ControlOptions): Promise<number> {
  const reply = await controlCommand(options, 'GETINFO status/bootstrap-phase');
  for (const line of reply.lines) {
    const match = line.match(/BOOTSTRAP PROGRESS=(\d+)/);
    if (match) return parseInt(match[1] ?? '0', 10);
  }
  return 0;
}
