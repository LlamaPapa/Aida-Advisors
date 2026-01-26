# UI Debugger - Intent

## The Problem

AI writes code but doesn't verify it works. You end up:
- Manually testing every change
- Finding bugs after building more on top
- Creating test data by hand
- Going back and forth fixing issues that should have been caught

## The Solution

An agent that sits between "code generated" and "continue building" that:
- Checks if the code matches what was planned
- Actually runs the UI in a real browser
- Generates whatever test data is needed
- Flags issues before you waste time building more

## How It Fits

```
vibecoder-roundtable     →     ui-debugger     →     continue building
(plans + generates code)       (verifies it works)    (only if verified)
```

## Core Behavior

1. **Auto-trigger** - Don't wait for manual commands. Detect changes automatically.
2. **Plan-aware** - Know what was supposed to be built, not just "does it compile"
3. **Real browser** - Playwright, not unit tests. Click buttons, fill forms, see what happens.
4. **Generate data** - Need a CSV to upload? Users to test with? Generate them.
5. **Flag, don't block** - Report issues, let human decide what to do

## What Success Looks Like

After vibecoder finishes:
- UI Debugger runs automatically
- Tests the actual feature that was just built
- Reports: "3 tests passed, 1 warning: button doesn't respond on mobile"
- You fix before building the next thing

## What This Is NOT

- Not a replacement for human QA
- Not a unit test framework
- Not guaranteed to catch everything
- Not blocking - you can ignore and continue
