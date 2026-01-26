# UI Debugger - Intent

## Purpose

UI Debugger is a **proactive verification agent** that tests implementations before you continue building.

## Problem Statement

When using AI coding assistants:
- Code is generated but not tested against the original plan
- UI issues aren't caught until manual testing
- Build errors require back-and-forth debugging
- Test data (CSVs, users, images) must be created manually
- No automatic verification loop

## Solution

An autonomous agent that:
1. **Reads the plan** from vibecoder-roundtable
2. **Checks implementation** against plan requirements
3. **Runs UI tests** with Playwright in real browser
4. **Generates test data** on demand (CSV, JSON, users, images)
5. **Flags issues** before you build more
6. **Auto-fixes** build errors with Claude

## Core Principles

### 1. Verification First
Every implementation should be verified against:
- The original plan (mustHave, mustNot)
- Actual UI behavior (does it work?)
- Console errors (no crashes)

### 2. Automation Over Manual
- Auto-trigger on git commits
- Auto-generate test data
- Auto-translate test steps to Playwright
- Auto-fix build errors

### 3. Feedback Loop (Boris's #13)
> "To get great results from Claude Code, give Claude a way to verify its work."

This tool IS the verification feedback loop.

## Success Criteria

A verification pass when:
- [ ] Implementation matches plan requirements
- [ ] App loads without critical errors
- [ ] UI tests pass
- [ ] No critical flags raised

## Non-Goals

- This tool does NOT write application code
- This tool does NOT replace human judgment on UX
- This tool does NOT guarantee 100% coverage
