/* The one fetch wrapper for the whole app (store.api and the auth module both use it). Same-origin, cookie session, JSON in/out.
   Global error handling is injected by the auth module (setHttpHooks) so this file has no dependencies:
     401 -> the session is gone: clear it and show the sign-in screen
     403 PASSWORD_CHANGE_REQUIRED -> show the forced change-password screen
     403 otherwise -> a toast and a redirect to a page the user may open
   `quiet: true` skips those hooks (login, forgot/reset password, /me probing). */
let hooks = { onUnauthorized() {}, onForbidden() {} };
export const setHttpHooks = h => { hooks = { ...hooks, ...h }; };

export async function request(path, opts = {}) {
  const { quiet, headers, ...rest } = opts;
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...rest,
    // X-AIF-Client: the API refuses state-changing requests without it (CSRF defence, see backend/analytics/auth/middleware.py)
    headers: { 'Content-Type': 'application/json', 'X-AIF-Client': 'web', ...(headers || {}) },
  });
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) {
    const err = new Error(body.error || body.message || `HTTP ${res.status}`);
    err.status = res.status; err.code = body.code; err.field = body.field; err.body = body;
    if (!quiet) {
      if (res.status === 401) hooks.onUnauthorized(err);
      else if (res.status === 403) hooks.onForbidden(err);
    }
    throw err;
  }
  return body;
}
