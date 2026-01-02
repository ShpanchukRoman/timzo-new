import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

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

export async function GET(request, { params }) {
  const token = params?.token;
  if (!token) {
    return NextResponse.json({ error: 'Token is required.' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  console.info('Share link fetch', { token });

  const { data: shareLink, error: shareError } = await supabase
    .from('share_links')
    .select('id, schedule_id, expires_at, schedules (id, org_id, week)')
    .eq('token', token)
    .maybeSingle();

  if (shareError || !shareLink) {
    return NextResponse.json({ error: 'Share link not found.' }, { status: 404 });
  }

  if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Share link expired.' }, { status: 410 });
  }

  const schedule = shareLink.schedules;
  if (!schedule?.id || !schedule?.org_id) {
    return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 });
  }

  try {
    console.info('Share link schedule', { scheduleId: schedule.id, orgId: schedule.org_id, week: schedule.week });
    const { data: dayLimits, error: limitsError } = await supabase
      .from('day_limits')
      .select('day_index, hours_limit')
      .eq('schedule_id', schedule.id);

    if (limitsError) {
      throw limitsError;
    }

    const { data: entries, error: entriesError } = await supabase
      .from('schedule_entries')
      .select('id, employee_id, day_index, locked, shifts (id, type, start_time, end_time)')
      .eq('schedule_id', schedule.id);

    if (entriesError) {
      throw entriesError;
    }

    const { data: employeesAll, error: employeeError } = await supabase
      .from('employees')
      .select('id, name, position, sort_index, is_active')
      .eq('org_id', schedule.org_id)
      .order('sort_index', { ascending: true });

    if (employeeError) {
      throw employeeError;
    }

    const employees = (employeesAll || []).filter((employee) => employee.is_active);
    const inactiveEmployees = (employeesAll || []).filter((employee) => !employee.is_active);

    const shiftCount = (entries || []).reduce((sum, entry) => sum + (entry.shifts?.length || 0), 0);
    const activeIds = new Set((employees || []).map((employee) => employee.id));
    const activeEntryCount = (entries || []).filter((entry) => activeIds.has(entry.employee_id)).length;
    const entryEmployeeIds = new Set((entries || []).map((entry) => entry.employee_id));

    const entryMap = new Map();
    (entries || []).forEach((entry) => {
      entryMap.set(`${entry.employee_id}:${entry.day_index}`, entry);
    });

    const normalizeText = (value) =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');

    const entryEmployeesOrdered = (employeesAll || []).filter((employee) => entryEmployeeIds.has(employee.id));
    const entryIdsByOrder = entryEmployeesOrdered.map((employee) => employee.id);

    const inactiveByName = new Map();
    const inactiveByNamePosition = new Map();

    const addToMap = (map, key, employeeId) => {
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(employeeId);
    };

    inactiveEmployees.forEach((employee) => {
      if (!entryEmployeeIds.has(employee.id)) return;
      const nameKey = normalizeText(employee.name);
      const positionKey = normalizeText(employee.position);
      if (nameKey) {
        addToMap(inactiveByName, nameKey, employee.id);
        const namePositionKey = positionKey ? `${nameKey}|${positionKey}` : '';
        if (namePositionKey) {
          addToMap(inactiveByNamePosition, namePositionKey, employee.id);
        }
      }
    });

    const usedEntryIds = new Set((employees || []).map((employee) => employee.id));
    const candidateMap = new Map();

    (employees || []).forEach((employee) => {
      const candidates = [employee.id];
      const nameKey = normalizeText(employee.name);
      const positionKey = normalizeText(employee.position);
      const namePositionKey = positionKey ? `${nameKey}|${positionKey}` : '';

      const pushUnique = (id) => {
        if (!id || candidates.includes(id)) return;
        candidates.push(id);
        usedEntryIds.add(id);
      };

      (inactiveByNamePosition.get(namePositionKey) || []).forEach(pushUnique);
      (inactiveByName.get(nameKey) || []).forEach(pushUnique);

      candidateMap.set(employee.id, candidates);
    });

    const remainingEntryIds = entryIdsByOrder.filter((id) => !usedEntryIds.has(id));
    let remainingIndex = 0;
    (employees || []).forEach((employee) => {
      if (remainingIndex >= remainingEntryIds.length) return;
      const candidates = candidateMap.get(employee.id);
      if (!candidates || candidates.length > 1) return;
      const fallbackId = remainingEntryIds[remainingIndex];
      remainingIndex += 1;
      candidates.push(fallbackId);
      usedEntryIds.add(fallbackId);
    });

    const hasShifts = (entry) => Array.isArray(entry?.shifts) && entry.shifts.length > 0;
    let fallbackDaysUsed = 0;
    let fallbackMatches = 0;

    const employeePayload = (employees || []).map((employee) => {
      const candidateIds = candidateMap.get(employee.id) || [employee.id];
      if (candidateIds.length > 1) {
        fallbackMatches += 1;
      }

      const scheduleData = Array.from({ length: 7 }, (_, dayIndex) => {
        const slots = { primary: '', secondary: '', locked: false };
        const activeEntry = entryMap.get(`${employee.id}:${dayIndex}`);

        if (activeEntry?.locked) {
          slots.locked = true;
          return slots;
        }

        const shiftByType = new Map();
        let usedFallbackForDay = false;
        let hasLockedFallback = false;

        candidateIds.forEach((sourceId, index) => {
          const entry = entryMap.get(`${sourceId}:${dayIndex}`);
          if (!entry) return;
          if (index > 0 && hasShifts(entry)) {
            usedFallbackForDay = true;
          }
          if (entry.locked) {
            hasLockedFallback = true;
          }
          if (Array.isArray(entry.shifts)) {
            entry.shifts.forEach((shift) => {
              if (!shift || !shift.type || shiftByType.has(shift.type)) return;
              shiftByType.set(shift.type, shift);
            });
          }
        });

        if (usedFallbackForDay) {
          fallbackDaysUsed += 1;
        }

        shiftByType.forEach((shift, type) => {
          const label = formatShiftString(shift.start_time, shift.end_time);
          if (type === 'primary') {
            slots.primary = label;
          } else if (type === 'secondary') {
            slots.secondary = label;
          }
        });

        if (shiftByType.size === 0 && hasLockedFallback) {
          slots.locked = true;
        }

        return slots;
      });

      return {
        id: employee.id,
        clientId: employee.id,
        name: employee.name,
        position: employee.position || '',
        sortIndex: Number.isFinite(employee.sort_index) ? employee.sort_index : null,
        schedule: scheduleData
      };
    });

    console.info('Share link data', {
      employees: employees?.length || 0,
      entries: entries?.length || 0,
      activeEntries: activeEntryCount,
      shifts: shiftCount,
      limits: dayLimits?.length || 0,
      fallbackDays: fallbackDaysUsed,
      fallbackMatches,
      fallbackRemaining: remainingEntryIds.length - Math.min(remainingEntryIds.length, (employees || []).length)
    });

    const limits = Array.from({ length: 7 }, (_, dayIndex) => {
      const limit = (dayLimits || []).find(item => item.day_index === dayIndex);
      return limit ? String(limit.hours_limit) : String(DEFAULT_LIMITS[dayIndex]);
    });

    return NextResponse.json({
      week: schedule.week,
      limits,
      employees: employeePayload
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Failed to load share link.' }, { status: 500 });
  }
}
