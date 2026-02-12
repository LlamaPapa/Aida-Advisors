#!/bin/bash
# ═══════════════════════════════════════════════════════
#  AIDA Voice Pipeline — One-Time Setup
#  Double-click this file in Finder to set up.
# ═══════════════════════════════════════════════════════

set -e

# Navigate to repo root (wherever this script lives)
cd "$(dirname "$0")"
REPO_DIR="$(pwd)"

echo ""
echo "══════════════════════════════════════════════"
echo "  AIDA Voice Pipeline — Setup"
echo "══════════════════════════════════════════════"
echo ""

# Pull latest code
echo "⟩ Pulling latest code..."
git pull origin main 2>/dev/null || git pull 2>/dev/null || echo "  (skipping git pull)"

# Check voice-pipeline exists
if [ ! -d "voice-pipeline" ]; then
    echo ""
    echo "ERROR: voice-pipeline folder not found."
    echo "Make sure you cloned the full Aida-Advisors repo."
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

cd voice-pipeline

# Check Node.js
if ! command -v node &>/dev/null; then
    echo ""
    echo "ERROR: Node.js not found. Install it from https://nodejs.org"
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

echo "  Node.js $(node --version) found"

# Install dependencies
echo ""
echo "⟩ Installing dependencies..."
npm install

# Build
echo ""
echo "⟩ Building..."
npm run build

# No .env needed — API keys are entered in the web UI Settings panel

# Check for sox (audio recording)
if ! command -v sox &>/dev/null; then
    echo ""
    echo "  ⚠  'sox' not found — needed for audio recording."
    echo "  Install with: brew install sox"
fi

echo ""
echo "══════════════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  Next: Double-click 'voice-daemon.command' to run."
echo "  Enter your API keys in Settings (top-right)."
echo "══════════════════════════════════════════════"
echo ""
read -p "Press Enter to close..."
