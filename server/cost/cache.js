// On-disk cache of FROZEN batch unit costs (Step 5).
// A batch sold in March and again in August must carry the same unit cost both times.
// Entries whose orders are settled and whose period is closed are never recomputed.
import fs from 'node:fs';
import path from 'node:path';
import { RULE_VERSION } from './rules.js';

const FILE = path.resolve(process.cwd(), 'cache/batch-unit-cost.json');

const fresh = () => ({ version: 1, ruleVersion: RULE_VERSION, entries: {} });
function readAll() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    // Frozen costs were derived under the cost rules in force when they were written; if the rules have changed
    // (e.g. which overhead sources count), every stored value is stale and the whole cache is dropped.
    return s.ruleVersion === RULE_VERSION ? s : fresh();
  } catch { return fresh(); }
}
let store = readAll();

export function get(batch) { return store.entries[batch]; }

/** A frozen entry is reusable only when it was final when written. */
export function getFrozen(batch) {
  const e = store.entries[batch];
  return e && e.final ? e : undefined;
}

export function put(batch, entry) { store.entries[batch] = entry; }

export function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  store.savedAt = new Date().toISOString();
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}

export function stats() {
  const e = Object.values(store.entries);
  return { batches: e.length, final: e.filter(x => x.final).length, provisional: e.filter(x => !x.final).length, savedAt: store.savedAt };
}

export function clear() { store = fresh(); save(); }
