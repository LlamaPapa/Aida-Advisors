# UI Debugger - Constraints

## Must Do

### Before running UI tests
- Always run smoke test first (does the app even load?)
- Always set up screenshot directory
- Always collect console errors

### When using Claude
- Use Opus only for complex reasoning
- Use Sonnet for structured output and fast tasks
- Always handle API errors gracefully

### When writing files
- Generated test data goes to `./test-data/`
- Screenshots go to `./screenshots/`
- Never commit generated files

### When triggering from webhook
- Always validate projectRoot exists
- Handle missing plan gracefully (use fallback)
- Return useful error messages

## Must Not Do

### Git
- Never force push
- Never auto-commit without explicit flag
- Never modify git config

### Blocking
- Never block indefinitely waiting for vibecoder
- Never fail silently - always report something
- Never stop on first error - collect all flags

### Cost
- Never use Opus for simple classification
- Never make unnecessary API calls
- Never generate more test data than requested

### Security
- Never log API keys
- Never expose API keys in dashboard
- Never execute arbitrary code from webhooks

## Defaults

```
Port: 3002
Timeout: 10s per Playwright action
Debounce: 2s for file watcher
Git poll: 5s
Headless: true
Max fix attempts: 3
```

## Error Handling

| Situation | Response |
|-----------|----------|
| Playwright fails to launch | Flag as critical, don't crash |
| Plan not found | Use fallback plan, continue |
| Build fails | Run analyzer, suggest fix |
| API error | Retry once, then flag |
| Timeout | Flag as warning, continue |

## Ports

- ui-debugger: 3002
- vibecoder-roundtable backend: 3010
- vibecoder-roundtable frontend: 5180
- Your app: usually 3000

Don't use these ports for testing.
