-- Apply after 20260907_register_knowledge_document.sql.
begin;
create or replace function public.bookshelf_remove(p_document_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.knowledge_documents where id=p_document_id and metadata->>'origin'='bookshelf' for update;
  if not found then raise exception 'BOOK_NOT_FOUND'; end if;
  delete from public.knowledge_chunks where document_id=p_document_id;
  update public.knowledge_documents set metadata=metadata || '{"shelf_removed":true}'::jsonb,updated_at=now() where id=p_document_id;
end;
$$;
revoke all on function public.bookshelf_remove(uuid) from public,anon,authenticated;
grant execute on function public.bookshelf_remove(uuid) to service_role;
commit;
