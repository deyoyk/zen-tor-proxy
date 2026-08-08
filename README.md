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

Uninstall: `install.sh uninstall` (Linux/macOS) or run `install.ps1 -Uninstall` (Windows).

## API

OpenAI-compatible base URL (any API key works, defaults to `public`):

```
http://127.0.0.1:5678/v1
```

Test it:

```bash
curl http://127.0.0.1:5678/health
```
