import { useMemo, useState } from 'react';
import { changePassword, forgotPassword, login, logout, resetPassword } from './auth.js';
import { passwordOk, passwordRules } from './permissions.js';
import { toastOk } from './toast.js';

/* The sign-in container: one glass card that animates between Login, Forgot password, Reset password and the forced Change password
   screen. Layout and look follow the design reference (dark green glass, mint glow, green CTA). The top bar pills, the Microsoft 365
   button and the footer links are visual only here (the palette switcher, SSO and the help page are not part of this app yet). */

const Eye = ({ off }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    {off
      ? <path d="M12 6c3.8 0 7.2 2.2 9 6-.7 1.5-1.7 2.8-3 3.8l1.5 1.5-1.4 1.4L4.4 5.4 5.8 4l2 2A9.6 9.6 0 0 1 12 6Zm-9 6c.7-1.5 1.7-2.8 3-3.8l2.1 2.1a4 4 0 0 0 5.6 5.6l1.5 1.5A9.8 9.8 0 0 1 12 18c-3.8 0-7.2-2.2-9-6Zm9-2a2 2 0 0 1 2 2l-2-2Z" />
      : <path d="M12 5c4.4 0 8.3 2.6 10 7-1.7 4.4-5.6 7-10 7S3.7 16.4 2 12c1.7-4.4 5.6-7 10-7Zm0 3.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Zm0 2A1.5 1.5 0 1 1 12 13.5 1.5 1.5 0 0 1 12 10.5Z" />}
  </svg>
);
const Spinner = () => <span className="au-spin" aria-hidden="true" />;

function PasswordField({ id, label, value, onChange, autoComplete, placeholder, right }) {
  const [show, setShow] = useState(false);
  return (
    <div className="au-field">
      <div className="au-label-row"><label htmlFor={id}>{label}</label>{right}</div>
      <div className="au-input au-pw">
        <input id={id} type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} autoComplete={autoComplete} placeholder={placeholder} />
        <button type="button" className="au-eye" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}><Eye off={show} /></button>
      </div>
    </div>
  );
}

export function StrengthChecklist({ password, confirm }) {
  const rules = passwordRules(password);
  return (
    <ul className="au-rules" aria-label="Password requirements">
      {rules.map(r => <li key={r.id} className={r.ok ? 'ok' : ''}><i aria-hidden="true">{r.ok ? '✓' : '•'}</i>{r.label}</li>)}
      {confirm !== undefined && <li className={confirm && password === confirm ? 'ok' : ''}><i aria-hidden="true">{confirm && password === confirm ? '✓' : '•'}</i>Passwords match</li>}
    </ul>
  );
}

