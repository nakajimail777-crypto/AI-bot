import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import '../assets/ayumi.js';
test('trash keeps records, rejects invalid state and refuses erasing active goals',async()=>{
 const goal={id:'sample',title:'Goal',items:[{id:'a',text:'Step',done:true,due_date:'2026-11-02'}],archived:true,deleted_goal:true,insight:'Note'};
 const normalized=DragonAyumi.normalize(goal);
 assert.equal(normalized.deleted_goal,true);assert.equal(normalized.items[0].due_date,'2026-11-02');
 assert.equal(normalized.insight,'Note');
 assert.throws(()=>DragonAyumi.normalize({...goal,archived:false}));
 await assert.rejects(DragonAyumi.erase(null,'owner',{...goal,deleted_goal:false,version:1}));
});
test('database trash restore, stale clients, owner-only deletion and version protection',async()=>{
 const db=new PGlite();const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
  create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('is_anonymous',coalesce(nullif(current_setting('test.anon',true),''),'false')::boolean)$$;
  grant usage on schema auth to authenticated;`);
  for(const name of ['20261030_ayumi.sql','20261030_ayumi_history.sql','20261031_ayumi_weeks.sql','20261031_ayumi_project_archive.sql','20261101_ayumi_daily.sql','20261101_ayumi_v2.sql','20261101_ayumi_v3.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1),($2)',[owner,other]);
  await db.exec(`set role authenticated;set test.uid='${owner}';`);
  const original=(await db.query("insert into ayumi_projects(title,insight,v2_revision,trash_revision) values('Test','Keep this',1,1) returning *")).rows[0];
  assert.equal((await db.query('delete from ayumi_projects returning id')).rows.length,0);
  await db.query('update ayumi_projects set archived=true,deleted_goal=true,version=2,v2_revision=2,trash_revision=2 where id=$1',[original.id]);
  await assert.rejects(db.query('update ayumi_projects set archived=false,deleted_goal=false,version=3,v2_revision=3 where id=$1',[original.id]),/Reload required/);
  await db.exec(`set test.uid='${other}';`);
  assert.equal((await db.query('select * from ayumi_projects')).rows.length,0);
  assert.equal((await db.query('delete from ayumi_projects returning id')).rows.length,0);
  await db.exec(`set test.uid='${owner}';set test.anon='true';`);
  assert.equal((await db.query('delete from ayumi_projects returning id')).rows.length,0);
  await db.exec("set test.anon='false';");
  await db.query('update ayumi_projects set deleted_goal=false,version=3,v2_revision=3,trash_revision=3 where id=$1',[original.id]);
  assert.equal((await db.query('select insight from ayumi_projects')).rows[0].insight,'Keep this');
  assert.equal((await db.query('delete from ayumi_projects returning id')).rows.length,0);
  await db.query('update ayumi_projects set deleted_goal=true,version=4,v2_revision=4,trash_revision=4 where id=$1',[original.id]);
  assert.equal((await db.query('delete from ayumi_projects where version=3 returning id')).rows.length,0);
  assert.equal((await db.query('delete from ayumi_projects where version=4 returning id')).rows.length,1);
  assert.equal((await db.query('select * from ayumi_projects')).rows.length,0);
 }finally{await db.close();}
});
