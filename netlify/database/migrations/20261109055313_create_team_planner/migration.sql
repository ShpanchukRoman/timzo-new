CREATE TABLE "day_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"schedule_id" uuid NOT NULL,
	"day_index" integer NOT NULL,
	"hours" double precision NOT NULL,
	CONSTRAINT "limit_day_range" CHECK ("day_index" BETWEEN 0 AND 6),
	CONSTRAINT "limit_positive" CHECK ("hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"position" text DEFAULT '' NOT NULL,
	"sort_index" integer DEFAULT 0 NOT NULL,
	"monthly_plan_hours" double precision DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"schedule_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"day_index" integer NOT NULL,
	"primary_shift" text DEFAULT '' NOT NULL,
	"secondary_shift" text DEFAULT '' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "entry_day_range" CHECK ("day_index" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"week" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"schedule_id" uuid NOT NULL,
	"token" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_id" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"monthly_plan_hours" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "limit_schedule_day" ON "day_limits" ("schedule_id","day_index");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_workspace_client" ON "employees" ("workspace_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_schedule_employee_day" ON "schedule_entries" ("schedule_id","employee_id","day_index");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_workspace_week" ON "schedules" ("workspace_id","week");--> statement-breakpoint
ALTER TABLE "day_limits" ADD CONSTRAINT "day_limits_schedule_id_schedules_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_schedule_id_schedules_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_employee_id_employees_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_schedule_id_schedules_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE CASCADE;