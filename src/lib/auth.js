/**
 * Auth module — extracts JWT and CSRF tokens from Playwright session file.
 *
 * Kajabi uses:
 *   - JWT (HS512) in `authorization` header — email + userId + exp
 *   - `_csrf_token` cookie for mutating requests
 *   - `_kjb_session` cookie (Rails session, httpOnly)
 *
 * The JWT is NOT stored directly in cookies — it's issued by the SPA at runtime.
 * But we can extract a working session by making an initial request with the
 * session cookies and capturing the JWT from the SPA bootstrap.
 */

import fs from 'fs';
import path from 'path';
import { getSiteId } from './config.js';
import { USER_AGENT, KAJABI_CLI_DIR } from './constants.js';

const DEFAULT_SESSION_PATH = path.join(KAJABI_CLI_DIR, 'session.json');
const TOKEN_CACHE_PATH = path.join(KAJABI_CLI_DIR, 'token-cache.json');

/**
 * Load cookies from Playwright session file.
 * Returns { cookies, csrfToken, sessionCookie } or throws.
 */
export function loadSession(sessionPath = DEFAULT_SESSION_PATH) {
  if (!fs.existsSync(sessionPath)) {
    throw new Error(
      `Session file not found: ${sessionPath}\n` +
      'Run the API interceptor first to create a session:\n' +
      '  node scripts/api-interceptor.js'
    );
  }

  const raw = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
  const cookies = raw.cookies || [];

  const csrfCookie = cookies.find(c => c.name === '_csrf_token');
  const sessionCookie = cookies.find(c => c.name === '_kjb_session');

  if (!sessionCookie) {
    throw new Error('No _kjb_session cookie found. Session may be expired — re-login needed.');
  }

  return {
    cookies,
    csrfToken: csrfCookie?.value || null,
    sessionCookie: sessionCookie.value,
    allCookies: cookies,
  };
}

/**
 * Build a cookie header string from Playwright cookies for a given domain.
 */
export function buildCookieHeader(cookies, domain = 'app.kajabi.com') {
  return cookies
    .filter(c => domain.includes(c.domain.replace(/^\./, '')))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

/**
 * Fetch a JWT token by hitting the Kajabi admin with session cookies.
 * The SPA bootstrap response includes a meta tag or inline script with the token.
 */
export async function fetchJwtToken(session) {
  // First check token cache
  const cached = loadTokenCache();
  if (cached?.token && cached?.expiresAt > Date.now()) {
    return cached.token;
  }

  const cookieHeader = buildCookieHeader(session.cookies);

  // Hit the admin page to get the HTML with embedded token
  const response = await fetch('https://app.kajabi.com/admin', {
    headers: {
      'cookie': cookieHeader,
      'accept': 'text/html,application/xhtml+xml',
      'user-agent': USER_AGENT,
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch admin page: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  // Extract JWT from page — Kajabi embeds it in a meta tag or script
  // Pattern 1: meta tag
  let token = extractFromMeta(html);
  // Pattern 2: inline script with token assignment
  if (!token) token = extractFromScript(html);
  // Pattern 3: data attribute
  if (!token) token = extractFromDataAttr(html);

  if (!token) {
    // Fallback: try making an API call with just cookies to see if the server
    // returns the token in a response header
    token = await fetchTokenFromApi(cookieHeader);
  }

  if (!token) {
    throw new Error(
      'Could not extract JWT token from Kajabi admin page.\n' +
      'The page structure may have changed. Try running the interceptor in manual mode\n' +
      'to capture a fresh token: node scripts/api-interceptor.js --manual'
    );
  }

  // Cache the token
  saveTokenCache(token);

  return token;
}

function extractFromMeta(html) {
  // Look for meta tags with JWT-like content
  const metaPatterns = [
    /name="api[_-]token"\s+content="([^"]+)"/i,
    /name="auth[_-]token"\s+content="([^"]+)"/i,
    /name="csrf[_-]token"\s+content="([^"]+)"/i,
  ];
  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    if (match && match[1].includes('.')) return match[1];
  }
  return null;
}

function extractFromScript(html) {
  // Look for JWT assignment in inline scripts
  const patterns = [
    /["']authorization["']\s*:\s*["'](eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)["']/,
    /token\s*[=:]\s*["'](eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)["']/i,
    /jwt\s*[=:]\s*["'](eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)["']/i,
    /apiToken\s*[=:]\s*["'](eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)["']/i,
    /(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractFromDataAttr(html) {
  const match = html.match(/data-(?:api-)?token="(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)"/);
  return match?.[1] || null;
}

async function fetchTokenFromApi(cookieHeader) {
  // Try hitting a known API endpoint with cookies — some APIs return tokens in headers
  try {
    const res = await fetch('https://app.kajabi.com/admin/settings/analytics', {
      headers: {
        'cookie': cookieHeader,
        'accept': 'application/json',
        'user-agent': USER_AGENT,
      },
    });

    // Check response headers for token
    const authHeader = res.headers.get('authorization');
    if (authHeader) return authHeader;

    // Check response body
    const body = await res.text();
    const match = body.match(/(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]+)/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function loadTokenCache() {
  try {
    if (fs.existsSync(TOKEN_CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf-8'));
    }
  } catch {}
  return null;
}

function saveTokenCache(token) {
  try {
    // Decode JWT to get expiry
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString()
    );
    const expiresAt = (payload.exp || 0) * 1000;

    fs.mkdirSync(path.dirname(TOKEN_CACHE_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify({
      token,
      expiresAt,
      email: payload.email,
      userId: payload.id,
      cachedAt: new Date().toISOString(),
    }, null, 2));
  } catch {}
}

/**
 * Validate a token against the live API. Returns true if it works.
 */
export async function validateToken(token, cookieHeader) {
  try {
    const res = await fetch(
      `https://app.kajabi.com/api/dashboard/lifetime_net_revenue?site_id=${getSiteId()}`,
      {
        headers: {
          authorization: token,
          accept: 'application/json',
          cookie: cookieHeader || '',
          'user-agent': USER_AGENT,
        },
      }
    );
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Get a working auth token — checks cache only.
 * The token is populated by ensureFreshSession() in session.js.
 * We do NOT fall back to stale discovery file tokens — those may be
 * server-invalidated even if their JWT exp timestamp hasn't passed.
 */
export async function getToken(sessionPath) {
  // Check token cache (populated by session refresh)
  const cached = loadTokenCache();
  if (cached?.token && cached?.expiresAt > Date.now()) {
    return cached.token;
  }

  throw new Error(
    'No valid JWT token found.\n' +
    'Run: kajabi stats (it will open a browser to refresh your session)'
  );
}
