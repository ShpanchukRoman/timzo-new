'use client';

import { useState } from 'react';
import { authErrorMessage } from '@/lib/auth-errors.mjs';
import { useRouter } from 'next/navigation';
import { signup, login } from '@netlify/identity';
import IdentityOptions, { useIdentitySettings } from '@/components/IdentityOptions';

export default function RegisterPage() {
  const router = useRouter();
  const { settings, settingsError } = useIdentitySettings();
  const [notice, setNotice] = useState('');
  const [fullName, setFullName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
    const registered = await signup(email.trim(), password, { full_name: fullName.trim(), org_name: orgName.trim() });
    if (!registered.confirmedAt) { setNotice('Перевірте вашу пошту й підтвердьте email за посиланням у листі. Перевірте також папку «Спам». Після підтвердження відкриється ваш робочий простір.'); return; }
    // Signup creates the account but does not necessarily create a session.
    setNotice('Акаунт створено. Якщо автоматичний вхід не завершиться, перейдіть на сторінку входу.');
    try {
      await login(email.trim(), password);
    } catch (error) {
      setError(authErrorMessage(error));
      return;
    }

    if (typeof window !== 'undefined') {
      window.location.href = '/schedule';
    } else {
      router.push('/schedule');
    }
    } catch (error) {
      setError(authErrorMessage(error, 'signup'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <h1>Ваша нова команда</h1>
      <p className="auth-description">Створіть новий обліковий запис. Облікові записи та графіки попереднього сервера автоматично не перенесені.</p>
      {settingsError && <p className="auth-error" role="alert">{settingsError}</p>}
      {settings?.disableSignup && <p className="auth-notice">Реєстрація доступна лише за запрошенням.</p>}
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      <form onSubmit={handleSubmit} className="auth-form">
        <label className="auth-field">
          <span>Ім’я та прізвище</span>
          <input
            type="text"
            name="name"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Необов’язково"
          />
        </label>
        <label className="auth-field">
          <span>Назва організації</span>
          <input
            type="text"
            name="organization"
            autoComplete="organization"
            value={orgName}
            onChange={(event) => setOrgName(event.target.value)}
            required
          />
        </label>
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
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        <button type="submit" className="primary-btn" disabled={isSubmitting || !settings || settingsError || settings.disableSignup || settings.providers?.email === false || Boolean(notice)}>
          {isSubmitting ? 'Створюємо...' : 'Створити акаунт'}
        </button>
      </form>
      <IdentityOptions settings={settings} />
      <p className="auth-hint">
        Є акаунт? <a href="/login">Увійти</a>
      </p>
    </div>
  );
}
