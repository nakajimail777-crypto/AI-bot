import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import '../assets/ayumi.js';
test('focus migration: roundtrip, undo, owner isolation, guest denial, legacy guard and stale version',async()=>{
 const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
  create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('is_anonymous',coalesce(nullif(current_setting('test.anon',true),''),'false')::boolean)$$;
  grant usage on schema auth to authenticated;`);
  for(const name of ['20261030_ayumi.sql','20261030_ayumi_history.sql','20261031_ayumi_weeks.sql','20261031_ayumi_project_archive.sql','20261101_ayumi_daily.sql','20261101_ayumi_v2.sql','20261101_ayumi_v3.sql','20261101_ayumi_schedule.sql','20261101_ayumi_focus.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1),($2)',[owner,other]);
  await db.exec(`set role authenticated;set test.uid='${owner}';`);
 const items=[{id:'a',text:'Step',done:false}],focus={date:'2026-11-01',item_id:'a',status:'active'};
 const row=(await db.query("insert into ayumi_projects(title,items,focus_day,focus_revision,v2_revision,trash_revision,schedule_revision) values('Test',$1,$2,1,1,1,1) returning *",[JSON.stringify(items),JSON.stringify(focus)])).rows[0];
 assert.deepEqual(row.focus_day,focus);
 items[0].done=true;focus.status='done';
 await db.query('update ayumi_projects set items=$1,focus_day=$2,version=2,focus_revision=2,v2_revision=2,trash_revision=2,schedule_revision=2 where id=$3 and version=1',[JSON.stringify(items),JSON.stringify(focus),row.id]);
 let restored=(await db.query('select * from ayumi_projects')).rows[0];assert.equal(DragonAyumi.focusState(restored,'2026-11-01').kind,'done');
 assert.equal((await db.query('update ayumi_projects set version=2 where id=$1 and version=1 returning id',[row.id])).rows.length,0);
 await assert.rejects(db.query('update ayumi_projects set version=3,v2_revision=3,trash_revision=3,schedule_revision=3 where id=$1',[row.id]),/Reload required/);
 items[0].done=false;
 await db.query('update ayumi_projects set items=$1,version=3,focus_revision=3,v2_revision=3,trash_revision=3,schedule_revision=3 where id=$2',[JSON.stringify(items),row.id]);
 assert.equal((await db.query('select focus_day from ayumi_projects')).rows[0].focus_day.status,'active');
 for(const invalid of [{},[],{...focus,date:'2026-02-30'},{...focus,status:'magic'},{...focus,item_id:null},{...focus,extra:true}])await assert.rejects(db.query("insert into ayumi_projects(title,focus_day,focus_revision) values('Bad',$1,1)",[JSON.stringify(invalid)]));
 await db.exec(`set test.uid='${other}';`);assert.equal((await db.query('select * from ayumi_projects')).rows.length,0);
 assert.equal((await db.query('update ayumi_projects set focus_day=null returning id')).rows.length,0);
 await db.exec(`set test.uid='${owner}';set test.anon='true';`);
 await assert.rejects(db.query("insert into ayumi_projects(title,focus_day,focus_revision) values('Guest',$1,1)",[JSON.stringify(focus)]));
 await db.exec("set test.anon='false';");
 const legacy=(await db.query("insert into ayumi_projects(title) values('Old') returning *")).rows[0];assert.equal(legacy.focus_day,null);
 await db.query('update ayumi_projects set version=2 where id=$1',[legacy.id]);
 }finally{await db.close();}
});