function LoginView({ goForgot }) {
  const [id, setId] = useState(''), [pw, setPw] = useState(''), [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const submit = async e => {
    e.preventDefault();
    if (busy) return;
    if (!id.trim() || !pw) { setErr('Enter your username and password.'); return; }
    setErr(''); setBusy(true);
    try { await login(id.trim(), pw, remember); }
    catch (ex) { setErr(ex.status === 401 ? 'Invalid username or password' : ex.message || 'Could not sign in.'); setBusy(false); }
  };
  return (
    <form onSubmit={submit} noValidate>
      {err && <div className="au-error" role="alert">{err}</div>}
      <div className="au-field">
        <div className="au-label-row"><label htmlFor="au-user">Username</label></div>
        <div className="au-input"><input id="au-user" value={id} onChange={e => setId(e.target.value)} placeholder="Enter username or email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus /></div>
      </div>
      <PasswordField id="au-pass" label="Password" value={pw} onChange={setPw} autoComplete="current-password" placeholder="Enter password"
        right={<button type="button" className="au-link" onClick={goForgot}>Forgot password?</button>} />
      <label className="au-check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span>Remember this device</span></label>
      <button className="au-cta" type="submit" disabled={busy}>{busy ? <><Spinner />Signing in…</> : 'Sign in'}</button>
      <div className="au-or"><span>OR SINGLE SIGN-ON</span></div>
      <button type="button" className="au-sso" title="Single sign-on is not configured yet">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><rect x="1" y="1" width="7.5" height="7.5" fill="#F25022" /><rect x="9.5" y="1" width="7.5" height="7.5" fill="#7FBA00" /><rect x="1" y="9.5" width="7.5" height="7.5" fill="#00A4EF" /><rect x="9.5" y="9.5" width="7.5" height="7.5" fill="#FFB900" /></svg>
        Sign in with Microsoft 365
      </button>
    </form>
  );
}

function ForgotView({ back }) {
  const [ident, setIdent] = useState(''), [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [err, setErr] = useState('');
  const submit = async e => {
    e.preventDefault();
    if (busy) return;
    setErr(''); setBusy(true);
    try { await forgotPassword(ident.trim()); setSent(true); }
    catch (ex) { setErr(ex.message || 'Could not send the request.'); }
    setBusy(false);
  };
  if (sent) {
    return (
      <div className="au-center">
        <div className="au-badge-ok" aria-hidden="true">✓</div>
        <h2 className="au-h2">Check your email</h2>
        <p className="au-muted">If an account exists, check your email for a reset link and a 6-digit code. The link works once and expires in 15 minutes.</p>
        <button type="button" className="au-cta" onClick={() => { location.assign('/reset-password'); }}>I have a code</button>
        <button type="button" className="au-link au-back" onClick={back}>Back to sign in</button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} noValidate>
      <h2 className="au-h2">Reset your password</h2>
      <p className="au-muted">Enter the email or username of your account and we'll send a reset link and a 6-digit code.</p>
      {err && <div className="au-error" role="alert">{err}</div>}
      <div className="au-field">
        <div className="au-label-row"><label htmlFor="au-ident">Email or username</label></div>
        <div className="au-input"><input id="au-ident" value={ident} onChange={e => setIdent(e.target.value)} placeholder="Enter email or username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus /></div>
      </div>
      <button className="au-cta" type="submit" disabled={busy || !ident.trim()}>{busy ? <><Spinner />Sending…</> : 'Send reset link / code'}</button>
      <button type="button" className="au-link au-back" onClick={back}>Back to sign in</button>
    </form>
  );
}

function ResetView() {
  const token = useMemo(() => new URLSearchParams(location.search).get('token') || '', []);
  const [ident, setIdent] = useState(''), [code, setCode] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [done, setDone] = useState(false);
  const valid = passwordOk(pw) && pw === pw2 && (token || (ident.trim() && /^\d{6}$/.test(code)));
  const submit = async e => {
    e.preventDefault();
    if (busy || !valid) return;
    setErr(''); setBusy(true);
    try {
      await resetPassword(token ? { token, new_password: pw } : { identifier: ident.trim(), code, new_password: pw });
      setDone(true); toastOk('Password successfully updated.');
      setTimeout(() => location.replace('/login'), 2000);
    } catch (ex) { setErr(ex.message || 'Could not reset the password.'); setBusy(false); }
  };
  if (done) return <div className="au-center"><div className="au-badge-ok" aria-hidden="true">✓</div><h2 className="au-h2">Password updated</h2><p className="au-muted">Taking you to the sign-in screen…</p></div>;
  return (
    <form onSubmit={submit} noValidate>
      <h2 className="au-h2">Choose a new password</h2>
      {err && <div className="au-error" role="alert">{err}</div>}
      {!token && <>
        <div className="au-field"><div className="au-label-row"><label htmlFor="au-rident">Email or username</label></div>
          <div className="au-input"><input id="au-rident" value={ident} onChange={e => setIdent(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus /></div></div>
        <div className="au-field"><div className="au-label-row"><label htmlFor="au-code">6-digit code</label></div>
          <div className="au-input"><input id="au-code" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" /></div></div>
      </>}
      <PasswordField id="au-new" label="New password" value={pw} onChange={setPw} autoComplete="new-password" />
      <PasswordField id="au-new2" label="Confirm new password" value={pw2} onChange={setPw2} autoComplete="new-password" />
      <StrengthChecklist password={pw} confirm={pw2} />
      <button className="au-cta" type="submit" disabled={busy || !valid}>{busy ? <><Spinner />Updating…</> : 'Update password'}</button>
      <button type="button" className="au-link au-back" onClick={() => location.assign('/login')}>Back to sign in</button>
    </form>
  );
}

function ChangeView() {
  const [cur, setCur] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const valid = cur && passwordOk(pw) && pw === pw2 && pw !== cur;
  const submit = async e => {
    e.preventDefault();
    if (busy || !valid) return;
    setErr(''); setBusy(true);
    try { await changePassword(cur, pw); toastOk('Password updated.'); }
    catch (ex) { setErr(ex.message || 'Could not update the password.'); setBusy(false); }
  };
  return (
    <form onSubmit={submit} noValidate>
      <h2 className="au-h2">Set a new password</h2>
      <p className="au-muted">For security you must choose a new password before continuing.</p>
      {err && <div className="au-error" role="alert">{err}</div>}
      <PasswordField id="au-cur" label="Current password" value={cur} onChange={setCur} autoComplete="current-password" />
      <PasswordField id="au-new" label="New password" value={pw} onChange={setPw} autoComplete="new-password" />
      <PasswordField id="au-new2" label="Confirm new password" value={pw2} onChange={setPw2} autoComplete="new-password" />
      <StrengthChecklist password={pw} confirm={pw2} />
      {pw && cur && pw === cur && <div className="au-hint">The new password must be different from the current one.</div>}
      <button className="au-cta" type="submit" disabled={busy || !valid}>{busy ? <><Spinner />Updating…</> : 'Update password'}</button>
      <button type="button" className="au-link au-back" onClick={logout}>Sign out</button>
    </form>
  );
}

export function AuthScreens({ mode }) {          // mode: 'login' | 'reset' | 'change'
  const [view, setView] = useState(mode === 'reset' ? 'reset' : mode === 'change' ? 'change' : 'login');
  let body;
  if (view === 'forgot') body = <ForgotView back={() => setView('login')} />;
  else if (view === 'reset') body = <ResetView />;
  else if (view === 'change') body = <ChangeView />;
  else body = <LoginView goForgot={() => setView('forgot')} />;
  return (
    <div className="au-page">
      <div className="au-top">
        <span className="au-pill"><i className="au-dot" />SAP S/4HANA Connected</span>
        <span className="au-spacer" />
        <button type="button" className="au-pill au-btn" title="Palette switcher"><i className="au-pal" />Palette Switcher<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6" /></svg></button>
        <button type="button" className="au-help" aria-label="Help">?</button>
      </div>
      <div className="au-brand">
        <div className="au-mark">A</div>
        <div><h1>AIF Analytics</h1><p>Sales &amp; margin from S/4HANA</p></div>
      </div>
      <div className="au-card"><div className="au-view" key={view}>{body}</div></div>
      <div className="au-foot">
        <div className="au-company">Africa Improved Foods · Kigali</div>
        <div className="au-links"><a href="#privacy" onClick={e => e.preventDefault()}>Privacy Policy</a><b>•</b><a href="#terms" onClick={e => e.preventDefault()}>Terms of Service</a><b>•</b><a href="#support" onClick={e => e.preventDefault()}>Support</a></div>
      </div>
    </div>
  );
}
