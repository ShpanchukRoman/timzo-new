-- Extensions
create extension if not exists "pgcrypto";

-- Enums
create type public.member_role as enum ('owner', 'admin', 'manager', 'viewer');
create type public.shift_type as enum ('primary', 'secondary');

-- Helper functions
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Core tables
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Europe/Kyiv',
  monthly_plan_hours numeric(7,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create or replace function public.is_org_member(org_id_input uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = org_id_input
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_manager(org_id_input uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = org_id_input
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'manager')
  );
$$;

create or replace function public.is_org_admin(org_id_input uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = org_id_input
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  position text default '',
  sort_index integer not null default 0,
  monthly_plan_hours numeric(7,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  week text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, week)
);

create table public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  day_index smallint not null check (day_index between 0 and 6),
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, employee_id, day_index)
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  schedule_entry_id uuid not null references public.schedule_entries(id) on delete cascade,
  type public.shift_type not null,
  start_time time not null,
  end_time time not null,
  crosses_midnight boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time <> end_time),
  unique (schedule_entry_id, type)
);

create table public.day_limits (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  day_index smallint not null check (day_index between 0 and 6),
  hours_limit numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, day_index)
);

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Triggers for updated_at
create trigger set_orgs_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create trigger set_org_members_updated_at
before update on public.org_members
for each row execute function public.set_updated_at();

create trigger set_employees_updated_at
before update on public.employees
for each row execute function public.set_updated_at();

create trigger set_schedules_updated_at
before update on public.schedules
for each row execute function public.set_updated_at();

create trigger set_schedule_entries_updated_at
before update on public.schedule_entries
for each row execute function public.set_updated_at();

create trigger set_shifts_updated_at
before update on public.shifts
for each row execute function public.set_updated_at();

create trigger set_day_limits_updated_at
before update on public.day_limits
for each row execute function public.set_updated_at();

-- Row Level Security
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.employees enable row level security;
alter table public.schedules enable row level security;
alter table public.schedule_entries enable row level security;
alter table public.shifts enable row level security;
alter table public.day_limits enable row level security;
alter table public.share_links enable row level security;
alter table public.audit_logs enable row level security;

-- Organizations policies
create policy "Org members can read organizations" on public.organizations
for select using (public.is_org_member(id));

create policy "Authenticated users can create organizations" on public.organizations
for insert with check (auth.role() = 'authenticated');

create policy "Admins can update organizations" on public.organizations
for update using (public.is_org_admin(id));

create policy "Admins can delete organizations" on public.organizations
for delete using (public.is_org_admin(id));

-- Org members policies
create policy "Org members can read members" on public.org_members
for select using (public.is_org_member(org_id));

create policy "Admins can manage members" on public.org_members
for insert with check (public.is_org_admin(org_id));

create policy "Admins can update members" on public.org_members
for update using (public.is_org_admin(org_id));

create policy "Admins can delete members" on public.org_members
for delete using (public.is_org_admin(org_id));

-- Employees policies
create policy "Org members can read employees" on public.employees
for select using (public.is_org_member(org_id));

create policy "Managers can insert employees" on public.employees
for insert with check (public.is_org_manager(org_id));

create policy "Managers can update employees" on public.employees
for update using (public.is_org_manager(org_id));

create policy "Admins can delete employees" on public.employees
for delete using (public.is_org_admin(org_id));

-- Schedules policies
create policy "Org members can read schedules" on public.schedules
for select using (public.is_org_member(org_id));

create policy "Managers can create schedules" on public.schedules
for insert with check (public.is_org_manager(org_id));

create policy "Managers can update schedules" on public.schedules
for update using (public.is_org_manager(org_id));

create policy "Admins can delete schedules" on public.schedules
for delete using (public.is_org_admin(org_id));

-- Schedule entries policies
create policy "Org members can read schedule entries" on public.schedule_entries
for select using (
  exists (
    select 1 from public.schedules s
    where s.id = schedule_entries.schedule_id
      and public.is_org_member(s.org_id)
  )
);

