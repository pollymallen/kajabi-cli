# kajabi-cli

Unofficial CLI for Kajabi. Reverse-engineered from Kajabi's internal admin API — not affiliated with Kajabi.

## Why this exists

Kajabi launched an [official public API](https://developers.kajabi.com/) in 2024/2025, but it's limited in scope (contacts, products, webhooks) and gated behind a paid add-on. It doesn't cover the data most operators actually need day-to-day: per-transaction revenue detail, MRR trends, opt-in analytics, email campaign history, or programmatic content drafting.

This CLI accesses Kajabi's internal admin API — the same endpoints the web dashboard uses — to fill that gap. It replaces slow, brittle browser automation with direct API calls.

**What the official API covers:** contacts, products, members, webhooks
**What this CLI covers:** transactions, revenue, MRR, refunds, offers, contacts, segments, email campaigns, opt-ins, page views, email broadcast drafting, blog post management

## Requirements

- Node.js 18+
- Chromium (for session refresh): `npx playwright install chromium`

## Install

```bash
git clone https://github.com/pollymallen/kajabi-cli
cd kajabi-cli
npm install
npx playwright install chromium
npm link          # makes `kajabi` available globally
```

## First-time setup

```bash
kajabi setup
```

This prompts for your site ID and email, then opens a browser to authenticate. Takes about 60 seconds. Re-run any time to update config or re-authenticate.

**Finding your site ID:** Log into Kajabi and look at the URL — it's the number in `/admin/sites/XXXXXXX`.

Or configure manually:

```bash
kajabi config --site-id=YOUR_SITE_ID --email=you@example.com
```

Or with environment variables (useful for scripts):

```bash
export KAJABI_SITE_ID=YOUR_SITE_ID
export KAJABI_EMAIL=you@example.com
```

## Auth

Kajabi uses Auth0 + Cloudflare bot detection, which requires a real browser for login. The CLI handles this automatically:

1. First run opens a visible Chromium browser
2. Log in with your Kajabi email, password, and 2FA
3. The CLI captures the JWT token and caches it (~24h TTL)
4. Subsequent calls use the cached token — no browser needed

When the token expires, the browser opens again. Your credentials are never stored.

## Commands

### Revenue & Transactions

```bash
kajabi stats                                      # Quick stats + lifetime revenue
kajabi transactions --page=1                      # Per-purchase detail (paginated)
kajabi transactions --all --start=2026-01-01      # All transactions since date
kajabi transactions --all --csv --output=txns.csv # Export to CSV
kajabi payments-by-offer --start=2026-01-01       # Revenue by offer
kajabi revenue --start=2026-01-01                 # Revenue report
kajabi revenue --export                           # Revenue export (triggers background job)
kajabi refunds --start=2026-01-01                 # Refunds
kajabi mrr --start=2026-01-01                     # MRR over time
```

### Marketing & Contacts

```bash
kajabi offers                                     # All offers with revenue
kajabi contacts --all --csv --output=contacts.csv # Full contact export
kajabi segments                                   # List segments
kajabi emails --status=sent                       # Email campaigns
kajabi optins --start=2026-01-01                  # Opt-in report
kajabi pageviews --start=2026-01-01               # Page views
kajabi offers-sold --start=2026-01-01             # Offers sold report
kajabi newsletter                                 # Newsletter config
```

### Content Drafting (draft-only — never sends or publishes automatically)

```bash
# Email broadcast
kajabi email-draft \
  --title="Internal title" \
  --subject="Subject line" \
  --body-file=body.html

# Blog post
kajabi blog-draft \
  --title="Post Title" \
  --body-file=body.html \
  --slug=my-post \
  --seo-title="SEO Title" \
  --tags=tag1,tag2

kajabi blog-update --id=POST_ID --body-file=updated.html --publish
kajabi blog-tags
```

### Config & Debug

```bash
kajabi setup                                      # First-time setup wizard
kajabi config                                     # View current config
kajabi config --site-id=XXX --email=you@ex.com   # Set config
kajabi token                                      # Print current JWT (debug)
kajabi site                                       # Site info
kajabi products                                   # List products
```

## Common Options

| Flag | Description |
|------|-------------|
| `--start=YYYY-MM-DD` | Start date for reports |
| `--end=YYYY-MM-DD` | End date for reports |
| `--all` | Fetch all pages (transactions, contacts, emails) |
| `--csv` | Output as CSV |
| `--output=FILE` | Write CSV to file |
| `--json` | Output as JSON (transactions) |
| `--page=N` | Page number |

## Architecture

- **Node.js ESM** — native `fetch`, no axios
- **Auth:** JWT from `window.validationToken` + session cookies
- **Token cache:** `~/.kajabi-cli/token-cache.json` (~24h TTL)
- **Session store:** `~/.kajabi-cli/session.json`
- **Playwright:** used only for session refresh (headed browser to bypass Cloudflare bot detection)

## Using with Claude Code / Cowork

Most commands work anywhere Claude Code runs. The exception is the auth flow: `kajabi setup` and session refresh open a headed Chromium browser for login + 2FA, which requires a display.

- **Claude Code CLI / Desktop app (local):** fully supported — the browser opens on your machine as normal
- **Claude Desktop Cowork tab:** fully supported — Dispatch-spawned Code sessions run locally
- **Remote or headless environments:** auth will fail (no display for the browser). Run `kajabi setup` locally first to cache the session, then use the cached token in remote environments

Once authenticated, the token is cached for ~24 hours. Most commands don't need the browser at all during that window.

## Troubleshooting

**"kajabi-cli is not configured yet"** — run `kajabi setup`

**"No valid JWT token found"** — run any command; a browser will open for login

**Browser opens but auth fails** — run `node scripts/login-and-test.js` for diagnostics

**"Cannot find module"** — run `npm install && npm link`

**Browser doesn't open** — run `npx playwright install chromium`

## Disclaimer

This tool uses Kajabi's internal admin API, which is not publicly documented and may change without notice. Use at your own risk. Not affiliated with or endorsed by Kajabi.
