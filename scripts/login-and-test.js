/**
 * Focused test: login → capture JWT → make API call → all in one browser.
 * Diagnoses exactly where the token capture fails.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SESSION_PATH = path.join(process.env.HOME, '.claude', 'skills', 'kajabi', '.kajabi-session.json');
const TOKEN_CACHE = path.join(process.env.HOME, '.kajabi-cli', 'token-cache.json');
const SITE_ID = process.env.KAJABI_SITE_ID;
if (!SITE_ID) {
  console.error('Error: KAJABI_SITE_ID environment variable required.\nRun: kajabi config  (then re-run with KAJABI_SITE_ID=$(kajabi config | grep siteId))');
  process.exit(1);
}
const BASE = 'https://app.kajabi.com';

async function main() {
  // Delete old token cache
  if (fs.existsSync(TOKEN_CACHE)) {
    fs.unlinkSync(TOKEN_CACHE);
    console.log('Deleted old token cache');
  }

  const hasSession = fs.existsSync(SESSION_PATH);
  console.log('Has saved session:', hasSession);

  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(hasSession ? { storageState: SESSION_PATH } : {}),
  });
  const page = await context.newPage();

  // Step 1: Navigate directly to site dashboard (not /admin, which is broken)
  console.log('\n--- Step 1: Navigate to site dashboard ---');
  await page.goto(`${BASE}/admin/sites/${SITE_ID}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  let url = page.url();
  console.log('Landed on:', url);

  // Step 2: Login if needed
  if (!url.includes('/admin/sites/')) {
    console.log('\n--- Step 2: Need login ---');
    console.log('Please log in with email + password + 2FA...');
    await page.waitForURL(/\/admin\/sites\//, { timeout: 300000 });
    url = page.url();
    console.log('After login:', url);
  } else {
    console.log('Session valid — no login needed');
  }

  // Save session immediately after login
  await context.storageState({ path: SESSION_PATH });
  console.log('Session saved');

  // Step 3: Wait for SPA to fully load
  console.log('\n--- Step 3: Wait for SPA ---');
  await page.waitForTimeout(5000);

  // Step 4: Try window.validationToken
  console.log('\n--- Step 4: Check window.validationToken ---');
  for (let i = 0; i < 10; i++) {
    const val = await page.evaluate(() => {
      return {
        validationToken: typeof window.validationToken,
        value: window.validationToken ? String(window.validationToken).slice(0, 30) : null,
      };
    });
    console.log(`  Attempt ${i+1}: type=${val.validationToken}, value=${val.value}`);
    if (val.value && val.value.startsWith('eyJ')) {
      console.log('  Found JWT!');
      break;
    }
    await page.waitForTimeout(1000);
  }

  const token = await page.evaluate(() => window.validationToken);
  console.log('\nwindow.validationToken:', token ? token.slice(0, 50) + '...' : 'NULL/UNDEFINED');

  if (!token) {
    // Check what IS on window
    console.log('\n--- Debugging: checking window properties ---');
    const windowKeys = await page.evaluate(() => {
      return Object.keys(window).filter(k =>
        k.toLowerCase().includes('token') ||
        k.toLowerCase().includes('auth') ||
        k.toLowerCase().includes('jwt') ||
        k.toLowerCase().includes('validation') ||
        k.toLowerCase().includes('user') ||
        k.toLowerCase().includes('session') ||
        k.toLowerCase().includes('kajabi')
      );
    });
    console.log('Relevant window keys:', windowKeys);

    // Check each one
    for (const key of windowKeys.slice(0, 15)) {
      const val = await page.evaluate((k) => {
        const v = window[k];
        if (typeof v === 'string') return v.slice(0, 60);
        if (typeof v === 'object') return JSON.stringify(v)?.slice(0, 100);
        return String(v);
      }, key);
      console.log(`  window.${key} = ${val}`);
    }
  }

  // Step 5: Intercept from a real API call
  console.log('\n--- Step 5: Intercept token from API call ---');
  let interceptedToken = null;

  page.on('request', (req) => {
    const auth = req.headers()['authorization'];
    if (auth && auth.startsWith('eyJ') && !interceptedToken) {
      interceptedToken = auth;
      console.log('  Intercepted JWT from:', new URL(req.url()).pathname);
    }
  });

  // Reload to trigger API calls
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const finalToken = token || interceptedToken;
  console.log('\nFinal token:', finalToken ? finalToken.slice(0, 50) + '...' : 'NONE');

  if (!finalToken) {
    console.log('\nFAILED to capture any JWT. Closing browser.');
    await browser.close();
    process.exit(1);
  }

  // Decode
  const payload = JSON.parse(Buffer.from(finalToken.split('.')[1], 'base64url').toString());
  console.log('JWT user:', payload.email, 'id:', payload.id);
  console.log('JWT expires:', new Date(payload.exp * 1000).toISOString());

  // Save session + token
  await context.storageState({ path: SESSION_PATH });

  fs.mkdirSync(path.dirname(TOKEN_CACHE), { recursive: true });
  fs.writeFileSync(TOKEN_CACHE, JSON.stringify({
    token: finalToken,
    expiresAt: payload.exp * 1000,
    email: payload.email,
    userId: payload.id,
    cachedAt: new Date().toISOString(),
  }, null, 2));
  console.log('Token cached');

  // Step 6: Test API call from Node (outside browser)
  console.log('\n--- Step 6: Test direct API call ---');
  const sess = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf-8'));
  const cookies = sess.cookies
    .filter(c => 'app.kajabi.com'.includes(c.domain.replace(/^\./, '')) || '.kajabi.com' === c.domain)
    .map(c => `${c.name}=${c.value}`)
    .join('; ');

  const res = await fetch(`${BASE}/api/dashboard/lifetime_net_revenue?site_id=${SITE_ID}`, {
    headers: {
      authorization: finalToken,
      accept: 'application/json',
      cookie: cookies,
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    },
  });
  console.log('API status:', res.status);
  if (res.status === 200) {
    const data = await res.json();
    console.log('Response:', JSON.stringify(data));
    console.log('\nSUCCESS — CLI should now work!');
  } else {
    console.log('Response:', await res.text().then(t => t.slice(0, 200)));
    console.log('\nFAILED — API rejected the token+cookies combo');
  }

  await browser.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
