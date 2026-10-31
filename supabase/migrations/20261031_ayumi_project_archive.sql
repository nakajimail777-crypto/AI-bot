begin;
set local lock_timeout='5s';
alter table public.ayumi_projects add column archived boolean not null default false;
grant insert(archived),update(archived) on public.ayumi_projects to authenticated;
commit;
