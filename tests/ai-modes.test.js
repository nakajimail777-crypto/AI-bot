import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { resolveModeInstructions } from '../lib/resolve-mode-instructions.js';
import { modeInstruction, blindSpotInstruction, emotionFocusInstruction } from '../lib/chat-mode.js';
const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SECRET_KEY: 'test-secret' };
const flags = { observation: true, blindSpot: true, emotionFocus: true };
const fallback = modeInstruction(true)+blindSpotInstruction(true)+emotionFocusInstruction(true);
test('all OFF does not query modes and preserves OFF instructions', async () => {
  assert.equal(await resolveModeInstructions({}, {env,fetcher:()=>{throw new Error('must not fetch');}}),modeInstruction(false)+blindSpotInstruction(false)+emotionFocusInstruction(false));
});
test('each enabled mode uses its own record and reads edits on the next turn',async()=>{
  let version=1, calls=0;
  const fetcher=async(url,init)=>{
    calls++; assert.match(url,/slug=in.\(observation,blind_spot,emotion_focus\)/); assert.equal(init.cache,'no-store'); assert.equal(init.headers.apikey,'test-secret'); assert.ok(init.signal);
    return Response.json(['emotion_focus','blind_spot','observation'].map(slug=>({slug,active:true,instructions:slug+version,version})));
  };
  assert.equal(await resolveModeInstructions(flags,{env,fetcher}),'\n\nobservation1\n\nblind_spot1\n\nemotion_focus1');
  version=2; assert.equal(await resolveModeInstructions(flags,{env,fetcher}),'\n\nobservation2\n\nblind_spot2\n\nemotion_focus2'); assert.equal(calls,2);
});
test('missing, inactive, empty and invalid records fall back per mode',async()=>{
  for(const record of [null,{active:false,instructions:'disabled'},{active:true,instructions:''},{active:true,instructions:'  \n '},{active:true,instructions:null}]){
    const rows=[{slug:'observation',active:true,instructions:'custom'},...(record?[{slug:'emotion_focus',...record}]:[])];
    assert.equal(await resolveModeInstructions(flags,{env,fetcher:async()=>Response.json(rows)}),'\n\ncustom'+blindSpotInstruction(true)+emotionFocusInstruction(true));
  }
});
test('HTTP, malformed JSON, wrong shape and network/timeout failures preserve fallbacks',async()=>{
  for(const fetcher of [async()=>new Response('',{status:503}),async()=>new Response('invalid'),async()=>Response.json({error:'bad'}),async()=>{throw new Error('network');},async()=>{throw new DOMException('timeout','TimeoutError');}]) assert.equal(await resolveModeInstructions(flags,{env,fetcher}),fallback);
});
test('disabled modes cannot be activated by returned records',async()=>{
  const result=await resolveModeInstructions({emotionFocus:true},{env,fetcher:async url=>{
    assert.match(url,/slug=in.\(emotion_focus\)/);
    return Response.json([{slug:'observation',active:true,instructions:'unexpected'},{slug:'emotion_focus',active:true,instructions:'custom'}]);
  }});
  assert.equal(result,modeInstruction(false)+blindSpotInstruction(false)+'\n\ncustom');
});
test('migration seeds exact fallbacks and restricts browser roles',async()=>{
  const db=new PGlite();
  try{
    await db.exec('create role anon; create role authenticated; create role service_role; grant usage on schema public to service_role;');
    await db.exec(await readFile(new URL('../supabase/migrations/20260915_ai_modes.sql',import.meta.url),'utf8'));
    const rows=(await db.query('select * from ai_modes order by slug')).rows;
    assert.equal(rows.length,3); assert.equal(rows.find(r=>r.slug==='emotion_focus').instructions,emotionFocusInstruction(true).trim());
    for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from ai_modes'),/permission denied/);await db.exec('reset role');}
    await db.exec('set role service_role'); assert.equal((await db.query('select * from ai_modes')).rows.length,3); await assert.rejects(db.query("update ai_modes set instructions='bad'"),/permission denied/);
  }finally{await db.close();}
});
