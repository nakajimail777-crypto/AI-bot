import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {resolveModeInstructions} from '../lib/resolve-mode-instructions.js';
import {ENCOURAGEMENT_PROMPT,encouragementReset,encouragementMessage} from '../lib/chat-mode.js';
const context=vm.createContext({});vm.runInContext(await readFile(new URL('../assets/encouragement.js',import.meta.url),'utf8'),context);
test('offer requires explicit unquoted non-negated request',()=>{
 for(const text of ['背中を押してほしい','片付けを始めたいので、背中を押してください。','後押ししてほしい','背中を押して！'])assert.equal(context.DragonEncouragement.isRequested(text),true,text);
 for(const text of ['どうしたらいい？','決めて','迷っています','「背中を押してほしい」と言われた','背中を押してほしくない','背中を押してほしいわけじゃない','背中を押すとは？','背中を押してほしい\n\n［少し強めに背中を押す］'])assert.equal(context.DragonEncouragement.isRequested(text),false,text);
});
test('enabled encouragement fetches editable prompt each time and overrides only this turn',async()=>{
 let version=1;
 const env={SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'test'};
 const fetcher=async(url,opts)=>{assert.match(url,/slug=in.\(encouragement\)/);assert.equal(opts.cache,'no-store');return Response.json([{slug:'encouragement',active:true,instructions:'version '+version}]);};
 const flags={encouragement:true,emotionFocus:true,observation:true,blindSpot:true};
 assert.equal(await resolveModeInstructions(flags,{env,fetcher}),'\n\nversion 1');version++;
 assert.equal(await resolveModeInstructions(flags,{env,fetcher}),'\n\nversion 2');
 for(const row of [null,{active:false,instructions:'bad'},{active:true,instructions:'  '}])assert.equal((await resolveModeInstructions(flags,{env,fetcher:async()=>Response.json(row?[{slug:'encouragement',...row}]:[])})).trim(),ENCOURAGEMENT_PROMPT);
 assert.equal((await resolveModeInstructions(flags,{env,fetcher:async()=>{throw Error('offline');}})).trim(),ENCOURAGEMENT_PROMPT);
 const next=await resolveModeInstructions({emotionFocus:true},{env:{}});assert.match(next,/現在の会話モード：感情を感じきる/);assert.ok(!next.includes(ENCOURAGEMENT_PROMPT));
});
test('markers record opt-in and history cannot keep encouragement active',()=>{
 assert.equal(encouragementMessage('本文',false),'本文');const marked=encouragementMessage('本文',true);assert.match(marked,/［少し強めに背中を押す］/);
 assert.match(encouragementReset([{role:'user',content:marked}],false),/現在はOFF/);assert.equal(encouragementReset([],false),'');assert.equal(encouragementReset([{role:'user',content:marked}],true),'');
});
test('migration retains the old modes and seeds a private fourth mode',async()=>{
 const db=new PGlite();try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(await readFile(new URL('../supabase/migrations/20260915_ai_modes.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20260920_encouragement_mode.sql',import.meta.url),'utf8'));
 const rows=(await db.query('select * from ai_modes')).rows;assert.equal(rows.length,4);assert.equal(rows.find(r=>r.slug==='encouragement').instructions,ENCOURAGEMENT_PROMPT);
 await db.exec('set role anon');await assert.rejects(db.query('select * from ai_modes'),/permission denied/);
 }finally{await db.close();}
});
