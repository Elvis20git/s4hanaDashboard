/* Entrance animations — ported unchanged from the source dashboard (public/app.js). Vanilla helpers: a card sits in a 'hold'
   state (bars at scale 0, numbers at 0) until >=30% of it is on screen, then counts/grows/sweeps in; leaving the screen resets
   it, and a data change tweens from the previous values. Reduced motion renders the final values untouched. Numbers are
   .cn spans carrying their target in data-v; widths are measured and reserved so nothing shifts while counting.
   React drives them through hooks/useAnimCard.js, which calls afterAnimRender() after every commit — the same moment the
   source called it after writing the DOM. */
import { fmtK, fmtPct } from './format.js';
export const RM = () => window.matchMedia('(prefers-reduced-motion:reduce)').matches;

export const ANIM = { replayOnScroll: true, enterRatio: 0.3 };
export const NUM_FMT = { k: v => fmtK(v), pct: v => fmtPct(v), pc1: v => v.toFixed(1) + '%' };
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion:reduce)').matches;
export const easeOut = t => 1 - Math.pow(1 - t, 3);
export function tween(ms, delay, fn) {
  const t0 = performance.now() + delay; let raf;
  const step = now => { const t = Math.min(1, Math.max(0, (now - t0) / ms)); fn(easeOut(t)); if (t < 1) raf = requestAnimationFrame(step); };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
export function makeAnimCard(el, onPlay) {
  const card = { el, inView: false, played: false, prev: null, cancels: [], onPlay };
  if (el && 'IntersectionObserver' in window) {
    card.io = new IntersectionObserver(entries => {
      const e = entries[entries.length - 1];
      if (!card.inView && e.isIntersecting && e.intersectionRatio >= ANIM.enterRatio) {
        card.inView = true; if (!card.played) playAnimCard(card, 'enter');
      } else if (card.inView && !e.isIntersecting && ANIM.replayOnScroll) {
        card.inView = false; holdAnimCard(card); card.played = false;
      }
    }, { threshold: [0, ANIM.enterRatio] }).observe(el);
  } else card.noObserver = true;
  return card;
}
const animNums = c => [...c.el.querySelectorAll('.cn')];
const animSegs = c => [...c.el.querySelectorAll('.seg[data-len]')];
export function holdAnimCard(card) {
  card.cancels.forEach(f => f()); card.cancels = [];
  card.el.classList.add('anim-hold');
  animNums(card).forEach(el => { el.textContent = NUM_FMT[el.dataset.f](0); });
  animSegs(card).forEach(el => el.setAttribute('stroke-dasharray', `0 ${el.dataset.c}`));
}
export function snapshotAnimCard(card) {
  card.prev = {
    nums: animNums(card).map(el => +el.dataset.v),
    bars: [...card.el.querySelectorAll('.wf-fill[data-w]')].map(el => +el.dataset.w),
    segs: animSegs(card).map(el => ({ len: +el.dataset.len, off: +el.dataset.off })),
  };
}
export function playAnimCard(card, mode) {
  card.cancels.forEach(f => f()); card.cancels = [];
  const root = card.el, prev = mode === 'update' ? card.prev : null, upd = !!prev;
  root.classList.remove('anim-hold');
  const ease = 'cubic-bezier(.2,.8,.3,1)';
  const rows = [...root.querySelectorAll('.wfrow')];
  const rowDelay = el => { const i = rows.indexOf(el.closest('.wfrow')); return i < 0 ? 0 : i * 130; };
  animNums(card).forEach((el, i) => {
    const to = +el.dataset.v, f = NUM_FMT[el.dataset.f], from = upd && prev.nums[i] != null ? prev.nums[i] : 0;
    const svg = el instanceof SVGElement;
    card.cancels.push(tween(svg ? 900 : upd ? 700 : 900, svg ? 0 : rowDelay(el), e => { el.textContent = f(from + (to - from) * e); }));
  });
  root.querySelectorAll('.wf-fill[data-w]').forEach((el, i) => {
    const to = +el.dataset.w, from = upd && prev.bars[i] != null && to > 0 ? Math.min(1, prev.bars[i] / to) : 0;
    el.animate([{ transform: `scaleX(${from})` }, { transform: 'scaleX(1)' }], { duration: 700, delay: i * 130, easing: ease, fill: 'backwards' });
  });
  if (!upd) {
    root.querySelectorAll('.wv').forEach(el => el.animate([{ opacity: 0, transform: 'translateX(6px)' }, { opacity: 1, transform: 'none' }], { duration: 350, delay: rowDelay(el) + 450, easing: 'ease-out', fill: 'backwards' }));
    root.querySelectorAll('.pct-sub,.side .j').forEach(el => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, delay: 800, fill: 'backwards' }));
    root.querySelectorAll('.dl').forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: Math.min(i * 40, 400), easing: 'ease-out', fill: 'backwards' }));
  }
  root.querySelectorAll('.gring').forEach(el => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 700, fill: 'backwards' }));
  const segs = animSegs(card);
  if (segs.length) {
    const C = +segs[0].dataset.c, tgt = segs.map(el => ({ len: +el.dataset.len, off: +el.dataset.off }));
    card.cancels.push(tween(900, 0, e => segs.forEach((el, i) => {
      let len, off;
      if (upd) { const p = prev.segs[i] || { len: 0, off: tgt[i].off }; len = p.len + (tgt[i].len - p.len) * e; off = p.off + (tgt[i].off - p.off) * e; }
      else { off = tgt[i].off; len = Math.max(0, Math.min(tgt[i].len, e * C - off)); }  // clockwise sweep from 12 o'clock
      el.setAttribute('stroke-dasharray', `${len} ${C - len}`); el.setAttribute('stroke-dashoffset', -off);
    })));
  }
  if (card.onPlay && !upd) card.onPlay(card);
  card.played = true; snapshotAnimCard(card);
}
/** Call after a card's DOM has been (re)written with its final values. */
export function afterAnimRender(card) {
  if (!card.el) return;
  card.cancels.forEach(f => f()); card.cancels = [];
  card.el.classList.remove('anim-hold');
  if (reducedMotion()) { snapshotAnimCard(card); return; }
  // reserve each number's final width so counting up never shifts neighbours
  animNums(card).forEach(el => { if (!(el instanceof SVGElement)) { el.style.minWidth = ''; const w = el.getBoundingClientRect().width; if (w) el.style.minWidth = w + 'px'; } });
  if (card.noObserver) { snapshotAnimCard(card); return; }
  if (card.inView) playAnimCard(card, card.played && card.prev ? 'update' : 'enter');
  else { holdAnimCard(card); card.played = false; }
}

// Sales-by-period chart: columns grow, then the QTY line draws left to right, dots pop in and pills fade in.
export const periodOnPlay = card => {
  const root = card.el, ease = 'cubic-bezier(.2,.8,.3,1)';
  root.querySelectorAll('.bar,.cmbar').forEach((el, i) => el.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 700, delay: (el.dataset.i != null ? +el.dataset.i : i) * 50, easing: ease, fill: 'backwards' }));
  root.querySelectorAll('.qline').forEach(el => el.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 700, delay: 650, easing: 'ease-out', fill: 'backwards' }));
  root.querySelectorAll('.qdot').forEach(el => el.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.25)', offset: .7 }, { transform: 'scale(1)' }], { duration: 320, delay: 650 + (+el.dataset.i) * 70, easing: 'ease-out', fill: 'backwards' }));
  root.querySelectorAll('.qpill').forEach(el => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 900, fill: 'backwards' }));
};
