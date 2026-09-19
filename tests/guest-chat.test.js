import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createGuestHandler,trialIdentity} from '../lib/guest-chat.js';
const env={SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'test-secret',GEMINI_API_KEY:'test-gemini'};
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){this.body=data;return this;}});
test('trial cookies resist tampering, expire, and are HttpOnly and Secure',()=>{
 const r=response();const id=trialIdentity({headers:{}},r,'key',1000);const cookie=r.headers['Set-Cookie'];
 assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
 assert.equal(trialIdentity({headers:{cookie}},response(),'key',2000),id);
 assert.notEqual(trialIdentity({headers:{cookie:cookie.replace(id,randomUUID())}},response(),'key',2000),id);
 assert.notEqual(trialIdentity({headers:{cookie}},response(),'other-key',2000),id);
 assert.notEqual(trialIdentity({headers:{cookie}},response(),'key',1000+31*86400000),id);
});
test('database enforces five completed turns, leases, retries, isolation and permissions',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;grant usage on schema public to service_role;');
  await db.exec(await readFile(new URL('../supabase/migrations/20260910_guest_trial.sql',import.meta.url),'utf8'));
  const id=randomUUID(),network='a'.repeat(64);
  const call=async(action,request=null,lease=null,message=null,mode=false,net=network,reply=null)=>(await db.query('select trial_chat($1,$2,$3,$4,$5,$6,$7,$8) as value',[id,action,request,lease,message,mode,net,reply])).rows[0].value;
  await db.exec('set role anon');await assert.rejects(call('state'),/permission denied/);
  await assert.rejects(db.query('select * from trial_sessions'),/permission denied/);
  await db.exec('set role authenticated');await assert.rejects(call('state'),/permission denied/);
  await db.exec('set role service_role');assert.equal((await call('state')).remaining,5);
  const failed=randomUUID(),lease=randomUUID();await call('reserve',failed,lease,'failed');
  assert.equal((await call('reserve',randomUUID(),randomUUID(),'parallel')).code,'TRIAL_BUSY');
  await call('fail',failed,randomUUID());assert.equal((await call('reserve',randomUUID(),randomUUID(),'parallel')).code,'TRIAL_BUSY');
  await call('fail',failed,lease);assert.equal((await call('state')).remaining,5);
  for(let i=0;i<5;i++){
   const req=randomUUID(),lock=randomUUID();const reserved=await call('reserve',req,lock,'question '+i,true);
   assert.equal(reserved.rows.length,i*2);
   assert.equal((await call('finish',req,lock,null,false,network,'answer '+i)).remaining,4-i);
   const retry=await call('reserve',req,randomUUID(),'question '+i,true);assert.equal(retry.cached,true);assert.equal(retry.reply,'answer '+i);
   assert.equal((await call('reserve',req,randomUUID(),'changed',true)).code,'TRIAL_CONFLICT');
  }
  assert.equal((await call('state')).rows.length,10);
  assert.equal((await call('reserve',randomUUID(),randomUUID(),'sixth')).code,'TRIAL_LIMIT');
  const other=(await db.query('select trial_chat($1,$2) as value',[randomUUID(),'state'])).rows[0].value;
  assert.deepEqual(other.rows,[]);
  await db.exec('reset role');await db.query('update trial_network_limits set attempts=30');
  const blocked=(await db.query('select trial_chat($1,$2,$3,$4,$5,$6,$7) as value',[randomUUID(),'reserve',randomUUID(),randomUUID(),'new browser',false,network])).rows[0].value;
  assert.equal(blocked.code,'TRIAL_NETWORK_LIMIT');
 }finally{await db.close();}
});
function setup({code,providerFailure=false}={}){
 const calls=[];
 const fetcher=async(url,init)=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,body});let data={},status=200;
  if(url.includes('rpc/trial_chat')){
   if(body.p_action==='reserve')data=code?{code,error:'blocked'}:{remaining:5,rows:[{role:'user',content:'earlier question'},{role:'assistant',content:'earlier answer'}]};
   else if(body.p_action==='finish')data={reply:body.p_reply,remaining:4};
   else data={rows:[],remaining:5};
  }else if(url.includes('ai_personas'))data=[{instructions:'スピリットドラゴン'}];
  else if(url.includes(':embedContent'))data={embedding:{values:Array(768).fill(.1)}};
  else if(url.includes('match_knowledge'))data=[{title:'本棚',content:'reference'}];
  else if(url.includes(':generateContent')){data={candidates:[{content:{parts:[{text:'reply'}]}}]};if(providerFailure)status=429;}
  return new Response(JSON.stringify(data),{status});
 };
 return {calls,invoke:async(overrides={})=>{const res=response();await createGuestHandler({env,fetcher})({method:'POST',headers:{host:'site.test',origin:'https://site.test'},body:{message:'hello',requestId:randomUUID(),seikanMode:true},...overrides},res);return res;}};
}
test('guest generation uses server history, persona, RAG and selected mode',async()=>{
 const s=setup();assert.equal((await s.invoke()).code,200);
 const model=s.calls.find(c=>c.url.includes(':generateContent')).body;
 assert.deepEqual(model.contents.map(c=>c.role),['user','model','user']);assert.equal(model.contents[0].parts[0].text,'earlier question');
 assert.match(model.systemInstruction.parts[0].text,/スピリットドラゴン.*本棚/s);assert.match(model.systemInstruction.parts[0].text,/現在の会話モード：静観/);
});
test('trial limit prevents Gemini calls and failures release only the held lease',async()=>{
 const s=setup({code:'TRIAL_LIMIT'});assert.equal((await s.invoke()).code,429);assert.ok(!s.calls.some(c=>c.url.includes('googleapis')));
 const f=setup({providerFailure:true});assert.equal((await f.invoke()).code,503);
 assert.ok(!f.calls.some(c=>c.body?.p_action==='finish'));
 const reserve=f.calls.find(c=>c.body?.p_action==='reserve').body,release=f.calls.find(c=>c.body?.p_action==='fail').body;
 assert.equal(release.p_lease,reserve.p_lease);assert.equal(release.p_id,reserve.p_id);
});
test('cross-site and invalid payloads cannot spend tokens',async()=>{
 for(const overrides of [{headers:{host:'site.test',origin:'https://evil.test'}},{body:{message:'x',requestId:randomUUID(),seikanMode:'injected'}},{body:{message:'x'.repeat(4001),requestId:randomUUID()}},{body:{message:'x',requestId:randomUUID(),attachment:{}}}]){
  const s=setup();assert.ok((await s.invoke(overrides)).code>=400);assert.equal(s.calls.length,0);
 }
});

