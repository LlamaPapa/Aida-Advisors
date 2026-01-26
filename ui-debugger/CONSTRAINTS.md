# UI Debugger - Constraints

## Technical Constraints

### Runtime
- Node.js 18+ required
- TypeScript strict mode enabled
- ESM modules (type: "module" in package.json)

### Dependencies
- Playwright requires browser install: `npx playwright install chromium`
- Anthropic SDK requires ANTHROPIC_API_KEY
- Express 4.x for server

### Ports
- Server runs on port 3002 (configurable via PORT env)
- Must not conflict with vibecoder-roundtable (3010) or frontend (5180)

## Architectural Constraints

### API Design
- All webhook endpoints must handle missing fields gracefully
- Responses must be JSON
- Errors must return { error: string } format

### Model Usage
- Use Opus 4.5 only for complex reasoning (test plans, error analysis)
- Use Sonnet 4 for fast/cheap tasks (step translation, flags)
- Never use Opus where Sonnet suffices (cost control)

### Test Data
- Generated files go to `./test-data/` or configurable dir
- Screenshots go to `./screenshots/` or configurable dir
- Don't persist test data in git

### Git Integration
- Never force push
- Never auto-commit without explicit request
- Rollback commands are suggested, not executed

## Process Constraints

### Verification Flow
1. Always check plan first (if available)
2. Run smoke test before full UI tests
3. Collect all flags, don't stop on first error
4. Report back to roundtable if configured

### UI Testing
- Headless by default (configurable)
- Screenshot every step for debugging
- Timeout after 10s per action (configurable)
- Stop scenario on first failure

### Error Handling
- Never crash on Playwright errors (catch and flag)
- Never crash on missing plan (use fallback)
- Always return a result, even if partial

## What NOT to Do

1. **Don't auto-fix without permission** - Pipeline fixes require explicit autoFix flag
2. **Don't skip smoke test** - Always verify app loads first
3. **Don't use expensive models for simple tasks** - Sonnet for translation
4. **Don't store API keys in code** - Use .env only
5. **Don't commit screenshots/test-data** - Add to .gitignore
6. **Don't block on roundtable** - Work offline if roundtable unavailable
