import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ensureOrgForUser } from '@/lib/data/orgs';

async function ensureSchedule(supabase, orgId, week) {
  const { data: existing, error: findError } = await supabase
    .from('schedules')
    .select('id')
    .eq('org_id', orgId)
    .eq('week', week)
    .maybeSingle();

  if (findError) {
    throw findError;
  }

  if (existing?.id) {
    return existing.id;
  }

  const { data: created, error: createError } = await supabase
    .from('schedules')
    .insert({ org_id: orgId, week })
    .select('id')
    .single();

  if (createError) {
    throw createError;
  }

  return created.id;
}

export async function POST(request) {
  let payload = null;
  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 });
  }

  const week = payload?.week;
  const expiresInDays = Number(payload?.expiresInDays || 30);

  if (!week) {
    return NextResponse.json({ error: 'Week is required.' }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user || null;
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const orgId = await ensureOrgForUser(user.id, 'Моя організація');

  try {
    const scheduleId = await ensureSchedule(admin, orgId, week);
    const token = crypto.randomUUID().replace(/-/g, '');
    const expiresAt = Number.isFinite(expiresInDays)
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const { error: insertError } = await admin
      .from('share_links')
      .insert({
        schedule_id: scheduleId,
        token,
        expires_at: expiresAt ? expiresAt.toISOString() : null
      });

    if (insertError) {
      throw insertError;
    }

    const { count } = await admin
      .from('employees')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_active', true);

    const origin = new URL(request.url).origin;

    return NextResponse.json({
      token,
      url: `${origin}/share/${token}`,
      employeeCount: count || 0
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Failed to create share link.' }, { status: 500 });
  }
}
