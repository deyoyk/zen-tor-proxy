# Zen Tor Proxy

Routes any OpenAI-compatible client through Tor - new exit IP every 10 minutes, zero config.

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
