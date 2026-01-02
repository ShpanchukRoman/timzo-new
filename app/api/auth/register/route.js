import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function POST(request) {
  let payload = null;
  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ error: 'Некоректні дані.' }, { status: 400 });
  }

  const email = payload?.email?.trim();
  const password = payload?.password;
  const orgName = payload?.orgName?.trim();
  const fullName = payload?.fullName?.trim();

  if (!email || !password || !orgName) {
    return NextResponse.json({ error: 'Заповніть email, пароль та назву організації.' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName || ''
    }
  });

  if (userError || !userData?.user) {
    return NextResponse.json({ error: userError?.message || 'Не вдалося створити користувача.' }, { status: 400 });
  }

  const userId = userData.user.id;

  const { data: orgData, error: orgError } = await supabase
    .from('organizations')
    .insert({ name: orgName })
    .select('id')
    .single();

  if (orgError || !orgData?.id) {
    return NextResponse.json({ error: orgError?.message || 'Не вдалося створити організацію.' }, { status: 400 });
  }

  const { error: memberError } = await supabase
    .from('org_members')
    .insert({
      org_id: orgData.id,
      user_id: userId,
      role: 'owner'
    });

  if (memberError) {
    return NextResponse.json({ error: memberError.message || 'Не вдалося додати учасника.' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
