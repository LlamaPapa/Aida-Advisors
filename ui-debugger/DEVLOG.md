# UI Debugger - Development Log

## 2026-01-26

### Auto-Hook Integration
- Built autoHook.ts for automatic triggering
- Webhook endpoint for vibecoder-roundtable integration
- Git post-commit hook support (auto-installs)
- File watcher with debouncing
- Daemon CLI command for continuous monitoring
- Server endpoints: `/api/hook/start`, `/api/hook/implementation`, etc.

### Test Data Agent
- Built testDataAgent.ts for automated data generation
- Supports CSV, JSON, users, products, images, custom
- 20+ field types: name, email, phone, address, price, etc.
- Claude generates custom data from descriptions
- Integrated with UI tester: auto-generates files for uploads

### Playwright Integration
- Built uiTester.ts for real browser testing
- Claude translates natural language steps to Playwright actions
- Smoke test: verify app loads
- Full test suite: run scenarios from test plan
- Screenshots captured at every step
- Console errors collected and flagged

### Verification Agent
- Built verificationAgent.ts for plan verification
- Fetches plan from vibecoder-roundtable API
- Compares git diff to plan requirements
- Generates test scenarios with Claude
- Produces flags: critical, warning, info

### Renamed from debug-pipeline
- Renamed folder from debug-pipeline to ui-debugger
- Updated package name to @aida/ui-debugger
- Updated CLI binary name

## Architecture Decisions

### Trigger System
- Webhook-first: vibecoder calls us after code gen
- Git watcher: polls every 5s for new commits
- File watcher: debounced, ignores node_modules/dist

### Model Selection
- Opus 4.5 for complex reasoning (test plans, error analysis)
- Sonnet 4 for fast tasks (step translation, flag generation)
- Cost-efficient: avoid Opus where Sonnet suffices

### Test Data Strategy
- Generate on demand, not pre-create
- Schema-based: flexible field types
- Upload actions auto-generate files

## Ports

- Server/Dashboard: 3002
