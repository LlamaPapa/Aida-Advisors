# UI Debugger

Autonomous verification agent that checks if code matches the plan, runs real UI tests, and flags issues before you continue building.

## Quick Start

```bash
cd ui-debugger
npm install
npx playwright install chromium

# Set API key
export ANTHROPIC_API_KEY=your-key

# Run in daemon mode (watches for changes)
npm run cli -- daemon ../your-project --base-url http://localhost:3000
```

## Commands

```bash
# Daemon - auto-triggers on git commits and file changes
npm run cli -- daemon <project> --base-url <url>

# Verify - one-shot check against plan
npm run cli -- verify <project> --ui --base-url <url>

# UI Test - run Playwright tests
npm run cli -- ui-test <url>

# Smoke - quick check if app loads
npm run cli -- smoke <url>

# Test Data - generate CSVs, users, products
npm run cli -- test-data --type users --count 50
npm run cli -- test-data --type csv --schema '{"name":"name","email":"email"}'

# Server - HTTP API with dashboard
npm run cli -- server

# Pipeline - build/fix loop
npm run cli -- run <project>
```

## Server API

```bash
# Start server
npm run cli -- server

# Trigger verification (called by vibecoder)
curl -X POST http://localhost:3002/api/hook/implementation \
  -H "Content-Type: application/json" \
  -d '{"projectRoot": "/path/to/project"}'

# Start daemon via API
curl -X POST http://localhost:3002/api/hook/start \
  -d '{"projectRoot": "/path", "baseUrl": "http://localhost:3000"}'
```

Dashboard: http://localhost:3002

## How It Works

1. Vibecoder generates code
2. UI Debugger auto-triggers (webhook, git commit, or file change)
3. Reads the plan from vibecoder (what should have been built)
4. Checks git diff (what was actually built)
5. Generates test scenarios
6. Runs Playwright in real browser
7. Flags any issues
8. Reports back

## Environment

```
ANTHROPIC_API_KEY=sk-ant-...
PORT=3002
```
