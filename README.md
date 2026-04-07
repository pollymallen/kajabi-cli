# kajabi

Ask Claude questions about your Kajabi business and get real answers — revenue, transactions, refunds, contacts, email stats, and more.

> **Unofficial plugin. Not affiliated with or endorsed by Kajabi.**

---

## What this does

Kajabi's built-in reporting is fine for quick glances, but it's slow to navigate and hard to slice. This plugin connects Claude to your Kajabi account so you can ask plain-English questions — "What was our MRR last quarter?" or "Export all refunds from this year" — and get answers without clicking through dashboards.

It covers the data Kajabi's official API doesn't: per-transaction detail, MRR trends, refund history, opt-in analytics, email campaign performance, and content drafting. Once you're set up, most queries run in seconds.

Everything is read-only by default. The only things that can create or change content in Kajabi are the draft commands, and those only create drafts — nothing gets published automatically.

---

## Install

### For Claude Code users

In Claude Code, run:

```
/plugin marketplace add pollymallen/kajabi-cli
```

That's it for the install. Then run setup once:

```bash
kajabi setup
```

### First-time setup

Setup takes about 60 seconds and walks you through two things:

**1. Your Kajabi site ID**

This is the number in the URL when you're logged into your Kajabi dashboard. Look at the address bar — you'll see something like `app.kajabi.com/admin/sites/123456789`. The number at the end is your site ID.

**2. Logging into Kajabi**

After you enter your site ID, a browser window will open and take you to the Kajabi login page. This is expected and safe. Kajabi uses security measures that require a real browser to log in — the plugin can't bypass that, so it uses your actual browser session instead.

Log in the same way you normally would: email, password, and 2FA if you have it enabled. Once you're logged in, the browser will close and you're done. From that point on, most commands run without opening a browser for about 24 hours. When the session expires, the browser will open briefly to refresh it.

---

## Privacy & safety

- Your Kajabi password is never stored anywhere. The plugin doesn't see it — you type it directly into the browser window that Kajabi controls.
- The only files saved to your computer are a session token (the same kind your browser holds when you're logged into Kajabi) and your site ID. These live in `~/.kajabi-cli/` on your machine.
- The plugin only ever contacts Kajabi's own servers (`app.kajabi.com`). Nothing goes to Anthropic, nothing goes to the plugin author, no usage data is collected.
- Full source code is open and readable: https://github.com/pollymallen/kajabi-cli

---

## What you can ask Claude

Once the plugin is installed and you're authenticated, just ask Claude naturally:

- "How much revenue did we make this month?"
- "What's our current MRR?"
- "Show me all refunds from this year"
- "Export all transactions from Q1 as a CSV"
- "What offers have brought in the most revenue?"
- "How many new contacts did we get last month?"
- "What's our opt-in rate been over the past 90 days?"
- "Show me email campaigns from the last 6 months"
- "Draft an email broadcast with the subject 'New program announcement'"
- "Create a blog post draft titled 'How to future-proof your career'"

Claude will use the plugin to pull the relevant data, then answer or format it however you ask.

---

## Using with Claude Desktop (Cowork)

The plugin works in the Cowork tab in Claude Desktop, but it needs to be installed separately there using the same `/plugin marketplace add pollymallen/kajabi-cli` command.

One thing to know about the browser login: the Kajabi auth flow (the browser window that opens during setup) needs a display to work — it can't run in the background. Run `kajabi setup` from Claude Code CLI or the Claude Desktop app first. Once you've authenticated, the session token is cached on your machine for about 24 hours, and any Cowork session running locally will use that cached token without needing the browser again.

---

## Commands reference

For times when you want to be specific about what you're asking for, here's the full set of available commands.

### Revenue & Transactions

| Command | What it does |
|---------|--------------|
| `kajabi stats` | Quick stats and lifetime revenue |
| `kajabi transactions --page=1` | Per-purchase detail (paginated) |
| `kajabi transactions --all --start=2026-01-01` | All transactions since a date |
| `kajabi transactions --all --csv --output=txns.csv` | Export to CSV |
| `kajabi payments-by-offer --start=2026-01-01` | Revenue broken down by offer |
| `kajabi revenue --start=2026-01-01` | Revenue report |
| `kajabi revenue --export` | Revenue export (triggers background job) |
| `kajabi refunds --start=2026-01-01` | Refunds |
| `kajabi mrr --start=2026-01-01` | MRR over time |

### Marketing & Contacts

| Command | What it does |
|---------|--------------|
| `kajabi offers` | All offers with revenue totals |
| `kajabi contacts --all --csv --output=contacts.csv` | Full contact export |
| `kajabi segments` | List segments |
| `kajabi emails --status=sent` | Email campaigns |
| `kajabi optins --start=2026-01-01` | Opt-in report |
| `kajabi pageviews --start=2026-01-01` | Page views |
| `kajabi offers-sold --start=2026-01-01` | Offers sold report |
| `kajabi newsletter` | Newsletter config |

### Content Drafting

These commands create drafts only — nothing is sent or published automatically.

| Command | What it does |
|---------|--------------|
| `kajabi email-draft --title="..." --subject="..." --body-file=body.html` | Create an email broadcast draft |
| `kajabi blog-draft --title="..." --body-file=body.html --slug=my-post` | Create a blog post draft |
| `kajabi blog-update --id=POST_ID --body-file=updated.html --publish` | Update and publish a blog post |
| `kajabi blog-tags` | List available blog tags |

### Config & Debug

| Command | What it does |
|---------|--------------|
| `kajabi setup` | Run the setup wizard |
| `kajabi config` | View current config |
| `kajabi config --site-id=XXX --email=you@example.com` | Set config manually |
| `kajabi token` | Print the current session token (for debugging) |
| `kajabi site` | Site info |
| `kajabi products` | List products |

### Common Options

| Flag | What it does |
|------|--------------|
| `--start=YYYY-MM-DD` | Start date for reports |
| `--end=YYYY-MM-DD` | End date for reports |
| `--all` | Fetch all pages (transactions, contacts, emails) |
| `--csv` | Output as CSV |
| `--output=FILE` | Write CSV to a file |
| `--json` | Output as JSON (transactions) |
| `--page=N` | Page number |

---

## Troubleshooting

**"kajabi-cli is not configured yet"** — Run `kajabi setup`.

**"No valid JWT token found"** — Run any command; a browser will open to refresh your login.

**Browser opens but auth fails** — Run `node scripts/login-and-test.js` for diagnostics.

**Browser doesn't open** — Run `npx playwright install chromium`.

---

## For developers (CLI usage)

The underlying tool is also available as a standalone CLI. If you want to use it directly, outside of Claude:

```bash
git clone https://github.com/pollymallen/kajabi-cli
cd kajabi-cli
npm install
npx playwright install chromium
npm link    # makes `kajabi` available as a global command
```

Then run `kajabi setup` and you're good to go from any terminal.

**Architecture notes:**
- Node.js ESM, native `fetch`, no axios
- Auth: JWT from `window.validationToken` + session cookies
- Token cache: `~/.kajabi-cli/token-cache.json` (~24h TTL)
- Playwright is used only for the session refresh (headed browser to bypass Cloudflare bot detection)

---

## Disclaimer

This tool uses Kajabi's internal admin API, which is not publicly documented and may change without notice. Use at your own risk. Not affiliated with or endorsed by Kajabi.
