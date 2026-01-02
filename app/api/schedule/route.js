import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ensureOrgForUser } from '@/lib/data/orgs';

const DEFAULT_LIMITS = [26, 26, 26, 26, 26, 20, 20];

function formatTime(value) {
  if (!value) return '';
  const parts = value.split(':');
  if (parts.length < 2) return value;
  return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
}

function formatShiftString(startTime, endTime) {
  if (!startTime || !endTime) return '';
  return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

function parseTimePart(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function parseShiftRange(value) {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split('-');
  if (parts.length !== 2) return null;
  const start = parseTimePart(parts[0]);
  const end = parseTimePart(parts[1]);
  if (!start || !end) return null;
  if (end.hour < start.hour || (end.hour === start.hour && end.minute <= start.minute)) {
    return null;
  }
  return { start, end };
}

function toDbTime(time) {
  const hour = String(time.hour).padStart(2, '0');
  const minute = String(time.minute).padStart(2, '0');
  return `${hour}:${minute}:00`;
}

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

async function ensureDayLimits(supabase, scheduleId) {
  const { data: existing, error } = await supabase
    .from('day_limits')
    .select('id, day_index, hours_limit')
    .eq('schedule_id', scheduleId);

  if (error) {
    throw error;
  }

  if (existing && existing.length === 7) {
    return existing;
  }

  const existingIndexes = new Set((existing || []).map(item => item.day_index));
  const inserts = [];
  for (let i = 0; i < 7; i += 1) {
    if (!existingIndexes.has(i)) {
      inserts.push({
        schedule_id: scheduleId,
        day_index: i,
        hours_limit: DEFAULT_LIMITS[i]
      });
    }
  }

  if (inserts.length > 0) {
    const { error: insertError } = await supabase.from('day_limits').insert(inserts);
    if (insertError) {
      throw insertError;
    }
  }

  const { data: updated, error: updatedError } = await supabase
    .from('day_limits')
    .select('id, day_index, hours_limit')
    .eq('schedule_id', scheduleId);

  if (updatedError) {
    throw updatedError;
  }

  return updated || [];
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const week = searchParams.get('week');

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
    const dayLimits = await ensureDayLimits(admin, scheduleId);

    const { data: employees, error: employeeError } = await admin
      .from('employees')
      .select('id, name, position, is_active, sort_index')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('sort_index', { ascending: true });

    if (employeeError) {
      throw employeeError;
    }

    const { data: entries, error: entriesError } = await admin
      .from('schedule_entries')
      .select('id, employee_id, day_index, locked, shifts (id, type, start_time, end_time)')
      .eq('schedule_id', scheduleId);

    if (entriesError) {
      throw entriesError;
    }

    const entryMap = new Map();
    (entries || []).forEach((entry) => {
      entryMap.set(`${entry.employee_id}:${entry.day_index}`, entry);
    });

    const employeePayload = (employees || []).map((employee, index) => {
      const schedule = Array.from({ length: 7 }, (_, dayIndex) => {
        const entry = entryMap.get(`${employee.id}:${dayIndex}`);
        const slots = { primary: '', secondary: '', locked: false };
        if (entry) {
          slots.locked = !!entry.locked;
          if (Array.isArray(entry.shifts)) {
            entry.shifts.forEach((shift) => {
              const label = formatShiftString(shift.start_time, shift.end_time);
              if (shift.type === 'primary') {
                slots.primary = label;
              } else if (shift.type === 'secondary') {
                slots.secondary = label;
              }
            });
          }
        }
        return slots;
      });

      return {
        id: employee.id,
        clientId: employee.id,
        index,
        name: employee.name,
        position: employee.position || '',
        sortIndex: Number.isFinite(employee.sort_index) ? employee.sort_index : index,
        schedule
      };
    });

    const limits = Array.from({ length: 7 }, (_, dayIndex) => {
      const limit = (dayLimits || []).find(item => item.day_index === dayIndex);
      return limit ? String(limit.hours_limit) : String(DEFAULT_LIMITS[dayIndex]);
    });

    return NextResponse.json({
      week,
      limits,
      employees: employeePayload
    });
  } catch (error) {
    console.error('Schedule GET failed', error);
    return NextResponse.json({
      error: error?.message || 'Failed to load schedule.',
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

  const week = payload?.week;
  const limits = Array.isArray(payload?.limits) ? payload.limits : [];
  const employees = Array.isArray(payload?.employees) ? payload.employees : [];
  const deletedEmployees = Array.isArray(payload?.deletedEmployees) ? payload.deletedEmployees : [];

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

    const limitRows = Array.from({ length: 7 }, (_, index) => ({
      schedule_id: scheduleId,
      day_index: index,
      hours_limit: Number(limits[index] ?? DEFAULT_LIMITS[index]) || 0
    }));

    const { error: limitsError } = await admin
      .from('day_limits')
      .upsert(limitRows, { onConflict: 'schedule_id,day_index' });

    if (limitsError) {
      throw limitsError;
    }

    if (deletedEmployees.length > 0) {
      await admin
        .from('employees')
        .update({ is_active: false })
        .eq('org_id', orgId)
        .in('id', deletedEmployees);
    }

    const createdEmployees = [];
    const updatedEmployees = [];

    employees.forEach((employee, index) => {
      if (employee?.id) {
        updatedEmployees.push({
          id: employee.id,
          name: employee.name || 'Працівник',
          position: employee.position || '',
          sort_index: Number.isFinite(employee.sortIndex) ? employee.sortIndex : index
        });
      } else {
        createdEmployees.push({
          org_id: orgId,
          name: employee?.name || 'Працівник',
          position: employee?.position || '',
          sort_index: Number.isFinite(employee?.sortIndex) ? employee.sortIndex : index,
          clientId: employee?.clientId || null
        });
      }
    });

    if (updatedEmployees.length > 0) {
      const updatePromises = updatedEmployees.map((employee) => {
        return admin
          .from('employees')
          .update({ name: employee.name, position: employee.position, sort_index: employee.sort_index })
          .eq('id', employee.id);
      });
      await Promise.all(updatePromises);
    }

    let createdResults = [];
    if (createdEmployees.length > 0) {
      const { data: inserted, error: insertError } = await admin
        .from('employees')
        .insert(createdEmployees.map(employee => ({
          org_id: employee.org_id,
          name: employee.name,
          position: employee.position,
          sort_index: employee.sort_index
        })))
        .select('id, name, position, sort_index');

      if (insertError) {
        throw insertError;
      }

      createdResults = inserted || [];
    }

    const employeePayload = [];
    let createdIndex = 0;

    const normalizedEmployees = employees.map((employee, index) => {
      if (employee?.id) {
        return {
          id: employee.id,
          clientId: employee.clientId || employee.id,
          index,
          name: employee.name || 'Працівник',
          position: employee.position || '',
          sortIndex: Number.isFinite(employee.sortIndex) ? employee.sortIndex : index,
          schedule: Array.isArray(employee.schedule) ? employee.schedule : []
        };
      }

      const created = createdResults[createdIndex];
      createdIndex += 1;

      return {
        id: created?.id || null,
        clientId: employee?.clientId || created?.id || null,
        index,
        name: employee?.name || created?.name || 'Працівник',
        position: employee?.position || created?.position || '',
        sortIndex: Number.isFinite(employee?.sortIndex) ? employee.sortIndex : index,
        schedule: Array.isArray(employee?.schedule) ? employee.schedule : []
      };
    });

    normalizedEmployees.forEach((employee) => {
      employeePayload.push({
        id: employee.id,
        clientId: employee.clientId,
        index: employee.index,
        name: employee.name,
        position: employee.position,
        sortIndex: employee.sortIndex
      });
    });

    const entryRows = [];
    normalizedEmployees.forEach((employee) => {
      if (!employee.id) return;
      for (let i = 0; i < 7; i += 1) {
        const slot = employee.schedule[i] || {};
        entryRows.push({
          schedule_id: scheduleId,
          employee_id: employee.id,
          day_index: i,
          locked: !!slot.locked
        });
      }
    });

    let entryMap = new Map();
    if (entryRows.length > 0) {
      const { data: entryData, error: entryError } = await admin
        .from('schedule_entries')
        .upsert(entryRows, { onConflict: 'schedule_id,employee_id,day_index' })
        .select('id, employee_id, day_index');

      if (entryError) {
        throw entryError;
      }

      entryMap = new Map((entryData || []).map(entry => [`${entry.employee_id}:${entry.day_index}`, entry.id]));

      const entryIds = entryData ? entryData.map(entry => entry.id) : [];
      if (entryIds.length > 0) {
        await admin.from('shifts').delete().in('schedule_entry_id', entryIds);
      }

      const shiftRows = [];
      normalizedEmployees.forEach((employee) => {
        if (!employee.id) return;
        for (let i = 0; i < 7; i += 1) {
          const slot = employee.schedule[i] || {};
          const entryId = entryMap.get(`${employee.id}:${i}`);
          if (!entryId || slot.locked) continue;

          const primaryRange = parseShiftRange(slot.primary);
          if (primaryRange) {
            shiftRows.push({
              schedule_entry_id: entryId,
              type: 'primary',
              start_time: toDbTime(primaryRange.start),
              end_time: toDbTime(primaryRange.end),
              crosses_midnight: false
            });
          }

          const secondaryRange = parseShiftRange(slot.secondary);
          if (secondaryRange) {
            shiftRows.push({
              schedule_entry_id: entryId,
              type: 'secondary',
              start_time: toDbTime(secondaryRange.start),
              end_time: toDbTime(secondaryRange.end),
              crosses_midnight: false
            });
          }
        }
      });

      if (shiftRows.length > 0) {
        const { error: shiftsError } = await admin.from('shifts').insert(shiftRows);
        if (shiftsError) {
          throw shiftsError;
        }
      }
    }

    return NextResponse.json({
      week,
      limits: limitRows.map(item => String(item.hours_limit)),
      employees: employeePayload
    });
  } catch (error) {
    console.error('Schedule POST failed', error);
    return NextResponse.json({
      error: error?.message || 'Failed to save schedule.',
      details: error?.details || error?.hint || null
    }, { status: 500 });
  }
}
