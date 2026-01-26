# UI Debugger - Architecture

## Overview

```
┌──────────────────┐     webhook      ┌──────────────────┐
│    vibecoder     │ ───────────────→ │   ui-debugger    │
│   roundtable     │                  │   (port 3002)    │
└──────────────────┘                  └──────────────────┘
                                              │
                                              │ Playwright
                                              ▼
                                      ┌──────────────────┐
                                      │  your app        │
                                      │  (port 3000)     │
                                      └──────────────────┘
```

## Modules

### autoHook.ts
Entry point for automatic triggering.
- Receives webhooks from vibecoder
- Watches git for new commits (polls every 5s)
- Watches files for changes (debounced)
- Triggers verification flow

### verificationAgent.ts
Compares plan to implementation.
- Fetches plan from vibecoder API
- Runs `git diff` to see what changed
- Uses Claude to generate test scenarios
- Produces flags (critical/warning/info)

### uiTester.ts
Runs real browser tests with Playwright.
- Claude translates "click login button" → `page.click('button:text("Login")')`
- Takes screenshot after every step
- Collects console errors
- Reports pass/fail per scenario

### testDataAgent.ts
Generates test data on demand.
- CSV, JSON, fake users, products, images
- 20+ field types (email, phone, price, etc.)
- Called automatically when UI test needs file upload

### pipeline.ts
Build/test/fix loop.
- Runs build command
- If fails, calls analyzer
- Analyzer uses Claude to suggest fix
- Can auto-apply fixes with Claude Code

### analyzer.ts
Understands build errors.
- Extracts file paths from error output
- Reads source files for context
- Uses Claude to diagnose root cause

### git.ts
Git operations.
- Create snapshot before fixes
- Commit after successful fix
- Provide rollback commands

### server.ts
HTTP API.
- `/api/hook/implementation` - webhook for vibecoder
- `/api/hook/start` - start daemon
- `/api/run` - trigger pipeline
- `/api/events` - SSE for real-time updates
- Serves dashboard at `/`

### cli.ts
Command line interface.
- `daemon` - background watcher
- `verify` - one-shot verification
- `ui-test` - run Playwright tests
- `smoke` - quick load check
- `test-data` - generate data
- `run` - build pipeline

## Data Flow

```
1. Trigger (webhook/git/file)
       │
       ▼
2. verificationAgent.verify()
   - fetch plan
   - check git diff
   - generate test plan
       │
       ▼
3. uiTester.runUITests()
   - launch browser
   - execute scenarios
   - take screenshots
       │
       ▼
4. Report flags
   - critical: app doesn't load
   - warning: test failed
   - info: console errors
```

## Models

| Task | Model | Why |
|------|-------|-----|
| Generate test plan | opus-4.5 | Complex reasoning about what to test |
| Translate test steps | sonnet-4 | Fast, good at structured output |
| Analyze build errors | opus-4.5 | Needs deep code understanding |
| Generate flags | sonnet-4 | Straightforward classification |
| Custom test data | sonnet-4 | Flexible JSON generation |
