-- Add monthly plan hours for organizations and employees.
alter table public.organizations
  add column if not exists monthly_plan_hours numeric(7,2) not null default 0;

alter table public.employees
  add column if not exists monthly_plan_hours numeric(7,2) not null default 0;
