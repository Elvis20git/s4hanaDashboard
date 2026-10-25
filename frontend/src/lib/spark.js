/* The net-sales sparkline, beside the KPI cards — ported from the source dashboard (public/app.js renderSpark). Drawn in real
   pixels from its box (so the end dot stays round and the plot lines up with the cards); the first/last month labels sit
   inside the plot's bottom corners so it adds no height. Operates on the <svg> element, like the source did. */
import { MOF, mLabel, formatMoneyCompact } from './format.js';
import { RM } from './anim.js';
export const sparkAnim = { until: 0 };
export function drawSpark(svg, ps, animate) {
  const vals = ps.map(p => p.revenue), anim = animate && !RM();
  const box = svg.parentElement.getBoundingClientRect();
  const W = Math.max(160, Math.round(box.width) || 520), H = Math.max(56, Math.round(box.height) || 96);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (vals.length < 2) { svg.innerHTML = ''; return; }
  // padding keeps peaks and the end dot unclipped; the bottom band is where the month labels live
  const padX = 8, topPad = 14, botPad = 24;
  const max = Math.max(...vals), min = Math.min(...vals), span = max - min || 1;
  const x = i => padX + i * ((W - 2 * padX) / (vals.length - 1));
  const y = v => (H - botPad) - ((v - min) / span) * (H - botPad - topPad);
  let path = ''; vals.forEach((v, i) => { path += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' '; });
  const area = path + `L${x(vals.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`;
  // pathLength="1" normalises the dash maths to the path's own length, so the draw animation always covers the real
  // geometry exactly, whatever the point count or the box size.
  let s = `<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3FA378" stop-opacity=".38"/><stop offset="1" stop-color="#3FA378" stop-opacity="0"/></linearGradient></defs>`
    + `<path d="${area}" fill="url(#sg)"` + (anim ? ` style="animation:fade-in 1.2s ease-out .3s both"` : '') + `/>`
    + `<path d="${path}" fill="none" stroke="#9FE3C1" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" pathLength="1" `
    + (anim ? `stroke-dasharray="1" stroke-dashoffset="1" style="animation:draw 1.3s cubic-bezier(.4,0,.2,1) .2s forwards"` : '') + `/>`;
  // "Mon YY" first / last labels, in the bottom corners of the plot
  const shortYr = p => `${MOF[+p.slice(0, 2) - 1]} ${p.slice(5)}`;
  s += `<text x="${padX}" y="${H - 7}" fill="#8FBAA6" font-size="10" class="mono" pointer-events="none">${shortYr(ps[0].period)}</text>`
    + `<text x="${W - padX}" y="${H - 7}" fill="#8FBAA6" font-size="10" class="mono" text-anchor="end" pointer-events="none">${shortYr(ps.at(-1).period)}</text>`;
  // Hit targets: a 2px line is a fiddly hover target on its own, so each point gets a larger transparent catchment circle,
  // with a <title> mirroring the visible callout ("Sep 2026 · $2.73M") for slow-hover users and screen readers.
  vals.forEach((v, i) => {
    s += `<circle class="spark-hit" data-i="${i}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="12" fill="transparent" style="cursor:pointer"><title>${mLabel(ps[i].period)} · ${formatMoneyCompact(v)}</title></circle>`;
  });
  // The latest point stays permanently marked — the "you are here" dot.
  s += `<circle cx="${x(vals.length - 1).toFixed(1)}" cy="${y(vals.at(-1)).toFixed(1)}" r="3.5" fill="#fff" stroke="#3FA378" stroke-width="2"`
    + (anim ? ` style="animation:fade-in .4s ease-out 1.3s both"` : '') + `/>`;
  // Hover callout group — repositioned on hover rather than rebuilt.
  s += `<g id="sparkHover" style="pointer-events:none;opacity:0">`
    + `<circle id="sparkHoverDot" r="4" fill="#fff" stroke="#3FA378" stroke-width="2"/>`
    + `<text id="sparkHoverVal" text-anchor="middle" fill="#fff" font-size="12" font-weight="600" class="num"></text>`
    + `<text id="sparkHoverMo" text-anchor="middle" fill="#B7CFC4" font-size="9" class="mono"></text>`
    + `</g>`;
  svg.innerHTML = s;
  if (anim) sparkAnim.until = performance.now() + 1800;
  const clampX = px => Math.max(38, Math.min(W - 38, px));
  svg.querySelectorAll('.spark-hit').forEach(el => {
    el.addEventListener('mouseenter', () => {
      const i = +el.dataset.i, cx = x(i), cy = y(vals[i]);
      const above = cy > 30, labelY = above ? cy - 12 : cy + 18, moY = above ? cy - 24 : cy + 30;
      svg.querySelector('#sparkHover').style.opacity = '1';
      svg.querySelector('#sparkHoverDot').setAttribute('cx', cx); svg.querySelector('#sparkHoverDot').setAttribute('cy', cy);
      svg.querySelector('#sparkHoverVal').setAttribute('x', clampX(cx)); svg.querySelector('#sparkHoverVal').setAttribute('y', labelY);
      svg.querySelector('#sparkHoverVal').textContent = formatMoneyCompact(vals[i]);
      svg.querySelector('#sparkHoverMo').setAttribute('x', clampX(cx)); svg.querySelector('#sparkHoverMo').setAttribute('y', moY);
      svg.querySelector('#sparkHoverMo').textContent = mLabel(ps[i].period);
    });
  });
  svg.addEventListener('mouseleave', () => { const g = svg.querySelector('#sparkHover'); if (g) g.style.opacity = '0'; });
}
