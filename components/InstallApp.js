'use client';

import { useEffect, useState } from 'react';

export default function InstallApp() {
  const [update, setUpdate] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const [standalone, setStandalone] = useState(true);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => {
      setStandalone(window.matchMedia('(display-mode: standalone)').matches || Boolean(navigator.standalone));
      setOffline(!navigator.onLine);
    };
    const install = event => { event.preventDefault(); setPrompt(event); };
    const installed = () => { setStandalone(true); setPrompt(null); };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    window.addEventListener('beforeinstallprompt', install);
    window.addEventListener('appinstalled', installed);
    let registration;
    let cancelled = false;
    const checkUpdate = () => { if (document.visibilityState === 'visible') registration?.update().catch(() => {}); };
    const controllerChanged = () => { if (window.__timzoApplyingUpdate) window.location.reload(); };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', controllerChanged);
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(reg => {
        if (cancelled) return;
        registration = reg;
        const waiting = () => { if (!cancelled && reg.waiting && navigator.serviceWorker.controller) setUpdate(reg.waiting); };
        waiting();
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          worker?.addEventListener('statechange', () => { if (worker.state === 'installed') waiting(); });
        });
        reg.update().catch(() => {});
      }).catch(() => {});
    }
    document.addEventListener('visibilitychange', checkUpdate);
    window.addEventListener('focus', checkUpdate);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', checkUpdate);
      window.removeEventListener('focus', checkUpdate);
      navigator.serviceWorker?.removeEventListener('controllerchange', controllerChanged);
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      window.removeEventListener('beforeinstallprompt', install);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    setPrompt(null);
  }
  async function applyUpdate() {
    setUpdating(true);
    try {
      await window.__timzoFlushChanges?.();
      window.__timzoApplyingUpdate = true;
      update.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      setUpdating(false);
    }
  }
  return <>
    {update && <aside className="update-panel" role="status"><p>Доступна нова версія timzo. Оновіть застосунок без повторного встановлення.</p><div><button type="button" onClick={applyUpdate} disabled={updating}>{updating ? 'Оновлення…' : 'Оновити'}</button><button type="button" onClick={() => setUpdate(null)} disabled={updating}>Пізніше</button></div></aside>}
    {offline && <p className="offline-notice" role="status">Немає з’єднання. Для завантаження та збереження графіка потрібен інтернет.</p>}
    {!standalone && <aside className="install-panel" aria-label="Встановлення застосунку">
      <p>Встановіть timzo на головний екран.</p>
      {prompt ? <button type="button" className="primary-btn" onClick={install}>Встановити timzo</button> : <details><summary>Як встановити на iPhone</summary><p>Відкрийте цей сайт у Safari → натисніть «Поширити» → «На початковий екран» → «Додати». Застосунок відкриватиметься в окремому вікні. Для роботи з графіком потрібен інтернет.</p></details>}
    </aside>}
  </>;
}
