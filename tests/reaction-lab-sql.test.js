import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createExperiment} from '../assets/reaction-lab-model.js';
test('experiment SQL enforces owner isolation, retry, conflicts, deletion and no resurrection',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.uid',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('is_anonymous',coalesce(nullif(current_setting('request.anon',true),''),'false')::boolean)$$;
   grant usage on schema auth,public to authenticated,anon;grant execute on all functions in schema auth to authenticated,anon;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261022_reaction_experiments.sql',import.meta.url),'utf8'));
  const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',data=createExperiment();
  await db.query('insert into auth.users values($1),($2)',[owner,other]);await db.exec(`set role authenticated;set request.uid='${owner}';`);
  const save=async(rev=null)=>(await db.query('select save_reaction_experiment($1,$2,$3) receipt',[data.id,data,rev])).rows[0].receipt;
  const first=await save(),retry=await save();assert.equal(first.revision,retry.revision);assert.equal(first.saved_at,retry.saved_at);
  data.fields.event='変更';await assert.rejects(save(),/LAB_CONFLICT/);const updated=await save(first.revision);assert.notEqual(updated.revision,first.revision);
  await assert.rejects(db.query('select delete_reaction_experiment($1,$2)',[data.id,first.revision]),/LAB_CONFLICT/);
  await db.exec(`set request.uid='${other}'`);assert.equal((await db.query('select count(*)::int n from reaction_experiments')).rows[0].n,0);
  await db.query('select delete_reaction_experiment($1,$2)',[data.id,updated.revision]);
  await assert.rejects(db.query('insert into reaction_experiments(id,user_id,payload) values($1,$2,$3)',[data.id,owner,data]),/row-level security/);
  await db.exec(`set request.uid='${owner}'`);assert.equal((await db.query('select count(*)::int n from reaction_experiments')).rows[0].n,1);
  await db.exec("set request.anon='true'");assert.equal((await db.query('select count(*)::int n from reaction_experiments')).rows[0].n,0);await assert.rejects(save(updated.revision),/AUTH_REQUIRED/);
  await assert.rejects(db.query('select delete_reaction_experiment($1,$2)',[data.id,updated.revision]),/AUTH_REQUIRED/);
  await db.exec("set request.anon='false'");
  for(const mutation of [p=>p.fields.plan=null,p=>p.step=8,p=>delete p.choice,p=>p.fields.insight='あ'.repeat(2001)]){const bad=structuredClone(data);mutation(bad);assert.equal((await db.query('select valid_reaction_experiment($1) valid',[bad])).rows[0].valid,false);}
  await db.query('select delete_reaction_experiment($1,$2)',[data.id,updated.revision]);await db.query('select delete_reaction_experiment($1,$2)',[data.id,updated.revision]);
  await assert.rejects(save(updated.revision),/LAB_CONFLICT/);assert.equal((await db.query('select count(*)::int n from reaction_experiments')).rows[0].n,0);
  await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from reaction_experiments'),/permission denied/);
 }finally{await db.close();}
});
