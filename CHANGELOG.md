# Changelog

## v0.1.0 — 2026-04-01

Initial release.

### Commands
- `kajabi setup` — interactive first-run wizard: site ID, email, browser auth
- `kajabi stats` — quick sales stats + lifetime revenue
- `kajabi transactions` — per-purchase detail with date range, pagination, CSV export
- `kajabi payments-by-offer` — revenue grouped by offer
- `kajabi revenue` — revenue report with date range
- `kajabi refunds` — refunds report
- `kajabi mrr` — MRR over time
- `kajabi offers` / `offers-sold` — offer list and sales report
- `kajabi contacts` — contact list with full export to CSV
- `kajabi segments` — segment list
- `kajabi emails` — email campaign history with search and filter
- `kajabi optins` — opt-in report by form and landing page
- `kajabi pageviews` — page view report
- `kajabi newsletter` — newsletter config
- `kajabi email-draft` — create email broadcast draft, open in browser for review
- `kajabi blog-draft` / `blog-update` / `blog-tags` — blog post management
- `kajabi site` / `products` / `token` / `config` — utility commands

### Architecture
- Direct HTTP API calls — no browser automation for data reads
- JWT token cached at `~/.kajabi-cli/token-cache.json` (~24h TTL)
- Session stored at `~/.kajabi-cli/session.json`
- Playwright used only for session refresh (Cloudflare requires a headed browser)
- Config at `~/.kajabi-cli/config.json` or env vars (`KAJABI_SITE_ID`, `KAJABI_EMAIL`)
