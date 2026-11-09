import { pgTable, uuid, text, doublePrecision, integer, boolean, timestamp, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: text('owner_id').notNull().unique(),
  name: text('name').notNull(),
  monthlyPlanHours: doublePrecision('monthly_plan_hours').notNull().default(0),
});
export const employees = pgTable('employees', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull(),
  name: text('name').notNull(),
  position: text('position').notNull().default(''),
  sortIndex: integer('sort_index').notNull().default(0),
  monthlyPlanHours: doublePrecision('monthly_plan_hours').notNull().default(0),
  active: boolean('active').notNull().default(true),
}, table => [uniqueIndex('employee_workspace_client').on(table.workspaceId, table.clientId)]);
export const schedules = pgTable('schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  week: text('week').notNull(),
}, table => [uniqueIndex('schedule_workspace_week').on(table.workspaceId, table.week)]);
export const entries = pgTable('schedule_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  scheduleId: uuid('schedule_id').notNull().references(() => schedules.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  dayIndex: integer('day_index').notNull(),
  primary: text('primary_shift').notNull().default(''),
  secondary: text('secondary_shift').notNull().default(''),
  locked: boolean('locked').notNull().default(false),
}, table => [uniqueIndex('entry_schedule_employee_day').on(table.scheduleId, table.employeeId, table.dayIndex), check('entry_day_range', sql`${table.dayIndex} BETWEEN 0 AND 6`)]);
export const dayLimits = pgTable('day_limits', {
  id: uuid('id').defaultRandom().primaryKey(),
  scheduleId: uuid('schedule_id').notNull().references(() => schedules.id, { onDelete: 'cascade' }),
  dayIndex: integer('day_index').notNull(),
  hours: doublePrecision('hours').notNull(),
}, table => [uniqueIndex('limit_schedule_day').on(table.scheduleId, table.dayIndex), check('limit_day_range', sql`${table.dayIndex} BETWEEN 0 AND 6`), check('limit_positive', sql`${table.hours} >= 0`)]);
export const shareLinks = pgTable('share_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  scheduleId: uuid('schedule_id').notNull().references(() => schedules.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
