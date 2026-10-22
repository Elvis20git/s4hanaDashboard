// Minimal .env loader. Deliberately does NOT process backslash escapes —
// the communication-user password contains \ > } = + - literally.
// Strips only a matched pair of surrounding quotes, per the credentials file.
import fs from 'node:fs';
import path from 'node:path';

export function loadEnv(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`Missing env file: ${abs}`);
  const out = {};
  for (const raw of fs.readFileSync(abs, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.length > 1 && ((val[0] === '"' && val.at(-1) === '"') || (val[0] === "'" && val.at(-1) === "'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// Test-only (parity harness, see ../../MIGRATION.md): with AIF_FIXTURE_DATASET set no SAP access is needed, so a missing .env is
// tolerated and the non-secret scope settings may come from the process environment. Normal operation is unchanged: .env required.
const ENV_FILE = path.resolve(process.cwd(), 'config/.env');
export const CFG = (process.env.AIF_FIXTURE_DATASET && !fs.existsSync(ENV_FILE))
  ? Object.fromEntries(['PORT', 'REPORT_TO', 'COMPANY_CODE', 'SALES_ORG', 'LEDGER', 'PERIOD_FROM', 'OVERHEAD_GL', 'BATCH_CHUNK']
      .filter(k => process.env[k] != null).map(k => [k, process.env[k]]))
  : loadEnv(ENV_FILE);

// Everything that must never reach a log, an error message, an export or the browser.
const SECRETS = [CFG.SAP_PASS, CFG.SAP_USER].filter(s => s && s.length > 3);

export function redact(input) {
  let s = typeof input === 'string' ? input : String(input ?? '');
  for (const sec of SECRETS) s = s.split(sec).join('«redacted»');
  // Also scrub any Basic auth header that may appear in a stack or URL.
  s = s.replace(/Basic\s+[A-Za-z0-9+/=]+/g, 'Basic «redacted»');
  s = s.replace(/\/\/[^/@\s]+:[^/@\s]+@/g, '//«redacted»@');
  return s;
}
