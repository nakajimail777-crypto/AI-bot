-- Prepared only: do not apply to production without a separate release decision.
-- Apply after 20261101_ayumi_schedule.sql, before serving the focus-capable client.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function public.ayumi_focus_valid(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if value is null then return true; end if;
 return jsonb_typeof(value)='object'
  and (value-'date'-'item_id'-'status')='{}'::jsonb
  and jsonb_typeof(value->'date')='string' and public.ayumi_date_valid(value->>'date')
  and jsonb_typeof(value->'status')='string' and value->>'status' in ('active','done','rest')
  and value ? 'item_id'
  and ((jsonb_typeof(value->'item_id')='string' and length(value->>'item_id') between 1 and 80)
    or (value->>'status'='rest' and value->'item_id'='null'::jsonb));
end; $$;
alter table public.ayumi_projects
 add column focus_day jsonb check(public.ayumi_focus_valid(focus_day) is true),
 add column focus_revision integer not null default 0 check(focus_revision>=0);
grant insert(focus_day,focus_revision),update(focus_day,focus_revision) on public.ayumi_projects to authenticated;
create function public.ayumi_focus_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='UPDATE' then
  if (old.focus_revision>0 or new.focus_revision>0 or new.focus_day is not null) and new.focus_revision<>old.focus_revision+1 then
   raise exception 'Reload required: goals need a focus compatible client' using errcode='P0001';
  end if;
 elsif (new.focus_day is not null or new.focus_revision>0) and new.focus_revision<>1 then
  raise exception 'Focus revision required';
 end if;
 -- Undoing a task also reopens its current focus record. Never infer a completion date.
 if new.focus_day->>'status'='done' and exists(select 1 from jsonb_array_elements(new.items) i
    where i->>'id'=new.focus_day->>'item_id' and i->>'done'='false') then
  new.focus_day=jsonb_set(new.focus_day,'{status}','"active"'::jsonb);
 end if;
 return new;
end; $$;
create trigger ayumi_focus_guard before insert or update on public.ayumi_projects for each row execute function public.ayumi_focus_guard();
-- Existing owner/anonymous RLS and optimistic version trigger remain in force.
commit;
