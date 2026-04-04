/**
 * Kajabi API Interceptor
 *
 * Uses an existing Playwright session to intercept all XHR/fetch requests
 * while automatically navigating through key Kajabi admin pages.
 * Captures endpoints, methods, headers, request/response shapes.
 *
 * Usage:
 *   node scripts/api-interceptor.js
 *   node scripts/api-interceptor.js --pages=reports,blog,emails
 *   node scripts/api-interceptor.js --manual  (just opens browser, you navigate)
 *
 * Output: docs/api-discovery.json — all captured API calls
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const SESSION_FILE = path.join(
  process.env.HOME, '.claude', 'skills', 'kajabi', '.kajabi-session.json'
);
const OUTPUT_FILE = path.join(PROJECT_ROOT, 'docs', 'api-discovery.json');
const KAJABI_BASE = 'https://app.kajabi.com';

// Pages to crawl for API discovery
const DISCOVERY_PAGES = {
  dashboard: '/admin/sites/{siteId}',
  reports: '/admin/sites/{siteId}/reports',
  grossRevenue: '/admin/sites/{siteId}/reports/gross_revenue_over_time',
  refunds: '/admin/sites/{siteId}/reports/refunds_over_time',
  offerPurchases: '/admin/sites/{siteId}/reports/offer_purchases_over_time',
  paymentsByOffer: '/admin/sites/{siteId}/reports/payments_by_offer',
  offersSold: '/admin/sites/{siteId}/reports/offers_sold_report',
  pageViews: '/admin/sites/{siteId}/reports/page_views_report',
  contacts: '/admin/sites/{siteId}/contacts',
  emailCampaigns: '/admin/sites/{siteId}/email_campaigns',
  posts: '/admin/sites/{siteId}/posts',         // blog posts
  products: '/admin/sites/{siteId}/products',
  offers: '/admin/sites/{siteId}/offers',
  pages: '/admin/sites/{siteId}/site_pages',     // landing pages
  settings: '/admin/sites/{siteId}/settings',
  automations: '/admin/sites/{siteId}/automations',
};

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > -1) {
        args[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else {
        args[arg.slice(2)] = true;
      }
    }
  }
  return args;
}

function isApiCall(url) {
  const u = new URL(url);
  // Filter out tracking, analytics, and static asset requests
  const skipDomains = [
    'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
    'facebook.net', 'facebook.com', 'linkedin.com', 'bing.com',
    'clarity.ms', 'mountain.com', 'px.mountain.com', 'stripe.com',
    'braze.com', 'braze.eu', 'segment.io', 'segment.com',
    'intercom.io', 'intercomcdn.com', 'pendo.io',
    'wistia.com', 'wistia.net', 'fast.wistia.net',
    'filepicker.io', 'filestackapi.com',
    'cloudflare.com', 'cloudflareinsights.com',
    'amplitude.com', 'rudderstack.com',
    'datadoghq.com', 'datadoghq.eu',
    'sentry.io', 'fullstory.com',
    'fonts.googleapis.com', 'fonts.gstatic.com',
  ];
  if (skipDomains.some(d => u.hostname.includes(d))) return false;

  // Skip static assets
  const skipExtensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf'];
  if (skipExtensions.some(ext => u.pathname.endsWith(ext))) return false;

  // Skip kajabi CDN (static assets)
  if (u.hostname.includes('kajabi-cdn.com')) return false;
  if (u.hostname.includes('kajabi-storefronts-production')) return false;

  // Keep anything on app.kajabi.com or api.kajabi.com
  if (u.hostname.includes('kajabi.com')) return true;

  return false;
}

function summarizeBody(body, maxLen = 500) {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    const summary = JSON.stringify(parsed, null, 2);
    return summary.length > maxLen ? summary.slice(0, maxLen) + '...(truncated)' : summary;
  } catch {
    // Not JSON — might be form data or binary
    if (body.length > maxLen) return body.slice(0, maxLen) + '...(truncated)';
    return body;
  }
}

function extractApiHeaders(headers) {
  // Keep only headers relevant to API calls
  const keep = [
    'content-type', 'accept', 'x-csrf-token', 'x-requested-with',
    'authorization', 'x-kajabi', 'x-site-id', 'x-api-version',
    'x-newrelic', 'turbo-frame', 'turbolinks-referrer',
  ];
  const result = {};
  for (const [k, v] of Object.entries(headers)) {
    if (keep.some(h => k.toLowerCase().includes(h))) {
      result[k] = v;
    }
  }
  return result;
}

const LOGIN_TIMEOUT_MS = 300_000; // 5 min for manual login + 2FA

async function loginFlow(page, context) {
  console.log('Session expired or missing — starting manual login flow.');
  console.log('Opening Kajabi login page...\n');

  await page.goto('https://app.kajabi.com/login', { timeout: 30000 });

  // Wait for login form to appear
  await page.waitForSelector(
    'input#username, input[name="username"], input[type="password"], input[type="email"], form[method="post"]',
    { timeout: 15000 }
  ).catch(() => {
    console.log('Login form not detected automatically — please log in manually.');
  });

  console.log('--- WAITING FOR YOU TO LOG IN ---');
  console.log('Enter your email, password, and 2FA code in the browser.');
  console.log(`Timeout: ${LOGIN_TIMEOUT_MS / 1000} seconds\n`);

  await page.waitForURL(/\/admin/, { timeout: LOGIN_TIMEOUT_MS });
  console.log('Login successful!\n');

  // Save session for future runs
  await context.storageState({ path: SESSION_FILE });
  console.log(`Session saved to ${SESSION_FILE}\n`);

  // Wait for redirect to site-specific URL
  await page.waitForTimeout(3000);
}

async function main() {
  const args = parseArgs();

  const hasSession = fs.existsSync(SESSION_FILE);

  console.log(hasSession
    ? 'Launching browser with saved Kajabi session...\n'
    : 'No saved session found — will prompt for login.\n'
  );

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
  });

  const contextOptions = {
    viewport: { width: 1280, height: 900 },
  };
  if (hasSession) {
    contextOptions.storageState = SESSION_FILE;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  // Captured API calls
  const apiCalls = [];
  let callIndex = 0;

  // Intercept all requests
  page.on('request', request => {
    const url = request.url();
    if (!isApiCall(url)) return;

    const method = request.method();
    // Skip simple page navigations (GET for HTML)
    const headers = request.headers();
    const isXHR = headers['x-requested-with'] === 'XMLHttpRequest'
      || headers['accept']?.includes('application/json')
      || headers['content-type']?.includes('application/json')
      || headers['turbo-frame']
      || method !== 'GET'
      || url.includes('.json')
      || url.includes('/api/');

    if (!isXHR) return;

    const entry = {
      index: callIndex++,
      timestamp: new Date().toISOString(),
      method,
      url: url,
      pathname: new URL(url).pathname,
      query: new URL(url).search || undefined,
      requestHeaders: extractApiHeaders(headers),
      requestBody: summarizeBody(request.postData()),
      status: null,
      responseHeaders: {},
      responseBody: null,
      responseSize: null,
      page: page.url(),
    };

    apiCalls.push(entry);
  });

  page.on('response', async response => {
    const url = response.url();
    if (!isApiCall(url)) return;

    // Find matching request entry
    const entry = [...apiCalls].reverse().find(e => e.url === url && e.status === null);
    if (!entry) return;

    entry.status = response.status();
    entry.responseHeaders = extractApiHeaders(response.headers());

    try {
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('json') || contentType.includes('text')) {
        const body = await response.text().catch(() => null);
        if (body) {
          entry.responseSize = body.length;
          entry.responseBody = summarizeBody(body, 1000);
        }
      }
    } catch {
      // Response body not available (redirects, etc.)
    }
  });

  // Navigate to site dashboard to check session (Kajabi redirects to the right site)
  const initialPath = process.env.KAJABI_SITE_ID
    ? `/admin/sites/${process.env.KAJABI_SITE_ID}`
    : '/admin';
  console.log('Navigating to dashboard...');
  await page.goto(`${KAJABI_BASE}${initialPath}`, {
    waitUntil: 'domcontentloaded', timeout: 30000
  }).catch(() => {});
  await page.waitForTimeout(3000);

  let siteMatch = page.url().match(/\/admin\/sites\/(\d+)/);

  // If we didn't land on an admin/sites page, session is expired — trigger login
  if (!siteMatch) {
    await loginFlow(page, context);
    siteMatch = page.url().match(/\/admin\/sites\/(\d+)/);

    if (!siteMatch) {
      console.error('Could not detect site ID after login. Check the browser.');
      await browser.close();
      process.exit(1);
    }
  } else {
    // Session was valid — re-save to extend it
    await context.storageState({ path: SESSION_FILE });
  }

  const siteId = siteMatch[1];
  console.log(`Site ID: ${siteId}\n`);

  if (args.manual) {
    // Manual mode — user navigates, we just capture
    console.log('=== MANUAL MODE ===');
    console.log('Navigate around Kajabi in the browser. All API calls are being captured.');
    console.log('Press Ctrl+C when done.\n');

    process.on('SIGINT', async () => {
      console.log(`\nCaptured ${apiCalls.length} API calls.`);
      saveResults(apiCalls);
      await browser.close();
      process.exit(0);
    });

    await new Promise(() => {}); // Wait forever
  }

  // Automated discovery — visit each page
  const pagesToVisit = args.pages
    ? args.pages.split(',')
    : Object.keys(DISCOVERY_PAGES);

  for (const pageName of pagesToVisit) {
    const pathTemplate = DISCOVERY_PAGES[pageName];
    if (!pathTemplate) {
      console.log(`Unknown page: ${pageName}, skipping`);
      continue;
    }

    const pagePath = pathTemplate.replace('{siteId}', siteId);
    const fullUrl = `${KAJABI_BASE}${pagePath}`;

    console.log(`--- ${pageName} ---`);
    console.log(`  ${fullUrl}`);

    const beforeCount = apiCalls.length;

    try {
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Give the SPA time to make its API calls
      await page.waitForTimeout(4000);

      // On report pages, try clicking into the first report link if on index
      if (pageName === 'reports') {
        // Just the index page — individual reports are separate entries
      }

      // On email campaigns, try to peek at the list API
      if (pageName === 'emailCampaigns') {
        await page.waitForTimeout(2000);
      }

      // On posts page, try to capture the posts list API
      if (pageName === 'posts') {
        await page.waitForTimeout(2000);
      }

      const newCalls = apiCalls.length - beforeCount;
      console.log(`  Captured ${newCalls} API calls\n`);

    } catch (err) {
      console.log(`  Error: ${err.message}\n`);
    }
  }

  // Try some actions that trigger interesting APIs
  console.log('--- Triggering export on gross revenue page ---');
  try {
    const revenueUrl = `${KAJABI_BASE}/admin/sites/${siteId}/reports/gross_revenue_over_time`;
    await page.goto(revenueUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Dismiss modals
    const closeModal = page.locator('button:has-text("Close Modal"), button:has-text("Not now")');
    for (let i = 0; i < await closeModal.count(); i++) {
      const btn = closeModal.nth(i);
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(500);
      }
    }

    // Click export to capture the export API call
    const exportBtn = page.locator('button:has-text("Export"), a:has-text("Export")').first();
    if (await exportBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const beforeExport = apiCalls.length;
      await exportBtn.click();
      await page.waitForTimeout(5000);
      console.log(`  Captured ${apiCalls.length - beforeExport} export-related calls\n`);
    }
  } catch (err) {
    console.log(`  Export capture error: ${err.message}\n`);
  }

  // Try navigating to a single blog post's edit page if any exist
  console.log('--- Checking blog post editor APIs ---');
  try {
    await page.goto(`${KAJABI_BASE}/admin/sites/${siteId}/posts`, {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await page.waitForTimeout(3000);

    const firstPost = page.locator('a[href*="/posts/"]').first();
    if (await firstPost.isVisible({ timeout: 3000 }).catch(() => false)) {
      const beforePost = apiCalls.length;
      await firstPost.click();
      await page.waitForTimeout(4000);
      console.log(`  Captured ${apiCalls.length - beforePost} blog post detail calls\n`);
    } else {
      console.log('  No blog posts found\n');
    }
  } catch (err) {
    console.log(`  Blog post error: ${err.message}\n`);
  }

  // Try navigating to email broadcast creation
  console.log('--- Checking email broadcast creation APIs ---');
  try {
    await page.goto(`${KAJABI_BASE}/admin/sites/${siteId}/email_campaigns`, {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await page.waitForTimeout(3000);

    const newBtn = page.locator('a:has-text("New Email Campaign"), a:has-text("New email campaign")').first();
    if (await newBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const beforeEmail = apiCalls.length;
      await newBtn.click();
      await page.waitForTimeout(4000);
      console.log(`  Captured ${apiCalls.length - beforeEmail} email creation calls\n`);
    }
  } catch (err) {
    console.log(`  Email creation error: ${err.message}\n`);
  }

  console.log(`\n=== DISCOVERY COMPLETE ===`);
  console.log(`Total API calls captured: ${apiCalls.length}`);

  saveResults(apiCalls);

  console.log('\nClosing browser...');
  await browser.close();
}

function saveResults(apiCalls) {
  // Deduplicate by method+pathname (keep first occurrence with full details)
  const seen = new Map();
  for (const call of apiCalls) {
    const key = `${call.method} ${call.pathname}`;
    if (!seen.has(key)) {
      seen.set(key, call);
    } else {
      // Merge: keep the one with a response body if the other doesn't have one
      const existing = seen.get(key);
      if (!existing.responseBody && call.responseBody) {
        seen.set(key, call);
      }
    }
  }

  const output = {
    discoveredAt: new Date().toISOString(),
    totalCalls: apiCalls.length,
    uniqueEndpoints: seen.size,
    endpoints: [...seen.values()].sort((a, b) => a.pathname.localeCompare(b.pathname)),
    allCalls: apiCalls,
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${OUTPUT_FILE}`);
  console.log(`Unique endpoints: ${seen.size}`);

  // Print summary
  console.log('\n--- ENDPOINT SUMMARY ---');
  for (const [key, call] of seen) {
    const status = call.status || '???';
    console.log(`  ${status} ${key}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
