# UI Debugger

Autonomous UI verification agent that tests implementations against plans, runs Playwright tests, generates test data, and flags issues before you build more.

## Quick Start

```bash
# 1. Install dependencies
npm install
npx playwright install chromium

# 2. Set up API key
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY

# 3. Run daemon mode (recommended)
npm run cli -- daemon ./your-project --base-url http://localhost:3000
```

## How It Works

```
Code Implemented → Auto-Triggered → Verify Plan → Run UI Tests → Flag Issues → Fix Before Building More
```

1. **vibecoder-roundtable** implements code based on a plan
2. **Auto-hook** detects the change (via webhook or git commit)
3. **Verification Agent** checks: did they build what was planned?
4. **Playwright** runs UI tests based on the implementation
5. **Test Data Agent** auto-generates any CSV/JSON/images needed
6. **Flags** any issues found
7. **Pipeline** auto-fixes build errors if needed
8. **Reports** back to roundtable

## CLI Commands

| Command | Description |
|---------|-------------|
| `daemon <project>` | Run continuously, auto-trigger on changes |
| `verify <project>` | One-shot verification against plan |
| `ui-test <url>` | Run UI tests against running app |
| `smoke <url>` | Quick check if app loads |
| `test-data` | Generate test CSV/JSON/users/products |
| `run <project>` | Run build/fix pipeline |
| `watch <project>` | Watch mode for builds |
| `server` | HTTP server with dashboard |
| `setup-hook <project>` | Install git post-commit hook |

## Example Usage

```bash
# Daemon mode - watches and auto-tests
npm run cli -- daemon ../vibecoder-roundtable/frontend \
  --base-url http://localhost:5180 \
  --roundtable http://localhost:3010

# One-shot verification
npm run cli -- verify ../my-project --ui --base-url http://localhost:3000

# Quick smoke test
npm run cli -- smoke http://localhost:3000

# Generate test data
npm run cli -- test-data --type users --count 50
npm run cli -- test-data --type csv --schema '{"id":"id","name":"name","price":"price"}'
```

## API Endpoints (Server Mode)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/run` | POST | Start build/fix pipeline |
| `/api/hook/implementation` | POST | Webhook for vibecoder |
| `/api/hook/start` | POST | Start auto-monitoring |
| `/api/hook/stop` | POST | Stop auto-monitoring |
| `/api/events` | GET | SSE stream for real-time updates |

## Vibecoder Integration

After vibecoder generates code, it calls:

```bash
curl -X POST http://localhost:3002/api/hook/implementation \
  -H "Content-Type: application/json" \
  -d '{"projectRoot": "/path/to/project", "plan": {...}}'
```

## Ports

- Dashboard/API: 3002
