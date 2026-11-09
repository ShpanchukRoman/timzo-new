'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signup, getUser } from '@netlify/identity';
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
    await signup(email, password, { full_name: fullName, org_name: orgName });
    const current = await getUser();
    if (!current) { setNotice('Перевірте вашу пошту й підтвердьте email за посиланням у листі. Після підтвердження відкриється ваш робочий простір.'); return; }

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