test('trial encouragement is opt-in and marks the reserved turn',async()=>{
 const s=setup();assert.equal((await s.invoke({body:{message:'後押ししてほしい',requestId:randomUUID(),encouragement:true}})).code,200);
 assert.match(s.calls.find(c=>c.body?.p_action==='reserve').body.p_message,/［少し強めに背中を押す］/);
 assert.match(s.calls.find(c=>c.url.includes(':generateContent')).body.systemInstruction.parts[0].text,/今回の返答だけ：少し強めに背中を押す/);
 const invalid=setup();assert.equal((await invalid.invoke({body:{message:'test',requestId:randomUUID(),encouragement:'yes'}})).code,400);assert.equal(invalid.calls.length,0);
});
test('trial blind spot reaches the model and keeps a distinct retry message',async()=>{
 const s=setup();const r=await s.invoke({body:{message:'test',requestId:randomUUID(),blindSpot:true,seikanMode:false}});assert.equal(r.code,200);
 assert.equal(s.calls.find(c=>c.body?.p_action==='reserve').body.p_message,'test\n\n［盲点を照らす］');
 assert.match(s.calls.find(c=>c.url.includes(':generateContent')).body.systemInstruction.parts[0].text,/今回の返答だけ：盲点を照らす/);
 const invalid=setup();assert.equal((await invalid.invoke({body:{message:'test',requestId:randomUUID(),blindSpot:'override'}})).code,400);assert.equal(invalid.calls.length,0);
});
test('trial emotion focus reaches the model and rejects arbitrary instructions',async()=>{
 const s=setup();const r=await s.invoke({body:{message:'悲しい',requestId:randomUUID(),emotionFocus:true,seikanMode:false,blindSpot:false}});assert.equal(r.code,200);
 assert.equal(s.calls.find(c=>c.body?.p_action==='reserve').body.p_message,'悲しい\n\n［感情を感じきる］');
 assert.match(s.calls.find(c=>c.url.includes(':generateContent')).body.systemInstruction.parts[0].text,/現在の会話モード：感情を感じきる/);
 assert.match(s.calls.find(c=>c.url.includes(':generateContent')).body.systemInstruction.parts[0].text,/わーいわーいですね☺️/);
 const invalid=setup();assert.equal((await invalid.invoke({body:{message:'test',requestId:randomUUID(),emotionFocus:'override'}})).code,400);assert.equal(invalid.calls.length,0);
});
