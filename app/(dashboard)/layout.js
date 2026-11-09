import { redirect } from 'next/navigation';
import { getUser } from '@netlify/identity';
import LogoutButton from '@/components/LogoutButton';
import IdentitySession from '@/components/IdentitySession';

export const dynamic = 'force-dynamic';
export default async function DashboardLayout({ children }) {
  const user = await getUser();
  if (!user) redirect('/login');
  return <><IdentitySession /><header className="app-header"><a className="brand" href="/schedule" aria-label="timzo — графік змін">timzo<span> / team planner</span></a><div className="header-actions"><span className="header-user">{user.email}</span><LogoutButton /></div></header>{children}</>;
}
