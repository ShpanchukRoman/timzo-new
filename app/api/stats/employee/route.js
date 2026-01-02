import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ensureOrgForUser } from '@/lib/data/orgs';

const BREAK_THRESHOLD_HOURS = 5.75;
const BREAK_DURATION_HOURS = 1;
const ALLOWED_DAYS = new Set([7, 14, 30]);

function getWeekStartDate(weekValue) {
  if (!weekValue || typeof weekValue !== 'string') return null;
  const parts = weekValue.split('-W');
  if (parts.length !== 2) return null;
  const year = Number(parts[0]);
  const week = Number(parts[1]);
  if (!Number.isInteger(year) || !Number.isInteger(week)) return null;

  const date = new Date(Date.UTC(year, 0, 1));
  const dayNum = date.getUTCDay();
  const dayDiff = dayNum <= 4 ? 1 - dayNum : 8 - dayNum;
  date.setUTCDate(date.getUTCDate() + dayDiff + (week - 1) * 7);
  return date;
}

function getIsoWeekValue(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function parseDbTimeToMinutes(value) {
  if (!value) return null;
  const parts = String(value).split(':');
  if (parts.length < 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function getShiftHours(shift) {
  const startMinutes = parseDbTimeToMinutes(shift?.start_time);
  const endMinutes = parseDbTimeToMinutes(shift?.end_time);
  if (startMinutes == null || endMinutes == null) {
    return 0;
  }
  let minutes = endMinutes - startMinutes;
  if (shift?.crosses_midnight || minutes <= 0) {
    minutes += 24 * 60;
  }
  if (minutes <= 0) {
    return 0;
  }
  return minutes / 60;
}

function calculateEntryHours(entry) {
  if (!entry || entry.locked) {
    return 0;
  }
  if (!Array.isArray(entry.shifts) || entry.shifts.length === 0) {
    return 0;
  }
  const rawTotal = entry.shifts.reduce((sum, shift) => sum + getShiftHours(shift), 0);
  if (rawTotal <= 0) {
    return 0;
  }
  if (rawTotal >= BREAK_THRESHOLD_HOURS) {
    return Math.max(rawTotal - BREAK_DURATION_HOURS, 0);
  }
  return rawTotal;
}

function buildDateRange(days) {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  const dates = [];
  for (let i = 0; i < days; i += 1) {
    const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i));
    dates.push(day);
  }
  return { start, end, dates };
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get('employeeId');
  const daysParam = Number(searchParams.get('days') || 7);
  const days = ALLOWED_DAYS.has(daysParam) ? daysParam : 7;

  if (!employeeId) {
    return NextResponse.json({ error: 'Employee is required.' }, { status: 400 });
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
    const { data: employee, error: employeeError } = await admin
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .maybeSingle();

    if (employeeError) {
      throw employeeError;
    }
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    }

    const { start, end, dates } = buildDateRange(days);
    const weekValues = Array.from(new Set(dates.map(getIsoWeekValue)));

    const { data: schedules, error: scheduleError } = await admin
      .from('schedules')
      .select('id, week')
      .eq('org_id', orgId)
      .in('week', weekValues);

    if (scheduleError) {
      throw scheduleError;
    }

    const scheduleIds = (schedules || []).map((item) => item.id);
    let entries = [];
    if (scheduleIds.length > 0) {
      const { data: entriesData, error: entriesError } = await admin
        .from('schedule_entries')
        .select('schedule_id, day_index, locked, shifts (start_time, end_time, crosses_midnight)')
        .eq('employee_id', employeeId)
        .in('schedule_id', scheduleIds);

      if (entriesError) {
        throw entriesError;
      }
      entries = entriesData || [];
    }

    const scheduleWeekMap = new Map();
    (schedules || []).forEach((schedule) => {
      const weekStart = getWeekStartDate(schedule.week);
      if (weekStart) {
        scheduleWeekMap.set(schedule.id, weekStart);
      }
    });

    const totalsMap = new Map();
    dates.forEach((date) => {
      totalsMap.set(toDateKey(date), 0);
    });

    entries.forEach((entry) => {
      const weekStart = scheduleWeekMap.get(entry.schedule_id);
      if (!weekStart) return;
      const dayIndex = Number(entry.day_index);
      if (!Number.isFinite(dayIndex)) return;
      const entryDate = new Date(Date.UTC(
        weekStart.getUTCFullYear(),
        weekStart.getUTCMonth(),
        weekStart.getUTCDate() + dayIndex
      ));

      if (entryDate < start || entryDate >= end) {
        return;
      }

      const hours = calculateEntryHours(entry);
      if (!hours) return;

      const key = toDateKey(entryDate);
      totalsMap.set(key, (totalsMap.get(key) || 0) + hours);
    });

    const daysPayload = dates.map((date) => ({
      date: toDateKey(date),
      hours: totalsMap.get(toDateKey(date)) || 0
    }));

    return NextResponse.json({ days: daysPayload });
  } catch (error) {
    console.error('Employee stats GET failed', error);
    return NextResponse.json({
      error: error?.message || 'Failed to load employee stats.',
      details: error?.details || error?.hint || null
    }, { status: 500 });
  }
}
