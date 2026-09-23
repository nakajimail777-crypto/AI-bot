begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content text not null check (length(btrim(content)) > 0 and length(content) <= 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_user_created_idx on public.memories (user_id, created_at desc, id desc);
alter table public.memories enable row level security;
revoke all on public.memories from public, anon, authenticated;
grant select, delete on public.memories to authenticated;
-- Ownership and timestamps come from database defaults, never caller input.
grant insert (id, content) on public.memories to authenticated;
create policy memories_select_own on public.memories for select to authenticated
  using (user_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false');
create policy memories_insert_own on public.memories for insert to authenticated
  with check (user_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false');
create policy memories_delete_own on public.memories for delete to authenticated
  using (user_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false');
commit;
