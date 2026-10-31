import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import '../assets/ayumi.js';
const a=DragonAyumi;
const make=()=>({id:'daily',text:'今日の一歩',done:false,daily:a.dailyRange('2026-11-01','2026-11-14')});
test('daily ranges preserve checks through shortening, extending, normalization and trash',()=>{
 const i=make();i.daily.checks[0].done=true;i.daily.checks[10].done=true;
 i.daily=a.dailyRange('2026-11-01','2026-11-07',i.daily);
 assert.deepEqual(a.progress([i]),{done:1,total:7,percent:14});
 assert.equal(i.daily.checks.length,14);
 i.daily=a.dailyRange('2026-11-01','2026-11-14',i.daily);
 assert.deepEqual(a.progress([i]),{done:2,total:14,percent:14});
 const p=a.normalize({title:'test',items:[],deleted_items:[{item:i,index:0,deleted_on:'2026-11-01'}]});
 assert.deepEqual(p.deleted_items[0].item,i);
 assert.match(a.prompt({title:'test',items:[i]},true),/日別：2026-11-01/);
 assert.equal(a.dailyRange('2028-02-28','2028-03-01').checks.length,3);
 for(const dates of [['2026-02-29','2026-03-01'],['2026-11-02','2026-11-01'],['2026-01-01','2027-01-02']])assert.throws(()=>a.dailyRange(...dates));
 assert.throws(()=>a.dailyFields({...i,weeks:[{start:'2026-11-01',done:false}]}));
 assert.throws(()=>a.dailyFields({...i,daily:{...i.daily,checks:[]}}));
 const second=make();for(let k=0;k<5;k++)i.daily.checks[k].done=true;i.daily.checks[10].done=false;for(let k=0;k<3;k++)second.daily.checks[k].done=true;
 assert.deepEqual(a.progress([i,second,{weeks:[{done:true},{done:false}]},{done:true}]),{done:10,total:31,percent:32});
});
test('append preserves existing goal identity, due date, insight and prior checks',()=>{
 const p={id:'project',title:'original',due_date:'2026-11-14',insight:'note',items:[make()],version:4};
 const next=a.appendPlan(p,{title:'AI title',items:[{id:'new',text:'one',done:false}]});
 assert.equal(next.id,p.id);assert.equal(next.title,p.title);assert.equal(next.due_date,p.due_date);assert.equal(next.insight,p.insight);assert.equal(next.items.length,2);assert.equal(p.items.length,1);
});
test('database daily roundtrip, old client guard, trash, invalid input and owner separation',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;`);
 for(const name of ['20261030_ayumi.sql','20261030_ayumi_history.sql','20261031_ayumi_weeks.sql','20261031_ayumi_project_archive.sql','20261101_ayumi_daily.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 const owner='11111111-1111-4111-8111-111111111111';await db.query('insert into auth.users values($1)',[owner]);
 const i=make();i.daily.checks[0].done=true;
 const row=(await db.query("insert into ayumi_projects(user_id,title,items,daily_revision) values($1,'日別',$2,1) returning *",[owner,JSON.stringify([i])])).rows[0];
 await assert.rejects(db.query("update ayumi_projects set items='[]',version=version+1 where id=$1",[row.id]),/Reload required/);
 const trash=[{item:i,index:0,deleted_on:'2026-11-01'}];
 await db.query("update ayumi_projects set items='[]',deleted_items=$2,version=version+1,daily_revision=daily_revision+1 where id=$1",[row.id,JSON.stringify(trash)]);
 let saved=(await db.query('select * from ayumi_projects where id=$1',[row.id])).rows[0];assert.deepEqual(saved.deleted_items,trash);
 await db.query("update ayumi_projects set items=$2,deleted_items='[]',archived=true,version=version+1,daily_revision=daily_revision+1 where id=$1",[row.id,JSON.stringify([i])]);
 saved=(await db.query('select * from ayumi_projects where id=$1',[row.id])).rows[0];assert.deepEqual(saved.items,[i]);assert.equal(saved.archived,true);
 for(const daily of [null,{}, {...i.daily,checks:[]},{...i.daily,checks:[{date:'2026-02-30',done:true}]},{...i.daily,timezone:'wrong'}])assert.equal((await db.query('select ayumi_items_valid($1) ok',[JSON.stringify([{...i,daily}])])).rows[0].ok,false);
 await db.exec(`grant usage on schema auth to authenticated; set role authenticated; set test.uid='22222222-2222-4222-8222-222222222222';`);
 assert.equal((await db.query('select * from ayumi_projects')).rows.length,0);
 assert.equal((await db.query("update ayumi_projects set title='other',version=version+1,daily_revision=daily_revision+1 returning id")).rows.length,0);
 await db.exec(`set test.uid='${owner}';`);assert.equal((await db.query('select * from ayumi_projects')).rows.length,1);
 }finally{await db.close();}
});
