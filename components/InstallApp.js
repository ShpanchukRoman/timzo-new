'use client';

import { useEffect, useState } from 'react';

export default function InstallApp() {
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
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => {
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
  return <>
    {offline && <p className="offline-notice" role="status">Немає з’єднання. Для завантаження та збереження графіка потрібен інтернет.</p>}
    {!standalone && <aside className="install-panel" aria-label="Встановлення застосунку">
      <p><strong>timzo завжди під рукою.</strong> Додайте застосунок на головний екран.</p>
      {prompt ? <button type="button" className="primary-btn" onClick={install}>Встановити timzo</button> : <details><summary>Як встановити на iPhone</summary><p>Відкрийте цей сайт у Safari → натисніть «Поширити» → «На початковий екран» → «Додати». Застосунок відкриватиметься в окремому вікні. Для роботи з графіком потрібен інтернет.</p></details>}
    </aside>}
  </>;
}
