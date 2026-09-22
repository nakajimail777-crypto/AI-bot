begin;
create or replace function public.adopt_learning_item(p_id uuid, p_expected_updated_at timestamptz, p_title text, p_chunks jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare candidate public.learning_items; document_id uuid; removed boolean;
begin
  select * into candidate from public.learning_items where id=p_id for update;
  if not found then raise exception 'CANDIDATE_NOT_FOUND'; end if;
  if candidate.updated_at is distinct from p_expected_updated_at then raise exception 'CANDIDATE_CONFLICT'; end if;
  if candidate.bookshelf_document_id is not null then
    select coalesce((metadata->>'shelf_removed')::boolean,false) into removed from public.knowledge_documents where id=candidate.bookshelf_document_id for update;
    if not found then raise exception 'BOOK_NOT_FOUND'; end if;
    if not removed then return jsonb_build_object('id',candidate.bookshelf_document_id,'alreadyAdopted',true); end if;
  end if;
  if btrim(candidate.learning_text)='' then raise exception 'EMPTY_LEARNING'; end if;
  document_id:=coalesce(candidate.bookshelf_document_id,gen_random_uuid());
  perform public.register_knowledge_document(document_id,p_title,'学習候補から採用',
    jsonb_build_object('origin','bookshelf','shelf_removed',false,'learning_item_id',p_id,'ingestion_status','ready','embedding_model','gemini-embedding-2','dimensions',768),p_chunks);
  update public.learning_items set bookshelf_document_id=document_id,adopted_at=now() where id=p_id;
  return jsonb_build_object('id',document_id,'alreadyAdopted',false);
end;
$$;
revoke all on function public.adopt_learning_item(uuid,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.adopt_learning_item(uuid,timestamptz,text,jsonb) to service_role;
commit;
