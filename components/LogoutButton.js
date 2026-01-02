'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LogoutButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleLogout = async () => {
    setIsLoading(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    setIsLoading(false);
    router.push('/login');
  };

  return (
    <button type="button" className="ghost-btn" onClick={handleLogout} disabled={isLoading}>
      {isLoading ? 'Вихід...' : 'Вийти'}
    </button>
  );
}
