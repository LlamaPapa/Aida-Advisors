# UI Debugger - Pairings

## File Pairings

These files work together and should be considered as a unit when making changes.

### Core Verification Flow
- `src/autoHook.ts` ↔ `src/verificationAgent.ts`
  - AutoHook triggers verification, passes plan
- `src/verificationAgent.ts` ↔ `src/uiTester.ts`
  - Verification generates test plan, UI tester executes it

### UI Testing
- `src/uiTester.ts` ↔ `src/testDataAgent.ts`
  - UI tester calls test data agent for upload actions
- `src/uiTester.ts` ↔ `src/verificationAgent.ts` (types)
  - Shares TestPlan and VerificationResult types

### Build Pipeline
- `src/pipeline.ts` ↔ `src/analyzer.ts`
  - Pipeline calls analyzer when build fails
- `src/pipeline.ts` ↔ `src/git.ts`
  - Pipeline uses git for snapshots and rollbacks

### Server
- `src/server.ts` ↔ `src/autoHook.ts`
  - Server exposes webhook endpoints that use AutoHook
- `src/server.ts` ↔ `src/dashboard.ts`
  - Server serves dashboard HTML
- `src/server.ts` ↔ `src/pipeline.ts`
  - Server exposes pipeline run endpoints

### CLI
- `src/cli.ts` ↔ `src/autoHook.ts`
  - CLI daemon command uses AutoHook
- `src/cli.ts` ↔ `src/uiTester.ts`
  - CLI ui-test/smoke commands use uiTester
- `src/cli.ts` ↔ `src/testDataAgent.ts`
  - CLI test-data command uses testDataAgent

## Module Dependencies

```
cli.ts
  ├── autoHook.ts
  │     └── verificationAgent.ts
  │           └── uiTester.ts
  │                 └── testDataAgent.ts
  ├── pipeline.ts
  │     ├── analyzer.ts
  │     └── git.ts
  ├── uiTester.ts
  └── testDataAgent.ts

server.ts
  ├── autoHook.ts
  ├── verificationAgent.ts
  ├── pipeline.ts
  └── dashboard.ts
```

## Type Dependencies

- `src/types.ts` - Pipeline types (PipelineConfig, PipelineRun, etc.)
- `src/verificationAgent.ts` - Verification types (ImplementationPlan, TestPlan, etc.)
- `src/uiTester.ts` - UI test types (UITestConfig, UITestResult, etc.)
- `src/testDataAgent.ts` - Data types (TestDataRequest, GeneratedTestData)

## External Dependencies

### vibecoder-roundtable
- Fetches plan from `/api/intent/status`
- Reports results to `/api/debug/report`

### Playwright
- Used by uiTester.ts for browser automation
- Requires: `npx playwright install chromium`

### Anthropic SDK
- Used by: verificationAgent, uiTester, testDataAgent, analyzer
- Requires: ANTHROPIC_API_KEY env var
