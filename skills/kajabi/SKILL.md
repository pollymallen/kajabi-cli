---
name: kajabi
description: "Use this skill for ANY task involving Kajabi — pulling sales data, exporting contacts, checking revenue or MRR, viewing transactions, drafting email broadcasts, creating or updating blog posts, or checking subscriber/opt-in numbers. Trigger whenever the user mentions: Kajabi sales, revenue numbers, transaction history, contact list, subscriber export, email broadcast, blog post, opt-ins, page views, MRR, refunds, offers, or 'pull from Kajabi'. Also trigger for agentic workflows across revenue, marketing, or program delivery that need Kajabi data. Trigger even if the user doesn't say 'Kajabi' explicitly — if the context is AI Career Boost business data, this is almost certainly the right skill."
---

# Kajabi Skill

CLI for all Kajabi operations — data exports, email drafts, and blog post management. Uses direct API calls (fast, no browser required for data reads).

**CLI:** `kajabi` (available in PATH via plugin bin/)

---

## Safety Rules

Non-negotiable:

- **Emails and blog posts: draft-only.** Commands create drafts and open a browser for review. They never send, schedule, or publish automatically.
- **Data commands: read-only.** They never modify Kajabi records.
- **Auth: human-in-the-loop.** When session expires, a browser opens for manual login + 2FA.

---

## Setup & Config

First time? Run the interactive setup wizard:

```bash
kajabi setup
```

This prompts for site ID + email, then opens a browser to authenticate. Takes ~60 seconds.

Config lives at `~/.kajabi-cli/config.json`. View or manually set:

```bash
kajabi config                                        # View current config
kajabi config --site-id=YOUR_SITE_ID                 # Set site ID
kajabi config --site-id=XXX --email=you@example.com  # Set both
```

Or use environment variables:
```bash
KAJABI_SITE_ID=XXX KAJABI_EMAIL=you@example.com kajabi stats
```

---

## Commands — Data (read-only)

### Sales & Revenue

```bash
kajabi stats                                      # Quick stats + lifetime revenue (best starting point)
kajabi revenue --start=2026-03-01                 # Revenue report by date
kajabi revenue --export --start=2026-03-01        # Revenue export (triggers background job in Kajabi)
kajabi refunds --start=2026-03-01                 # Refunds report
kajabi mrr --start=2026-03-01                     # MRR over time
kajabi payments-by-offer --start=2026-03-01       # Revenue grouped by offer
```

### Transactions (per-purchase detail)

```bash
kajabi transactions --page=1                      # Single page (most recent 25)
kajabi transactions --period=90_days              # Adjust time window
kajabi transactions --all --start=2026-01-01      # All transactions since date
kajabi transactions --all --csv --output=txns.csv # Full export to CSV
kajabi transactions --all --json                  # Full export as JSON
```

CSV columns: `date, customer, email, offer, coupon, amount, currency, status, type`

### Offers & Products

```bash
kajabi offers                                     # All offers with revenue
kajabi offers-sold --start=2026-03-01             # Offers sold report
kajabi products                                   # All products
```

### Contacts & Segments

```bash
kajabi contacts --page=1                          # Contact list (paginated)
kajabi contacts --all --csv --output=contacts.csv # Full contact export
kajabi segments                                   # List all segments
```

CSV columns: `email, name, join_date, phone, subscribed, marketing_status, last_activity`

### Email Campaigns & Newsletter

```bash
kajabi emails --page=1                            # Email campaigns (all types)
kajabi emails --status=sent --all --csv           # All sent campaigns as CSV
kajabi emails --search="Blueprint"                # Search by title
kajabi newsletter                                 # Newsletter config
```

### Marketing Analytics

```bash
kajabi optins --start=2026-03-01                  # Opt-in report
kajabi pageviews --start=2026-03-01               # Page views report
```

### Site Info

```bash
kajabi site                                       # Site details
kajabi token                                      # Print current JWT (for debugging auth)
```

---

## Commands — Content Drafting

### Email Broadcasts (draft-only)

```bash
kajabi email-draft \
  --title="Internal title" \
  --subject="Subject line" \
  --body-file=path/to/body.html
```

Creates a broadcast draft, sets subject + body, then opens the browser to the edit page for review.

### Blog Posts (draft-only)

```bash
# Create a new draft
kajabi blog-draft \
  --title="Post Title" \
  --body-file=path/to/body.html \
  --slug=my-post-slug \
  --seo-title="SEO Title" \
  --seo-desc="Meta description" \
  --tags=tag1,tag2

# Update an existing post
kajabi blog-update --id=POST_ID --body-file=new-body.html
kajabi blog-update --id=POST_ID --title="Updated Title"
kajabi blog-update --id=POST_ID --publish    # only when explicitly approved

# List available tags
kajabi blog-tags
```

---

## Common Flags

| Flag | What it does |
|------|--------------|
| `--start=YYYY-MM-DD` | Start date for any report |
| `--end=YYYY-MM-DD` | End date (defaults to today) |
| `--all` | Fetch all pages |
| `--csv` | Output as CSV |
| `--output=FILE` | Write output to file |
| `--json` | Output as JSON (transactions) |
| `--page=N` | Specific page number |

---

## Auth Flow

JWT token is cached (~24h TTL) at `~/.kajabi-cli/token-cache.json`. Session cookies at `~/.kajabi-cli/session.json`.

When token expires:
1. CLI detects 401 and opens a visible Chromium browser
2. User logs in (email + password + 2FA)
3. CLI captures the JWT and caches it
4. Subsequent calls proceed without a browser

No credentials stored. Login required each time the session expires.
