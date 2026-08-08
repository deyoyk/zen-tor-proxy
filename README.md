# Zen Tor Proxy

Production-ready, OpenAI-compatible proxy that routes every request through
Tor and automatically rotates the exit IP every 10 minutes — fully automatic,
from Tor installation to circuit rotation.

```
Client (Hanako / any OpenAI client)
        │  http://127.0.0.1:5678/v1/chat/completions
        ▼
┌─────────────────────────┐        SOCKS5          ┌─────────────────────────────┐
│  zen-tor-proxy (Node)   │ ─────────────────────▶ │  Tor (managed child process)│
│  · OpenAI-compatible API│      socks5h://        │  · auto-installed if missing│
│  · SSE streaming        │    127.0.0.1:9050      │  · control port for NEWNYM  │
│  · IP rotation timer    │ ◀───────────────────── │  · auto-restart on crash   │
└─────────────────────────┘    exit IP changes     └─────────────────────────────┘
        │
        ▼
https://opencode.ai/zen/v1/chat/completions
```

## Features

- **Automatic Tor management** — detects an existing Tor binary, otherwise
  downloads and installs the official Tor expert bundle (Windows / Linux /
  macOS), writes a hardened `torrc`, and waits for 100% bootstrap before
  serving traffic.
- **Automatic exit-IP rotation** — every 10 minutes (configurable) the proxy
  sends `SIGNAL NEWNYM` over the Tor control port, verifies the new exit IP
  with a public IP provider, swaps the SOCKS5 connection pool, and logs
  `before → after`. Old connections drain gracefully before being closed.
- **Crash recovery** — if the Tor process dies, it is restarted with
  exponential backoff and the circuit is rebuilt automatically.
- **OpenAI-compatible endpoints** — `POST /v1/chat/completions` with SSE
  streaming passthrough and non-streaming support, plus `GET /v1/models`,
  CORS enabled.
- **Operational endpoints** — `/health` (status, exit IP, next rotation,
  uptime) and `/stats` (counters).
- **Optional local auth token**, body size limits, upstream timeouts,
  structured logs, graceful shutdown.
- **Docker** image with system Tor and a health check.

## Quick start

Zero-config. The proxy defaults the upstream key to `public` (OpenCode Zen
free tier); a client's own `Authorization` header always takes precedence.
No `.env`, no flags required.

Requires Node.js >= 18.17 (only for the proxy) — Python is only needed for
the agent.

```bash
npm install
npm run build
npm start
```

Or run the Python agent and skip all of that — it auto-starts the proxy
(installs Tor, waits for bootstrap), uses model `mimo-v2.5-free` with api
key `public`, and stops everything on exit:

```bash
cd python-agent
pip install -r requirements.txt
python agent.py "what time is it and what is 17*23?"
```

On first start the proxy finds or installs Tor, waits for bootstrap, prints
the current exit IP, and begins the 10-minute rotation loop:

```
[info] [zen-tor-proxy] Tor is ready (SOCKS 9050, control 9051, pid 1234)
[info] [zen-tor-proxy] Tor exit IP: 185.220.101.42
[info] [zen-tor-proxy] Tor exit-IP rotation every 600s
[info] [zen-tor-proxy] Proxy listening on http://127.0.0.1:5678
```

Point your client at it:

```
base_url = http://127.0.0.1:5678/v1
api_key  = anything (unless LOCAL_AUTH_TOKEN is set)
```

or test directly:

```bash
curl http://127.0.0.1:5678/health
curl -N http://127.0.0.1:5678/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v3","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

## Windows .exe (share with friends)

No Node.js, Python, or Tor installation needed — the exe bundles Node and
auto-installs Tor on first run:

```bash
npm run build:exe    # → dist/zen-tor-proxy.exe (~94 MB)
```

1. Put `zen-tor-proxy.exe` in any writable folder (it keeps its Tor data in
   `<exe folder>\data\tor`, auto-installed on first start).
2. Double-click it — a console window opens; wait for `Proxy listening on
   http://127.0.0.1:5678`.
3. Point any OpenAI-compatible client at `http://127.0.0.1:5678/v1` with any
   `api_key` (defaults to `public` for the OpenCode Zen free tier).

Close the console window (or Ctrl+C) to stop.

## Configuration

All settings are environment variables (see `.env.example`). Copy it to
`.env` or export the variables.

