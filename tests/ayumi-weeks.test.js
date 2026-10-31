import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import '../assets/ayumi.js';
const api=globalThis.DragonAyumi;
const item={id:'a',text:'続けやすさを振り返る',done:false,weeks:[{start:'2026-11-01',done:true},{start:'2026-11-08',done:false}]};
test('weeks survive save normalization, trash, restore and checkbox changes without double counting',()=>{
 const project={title:'目標',items:[item],insight:''};
 assert.deepEqual(api.normalize(project).items[0],item);
 assert.deepEqual(api.progress([item]),{done:1,total:2,percent:50});
 assert.deepEqual(api.progress([item,{done:true}]),{done:2,total:3,percent:67});
 const archived=api.normalize({...project,items:[],deleted_items:[{item,index:0,deleted_on:'2026-10-31'}]});
 assert.deepEqual(archived.deleted_items[0].item,item);
 const restored=structuredClone(archived.deleted_items[0].item);restored.weeks[1].done=true;
 assert.equal(api.progress([restored]).percent,100);restored.weeks[0].done=false;
 assert.equal(api.progress([restored]).percent,50);
 assert.throws(()=>api.weekFields({weeks:[{start:'2026-02-30',done:false}]}));
 assert.throws(()=>api.weekFields({weeks:[...item.weeks,{start:'2026-11-09',done:false}]}));
 assert.match(api.prompt(project,true),/2026-11-08/);
});
test('database allows bounded weekly records and archives while rejecting malformed weeks',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;`);
 for(const name of ['20261030_ayumi.sql','20261030_ayumi_history.sql','20261031_ayumi_weeks.sql','20261031_ayumi_project_archive.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 const owner='11111111-1111-4111-8111-111111111111';
 await db.query('insert into auth.users values($1)',[owner]);
 const row=(await db.query("insert into ayumi_projects(user_id,title,items) values($1,'保管試験',$2) returning *",[owner,JSON.stringify([item])])).rows[0];
 assert.equal(row.archived,false);
 await db.query('update ayumi_projects set archived=true,version=version+1 where id=$1',[row.id]);
 let saved=(await db.query('select * from ayumi_projects where id=$1',[row.id])).rows[0];
 assert.equal(saved.archived,true);assert.deepEqual(saved.items,[item]);
 await db.query('update ayumi_projects set archived=false,version=version+1 where id=$1',[row.id]);
 saved=(await db.query('select * from ayumi_projects where id=$1',[row.id])).rows[0];
 assert.equal(saved.archived,false);assert.deepEqual(saved.items,[item]);
 assert.equal((await db.query('select ayumi_items_valid($1) ok',[JSON.stringify([item])])).rows[0].ok,true);
 assert.equal((await db.query('select ayumi_archive_valid($1,$2) ok',['[]',JSON.stringify([{item,index:0,deleted_on:'2026-10-31'}])])).rows[0].ok,true);
 for(const weeks of [null,{},[{start:'2026-02-30',done:false}],[{start:'2026-11-01',done:'true'}],[...item.weeks,{start:'2026-11-08',done:true}]])assert.equal((await db.query('select ayumi_items_valid($1) ok',[JSON.stringify([{...item,weeks}])])).rows[0].ok,false);
 }finally{await db.close();}
});
