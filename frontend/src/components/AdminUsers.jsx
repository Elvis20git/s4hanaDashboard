import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, useAppState } from '../state/store.js';
import { usePermissions, refreshMe } from '../auth/auth.js';
import { DASHBOARDS, DASHBOARD_KEYS, PRESETS, ROLES, dashboardLabel, passwordOk, passwordRules, roleLabel } from '../auth/permissions.js';
import { toast, toastErr, toastOk } from '../auth/toast.js';
import { Icon } from './Icon.jsx';
import { RECENT_DAYS, matchesFilter, teamStats } from '../lib/teamStats.js';

/* Administration (SUPERUSER only): stat cards, create-user form, team members list and the access-rights drawer.
   All writes go through /api/admin/* which re-checks the role on the server. */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const fmtLogin = iso => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never');
const blankForm = () => ({ username: '', password: '', email: '', display_name: '', job_title: '', department: '', role: 'ANALYST', is_data_steward: false, allowed_dashboards: [] });

function AccessGrid({ value, onChange, disabled, note }) {
  const set = new Set(value);
  const toggle = k => onChange(DASHBOARD_KEYS.filter(x => (x === k ? !set.has(x) : set.has(x))));
  return (
    <div className="adm-access">
      <div className="adm-access-head">
        <div><div className="adm-cap">Granular dashboard access rights</div><div className="adm-sub">Select specifically which dashboards this user is permitted to view or manage</div></div>
        <div className="adm-presets" role="group" aria-label="Quick select">
          <button type="button" disabled={disabled} onClick={() => onChange([...DASHBOARD_KEYS])}>Select All</button>
          <button type="button" disabled={disabled} onClick={() => onChange(PRESETS.finance)}>Finance Only</button>
          <button type="button" disabled={disabled} onClick={() => onChange(PRESETS.operations)}>Operations Only</button>
          <button type="button" disabled={disabled} onClick={() => onChange([])}>Clear All</button>
        </div>
      </div>
      <div className="adm-tiles">
        {DASHBOARDS.map(d => (
          <label key={d.key} className={'adm-tile' + (set.has(d.key) ? ' on' : '') + (disabled ? ' dis' : '')}>
            <Icon name={d.icon} /><span>{d.label}</span>
            <input type="checkbox" checked={set.has(d.key)} disabled={disabled} onChange={() => toggle(d.key)} aria-label={d.label} />
          </label>
        ))}
      </div>
      {note && <div className="adm-note">{note}</div>}
    </div>
  );
}

