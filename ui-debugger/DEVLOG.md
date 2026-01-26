# UI Debugger - Development Log

## 2026-01-26

### Auto-Hook System
Built automatic triggering so you don't have to manually run commands.

- `autoHook.ts` - central orchestrator
- Webhook endpoint for vibecoder to call after code gen
- Git watcher (polls every 5s for new commits)
- File watcher (debounced, ignores node_modules)
- Daemon CLI command that runs continuously

### Test Data Agent
Tests often need data - CSVs to upload, users to log in with, etc.

- `testDataAgent.ts` - generates data on demand
- Field types: name, email, phone, address, price, date, etc.
- Integrated with UI tester - when a test needs to upload a file, it auto-generates one
- CLI command: `test-data --type users --count 50`

### Playwright Integration
Real browser testing, not mocks.

- `uiTester.ts` - Playwright wrapper
- Claude translates natural language steps to Playwright actions
- "Click the login button" → `page.click('button:text("Login")')`
- Screenshots after every step for debugging
- Console errors collected and flagged

### Verification Agent
Checks if what was built matches what was planned.

- `verificationAgent.ts` - core logic
- Fetches plan from vibecoder API (brief, mustHave, mustNot)
- Compares to git diff (what actually changed)
- Generates test scenarios based on changes
- Produces flags: critical, warning, info

### Renamed Project
Was `debug-pipeline`, now `ui-debugger`.

## Architecture Decisions

### Why Playwright over Puppeteer?
- Better API, better maintained
- Cross-browser support if needed later
- Better selector engine

### Why poll git instead of hook?
- Git hooks require setup in each project
- Polling is zero-config
- 5s delay is acceptable for this use case

### Why Claude for test translation?
- Natural language steps are more readable
- Claude handles ambiguity well
- Can describe what you want, not how to do it

### Model choices
- Opus for complex reasoning (test plans, error analysis)
- Sonnet for structured output (step translation, flags)
- Cost matters - don't use Opus where Sonnet works
