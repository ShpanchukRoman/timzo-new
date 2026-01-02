'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

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
      <div className="auth-hero">
        <div className="auth-brand">timzo</div>
        <p className="auth-description">
          Зручне планування змін, контроль годин та швидка статистика по працівниках.
        </p>
      </div>
      <h1>Вхід</h1>
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
        {error ? <div className="auth-error">{error}</div> : null}
        <button type="submit" className="primary-btn" disabled={isSubmitting}>
          {isSubmitting ? 'Входимо...' : 'Увійти'}
        </button>
      </form>
      <p className="auth-hint">
        Немає акаунта? <a href="/register">Створити</a>
      </p>
    </div>
  );
}
