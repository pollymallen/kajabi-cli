/**
 * Session management — handles Cloudflare + Auth0 authentication.
 *
 * Kajabi's auth stack:
 *   1. Auth0 (id.kajabi.com) — IdP with MFA, issues session cookies
 *   2. Cloudflare (__cf_bm) — bot detection, ~30 min TTL, needs JS execution
 *   3. Rails (_kjb_session) — app session, tied to Auth0 session
 *   4. JWT — issued by the SPA, used for API calls, ~24h TTL
 *
 * When any layer expires, we need a visible browser (not headless — CF blocks it)
 * to re-authenticate. The user enters credentials + 2FA manually.
 *
 * Flow:
 *   1. ensureFreshSession() checks if cookies are fresh
 *   2. If stale, opens a visible browser to refresh (or re-login if Auth0 expired)
 *   3. Saves updated cookies for direct HTTP API calls
 *   4. Extracts fresh JWT from the authenticated page
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { getSiteId } from './config.js';
import { USER_AGENT, KAJABI_CLI_DIR } from './constants.js';

const SESSION_PATH = path.join(KAJABI_CLI_DIR, 'session.json');
const TOKEN_CACHE_PATH = path.join(KAJABI_CLI_DIR, 'token-cache.json');
const KAJABI_BASE = 'https://app.kajabi.com';
const LOGIN_TIMEOUT_MS = 300_000; // 5 min for manual login + 2FA

/**
 * Check if the session cookies are fresh enough for API calls.
 */
export function isSessionFresh(sessionPath = SESSION_PATH) {
  if (!fs.existsSync(sessionPath)) return false;

  const data = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
  const cfCookie = data.cookies?.find(c => c.name === '__cf_bm' && c.domain?.includes('kajabi'));
  const sessionCookie = data.cookies?.find(c => c.name === '_kjb_session');

  if (!cfCookie || !sessionCookie) return false;

  // __cf_bm must have at least 2 min remaining
  const cfExpires = cfCookie.expires * 1000;
  if (cfExpires < Date.now() + 120_000) return false;

  return true;
}

/**
 * Refresh session via a headed browser.
 * If Auth0 session is valid: takes ~5 seconds (no login needed).
 * If Auth0 expired: prompts for manual login + 2FA.
 * Returns the site ID on success.
 */
export async function refreshSession(sessionPath = SESSION_PATH) {
  const hasSession = fs.existsSync(sessionPath);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
  });

  try {
    const contextOptions = {
      viewport: { width: 1280, height: 900 },
    };
    if (hasSession) {
      contextOptions.storageState = sessionPath;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // Navigate directly to the site dashboard (not /admin, which is broken)
    console.log('  Refreshing Kajabi session...');
    await page.goto(`${KAJABI_BASE}/admin/sites/${getSiteId()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    }).catch(() => {});
    await page.waitForTimeout(3000);

    let url = page.url();

    if (url.includes('/admin/sites/')) {
      console.log('  Session refreshed (no login needed)');
    }

    // If we're on the login page (or anywhere else), wait for user to log in
    if (!url.includes('/admin/sites/')) {
      console.log('\n  --- SESSION EXPIRED — LOGIN REQUIRED ---');
      console.log('  Please log in with email, password, and 2FA in the browser.');
      console.log(`  Timeout: ${LOGIN_TIMEOUT_MS / 1000} seconds\n`);

      try {
        await page.waitForURL(/\/admin/, { timeout: LOGIN_TIMEOUT_MS, waitUntil: 'commit' });
      } catch (err) {
        // Intermediate redirects in the Auth0 → Cloudflare → Kajabi chain can
        // return HTTP error codes that Playwright surfaces as ERR_HTTP_RESPONSE_CODE_FAILURE.
        // If we actually landed on an admin page, ignore the error and continue.
        if (!page.url().includes('/admin')) throw err;
      }
      await page.waitForTimeout(3000);
      console.log('  Login successful!');
    }

    // Capture fresh JWT — two methods:
    // 1. Intercept authorization header from SPA API calls
    // 2. window.validationToken (set by SPA JS after page load)
    console.log('  Capturing JWT...');

    // Set up request interceptor
    let interceptedToken = null;
    page.on('request', (req) => {
      if (interceptedToken) return;
      const auth = req.headers()['authorization'];
      if (auth && auth.startsWith('eyJ')) {
        interceptedToken = auth;
      }
    });

    // We're already on the dashboard — just reload to trigger API calls
    // (Avoids a second page.goto which can fail with HTTP errors)
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(5000);

    // Check window.validationToken
    let token = await page.evaluate(() => window.validationToken).catch(() => null);
    if (token && !token.startsWith('eyJ')) token = null;

    // Use whichever method captured a token
    token = token || interceptedToken;

    if (token) {
      console.log('  JWT captured');
    } else {
      // Last resort: poll for up to 10 seconds
      console.log('  Waiting for SPA to initialize...');
      for (let i = 0; i < 10 && !token; i++) {
        await page.waitForTimeout(1000);
        token = await page.evaluate(() => window.validationToken).catch(() => null);
        if (token && !token.startsWith('eyJ')) token = null;
        token = token || interceptedToken;
      }

      if (token) {
        console.log('  JWT captured');
      } else {
        console.log('  Warning: Could not capture JWT. Run: node scripts/login-and-test.js');
      }
    }

    // Save refreshed session
    await context.storageState({ path: sessionPath });
    console.log('  Session saved');

    // Cache the JWT if we got one
    if (token) {
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        fs.mkdirSync(path.dirname(TOKEN_CACHE_PATH), { recursive: true });
        fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify({
          token,
          expiresAt: payload.exp * 1000,
          email: payload.email,
          userId: payload.id,
          cachedAt: new Date().toISOString(),
        }, null, 2));
        console.log('  JWT token cached');
      } catch {}
    }

    return true;
  } finally {
    await browser.close();
  }
}

/**
 * Ensure the session is fresh. Refresh if needed.
 * Call this before making API requests.
 */
export async function ensureFreshSession(sessionPath = SESSION_PATH) {
  if (isSessionFresh(sessionPath)) {
    return;
  }

  // Invalidate old token cache — it's tied to the expired session
  if (fs.existsSync(TOKEN_CACHE_PATH)) {
    fs.unlinkSync(TOKEN_CACHE_PATH);
  }

  await refreshSession(sessionPath);
}
