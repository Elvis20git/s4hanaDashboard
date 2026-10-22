import { MODULES } from '../lib/modules.js';
import { useAppState, loadStatus, set } from '../state/store.js';
import { go } from '../state/nav.js';
import { Icon } from './Icon.jsx';

/** The left rail — brand, the module registry rendered in its two groups, and the signed-in user. */
export function Sidebar() {
  const st = useAppState();
  const item = m => (
    <a key={m.route} className={[m.status === 'soon' ? 'soon-item' : '', st.page === m.route ? 'on' : ''].filter(Boolean).join(' ')}
       data-page={m.route} href="#" onClick={e => { e.preventDefault(); go(m.route); }}>
      <Icon name={m.icon} />{m.label}{m.status === 'soon' ? <span className="soon">SOON</span> : null}
    </a>
  );
  const u = st.status && st.status.user;
  // Signing out clears the user so restricted actions ask for sign-in again; "Sign in" when signed out goes to Administration.
  const onSign = async () => { if (u) { set({ user: '' }); await loadStatus(); } else { go('admin'); } };
  return (
    <aside className="rail">
      <div className="brand"><div className="mark">A</div><div><h1>AIF Analytics</h1><span>S/4HANA</span></div></div>
      <nav className="nav" id="nav">
        <div id="navModules">{MODULES.filter(m => m.group === 'modules').map(item)}</div>
        <div className="rail-divider" />
        <div id="navGovernance">{MODULES.filter(m => m.group === 'governance').map(item)}</div>
      </nav>
      <div className="foot" id="railFoot">
        {st.status ? (
          <>
            <div className="user">{u ? u.name : 'Not signed in'}</div>
            <button type="button" className="signout" id="signOutBtn" onClick={onSign}>{u ? 'Sign out' : 'Sign in'}</button>
          </>
        ) : null}
      </div>
    </aside>
  );
}
