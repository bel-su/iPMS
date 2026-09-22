'use client';
import { FormEvent, useState } from 'react';

export default function LoginPage() {
  const [message, setMessage] = useState<string>();

  /**
   * Read from the URL rather than passed in as a prop: this is a client
   * component, and `changePasswordAction` lands here with `?changed=1` after
   * bumping the token version, which has already signed the browser out.
   */
  const justChanged = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('changed') === '1';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(undefined);
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) });
    if (!response.ok) { setMessage((await response.json() as { message: string }).message); return; }

    // An account owing a password change holds a token with no permissions, so
    // the workspace would only show a forbidden state. Send them somewhere
    // that works.
    const payload = await response.json() as { mustChangePassword?: boolean };
    window.location.assign(payload.mustChangePassword ? '/change-password' : '/');
  }

  return <main className="login-page"><form className="login-card" onSubmit={submit}><a className="brand" href="/"><span>i</span>PMS</a><p className="eyebrow">SECURE WORKSPACE</p><h1>Sign in to iPMS</h1><p>Use an account created by your administrator.</p>{justChanged && <p className="form-note" role="status">Your password has been changed. Sign in with the new one.</p>}<label>Username<input name="username" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>{message && <p className="form-error" role="alert">{message}</p>}<button className="primary-button" type="submit">Sign in</button></form></main>;
}
