// Runs the front-end unit tests (money formatter, module registry). The backend rules (cost conversions, product grouping, overhead
// rule, aggregation, auth) are tested in Python: npm run test:api. Cross-platform: no shell syntax.
import { spawnSync } from 'node:child_process';
const steps = ['tests/format.test.mjs', 'tests/modules.test.mjs', 'tests/teamstats.test.mjs'];
let failed = 0;
for (const f of steps) {
  const r = spawnSync(process.execPath, [f], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.error('FAILED:', f); }
}
console.log(failed ? `\n${failed} test file(s) failed` : '\nALL UNIT TESTS PASSED');
process.exit(failed ? 1 : 0);
