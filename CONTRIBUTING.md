# Contributing

## How the CLI works

This CLI reverse-engineers Kajabi's internal admin API — the same endpoints the Kajabi web dashboard uses. There is no official documentation; the endpoints were discovered by intercepting XHR calls while navigating the dashboard.

**Key files:**
- `bin/kajabi.js` — CLI entry point, all commands
- `src/lib/client.js` — API client (all endpoint calls)
- `src/lib/auth.js` — JWT token management and extraction
- `src/lib/session.js` — Cloudflare/Auth0 session refresh via Playwright
- `src/lib/config.js` — Config file and env var handling
- `src/lib/constants.js` — Shared constants (user-agent, paths)

**Auth stack:**
1. Auth0 (id.kajabi.com) — IdP, issues session cookies
2. Cloudflare (`__cf_bm`) — bot detection, ~30 min TTL, requires a headed browser
3. Rails (`_kjb_session`) — app session
4. JWT (`window.validationToken`) — used for API calls, ~24h TTL

Because Cloudflare blocks headless browsers, session refresh requires a visible Chromium window.

## Discovering new endpoints

The `scripts/` directory contains tools for finding and verifying endpoints:

```bash
# Live interceptor — captures XHR calls while you navigate the dashboard
node scripts/api-interceptor.js

# Static analysis — extracts endpoints from Kajabi's JS bundles
node scripts/api-mapper.js

# Verify endpoints against the live API
node scripts/api-verifier.js

# Diagnostic login — captures a fresh JWT and tests it
node scripts/login-and-test.js
```

## Adding a new command

1. Add a method to `KajabiClient` in `src/lib/client.js`
2. Add a handler to the `COMMANDS` object in `bin/kajabi.js`
3. Update the help text in `main()` and the README

## Setup for development

```bash
git clone https://github.com/pollymallen/kajabi-cli
cd kajabi-cli
npm install
npx playwright install chromium
npm link

# Configure with your own Kajabi site
kajabi setup
```

## API stability

Kajabi's internal API is not publicly documented and endpoints can change without notice. If a command stops working:
1. Run the interceptor in manual mode to re-capture the endpoint
2. Update `src/lib/client.js`

## Pull requests

- Keep PRs focused — one feature or fix per PR
- Test against a real Kajabi account before submitting
- Add a CHANGELOG entry
