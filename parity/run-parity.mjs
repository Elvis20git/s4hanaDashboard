// Runs the three parity checks in order. Needs the source dashboard running (SRC, default :5173), the AIF-VITE API in fixture mode
// (DST_API, default :5181) and the Vite dev server (DST, default :5191). See MIGRATION.md → "Running the parity checks".
import { spawnSync } from 'node:child_process';
const env = { ...process.env, SRC: process.env.SRC || 'http://localhost:5173', DST: process.env.DST_API || 'http://localhost:5181' };
const vis = { ...process.env, SRC: env.SRC, DST: process.env.DST || 'http://localhost:5191' };
let failed = 0;
for (const [f, e] of [['parity/data-parity.mjs', env], ['parity/behaviour-parity.mjs', vis], ['parity/visual-parity.mjs', vis]]) {
  console.log('\n=== ' + f + ' ==='); const r = spawnSync(process.execPath, [f], { stdio: 'inherit', env: e }); if (r.status) failed++;
}
console.log(failed ? `\n${failed} parity check(s) reported differences — see parity/out/ (visual diffs: *.diff.png)` : '\nALL PARITY CHECKS PASSED'); process.exit(failed ? 1 : 0);
