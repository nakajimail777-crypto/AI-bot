import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import '../assets/memories.js';

test('conversation memory reads all pages in order with roles and rejects partial failures',async()=>{
 const entries=Array.from({length:201},(_,i)=>({role:i%2?'assistant':'user',content:`発言${i}`,sequence:i}));
 let fail=false;const ranges=[],filters=[];
 const query={select(){return this;},eq(k,v){filters.push([k,v]);return this;},order(k,opt){assert.equal(k,'sequence');assert.equal(opt.ascending,true);return this;},range(a,b){ranges.push([a,b]);return fail?{error:{}}:{data:entries.slice(a,b+1)};}};
 const db={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from:t=>{assert.equal(t,'messages');return query;}};
 const text=await DragonMemories.conversation(db,'owner','chat');
 assert.ok(text.startsWith('あなた\n発言0\n\nスピリットドラゴンAI\n発言1'));
 assert.ok(text.endsWith('あなた\n発言200'));
 assert.deepEqual(ranges,[[0,199],[200,399]]);
 assert.ok(filters.some(([k,v])=>k==='user_id'&&v==='owner'));
 fail=true;await assert.rejects(DragonMemories.conversation(db,'owner','chat'),/読み込めません/);
 fail=false;entries.splice(0);await assert.rejects(DragonMemories.conversation(db,'owner','chat'),/ありません/);
 entries.push({role:'user',content:'x'.repeat(100001)});
 await assert.rejects(DragonMemories.conversation(db,'owner','chat'),/長いため/);
});

test('memories: real PostgreSQL enforces owner defaults and isolation',async()=>{
 const db=new PGlite();
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
   grant usage on schema public,auth to anon,authenticated;`);
  await db.query('insert into auth.users values($1),($2)',[a,b]);
  await db.exec(await readFile(new URL('../supabase/migrations/20260923_memories.sql',import.meta.url),'utf8'));
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);
  const saved=(await db.query("insert into memories(content) values('覚えてほしい内容') returning *")).rows[0];
  assert.equal(saved.user_id,a);assert.ok(saved.created_at);assert.ok(saved.updated_at);
  await assert.rejects(db.query('insert into memories(user_id,content) values($1,$2)',[b,'偽装']),/permission denied/);
  await assert.rejects(db.query("insert into memories(content) values('   ')"),/check constraint/);
  await assert.rejects(db.query("insert into memories(content) values(repeat('x',100001))"),/check constraint/);
  await assert.rejects(db.query("update memories set content='上書き'"),/permission denied/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[b]);
  assert.equal((await db.query('select * from memories')).rows.length,0);
  assert.equal((await db.query('delete from memories where id=$1 returning id',[saved.id])).rows.length,0);
  await db.query("insert into memories(content) values('別の利用者')");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);
  assert.equal((await db.query('select * from memories')).rows.length,1);
  await db.exec(`select set_config('request.jwt.claims','{"is_anonymous":true}',false)`);
  assert.equal((await db.query('select * from memories')).rows.length,0);
  await assert.rejects(db.query("insert into memories(content) values('匿名')"),/row-level security/);
  await db.exec(`select set_config('request.jwt.claims','{}',false)`);
  assert.equal((await db.query('delete from memories where id=$1 returning id',[saved.id])).rows.length,1);
  assert.equal((await db.query('select * from memories')).rows.length,0);
  await db.exec('reset role;set role anon');
  await assert.rejects(db.query('select * from memories'),/permission denied/);
  await assert.rejects(db.query("insert into memories(content) values('未認証')"),/permission denied/);
  await assert.rejects(db.query('delete from memories'),/permission denied/);
 }finally{await db.close();}
});

test('memory client validates current user, omits user_id and retries safely',async()=>{
 const calls=[];let result={error:null};let user={id:'owner'};
 const q={insert(value){calls.push(value);return Promise.resolve(result);},select(){return this;},eq(){return this;},maybeSingle(){return {data:{content:'hello'}};}};
 const db={auth:{getUser:async()=>({data:{user}})},from:()=>q};
 await DragonMemories.save(db,'owner','fixed-id','hello');
 assert.deepEqual(calls[0],{id:'fixed-id',content:'hello'});
 result={error:{code:'23505'}};await DragonMemories.save(db,'owner','fixed-id','hello');
 await assert.rejects(DragonMemories.save(db,'owner','fixed-id','different'),/確認できません/);
 result={error:{code:'42501'}};await assert.rejects(DragonMemories.save(db,'owner','fixed-id','hello'),/保存できません/);
 for(const invalid of [null,{id:'other'},{id:'owner',is_anonymous:true}]){
  user=invalid;await assert.rejects(DragonMemories.save(db,'owner','fixed-id','hello'),/ログイン/);
 }
});
