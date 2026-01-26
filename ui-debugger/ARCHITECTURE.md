# UI Debugger - Architecture

## Overview

UI Debugger is an autonomous verification agent that bridges vibecoder-roundtable (planning) with actual UI testing.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    vibecoder-roundtable                      │
│                    (generates code + plan)                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ POST /api/hook/implementation
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      UI Debugger                             │
│                       Port: 3002                             │
├─────────────────────────────────────────────────────────────┤
│  Auto-Hook Layer:                                            │
│  - autoHook.ts: Webhook receiver, git watcher, file watcher  │
│  - Triggers verification on changes                          │
├─────────────────────────────────────────────────────────────┤
│  Verification Layer:                                         │
│  - verificationAgent.ts: Plan vs implementation check        │
│  - Generates test plan from code changes                     │
│  - Produces flags (critical/warning/info)                    │
├─────────────────────────────────────────────────────────────┤
│  UI Testing Layer:                                           │
│  - uiTester.ts: Playwright browser automation                │
│  - Claude translates steps to Playwright actions             │
│  - Screenshots at every step                                 │
├─────────────────────────────────────────────────────────────┤
│  Test Data Layer:                                            │
│  - testDataAgent.ts: CSV, JSON, users, products, images      │
│  - Auto-generates data for upload tests                      │
├─────────────────────────────────────────────────────────────┤
│  Build Pipeline:                                             │
│  - pipeline.ts: Build/test runner                            │
│  - analyzer.ts: Error analysis with Claude                   │
│  - git.ts: Snapshot, commit, rollback                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Playwright
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Target Application                        │
│                  (e.g., localhost:3000)                      │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **Trigger**: Webhook, git commit, or file change detected
2. **Verify**: Compare plan requirements to git diff
3. **Plan**: Generate test scenarios from changes
4. **Test**: Run Playwright against live app
5. **Flag**: Collect issues and report
6. **Fix**: Optionally run build pipeline to fix errors

## Key Files

### Core Modules
- `src/verificationAgent.ts` - Plan verification logic
- `src/uiTester.ts` - Playwright integration
- `src/testDataAgent.ts` - Test data generation
- `src/autoHook.ts` - Auto-triggering system
- `src/pipeline.ts` - Build/fix pipeline
- `src/analyzer.ts` - Error analysis with Claude

### Server
- `src/server.ts` - Express API + dashboard
- `src/dashboard.ts` - Web UI HTML
- `src/cli.ts` - Command line interface

### Support
- `src/git.ts` - Git operations
- `src/types.ts` - TypeScript interfaces

## Models Used

| Task | Model | Reason |
|------|-------|--------|
| Test plan generation | claude-opus-4-5 | Complex reasoning |
| Step translation | claude-sonnet-4 | Fast, accurate |
| Error analysis | claude-opus-4-5 | Deep understanding |
| Flag generation | claude-sonnet-4 | Cost-efficient |
| Custom data gen | claude-sonnet-4 | Flexible output |
