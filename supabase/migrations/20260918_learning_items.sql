begin;

create table public.learning_items (
  id uuid primary key default gen_random_uuid(),
  source_type text not null default 'conversation' check (source_type = 'conversation'),
  -- Web conversation UUID or anonymized LINE session hash; existing sources differ in type.
  source_id text not null,
  session_id text not null,
  original_text text not null check (length(btrim(original_text)) > 0),
  status text not null default 'candidate' check (status = 'candidate'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index learning_items_created_at_idx on public.learning_items (created_at desc, id desc);
alter table public.learning_items enable row level security;
revoke all on public.learning_items from public, anon, authenticated;
grant select, insert on public.learning_items to service_role;
-- Only the existing admin API may read/write using its server-side role.
create policy learning_items_service_select on public.learning_items for select to service_role using (true);
create policy learning_items_service_insert on public.learning_items for insert to service_role with check (true);

commit;
