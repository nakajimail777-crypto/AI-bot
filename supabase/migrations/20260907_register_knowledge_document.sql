-- Run once in the correct Supabase project's SQL Editor before using rag-register.html.
-- Only the server-side secret key can execute this function.
begin;
create or replace function public.register_knowledge_document(
  p_document_id uuid,
  p_title text,
  p_source_name text,
  p_metadata jsonb,
  p_chunks jsonb
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  item jsonb;
  item_count integer;
begin
  if p_document_id is null or coalesce(trim(p_title),'')='' or jsonb_typeof(p_chunks)<>'array' then
    raise exception 'INVALID_KNOWLEDGE_DOCUMENT';
  end if;
  item_count:=jsonb_array_length(p_chunks);
  if item_count<1 or item_count>20 then raise exception 'INVALID_CHUNK_COUNT'; end if;
  for item in select value from jsonb_array_elements(p_chunks) loop
    if coalesce(trim(item->>'content'),'')='' or (item->>'chunk_index') !~ '^[0-9]+$' then
      raise exception 'INVALID_KNOWLEDGE_CHUNK';
    end if;
    perform (item->'embedding')::text::extensions.vector;
  end loop;
  insert into public.knowledge_documents(id,title,source_name,status,metadata)
  values(p_document_id,p_title,p_source_name,'active',coalesce(p_metadata,'{}'::jsonb))
  on conflict(id) do update set title=excluded.title,source_name=excluded.source_name,status='active',metadata=excluded.metadata,updated_at=now();
  delete from public.knowledge_chunks where document_id=p_document_id;
  insert into public.knowledge_chunks(document_id,chunk_index,content,embedding,metadata)
  select p_document_id,(value->>'chunk_index')::integer,value->>'content',(value->'embedding')::text::extensions.vector,coalesce(value->'metadata','{}'::jsonb)
  from jsonb_array_elements(p_chunks);
end;
$$;
revoke all on function public.register_knowledge_document(uuid,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.register_knowledge_document(uuid,text,text,jsonb,jsonb) to service_role;
commit;
