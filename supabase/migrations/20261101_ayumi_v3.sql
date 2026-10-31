begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.ayumi_projects
 add column deleted_goal boolean not null default false,
 add column trash_revision integer not null default 0 check(trash_revision>=0),
 add constraint ayumi_trash_archived check(not deleted_goal or archived);
grant insert(deleted_goal,trash_revision),update(deleted_goal,trash_revision) on public.ayumi_projects to authenticated;
create function public.ayumi_trash_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='UPDATE' then
  if (old.trash_revision>0 or new.trash_revision>0 or old.deleted_goal or new.deleted_goal)
     and new.trash_revision<>old.trash_revision+1 then
   raise exception 'Reload required: trash needs a compatible client' using errcode='P0001';
  end if;
 elsif (new.deleted_goal or new.trash_revision>0) and new.trash_revision<>1 then
  raise exception 'Trash revision required';
 end if;
 return new;
end; $$;
create trigger ayumi_trash_guard before insert or update on public.ayumi_projects for each row execute function public.ayumi_trash_guard();
grant delete on public.ayumi_projects to authenticated;
create policy ayumi_delete_trash on public.ayumi_projects for delete to authenticated
using(user_id=(select auth.uid()) and deleted_goal and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false');
commit;
