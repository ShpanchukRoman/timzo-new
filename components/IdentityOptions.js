'use client';
import { useEffect, useState } from 'react';
import { getSettings, oauthLogin } from '@netlify/identity';

export function useIdentitySettings() {
  const [settings, setSettings] = useState(null);
  const [settingsError, setSettingsError] = useState('');
  useEffect(() => {
    getSettings().then(setSettings).catch(() => setSettingsError('Авторизація тимчасово недоступна. Спробуйте ще раз пізніше.'));
  }, []);
  return { settings, settingsError };
}
export default function IdentityOptions({ settings }) {
  const providers = ['google', 'github', 'gitlab', 'bitbucket'].filter(provider => settings?.providers?.[provider]);
  return providers.length ? <div className="oauth-options">{providers.map(provider => <button key={provider} type="button" className="ghost-btn" onClick={() => oauthLogin(provider)}>Увійти через {provider}</button>)}</div> : null;
}
