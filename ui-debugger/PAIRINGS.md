# UI Debugger - Pairings

Files that work together. Change one, check the other.

## Core Flow

```
autoHook.ts → verificationAgent.ts → uiTester.ts
```

When autoHook triggers, it calls verificationAgent.verify(), which calls uiTester.runUITests().

## Verification + UI Testing

`verificationAgent.ts` ↔ `uiTester.ts`
- verificationAgent generates TestPlan
- uiTester consumes TestPlan
- Both define scenario types (smoke, ui, integration)

## UI Testing + Test Data

`uiTester.ts` ↔ `testDataAgent.ts`
- uiTester imports generateCSV, generatePlaceholderImage
- When executeAction sees upload with generateFile, it calls testDataAgent
- Both need to agree on file types (csv, json, image, text)

## Build Pipeline

`pipeline.ts` ↔ `analyzer.ts`
- Pipeline calls analyzeFailure when build fails
- Analyzer returns DebugAnalysis with fix suggestions
- Pipeline uses analysis to construct fix prompt

`pipeline.ts` ↔ `git.ts`
- Pipeline calls createSnapshot before fixing
- Pipeline calls commitChanges after successful fix
- Pipeline uses getDiff to track what changed

## Server + Everything

`server.ts` imports:
- autoHook (webhook endpoints)
- verificationAgent (one-shot verify)
- pipeline (build/fix endpoints)
- dashboard (HTML)

## CLI + Everything

`cli.ts` imports:
- autoHook (daemon command)
- uiTester (ui-test, smoke commands)
- testDataAgent (test-data command)
- verificationAgent (verify command)
- pipeline (run, watch commands)

## Types

`types.ts` - Pipeline types (PipelineConfig, PipelineRun, FixAttempt)
`verificationAgent.ts` - Verification types (ImplementationPlan, TestPlan, VerificationResult)
`uiTester.ts` - UI types (UITestConfig, UITestResult, PlaywrightAction)
`testDataAgent.ts` - Data types (TestDataRequest, GeneratedTestData)

No shared types file between modules - each defines its own.

## External

vibecoder-roundtable:
- verificationAgent.fetchPlan() calls `/api/intent/status`
- autoHook.reportResults() calls `/api/debug/report`
