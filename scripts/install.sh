#!/usr/bin/env bash
set -euo pipefail

REPO="deyoyk/zen-tor-proxy"
VERSION="${ZEN_TOR_PROXY_VERSION:-latest}"

stop_service() {
  systemctl --user stop zen-tor-proxy.service >/dev/null 2>&1 || true
  launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.zentorproxy.agent.plist" >/dev/null 2>&1 || true
}

if [ "${1:-}" = "uninstall" ]; then
  stop_service
  pkill -f 'bin/zen-tor-proxy' >/dev/null 2>&1 || true
  rm -f /usr/local/bin/zen-tor-proxy "$HOME/.local/bin/zen-tor-proxy"
  rm -f /usr/local/bin/.zen-tor-proxy-version "$HOME/.local/bin/.zen-tor-proxy-version"
  rm -f "$HOME/.config/systemd/user/zen-tor-proxy.service" "$HOME/Library/LaunchAgents/com.zentorproxy.agent.plist"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  echo "zen-tor-proxy uninstalled."
  echo "Tor data kept at: /var/lib/zen-tor-proxy or $HOME/.local/share/zen-tor-proxy"
  exit 0
fi

detect() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$OS" in
    Linux) OS="linux" ;;
    Darwin) OS="macos" ;;
    *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
  esac
  case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
  esac
}

dl() { curl -fsSL "$1" -o "$2"; }
dl_stdout() { curl -fsSL "$1"; }
if ! command -v curl >/dev/null 2>&1; then
  dl() { wget -qO "$2" "$1"; }
  dl_stdout() { wget -qO- "$1"; }
  if ! command -v wget >/dev/null 2>&1; then
    echo "Need curl or wget to install" >&2
    exit 1
  fi
fi

detect
ASSET="zen-tor-proxy-${OS}-${ARCH}"
echo "Detected $OS/$ARCH -> $ASSET"

if [ "$VERSION" = "latest" ]; then
  API_URL="https://api.github.com/repos/$REPO/releases/latest"
else
  API_URL="https://api.github.com/repos/$REPO/releases/tags/$VERSION"
fi

echo "Checking for latest release of $REPO ..."
JSON="$(dl_stdout "$API_URL")"
TAG="$(printf '%s' "$JSON" | awk '/"tag_name"[[:space:]]*:[[:space:]]*"/ { u=$0; sub(/^.*"tag_name"[[:space:]]*:[[:space:]]*"/,"",u); sub(/".*$/,"",u); print u; exit }')"
URL="$(printf '%s' "$JSON" | awk -v a="$ASSET" '
  /"name"[[:space:]]*:/ { nm=$0; sub(/^.*"name"[[:space:]]*:[[:space:]]*"/,"",nm); sub(/".*$/,"",nm) }
  /"browser_download_url"/ && nm==a { u=$0; sub(/^.*"browser_download_url"[[:space:]]*:[[:space:]]*"/,"",u); sub(/".*$/,"",u); print u; exit }
')"
if [ -z "$TAG" ]; then
  echo "Could not determine latest release (rate-limited?) - try ZEN_TOR_PROXY_VERSION=vX.Y.Z" >&2
  exit 1
fi
if [ -z "$URL" ]; then
  echo "Asset $ASSET not found in release $VERSION" >&2
  exit 1
fi

if [ -w /usr/local/bin ]; then
  DEST_DIR="/usr/local/bin"
  DATA_DIR="/var/lib/zen-tor-proxy"
  MKDIR="mkdir -p"
  WRITE="install -m 0755"
else
  DEST_DIR="$HOME/.local/bin"
  DATA_DIR="$HOME/.local/share/zen-tor-proxy"
  MKDIR="mkdir -p"
  WRITE="install -m 0755"
fi

BIN="$DEST_DIR/zen-tor-proxy"
VERSION_FILE="$DEST_DIR/.zen-tor-proxy-version"
INSTALLED="$(cat "$VERSION_FILE" 2>/dev/null || true)"

ensure_unit() {
  case "$OS" in
    linux)
      UNIT="$HOME/.config/systemd/user/zen-tor-proxy.service"
      mkdir -p "$(dirname "$UNIT")"
      cat > "$UNIT" <<EOF
[Unit]
Description=Zen Tor Proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$BIN
Environment=TOR_DATA_DIR=$DATA_DIR
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
      systemctl --user daemon-reload
      systemctl --user enable --now zen-tor-proxy.service
      loginctl enable-linger "$(id -un)" >/dev/null 2>&1 || true
      ;;
    macos)
      PLIST="$HOME/Library/LaunchAgents/com.zentorproxy.agent.plist"
      mkdir -p "$(dirname "$PLIST")"
      cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.zentorproxy.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TOR_DATA_DIR</key>
    <string>$DATA_DIR</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$DATA_DIR/zen-tor-proxy.log</string>
  <key>StandardErrorPath</key>
  <string>$DATA_DIR/zen-tor-proxy.log</string>
</dict>
</plist>
EOF
      launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"
      ;;
  esac
}

if [ "$INSTALLED" = "$TAG" ] && [ -x "$BIN" ]; then
  echo "zen-tor-proxy is already up to date (v$TAG)."
  ensure_unit
  echo "Service status:"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user is-active zen-tor-proxy.service || true
  fi
  exit 0
fi

$MKDIR "$DEST_DIR" "$DATA_DIR"

if [ -x "$BIN" ]; then
  echo "Updating zen-tor-proxy ${INSTALLED:-unknown} -> v$TAG ..."
  stop_service
else
  echo "Installing zen-tor-proxy v$TAG ..."
fi

echo "Downloading $ASSET ..."
dl "$URL" "$DEST_DIR/.zen-tor-proxy.tmp"
$WRITE "$DEST_DIR/.zen-tor-proxy.tmp" "$BIN"
rm -f "$DEST_DIR/.zen-tor-proxy.tmp"
chmod +x "$BIN"
printf '%s' "$TAG" > "$VERSION_FILE"
echo "Installed to $BIN"

if [ -w "$DEST_DIR" ]; then
  ENV_FILE="$DEST_DIR/.env"
  if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" <<'EOF'
# zen-tor-proxy configuration (edit and restart)
# Full list of options: https://github.com/deyoyk/zen-tor-proxy
#
#PORT=5678
#LOG_LEVEL=info
#LOCAL_AUTH_TOKEN=change-me
EOF
  fi
fi

ensure_unit
echo "Service started (systemd/launchd)."

echo ""
echo "zen-tor-proxy installed (v$TAG)!"
echo "  API endpoint:  http://127.0.0.1:5678/v1"
echo "  Config file:   $DEST_DIR/.env"
