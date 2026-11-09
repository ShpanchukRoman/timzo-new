export default function manifest() {
  return {
    id: '/', name: 'timzo — графік команди', short_name: 'timzo',
    description: 'Планування змін, облік годин та аналітика команди.',
    start_url: '/', scope: '/', display: 'standalone',
    background_color: '#f3f5ef', theme_color: '#203d32', lang: 'uk',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  };
}
