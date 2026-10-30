begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function public.ayumi_items_valid(items jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb; ids text[] := '{}';
begin
  if jsonb_typeof(items) is distinct from 'array' then return false; end if;
  if jsonb_array_length(items)>100 then return false; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'id') is distinct from 'string'
      or length(item->>'id') not between 1 and 80
      or (item->>'id')=any(ids)
      or jsonb_typeof(item->'text') is distinct from 'string'
      or length(btrim(item->>'text')) not between 1 and 300
      or jsonb_typeof(item->'done') is distinct from 'boolean'
      or (item - 'id' - 'text' - 'done') <> '{}'::jsonb then return false; end if;
    ids := array_append(ids,item->>'id');
  end loop;
  return true;
end; $$;
create table public.ayumi_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  due_date date,
  items jsonb not null default '[]' check (public.ayumi_items_valid(items)),
  insight text not null default '' check (length(insight)<=500),
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ayumi_projects_owner_idx on public.ayumi_projects(user_id,id);
create function public.ayumi_before_update() returns trigger language plpgsql set search_path='' as $$
begin
  if new.version <> old.version+1 then raise exception 'AYUMI_VERSION_CONFLICT'; end if;
  new.updated_at := now(); return new;
end; $$;
create trigger ayumi_update before update on public.ayumi_projects for each row execute function public.ayumi_before_update();
alter table public.ayumi_projects enable row level security;
revoke all on public.ayumi_projects from public,anon,authenticated;
grant select on public.ayumi_projects to authenticated;
grant insert(id,title,due_date,items,insight) on public.ayumi_projects to authenticated;
grant update(title,due_date,items,insight,version) on public.ayumi_projects to authenticated;
create policy ayumi_select on public.ayumi_projects for select to authenticated
using(user_id=(select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false');
create policy ayumi_insert on public.ayumi_projects for insert to authenticated
with check(user_id=(select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false');
create policy ayumi_update on public.ayumi_projects for update to authenticated
using(user_id=(select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false')
with check(user_id=(select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false');
commit;
