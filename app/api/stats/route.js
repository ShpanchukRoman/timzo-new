import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ensureOrgForUser } from '@/lib/data/orgs';

const BREAK_THRESHOLD_HOURS = 5.75;
const BREAK_DURATION_HOURS = 1;

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

function getCurrentMonthRange() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return { start, end };
}

function normalizeNumber(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const week = searchParams.get('week');

  const supabase = createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user || null;
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const orgId = await ensureOrgForUser(user.id, 'Моя організація');

  try {
    const { data: org, error: orgError } = await admin
      .from('organizations')
      .select('monthly_plan_hours')
      .eq('id', orgId)
      .single();

    if (orgError) {
      throw orgError;
    }

    const { data: employees, error: employeeError } = await admin
      .from('employees')
      .select('id, name, position, monthly_plan_hours, sort_index')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('sort_index', { ascending: true });

    if (employeeError) {
      throw employeeError;
    }

    const { data: schedules, error: scheduleError } = await admin
      .from('schedules')
      .select('id, week')
      .eq('org_id', orgId);

    if (scheduleError) {
      throw scheduleError;
    }

    const activeEmployeeIds = new Set((employees || []).map((employee) => employee.id));

    const scheduleIds = (schedules || []).map((item) => item.id);
    let entries = [];
    if (scheduleIds.length > 0) {
      const { data: entriesData, error: entriesError } = await admin
        .from('schedule_entries')
        .select('schedule_id, employee_id, day_index, locked, shifts (type, start_time, end_time, crosses_midnight)')
        .in('schedule_id', scheduleIds);

      if (entriesError) {
        throw entriesError;
      }
      entries = entriesData || [];
    }

    const scheduleWeekMap = new Map();
    (schedules || []).forEach((schedule) => {
      const start = getWeekStartDate(schedule.week);
      if (start) {
        scheduleWeekMap.set(schedule.id, start);
      }
    });

    const { start: monthStart, end: monthEnd } = getCurrentMonthRange();
    const monthTotals = new Map();
    const allTotals = new Map();
    let totalMonth = 0;
    let totalAll = 0;

    entries.forEach((entry) => {
      if (!activeEmployeeIds.has(entry.employee_id)) {
        return;
      }
      const weekStart = scheduleWeekMap.get(entry.schedule_id);
      if (!weekStart) return;
      const dayIndex = Number(entry.day_index);
      if (!Number.isFinite(dayIndex)) return;
      const entryDate = new Date(Date.UTC(
        weekStart.getUTCFullYear(),
        weekStart.getUTCMonth(),
        weekStart.getUTCDate() + dayIndex
      ));
      const hours = calculateEntryHours(entry);
      if (!hours) return;

      totalAll += hours;
      allTotals.set(entry.employee_id, (allTotals.get(entry.employee_id) || 0) + hours);

      if (entryDate >= monthStart && entryDate < monthEnd) {
        totalMonth += hours;
        monthTotals.set(entry.employee_id, (monthTotals.get(entry.employee_id) || 0) + hours);
      }
    });

    const planTotal = normalizeNumber(org?.monthly_plan_hours);
    const percent = planTotal > 0 ? (totalMonth / planTotal) * 100 : 0;
    const remaining = Math.max(planTotal - totalMonth, 0);

    const employeePayload = (employees || []).map((employee) => ({
      id: employee.id,
      name: employee.name,
      position: employee.position || '',
      monthHours: normalizeNumber(monthTotals.get(employee.id) || 0),
      allHours: normalizeNumber(allTotals.get(employee.id) || 0),
      planHours: normalizeNumber(employee.monthly_plan_hours)
    }));

    const averageAll = employeePayload.length > 0 ? totalAll / employeePayload.length : 0;

    return NextResponse.json({
      week,
      month: {
        totalHours: totalMonth,
        planTotalHours: planTotal,
        percent,
        remaining,
        employees: employeePayload.map((employee) => ({
          id: employee.id,
          name: employee.name,
          position: employee.position,
          monthHours: employee.monthHours,
          planHours: employee.planHours
        }))
      },
      all: {
        totalHours: totalAll,
        averageHours: averageAll,
        employees: employeePayload.map((employee) => ({
          id: employee.id,
          name: employee.name,
          position: employee.position,
          hours: employee.allHours
        }))
      }
    });
  } catch (error) {
    console.error('Stats GET failed', error);
    return NextResponse.json({
      error: error?.message || 'Failed to load stats.',
      details: error?.details || error?.hint || null
    }, { status: 500 });
  }
}

export async function POST(request) {
  let payload = null;
  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 });
  }

  const orgPlanHours = payload?.orgPlanHours;
  const employeeId = payload?.employeeId;
  const employeePlanHours = payload?.employeePlanHours;

  if (orgPlanHours == null && !employeeId) {
    return NextResponse.json({ error: 'No changes provided.' }, { status: 400 });
  }

  if (employeeId && employeePlanHours == null) {
    return NextResponse.json({ error: 'Employee plan hours required.' }, { status: 400 });
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
    const result = {};
    if (orgPlanHours != null) {
      const value = normalizeNumber(orgPlanHours);
      const { error: orgError } = await admin
        .from('organizations')
        .update({ monthly_plan_hours: value })
        .eq('id', orgId);

      if (orgError) {
        throw orgError;
      }
      result.orgPlanHours = value;
    }

    if (employeeId) {
      const value = normalizeNumber(employeePlanHours);
      const { data: updatedEmployee, error: employeeError } = await admin
        .from('employees')
        .update({ monthly_plan_hours: value })
        .eq('id', employeeId)
        .eq('org_id', orgId)
        .select('id')
        .maybeSingle();

      if (employeeError) {
        throw employeeError;
      }
      if (!updatedEmployee) {
        return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
      }
      result.employeeId = employeeId;
      result.employeePlanHours = value;
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('Stats POST failed', error);
    return NextResponse.json({
      error: error?.message || 'Failed to save plan.',
      details: error?.details || error?.hint || null
    }, { status: 500 });
  }
}
