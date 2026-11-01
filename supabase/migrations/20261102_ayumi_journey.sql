-- Prepared for local/staging validation only. After schedule and focus migrations.
-- Re-runnable: no backfill, no inferred adoption / dates, no external service.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function public.ayumi_journey_goal_valid(g jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(g)='object' and (g-'purpose'-'criteria'-'current'-'constraints')='{}'::jsonb
 and jsonb_typeof(g->'purpose')='string' and length(g->>'purpose')<=1000
 and jsonb_typeof(g->'criteria')='string' and length(g->>'criteria')<=1000
 and jsonb_typeof(g->'current')='string' and length(g->>'current')<=1000
 and jsonb_typeof(g->'constraints')='string' and length(g->>'constraints')<=1000,false)
$$;
create or replace function public.ayumi_journey_focus_valid(f jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(f)='object' and (f-'date'-'item_id'-'unit_key'-'status')='{}'::jsonb
 and jsonb_typeof(f->'date')='string' and public.ayumi_date_valid(f->>'date')
 and jsonb_typeof(f->'unit_key')='string' and length(f->>'unit_key')<=100
 and f->>'status' in ('active','done','rest','cancelled')
 and ((jsonb_typeof(f->'item_id')='string' and length(f->>'item_id') between 1 and 80)
 or (f->>'status' in ('rest','cancelled') and f->'item_id'='null'::jsonb)),false)
