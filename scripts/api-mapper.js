/**
 * Kajabi API Mapper — Static analysis of frontend JS bundles
 *
 * Downloads the Kajabi admin HTML, extracts all JS bundle URLs,
 * downloads them, and greps for API endpoint patterns.
 *
 * This finds ALL endpoints defined in the code, not just the ones
 * that fire during a single page load.
 *
 * Usage:
 *   node scripts/api-mapper.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadSession, buildCookieHeader } from '../src/lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const BUNDLES_DIR = path.join(PROJECT_ROOT, 'docs', 'bundles');
const OUTPUT_FILE = path.join(PROJECT_ROOT, 'docs', 'api-map.json');

const KAJABI_BASE = 'https://app.kajabi.com';

async function fetchWithCookies(url, cookies) {
  const cookieHeader = buildCookieHeader(cookies);
  const res = await fetch(url, {
    headers: {
      'cookie': cookieHeader,
      'accept': '*/*',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.text();
}

function extractScriptUrls(html) {
  const urls = new Set();
  // <script src="...">
  const scriptPattern = /<script[^>]+src="([^"]+)"/g;
  let match;
  while ((match = scriptPattern.exec(html))) {
    urls.add(match[1]);
  }
  // Preload/prefetch links to JS
  const linkPattern = /<link[^>]+href="([^"]+\.js[^"]*)"/g;
  while ((match = linkPattern.exec(html))) {
    urls.add(match[1]);
  }
  return [...urls];
}

