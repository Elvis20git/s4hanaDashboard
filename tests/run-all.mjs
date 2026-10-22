// Runs every unit test: the server's own (cost conversions, product grouping, overhead rule — copied unchanged) and the ones that
// moved to ES-module imports with the front end (money formatter, module registry). Cross-platform: no shell syntax.
import { spawnSync } from 'node:child_process';
const steps = [
  ['server/tools/test-conversions.js', { cwd: 'server' }], ['server/tools/test-product-group.js', { cwd: 'server' }], ['server/tools/test-overhead.js', { cwd: 'server' }],
  ['tests/format.test.mjs'], ['tests/modules.test.mjs'],
];
let failed = 0;
for (const [f, o = {}] of steps) {
  const file = o.cwd ? f.replace(/^server\//, '') : f;
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit', cwd: o.cwd || '.', env: { ...process.env, AIF_FIXTURE_DATASET: process.env.AIF_FIXTURE_DATASET || 'validation/dataset.json' } });
  if (r.status !== 0) { failed++; console.error('FAILED:', f); }
}
console.log(failed ? `\n${failed} test file(s) failed` : '\nALL UNIT TESTS PASSED'); process.exit(failed ? 1 : 0);
