import { useAppState, set } from '../state/store.js';
import { Icon } from './Icon.jsx';

/** The hamburger that opens the sidebar on narrow screens (the sidebar is an off-canvas drawer below 1080px). Hidden by CSS on desktop. */
export function MenuButton() {
  const st = useAppState();
  return (
    <button type="button" className="menu-btn" id="menuBtn" aria-label="Open menu" aria-controls="rail" aria-expanded={!!st.navOpen}
      onClick={() => set({ navOpen: !st.navOpen })}><Icon name="menu" /></button>
  );
}
