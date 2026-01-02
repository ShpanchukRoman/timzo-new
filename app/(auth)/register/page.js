'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function RegisterPage() {
  const router = useRouter();
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

    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName,
        orgName,
        email,
        password
      })
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setError(result?.error || 'Помилка реєстрації.');
      setIsSubmitting(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    setIsSubmitting(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    if (typeof window !== 'undefined') {
      window.location.href = '/schedule';
    } else {
      router.push('/schedule');
    }
  };

  return (
    <div>
      <h1>Реєстрація</h1>
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? <div className="auth-error">{error}</div> : null}
        <button type="submit" className="primary-btn" disabled={isSubmitting}>
          {isSubmitting ? 'Створюємо...' : 'Створити акаунт'}
        </button>
      </form>
      <p className="auth-hint">
        Є акаунт? <a href="/login">Увійти</a>
      </p>
    </div>
  );
}
