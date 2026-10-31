begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function public.ayumi_items_valid(items jsonb) returns boolean
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
      or (item - 'id' - 'text' - 'done' - 'weeks' - 'daily' - 'due_date') <> '{}'::jsonb then return false; end if;
    if item ? 'due_date' and (jsonb_typeof(item->'due_date') is distinct from 'string' or not public.ayumi_date_valid(item->>'due_date')) then return false; end if;
    if item ? 'weeks' and not public.ayumi_weeks_valid(item->'weeks') then return false; end if;
    if item ? 'daily' and (not public.ayumi_daily_valid(item->'daily') or jsonb_array_length(coalesce(item->'weeks','[]'::jsonb))>0) then return false; end if;
    ids := array_append(ids,item->>'id');
  end loop;
  return true;
end; $$;

create or replace function public.ayumi_archive_valid(items jsonb, archive jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare entry jsonb; item jsonb; ids text[] := '{}';
begin
  if jsonb_typeof(archive) is distinct from 'array' or jsonb_typeof(items) is distinct from 'array' then return false; end if;
  if jsonb_array_length(archive)>100 then return false; end if;
  for item in select value from jsonb_array_elements(items) loop ids:=array_append(ids,item->>'id'); end loop;
  for entry in select value from jsonb_array_elements(archive) loop
    if jsonb_typeof(entry) is distinct from 'object' then return false; end if;
    item:=entry->'item';
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'id') is distinct from 'string'
      or length(item->>'id') not between 1 and 80 or (item->>'id')=any(ids)
      or jsonb_typeof(item->'text') is distinct from 'string' or length(item->>'text')>300
      or jsonb_typeof(item->'done') is distinct from 'boolean'
      or (item-'id'-'text'-'done'-'weeks'-'daily'-'due_date')<>'{}'::jsonb
      or jsonb_typeof(entry->'index') is distinct from 'number'
      or (entry->>'index') !~ '^[0-9]{1,2}$'
      or jsonb_typeof(entry->'deleted_on') is distinct from 'string'
      or not public.ayumi_date_valid(entry->>'deleted_on')
      or (entry-'item'-'index'-'deleted_on')<>'{}'::jsonb then return false; end if;
    if item ? 'due_date' and (jsonb_typeof(item->'due_date') is distinct from 'string' or not public.ayumi_date_valid(item->>'due_date')) then return false; end if;
    if item ? 'weeks' and not public.ayumi_weeks_valid(item->'weeks') then return false; end if;
    if item ? 'daily' and (not public.ayumi_daily_valid(item->'daily') or jsonb_array_length(coalesce(item->'weeks','[]'::jsonb))>0) then return false; end if;
    ids:=array_append(ids,item->>'id');
  end loop;
  return true;
end; $$;




create function public.ayumi_overall_complete(items jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; w jsonb; total integer:=0;
begin
 for item in select value from jsonb_array_elements(items) loop
  if item ? 'daily' then continue; end if;
  if jsonb_array_length(coalesce(item->'weeks','[]'::jsonb))>0 then
   for w in select value from jsonb_array_elements(item->'weeks') loop
    total:=total+1;
    if w->>'done' is distinct from 'true' then return false; end if;
   end loop;
  else
   total:=total+1;
   if item->>'done' is distinct from 'true' then return false; end if;
  end if;
 end loop;
 return total>0;
end; $$;
alter table public.ayumi_projects
 add column achieved_on date check(achieved_on is null or (achieved_on between date '0001-01-01' and date '9999-12-31' and public.ayumi_overall_complete(items))),
 add column v2_revision integer not null default 0 check(v2_revision>=0);
grant insert(achieved_on,v2_revision),update(achieved_on,v2_revision) on public.ayumi_projects to authenticated;
create function public.ayumi_v2_guard() returns trigger language plpgsql set search_path='' as $$
declare has_v2 boolean;
begin
 select exists(select 1 from (
  select value i from jsonb_array_elements(new.items)
  union all select value->'item' from jsonb_array_elements(new.deleted_items)
 ) records where i ? 'due_date') or new.achieved_on is not null into has_v2;
 if TG_OP='UPDATE' then
  if (old.v2_revision>0 or new.v2_revision>0 or has_v2) and new.v2_revision<>old.v2_revision+1 then
   raise exception 'Reload required: goals need a v2 compatible client' using errcode='P0001';
  end if;
 elsif (has_v2 or new.v2_revision>0) and new.v2_revision<>1 then
  raise exception 'V2 revision required';
 end if;
 return new;
end; $$;
create trigger ayumi_v2_guard before insert or update on public.ayumi_projects for each row execute function public.ayumi_v2_guard();
commit;
