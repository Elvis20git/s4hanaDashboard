import { useEffect } from 'react';
import { MODULES } from '../lib/modules.js';
import { useAppState, set } from '../state/store.js';
import { logout, usePermissions } from '../auth/auth.js';
import { go } from '../state/nav.js';
import { Icon } from './Icon.jsx';

/** The left rail — brand, the module registry rendered in its two groups, and the signed-in user. */
export function Sidebar() {
  const st = useAppState();
  const perms = usePermissions();
  const open = !!st.navOpen;
  const close = () => set({ navOpen: false });
  // the drawer closes on Escape and when the window grows to desktop width (where the rail is always shown)
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') set({ navOpen: false }); };
    const mq = window.matchMedia('(min-width:1081px)');
    const onMq = () => { if (mq.matches) set({ navOpen: false }); };
    document.addEventListener('keydown', onKey);
    if (mq.addEventListener) mq.addEventListener('change', onMq); else mq.addListener(onMq);
    return () => { document.removeEventListener('keydown', onKey); if (mq.removeEventListener) mq.removeEventListener('change', onMq); else mq.removeListener(onMq); };
  }, []);
  // keep the page behind the open drawer from scrolling
  useEffect(() => { document.documentElement.classList.toggle('nav-locked', open); return () => document.documentElement.classList.remove('nav-locked'); }, [open]);
  // only what the user may open is listed (no greyed-out or locked items); Administration is SUPERUSER-only
  const visible = m => perms.canViewRoute(m.route);
  const item = m => (
    <a key={m.route} className={[m.status === 'soon' ? 'soon-item' : '', st.page === m.route ? 'on' : ''].filter(Boolean).join(' ')}
       data-page={m.route} href="#" onClick={e => { e.preventDefault(); go(m.route); close(); }}>
      <Icon name={m.icon} />{m.label}{m.status === 'soon' ? <span className="soon">SOON</span> : null}
    </a>
  );
  const u = perms.user;
  return (
    <>
    <div className={'nav-scrim' + (open ? ' show' : '')} onClick={close} aria-hidden="true" />
    <aside className={'rail' + (open ? ' open' : '')} id="rail" aria-label="Main menu">
      <div className="brand"><div className="mark">A</div><div><h1>AIF Analytics</h1><span>S/4HANA</span></div>
        <button type="button" className="rail-close" aria-label="Close menu" onClick={close}><Icon name="x" /></button></div>
      <nav className="nav" id="nav">
        <div id="navModules">{MODULES.filter(m => m.group === 'modules' && visible(m)).map(item)}</div>
        <div className="rail-divider" />
        <div id="navGovernance">{MODULES.filter(m => m.group === 'governance' && visible(m)).map(item)}</div>
      </nav>
      <div className="foot" id="railFoot">
        {u ? (
          <>
            <div className="user">{u.display_name || u.username}</div>
            <button type="button" className="signout" id="signOutBtn" onClick={logout}>Sign out</button>
          </>
        ) : null}
      </div>
    </aside>
    </>
  );
}