function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }) {
  useEffect(() => { const k = e => { if (e.key === 'Escape') onCancel(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onCancel]);
  return (
    <div className="adm-modal" role="alertdialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="adm-dialog" onClick={e => e.stopPropagation()}>
        <h4>{title}</h4><p>{body}</p>
        <div className="adm-dialog-btns"><button type="button" className="adm-btn ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className={'adm-btn ' + (danger ? 'danger' : 'primary')} onClick={onConfirm} autoFocus>{confirmLabel}</button></div>
      </div>
    </div>
  );
}

function Field({ label, error, children, required }) {
  return <label className="adm-field"><span className="adm-fl">{label}{required ? ' *' : ''}</span>{children}{error ? <span className="adm-err">{error}</span> : null}</label>;
}

function CreateForm({ onCreated }) {
  const [f, setF] = useState(blankForm), [errs, setErrs] = useState({}), [busy, setBusy] = useState(false);
  const up = (k, v) => { setF(x => ({ ...x, [k]: v })); setErrs(e => ({ ...e, [k]: undefined })); };
  const superuser = f.role === 'SUPERUSER';
  const submit = async e => {
    e.preventDefault();
    const er = {};
    if (!f.username.trim()) er.username = 'Username is required.';
    if (!f.password) er.password = 'Password is required.'; else if (!passwordOk(f.password)) er.password = 'Needs 8+ characters with upper, lower, number and special.';
    if (!f.email.trim()) er.email = 'Email is required.'; else if (!EMAIL_RE.test(f.email.trim())) er.email = 'Enter a valid email address.';
    setErrs(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ ...f, username: f.username.trim(), email: f.email.trim(), allowed_dashboards: superuser ? DASHBOARD_KEYS : f.allowed_dashboards }) });
      toastOk(`User ${f.username.trim()} created — they must set a new password on first login.`);
      setF(blankForm()); onCreated();
    } catch (ex) {
      if (ex.field) setErrs({ [ex.field]: ex.message }); else toastErr(ex.message);
    } finally { setBusy(false); }
  };
  const missing = f.password && !passwordOk(f.password) ? passwordRules(f.password).filter(r => !r.ok).map(r => r.label).join(', ') : '';
  return (
    <form className="adm-card" onSubmit={submit} noValidate>
      <div className="adm-card-h"><div className="adm-card-t"><span className="adm-num">1</span>Create new user &amp; configure access</div>
        <button type="button" className="adm-link" onClick={() => { setF(blankForm()); setErrs({}); }}>Clear / Cancel</button></div>
      <div className="adm-card-b">
        <div className="adm-grid3">
          <Field label="Username" required error={errs.username}><input className="adm-in" value={f.username} onChange={e => up('username', e.target.value)} placeholder="e.g. jdoe" autoComplete="off" /></Field>
          <Field label="Password" required error={errs.password}><input className="adm-in" type="password" value={f.password} onChange={e => up('password', e.target.value)} placeholder="••••••••••••" autoComplete="new-password" />
            {missing && !errs.password ? <span className="adm-hint">Still needs: {missing}</span> : null}</Field>
          <Field label="Email" required error={errs.email}><input className="adm-in" value={f.email} onChange={e => up('email', e.target.value)} placeholder="j.doe@africaimprovedfoods.com" autoComplete="off" /></Field>
          <Field label="Display name"><input className="adm-in" value={f.display_name} onChange={e => up('display_name', e.target.value)} placeholder="e.g. John Doe" /></Field>
          <Field label="Job title"><input className="adm-in" value={f.job_title} onChange={e => up('job_title', e.target.value)} placeholder="e.g. Senior Financial Analyst" /></Field>
          <div className="adm-twin">
            <Field label="Department"><input className="adm-in" value={f.department} onChange={e => up('department', e.target.value)} placeholder="e.g. Finance" /></Field>
            <Field label="Role"><select className="adm-in" value={f.role} onChange={e => up('role', e.target.value)}>{ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}</select></Field>
          </div>
        </div>
        <AccessGrid value={superuser ? DASHBOARD_KEYS : f.allowed_dashboards} onChange={v => up('allowed_dashboards', v)} disabled={superuser}
          note={superuser ? 'Superusers have access to all dashboards' : null} />
        <div className="adm-row">
          <label className="adm-chk"><input type="checkbox" checked={f.is_data_steward} onChange={e => up('is_data_steward', e.target.checked)} />Data steward (can upload files &amp; modify S/4HANA datasets)</label>
          <button className="adm-btn primary" type="submit" disabled={busy}>{busy ? 'Creating…' : '+ Create User'}</button>
        </div>
      </div>
    </form>
  );
}

