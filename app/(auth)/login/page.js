'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, requestPasswordRecovery } from '@netlify/identity';
import IdentityOptions, { useIdentitySettings } from '@/components/IdentityOptions';

export default function LoginPage() {
  const router = useRouter();
  const { settings, settingsError } = useIdentitySettings();
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
    await login(email, password);

    if (typeof window !== 'undefined') {
      window.location.href = '/schedule';
    } else {
      router.push('/schedule');
    }
    } catch {
      setError('Сервіс тимчасово недоступний. Перевірте з’єднання та спробуйте ще раз.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div className="auth-hero">
        <div className="auth-brand">timzo</div>
        <p className="auth-description">
          Зручне планування змін, контроль годин та швидка статистика по працівниках.
        </p>
      </div>
      <h1>Вхід</h1>
      {settingsError && <p className="auth-error" role="alert">{settingsError}</p>}
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      <form onSubmit={handleSubmit} className="auth-form">
        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="auth-field">
          <span>Пароль</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        <button type="submit" className="primary-btn" disabled={isSubmitting || !settings || settingsError || settings.providers?.email === false}>
          {isSubmitting ? 'Входимо...' : 'Увійти'}
        </button>
      </form>
      <button type="button" className="recovery-button" disabled={isSubmitting || !settings} onClick={async () => {
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Спочатку введіть вашу email-адресу.'); return; }
        setIsSubmitting(true); setError('');
        try { await requestPasswordRecovery(email); setNotice('Якщо обліковий запис існує, лист для відновлення пароля надіслано.'); }
        catch { setError('Не вдалося надіслати лист. Спробуйте ще раз пізніше.'); }
        finally { setIsSubmitting(false); }
      }}>Забули пароль?</button>
      <IdentityOptions settings={settings} />
      {!settings?.disableSignup && <p className="auth-hint">
        Немає акаунта? <a href="/register">Створити</a>
      </p>}
    </div>
  );
}
