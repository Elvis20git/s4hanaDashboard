/* Sizes a BreakdownTable so its columns fit the card's own current width with no scrolling — ported unchanged from the
   source dashboard (public/app.js fitBreakdownTable / setStickyHead), taking the <table> element instead of an id. */
export const OVERFLOW_W = [74, 92]; // optional columns just past the fold (unused now: both breakdown tables fit)
export const FIT_COL_MIN = 62;
export const FIRST_COL_MIN = 96;
const btblFitted = new WeakSet();
export function fitBreakdownTable(table, overflowW = OVERFLOW_W) {
  const wrap = table?.closest('.btbl-wrap');
  if (!table || !wrap) return;
  const apply = () => {
    const avail = wrap.clientWidth;
    if (!avail) return;
    // Measure with no width constraint in effect, so nothing is clipping
    // the very content we're about to measure.
    const oldColgroup = table.querySelector('colgroup');
    if (oldColgroup) oldColgroup.remove();
    table.style.tableLayout = 'auto'; table.style.width = 'auto';
    const naturalW = Math.max(FIRST_COL_MIN, ...[...table.querySelectorAll('.frz')].map(c => c.scrollWidth)) + 6;
    table.style.tableLayout = 'fixed';

    const headCells = [...table.querySelectorAll('thead tr:first-child > *')];
    const totalCols = headCells.reduce((s, c) => s + (c.colSpan || 1), 0);
    const bodyCols = totalCols - overflowW.length;
    const fitCols = bodyCols - 1; // numeric columns, excluding the frozen one
    const overflowSum = overflowW.reduce((a, b) => a + b, 0);
    // The name column takes what the numeric columns leave (never more than its own
    // longest name); longer names truncate with an ellipsis and keep their tooltip.
    const firstW = Math.min(naturalW, Math.max(FIRST_COL_MIN, avail - fitCols * FIT_COL_MIN - overflowSum));
    const perCol = fitCols > 0 ? Math.max(FIT_COL_MIN, (avail - firstW - overflowSum) / fitCols) : 0;
    const colgroup = document.createElement('colgroup');
    for (let i = 0; i < totalCols; i++) {
      const col = document.createElement('col');
      col.style.width = (i === 0 ? firstW : i < bodyCols ? perCol : overflowW[i - bodyCols]) + 'px';
      colgroup.appendChild(col);
    }
    table.insertBefore(colgroup, table.firstChild);
    table.style.width = (firstW + perCol * fitCols + overflowSum) + 'px';
  };
  apply();
  const onScroll = () => {
    wrap.classList.toggle('scrolled', wrap.scrollLeft > 1);
    wrap.classList.toggle('at-end', wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 1);
  };
  onScroll();
  if (!btblFitted.has(table)) {
    btblFitted.add(table);
    new ResizeObserver(apply).observe(wrap);
    wrap.addEventListener('scroll', onScroll);
  }
}

/** Offsets for the sticky group rows: they stick directly under the (sticky) column header. */
export function setStickyHead(t) {
  const th = t.querySelector('thead'); if (th) t.style.setProperty('--thead-h', th.offsetHeight + 'px');
}
