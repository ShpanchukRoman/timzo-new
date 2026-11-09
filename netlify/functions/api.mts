import type { Config } from '@netlify/functions';
import { getUser } from '@netlify/identity';
import { and, eq, asc, inArray, sql } from 'drizzle-orm';
import { randomUUID, randomBytes } from 'node:crypto';
import { getDb } from '../../db/index.js';
import { workspaces, employees, schedules, entries, dayLimits, shareLinks } from '../../db/schema.js';
import { DEFAULT_LIMITS, weekStart, entryHours, entryDate, shiftHours, validHours } from '../../lib/schedule-domain.mjs';

function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
function uuid(value: unknown) { return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value); }
function requireWeek(value: any) { if (!weekStart(value)) fail('Оберіть коректний тиждень.'); return value as string; }

async function workspaceFor(db: any, user: any) {
  await db.insert(workspaces).values({ ownerId: user.id, name: String(user.userMetadata?.org_name || 'Моя організація').slice(0, 160) }).onConflictDoNothing({ target: workspaces.ownerId });
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.ownerId, user.id));
  return workspace;
}
async function ensureSchedule(db: any, workspaceId: string, week: string) {
  await db.insert(schedules).values({ workspaceId, week }).onConflictDoNothing();
  const [schedule] = await db.select().from(schedules).where(and(eq(schedules.workspaceId, workspaceId), eq(schedules.week, week)));
  return schedule;
}
async function readSchedule(db: any, workspaceId: string, week: string) {
  const [schedule] = await db.select().from(schedules).where(and(eq(schedules.workspaceId, workspaceId), eq(schedules.week, week)));
  const staff = await db.select().from(employees).where(and(eq(employees.workspaceId, workspaceId), eq(employees.active, true))).orderBy(asc(employees.sortIndex), asc(employees.id));
  const slots = schedule ? await db.select().from(entries).where(eq(entries.scheduleId, schedule.id)) : [];
  const limits = schedule ? await db.select().from(dayLimits).where(eq(dayLimits.scheduleId, schedule.id)) : [];
  return {
    week, limits: DEFAULT_LIMITS.map((fallback: number, index: number) => String(limits.find((l: any) => l.dayIndex === index)?.hours ?? fallback)),
    employees: staff.map((employee: any, index: number) => ({
      id: employee.id, clientId: employee.clientId, index, name: employee.name, position: employee.position, sortIndex: employee.sortIndex,
      schedule: Array.from({ length: 7 }, (_, dayIndex) => {
        const slot = slots.find((s: any) => s.employeeId === employee.id && s.dayIndex === dayIndex);
        return { primary: slot?.primary || '', secondary: slot?.secondary || '', locked: slot?.locked || false };
      })
    }))
  };
}
function validateSchedule(body: any) {
  if (!body || typeof body !== 'object') fail('Некоректні дані графіка.');
  requireWeek(body.week);
  if (!Array.isArray(body.employees) || body.employees.length > 300 || !Array.isArray(body.limits) || body.limits.length !== 7 || body.limits.some((h: any) => !validHours(h))) fail('Некоректні дані графіка.');
  const ids = new Set();
  for (const employee of body.employees) {
    if (!employee || typeof employee.name !== 'string' || !employee.name.trim() || employee.name.length > 160 || typeof employee.position !== 'string' || employee.position.length > 160) fail('Перевірте ім’я та посаду працівника.');
    if (employee.id && !uuid(employee.id)) fail('Некоректний працівник.');
    const identity = employee.id || employee.clientId;
    if (typeof identity !== 'string' || identity.length > 160 || ids.has(identity)) fail('Некоректний або повторений працівник.');
    ids.add(identity);
    if (!Array.isArray(employee.schedule) || employee.schedule.length !== 7) fail('Графік має містити сім днів.');
    for (const slot of employee.schedule) {
      if (!slot || ['primary','secondary'].some(key => typeof slot[key] !== 'string' || slot[key].length > 40 || shiftHours(slot[key]) === null)) fail('Вкажіть час зміни у форматі 09:00 - 17:00.');
    }
  }
  if (body.deletedEmployees != null && (!Array.isArray(body.deletedEmployees) || body.deletedEmployees.length > 300 || body.deletedEmployees.some((id: any) => !uuid(id)))) fail('Некоректний список видалення.');
}
async function saveSchedule(db: any, workspaceId: string, body: any) {
  validateSchedule(body);
  return db.transaction(async (tx: any) => {
    const schedule = await ensureSchedule(tx, workspaceId, body.week);
    const owned = await tx.select().from(employees).where(eq(employees.workspaceId, workspaceId));
    const ownedIds = new Set(owned.map((e: any) => e.id));
    if (body.employees.some((e: any) => e.id && !ownedIds.has(e.id)) || (body.deletedEmployees || []).some((id: any) => !ownedIds.has(id))) fail('Працівника не знайдено.', 404);
    // Serialize concurrent writes to the same week and keep all changes atomic.
    await tx.execute(sql`SELECT id FROM schedules WHERE id = ${schedule.id} FOR UPDATE`);
    await tx.insert(dayLimits).values(body.limits.map((hours: any, dayIndex: number) => ({ scheduleId: schedule.id, dayIndex, hours: Number(hours) }))).onConflictDoUpdate({ target: [dayLimits.scheduleId, dayLimits.dayIndex], set: { hours: sql`excluded.hours` } });
    if (body.deletedEmployees?.length) await tx.update(employees).set({ active: false }).where(and(eq(employees.workspaceId, workspaceId), inArray(employees.id, body.deletedEmployees)));
    const result = [];
    const entryRows = [];
    for (const [index, employee] of body.employees.entries()) {
      const fields = { name: employee.name.trim(), position: employee.position.trim(), sortIndex: index };
      let record;
      if (employee.id) {
        [record] = await tx.update(employees).set(fields).where(and(eq(employees.workspaceId, workspaceId), eq(employees.id, employee.id), eq(employees.active, true))).returning();
        if (!record) fail('Працівника не знайдено.', 404);
      } else {
        [record] = await tx.insert(employees).values({ ...fields, workspaceId, clientId: employee.clientId || randomUUID() }).onConflictDoUpdate({ target: [employees.workspaceId, employees.clientId], set: fields }).returning();
      }
      for (const [dayIndex, slot] of employee.schedule.entries()) {
        const fields = { primary: slot.primary, secondary: slot.secondary, locked: Boolean(slot.locked) };
        entryRows.push({ ...fields, scheduleId: schedule.id, employeeId: record.id, dayIndex });
      }
      result.push({ ...fields, id: record.id, clientId: employee.clientId || record.clientId, index, sortIndex: index });
    }
    if (entryRows.length) await tx.insert(entries).values(entryRows).onConflictDoUpdate({ target: [entries.scheduleId, entries.employeeId, entries.dayIndex], set: { primary: sql`excluded.primary_shift`, secondary: sql`excluded.secondary_shift`, locked: sql`excluded.locked` } });
    return { week: body.week, limits: body.limits.map(String), employees: result };
  });
}
async function statsData(db: any, workspace: any) {
  const staff = await db.select().from(employees).where(and(eq(employees.workspaceId, workspace.id), eq(employees.active, true))).orderBy(asc(employees.sortIndex));
  const rows = await db.select({ week: schedules.week, employeeId: entries.employeeId, dayIndex: entries.dayIndex, primary: entries.primary, secondary: entries.secondary, locked: entries.locked }).from(entries).innerJoin(schedules, eq(schedules.id, entries.scheduleId)).where(eq(schedules.workspaceId, workspace.id));
  return { staff, rows };
}
export default async (req: Request) => {
  const url = new URL(req.url), path = url.pathname;
  try {
    if (!['GET','POST'].includes(req.method)) return json({ error: 'Метод не підтримується.' }, 405);
    if (req.method === 'POST') {
      if (req.headers.get('origin') !== url.origin) fail('Заборонений запит.', 403);
      if (!req.headers.get('content-type')?.includes('application/json')) fail('Потрібні дані JSON.', 415);
      if (Number(req.headers.get('content-length') || 0) > 2000000) fail('Завеликий графік.', 413);
    }
    if (req.method === 'GET' && path.startsWith('/api/share-links/')) {
      const token = path.split('/').pop() || '';
      if (!/^[a-f0-9]{64}$/.test(token)) fail('Посилання не знайдено.', 404);
      const db = getDb();
      const [link] = await db.select({ workspaceId: schedules.workspaceId, week: schedules.week, expiresAt: shareLinks.expiresAt }).from(shareLinks).innerJoin(schedules, eq(schedules.id, shareLinks.scheduleId)).where(eq(shareLinks.token, token));
      if (!link) fail('Посилання не знайдено.', 404);
      if (link.expiresAt <= new Date()) fail('Термін дії посилання завершився.', 410);
      return json(await readSchedule(db, link.workspaceId, link.week));
    }
    const user = await getUser();
    if (!user) return json({ error: 'Увійдіть до облікового запису.' }, 401);
    const db = getDb();
    const workspace = await workspaceFor(db, user);
    if (path === '/api/me' && req.method === 'GET') return json({ user: { id: user.id, email: user.email }, workspace: { name: workspace.name } });
    if (path === '/api/schedule') {
      if (req.method === 'GET') return json(await readSchedule(db, workspace.id, requireWeek(url.searchParams.get('week'))));
      return json(await saveSchedule(db, workspace.id, await req.json()));
    }
    if (path === '/api/share-links' && req.method === 'POST') {
      const body = await req.json(), week = requireWeek(body.week), days = Number(body.expiresInDays ?? 30);
      if (!Number.isFinite(days) || days < 1 || days > 365) fail('Термін дії має бути від 1 до 365 днів.');
      const schedule = await ensureSchedule(db, workspace.id, week), token = randomBytes(32).toString('hex');
      await db.insert(shareLinks).values({ scheduleId: schedule.id, token, expiresAt: new Date(Date.now() + days * 86400000) });
      const staff = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.workspaceId, workspace.id), eq(employees.active, true)));
      return json({ url: `${url.origin}/share/${token}`, employeeCount: staff.length });
    }
    if (path === '/api/stats' && req.method === 'POST') {
      const body = await req.json();
      if (body.orgPlanHours == null && !body.employeeId) fail('Немає змін.');
      if (body.orgPlanHours != null && !validHours(body.orgPlanHours)) fail('Некоректний план.');
      if (body.employeeId && (!uuid(body.employeeId) || !validHours(body.employeePlanHours))) fail('Некоректний план працівника.');
      const result = await db.transaction(async tx => {
        if (body.orgPlanHours != null) await tx.update(workspaces).set({ monthlyPlanHours: Number(body.orgPlanHours) }).where(eq(workspaces.id, workspace.id));
        if (body.employeeId) {
          const rows = await tx.update(employees).set({ monthlyPlanHours: Number(body.employeePlanHours) }).where(and(eq(employees.workspaceId, workspace.id), eq(employees.id, body.employeeId), eq(employees.active, true))).returning({ id: employees.id });
          if (!rows.length) fail('Працівника не знайдено.', 404);
        }
        return { ok: true, ...body };
      });
      return json(result);
    }
    if ((path === '/api/stats' || path === '/api/stats/employee') && req.method === 'GET') {
      const { staff, rows } = await statsData(db, workspace);
      if (path === '/api/stats/employee') {
        const employeeId = url.searchParams.get('employeeId');
        if (!staff.some((e: any) => e.id === employeeId)) fail('Працівника не знайдено.', 404);
        const count = Number(url.searchParams.get('days') || 7);
        if (![7,14,30].includes(count)) fail('Некоректний діапазон.');
        const today = new Date(), days = [];
        for (let i = count-1; i >= 0; i--) {
          const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()-i));
          const key = date.toISOString().slice(0,10);
          days.push({ date: key, hours: rows.filter((r: any) => r.employeeId === employeeId && entryDate(r.week, r.dayIndex)?.toISOString().slice(0,10) === key).reduce((sum: number,r: any) => sum+entryHours(r),0) });
        }
        return json({ days });
      }
      const now = new Date(), month = now.toISOString().slice(0,7);
      const perEmployee = staff.map((employee: any) => {
        const own = rows.filter((row: any) => row.employeeId === employee.id);
        return { id: employee.id, name: employee.name, position: employee.position, planHours: employee.monthlyPlanHours,
          monthHours: own.filter((r: any) => entryDate(r.week,r.dayIndex)?.toISOString().startsWith(month)).reduce((sum: number,r: any) => sum+entryHours(r),0),
          allHours: own.reduce((sum: number,r: any) => sum+entryHours(r),0) };
      });
      const totalMonth = perEmployee.reduce((sum: number,e: any) => sum+e.monthHours,0), totalAll = perEmployee.reduce((sum: number,e: any) => sum+e.allHours,0);
      return json({ week: url.searchParams.get('week'), month: { totalHours: totalMonth, planTotalHours: workspace.monthlyPlanHours, percent: workspace.monthlyPlanHours ? totalMonth/workspace.monthlyPlanHours*100 : 0, remaining: Math.max(0,workspace.monthlyPlanHours-totalMonth), employees: perEmployee }, all: { totalHours: totalAll, averageHours: staff.length ? totalAll/staff.length : 0, employees: perEmployee.map((e: any) => ({ ...e, hours: e.allHours })) } });
    }
    return json({ error: 'Сторінку не знайдено.' }, 404);
  } catch (error: any) {
    if (error instanceof SyntaxError) return json({ error: 'Некоректний JSON.' }, 400);
    return json({ error: error.status ? error.message : 'Сервіс даних тимчасово недоступний. Спробуйте ще раз.' }, error.status || 503);
  }
};
export const config: Config = { path: '/api/*' };
