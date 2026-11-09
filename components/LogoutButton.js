'use client';
import { useState } from 'react';
import { logout } from '@netlify/identity';
export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  async function handleLogout() {
    setBusy(true);
    try { await logout(); } finally { window.location.replace('/login'); }
  }
  return <button type="button" className="ghost-btn" onClick={handleLogout} disabled={busy}>{busy ? 'Вихід…' : 'Вийти'}</button>;
}