$$;
create or replace function public.ayumi_journey_valid(j jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare p jsonb; a jsonb; e jsonb; d jsonb; ids text[]; action_ids text[]; plan_ids text[]:='{}'; k text;
begin
 if j is null then return true; end if;
 if jsonb_typeof(j) is distinct from 'object' or j->'schema' is distinct from '1'::jsonb
 or (j-'schema'-'goal'-'plans'-'active_plan_id'-'outcomes'-'reviews'-'goal_history'-'next_review'-'focus'-'events')<>'{}'::jsonb
 or public.ayumi_journey_goal_valid(j->'goal') is not true then return false; end if;
 foreach k in array array['plans','outcomes','reviews','goal_history','events'] loop
  if jsonb_typeof(j->k) is distinct from 'array' or jsonb_array_length(j->k)>(case k when 'plans' then 100 when 'events' then 2000 else 500 end) then return false; end if;
  ids:='{}';
  for e in select value from jsonb_array_elements(j->k) loop
   if jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e->'id') is distinct from 'string' or length(e->>'id') not between 1 and 80 or (e->>'id')=any(ids)
   or jsonb_typeof(e->'date') is distinct from 'string' or public.ayumi_date_valid(e->>'date') is not true then return false; end if;
   ids:=array_append(ids,e->>'id');
  end loop;
 end loop;
 for p in select value from jsonb_array_elements(j->'plans') loop
  if (p-'id'-'date'-'strategy'-'actions')<>'{}'::jsonb or jsonb_typeof(p->'strategy') is distinct from 'string' or length(btrim(p->>'strategy')) not between 1 and 1000
  or jsonb_typeof(p->'actions') is distinct from 'array' or jsonb_array_length(p->'actions') not between 1 and 100 then return false; end if;
  plan_ids:=array_append(plan_ids,p->>'id'); action_ids:='{}';
  for a in select value from jsonb_array_elements(p->'actions') loop
   if jsonb_typeof(a) is distinct from 'object' or (a-'item_id'-'reason'-'complete_when'-'weekdays'-'depends_on')<>'{}'::jsonb
   or jsonb_typeof(a->'item_id') is distinct from 'string' or length(a->>'item_id') not between 1 and 80 or (a->>'item_id')=any(action_ids)
   or jsonb_typeof(a->'reason') is distinct from 'string' or length(btrim(a->>'reason')) not between 1 and 300
   or jsonb_typeof(a->'complete_when') is distinct from 'string' or length(btrim(a->>'complete_when')) not between 1 and 300
   or jsonb_typeof(a->'weekdays') is distinct from 'array' or jsonb_array_length(a->'weekdays') not between 1 and 7
   or jsonb_typeof(a->'depends_on') is distinct from 'array' or jsonb_array_length(a->'depends_on')>20 then return false; end if;
   action_ids:=array_append(action_ids,a->>'item_id');ids:='{}';
   for d in select value from jsonb_array_elements(a->'weekdays') loop
    if jsonb_typeof(d) is distinct from 'number' or d::text!~'^[0-6]$' or d::text=any(ids) then return false; end if;
    ids:=array_append(ids,d::text);
   end loop;
   ids:='{}';
   for d in select value from jsonb_array_elements(a->'depends_on') loop
    if jsonb_typeof(d) is distinct from 'string' or length(d#>>'{}') not between 1 and 80 or d#>>'{}'=a->>'item_id' or (d#>>'{}')=any(ids) then return false; end if;
    ids:=array_append(ids,d#>>'{}');
   end loop;
  end loop;
 end loop;
 if not(j?'active_plan_id') or (j->'active_plan_id'<>'null'::jsonb and (jsonb_typeof(j->'active_plan_id') is distinct from 'string' or not((j->>'active_plan_id')=any(plan_ids)))) then return false; end if;
 if not(j?'next_review') or (j->'next_review'<>'null'::jsonb and (jsonb_typeof(j->'next_review') is distinct from 'string' or public.ayumi_date_valid(j->>'next_review') is not true)) then return false; end if;
 if not(j?'focus') or (j->'focus'<>'null'::jsonb and public.ayumi_journey_focus_valid(j->'focus') is not true) then return false; end if;
 for e in select value from jsonb_array_elements(j->'events') loop
  if public.ayumi_journey_focus_valid(e-'id') is not true then return false; end if;
 end loop;
 for e in select value from jsonb_array_elements(j->'outcomes') loop
  if (e-'id'-'date'-'value'-'unit'-'text')<>'{}'::jsonb or jsonb_typeof(e->'unit') is distinct from 'string' or length(e->>'unit')>40
  or jsonb_typeof(e->'text') is distinct from 'string' or length(e->>'text')>1000 or not(e?'value') then return false; end if;
  if e->'value'='null'::jsonb then
   if length(btrim(e->>'text'))=0 then return false; end if;
  elsif jsonb_typeof(e->'value') is distinct from 'number' or abs((e->>'value')::numeric)>1e12 or length(btrim(e->>'unit'))=0 then return false; end if;
 end loop;
 for e in select value from jsonb_array_elements(j->'reviews') loop
  if (e-'id'-'date'-'choice'-'burden'-'note'-'next_date'-'title'-'due_date'-'goal'-'plan_id')<>'{}'::jsonb
  or (e->>'choice' in ('continue','consult','revise')) is not true
  or jsonb_typeof(e->'burden') is distinct from 'string' or length(e->>'burden')>300
  or jsonb_typeof(e->'note') is distinct from 'string' or length(e->>'note')>1000
  or jsonb_typeof(e->'title') is distinct from 'string' or length(btrim(e->>'title')) not between 1 and 120
  or public.ayumi_journey_goal_valid(e->'goal') is not true then return false; end if;
  foreach k in array array['next_date','due_date'] loop
   if not(e?k) or (e->k<>'null'::jsonb and (jsonb_typeof(e->k) is distinct from 'string' or public.ayumi_date_valid(e->>k) is not true)) then return false; end if;
  end loop;
  if not(e?'plan_id') or (e->'plan_id'<>'null'::jsonb and (jsonb_typeof(e->'plan_id') is distinct from 'string' or not((e->>'plan_id')=any(plan_ids)))) then return false; end if;
 end loop;
 for e in select value from jsonb_array_elements(j->'goal_history') loop
  if (e-'id'-'date'-'title'-'due_date'-'goal')<>'{}'::jsonb or jsonb_typeof(e->'title') is distinct from 'string' or length(btrim(e->>'title')) not between 1 and 120
  or public.ayumi_journey_goal_valid(e->'goal') is not true or not(e?'due_date') or (e->'due_date'<>'null'::jsonb and (jsonb_typeof(e->'due_date') is distinct from 'string' or public.ayumi_date_valid(e->>'due_date') is not true)) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;
alter table public.ayumi_projects add column if not exists journey jsonb;
alter table public.ayumi_projects add column if not exists journey_revision integer not null default 0;
alter table public.ayumi_projects drop constraint if exists ayumi_journey_check;
alter table public.ayumi_projects add constraint ayumi_journey_check check(public.ayumi_journey_valid(journey) is true and journey_revision>=0);
-- Legacy achieved_on is historical evidence, never recomputed from new check states.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.ayumi_projects'::regclass and contype='c' and pg_get_constraintdef(oid) like '%achieved_on%' loop
  execute format('alter table public.ayumi_projects drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.ayumi_projects add constraint ayumi_legacy_achieved_date check(achieved_on is null or achieved_on between date '0001-01-01' and date '9999-12-31');
grant insert(journey,journey_revision),update(journey,journey_revision) on public.ayumi_projects to authenticated;
create or replace function public.ayumi_journey_guard() returns trigger language plpgsql set search_path='' as $$
declare k text; old_entries jsonb; new_entries jsonb;
begin
 if TG_OP='UPDATE' then
  if (old.journey_revision>0 or new.journey_revision>0 or new.journey is not null) and new.journey_revision<>old.journey_revision+1 then
   raise exception 'Reload required: journey compatible client required';
  end if;
  if old.journey is not null then
   if new.journey is null then raise exception 'Journey history cannot be removed'; end if;
   foreach k in array array['plans','outcomes','reviews','goal_history','events'] loop
    old_entries:=old.journey->k;new_entries:=new.journey->k;
    if jsonb_typeof(new_entries) is distinct from 'array' or jsonb_array_length(new_entries)<jsonb_array_length(old_entries)
    or exists(select 1 from jsonb_array_elements(old_entries) with ordinality x(v,n) where new_entries->(x.n::int-1) is distinct from x.v) then
     raise exception 'Journey history cannot be rewritten';
    end if;
   end loop;
  end if;
  if new.journey_revision>0 and new.achieved_on is distinct from old.achieved_on then raise exception 'Preserve legacy achievement'; end if;
 elsif (new.journey is not null or new.journey_revision>0) and new.journey_revision<>1 then raise exception 'Journey revision required';
 elsif new.journey_revision>0 and new.achieved_on is not null then raise exception 'Do not invent legacy achievement';
 end if;
 return new;
end; $$;
drop trigger if exists ayumi_journey_guard on public.ayumi_projects;
create trigger ayumi_journey_guard before insert or update on public.ayumi_projects for each row execute function public.ayumi_journey_guard();
commit;
