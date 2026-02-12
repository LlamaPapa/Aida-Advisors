#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  AIDA Voice — One-Command Installer for macOS
#
#  Option A — run from anywhere:
#    bash <(curl -sSL https://raw.githubusercontent.com/LlamaPapa/Aida-Advisors/main/install-voice.sh)
#
#  Option B — if you already cloned the repo:
#    bash install-voice.sh
# ═══════════════════════════════════════════════════════════════

set -e

INSTALL_DIR="$HOME/.aida-voice"
APP_NAME="AIDA Voice"
APP_DIR="/Applications/$APP_NAME.app"

echo ""
echo "══════════════════════════════════════════════════"
echo "  AIDA Voice — Installing..."
echo "══════════════════════════════════════════════════"
echo ""

# ── 1. Check/install Node.js ────────────────────────────────
if ! command -v node &>/dev/null; then
    echo "  Node.js not found. Installing via Homebrew..."
    if ! command -v brew &>/dev/null; then
        echo "  Installing Homebrew first..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        if [ -f "/opt/homebrew/bin/brew" ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
    fi
    brew install node
fi
echo "  Node.js $(node --version)"

# ── 2. Check/install sox (for mic recording via CLI) ────────
if ! command -v sox &>/dev/null; then
    if command -v brew &>/dev/null; then
        echo "  Installing sox (audio recording)..."
        brew install sox 2>/dev/null || echo "  (sox skipped — browser recording still works)"
    fi
fi

# ── 3. Get the code ─────────────────────────────────────────
# Detect if we're running from inside a local clone
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]}" ] && [ "${BASH_SOURCE[0]}" != "bash" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || true
fi

if [ -d "$INSTALL_DIR/voice-pipeline/dist" ]; then
    echo "  Updating existing install..."
    cd "$INSTALL_DIR"
    git stash 2>/dev/null || true
    git pull origin main 2>/dev/null || true
elif [ -n "$SCRIPT_DIR" ] && [ -d "$SCRIPT_DIR/voice-pipeline" ]; then
    echo "  Installing from local repo..."
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    # Copy only what we need (skip .git to avoid size bloat)
    cp -R "$SCRIPT_DIR/voice-pipeline" "$INSTALL_DIR/voice-pipeline"
    [ -f "$SCRIPT_DIR/icon.svg" ] && cp "$SCRIPT_DIR/icon.svg" "$INSTALL_DIR/"
else
    echo "  Downloading AIDA Voice..."
    rm -rf "$INSTALL_DIR"
    git clone --depth 1 https://github.com/LlamaPapa/Aida-Advisors.git "$INSTALL_DIR"
fi

# ── 4. Install & build ─────────────────────────────────────
echo "  Installing dependencies..."
cd "$INSTALL_DIR/voice-pipeline"
npm install 2>&1 | tail -3
echo "  Building..."
npm run build 2>&1

# ── 5. Create macOS .app bundle ─────────────────────────────
echo "  Creating $APP_NAME.app in /Applications..."

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources/voice-pipeline"

# Bundle the built app + dependencies inside the .app
cp -R "$INSTALL_DIR/voice-pipeline/dist" "$APP_DIR/Contents/Resources/voice-pipeline/"
cp -R "$INSTALL_DIR/voice-pipeline/node_modules" "$APP_DIR/Contents/Resources/voice-pipeline/"
cp "$INSTALL_DIR/voice-pipeline/package.json" "$APP_DIR/Contents/Resources/voice-pipeline/"

# Info.plist
cat > "$APP_DIR/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>AIDA Voice</string>
    <key>CFBundleDisplayName</key>
    <string>AIDA Voice</string>
    <key>CFBundleIdentifier</key>
    <string>com.aida.voice</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleExecutable</key>
    <string>launch</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>AIDA Voice needs microphone access for speech-to-text.</string>
</dict>
</plist>
PLIST

# Launch script — self-contained, points to bundled code inside .app
cat > "$APP_DIR/Contents/MacOS/launch" << 'LAUNCHER'
#!/bin/bash
DIR="$(cd "$(dirname "$0")/../Resources" && pwd)"
PORT=7890

