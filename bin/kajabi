#!/usr/bin/env node

/**
 * kajabi-cli — Unofficial Kajabi CLI
 *
 * Usage:
 *   kajabi revenue [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
 *   kajabi revenue --export [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
 *   kajabi stats
 *   kajabi offers
 *   kajabi contacts [--page=N]
 *   kajabi segments
 *   kajabi emails [--page=N] [--status=scheduled|sent|draft]
 *   kajabi newsletter
 *   kajabi refunds [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
 *   kajabi optins [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
 *   kajabi pageviews [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
 *   kajabi offers-sold [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
 *   kajabi mrr [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
 *   kajabi site
 *   kajabi token     (print current JWT for debugging)
 */

import readline from 'readline';
import { createRequire } from 'module';
import { getToken, loadSession, buildCookieHeader } from '../src/lib/auth.js';
import { KajabiClient } from '../src/lib/client.js';
import { refreshSession, isSessionFresh } from '../src/lib/session.js';
import { showConfig, saveConfig, getConfig } from '../src/lib/config.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

// Short flag → long flag mapping (value flags take the next argument as their value)
const SHORT_FLAGS = {
  '-s': 'start',
  '-e': 'end',
  '-o': 'output',
  '-p': 'page',
  '-h': 'help',
  '-V': 'version',
};
const SHORT_FLAGS_BOOLEAN = new Set(['-h', '-V']);

