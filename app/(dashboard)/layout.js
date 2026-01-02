import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import LogoutButton from '@/components/LogoutButton';

export default async function DashboardLayout({ children }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  return (
    <>
      <header className="app-header">
        <div className="brand">timzo</div>
        <div className="header-actions">
          <span className="header-user">{user.email}</span>
          <LogoutButton />
        </div>
      </header>
      {children}
    </>
  );
}
