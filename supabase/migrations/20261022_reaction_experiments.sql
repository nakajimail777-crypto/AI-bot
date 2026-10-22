begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Additive migration only. Do not apply to production without approval.
create function public.valid_reaction_experiment(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text;
begin
 if jsonb_typeof(p) is distinct from 'object' or p->'version' is distinct from '1'::jsonb or jsonb_typeof(p->'fields') is distinct from 'object' or length(p::text)>90000 then return false; end if;
 if p->>'id' is null then return false; end if; perform (p->>'id')::uuid;
 if p->'step' is null or not p->'step'=any(array['0','1','2','3','4']::jsonb[]) then return false; end if;
 if p->>'status' is null or not p->>'status'=any(array['draft','planned','finished','skipped']) then return false; end if;
 if p->>'choice' is null or not p->>'choice'=any(array['undecided','try','keep']) then return false; end if;
 if p->>'attempt' is null or not p->>'attempt'=any(array['not_yet','tried','skipped']) then return false; end if;
 foreach k in array array['event','feelings','usualReaction','discovery','pattern','chosenReaction','situation','plan','expectation','actualReaction','afterFeelings','insight','difference'] loop
  if jsonb_typeof(p->'fields'->k) is distinct from 'string' or length(p->'fields'->>k)>2000 then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;
create table public.reaction_experiments (
 id uuid not null,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 payload jsonb not null check(public.valid_reaction_experiment(payload) and payload->>'id'=id::text),
 revision uuid not null default gen_random_uuid(),
 saved_at timestamptz not null default clock_timestamp(),
 primary key(user_id,id)
);
create index reaction_experiments_owner_time on public.reaction_experiments(user_id,saved_at desc,id desc);
alter table public.reaction_experiments enable row level security;
revoke all on public.reaction_experiments from public,anon,authenticated;
grant select,insert,update,delete on public.reaction_experiments to authenticated;
create policy reaction_experiments_owner on public.reaction_experiments to authenticated
using(user_id=(select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false')
with check(user_id=(select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false');
create function public.save_reaction_experiment(p_id uuid,p_payload jsonb,p_revision uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.reaction_experiments; saved public.reaction_experiments;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if not public.valid_reaction_experiment(p_payload) then raise exception 'INVALID_RECORD' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_id::text,1));
 select * into old from public.reaction_experiments where user_id=auth.uid() and id=p_id for update;
 if found then
  if old.payload=p_payload then return to_jsonb(old)-'user_id'; end if;
  if old.revision is distinct from p_revision then raise exception 'LAB_CONFLICT' using errcode='40001'; end if;
  update public.reaction_experiments set payload=p_payload,revision=gen_random_uuid(),saved_at=clock_timestamp() where user_id=auth.uid() and id=p_id returning * into saved;
 else
  if p_revision is not null then raise exception 'LAB_CONFLICT' using errcode='40001'; end if;
  insert into public.reaction_experiments(id,payload) values(p_id,p_payload) returning * into saved;
 end if;
 return to_jsonb(saved)-'user_id';
end $$;
create function public.delete_reaction_experiment(p_id uuid,p_revision uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare old public.reaction_experiments;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_id::text,1));
 select * into old from public.reaction_experiments where user_id=auth.uid() and id=p_id for update;
 if not found then return true; end if;
 if old.revision is distinct from p_revision then raise exception 'LAB_CONFLICT' using errcode='40001'; end if;
 delete from public.reaction_experiments where user_id=auth.uid() and id=p_id;
 return true;
end $$;
revoke all on function public.save_reaction_experiment(uuid,jsonb,uuid),public.delete_reaction_experiment(uuid,uuid) from public,anon;
grant execute on function public.save_reaction_experiment(uuid,jsonb,uuid),public.delete_reaction_experiment(uuid,uuid) to authenticated;
commit;
