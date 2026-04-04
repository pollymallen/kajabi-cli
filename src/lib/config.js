/**
 * Config — reads Kajabi CLI configuration from ~/.kajabi-cli/config.json
 * or environment variables.
 *
 * Priority order (highest to lowest):
 *   1. Environment variables (KAJABI_SITE_ID, KAJABI_EMAIL)
 *   2. ~/.kajabi-cli/config.json
 *   3. Defaults (none — site ID and email must be configured)
 *
 * Set via: kajabi config --site-id=XXXXXXX --email=you@example.com
 */

import fs from 'fs';
import path from 'path';

const CONFIG_DIR = path.join(process.env.HOME, '.kajabi-cli');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

let _cached = null;

function loadFileConfig() {
  if (_cached) return _cached;
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      _cached = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return _cached;
    }
  } catch {}
  return {};
}

export function getConfig() {
  const file = loadFileConfig();
  return {
    siteId: process.env.KAJABI_SITE_ID || file.siteId || null,
    email: process.env.KAJABI_EMAIL || file.email || null,
  };
}

export function getSiteId() {
  const { siteId } = getConfig();
  if (!siteId) {
    throw new Error(
      'Kajabi site ID not configured.\n' +
      'Run: kajabi config --site-id=YOUR_SITE_ID\n' +
      'Or set the KAJABI_SITE_ID environment variable.'
    );
  }
  return siteId;
}

export function getEmail() {
  const { email } = getConfig();
  return email; // optional — only required for email-report parsing
}

export function saveConfig(updates) {
  const existing = loadFileConfig();
  const merged = { ...existing, ...updates };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  _cached = merged;
  return merged;
}

export function showConfig() {
  const config = getConfig();
  const source = (key, envVar) => process.env[envVar] ? '(env)' : (loadFileConfig()[key] ? '(config file)' : '(not set)');
  return {
    siteId: config.siteId || '(not set)',
    siteIdSource: source('siteId', 'KAJABI_SITE_ID'),
    email: config.email || '(not set)',
    emailSource: source('email', 'KAJABI_EMAIL'),
    configFile: CONFIG_PATH,
  };
}
