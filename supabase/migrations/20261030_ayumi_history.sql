begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function public.ayumi_date_valid(value text) returns boolean
language plpgsql immutable set search_path='' as $$
begin
  if value is null or value !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  return to_char(value::date,'YYYY-MM-DD')=value;
exception when others then return false;
end; $$;

create function public.ayumi_archive_valid(items jsonb, archive jsonb) returns boolean
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
      or (item-'id'-'text'-'done')<>'{}'::jsonb
      or jsonb_typeof(entry->'index') is distinct from 'number'
      or (entry->>'index') !~ '^[0-9]{1,2}$'
      or jsonb_typeof(entry->'deleted_on') is distinct from 'string'
      or not public.ayumi_date_valid(entry->>'deleted_on')
      or (entry-'item'-'index'-'deleted_on')<>'{}'::jsonb then return false; end if;
    ids:=array_append(ids,item->>'id');
  end loop;
  return true;
end; $$;

create function public.ayumi_insights_valid(notes jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare entry jsonb; ids text[] := '{}';
begin
  if jsonb_typeof(notes) is distinct from 'array' then return false; end if;
  if jsonb_array_length(notes)>500 then return false; end if;
  for entry in select value from jsonb_array_elements(notes) loop
    if jsonb_typeof(entry) is distinct from 'object'
      or jsonb_typeof(entry->'id') is distinct from 'string'
      or length(entry->>'id') not between 1 and 80 or (entry->>'id')=any(ids)
      or jsonb_typeof(entry->'text') is distinct from 'string' or length(btrim(entry->>'text')) not between 1 and 500
      or not (entry ? 'date')
      or (entry->'date'<>'null'::jsonb and (jsonb_typeof(entry->'date') is distinct from 'string' or not public.ayumi_date_valid(entry->>'date')))
      or (entry-'id'-'date'-'text')<>'{}'::jsonb then return false; end if;
    ids:=array_append(ids,entry->>'id');
  end loop;
  return true;
end; $$;

alter table public.ayumi_projects
  add column deleted_items jsonb not null default '[]',
  add column insight_history jsonb not null default '[]',
  add constraint ayumi_archive_check check(public.ayumi_archive_valid(items,deleted_items)),
  add constraint ayumi_insights_check check(public.ayumi_insights_valid(insight_history));

-- Existing insights have no reliable observation date; never invent one.
update public.ayumi_projects
set insight_history=jsonb_build_array(jsonb_build_object('id','legacy-'||id::text,'date',null,'text',insight)),version=version+1
where length(btrim(insight))>0;

grant insert(deleted_items,insight_history), update(deleted_items,insight_history) on public.ayumi_projects to authenticated;
-- Existing ownership policies also cover the two new columns.
commit;
