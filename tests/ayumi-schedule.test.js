import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import '../assets/ayumi.js';
test('today selection preserves deadline, syncs completion and excludes other days',()=>{
 const goal={title:'Test',items:[{id:'a',text:'Step',done:false,due_date:'2026-11-14',scheduled_on:'2026-11-01'},{id:'b',text:'Weekly',done:false,weeks:[{start:'2026-11-01',done:false,scheduled_on:'2026-11-01'}]}]};
 const saved=DragonAyumi.normalize(goal);
 assert.equal(saved.items[0].due_date,'2026-11-14');
 const today=DragonAyumi.dayEntries(saved.items,'2026-11-01');assert.equal(today.length,2);
 today[0].unit.done=true;assert.equal(DragonAyumi.overallProgress(saved.items).done,1);
 assert.equal(DragonAyumi.dayEntries(saved.items,'2026-11-02').length,0);
 delete saved.items[0].scheduled_on;assert.equal(DragonAyumi.dayEntries(saved.items,'2026-11-01').length,1);assert.equal(saved.items[0].done,true);
 assert.throws(()=>DragonAyumi.normalize({...goal,items:[{...goal.items[0],scheduled_on:'2026-02-30'}]}));
});
test('database preserves schedule, trash, RLS and rejects stale clients',async()=>{
 const db=new PGlite();const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
  create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('is_anonymous',coalesce(nullif(current_setting('test.anon',true),''),'false')::boolean)$$;
  grant usage on schema auth to authenticated;`);
  for(const name of ['20261030_ayumi.sql','20261030_ayumi_history.sql','20261031_ayumi_weeks.sql','20261031_ayumi_project_archive.sql','20261101_ayumi_daily.sql','20261101_ayumi_v2.sql','20261101_ayumi_v3.sql','20261101_ayumi_schedule.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1),($2)',[owner,other]);
  await db.exec(`set role authenticated;set test.uid='${owner}';`);
 const items=[{id:'a',text:'Step',done:false,due_date:'2026-11-14',scheduled_on:'2026-11-01'},{id:'b',text:'Week',done:false,weeks:[{start:'2026-11-01',done:false,scheduled_on:'2026-11-01'}]}];
 const row=(await db.query("insert into ayumi_projects(title,items,v2_revision,trash_revision,schedule_revision) values('Test',$1,1,1,1) returning *",[JSON.stringify(items)])).rows[0];
 assert.deepEqual(row.items,items);
 await assert.rejects(db.query('update ayumi_projects set version=2,v2_revision=2,trash_revision=2 where id=$1',[row.id]),/Reload required/);
 const deleted=[{item:items[0],index:0,deleted_on:'2026-11-01'}];
 await db.query('update ayumi_projects set items=$1,deleted_items=$2,version=2,v2_revision=2,trash_revision=2,schedule_revision=2 where id=$3',[JSON.stringify([items[1]]),JSON.stringify(deleted),row.id]);
 assert.equal((await db.query('select deleted_items from ayumi_projects')).rows[0].deleted_items[0].item.scheduled_on,'2026-11-01');
 await db.exec(`set test.uid='${other}';`);assert.equal((await db.query('select * from ayumi_projects')).rows.length,0);
 await db.exec(`set test.uid='${owner}';`);
 await assert.rejects(db.query("insert into ayumi_projects(title,items,schedule_revision) values('Bad',$1,1)",[JSON.stringify([{...items[0],scheduled_on:'2026-02-30'}])]));
 }finally{await db.close();}
});