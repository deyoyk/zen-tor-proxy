#!/usr/bin/env bash
set -euo pipefail

REPO="deyoyk/zen-tor-proxy"
VERSION="${ZEN_TOR_PROXY_VERSION:-latest}"

if [ "${1:-}" = "uninstall" ]; then
  systemctl --user disable --now zen-tor-proxy.service >/dev/null 2>&1 || true
  launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.zentorproxy.agent.plist >/dev/null 2>&1 || true
  rm -f /usr/local/bin/zen-tor-proxy "$HOME/.local/bin/zen-tor-proxy"
  rm -f "$HOME/.config/systemd/user/zen-tor-proxy.service" "$HOME/Library/LaunchAgents/com.zentorproxy.agent.plist"
  echo "zen-tor-proxy uninstalled."
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

JSON="$(dl_stdout "$API_URL")"
URL="$(printf '%s' "$JSON" | awk -v a="$ASSET" '
  /"name"[[:space:]]*:/ { nm=$0; sub(/^.*"name"[[:space:]]*:[[:space:]]*"/,"",nm); sub(/".*$/,"",nm) }
  /"browser_download_url"/ && nm==a { u=$0; sub(/^.*"browser_download_url"[[:space:]]*:[[:space:]]*"/,"",u); sub(/".*$/,"",u); print u; exit }
')"
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

$MKDIR "$DEST_DIR" "$DATA_DIR"
echo "Downloading $ASSET ..."
dl "$URL" "$DEST_DIR/.zen-tor-proxy.tmp"
$WRITE "$DEST_DIR/.zen-tor-proxy.tmp" "$DEST_DIR/zen-tor-proxy"
rm -f "$DEST_DIR/.zen-tor-proxy.tmp"
chmod +x "$DEST_DIR/zen-tor-proxy"
echo "Installed to $DEST_DIR/zen-tor-proxy"

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
ExecStart=$DEST_DIR/zen-tor-proxy
Environment=TOR_DATA_DIR=$DATA_DIR
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now zen-tor-proxy.service
    loginctl enable-linger "$(id -un)" >/dev/null 2>&1 || true
    echo "Started background service: systemctl --user status zen-tor-proxy"
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
    <string>$DEST_DIR/zen-tor-proxy</string>
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
    echo "Started background service (launchd): launchctl list | grep zen-tor-proxy"
    ;;
esac

echo ""
echo "zen-tor-proxy installed!"
echo "  API endpoint:  http://127.0.0.1:5678/v1"
