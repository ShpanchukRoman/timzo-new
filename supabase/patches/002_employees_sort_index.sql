-- Add sorting column to preserve employee order.
alter table public.employees
  add column if not exists sort_index integer not null default 0;

-- Backfill using created_at (fallback to id) to keep add order.
with ordered as (
  select id,
         row_number() over (order by created_at nulls last, id) - 1 as new_index
  from public.employees
)
update public.employees e
set sort_index = ordered.new_index
from ordered
where e.id = ordered.id;
