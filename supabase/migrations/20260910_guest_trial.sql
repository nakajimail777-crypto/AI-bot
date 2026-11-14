-- Additive: trial conversations are separate from members' saved history.
begin;
create table public.trial_sessions (
 id uuid primary key, expires_at timestamptz not null default now()+interval '30 days',
 turns jsonb not null default '[]', attempts integer not null default 0,
 lease uuid, lease_until timestamptz, request_id uuid, message text, mode boolean
);
create table public.trial_network_limits (
 network_hash text not null, day date not null, attempts integer not null default 0,
 primary key(network_hash,day)
);
alter table public.trial_sessions enable row level security;
alter table public.trial_network_limits enable row level security;
revoke all on public.trial_sessions,public.trial_network_limits from public,anon,authenticated;

create function public.trial_chat(p_id uuid,p_action text,p_request uuid default null,p_lease uuid default null,p_message text default null,p_mode boolean default false,p_network text default null,p_reply text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.trial_sessions%rowtype; item jsonb; result_rows jsonb; used integer; net_used integer;
begin
 if p_id is null or p_action not in ('state','reserve','finish','fail') then raise exception 'INVALID_TRIAL';end if;
 if p_action='reserve' then
  if p_request is null or p_lease is null or p_mode is null or p_message is null or length(trim(p_message)) not between 1 and 4000 or p_network is null or p_network !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_TRIAL';end if;
  delete from public.trial_sessions where expires_at<now();
  delete from public.trial_network_limits where day<current_date-1;
  insert into public.trial_sessions(id) values(p_id) on conflict do nothing;
 end if;
 select * into s from public.trial_sessions where id=p_id and expires_at>now() for update;
 if not found then
  if p_action='state' then return jsonb_build_object('rows','[]'::jsonb,'remaining',5);end if;
  return jsonb_build_object('code','TRIAL_EXPIRED','error','体験の有効期限が切れました。ページを再読み込みしてください。');
 end if;
 used=jsonb_array_length(s.turns);
 if p_action='reserve' then
  for item in select value from jsonb_array_elements(s.turns) loop
   if item->>'requestId'=p_request::text then
    if item->>'message'<>p_message or (item->>'mode')::boolean is distinct from p_mode then
     return jsonb_build_object('code','TRIAL_CONFLICT','error','送信内容が変わりました。ページを再読み込みしてください。');
    end if;
    return jsonb_build_object('cached',true,'reply',item->>'reply','remaining',5-used);
   end if;
  end loop;
  if used>=5 then return jsonb_build_object('code','TRIAL_LIMIT','error','5往復のお試しが終わりました。ログインして会話を続けましょう。');end if;
  if s.lease_until>now() then return jsonb_build_object('code','TRIAL_BUSY','error','前の返答を作成中です。少し待ってから再送してください。');end if;
  if s.attempts>=10 then return jsonb_build_object('code','TRIAL_ATTEMPTS','error','お試しの再試行上限に達しました。ログインしてご利用ください。');end if;
  insert into public.trial_network_limits(network_hash,day) values(p_network,current_date) on conflict do nothing;
  select attempts into net_used from public.trial_network_limits where network_hash=p_network and day=current_date for update;
  if net_used>=30 then return jsonb_build_object('code','TRIAL_NETWORK_LIMIT','error','この接続からのお試し利用が本日の上限に達しました。ログインしてご利用ください。');end if;
  update public.trial_network_limits set attempts=attempts+1 where network_hash=p_network and day=current_date;
  update public.trial_sessions set attempts=attempts+1,lease=p_lease,lease_until=now()+interval '100 seconds',request_id=p_request,message=p_message,mode=p_mode where id=p_id;
 elsif p_action='finish' then
  if s.lease is distinct from p_lease or s.request_id is distinct from p_request or p_lease is null or p_request is null or p_reply is null or length(trim(p_reply)) not between 1 and 32000 then raise exception 'STALE_TRIAL';end if;
  update public.trial_sessions set turns=turns||jsonb_build_array(jsonb_build_object('requestId',p_request,'message',s.message,'mode',s.mode,'reply',p_reply)),lease=null,lease_until=null,message=null where id=p_id;
  return jsonb_build_object('reply',p_reply,'remaining',4-used);
 elsif p_action='fail' then
  update public.trial_sessions set lease=null,lease_until=null,message=null where id=p_id and lease=p_lease and request_id=p_request;
  return '{}'::jsonb;
 end if;
 select coalesce(jsonb_agg(row order by ord,role_order),'[]'::jsonb) into result_rows
 from jsonb_array_elements(s.turns) with ordinality t(value,ord)
 cross join lateral (values (1,jsonb_build_object('role','user','content',value->>'message')),(2,jsonb_build_object('role','assistant','content',value->>'reply'))) r(role_order,row);
 return jsonb_build_object('rows',result_rows,'remaining',5-used);
end;$$;
revoke all on function public.trial_chat(uuid,text,uuid,uuid,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.trial_chat(uuid,text,uuid,uuid,text,boolean,text,text) to service_role;
commit;