function MemberCard({ u, onEdit, onDeactivate }) {
  const sup = u.role === 'SUPERUSER', inactive = u.status === 'INACTIVE';
  return (
    <div className={'adm-member' + (inactive ? ' off' : '')}>
      <div className="adm-av" aria-hidden="true">{(u.display_name || u.username).charAt(0).toUpperCase()}</div>
      <div className="adm-mid">
        <div className="adm-name">{u.display_name || u.username}
          <span className={'adm-badge r-' + u.role.toLowerCase()}>{roleLabel(u.role)}</span>
          {u.is_data_steward ? <span className="adm-badge steward">Data Steward</span> : null}
          {inactive ? <span className="adm-badge inactive">Inactive</span> : null}
          {u.must_change_password ? <span className="adm-badge otp">Temp password</span> : null}
        </div>
        <div className="adm-meta">@{u.username} · Last login {fmtLogin(u.last_login)}</div>
      </div>
      <div className="adm-pills">
        {sup ? <span className="adm-pill all">All dashboards</span>
          : u.allowed_dashboards.length ? u.allowed_dashboards.map(k => <span key={k} className="adm-pill">{dashboardLabel(k)}</span>) : <i className="adm-none">no dashboards</i>}
      </div>
      <button type="button" className="adm-btn outline" onClick={() => onEdit(u)}>Manage Profile</button>
      <button type="button" className="adm-trash" onClick={() => onDeactivate(u)} disabled={inactive} aria-label={`Deactivate ${u.username}`} title={inactive ? 'Already inactive' : 'Deactivate'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 11v6M14 11v6" /></svg>
      </button>
    </div>
  );
}

function EditDrawer({ user, me, lastSuper, onClose, onSaved }) {
  const init = useMemo(() => ({ display_name: user.display_name, email: user.email, job_title: user.job_title, department: user.department, role: user.role, is_data_steward: user.is_data_steward, allowed_dashboards: user.allowed_dashboards }), [user]);
  const [f, setF] = useState(init), [errs, setErrs] = useState({}), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const isSelf = user.id === me.id;
  const inactive = user.status === 'INACTIVE';
  const protectedSuper = user.role === 'SUPERUSER' && (isSelf || lastSuper);
  const superuser = f.role === 'SUPERUSER';
  const up = (k, v) => { setF(x => ({ ...x, [k]: v })); setErrs(e => ({ ...e, [k]: undefined })); };
  const tryClose = () => (dirty ? setConfirm('discard') : onClose());
  useEffect(() => { const k = e => { if (e.key === 'Escape' && !confirm) tryClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); });

  const act = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); toastOk(okMsg); await onSaved(); }
    catch (ex) { if (ex.field) setErrs({ [ex.field]: ex.message }); else toastErr(ex.message); }
    finally { setBusy(false); }
  };
  const save = () => {
    if (!EMAIL_RE.test(f.email.trim())) { setErrs({ email: 'Enter a valid email address.' }); return; }
    act(async () => { await api(`/api/admin/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ ...f, email: f.email.trim(), allowed_dashboards: superuser ? DASHBOARD_KEYS : f.allowed_dashboards }) }); onClose(); }, `Changes saved for ${user.username}.`);
  };
  // the server says what really happened (emailed / only printed to the console in development / no provider / failed): show that, not a guess
  const sendReset = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/admin/users/${user.id}/reset-password`, { method: 'POST', body: '{}' });
      if (r.delivered) toastOk(r.message); else toast(r.message, 'info', 10000);
    } catch (ex) { toastErr(ex.message); }
    finally { setBusy(false); }
  };
  const forceChange = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/users/${user.id}/force-password-change`, { method: 'POST', body: '{}' });
      toastOk(`${user.username} will be required to change their password on next login.`);
      await onSaved();
      onClose();
    } catch (ex) { toastErr(ex.message); }
    finally { setBusy(false); }
  };
  const why = isSelf ? 'You cannot deactivate or demote your own account.' : 'This is the last active superuser; it cannot be deactivated or demoted.';
  return (
    <>
      <div className="adm-scrim" onClick={tryClose} />
      <aside className="adm-drawer" role="dialog" aria-modal="true" aria-label={`Manage profile for ${user.username}`}>
        <div className="adm-dr-h"><div><div className="adm-eyebrow">Manage profile</div><h3>{user.display_name || user.username}</h3><div className="adm-meta">@{user.username}{inactive ? ' · Inactive' : ''}</div></div>
          <button type="button" className="adm-x" onClick={tryClose} aria-label="Close">✕</button></div>
        <div className="adm-dr-b">
          <Field label="Username"><input className="adm-in" value={user.username} readOnly disabled /></Field>
          <Field label="Display name"><input className="adm-in" value={f.display_name} onChange={e => up('display_name', e.target.value)} /></Field>
          <Field label="Email" error={errs.email}><input className="adm-in" value={f.email} onChange={e => up('email', e.target.value)} /></Field>
          <div className="adm-twin"><Field label="Job title"><input className="adm-in" value={f.job_title} onChange={e => up('job_title', e.target.value)} /></Field>
            <Field label="Department"><input className="adm-in" value={f.department} onChange={e => up('department', e.target.value)} /></Field></div>
          <Field label="Role" error={errs.role}>
            <select className="adm-in" value={f.role} onChange={e => up('role', e.target.value)} disabled={protectedSuper} title={protectedSuper ? why : undefined}>{ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
            {protectedSuper ? <span className="adm-hint">{why}</span> : null}
          </Field>
          <label className="adm-chk"><input type="checkbox" checked={f.is_data_steward} onChange={e => up('is_data_steward', e.target.checked)} />Data steward (can upload files &amp; modify S/4HANA datasets)</label>
          <AccessGrid value={superuser ? DASHBOARD_KEYS : f.allowed_dashboards} onChange={v => up('allowed_dashboards', v)} disabled={superuser} note={superuser ? 'Superusers have access to all dashboards' : null} />
        </div>
        <div className="adm-dr-f">
          <div className="adm-dr-left">
            <button type="button" className="adm-btn outline" disabled={busy || inactive} onClick={sendReset}>Send password reset email</button>
            {!inactive && !user.must_change_password ? (
              <button type="button" className="adm-btn outline" disabled={busy} onClick={forceChange}>Force password change</button>
            ) : null}
            {inactive
              ? <button type="button" className="adm-btn outline" disabled={busy} onClick={() => act(() => api(`/api/admin/users/${user.id}/activate`, { method: 'POST', body: '{}' }), `${user.username} reactivated.`)}>Reactivate</button>
              : <button type="button" className="adm-btn danger-o" disabled={busy || protectedSuper} title={protectedSuper ? why : undefined} onClick={() => setConfirm('deactivate')}>Deactivate</button>}
          </div>
          <div className="adm-dr-right"><button type="button" className="adm-btn ghost" onClick={tryClose}>Cancel</button>
            <button type="button" className="adm-btn primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button></div>
        </div>
      </aside>
      {confirm === 'discard' && <ConfirmDialog title="Discard changes?" body="You have unsaved changes to this user. Closing now will lose them." confirmLabel="Discard" danger onConfirm={onClose} onCancel={() => setConfirm(null)} />}
      {confirm === 'deactivate' && <ConfirmDialog title={`Deactivate ${user.username}?`} body="They will be signed out on their next request and can no longer sign in. You can reactivate them later." confirmLabel="Deactivate" danger
        onConfirm={() => { setConfirm(null); act(async () => { await api(`/api/admin/users/${user.id}`, { method: 'DELETE' }); onClose(); }, `${user.username} deactivated.`); }} onCancel={() => setConfirm(null)} />}
    </>
  );
}

export function Admin() {
  const st = useAppState();
  const { user: me } = usePermissions();
  const [data, setData] = useState(null), [loadErr, setLoadErr] = useState(false);
  const [q, setQ] = useState(''), [filter, setFilter] = useState('ALL');
  const [editing, setEditing] = useState(null), [confirmOff, setConfirmOff] = useState(null);

  const load = useCallback(async () => {
    try { setData(await api('/api/admin/users')); setLoadErr(false); refreshMe(); }   // refreshMe: my own rights may have just changed
    catch { setLoadErr(true); }
  }, []);
  useEffect(() => {      // first load (later refreshes call load() after each change)
    let live = true;
    api('/api/admin/users').then(d => { if (live) { setData(d); setLoadErr(false); } }).catch(() => { if (live) setLoadErr(true); });
    return () => { live = false; };
  }, []);

  const users = useMemo(() => (data ? data.users : []), [data]);
  const lastSuper = u => u.role === 'SUPERUSER' && u.status === 'ACTIVE' && users.filter(x => x.role === 'SUPERUSER' && x.status === 'ACTIVE').length === 1;
  const shown = useMemo(() => users.filter(u => {
    const t = q.trim().toLowerCase();
    if (t && !`${u.display_name} ${u.username} ${u.email}`.toLowerCase().includes(t)) return false;
    return matchesFilter(u, filter);
  }), [users, q, filter]);
  const stats = useMemo(() => teamStats(users), [users]);
  const listRef = useRef(null);
  // an overview card filters the member list below it (a second click clears the filter)
  const pick = f => { setFilter(cur => (cur === f ? 'ALL' : f)); setQ(''); requestAnimationFrame(() => listRef.current && listRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })); };

  const deactivate = async u => {
    setConfirmOff(null);
    try { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); toastOk(`${u.username} deactivated.`); load(); } catch (ex) { toastErr(ex.message); }
  };
  return (
    <section className={'page' + (st.page === 'admin' ? ' on' : '')} id="page-admin">
      <div className="adm-me">
        <span>Signed in as <b>{me ? (me.display_name || me.username) : '—'}</b>{me && me.email ? <> · {me.email}</> : null}</span>
        <span className={'adm-badge r-' + (me ? me.role.toLowerCase() : 'viewer')}>{me ? roleLabel(me.role) : ''}</span>
        <span className="adm-me-sub">{me && me.role === 'SUPERUSER' ? `All ${DASHBOARD_KEYS.length} dashboards granted` : me ? `${me.allowed_dashboards.length} dashboard(s) granted` : ''}</span>
      </div>
      <div className="adm-stats" role="group" aria-label="Team overview — select a card to filter the member list">
        <button type="button" className={'adm-stat' + (filter === 'ALL' ? ' on' : '')} aria-pressed={filter === 'ALL'} onClick={() => pick('ALL')}>
          <span className="adm-cap">Team members</span>
          <b className="adm-big">{data ? stats.total : '–'}</b>
          <span className="adm-ctx">{data ? <>{stats.active} active{stats.inactive ? <> · <span className="warn">{stats.inactive} inactive</span></> : null}</> : ' '}</span>
        </button>
        <div className="adm-stat adm-roles">
          <span className="adm-cap">Role mix</span>
          <div className="adm-bar" aria-hidden="true">{data && stats.total ? ROLES.map(r => <i key={r.key} className={'r-' + r.key.toLowerCase()} style={{ flexGrow: stats.roles[r.key] || 0 }} />) : null}</div>
          <div className="adm-leg">
            {ROLES.map(r => (
              <button key={r.key} type="button" className={'adm-leg-b' + (filter === r.key ? ' on' : '')} aria-pressed={filter === r.key} onClick={() => pick(r.key)}>
                <i className={'r-' + r.key.toLowerCase()} /><span>{r.label}</span><b>{data ? stats.roles[r.key] || 0 : '–'}</b>
              </button>
            ))}
          </div>
        </div>
        <button type="button" className={'adm-stat' + (filter === 'STEWARD' ? ' on' : '')} aria-pressed={filter === 'STEWARD'} onClick={() => pick('STEWARD')}>
          <span className="adm-cap">Data stewards</span>
          <b className="adm-big">{data ? stats.stewards : '–'}</b>
          <span className="adm-ctx">Can upload files &amp; modify datasets</span>
        </button>
        <button type="button" className={'adm-stat' + (filter === 'RECENT' ? ' on' : '')} aria-pressed={filter === 'RECENT'} onClick={() => pick('RECENT')}>
          <span className="adm-cap">Active in {RECENT_DAYS} days</span>
          <b className="adm-big">{data ? stats.recent : '–'}</b>
          <span className="adm-ctx">{data ? (stats.never ? <span className="warn">{stats.never} never signed in</span> : 'Everyone has signed in') : ' '}</span>
        </button>
      </div>

      <CreateForm onCreated={load} />

      <div className="adm-card" ref={listRef}>
        <div className="adm-card-h wrap">
          <div><div className="adm-card-t">Registered team members &amp; access permissions</div><div className="adm-sub">Manage user status, change active role badges, and update dashboard permissions</div></div>
          <div className="adm-tools">
            <input className="adm-in search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search members or handles…" aria-label="Search members" />
            <select className="adm-in" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter members">
              <option value="ALL">All members</option>{ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}<option value="STEWARD">Data stewards</option><option value="RECENT">Active in {RECENT_DAYS} days</option><option value="NEVER">Never signed in</option><option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>
        <div className="adm-list">
          {loadErr ? <div className="adm-empty">Could not load users. <button type="button" className="adm-link" onClick={load}>Retry</button></div>
            : !data ? [0, 1, 2].map(i => <div key={i} className="adm-member skel"><div className="adm-av" /><div className="adm-mid"><div className="sk w40" /><div className="sk w25" /></div></div>)
            : shown.length ? shown.map(u => <MemberCard key={u.id} u={u} onEdit={setEditing} onDeactivate={x => (x.id === me.id || lastSuper(x) ? toastErr(x.id === me.id ? 'You cannot deactivate your own account.' : 'You cannot deactivate the last active superuser.') : setConfirmOff(x))} />)
            : <div className="adm-empty">No members match this search.</div>}
        </div>
      </div>

      {editing && <EditDrawer key={editing.id} user={editing} me={me} lastSuper={lastSuper(editing)} onClose={() => setEditing(null)} onSaved={load} />}
      {confirmOff && <ConfirmDialog title={`Deactivate ${confirmOff.username}?`} body="They will be signed out on their next request and can no longer sign in. You can reactivate them later." confirmLabel="Deactivate" danger onConfirm={() => deactivate(confirmOff)} onCancel={() => setConfirmOff(null)} />}
    </section>
  );
}
