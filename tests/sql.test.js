import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Isolated PostgreSQL, not the user's Supabase. Fixture models the observed
// existing save RPC's contract; this is not a replacement production migration.
test('migration: permissions, answer receipts, deletion and JST month accounting',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create table public.conversations(id uuid primary key,user_id uuid,archived_at timestamptz);
 create table public.messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,user_id uuid,role text,content text,reply_to uuid,sequence bigint generated always as identity);
 grant usage on schema public,auth to service_role;
 grant all on public.conversations,public.messages to service_role;
 grant usage,select on all sequences in schema public to service_role;
 create function public.chat_save_turn(p_user_id uuid,p_conversation_id uuid,p_request_id uuid,p_message text,p_reply text,p_last_sequence bigint)
 returns jsonb language plpgsql as $$
 declare c public.conversations%rowtype;m public.messages%rowtype;saved_reply text;current_sequence bigint;
 begin
 select * into c from public.conversations where id=p_conversation_id and user_id=p_user_id for update;
 if not found or c.archived_at is not null then raise exception 'CHAT_NOT_FOUND';end if;
 select * into m from public.messages where id=p_request_id;
 if found then
 if m.conversation_id<>p_conversation_id or m.user_id<>p_user_id or m.role<>'user' or m.content<>p_message then raise exception 'CHAT_ID_CONFLICT';end if;
 select content into saved_reply from public.messages where reply_to=p_request_id and conversation_id=p_conversation_id and user_id=p_user_id;
 if saved_reply is null then raise exception 'CHAT_ID_CONFLICT';end if;
 return jsonb_build_object('reply',saved_reply);end if;
 select coalesce(max(sequence),0) into current_sequence from public.messages where conversation_id=p_conversation_id;
 if current_sequence is distinct from p_last_sequence then raise exception 'CHAT_CHANGED';end if;
 insert into public.messages(id,conversation_id,user_id,role,content) values(p_request_id,p_conversation_id,p_user_id,'user',p_message);
 insert into public.messages(conversation_id,user_id,role,content,reply_to) values(p_conversation_id,p_user_id,'assistant',p_reply,p_request_id);
 return jsonb_build_object('reply',p_reply);end;$$;
 `);
 await db.exec(await readFile(new URL('../supabase/migrations/20260908_api_usage.sql',import.meta.url),'utf8'));
 const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',chat='33333333-3333-4333-8333-333333333333',request='44444444-4444-4444-8444-444444444444';
 await db.query('insert into auth.users values($1),($2)',[user,other]);
 await db.query('insert into conversations(id,user_id) values($1,$2)',[chat,user]);
 const save='select chat_save_turn_with_usage($1,$2,$3,$4,$5,$6,$7) as result';
 const params=[user,chat,request,'question','first answer',0,{generation:{input:123}}];
 await db.exec('set role service_role');
 const first=(await db.query(save,params)).rows[0].result;
 assert.equal(first.usage.generation.input,123);
 const retry=(await db.query(save,[...params.slice(0,4),'second answer',0,{generation:{input:999}}])).rows[0].result;
 assert.equal(retry.reply,'first answer');assert.equal(retry.usage.generation.input,123);
 assert.equal((await db.query('select count(*)::int as n from messages')).rows[0].n,2);
 await assert.rejects(db.query(save,[other,...params.slice(1)]),/CHAT_NOT_FOUND/);
 await assert.rejects(db.query(save,[user,chat,'55555555-5555-4555-8555-555555555555',...params.slice(3)]),/CHAT_CHANGED/);
 // A rejected telemetry insert must not turn a successful answer into an error.
 await db.exec('reset role; revoke insert on api_turn_usage from service_role; set role service_role');
 const noReceipt=(await db.query(save,[user,chat,'66666666-6666-4666-8666-666666666666','next','saved safely',2,{}])).rows[0].result;
 assert.equal(noReceipt.reply,'saved safely');assert.equal(noReceipt.usage,null);
 await db.exec('reset role; grant insert on api_turn_usage to service_role; set role service_role');
 const event=`insert into api_usage_events(id,user_id,conversation_id,request_id,occurred_at,category,model,outcome,usage,estimated_usd,billed_usd) values(gen_random_uuid(),$1,$2,$3,$4,$5,'test','succeeded','{}',$6,$7)`;
 await db.query(event,[user,chat,request,'2026-08-31T15:00:00Z','generation',1,0]);
 await db.query(event,[user,chat,request,'2026-09-30T14:59:59Z','rag_search',0.2,0]);
 await db.query(event,[user,chat,request,'2026-09-30T15:00:00Z','generation',9,0]);
 await db.query(event,[null,null,request,'2026-09-15T00:00:00Z','document_embedding',0.5,null]);
 await db.query(event,[user,chat,request,'2026-09-15T01:00:00Z','generation',null,null]);
 const totals=async(id)=>(await db.query('select api_usage_month($1,$2) as result',['2026-09-01',id])).rows[0].result;
 assert.equal((await totals(user)).estimatedUsd,1.2);assert.equal((await totals(user)).unknownCalls,1);
 assert.equal((await totals(null)).estimatedUsd,1.7);assert.equal((await totals(null)).billingUnknownCalls,2);
 await db.query('delete from messages where conversation_id=$1',[chat]);
 await db.query('delete from conversations where id=$1',[chat]);
 assert.equal((await db.query('select count(*)::int as n from api_turn_usage')).rows[0].n,0);
 assert.equal((await totals(user)).estimatedUsd,1.2);
 await db.exec('reset role; set role authenticated');
 await assert.rejects(db.query('select * from api_usage_events'),/permission denied/);
 await assert.rejects(db.query('select api_usage_month($1,null)',['2026-09-01']),/permission denied/);
 await assert.rejects(db.query(save,params),/permission denied/);
 } finally {await db.close();}
});
