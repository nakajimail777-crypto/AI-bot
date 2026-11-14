begin;

-- Independent from web accounts: no raw LINE IDs or reply tokens are persisted.
create table if not exists public.line_chat_sessions (
  user_hash text primary key check (user_hash ~ '^[0-9a-f]{64}$'),
  turns jsonb not null default '[]',
  active_event text,
  lease uuid,
  busy_until timestamptz,
  minute_start timestamptz not null default now(),
  minute_count integer not null default 0,
  day_start date not null default current_date,
  day_count integer not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.line_chat_events (
  event_id text primary key,
  user_hash text not null references public.line_chat_sessions(user_hash) on delete cascade,
  lease uuid not null,
  status text not null check (status in ('processing','prepared','sent','failed')),
  message text,
  reply text,
  created_at timestamptz not null default now()
);
create index if not exists line_chat_events_user_created on public.line_chat_events(user_hash,created_at);
create table if not exists public.line_chat_daily (
  day date primary key,
  attempts integer not null default 0
);
alter table public.line_chat_sessions enable row level security;
alter table public.line_chat_events enable row level security;
alter table public.line_chat_daily enable row level security;
revoke all on public.line_chat_sessions, public.line_chat_events, public.line_chat_daily from public, anon, authenticated;

create or replace function public.line_chat(
  p_user text, p_event text, p_lease uuid, p_action text,
  p_message text default null, p_reply text default null,
  p_reset boolean default false, p_remember boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.line_chat_sessions; e public.line_chat_events; n integer; code text; first_turn boolean;
begin
  if p_user is null or p_user !~ '^[0-9a-f]{64}$' or p_event is null or p_event !~ '^[A-Za-z0-9_-]{1,100}$' or p_lease is null then
    raise exception 'LINE_INVALID';
  end if;
  -- Consistent lock order across users keeps quota updates and user leases atomic.
  perform pg_advisory_xact_lock(12092026);
  if p_action = 'reserve' then
    if p_message is null or length(p_message)>4000 then raise exception 'LINE_INVALID'; end if;
    -- Retain deduplication IDs for 30 days; old conversation content expires on access.
    delete from public.line_chat_events where created_at < now()-interval '30 days';
    delete from public.line_chat_sessions where updated_at < now()-interval '30 days';
    delete from public.line_chat_daily where day < current_date-30;
    select * into e from public.line_chat_events where event_id=p_event;
    if found then return jsonb_build_object('skip',true); end if;
    insert into public.line_chat_sessions(user_hash) values(p_user) on conflict do nothing;
    select * into s from public.line_chat_sessions where user_hash=p_user for update;
    if s.minute_start < now()-interval '1 minute' then s.minute_start:=now(); s.minute_count:=0; end if;
    if s.day_start <> current_date then s.day_start:=current_date; s.day_count:=0; end if;
    insert into public.line_chat_daily(day) values(current_date) on conflict do nothing;
    select attempts into n from public.line_chat_daily where day=current_date for update;
    if s.busy_until > now() then code:='BUSY';
    elsif s.minute_count>=5 or s.day_count>=100 or n>=500 then code:='LIMIT'; end if;
    insert into public.line_chat_events(event_id,user_hash,lease,status,message)
      values(p_event,p_user,p_lease,'processing',case when code is null then p_message else null end);
    if code is not null then return jsonb_build_object('code',code); end if;
    first_turn:=jsonb_array_length(s.turns)=0;
    if p_reset then
      s.turns:='[]';
      update public.line_chat_events set message=null,reply=null where user_hash=p_user;
    end if;
    update public.line_chat_sessions set turns=s.turns,active_event=p_event,lease=p_lease,busy_until=now()+interval '90 seconds',
      minute_start=s.minute_start,minute_count=s.minute_count+1,day_start=s.day_start,day_count=s.day_count+1,updated_at=now() where user_hash=p_user;
    update public.line_chat_daily set attempts=attempts+1 where day=current_date;
    return jsonb_build_object('turns',s.turns,'first',first_turn);
  end if;
  select * into e from public.line_chat_events where event_id=p_event and user_hash=p_user and lease=p_lease for update;
  if not found or e.status in ('sent','failed') then raise exception 'LINE_LEASE'; end if;
  if p_action='prepare' then
    if e.status<>'processing' or p_reply is null or length(p_reply)=0 or length(p_reply)>24000 then raise exception 'LINE_INVALID'; end if;
    update public.line_chat_events set reply=p_reply,status='prepared' where event_id=p_event;
  elsif p_action='finish' then
    if e.status<>'prepared' then raise exception 'LINE_INVALID'; end if;
    if p_remember then
      select * into s from public.line_chat_sessions where user_hash=p_user and active_event=p_event and lease=p_lease for update;
      if not found or s.busy_until<now() or e.message is null then raise exception 'LINE_LEASE'; end if;
      s.turns:=s.turns || jsonb_build_array(jsonb_build_object('message',e.message,'reply',e.reply));
      select coalesce(jsonb_agg(value order by ord),'[]') into s.turns from jsonb_array_elements(s.turns) with ordinality t(value,ord)
        where ord>jsonb_array_length(s.turns)-20;
      update public.line_chat_sessions set turns=s.turns,updated_at=now() where user_hash=p_user;
    end if;
    update public.line_chat_events set status='sent',message=null,reply=null where event_id=p_event;
  elsif p_action='fail' then
    update public.line_chat_events set status='failed',message=null,reply=null where event_id=p_event;
  else raise exception 'LINE_ACTION'; end if;
  if p_action in ('finish','fail') then
    update public.line_chat_sessions set active_event=null,lease=null,busy_until=null where user_hash=p_user and active_event=p_event and lease=p_lease;
  end if;
  return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.line_chat(text,text,uuid,text,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.line_chat(text,text,uuid,text,text,text,boolean,boolean) to service_role;
commit;
