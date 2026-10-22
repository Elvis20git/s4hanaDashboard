/* The shared ⓘ / status-dot popover engine — ported unchanged from the source dashboard (public/app.js, 'help popover'):
   one DOM node repositioned per trigger. Hover previews it; a click pins it open until Esc, ×, outside-click or a re-click.
   Triggers are any element carrying data-help (a key into HELP) or data-help-title/-body/-rows/-links/-wide attributes.
   installPopoverEngine() runs once, after the <Popover/> markup is in the DOM. */
import { HELP } from './copy.js';
import { esc } from './format.js';
import { statusAction } from '../state/nav.js';
let installed = false;
export function installPopoverEngine() {
  if (installed) return; installed = true;
  const $ = id => document.getElementById(id);
let popTrigger = null, popPinned = false, hoverCloseTimer = null;
function fillPopover(trigger) {
  const key = trigger.dataset.help;
  const h = key ? HELP[key] : {
    title: trigger.dataset.helpTitle, body: trigger.dataset.helpBody,
    rows: trigger.dataset.helpRows ? JSON.parse(trigger.dataset.helpRows) : null,
    foot: trigger.dataset.helpFoot || null,
    links: trigger.dataset.helpLinks ? JSON.parse(trigger.dataset.helpLinks) : null,
    wide: !!trigger.dataset.helpWide,
  };
  if (!h || !h.body) return false;
  $('popTitle').textContent = h.title || '';
  $('popBody').textContent = h.body || '';
  $('popRows').innerHTML = (h.rows || []).map(r => `<div class="pop-row${r.tone ? ' ' + r.tone : ''}"><span class="rl">${esc(r.label)}</span><span class="rv">${esc(r.value)}</span></div>`).join('');
  $('popFoot').textContent = h.foot || '';
  $('popFormula').textContent = h.formula || '';
  $('popDisc').hidden = !h.disclaimer; $('popDiscBody').textContent = h.disclaimer || '';
  $('popover').classList.toggle('wide', !!h.wide);
  $('popLinks').innerHTML = (h.links || []).map(l => `<button type="button" class="pop-link" data-act="${esc(l.act)}">${esc(l.label)} →</button>`).join('');
  $('popLinks').hidden = !(h.links && h.links.length);
  $('popTip').textContent = h.tip || '';
  return true;
}
function positionPopover(trigger) {
  const pop = $('popover');
  pop.classList.remove('arrow-top', 'arrow-bottom');
  // Below 640px the popover is a fixed bottom sheet (see app.css) — skip
  // anchored positioning entirely so it never fights the CSS placement.
  if (window.matchMedia('(max-width:640px)').matches) return;
  const r = trigger.getBoundingClientRect();
  // measured, not assumed: the popover grows with its content (e.g. the Disclaimer), and must stay inside the viewport
  const pw = pop.offsetWidth || 320, ph = pop.offsetHeight || 200, gap = 10;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 8);
  const spaceBelow = window.innerHeight - r.bottom, spaceAbove = r.top;
  const below = spaceBelow >= ph + gap + 8 || spaceBelow >= spaceAbove;
  pop.style.left = left + 'px';
  pop.style.setProperty('--pop-origin-x', (r.left + r.width / 2 - left) + 'px');
  const top = Math.min(Math.max(8, below ? r.bottom + gap : r.top - gap - ph), Math.max(8, window.innerHeight - ph - 8));
  pop.style.top = top + 'px'; pop.style.bottom = 'auto';
  pop.classList.add(below ? 'arrow-top' : 'arrow-bottom');
  $('popArrow').style.left = Math.min(Math.max(12, r.left + r.width / 2 - left - 5), pw - 22) + 'px';
  $('popArrow').style.right = 'auto';
}
function showPopover(trigger, pinned) {
  // An explicit click always wins; a mere hover must never steal a popover
  // the user already pinned open on something else.
  if (popTrigger && popTrigger !== trigger && popPinned && !pinned) return;
  clearTimeout(hoverCloseTimer);
  if (popTrigger !== trigger) {
    if (popTrigger) closePopover(true);
    if (!fillPopover(trigger)) return;
    popTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    const pop = $('popover');
    pop.removeAttribute('hidden'); pop.setAttribute('aria-hidden', 'false');
    $('popScrim').hidden = false;
    positionPopover(trigger);
    requestAnimationFrame(() => pop.classList.add('show'));
  }
  popPinned = popPinned || pinned;
}
let restoringFocus = false;
function closePopover(skipFocus) {
  if (!popTrigger) return;
  $('popover').classList.remove('show');
  $('popover').setAttribute('hidden', ''); $('popover').setAttribute('aria-hidden', 'true');
  $('popScrim').hidden = true;
  popTrigger.setAttribute('aria-expanded', 'false');
  const opener = popTrigger;
  popTrigger = null; popPinned = false;
  // Focus returning to the icon fires our own focusin handler synchronously
  // (it'd otherwise treat that as a fresh hover/focus open) — guard it out.
  if (!skipFocus) { restoringFocus = true; opener.focus(); restoringFocus = false; }
}
function scheduleHoverClose() {
  clearTimeout(hoverCloseTimer);
  hoverCloseTimer = setTimeout(() => { if (!popPinned) closePopover(true); }, 200);
}
document.addEventListener('mouseover', e => {
  const trigger = e.target.closest('[data-help],[data-help-title]');
  if (trigger) showPopover(trigger, false);
});
document.addEventListener('mouseout', e => {
  const trigger = e.target.closest('[data-help],[data-help-title]');
  if (trigger && !trigger.contains(e.relatedTarget)) scheduleHoverClose();
});
$('popover').addEventListener('mouseover', () => clearTimeout(hoverCloseTimer));
$('popover').addEventListener('mouseout', e => { if (!$('popover').contains(e.relatedTarget)) scheduleHoverClose(); });
document.addEventListener('focusin', e => {
  if (restoringFocus) return;
  const trigger = e.target.closest('[data-help],[data-help-title]');
  if (trigger) showPopover(trigger, false);
});
document.addEventListener('focusout', e => {
  const trigger = e.target.closest('[data-help],[data-help-title]');
  if (trigger) scheduleHoverClose();
});
document.addEventListener('click', e => {
  const trigger = e.target.closest('[data-help],[data-help-title]');
  if (trigger) {
    if (popTrigger === trigger && popPinned) { closePopover(); return; }
    showPopover(trigger, true);
    $('popover').setAttribute('tabindex', '-1'); $('popover').focus();
    return;
  }
  if (popTrigger && !e.target.closest('.popover')) closePopover();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && popTrigger) closePopover(); });
$('popClose').onclick = () => closePopover();
$('popLinks').addEventListener('click', e => {
  const b = e.target.closest('.pop-link'); if (!b) return;
  closePopover(true); statusAction(b.dataset.act);
});
$('popScrim').onclick = () => closePopover();
}
