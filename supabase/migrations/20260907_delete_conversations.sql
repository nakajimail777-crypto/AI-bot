-- Apply to the existing Supabase database before deploying the UI.
-- All deletes are atomic; unexpected dependencies roll back the operation.
begin;
create or replace function public.delete_my_conversations(
  p_conversation_id uuid default null,
  p_delete_all boolean default false
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  target_ids uuid[];
begin
  if caller is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_delete_all is null or (p_delete_all and p_conversation_id is not null)
     or (not p_delete_all and p_conversation_id is null) then
    raise exception 'INVALID_DELETE_TARGET';
  end if;
  -- Lock parent rows so concurrent saves cannot re-create deleted messages.
  select coalesce(array_agg(id), '{}'::uuid[]) into target_ids
  from (select id from public.conversations
        where user_id = caller and (p_delete_all or id = p_conversation_id)
        order by id for update) as owned;
  -- Repeated requests are safe, and foreign IDs never delete another user's rows.
  delete from public.debug_events where user_id = caller and conversation_id = any(target_ids);
  delete from public.messages where conversation_id = any(target_ids);
  delete from public.conversations where user_id = caller and id = any(target_ids);
end;
$$;
revoke all on function public.delete_my_conversations(uuid, boolean) from public, anon;
grant execute on function public.delete_my_conversations(uuid, boolean) to authenticated;
commit;
