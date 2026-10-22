// Renames the source's old CSS token references (var(--green), var(--tx-3), ...) inside the generated JS modules to the Tailwind
// theme variable names (--color-green, --color-tx-3, ...). Same mapping as scripts/port-css.mjs. Idempotent.
//   node scripts/rename-tokens.mjs
import fs from 'node:fs';
const map = {
  'ink-2': 'color-ink-2', ink: 'color-ink', 'hero-a': 'color-hero-a', 'hero-b': 'color-hero-b', 'hero-c': 'color-hero-c', 'hero-tx': 'color-hero-tx',
  canvas: 'color-canvas', card: 'color-card', 'line-2': 'color-line-2', line: 'color-line',
  'green-soft': 'color-green-soft', 'green-glow': 'color-green-glow', 'green-d': 'color-green-d', green: 'color-green', mint: 'color-mint',
  'gold-soft': 'color-gold-soft', 'gold-ink': 'color-gold-ink', 'gold-line': 'color-gold-line', gold: 'color-gold',
  'clay-soft': 'color-clay-soft', clay: 'color-clay', 'tx-2': 'color-tx-2', 'tx-3': 'color-tx-3', tx: 'color-tx', amber: 'color-amber',
  'shadow-lg': 'shadow-lift', shadow: 'shadow-card',
};
const names = Object.keys(map).sort((a, b) => b.length - a.length).join('|');
const re = new RegExp('var\\(--(' + names + ')(?![\\w-])', 'g');
let total = 0;
for (const f of ['src/lib/views.js', 'src/lib/anim.js', 'src/lib/spark.js', 'src/lib/chartTip.js', 'src/lib/fitTable.js', 'src/lib/derive.js', 'src/lib/copy.js', 'src/state/drillViews.js']) {
  const s = fs.readFileSync(f, 'utf8');
  let n = 0; const t = s.replace(re, (_, k) => { n++; return 'var(--' + map[k]; });
  if (n) { fs.writeFileSync(f, t); total += n; console.log(f, n); }
}
console.log('renamed', total, 'token references');