function extractApiEndpoints(jsCode, sourceFile) {
  const endpoints = [];

  // Patterns that indicate API routes in JS code
  const patterns = [
    // Fetch/axios calls: fetch("/api/...", get("/api/...", post("/api/...
    /(?:fetch|get|post|put|patch|delete|request)\s*\(\s*["'`](\/api\/[^"'`]+)["'`]/gi,
    // Template literals with /api/
    /["'`](\/api\/[^"'`]*?)["'`]/g,
    // /admin/api/ endpoints
    /["'`](\/admin\/api\/[^"'`]*?)["'`]/g,
    // /admin/sites/ JSON endpoints
    /["'`](\/admin\/sites\/[^"'`]*?\.json[^"'`]*?)["'`]/g,
    // Route definitions (React Router, etc.)
    /path:\s*["'`](\/admin\/[^"'`]+)["'`]/g,
    // API base + path concatenation
    /["'`](\/api\/v\d+\/[^"'`]+)["'`]/g,
    // Rails-style resource paths used in API calls
    /(?:url|endpoint|path|route)\s*[:=]\s*["'`](\/(?:api|admin)[^"'`]+)["'`]/gi,
  ];

  for (const pattern of patterns) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(jsCode))) {
      const rawPath = match[1];
      // Clean up template literal interpolations
      const cleanPath = rawPath
        .replace(/\$\{[^}]+\}/g, '{id}')  // ${var} → {id}
        .replace(/\+\s*\w+/g, '')          // string concat
        .replace(/\/+$/, '');               // trailing slashes

      if (isValidApiPath(cleanPath)) {
        endpoints.push({
          path: cleanPath,
          source: sourceFile,
          raw: rawPath,
        });
      }
    }
  }

  // Also look for HTTP method definitions (helps identify which methods each endpoint supports)
  const methodPatterns = [
    // { method: "POST", url: "/api/..." }
    /method:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`][^}]*?url:\s*["'`](\/(?:api|admin)[^"'`]+)["'`]/gi,
    /url:\s*["'`](\/(?:api|admin)[^"'`]+)["'`][^}]*?method:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/gi,
    // axios.post("/api/...", ...) etc.
    /axios\.(get|post|put|patch|delete)\s*\(\s*["'`](\/(?:api|admin)[^"'`]+)["'`]/gi,
    // fetch with method in options
    /fetch\s*\(\s*["'`](\/(?:api|admin)[^"'`]+)["'`]\s*,\s*\{[^}]*method:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/gi,
  ];

  for (const pattern of methodPatterns) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(jsCode))) {
      // Order depends on which group is method vs url
      let method, urlPath;
      if (['get', 'post', 'put', 'patch', 'delete'].includes(match[1]?.toLowerCase())) {
        method = match[1].toUpperCase();
        urlPath = match[2];
      } else {
        urlPath = match[1];
        method = match[2]?.toUpperCase();
      }

      if (urlPath && isValidApiPath(urlPath)) {
        endpoints.push({
          path: urlPath.replace(/\$\{[^}]+\}/g, '{id}').replace(/\/+$/, ''),
          method: method || 'GET',
          source: sourceFile,
          raw: match[0].slice(0, 100),
        });
      }
    }
  }

  return endpoints;
}

function isValidApiPath(path) {
  if (!path) return false;
  if (path.length < 5 || path.length > 200) return false;
  // Must start with /api/ or /admin/
  if (!path.startsWith('/api/') && !path.startsWith('/admin/')) return false;
  // Skip obvious non-API paths
  if (path.includes('.css') || path.includes('.png') || path.includes('.svg')) return false;
  if (path.includes('.js') && !path.endsWith('.json')) return false;
  // Skip webpack/asset paths
  if (path.includes('webpack') || path.includes('chunk')) return false;
  return true;
}

function normalizeEndpoints(rawEndpoints) {
  // Deduplicate and normalize
  const byPath = new Map();

  for (const ep of rawEndpoints) {
    // Normalize site IDs to placeholder
    const normalized = ep.path
      .replace(/\/sites\/\d+/g, '/sites/{siteId}')
      .replace(/\/\d{5,}/g, '/{id}')
      .replace(/\{id\}\{id\}/g, '{id}');

    const key = `${ep.method || '?'} ${normalized}`;

    if (!byPath.has(key)) {
      byPath.set(key, {
        method: ep.method || null,
        path: normalized,
        sources: new Set(),
        examples: [],
      });
    }
    const entry = byPath.get(key);
    entry.sources.add(ep.source);
    if (entry.examples.length < 3 && ep.raw !== normalized) {
      entry.examples.push(ep.raw);
    }
  }

  return [...byPath.values()]
    .map(ep => ({
      ...ep,
      sources: [...ep.sources],
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function categorizeEndpoints(endpoints) {
  const categories = {
    'auth': [],
    'site': [],
    'dashboard': [],
    'reports': [],
    'contacts': [],
    'email': [],
    'offers-commerce': [],
    'products': [],
    'pages': [],
    'posts-blog': [],
    'newsletter': [],
    'automations': [],
    'forms': [],
    'segments-tags': [],
    'media-files': [],
    'settings': [],
    'other': [],
  };

  for (const ep of endpoints) {
    const p = ep.path.toLowerCase();
    if (p.includes('auth') || p.includes('login') || p.includes('session') || p.includes('token')) {
      categories['auth'].push(ep);
    } else if (p.includes('dashboard') || p.includes('insights') || p.includes('alerts')) {
      categories['dashboard'].push(ep);
    } else if (p.includes('report') || p.includes('payments_over_time') || p.includes('refund') || p.includes('opt_in') || p.includes('page_view') || p.includes('offers_sold')) {
      categories['reports'].push(ep);
    } else if (p.includes('contact') || p.includes('people')) {
      categories['contacts'].push(ep);
    } else if (p.includes('email') || p.includes('broadcast') || p.includes('sequence')) {
      categories['email'].push(ep);
    } else if (p.includes('offer') || p.includes('commerce') || p.includes('checkout') || p.includes('coupon') || p.includes('payment')) {
      categories['offers-commerce'].push(ep);
    } else if (p.includes('product') || p.includes('course') || p.includes('membership')) {
      categories['products'].push(ep);
    } else if (p.includes('page') || p.includes('landing') || p.includes('site_page')) {
      categories['pages'].push(ep);
    } else if (p.includes('post') || p.includes('blog') || p.includes('article')) {
      categories['posts-blog'].push(ep);
    } else if (p.includes('newsletter')) {
      categories['newsletter'].push(ep);
    } else if (p.includes('automation') || p.includes('pipeline') || p.includes('funnel') || p.includes('workflow')) {
      categories['automations'].push(ep);
    } else if (p.includes('form') || p.includes('submission')) {
      categories['forms'].push(ep);
    } else if (p.includes('segment') || p.includes('tag')) {
      categories['segments-tags'].push(ep);
    } else if (p.includes('upload') || p.includes('media') || p.includes('image') || p.includes('file') || p.includes('video')) {
      categories['media-files'].push(ep);
    } else if (p.includes('setting') || p.includes('config') || p.includes('site')) {
      categories['site'].push(ep);
    } else {
      categories['other'].push(ep);
    }
  }

  // Remove empty categories
  for (const [key, val] of Object.entries(categories)) {
    if (val.length === 0) delete categories[key];
  }

  return categories;
}

async function main() {
  console.log('Kajabi API Mapper — Static JS Bundle Analysis\n');

  const session = loadSession();

  // Step 1: Fetch the admin HTML
  const siteId = process.env.KAJABI_SITE_ID || loadSession()?.siteId;
  console.log('Fetching admin page HTML...');
  const html = await fetchWithCookies(`${KAJABI_BASE}/admin/sites/${siteId}`, session.cookies);
  console.log(`  HTML size: ${(html.length / 1024).toFixed(0)} KB`);

  // Step 2: Extract script URLs
  const scriptUrls = extractScriptUrls(html);
  console.log(`  Found ${scriptUrls.length} script tags\n`);

  // Also extract inline script endpoints from the HTML itself
  const htmlEndpoints = extractApiEndpoints(html, 'inline-html');
  console.log(`  Found ${htmlEndpoints.length} endpoints in inline HTML\n`);

  // Step 3: Download and analyze each JS bundle
  fs.mkdirSync(BUNDLES_DIR, { recursive: true });
  const allEndpoints = [...htmlEndpoints];
  let bundleCount = 0;

  for (const rawUrl of scriptUrls) {
    // Skip third-party scripts
    const url = rawUrl.startsWith('http') ? rawUrl : `${KAJABI_BASE}${rawUrl}`;
    const hostname = new URL(url).hostname;
    if (!hostname.includes('kajabi')) {
      continue;
    }

    const filename = path.basename(new URL(url).pathname).slice(0, 80);
    console.log(`Downloading: ${filename}`);

    try {
      const jsCode = await fetchWithCookies(url, session.cookies);
      bundleCount++;

      // Save bundle for reference
      const savePath = path.join(BUNDLES_DIR, filename);
      fs.writeFileSync(savePath, jsCode);

      // Extract endpoints
      const endpoints = extractApiEndpoints(jsCode, filename);
      allEndpoints.push(...endpoints);
      console.log(`  ${(jsCode.length / 1024).toFixed(0)} KB — ${endpoints.length} endpoints found`);
    } catch (err) {
      console.log(`  Error: ${err.message}`);
    }
  }

  // Step 4: Also fetch a few key sub-pages that might load different bundles
  const subPages = [
    `/admin/sites/${siteId}/email_campaigns`,
    `/admin/sites/${siteId}/posts`,
    `/admin/sites/${siteId}/contacts`,
    `/admin/sites/${siteId}/offers`,
  ];

  for (const pagePath of subPages) {
    console.log(`\nFetching sub-page: ${pagePath}`);
    try {
      const pageHtml = await fetchWithCookies(`${KAJABI_BASE}${pagePath}`, session.cookies);
      const pageScripts = extractScriptUrls(pageHtml);
      const pageEndpoints = extractApiEndpoints(pageHtml, `page:${pagePath}`);
      allEndpoints.push(...pageEndpoints);

      // Download any new scripts not already fetched
      for (const rawUrl of pageScripts) {
        const url = rawUrl.startsWith('http') ? rawUrl : `${KAJABI_BASE}${rawUrl}`;
        if (!new URL(url).hostname.includes('kajabi')) continue;
        const filename = path.basename(new URL(url).pathname).slice(0, 80);
        const savePath = path.join(BUNDLES_DIR, filename);
        if (fs.existsSync(savePath)) continue; // Already downloaded

        try {
          const jsCode = await fetchWithCookies(url, session.cookies);
          fs.writeFileSync(savePath, jsCode);
          const endpoints = extractApiEndpoints(jsCode, filename);
          allEndpoints.push(...endpoints);
          bundleCount++;
          console.log(`  New bundle: ${filename} — ${endpoints.length} endpoints`);
        } catch {}
      }
    } catch (err) {
      console.log(`  Error: ${err.message}`);
    }
  }

  console.log(`\n=== ANALYSIS ===`);
  console.log(`Bundles analyzed: ${bundleCount}`);
  console.log(`Raw endpoint references found: ${allEndpoints.length}`);

  // Step 5: Normalize and deduplicate
  const normalized = normalizeEndpoints(allEndpoints);
  console.log(`Unique endpoints after normalization: ${normalized.length}`);

  // Step 6: Categorize
  const categorized = categorizeEndpoints(normalized);

  // Step 7: Save results
  const output = {
    discoveredAt: new Date().toISOString(),
    bundlesAnalyzed: bundleCount,
    rawReferences: allEndpoints.length,
    uniqueEndpoints: normalized.length,
    categories: categorized,
    allEndpoints: normalized,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nSaved to: ${OUTPUT_FILE}`);

  // Print summary by category
  console.log('\n--- ENDPOINT MAP ---\n');
  for (const [category, endpoints] of Object.entries(categorized)) {
    console.log(`${category.toUpperCase()} (${endpoints.length})`);
    for (const ep of endpoints) {
      const method = ep.method ? ep.method.padEnd(7) : '?      ';
      console.log(`  ${method} ${ep.path}`);
    }
    console.log();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
