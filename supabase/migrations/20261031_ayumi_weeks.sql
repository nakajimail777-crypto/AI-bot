begin;
set local lock_timeout='5s';
create function public.ayumi_weeks_valid(weeks jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare w jsonb; previous date;
begin
  if jsonb_typeof(weeks) is distinct from 'array' then return false; end if;
  if jsonb_array_length(weeks)>104 then return false; end if;
  for w in select value from jsonb_array_elements(weeks) loop
    if jsonb_typeof(w) is distinct from 'object' or jsonb_typeof(w->'start') is distinct from 'string'
      or not public.ayumi_date_valid(w->>'start') or jsonb_typeof(w->'done') is distinct from 'boolean'
      or (w-'start'-'done')<>'{}'::jsonb then return false; end if;
    if previous is not null and (w->>'start')::date < previous+7 then return false; end if;
    previous:=(w->>'start')::date;
  end loop;
  return true;
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
      or (item - 'id' - 'text' - 'done' - 'weeks') <> '{}'::jsonb then return false; end if;
    if item ? 'weeks' and not public.ayumi_weeks_valid(item->'weeks') then return false; end if;
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
      or (item-'id'-'text'-'done'-'weeks')<>'{}'::jsonb
      or jsonb_typeof(entry->'index') is distinct from 'number'
      or (entry->>'index') !~ '^[0-9]{1,2}$'
      or jsonb_typeof(entry->'deleted_on') is distinct from 'string'
      or not public.ayumi_date_valid(entry->>'deleted_on')
      or (entry-'item'-'index'-'deleted_on')<>'{}'::jsonb then return false; end if;
    if item ? 'weeks' and not public.ayumi_weeks_valid(item->'weeks') then return false; end if;
    ids:=array_append(ids,item->>'id');
  end loop;
  return true;
end; $$;


commit;
