import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('adoption is atomic, revision checked, idempotent and service-only',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table knowledge_documents(id uuid primary key,title text);
 create table learning_items(id uuid primary key,learning_text text,updated_at timestamptz);
 create function register_knowledge_document(uuid,text,text,jsonb,jsonb) returns void language plpgsql as $$ begin
 insert into public.knowledge_documents values($1,$2); if $5='[]'::jsonb then raise exception 'CHUNKS_FAILED';end if; end; $$;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260922_adopt_learning.sql',import.meta.url),'utf8'));
 const id='11111111-1111-4111-8111-111111111111',stamp='2026-09-22T00:00:00Z';
 await db.query('insert into learning_items values($1,$2,$3,null,null)',[id,'学び',stamp]);
 const sql='select adopt_learning_item($1,$2,$3,$4) as result';
 await db.exec('set role authenticated');await assert.rejects(db.query(sql,[id,stamp,'題名',[{}]]),/permission denied/);
 await db.exec('reset role;set role service_role');
 await assert.rejects(db.query(sql,[id,'2026-09-21T00:00:00Z','題名',[{}]]),/CANDIDATE_CONFLICT/);
 await assert.rejects(db.query(sql,[id,stamp,'題名',[]]),/CHUNKS_FAILED/);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from knowledge_documents')).rows[0].n,0);
 assert.equal((await db.query('select bookshelf_document_id from learning_items')).rows[0].bookshelf_document_id,null);
 await db.exec('set role service_role');
 const first=(await db.query(sql,[id,stamp,'題名',[{}]])).rows[0].result;
 const retry=(await db.query(sql,[id,stamp,'題名',[{}]])).rows[0].result;
 assert.equal(first.id,retry.id);assert.equal(retry.alreadyAdopted,true);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from knowledge_documents')).rows[0].n,1);
 } finally {await db.close();}
});
