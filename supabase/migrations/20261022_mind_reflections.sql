begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- New storage only: existing messages, memories and AI behavior are unchanged.
create function public.valid_mind_reflection(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; options text[]; choice text;
begin
 if jsonb_typeof(p) is distinct from 'object' or p->>'version' is distinct from '1' or jsonb_typeof(p->'fields') is distinct from 'object'
    or length(p::text)>60000 or p->>'id' is null then return false; end if;
 perform (p->>'id')::uuid;
 if p->>'resultViewedAt' is not null then perform (p->>'resultViewedAt')::timestamptz; end if;
 foreach k in array array['event','feeling','interpretation','reaction','afterglow'] loop
   v=p->'fields'->k;
   if v is null or jsonb_typeof(v)<>'object' or jsonb_typeof(v->'skipped') is distinct from 'boolean' then return false; end if;
   if k='feeling' then
     if jsonb_typeof(v->'value') is distinct from 'array' or jsonb_array_length(v->'value')>7
        or jsonb_typeof(v->'note') is distinct from 'string' or length(v->>'note')>2000 then return false; end if;
     options=array['不安','うれしい','いらだち','悲しさ','安心','戸惑い','特にわからない'];
     for choice in select jsonb_array_elements_text(v->'value') loop
       if choice is null or not choice=any(options) then return false; end if;
     end loop;
     if v->'value' ? '特にわからない' and jsonb_array_length(v->'value')>1 then return false; end if;
   elsif k='afterglow' then
     if jsonb_typeof(v->'value') is distinct from 'string' or not (v->>'value'=any(array['','まだ気になっている','少し落ち着いた','別の見方もできそう','よくわからない','特に残っていない'])) then return false; end if;
   else
     if jsonb_typeof(v->'value') is distinct from 'string' or length(v->>'value')>2000 then return false; end if;
   end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create table public.mind_reflections (
 id uuid not null,
 kind text not null check (kind in ('draft','record')),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 payload jsonb not null check (public.valid_mind_reflection(payload) and payload->>'id'=id::text),
 saved_at timestamptz not null default clock_timestamp(),
 revision uuid not null default gen_random_uuid(),
 primary key(user_id,id,kind),
 check (kind='draft' or payload->>'resultViewedAt' is not null)
);
create index mind_reflections_owner_time on public.mind_reflections(user_id,kind,saved_at desc,id desc);
alter table public.mind_reflections enable row level security;
revoke all on public.mind_reflections from public,anon,authenticated;
grant select,insert,update,delete on public.mind_reflections to authenticated;
create policy mind_reflections_owner on public.mind_reflections to authenticated
 using (user_id=(select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false')
 with check (user_id=(select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false');

-- Same payload retry returns the same receipt; stale edits fail instead of overwriting.
-- Row ownership is constrained both explicitly and by RLS (security invoker).
create function public.save_mind_reflection(p_id uuid,p_kind text,p_payload jsonb,p_revision uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.mind_reflections; saved public.mind_reflections;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_kind not in ('draft','record') or not public.valid_mind_reflection(p_payload) then raise exception 'INVALID_RECORD' using errcode='22023'; end if;
 -- Serialize requests for a reflection, including its draft and completed record.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_id::text,0));
 select * into previous from public.mind_reflections where user_id=auth.uid() and id=p_id and kind=p_kind for update;
 if found then
   if previous.payload=p_payload then return to_jsonb(previous)-'user_id'; end if;
   if previous.revision is distinct from p_revision then raise exception 'REFLECTION_CONFLICT' using errcode='40001'; end if;
   update public.mind_reflections set payload=p_payload,saved_at=clock_timestamp(),revision=gen_random_uuid()
    where user_id=auth.uid() and id=p_id and kind=p_kind returning * into saved;
 else
   if p_revision is not null then raise exception 'REFLECTION_CONFLICT' using errcode='40001'; end if;
   insert into public.mind_reflections(id,kind,payload) values(p_id,p_kind,p_payload) returning * into saved;
 end if;
 if p_kind='record' then delete from public.mind_reflections where user_id=auth.uid() and id=p_id and kind='draft'; end if;
 return to_jsonb(saved)-'user_id';
end $$;
revoke all on function public.save_mind_reflection(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.save_mind_reflection(uuid,text,jsonb,uuid) to authenticated;
commit;