function parseArgs() {
  const args = { _: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > -1) {
        args[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else {
        args[arg.slice(2)] = true;
      }
    } else if (SHORT_FLAGS[arg]) {
      const key = SHORT_FLAGS[arg];
      if (SHORT_FLAGS_BOOLEAN.has(arg)) {
        args[key] = true;
      } else {
        args[key] = argv[++i]; // consume next arg as value
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function print(data) {
  if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

function dateRange(args) {
  return {
    startDate: args.start || args['start-date'] || undefined,
    endDate: args.end || args['end-date'] || undefined,
  };
}

function csvEscape(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

async function outputCsv(header, rows, args) {
  const csv = [header, ...rows].join('\n');
  if (args.output) {
    const fs = await import('fs');
    fs.writeFileSync(args.output, csv);
    console.error(`Written to ${args.output}`);
  } else {
    console.log(csv);
  }
}

const COMMANDS = {
  async revenue(client, args) {
    if (args.export) {
      const data = await client.exportRevenue(dateRange(args));
      print(data);
    } else {
      const data = await client.getRevenueReport(dateRange(args));
      if (args.csv) {
        const header = 'date,count,amount,currency';
        const rows = (data.results || []).map(r =>
          `${r.date?.slice(0, 10)},${r.count},${r.amount},${r.currency}`
        );
        await outputCsv(header, rows, args);
      } else {
        print(data);
      }
    }
  },

  async stats(client) {
    const [sales, lifetime] = await Promise.all([
      client.getSalesStats(),
      client.getLifetimeRevenue(),
    ]);
    print({
      salesStats: sales.stats,
      lifetimeRevenue: lifetime,
    });
  },

  async offers(client) {
    const data = await client.getOffers();
    print(data);
  },

  async contacts(client, args) {
    if (args.all) {
      const allContacts = [];
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const data = await client.getContacts({ page });
        totalPages = data.total_pages || 1;
        allContacts.push(...(data.contacts || []));
        if (page === 1) console.error(`Fetching contacts (${totalPages} pages)...`);
        page++;
      }
      console.error(`  Done — ${allContacts.length} contacts`);

      if (args.csv) {
        const header = 'email,name,join_date,phone,subscribed,marketing_status,last_activity';
        const rows = allContacts.map(c =>
          [c.email, csvEscape(c.name), c.join_date?.slice(0, 10), c.phone_number, c.subscribed, c.marketing_status, c.last_activity_at?.slice(0, 10)].join(',')
        );
        await outputCsv(header, rows, args);
      } else {
        print(allContacts);
      }
    } else {
      const data = await client.getContacts({ page: args.page });
      if (args.csv) {
        const header = 'email,name,join_date,phone,subscribed,marketing_status,last_activity';
        const rows = (data.contacts || []).map(c =>
          [c.email, csvEscape(c.name), c.join_date?.slice(0, 10), c.phone_number, c.subscribed, c.marketing_status, c.last_activity_at?.slice(0, 10)].join(',')
        );
        await outputCsv(header, rows, args);
      } else {
        print(data);
      }
    }
  },

  async segments(client) {
    const data = await client.getSegments();
    print(data);
  },

  async emails(client, args) {
    if (args.all) {
      const allEmails = [];
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const data = await client.getEmailCampaigns({
          page,
          status: args.status || '',
          search: args.search || '',
        });
        totalPages = data.total_pages || 1;
        allEmails.push(...(data.email_campaigns || []));
        if (page === 1) console.error(`Fetching emails (${totalPages} pages)...`);
        page++;
      }
      console.error(`  Done — ${allEmails.length} email campaigns`);

      if (args.csv) {
        const header = 'id,title,status,type,folder';
        const rows = allEmails.map(e =>
          [e.id, csvEscape(e.title), e.status, e.emailable_type, csvEscape(e.folder_name || '')].join(',')
        );
        await outputCsv(header, rows, args);
      } else {
        print(allEmails);
      }
    } else {
      const data = await client.getEmailCampaigns({
        page: parseInt(args.page) || 1,
        status: args.status || '',
        search: args.search || '',
      });
      if (args.csv) {
        const header = 'id,title,status,type,folder';
        const rows = (data.email_campaigns || []).map(e =>
          [e.id, csvEscape(e.title), e.status, e.emailable_type, csvEscape(e.folder_name || '')].join(',')
        );
        await outputCsv(header, rows, args);
      } else {
        print(data);
      }
    }
  },

  async newsletter(client) {
    const data = await client.getNewsletter();
    print(data);
  },

  async refunds(client, args) {
    const data = await client.getRefundsReport(dateRange(args));
    if (args.csv) {
      const header = 'date,count,amount,currency';
      const rows = (data.results || []).map(r =>
        `${r.date?.slice(0, 10)},${r.count},${r.amount},${r.currency}`
      );
      await outputCsv(header, rows, args);
    } else {
      print(data);
    }
  },

  async optins(client, args) {
    const data = await client.getOptInsReport(dateRange(args));
    if (args.csv) {
      const header = 'date,count,forms,landing_pages';
      const rows = (data.by_date || []).filter(d => d.count > 0).map(d =>
        `${d.start_date},${d.count},${(d.forms || []).map(f => csvEscape(f.title)).join(';')},${(d.landing_pages || []).map(p => csvEscape(p.title)).join(';')}`
      );
      await outputCsv(header, rows, args);
    } else {
      print(data);
    }
  },

  async pageviews(client, args) {
    const data = await client.getPageViewsReport(dateRange(args));
    if (args.csv) {
      const header = 'date,views';
      const rows = (data.by_date || data.results || []).map(d =>
        `${d.start_date || d.date?.slice(0, 10)},${d.count || d.views || 0}`
      );
      await outputCsv(header, rows, args);
    } else {
      print(data);
    }
  },

  async 'offers-sold'(client, args) {
    const data = await client.getOffersSoldReport(dateRange(args));
    if (args.csv) {
      const header = 'date,purchases,revenue,first_purchases,offers';
      const rows = (data.by_date || []).filter(d => d.purchase_count > 0).map(d =>
        `${d.start_date},${d.purchase_count},${d.revenue},${d.first_purchases},${(d.offers || []).map(o => csvEscape(o.title)).join(';')}`
      );
      await outputCsv(header, rows, args);
    } else {
      print(data);
    }
  },

  async mrr(client, args) {
    const data = await client.getMrrOverTime(dateRange(args));
    if (args.csv) {
      const header = 'date,gross_mrr,coupon_discount,net_mrr,currency';
      const rows = (data.results || []).map(r =>
        `${r.date?.slice(0, 10)},${r.grossMrrAmount},${r.couponDiscountAmount},${r.netMrrAmount},${r.currency}`
      );
      await outputCsv(header, rows, args);
    } else {
      print(data);
    }
  },

  async site(client) {
    const data = await client.getSite();
    print(data);
  },

  async products(client) {
    const data = await client.getProducts();
    print(data);
  },

  // ─── Transactions ───

  async transactions(client, args) {
    const txArgs = {
      inTheLast: args.period || '30_days',
      offerId: args.offer,
      status: args.status,
    };

    // Exact date range: --start and --end
    if (args.start || args.end) {
      txArgs.startDate = args.start;
      txArgs.endDate = args.end || new Date().toISOString().slice(0, 10);
      if (!txArgs.startDate) {
        console.error('--start is required when using date range');
        process.exit(1);
      }
    }

    // --all: fetch every page
    if (args.all) {
      const allTx = [];
      let page = 1;
      let pageCount = 1;
      while (page <= pageCount) {
        const data = await client.getTransactions({ ...txArgs, page });
        pageCount = data.pageCount;
        allTx.push(...(data.paymentTransactions || []));
        if (page === 1) {
          console.error(`Fetching ${data.itemsTotalCount} transactions (${pageCount} pages)...`);
        }
        page++;
      }
      console.error(`  Done — ${allTx.length} transactions`);

      if (args.csv) {
        // CSV output
        const header = 'date,customer,email,offer,coupon,amount,currency,status,type';
        const rows = allTx.map(tx => {
          const date = tx.createdAt?.slice(0, 10) || '';
          const name = (tx.memberName || '').replace(/"/g, '""');
          const email = tx.memberEmail || '';
          const offer = (tx.offerTitle || '').replace(/"/g, '""');
          const coupon = tx.couponCode || '';
          return `${date},"${name}",${email},"${offer}",${coupon},${tx.amount},${tx.currency},${tx.statusLabel},${tx.purchaseTypeLabel}`;
        });
        const csv = [header, ...rows].join('\n');

        if (args.output) {
          const fs = await import('fs');
          fs.writeFileSync(args.output, csv);
          console.error(`  Written to ${args.output}`);
        } else {
          console.log(csv);
        }
      } else if (args.json) {
        console.log(JSON.stringify(allTx, null, 2));
      } else {
        for (const tx of allTx) {
          console.log(`  ${tx.createdAt?.slice(0, 10)}  ${tx.memberName} <${tx.memberEmail}>`);
          console.log(`    ${tx.offerTitle}`);
          console.log(`    $${tx.amount} ${tx.currency} — ${tx.statusLabel} — ${tx.purchaseTypeLabel}${tx.couponCode ? ` (coupon: ${tx.couponCode})` : ''}`);
          console.log();
        }
      }
      return;
    }

    // Single page
    const data = await client.getTransactions({ ...txArgs, page: parseInt(args.page) || 1 });

    if (args.json) {
      print(data);
    } else {
      console.log(`Transactions (page ${data.currentPage}/${data.pageCount}, ${data.itemsTotalCount} total)\n`);
      for (const tx of data.paymentTransactions || []) {
        console.log(`  ${tx.memberName} <${tx.memberEmail}>`);
        console.log(`    ${tx.offerTitle}`);
        console.log(`    $${tx.amount} ${tx.currency} — ${tx.statusLabel} — ${tx.purchaseTypeLabel}${tx.couponCode ? ` (coupon: ${tx.couponCode})` : ''}`);
        console.log();
      }
    }
  },

  async 'payments-by-offer'(client, args) {
    const data = await client.getPaymentsByOffer(dateRange(args));
    if (args.csv) {
      const header = 'offer,count,gross_revenue,currency';
      const rows = (data.results || []).map(r =>
        `${csvEscape(r.offerTitle)},${r.count},${r.grossRevenueAmount},${r.currency}`
      );
      await outputCsv(header, rows, args);
    } else {
      print(data);
    }
  },

  // ─���─ Blog Posts ───

  async 'blog-draft'(client, args) {
    const title = args.title;
    const bodyFile = args['body-file'] || args.body;
    const slug = args.slug;
    const seoTitle = args['seo-title'];
    const seoDesc = args['seo-desc'];
    const tags = args.tags;

    if (!title) {
      console.error('Usage: kajabi blog-draft --title="Post Title" [--body-file=path/to/body.html] [--slug=my-post] [--seo-title=...] [--seo-desc=...] [--tags=tag1,tag2]');
      process.exit(1);
    }

    let content = '';
    if (bodyFile) {
      const fs = await import('fs');
      if (!fs.existsSync(bodyFile)) {
        console.error(`Body file not found: ${bodyFile}`);
        process.exit(1);
      }
      content = fs.readFileSync(bodyFile, 'utf-8');
    }

    console.log(`Creating blog post: "${title}"...`);
    const postId = await client.createBlogPost({
      title,
      content,
      slug,
      pageTitle: seoTitle || title,
      pageDescription: seoDesc || '',
      tags,
    });
    console.log(`  Created post #${postId}`);

    const editUrl = `https://app.kajabi.com/admin/sites/${client.siteId}/blog_posts/${postId}/edit`;
    console.log(`\n  Draft created! Edit: ${editUrl}`);

    if (args.open !== false) {
      const { exec } = await import('child_process');
      exec(`open "${editUrl}"`);
      console.log('  Opened in browser for review.');
    }
  },

  async 'blog-update'(client, args) {
    const id = args.id || args._[1];
    if (!id) {
      console.error('Usage: kajabi blog-update --id=POST_ID [--title=...] [--body-file=...] [--slug=...] [--seo-title=...] [--seo-desc=...] [--tags=...] [--publish]');
      process.exit(1);
    }

    const updates = {};
    if (args.title) updates.title = args.title;
    if (args.slug) updates.slug = args.slug;
    if (args['seo-title']) updates.pageTitle = args['seo-title'];
    if (args['seo-desc']) updates.pageDescription = args['seo-desc'];
    if (args.tags) updates.tags = args.tags;
    if (args.publish) updates.publishedMode = 'published';
    if (args.unpublish) updates.publishedMode = 'unpublished';

    const bodyFile = args['body-file'] || args.body;
    if (bodyFile) {
      const fs = await import('fs');
      if (!fs.existsSync(bodyFile)) {
        console.error(`Body file not found: ${bodyFile}`);
        process.exit(1);
      }
      updates.content = fs.readFileSync(bodyFile, 'utf-8');
    }

    console.log(`Updating blog post #${id}...`);
    await client.updateBlogPost(id, updates);
    console.log('  Updated');
  },

  async 'blog-tags'(client) {
    const data = await client.getBlogTags();
    print(data);
  },

  // ─── Email Drafting ───

  async 'email-draft'(client, args) {
    const title = args.title;
    const subject = args.subject;
    const bodyFile = args['body-file'] || args.body;

    if (!title) {
      console.error('Usage: kajabi email-draft --title="Internal title" --subject="Subject line" --body-file=path/to/body.html');
      process.exit(1);
    }

    // Step 1: Create broadcast
    console.log(`Creating broadcast: "${title}"...`);
    const broadcastId = await client.createEmailBroadcast(title);
    console.log(`  Created broadcast #${broadcastId}`);

    // Step 2: Update with subject + body if provided
    const updateFields = {};
    if (subject) updateFields.subject = subject;
    if (bodyFile) {
      const fs = await import('fs');
      if (!fs.existsSync(bodyFile)) {
        console.error(`Body file not found: ${bodyFile}`);
        process.exit(1);
      }
      updateFields.body = fs.readFileSync(bodyFile, 'utf-8');
    }

    if (Object.keys(updateFields).length > 0) {
      console.log('  Setting subject + body...');
      await client.updateEmailBroadcast(broadcastId, { title, ...updateFields });
      console.log('  Content saved');
    }

    // Step 3: Open browser for review + schedule
    const sendUrl = `https://app.kajabi.com/admin/email_broadcasts/${broadcastId}/send`;
    const editUrl = `https://app.kajabi.com/admin/email_broadcasts/${broadcastId}/edit`;

    console.log(`\n  Draft created! Next steps:`);
    console.log(`  Edit:     ${editUrl}`);
    console.log(`  Schedule: ${sendUrl}`);

    if (args.open !== false) {
      const { exec } = await import('child_process');
      exec(`open "${editUrl}"`);
      console.log('\n  Opened in browser for review.');
    }
  },

  async token() {
    const token = await getToken();
    console.log(token);
    // Decode and show expiry
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      const exp = new Date(payload.exp * 1000);
      console.error(`\nEmail: ${payload.email}`);
      console.error(`User ID: ${payload.id}`);
      console.error(`Expires: ${exp.toISOString()} (${exp > new Date() ? 'valid' : 'EXPIRED'})`);
    } catch {}
  },

  async setup() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(resolve => rl.question(q, resolve));

    console.log('\nkajabi-cli setup\n');

    // Show current config so re-running setup is non-destructive
    const current = getConfig();

    const siteIdPrompt = current.siteId
      ? `Site ID [${current.siteId}]: `
      : 'Site ID (find it in your Kajabi URL — app.kajabi.com/admin/sites/XXXXXXX): ';
    const siteIdInput = (await ask(siteIdPrompt)).trim();
    const siteId = siteIdInput || current.siteId;

    if (!siteId) {
      console.error('\nSite ID is required. Find it in your Kajabi admin URL.');
      rl.close();
      process.exit(1);
    }

    const emailPrompt = current.email
      ? `Kajabi account email [${current.email}]: `
      : 'Kajabi account email (optional — used to find report emails in Gmail): ';
    const emailInput = (await ask(emailPrompt)).trim();
    const email = emailInput || current.email || null;

    rl.close();

    const saved = saveConfig({ siteId, ...(email && { email }) });
    console.log('\nConfig saved:');
    console.log(`  siteId: ${saved.siteId}`);
    if (saved.email) console.log(`  email:  ${saved.email}`);

    console.log('\nOpening browser to authenticate with Kajabi...');
    console.log('Log in with your email, password, and 2FA when prompted.\n');

    await refreshSession();

    // Verify it worked
    try {
      const token = await getToken();
      const session = loadSession();
      const cookieHeader = buildCookieHeader(session.cookies);
      const client = new KajabiClient(token, { csrfToken: session.csrfToken, cookieHeader });
      const stats = await client.getLifetimeRevenue();
      console.log(`\nAuthenticated successfully!`);
      if (stats?.amount !== undefined) {
        console.log(`  Lifetime revenue: $${stats.amount.toLocaleString()}`);
      }
      console.log('\nRun "kajabi stats" to get started.\n');
    } catch {
      console.log('\nSetup complete. Run "kajabi stats" to verify.\n');
    }
  },

  async config(_client, args) {
    const hasUpdates = args['site-id'] || args.email;
    if (hasUpdates) {
      const updates = {};
      if (args['site-id']) updates.siteId = args['site-id'];
      if (args.email) updates.email = args.email;
      const saved = saveConfig(updates);
      console.log('Config saved:');
      if (saved.siteId) console.log(`  siteId: ${saved.siteId}`);
      if (saved.email) console.log(`  email:  ${saved.email}`);
    } else {
      const cfg = showConfig();
      console.log(`Config file: ${cfg.configFile}`);
      console.log(`  siteId: ${cfg.siteId} ${cfg.siteIdSource}`);
      console.log(`  email:  ${cfg.email} ${cfg.emailSource}`);
    }
  },
};

async function main() {
  const args = parseArgs();
  const command = args._[0];

  if (args.version) {
    console.log(`kajabi-cli v${version}`);
    return;
  }

  if (!command || args.help) {
    console.log(`kajabi-cli — Unofficial Kajabi CLI

Usage:
  kajabi <command> [options]

First time? Run:
  kajabi setup

Commands:
  setup            Interactive first-run setup: configure site ID + authenticate
  transactions     Per-purchase detail: customer, offer, amount, status, coupon
                   (--start= --end=, --all, --csv, --output=file.csv, --json)
                   (--page=N, --period=30_days|90_days|12_months, --offer=ID)
  payments-by-offer  Revenue grouped by offer (--start/--end, --csv)
  revenue          Revenue report (--start/--end, --csv, --export)
  refunds          Refunds report (--start/--end, --csv)
  offers-sold      Offers sold report (--start/--end, --csv)
  optins           Opt-in report (--start/--end, --csv)
  pageviews        Page views report (--start/--end, --csv)
  mrr              MRR over time (--start/--end, --csv)
  stats            Quick sales stats + lifetime revenue
  offers           List all offers with revenue
  products         List all products
  contacts         Contact list (--page=N, --all, --csv, --output=)
  segments         List all segments
  emails           Email campaigns (--page=N, --all, --csv, --status=, --search=)
  blog-draft       Create blog post draft + open in browser
                   (--title= --body-file= --slug= --seo-title= --seo-desc= --tags=)
  blog-update      Update an existing blog post
                   (--id= --title= --body-file= --slug= --publish --unpublish)
  blog-tags        List available blog tags
  email-draft      Create email broadcast draft + open in browser
                   (--title= --subject= --body-file=path/to/body.html)
  newsletter       Newsletter config
  site             Site info
  token            Print current JWT token (debug)
  config           View or set configuration
                   (--site-id=XXXXXXX --email=you@example.com)

Options:
  -s, --start=YYYY-MM-DD   Start date for reports (default: 30 days ago)
  -e, --end=YYYY-MM-DD     End date for reports (default: today)
  -o, --output=FILE        Write CSV to file instead of stdout
  -p, --page=N             Page number
      --csv                Output as CSV instead of JSON
      --all                Fetch all pages (transactions, contacts, emails)
  -h, --help               Show this help
  -V, --version            Show version`);
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.error('Run "kajabi --help" for available commands.');
    process.exit(1);
  }

  // Special cases: commands that don't need an authenticated client
  if (command === 'setup') {
    await handler();
    return;
  }
  if (command === 'token') {
    await handler();
    return;
  }
  if (command === 'config') {
    await handler(null, args);
    return;
  }

  // Guard: if not configured, direct to setup instead of cryptic error
  try {
    const { siteId } = getConfig();
    if (!siteId) {
      console.error('kajabi-cli is not configured yet.\nRun: kajabi setup\n');
      process.exit(1);
    }
  } catch {
    console.error('kajabi-cli is not configured yet.\nRun: kajabi setup\n');
    process.exit(1);
  }

  try {
    // Check if JWT and session cookies are both fresh before making any API calls
    let token, session, cookieHeader, client;
    let needsRefresh = false;

    try {
      token = await getToken();       // throws if JWT missing or expired
      if (!isSessionFresh()) needsRefresh = true;
    } catch {
      needsRefresh = true;
    }

    if (needsRefresh) {
      console.error('Session expired — refreshing (browser will open)...');
      await refreshSession();
      token = await getToken();
    }

    session = loadSession();
    cookieHeader = buildCookieHeader(session.cookies);
    client = new KajabiClient(token, {
      csrfToken: session.csrfToken,
      cookieHeader,
    });

    await handler(client, args);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
