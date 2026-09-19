begin;
alter table public.learning_items
  add column learning_text text not null default '' check (length(learning_text) <= 20000);
-- The admin API checks the operator and only changes these two fields.
grant update (learning_text, updated_at) on public.learning_items to service_role;
create policy learning_items_service_update on public.learning_items
  for update to service_role using (true) with check (true);
commit;