| Variable | Default | Description |
| --- | --- | --- |
| `ZEN_API_KEY` | `public` | Upstream OpenCode Zen key. A client's own `Authorization` header always takes precedence. |
| `PORT` | `5678` | Local listener port. |
| `HOST` | `127.0.0.1` | Local listener address. |
| `UPSTREAM_URL` | `https://opencode.ai/zen/v1/chat/completions` | Upstream OpenAI-compatible endpoint. `GET /v1/models` is derived by replacing `/chat/completions` with `/models`. |
| `LOCAL_AUTH_TOKEN` | — | If set, local clients must send `Authorization: Bearer <token>`. Recommended if `HOST` is not loopback. |
| `AUTO_INSTALL_TOR` | `true` | Download the Tor expert bundle when no binary is found. |
| `TOR_BINARY_PATH` | — | Explicit path to a Tor binary. |
| `TOR_SOCKS_PORT` | `9050` | Tor SOCKS5 port (`0` = pick a free port). |
| `TOR_CONTROL_PORT` | `9051` | Tor control port (`0` = pick a free port). |
| `TOR_DATA_DIR` | `./data/tor` | Tor data, config and downloaded bundles. |
| `TOR_BOOTSTRAP_TIMEOUT_MS` | `120000` | Max wait for Tor to reach 100% bootstrap. |
| `IP_ROTATE_INTERVAL_MS` | `600000` | Exit-IP rotation interval (10 minutes). |
| `IP_CHECK_PROVIDERS` | torproject, ipify, ipinfo | Comma-separated public-IP check endpoints. |
| `UPSTREAM_TIMEOUT_MS` | `300000` | Upstream idle timeout (reset by stream activity). |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. |

## How IP rotation works

1. The 10-minute timer fires and a fresh SOCKS5 probe socket is created.
2. The current exit IP is fetched through Tor.
3. `SIGNAL NEWNYM` is sent to the Tor control port — Tor discards old
   circuits and builds new ones.
4. The proxy polls the IP providers until the exit IP differs (up to ~30 s).
5. The SOCKS5 agent pool is swapped: new requests use a brand-new agent on
   the new circuit, while in-flight requests on the old agent drain to
   completion before it is destroyed.

Notes:

- Tor only routes *new* circuits through the new exit. Existing keep-alive
  sockets are retired rather than reused, which is why a fresh agent pool is
  created on every rotation.
- The first request after each rotation pays a short circuit-build latency
  (typically 1–10 s). Streaming requests keep the circuit warm.
- Some upstreams, including OpenCode Zen, may rate-limit or block Tor exit
  IPs (429/403). The proxy logs quota errors and their reset times; it does
  not attempt to bypass them.

## Docker

```bash
docker compose up -d --build
```

`ZEN_API_KEY` is optional (defaults to `public`). The container runs
system Tor (`/usr/bin/tor`), persists data in a volume, and exposes `5678`.

## Development

```bash
npm run dev      # tsx watch
npm run typecheck
npm test         # node:test config tests
npm run build    # tsc → dist/
npm start        # run compiled build
```

## Project layout

```
src/
  index.ts               entry point, wiring, shutdown
  config.ts              zod-validated environment configuration
  logger.ts              structured logger
  metrics.ts             counters for /stats
  httpUtil.ts            CORS + JSON/body helpers
  rotator.ts             NEWNYM + exit-IP verification + pool swap
  net/ipCheck.ts         public-IP lookup through the SOCKS agent
  proxy/server.ts        HTTP server, routes, auth
  proxy/upstream.ts      streaming/non-streaming upstream forwarding
  proxy/socksAgent.ts    rotating SOCKS5 agent pool
  tor/control.ts         Tor control protocol client
  tor/torManager.ts      binary discovery, torrc, launch, bootstrap, restart
  tor/installer.ts       expert-bundle download, checksum, extraction
```

## Security notes

- The proxy is unauthenticated by default and binds to `127.0.0.1`. If you
  bind it to another interface, set `LOCAL_AUTH_TOKEN`.
- The default upstream key is `public`, which only has access to the free
  tier. Send your own `Authorization: Bearer <key>` header to use a paid
  model/key without any proxy configuration.
- `LOG_LEVEL` of `debug` may log request bodies indirectly via Tor log
  lines; keep it at `info` in production.
- Tor obfuscates origin, not identity. Do not send account-identifying data
  if that matters for your use case, and check the terms of service of the
  upstream service you route through it.

## License

MIT
