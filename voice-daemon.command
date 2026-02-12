#!/bin/bash
# ═══════════════════════════════════════════════════════
#  AIDA Voice Pipeline — Start Daemon
#  Double-click this file in Finder to start.
# ═══════════════════════════════════════════════════════

# Navigate to repo root (wherever this script lives)
cd "$(dirname "$0")"
REPO_DIR="$(pwd)"

echo ""
echo "══════════════════════════════════════════════"
echo "  AIDA Voice Pipeline — Starting..."
echo "══════════════════════════════════════════════"
echo ""

# Check setup was done
if [ ! -d "voice-pipeline/dist" ]; then
    echo "ERROR: Not set up yet."
    echo "Double-click 'setup-voice.command' first."
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

# API keys are managed via the web UI Settings panel — no .env needed

cd voice-pipeline

echo "Starting voice daemon on http://localhost:7890"
echo "Open this URL on your iPhone or browser."
echo ""
echo "Press Ctrl+C to stop."
echo ""

node dist/cli.js daemon