create policy "Managers can manage schedule entries" on public.schedule_entries
for insert with check (
  exists (
    select 1 from public.schedules s
    where s.id = schedule_entries.schedule_id
      and public.is_org_manager(s.org_id)
  )
);

create policy "Managers can update schedule entries" on public.schedule_entries
for update using (
  exists (
    select 1 from public.schedules s
    where s.id = schedule_entries.schedule_id
      and public.is_org_manager(s.org_id)
  )
);

create policy "Admins can delete schedule entries" on public.schedule_entries
for delete using (
  exists (
    select 1 from public.schedules s
    where s.id = schedule_entries.schedule_id
      and public.is_org_admin(s.org_id)
  )
);

-- Shifts policies
create policy "Org members can read shifts" on public.shifts
for select using (
  exists (
    select 1
    from public.schedule_entries se
    join public.schedules s on s.id = se.schedule_id
    where se.id = shifts.schedule_entry_id
      and public.is_org_member(s.org_id)
  )
);

create policy "Managers can manage shifts" on public.shifts
for insert with check (
  exists (
    select 1
    from public.schedule_entries se
    join public.schedules s on s.id = se.schedule_id
    where se.id = shifts.schedule_entry_id
      and public.is_org_manager(s.org_id)
  )
);

create policy "Managers can update shifts" on public.shifts
for update using (
  exists (
    select 1
    from public.schedule_entries se
    join public.schedules s on s.id = se.schedule_id
    where se.id = shifts.schedule_entry_id
      and public.is_org_manager(s.org_id)
  )
);

create policy "Admins can delete shifts" on public.shifts
for delete using (
  exists (
    select 1
    from public.schedule_entries se
    join public.schedules s on s.id = se.schedule_id
    where se.id = shifts.schedule_entry_id
      and public.is_org_admin(s.org_id)
  )
);

-- Day limits policies
create policy "Org members can read day limits" on public.day_limits
for select using (
  exists (
    select 1 from public.schedules s
    where s.id = day_limits.schedule_id
      and public.is_org_member(s.org_id)
  )
);

create policy "Managers can manage day limits" on public.day_limits
for insert with check (
  exists (
    select 1 from public.schedules s
    where s.id = day_limits.schedule_id
      and public.is_org_manager(s.org_id)
  )
);

create policy "Managers can update day limits" on public.day_limits
for update using (
  exists (
    select 1 from public.schedules s
    where s.id = day_limits.schedule_id
      and public.is_org_manager(s.org_id)
  )
);

create policy "Admins can delete day limits" on public.day_limits
for delete using (
  exists (
    select 1 from public.schedules s
    where s.id = day_limits.schedule_id
      and public.is_org_admin(s.org_id)
  )
);

-- Share links policies
create policy "Org members can read share links" on public.share_links
for select using (
  exists (
    select 1 from public.schedules s
    where s.id = share_links.schedule_id
      and public.is_org_member(s.org_id)
  )
);

create policy "Managers can manage share links" on public.share_links
for insert with check (
  exists (
    select 1 from public.schedules s
    where s.id = share_links.schedule_id
      and public.is_org_manager(s.org_id)
  )
);

create policy "Managers can update share links" on public.share_links
for update using (
  exists (
    select 1 from public.schedules s
    where s.id = share_links.schedule_id
      and public.is_org_manager(s.org_id)
  )
);

create policy "Admins can delete share links" on public.share_links
for delete using (
  exists (
    select 1 from public.schedules s
    where s.id = share_links.schedule_id
      and public.is_org_admin(s.org_id)
  )
);

-- Audit logs policies
create policy "Admins can read audit logs" on public.audit_logs
for select using (public.is_org_admin(org_id));

create policy "Admins can insert audit logs" on public.audit_logs
for insert with check (public.is_org_admin(org_id));
