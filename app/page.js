import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) {
    redirect('/schedule');
  }
  redirect('/login');
}
