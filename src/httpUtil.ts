import type { IncomingMessage, ServerResponse } from 'node:http';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function writeJSON(
  res: ServerResponse,
  status: number,
  data: unknown,
  extraHeaders?: Record<string, string>
): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...CORS_HEADERS,
    ...extraHeaders,
  });
  res.end(body);
}

export type ReadBodyResult =
  | { ok: true; json: unknown }
  | { ok: false; status: number; message: string };

export function readBody(req: IncomingMessage, maxBytes = 50 * 1024 * 1024): Promise<ReadBodyResult> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const finish = (result: ReadBodyResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        finish({ ok: false, status: 413, message: 'Request body too large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        finish({ ok: false, status: 400, message: 'Empty request body' });
        return;
      }
      try {
        finish({ ok: true, json: JSON.parse(raw) });
      } catch {
        finish({ ok: false, status: 400, message: 'Invalid JSON in request body' });
      }
    });

    req.on('error', () => finish({ ok: false, status: 400, message: 'Failed to read request body' }));
  });
}
