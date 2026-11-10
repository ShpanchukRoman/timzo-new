import './globals.css';
import './workspace.css';
import InstallApp from '@/components/InstallApp';

export const metadata = {
  title: 'timzo — графік команди',
  description: 'Планування змін, облік робочих годин та аналітика команди.',
  applicationName: 'timzo',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'timzo' },
  icons: { apple: '/icons/apple-touch-icon.png' }
};

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#eeece9' };

export default function RootLayout({ children }) {
  return (
    <html lang="uk">
      <body data-page="schedule">{children}<InstallApp /></body>
    </html>
  );
}
