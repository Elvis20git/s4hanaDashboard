import { useEffect, useRef, useState } from 'react';

/** The sticky filter bar's behaviour — ported from the source dashboard (public/app.js stickyBar). The bar is position:sticky inside
    the page (the window is the scroller). A 1px sentinel just above it tells an IntersectionObserver when the page has scrolled and
    the bar is stuck; no scroll listeners. Compaction (no subtitle, tighter padding) happens inside the bar only: its height drop is
    handed to margin-bottom on the same transition, so nothing below it moves. 'stuck' and 'expanded' are React state (they are part
    of the className); measure() toggles classes only temporarily, ending in the same net state. */
export function useStickyBar(barRef, sentinelRef, deps) {
  const [stuck, setStuck] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const remeasure = useRef(() => {});

  useEffect(() => {
    const bar = barRef.current, sentinel = sentinelRef.current;
    if (!bar || !sentinel) return undefined;
    function measure() {
      const was = bar.classList.contains('stuck');
      bar.classList.add('no-anim'); bar.classList.remove('stuck');
      const h0 = bar.offsetHeight;
      bar.classList.add('stuck'); const h1 = bar.offsetHeight;
      if (!was) { bar.classList.remove('stuck'); void bar.offsetHeight; }   // flush, so the real toggle animates
      bar.classList.remove('no-anim'); void bar.offsetHeight;
      const root = document.documentElement.style;
      root.setProperty('--bar-delta', Math.max(0, h0 - h1) + 'px');
      root.setProperty('--sticky-offset', (h1 + 12 + 14) + 'px');           // for scroll-margin-top under the stuck bar
    }
    remeasure.current = measure;
    measure();
    let io;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(entries => {
        const e = entries[entries.length - 1];
        const v = !e.isIntersecting && e.boundingClientRect.top < 13;
        // measure() before the class flips, while the bar is still in its other state (same order as the source)
        if (v && !bar.classList.contains('stuck')) measure();
        setStuck(v);
        if (!v) setExpanded(false);
      }, { rootMargin: '-13px 0px 0px 0px', threshold: 0 });
      io.observe(sentinel);
    }
    let rz; const onResize = () => { clearTimeout(rz); rz = setTimeout(measure, 150); };
    window.addEventListener('resize', onResize);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    return () => { if (io) io.disconnect(); window.removeEventListener('resize', onResize); };
  }, [barRef, sentinelRef]);

  // The bar's size depends on the module (controls shown/hidden): re-measure after each change, like applyModuleBar did.
  useEffect(() => { remeasure.current(); }, deps);   // eslint-disable-line react-hooks/exhaustive-deps

  // click outside / Escape collapse the narrow-width Filters panel
  useEffect(() => {
    const bar = barRef.current;
    const onClick = e => { if (expanded && bar && !bar.contains(e.target)) setExpanded(false); };
    const onKey = e => { if (e.key === 'Escape' && expanded) { setExpanded(false); const b = bar && bar.querySelector('#barFilters'); if (b) b.focus(); } };
    document.addEventListener('click', onClick); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
  }, [expanded, barRef]);

  return { stuck, expanded, setExpanded };
}
