-- Additive migration: existing RAG, messages and chat_save_turn stay intact.
begin;
create table public.api_usage_events (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  -- Deliberately no conversation/message FK: deleting a chat must not reduce spend.
  conversation_id uuid,
  request_id uuid not null,
  occurred_at timestamptz not null,
  category text not null check (category in ('generation','rag_search','document_embedding')),
  model text not null,
  http_status integer,
  outcome text not null check (outcome in ('succeeded','rejected','unknown')),
  usage jsonb not null,
  estimated_usd numeric(24,12) check (estimated_usd >= 0),
  billed_usd numeric(24,12) check (billed_usd >= 0)
);
create index api_usage_events_month on public.api_usage_events(occurred_at);
create index api_usage_events_user_month on public.api_usage_events(user_id,occurred_at);
create table public.api_turn_usage (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  usage jsonb not null
);
create index api_turn_usage_conversation on public.api_turn_usage(user_id,conversation_id);
alter table public.api_usage_events enable row level security;
alter table public.api_turn_usage enable row level security;
revoke all on public.api_usage_events,public.api_turn_usage from public,anon,authenticated;
grant select,insert on public.api_usage_events,public.api_turn_usage to service_role;

-- Keep the existing save transaction and concurrency guards. Only the winning
-- generation gets an answer receipt; all real attempts remain in the event ledger.
create function public.chat_save_turn_with_usage(
  p_user_id uuid,p_conversation_id uuid,p_request_id uuid,p_message text,p_reply text,p_last_sequence bigint,p_usage jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb; already_saved boolean; receipt jsonb;
begin
  perform 1 from public.conversations where id=p_conversation_id and user_id=p_user_id for update;
  select exists(select 1 from public.messages where id=p_request_id) into already_saved;
  result := public.chat_save_turn(p_user_id,p_conversation_id,p_request_id,p_message,p_reply,p_last_sequence);
  begin
    if not already_saved then
      insert into public.api_turn_usage(request_id,user_id,conversation_id,usage)
      values(p_request_id,p_user_id,p_conversation_id,p_usage) on conflict(request_id) do nothing;
    end if;
    select usage into receipt from public.api_turn_usage where request_id=p_request_id and user_id=p_user_id;
  exception when others then
    -- Telemetry failure does not roll back a successfully saved conversation.
    receipt := null;
  end;
  return result || jsonb_build_object('usage',receipt);
end;
$$;
revoke all on function public.chat_save_turn_with_usage(uuid,uuid,uuid,text,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.chat_save_turn_with_usage(uuid,uuid,uuid,text,text,bigint,jsonb) to service_role;

create function public.api_usage_month(p_month date,p_user_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
 with bounds as (
   select date_trunc('month',p_month::timestamp) at time zone 'Asia/Tokyo' as start_at,
     (date_trunc('month',p_month::timestamp)+interval '1 month') at time zone 'Asia/Tokyo' as end_at
 ), selected as (
   select e.* from public.api_usage_events e,bounds b
   where e.occurred_at>=b.start_at and e.occurred_at<b.end_at
     and (p_user_id is null or e.user_id=p_user_id)
 ), totals as (
   select category, count(*) as calls, count(*) filter(where estimated_usd is null) as unknown,
     count(*) filter(where billed_usd is null) as billing_unknown,
     coalesce(sum(estimated_usd),0) as estimated_usd,coalesce(sum(billed_usd),0) as billed_usd
   from selected group by category
 ) select jsonb_build_object(
   'categories',coalesce((select jsonb_agg(to_jsonb(t)) from totals t),'[]'::jsonb),
   'estimatedUsd',(select coalesce(sum(estimated_usd),0) from totals),
   'billedUsd',(select coalesce(sum(billed_usd),0) from totals),
   'unknownCalls',(select coalesce(sum(unknown),0) from totals),
   'billingUnknownCalls',(select coalesce(sum(billing_unknown),0) from totals),
   'calls',(select count(*) from selected),
   'trackingStartedAt',(select min(occurred_at) from public.api_usage_events where p_user_id is null or user_id=p_user_id)
 );
$$;
revoke all on function public.api_usage_month(date,uuid) from public,anon,authenticated;
grant execute on function public.api_usage_month(date,uuid) to service_role;
commit;
