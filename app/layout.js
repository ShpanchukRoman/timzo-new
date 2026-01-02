import './globals.css';

export const metadata = {
  title: 'Планування графіку працівників',
  description: 'Планування графіку працівників'
};

export default function RootLayout({ children }) {
  return (
    <html lang="uk">
      <body data-page="schedule">{children}</body>
    </html>
  );
}
