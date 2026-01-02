-- Add missing timestamp columns for employees if schema was created earlier.
alter table public.employees
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Ensure updated_at trigger exists and points to the shared function.
drop trigger if exists set_employees_updated_at on public.employees;
create trigger set_employees_updated_at
before update on public.employees
for each row execute function public.set_updated_at();
