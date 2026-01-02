import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function getActiveOrgId(supabaseClient = null) {
  const supabase = supabaseClient || createSupabaseServerClient();
  const { data, error } = await supabase
    .from('org_members')
    .select('org_id')
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return null;
  }
  return data?.org_id ?? null;
}

export async function ensureOrgForUser(userId, orgName = 'Моя організація') {
  if (!userId) return null;
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from('org_members')
    .select('org_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (existing?.org_id) {
    return existing.org_id;
  }

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: orgName })
    .select('id')
    .single();

  if (orgError || !org?.id) {
    throw orgError || new Error('Failed to create organization.');
  }

  const { error: memberError } = await admin
    .from('org_members')
    .insert({ org_id: org.id, user_id: userId, role: 'owner' });

  if (memberError) {
    throw memberError;
  }

  return org.id;
}
