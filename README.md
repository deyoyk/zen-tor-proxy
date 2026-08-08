# Zen Tor Proxy

Routes any OpenAI-compatible client through Tor with automatic exit-IP rotation, zero config.

When the upstream model responds with an error (for example **"Free usage exceeded"**, 402/429 rate limits, or any other 4xx/5xx), the proxy automatically **changes the Tor exit IP** and **re-sends the request once** over the new IP — no subscription needed.

## Install

**Windows**

```powershell
irm https://raw.githubusercontent.com/deyoyk/zen-tor-proxy/main/scripts/install.ps1 | iex
```

Then run it in any terminal (foreground):

```
zen-tor-proxy
```

**Linux / macOS**

```bash
curl -fsSL https://raw.githubusercontent.com/deyoyk/zen-tor-proxy/main/scripts/install.sh | bash
```

Installs and starts a background service (systemd on Linux, launchd on macOS).

## Update

Re-run the same install command - it checks the installed version and updates
in place if a newer release exists (stops the running app/service, replaces the
binary, restarts).

```powershell
# Windows
irm https://raw.githubusercontent.com/deyoyk/zen-tor-proxy/main/scripts/install.ps1 | iex
```

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/deyoyk/zen-tor-proxy/main/scripts/install.sh | bash
```

## API

OpenAI-compatible base URL (any API key works, defaults to `public`):

```
http://127.0.0.1:5678/v1
```

Test it:

```bash
curl http://127.0.0.1:5678/health
```

## Exit-IP rotation

By default the proxy does **not** rotate on a timer. Instead it rotates on demand whenever the upstream model returns an error (the typical case: the free tier says *"Free usage exceeded"*, the exit IP is changed, and the request is retried automatically so the free quota applies again).

| Option | Default | Description |
| --- | --- | --- |
| `IP_ROTATE_INTERVAL_MS` | `0` | Scheduled rotation interval. `0` disables the timer; e.g. `600000` restores rotation every 10 minutes. |
| `ROTATE_ON_UPSTREAM_ERROR` | `true` | Master switch for on-demand rotation when the model errors. |
| `ROTATE_ON_ANY_UPSTREAM_ERROR` | `true` | Rotate on any 4xx/5xx response. Set to `false` to rotate only on quota-style errors (402/429 or messages about usage limits). |
| `ROTATE_RETRY_REQUESTS` | `true` | Automatically re-send the failed request once over the new exit IP. |
| `ROTATE_ON_ERROR_COOLDOWN_MS` | `20000` | Minimum gap between on-demand rotations (prevents hammering NEWNYM when many requests fail at once). |

## Configuration & service management

All settings are optional and live in a `.env` file created next to the binary
(see `.env.example` in the repo for every option). Edit it, then restart the app.

### Windows

| | Location |
| --- | --- |
| Config file | `%LOCALAPPDATA%\Programs\zen-tor-proxy\.env` |
| Log file | `%LOCALAPPDATA%\Programs\zen-tor-proxy\zen-tor-proxy.log` |

Edit the config (e.g. Notepad), save, then restart:

```
# stop the running app (Ctrl+C in its terminal)
# start it again
zen-tor-proxy
```

### Linux

| | Location |
| --- | --- |
| Config file | `/usr/local/bin/.env` (or `~/.local/bin/.env`) |
| Log file | next to the binary (`zen-tor-proxy.log`) |

Edit the config, then restart the background service:

```bash
systemctl --user restart zen-tor-proxy
journalctl --user -u zen-tor-proxy -f     # live logs
systemctl --user status zen-tor-proxy     # status
```

### macOS

| | Location |
| --- | --- |
| Config file | `/usr/local/bin/.env` (or `~/.local/bin/.env`) |
| Log file | `~/.local/share/zen-tor-proxy/zen-tor-proxy.log` (or `/var/lib/zen-tor-proxy/`) |

Edit the config, then restart the background service:

```bash
launchctl kickstart -k gui/$(id -u)/com.zentorproxy.agent
launchctl list | grep zen-tor-proxy      # status
```

## Uninstall

**Windows**

```powershell
irm https://raw.githubusercontent.com/deyoyk/zen-tor-proxy/main/scripts/install.ps1 | iex -Uninstall
```

**Linux / macOS**

```bash
curl -fsSL https://raw.githubusercontent.com/deyoyk/zen-tor-proxy/main/scripts/install.sh | bash -s uninstall
```
