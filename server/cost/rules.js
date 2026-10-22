// The cost rules that are configuration, read once and shared by the engine and the cache.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const COST_CONFIG = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'config/sources.json'), 'utf8'));
/** Overhead (G/L 94301000): which sources count toward VC. See config/sources.json -> overheadSources. */
export const OVERHEAD = COST_CONFIG.overheadSources;
/** Fingerprint of everything that changes a frozen batch cost (the G/L, which sources count, how they are told apart).
    Display labels are deliberately NOT part of it: renaming a source must not discard stored costs. A cache written
    under a different fingerprint is discarded. */
const COST_AFFECTING = {
  gl: OVERHEAD.gl,
  included: OVERHEAD.included.map(x => x.id),
  excluded: OVERHEAD.excluded,
  identification: { mode: OVERHEAD.identification.mode, highRate: OVERHEAD.identification.highRate, lowRate: OVERHEAD.identification.lowRate },
};
export const RULE_VERSION = 'oh-' + crypto.createHash('sha1').update(JSON.stringify(COST_AFFECTING)).digest('hex').slice(0, 10);
