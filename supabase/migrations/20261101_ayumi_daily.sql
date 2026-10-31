begin;
set local lock_timeout='5s';
create function public.ayumi_daily_valid(d jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare c jsonb; previous text:=''; active_count integer:=0;
begin
 if jsonb_typeof(d) is distinct from 'object' or (d-'start'-'end'-'timezone'-'checks')<>'{}'::jsonb
 or d->>'timezone' is distinct from 'Asia/Tokyo'
 or not public.ayumi_date_valid(d->>'start') or not public.ayumi_date_valid(d->>'end')
 or jsonb_typeof(d->'checks') is distinct from 'array' then return false; end if;
 if (d->>'end')::date < (d->>'start')::date or (d->>'end')::date-(d->>'start')::date>365 or jsonb_array_length(d->'checks')>366 then return false; end if;
 for c in select value from jsonb_array_elements(d->'checks') loop
  if jsonb_typeof(c) is distinct from 'object' or (c-'date'-'done'-'missed')<>'{}'::jsonb
  or not public.ayumi_date_valid(c->>'date') or jsonb_typeof(c->'done') is distinct from 'boolean'
  or c->>'date'<=previous then return false; end if;
  if c ? 'missed' and (jsonb_typeof(c->'missed') is distinct from 'boolean' or (c->>'missed'='true' and c->>'done'='true')) then return false; end if;
  previous:=c->>'date';
  if (c->>'date')::date between (d->>'start')::date and (d->>'end')::date then active_count:=active_count+1; end if;
 end loop;
 return active_count=(d->>'end')::date-(d->>'start')::date+1;
 exception when others then return false;
end; $$;
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
      or (item - 'id' - 'text' - 'done' - 'weeks' - 'daily') <> '{}'::jsonb then return false; end if;
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
      or (item-'id'-'text'-'done'-'weeks'-'daily')<>'{}'::jsonb
      or jsonb_typeof(entry->'index') is distinct from 'number'
      or (entry->>'index') !~ '^[0-9]{1,2}$'
      or jsonb_typeof(entry->'deleted_on') is distinct from 'string'
      or not public.ayumi_date_valid(entry->>'deleted_on')
      or (entry-'item'-'index'-'deleted_on')<>'{}'::jsonb then return false; end if;
    if item ? 'weeks' and not public.ayumi_weeks_valid(item->'weeks') then return false; end if;
    if item ? 'daily' and (not public.ayumi_daily_valid(item->'daily') or jsonb_array_length(coalesce(item->'weeks','[]'::jsonb))>0) then return false; end if;
    ids:=array_append(ids,item->>'id');
  end loop;
  return true;
end; $$;



alter table public.ayumi_projects add column daily_revision integer not null default 0 check(daily_revision>=0);
grant insert(daily_revision),update(daily_revision) on public.ayumi_projects to authenticated;
create function public.ayumi_daily_guard() returns trigger language plpgsql set search_path='' as $$
declare count_days integer;
begin
 select coalesce(sum(jsonb_array_length(coalesce(i->'daily'->'checks','[]'::jsonb))),0) into count_days
 from (select value i from jsonb_array_elements(new.items) union all select value->'item' from jsonb_array_elements(new.deleted_items)) records;
 if count_days>5000 then raise exception 'Too many daily records'; end if;
 if TG_OP='UPDATE' then
  if (old.daily_revision>0 or count_days>0) and new.daily_revision<>old.daily_revision+1 then
   raise exception 'Reload required: daily records need a compatible client' using errcode='P0001';
  end if;
 elsif count_days>0 and new.daily_revision<>1 then raise exception 'Daily revision required'; end if;
 return new;
end; $$;
create trigger ayumi_daily_guard before insert or update on public.ayumi_projects for each row execute function public.ayumi_daily_guard();
commit;
