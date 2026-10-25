import { useEffect } from 'react';
import { refreshMe, useAuth } from './auth.js';
import { AuthScreens } from './AuthScreens.jsx';
import { dismissToast, useToasts } from './toast.js';

export function Toaster() {
  const items = useToasts();
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map(t => <div key={t.id} className={'toast ' + t.kind} onClick={() => dismissToast(t.id)}>{t.message}</div>)}
    </div>
  );
}

/** Nothing of the dashboard renders (or fetches) until /me has answered: no flash of protected content. Unauthenticated -> sign-in at
    /login (the #hash of the page they asked for is kept, so a permitted deep link opens after sign-in); /reset-password is its own screen;
    a pending forced password change shows the change screen and nothing else. */
export function AuthGate({ children }) {
  const s = useAuth();
  useEffect(() => { refreshMe(); }, []);
  useEffect(() => {
    const { pathname, search, hash } = location;
    if (s.phase === 'anon' && pathname !== '/login' && pathname !== '/reset-password') history.replaceState(null, '', '/login' + search + hash);
    if ((s.phase === 'authed' || s.phase === 'pwchange') && (pathname === '/login')) history.replaceState(null, '', '/' + search + hash);
  }, [s.phase]);

  let body;
  if (location.pathname === '/reset-password') body = <AuthScreens key="reset" mode="reset" />;
  else if (s.phase === 'loading') body = <div className="au-page"><div className="au-splash"><span className="au-spin big" aria-label="Loading" /></div></div>;
  else if (s.phase === 'anon') body = <AuthScreens key="login" mode="login" />;
  else if (s.phase === 'pwchange') body = <AuthScreens key="change" mode="change" />;
  else body = children;
  return <>{body}<Toaster /></>;
}
