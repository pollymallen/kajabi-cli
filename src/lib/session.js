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
import { debug } from './debug.js';

const SESSION_PATH = path.join(KAJABI_CLI_DIR, 'session.json');
const TOKEN_CACHE_PATH = path.join(KAJABI_CLI_DIR, 'token-cache.json');
const KAJABI_BASE = 'https://app.kajabi.com';
const LOGIN_TIMEOUT_MS = 300_000; // 5 min for manual login + 2FA

/**
 * Check if the session cookies are fresh enough for API calls.
 */
export function isSessionFresh(sessionPath = SESSION_PATH) {
  if (!fs.existsSync(sessionPath)) {
    debug('session', 'No session file found', sessionPath);
    return false;
  }

  const data = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
  const cfCookie = data.cookies?.find(c => c.name === '__cf_bm' && c.domain?.includes('kajabi'));
  const sessionCookie = data.cookies?.find(c => c.name === '_kjb_session');

  if (!cfCookie || !sessionCookie) {
    debug('session', 'Missing cookies', { hasCf: !!cfCookie, hasKjbSession: !!sessionCookie });
    return false;
  }

  const cfExpires = cfCookie.expires * 1000;
  const remaining = cfExpires - Date.now();
  debug('session', `__cf_bm expires in ${Math.round(remaining / 1000)}s`);

  if (remaining < 120_000) {
    debug('session', 'Cloudflare cookie expiring soon — session stale');
    return false;
  }

  debug('session', 'Session is fresh');
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

    let interceptedToken = null;
    let interceptedRequestCount = 0;
    page.on('request', (req) => {
      const auth = req.headers()['authorization'];
      if (auth) {
        interceptedRequestCount++;
        debug('session', `Request #${interceptedRequestCount} with auth header → ${req.url().slice(0, 80)}`);
      }
      if (interceptedToken) return;
      if (auth && auth.startsWith('eyJ')) {
        interceptedToken = auth;
        debug('session', 'JWT intercepted from request header', `${auth.slice(0, 40)}...`);
      }
    });

    const targetUrl = `${KAJABI_BASE}/admin/sites/${getSiteId()}/dashboard`;
    debug('session', 'Navigating to', targetUrl);
    console.log('  Refreshing Kajabi session...');
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    }).catch((err) => {
      debug('session', 'Navigation error (may be OK — redirect expected)', err.message);
    });
    await page.waitForTimeout(3000);

    let url = page.url();
    debug('session', 'Landed on', url);

    if (url.includes('/admin/sites/')) {
      console.log('  Session refreshed (no login needed)');
    }

    // If we're on the login page (or anywhere else), wait for user to log in
    if (!url.includes('/admin/sites/')) {
      console.log('\n  --- SESSION EXPIRED — LOGIN REQUIRED ---');
      console.log('  Please log in with email, password, and 2FA in the browser.');
      console.log(`  Timeout: ${LOGIN_TIMEOUT_MS / 1000} seconds\n`);

      // Poll page.url() — waitForURL throws on intermediate HTTP errors in the
      // Auth0 → Cloudflare → Kajabi redirect chain.
      const deadline = Date.now() + LOGIN_TIMEOUT_MS;
      while (!page.url().includes('/admin')) {
        if (Date.now() >= deadline) {
          throw new Error('Login timeout — did not reach Kajabi admin within 5 minutes');
        }
        await page.waitForTimeout(1000);
      }
      await page.waitForTimeout(2000);
      console.log('  Login successful!');

      // Navigate to a content page to trigger SPA API calls for JWT capture
      await page.goto(`${KAJABI_BASE}/admin/sites/${getSiteId()}/email_campaigns`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      }).catch(() => {});
    }

    console.log('  Capturing JWT...');
    debug('session', 'Waiting 5s for SPA to bootstrap...');
    await page.waitForTimeout(5000);

    let token = await page.evaluate(() => window.validationToken).catch(() => null);
    debug('session', 'window.validationToken', token ? `${String(token).slice(0, 40)}...` : '(not set)');
    if (token && !token.startsWith('eyJ')) token = null;

    token = token || interceptedToken;
    debug('session', 'Token after first check', { fromWindow: !!token && token !== interceptedToken, fromInterceptor: !!interceptedToken });

    if (token) {
      console.log('  JWT captured');
    } else {
      console.log('  Waiting for SPA to initialize...');
      for (let i = 0; i < 10 && !token; i++) {
        await page.waitForTimeout(1000);
        token = await page.evaluate(() => window.validationToken).catch(() => null);
        debug('session', `Poll ${i + 1}/10 — window.validationToken:`, token ? 'found' : 'not set');
        if (token && !token.startsWith('eyJ')) token = null;
        token = token || interceptedToken;
      }

      if (token) {
        console.log('  JWT captured');
        debug('session', `Got token after ${10} polls`);
      } else {
        console.log('  Warning: Could not capture JWT. Run: node scripts/login-and-test.js');
        debug('session', 'FAILED — no JWT from window or interceptor', { interceptedRequestCount });
      }
    }

    // Save refreshed session
    await context.storageState({ path: sessionPath });
    console.log('  Session saved');

    if (token) {
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        const expiresAt = payload.exp * 1000;
        debug('session', 'JWT payload', {
          email: payload.email,
          userId: payload.id,
          expiresAt: new Date(expiresAt).toISOString(),
          ttlHours: Math.round((expiresAt - Date.now()) / 3600000 * 10) / 10,
        });
        fs.mkdirSync(path.dirname(TOKEN_CACHE_PATH), { recursive: true });
        fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify({
          token,
          expiresAt,
          email: payload.email,
          userId: payload.id,
          cachedAt: new Date().toISOString(),
        }, null, 2));
        console.log('  JWT token cached');
        debug('session', 'Token cached to', TOKEN_CACHE_PATH);
      } catch (err) {
        debug('session', 'Failed to cache token', err.message);
      }
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
