import { ICONS } from '../lib/icons.js';

/** Inline Lucide-style icon (no icon library) — same markup as the source's icon(). */
export function Icon({ name }) {
  return <svg className="ico" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }} />;
}
