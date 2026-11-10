'use client';

import { useEffect, useState } from 'react';

const sections = [
  ['schedule', 'Графік', 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z'],
  ['timeline', 'Таймлайн', 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],
  ['stats', 'Аналітика', 'M5 20V10m7 10V4m7 16v-7']
];

export default function WorkspaceNav() {
  const [active, setActive] = useState('schedule');
  useEffect(() => {
    const sync = () => {
      const section = window.location.hash.replace('#', '').replace('-section', '');
      const next = sections.some(([id]) => id === section) ? section : 'schedule';
      setActive(next);
      document.getElementById('main-content')?.setAttribute('data-mobile-view', next);
    };
    sync();
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  function navigate(event, id) {
    setActive(id);
    document.getElementById('main-content')?.setAttribute('data-mobile-view', id);
    if (window.matchMedia('(max-width: 767px)').matches) {
      event.preventDefault();
      const hash = `#${id}-section`;
      if (window.location.hash !== hash) window.history.pushState(null, '', hash);
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }
  return <nav className="workspace-nav" aria-label="Розділи застосунку">
    <div className="nav-sections">{sections.map(([id, label, path]) => <a key={id} href={`#${id}-section`} onClick={event => navigate(event, id)} aria-current={active === id ? 'page' : undefined}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
      <span>{label}</span>
    </a>)}</div>
  </nav>;
}
