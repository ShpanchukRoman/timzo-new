'use client';
import { useEffect, useRef, useState } from 'react';
import { handleAuthCallback, getUser, acceptInvite, updateUser } from '@netlify/identity';

export default function AuthLanding() {
  const started = useRef(false);
  const [callback, setCallback] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const result = await handleAuthCallback();
        if (result?.type === 'invite' || result?.type === 'recovery') { setCallback(result); return; }
        const user = await getUser();
        window.location.replace(user ? '/schedule' : '/login');
      } catch { setError('Не вдалося підтвердити посилання. Воно могло застаріти.'); }
    })();
  }, []);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (callback.type === 'invite') await acceptInvite(callback.token, password);
      else await updateUser({ password });
      window.location.replace('/schedule');
    } catch { setError('Не вдалося зберегти пароль. Спробуйте нове посилання.'); setBusy(false); }
  }
  return <main className="auth-callback"><a className="auth-brand" href="/login">timzo</a>
    <h1>{callback ? 'Створіть пароль' : 'Відкриваємо ваш простір…'}</h1>
    {callback && <form className="auth-form" onSubmit={submit}><label>Новий пароль<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /></label><button className="primary-btn" disabled={busy}>{busy ? 'Збереження…' : 'Зберегти пароль'}</button></form>}
    {error && <><p className="auth-error" role="alert">{error}</p><a href="/login">До входу</a></>}
  </main>;
}
