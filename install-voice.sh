#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  AIDA Voice — One-Command Installer for macOS
#
#  Run this in Terminal:
#    curl -sSL https://raw.githubusercontent.com/LlamaPapa/Aida-Advisors/main/install-voice.sh | bash
#
#  Or if you already cloned the repo:
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
    echo "Node.js not found. Installing via Homebrew..."
    if ! command -v brew &>/dev/null; then
        echo "Installing Homebrew first..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        # Add brew to PATH for Apple Silicon
        if [ -f "/opt/homebrew/bin/brew" ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
    fi
    brew install node
fi
echo "  Node.js $(node --version)"

# ── 2. Check/install sox (for mic recording via CLI) ────────
if ! command -v sox &>/dev/null; then
    echo "  Installing sox (audio recording)..."
    brew install sox 2>/dev/null || echo "  (sox install skipped — browser recording still works)"
fi

# ── 3. Clone or update repo ────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "  Updating existing install..."
    cd "$INSTALL_DIR"
    git pull origin main 2>/dev/null || true
else
    echo "  Downloading AIDA Voice..."
    # Check if we're already inside the repo
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -d "$SCRIPT_DIR/voice-pipeline" ]; then
        echo "  Copying from local repo..."
        rm -rf "$INSTALL_DIR"
        cp -R "$SCRIPT_DIR" "$INSTALL_DIR"
    else
        git clone https://github.com/LlamaPapa/Aida-Advisors.git "$INSTALL_DIR"
    fi
    cd "$INSTALL_DIR"
fi

# ── 4. Install & build ─────────────────────────────────────
echo "  Installing dependencies..."
cd "$INSTALL_DIR/voice-pipeline"
npm install --silent 2>&1 | tail -1
echo "  Building..."
npm run build --silent

# ── 5. Create macOS .app bundle ─────────────────────────────
echo "  Creating $APP_NAME.app..."

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# Info.plist
cat > "$APP_DIR/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>AIDA Voice</string>
    <key>CFBundleIdentifier</key>
    <string>com.aida.voice</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleExecutable</key>
    <string>launch</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
PLIST

# Launch script inside the .app
cat > "$APP_DIR/Contents/MacOS/launch" << LAUNCHER
#!/bin/bash
INSTALL_DIR="$INSTALL_DIR"
PORT=7890

# Use the Node.js from PATH (works with nvm, homebrew, etc.)
export PATH="/opt/homebrew/bin:/usr/local/bin:\$PATH"

# Start daemon in background
cd "\$INSTALL_DIR/voice-pipeline"
node dist/cli.js daemon -p \$PORT &
DAEMON_PID=\$!

# Wait for server to be ready
for i in {1..20}; do
    if curl -sf http://localhost:\$PORT/api/health >/dev/null 2>&1; then
        break
    fi
    sleep 0.3
done

# Open browser
open "http://localhost:\$PORT"

# Keep running until daemon exits
wait \$DAEMON_PID
LAUNCHER
chmod +x "$APP_DIR/Contents/MacOS/launch"

# ── 6. Create app icon from SVG ─────────────────────────────
if [ -f "$INSTALL_DIR/icon.svg" ] && command -v sips &>/dev/null; then
    # Convert SVG to a basic iconset (sips can't do SVG, but we try with qlmanage)
    ICON_TMP=$(mktemp -d)
    if command -v qlmanage &>/dev/null; then
        qlmanage -t -s 512 -o "$ICON_TMP" "$INSTALL_DIR/icon.svg" 2>/dev/null || true
        ICON_PNG="$ICON_TMP/icon.svg.png"
        if [ -f "$ICON_PNG" ]; then
            mkdir -p "$ICON_TMP/icon.iconset"
            sips -z 512 512 "$ICON_PNG" --out "$ICON_TMP/icon.iconset/icon_256x256@2x.png" 2>/dev/null || true
            sips -z 256 256 "$ICON_PNG" --out "$ICON_TMP/icon.iconset/icon_256x256.png" 2>/dev/null || true
            sips -z 128 128 "$ICON_PNG" --out "$ICON_TMP/icon.iconset/icon_128x128.png" 2>/dev/null || true
            iconutil -c icns "$ICON_TMP/icon.iconset" -o "$APP_DIR/Contents/Resources/icon.icns" 2>/dev/null || true
        fi
    fi
    rm -rf "$ICON_TMP"
fi

# ── 7. Create uninstall script ──────────────────────────────
cat > "$INSTALL_DIR/uninstall.sh" << 'UNINSTALL'
#!/bin/bash
echo "Removing AIDA Voice..."
rm -rf "/Applications/AIDA Voice.app"
rm -rf "$HOME/.aida-voice"
rm -rf "$HOME/.voice-pipeline"
echo "Done. AIDA Voice has been removed."
UNINSTALL
chmod +x "$INSTALL_DIR/uninstall.sh"

echo ""
echo "══════════════════════════════════════════════════"
echo "  Done!"
echo ""
echo "  AIDA Voice is in your Applications folder."
echo "  Double-click it to start."
echo ""
echo "  On first launch, tap Settings and enter"
echo "  your API keys (OpenAI + Anthropic)."
echo ""
echo "  To uninstall:  bash ~/.aida-voice/uninstall.sh"
echo "══════════════════════════════════════════════════"
echo ""
