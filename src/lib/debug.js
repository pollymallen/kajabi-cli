const ENABLED = process.env.KAJABI_DEBUG === '1';
let _forceEnabled = false;

export function enableDebug() { _forceEnabled = true; }

export function debug(label, msg, data) {
  if (!ENABLED && !_forceEnabled) return;
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = `[${ts}] [${label}]`;
  if (data !== undefined) {
    console.error(`${prefix} ${msg}`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  } else {
    console.error(`${prefix} ${msg}`);
  }
}
