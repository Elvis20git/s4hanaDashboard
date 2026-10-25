/** The numbers on the Administration overview, worked out from the member list (pure, so it can be tested). `now` is a Date or ms. */
export const RECENT_DAYS = 7;

export function teamStats(users, now = Date.now()) {
  const t = +now, cutoff = t - RECENT_DAYS * 86400000;
  const out = { total: users.length, active: 0, inactive: 0, roles: { SUPERUSER: 0, ANALYST: 0, VIEWER: 0 }, stewards: 0, recent: 0, never: 0 };
  for (const u of users) {
    const on = u.status === 'ACTIVE';
    if (on) out.active++; else out.inactive++;
    out.roles[u.role] = (out.roles[u.role] || 0) + 1;     // role mix and stewards cover every registered member (as the list filters do)
    if (u.is_data_steward) out.stewards++;
    if (on) {                       // sign-in activity only describes people who can sign in
      const seen = u.last_login ? Date.parse(u.last_login) : NaN;
      if (Number.isNaN(seen)) out.never++; else if (seen >= cutoff) out.recent++;
    }
  }
  return out;
}

/** Does a member match an overview filter (the member list's filter select uses the same keys)? */
export function matchesFilter(u, filter, now = Date.now()) {
  if (filter === 'ALL') return true;
  if (filter === 'STEWARD') return !!u.is_data_steward;
  if (filter === 'INACTIVE') return u.status === 'INACTIVE';
  if (filter === 'NEVER' || filter === 'RECENT') {
    if (u.status !== 'ACTIVE') return false;
    const seen = u.last_login ? Date.parse(u.last_login) : NaN;
    return filter === 'NEVER' ? Number.isNaN(seen) : seen >= +now - RECENT_DAYS * 86400000;
  }
  return u.role === filter;
}
