import { HELP } from '../lib/copy.js';

/** The ⓘ / ? trigger of the shared popover (the engine finds it by data-help / data-help-title). Static copy comes from HELP by
    key; a dynamic one carries its own title/body. */
export function HelpIcon({ k, title, body, cls = 'help-ico', label = '?', ariaLabel, ...rest }) {
  const h = k ? HELP[k] : null;
  const name = h ? h.title : title;
  return (
    <button type="button" className={cls} {...(k ? { 'data-help': k } : { 'data-help-title': title, 'data-help-body': body })}
      aria-haspopup="dialog" aria-expanded="false" aria-label={ariaLabel || `${name} — more info`} {...rest}>{label}</button>
  );
}
