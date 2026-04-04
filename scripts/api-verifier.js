/**
 * Kajabi API Verifier
 *
 * Tests every unverified endpoint from the unified API map
 * against the live API. Records status codes, response shapes,
 * and auth requirements.
 *
 * Usage:
 *   node scripts/api-verifier.js
 *   node scripts/api-verifier.js --category=reports
 *   node scripts/api-verifier.js --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getToken, loadSession, buildCookieHeader } from '../src/lib/auth.js';
import { getSiteId } from '../src/lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const MAP_FILE = path.join(PROJECT_ROOT, 'docs', 'api-map-unified.json');
const OUTPUT_FILE = path.join(PROJECT_ROOT, 'docs', 'api-verified.json');

const SITE_ID = getSiteId();
const BASE_URL = 'https://app.kajabi.com';

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

function resolveEndpointPath(templatePath) {
  let resolved = templatePath
    .replace(/\{siteId\}/g, SITE_ID)
    .replace(/:siteId/g, SITE_ID)
    // {id} in site-like positions should be the site ID
    .replace(/\/sites\/\{id\}/g, `/sites/${SITE_ID}`)
    .replace(/site_id=\{id\}/g, `site_id=${SITE_ID}`)
    .replace(/site_id=$/g, `site_id=${SITE_ID}`)
    .replace(/site_id=\s/g, `site_id=${SITE_ID} `);

  // Any remaining {id} gets a placeholder — email campaigns use a higher ID range
  if (resolved.includes('email_campaigns/{id}')) {
    resolved = resolved.replace(/\{id\}/g, '1');
  } else if (resolved.includes('email_folders/{id}')) {
    resolved = resolved.replace(/\{id\}/g, '1');
  } else {
    resolved = resolved.replace(/\{id\}/g, '1');
  }

  return resolved;
}

async function testEndpoint(ep, token, cookieHeader, csrfToken) {
  const methods = ep.methods.length > 0 ? ep.methods : ['GET'];
  const results = [];

  for (const method of methods) {
    // Only test safe methods automatically
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      results.push({
        method,
        skipped: true,
        reason: 'write-method — skipping to avoid side effects',
      });
      continue;
    }

    const resolvedPath = resolveEndpointPath(ep.path);

    // Build URL with site_id if needed
    const url = new URL(resolvedPath, BASE_URL);
    if (!resolvedPath.includes(SITE_ID) && !url.searchParams.has('site_id')) {
      url.searchParams.set('site_id', SITE_ID);
    }

    const headers = {
      'authorization': token,
      'accept': 'application/json, text/html',
      'cookie': cookieHeader,
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    };

    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }

    try {
      const res = await fetch(url.toString(), {
        method,
        headers,
        redirect: 'manual', // Don't follow redirects — we want to see them
      });

      const contentType = res.headers.get('content-type') || '';
      let responsePreview = null;
      let responseKeys = null;

      if (contentType.includes('json')) {
        const text = await res.text();
        responsePreview = text.slice(0, 500);
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed === 'object' && parsed !== null) {
            responseKeys = Array.isArray(parsed)
              ? `array[${parsed.length}]`
              : Object.keys(parsed).slice(0, 10);
          }
        } catch {}
      } else if (contentType.includes('text')) {
        const text = await res.text();
        responsePreview = text.slice(0, 200);
      } else {
        // Consume body to free connection
        await res.arrayBuffer().catch(() => {});
      }

      results.push({
        method,
        status: res.status,
        statusText: res.statusText,
        contentType: contentType.split(';')[0].trim(),
        responseKeys,
        responsePreview: res.status === 200 ? responsePreview : null,
        redirect: res.status >= 300 && res.status < 400
          ? res.headers.get('location')
          : null,
      });
    } catch (err) {
      results.push({
        method,
        error: err.message,
      });
    }
  }

  return results;
}

async function main() {
  const args = parseArgs();

  if (!fs.existsSync(MAP_FILE)) {
    console.error('API map not found. Run api-mapper.js first.');
    process.exit(1);
  }

  const mapData = JSON.parse(fs.readFileSync(MAP_FILE, 'utf-8'));
  const token = await getToken();
  const session = loadSession();
  const cookieHeader = buildCookieHeader(session.cookies);

  console.log('Kajabi API Verifier\n');

  // Collect all endpoints to test
  let toTest = [];
  for (const [cat, eps] of Object.entries(mapData.categories)) {
    if (args.category && cat !== args.category) continue;
    for (const ep of eps) {
      toTest.push({ ...ep, category: cat });
    }
  }

  // Filter to unverified only (unless --all)
  if (!args.all) {
    const beforeCount = toTest.length;
    toTest = toTest.filter(ep => !ep.verified);
    console.log(`Testing ${toTest.length} unverified endpoints (${beforeCount} total, ${beforeCount - toTest.length} already verified)\n`);
  } else {
    console.log(`Testing all ${toTest.length} endpoints\n`);
  }

  if (args['dry-run']) {
    for (const ep of toTest) {
      console.log(`  [${ep.category}] ${ep.methods.join(',') || '?'} ${ep.path}`);
    }
    return;
  }

  const results = [];
  let okCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const ep of toTest) {
    process.stdout.write(`  ${ep.path.padEnd(70)}`);

    const testResults = await testEndpoint(ep, token, cookieHeader, session.csrfToken);

    const summary = testResults.map(r => {
      if (r.skipped) {
        skipCount++;
        return `${r.method}:skip`;
      }
      if (r.error) {
        failCount++;
        return `${r.method}:ERR`;
      }
      if (r.status === 200) {
        okCount++;
        return `${r.method}:${r.status} ✓`;
      }
      failCount++;
      return `${r.method}:${r.status}`;
    }).join('  ');

    console.log(summary);

    results.push({
      category: ep.category,
      path: ep.path,
      previouslyVerified: ep.verified,
      testResults,
    });

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`OK (200): ${okCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Skipped (write methods): ${skipCount}`);

  // Build updated verified map
  const verifiedMap = JSON.parse(fs.readFileSync(MAP_FILE, 'utf-8'));

  for (const result of results) {
    // Find endpoint in map and update
    const cat = verifiedMap.categories[result.category];
    if (!cat) continue;
    const ep = cat.find(e => e.path === result.path);
    if (!ep) continue;

    ep.verificationResults = result.testResults;

    // Mark as verified if any GET returned 200
    const hasOk = result.testResults.some(r => r.status === 200);
    if (hasOk) {
      ep.verified = true;
      // Add discovered methods
      for (const r of result.testResults) {
        if (r.status === 200 && !ep.methods.includes(r.method)) {
          ep.methods.push(r.method);
        }
      }
      // Store response shape
      const okResult = result.testResults.find(r => r.status === 200);
      if (okResult?.responseKeys) {
        ep.responseShape = okResult.responseKeys;
      }
      if (okResult?.responsePreview && !ep.responsePreview) {
        ep.responsePreview = okResult.responsePreview;
      }
    }
  }

  // Update summary
  let totalVerified = 0;
  let totalEndpoints = 0;
  for (const [cat, eps] of Object.entries(verifiedMap.categories)) {
    for (const ep of eps) {
      totalEndpoints++;
      if (ep.verified) totalVerified++;
    }
    verifiedMap.summary.categories[cat] = eps.length;
  }
  verifiedMap.summary.verified = totalVerified;
  verifiedMap.summary.unverified = totalEndpoints - totalVerified;
  verifiedMap.summary.lastVerified = new Date().toISOString();

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(verifiedMap, null, 2));
  console.log(`\nUpdated map saved to: ${OUTPUT_FILE}`);

  // Print newly verified endpoints
  const newlyVerified = results.filter(r =>
    !r.previouslyVerified && r.testResults.some(t => t.status === 200)
  );
  if (newlyVerified.length > 0) {
    console.log(`\n--- NEWLY VERIFIED (${newlyVerified.length}) ---`);
    for (const r of newlyVerified) {
      const okResult = r.testResults.find(t => t.status === 200);
      console.log(`  ${r.path}`);
      if (okResult?.responseKeys) {
        console.log(`    → ${JSON.stringify(okResult.responseKeys)}`);
      }
    }
  }

  // Print interesting failures (not 404s)
  const interesting = results.filter(r =>
    r.testResults.some(t => t.status && t.status !== 200 && t.status !== 404 && t.status !== 302)
  );
  if (interesting.length > 0) {
    console.log(`\n--- INTERESTING FAILURES ---`);
    for (const r of interesting) {
      for (const t of r.testResults) {
        if (t.status && t.status !== 200 && t.status !== 404 && t.status !== 302) {
          console.log(`  ${t.status} ${r.path}`);
        }
      }
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
