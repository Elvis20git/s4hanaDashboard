/* Authentication state: who is signed in, what they may open, and the actions of the sign-in flow. An external store like the rest of
   the app (useSyncExternalStore). The session itself is an httpOnly cookie set by the API; the browser never sees the token.
   phase: 'loading' (asking /me) | 'anon' | 'pwchange' (signed in, must set a new password) | 'authed' */
import { useSyncExternalStore } from 'react';
import { request, setHttpHooks } from '../lib/http.js';
import { DASHBOARD_KEYS, DASHBOARDS, ADMIN_ROUTE, routeToKey } from './permissions.js';
import { toast } from './toast.js';

let state = { phase: 'loading', user: null };
const subs = new Set();
export const getAuth = () => state;
const subscribe = f => { subs.add(f); return () => subs.delete(f); };
function set(patch) { state = { ...state, ...patch }; subs.forEach(f => f()); }

const apply = body => set(body && body.user
  ? { user: body.user, phase: (body.must_change_password || body.user.must_change_password) ? 'pwchange' : 'authed' }
  : { user: null, phase: 'anon' });

/** Ask the API who we are (page load, window focus, after a permission change). A 401 simply means "not signed in". */
export async function refreshMe() {
  try { apply(await request('/api/auth/me', { quiet: true })); }
  catch (e) { if (e.status === 401 || state.phase === 'loading') apply(null); }
}

export async function login(identifier, password, remember) {
  const body = await request('/api/auth/login', { method: 'POST', quiet: true, body: JSON.stringify({ username_or_email: identifier, password, remember }) });
  apply(body);
  return body;
}

/** Full reload after leaving: the in-memory dashboard data of the previous user must not survive in this tab. */
export async function logout() {
  try { await request('/api/auth/logout', { method: 'POST', quiet: true, body: '{}' }); } catch { /* the cookie expires anyway */ }
  location.replace('/login');
}

export const forgotPassword = identifier => request('/api/auth/forgot-password', { method: 'POST', quiet: true, body: JSON.stringify({ identifier }) });
export const resetPassword = payload => request('/api/auth/reset-password', { method: 'POST', quiet: true, body: JSON.stringify(payload) });
export async function changePassword(current_password, new_password) {
  const body = await request('/api/auth/change-password', { method: 'POST', quiet: true, body: JSON.stringify({ current_password, new_password }) });
  apply({ user: body.user, must_change_password: false });
  return body;
}

// ---- permissions ------------------------------------------------------------------------------------------------------------
const allowed = u => (u ? u.allowed_dashboards || [] : []);
export const canViewKey = (u, key) => !!u && (u.role === 'SUPERUSER' || allowed(u).includes(key));
export const canViewRoute = (u, route) => {
  if (!u) return false;
  if (route === ADMIN_ROUTE) return u.role === 'SUPERUSER';
  const key = routeToKey(route);
  return key ? canViewKey(u, key) : route === 'overview';
};
/** The first route this user may open (dashboards in sidebar order), Administration last, else null (the empty state). */
export function firstAllowedRoute(u = state.user) {
  const d = DASHBOARDS.find(x => canViewKey(u, x.key));
  return d ? d.route : (u && u.role === 'SUPERUSER' ? ADMIN_ROUTE : null);
}

export function usePermissions() {
  const s = useSyncExternalStore(subscribe, getAuth);
  const u = s.user;
  return {
    phase: s.phase, user: u,
    isSuperuser: !!u && u.role === 'SUPERUSER',
    isDataSteward: !!u && (u.role === 'SUPERUSER' || !!u.is_data_steward),
    canExport: !!u && !!u.can_export,
    allowedDashboards: u ? (u.role === 'SUPERUSER' ? DASHBOARD_KEYS : allowed(u)) : [],
    canView: key => canViewKey(u, key),
    canViewRoute: route => canViewRoute(u, route),
    firstAllowedRoute: () => firstAllowedRoute(u),
  };
}
export const useAuth = () => useSyncExternalStore(subscribe, getAuth);

// ---- global HTTP error handling + keeping permissions fresh -------------------------------------------------------------------
setHttpHooks({
  onUnauthorized() {                                  // the session ended (expired, deactivated, password changed elsewhere)
    if (state.phase === 'anon') return;
    toast('Your session has ended. Please sign in again.', 'err');
    set({ user: null, phase: 'anon' });
  },
  onForbidden(err) {
    if (err.code === 'PASSWORD_CHANGE_REQUIRED') { refreshMe(); return; }
    toast(err.message || 'You do not have access to that.', 'err');
    refreshMe();                                       // permissions may have changed: re-read them; the router then moves the user
  },
});
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => { if (state.phase === 'authed' || state.phase === 'pwchange') refreshMe(); });
}
