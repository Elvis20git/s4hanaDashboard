// Data parity: the same requests against the source dashboard API and the AIF-VITE API must return byte-identical JSON.
//   SRC=http://localhost:5173 DST=http://localhost:5181 node parity/data-parity.mjs
const SRC = process.env.SRC || 'http://localhost:5173', DST = process.env.DST || 'http://localhost:5181';
// The only value allowed to differ is the build timestamp: the live source rebuilds from SAP on its own schedule, so its builtAt moves
// while every figure stays put. Set STRICT=1 to compare it too (right after copying a fresh validation/dataset.json to the target).
const STRICT = process.env.STRICT === '1';
const get = async (b, p) => { const r = await fetch(b + p, { headers: { 'x-aif-user': 'Derrick-a' } }); const t = await r.text(); return r.status + ' ' + (STRICT ? t : t.replace(/"builtAt":"[^"]*"/g, '"builtAt":"-"')); };
const all = JSON.parse((await get(SRC, '/api/data?source=api')).slice(4)).allPeriods;
const last = all.at(-1), ytdYear = last.slice(3), first = all.find(p => p.endsWith(ytdYear));
const ranges = {
  '2026 to date': [first, last], 'Last 12 months': [all.at(-12), last], 'All data': [null, null], 'Custom FROM-TO': [all[3], all[all.length - 3]],
};
let bad = 0, n = 0;
const check = async (label, path) => {
  const [a, b] = await Promise.all([get(SRC, path), get(DST, path)]); n++;
  if (a !== b) { bad++; console.log('DIFF  ', label, path.slice(0, 90)); } 
};
for (const [label, [f, t]] of Object.entries(ranges)) {
  const q = f && t ? `&from=${f}&to=${t}` : '';
  await check(label, `/api/data?source=api${q}`);
  await check(label, `/api/validation?source=api${q}`);
  await check(label, `/api/export/validation.csv?source=api${q}`);
  console.log(label.padEnd(16), f || 'all', '→', t || 'all', ' checked');
}
for (const p of all.slice(-3)) await check('period ' + p, `/api/data?source=api&period=${p}`);
for (const q of ['help', 'total revenue', 'margin']) {
  const post = async B => (await fetch(B + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'api', message: q }) })).text();
  n++; if (await post(SRC) !== await post(DST)) { bad++; console.log('DIFF   chat', q); }
}
console.log(`\n${n} comparisons, ${bad} differences`); process.exit(bad ? 1 : 0);