# Find Node.js
for NODE_BIN in \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  "$HOME/.nvm/versions/node"/*/bin/node \
  "$(which node 2>/dev/null)" \
; do
  [ -x "$NODE_BIN" ] && break
done

if [ ! -x "$NODE_BIN" ]; then
  osascript -e 'display alert "Node.js Required" message "Install Node.js from https://nodejs.org then relaunch." as critical buttons {"Open nodejs.org","Cancel"} default button 1' \
    -e 'if button returned of result is "Open nodejs.org" then open location "https://nodejs.org"'
  exit 1
fi

# Kill any existing daemon on this port
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true

# Start daemon
cd "$DIR/voice-pipeline"
"$NODE_BIN" dist/cli.js daemon -p $PORT &
DAEMON_PID=$!

# Wait for server to be ready
for i in {1..30}; do
  curl -sf http://localhost:$PORT/api/health >/dev/null 2>&1 && break
  sleep 0.3
done

# Open browser
open "http://localhost:$PORT"

# Keep running
wait $DAEMON_PID
LAUNCHER
chmod +x "$APP_DIR/Contents/MacOS/launch"

# ── 6. Create app icon ──────────────────────────────────────
if [ -f "$INSTALL_DIR/icon.svg" ]; then
    ICON_TMP=$(mktemp -d)
    # Try qlmanage (available on every Mac)
    qlmanage -t -s 512 -o "$ICON_TMP" "$INSTALL_DIR/icon.svg" 2>/dev/null || true
    ICON_PNG="$ICON_TMP/icon.svg.png"
    if [ -f "$ICON_PNG" ]; then
        mkdir -p "$ICON_TMP/icon.iconset"
        sips -z 16 16     "$ICON_PNG" --out "$ICON_TMP/icon.iconset/icon_16x16.png" 2>/dev/null
        sips -z 32 32     "$ICON_PNG" --out "$ICON_TMP/icon.iconset/icon_16x16@2x.png" 2>/dev/null
        sips -z 32 32     "$ICON_PNG" --out "$ICON_TMP/icon.iconset/icon_32x32.png" 2>/dev/null
        sips -z 64 64     "$ICON_PNG" --out "$ICON_TMP/icon.iconset/icon_32x32@2x.png" 2>/dev/null
        sips -z 128 128   "$ICON_PNG" --out "$ICON_TMP/icon.iconset/icon_128x128.png" 2>/dev/null
        sips -z 256 256   "$ICON_PNG" --out "$ICON_TMP/icon.iconset/icon_128x128@2x.png" 2>/dev/null
        sips -z 256 256   "$ICON_PNG" --out "$ICON_TMP/icon.iconset/icon_256x256.png" 2>/dev/null
        sips -z 512 512   "$ICON_PNG" --out "$ICON_TMP/icon.iconset/icon_256x256@2x.png" 2>/dev/null
        sips -z 512 512   "$ICON_PNG" --out "$ICON_TMP/icon.iconset/icon_512x512.png" 2>/dev/null
        cp "$ICON_PNG"    "$ICON_TMP/icon.iconset/icon_512x512@2x.png" 2>/dev/null
        iconutil -c icns "$ICON_TMP/icon.iconset" -o "$APP_DIR/Contents/Resources/icon.icns" 2>/dev/null || true
    fi
    rm -rf "$ICON_TMP"
fi

# ── 7. Uninstall script ────────────────────────────────────
cat > "$INSTALL_DIR/uninstall.sh" << 'UNINSTALL'
#!/bin/bash
echo "Removing AIDA Voice..."
rm -rf "/Applications/AIDA Voice.app"
rm -rf "$HOME/.aida-voice"
rm -rf "$HOME/.voice-pipeline"
echo "Done."
UNINSTALL
chmod +x "$INSTALL_DIR/uninstall.sh"

echo ""
echo "══════════════════════════════════════════════════"
echo ""
echo "  AIDA Voice installed!"
echo ""
echo "  Open 'AIDA Voice' from your Applications folder."
echo "  Tap Settings → enter your API keys → done."
echo ""
echo "  To uninstall:  bash ~/.aida-voice/uninstall.sh"
echo ""
echo "══════════════════════════════════════════════════"
echo ""
