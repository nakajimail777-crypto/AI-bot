import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import '../assets/ayumi.js';
import '../assets/ayumi-journey.js';
test('journey migration twice: legacy preservation, history, validation, RLS, old client guard and versions',async()=>{
 const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
  create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('is_anonymous',coalesce(nullif(current_setting('test.anon',true),''),'false')::boolean)$$;
  grant usage on schema auth to authenticated;`);
  for(const file of ['20261030_ayumi.sql','20261030_ayumi_history.sql','20261031_ayumi_weeks.sql','20261031_ayumi_project_archive.sql','20261101_ayumi_daily.sql','20261101_ayumi_v2.sql','20261101_ayumi_v3.sql','20261101_ayumi_schedule.sql','20261101_ayumi_focus.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1),($2)',[owner,other]);await db.exec(`set role authenticated;set test.uid='${owner}';`);
  const old=(await db.query(`insert into ayumi_projects(title,items,achieved_on,v2_revision) values('Legacy','[{"id":"a","text":"Step","done":true}]','2020-01-01',1) returning *`)).rows[0];
  await db.exec('reset role');const sql=await readFile(new URL('../supabase/migrations/20261102_ayumi_journey.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);await db.exec('set role authenticated');
  const migrated=(await db.query('select * from ayumi_projects')).rows[0];assert.equal(migrated.journey,null);assert.deepEqual(migrated.items,old.items);assert.deepEqual(migrated.achieved_on,old.achieved_on);
  let j=DragonAyumiJourney.empty();j.goal={purpose:'purpose',criteria:'criteria',current:'start',constraints:''};j.plans=[{id:'plan',date:'2020-01-01',strategy:'small steps',actions:[{item_id:'a',reason:'purpose',complete_when:'read',weekdays:[0,1,2,3,4,5,6],depends_on:[]}]}];j.active_plan_id='plan';j.focus={date:'2020-01-01',item_id:'a',unit_key:'once',status:'active'};j.events=[{id:'event',...j.focus}];j.reviews=[{id:'review',date:'2020-01-01',choice:'continue',burden:'light',note:'ok',next_date:'2020-01-08',title:'Legacy',due_date:null,goal:j.goal,plan_id:'plan'}];j.outcomes.push({id:'o1',date:'2020-01-02',value:2,unit:'pages',text:''});
  const update=async(value,version=2,revision=1)=>db.query(`update ayumi_projects set journey=$1,journey_revision=$2,version=$3,v2_revision=$3,trash_revision=$3-1,schedule_revision=$3-1,focus_revision=$3-1,items='[{"id":"a","text":"Step","done":false}]' where id=$4 and version=$3-1 returning *`,[JSON.stringify(value),revision,version,old.id]);
  let row=(await update(j)).rows[0];assert.deepEqual(row.achieved_on,old.achieved_on);assert.equal(row.items[0].done,false);assert.deepEqual(row.journey,j);
  assert.equal((await update(j)).rows.length,0); // stale version
  await assert.rejects(db.query('update ayumi_projects set version=3,v2_revision=3,trash_revision=2,schedule_revision=2,focus_revision=2'),/Reload required/);
  const changed=structuredClone(j);changed.outcomes[0].value=3;await assert.rejects(update(changed,3,2),/history/);
  for(const invalid of [{}, {...j,schema:2},{...j,active_plan_id:'missing'},{...j,goal:{}},{...j,next_review:'2026-02-30'},{...j,focus:{date:'2020-01-01',status:'done',item_id:null,unit_key:''}},{...j,outcomes:[...j.outcomes,{id:'bad',date:'2020-01-01',value:1,unit:'',text:''}]}])await assert.rejects(update(invalid,3,2));
  j.outcomes.push({id:'o2',date:'2020-01-03',value:null,unit:'',text:'A description'});row=(await update(j,3,2)).rows[0];assert.equal(row.journey.outcomes.length,2);
  await assert.rejects(db.query(`update ayumi_projects set achieved_on=null,journey_revision=3,version=4,v2_revision=4,trash_revision=3,schedule_revision=3,focus_revision=3`),/legacy achievement/);
  await db.exec(`set test.uid='${other}';`);assert.equal((await db.query('select * from ayumi_projects')).rows.length,0);assert.equal((await db.query('update ayumi_projects set journey=null returning id')).rows.length,0);
  await db.exec(`set test.uid='${owner}';set test.anon='true';`);await assert.rejects(db.query(`insert into ayumi_projects(title,journey,journey_revision) values('Guest',$1,1)`,[JSON.stringify(DragonAyumiJourney.empty())]));
  await db.exec("set test.anon='false';");await assert.rejects(db.query(`insert into ayumi_projects(title,user_id) values('Spoof',$1)`,[other]),/permission denied/);
 }finally{await db.close();}
});
