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
function setup({code,providerFailure=false,priorMessage=null,history,reply='reply'}={}){
 const calls=[];
 const fetcher=async(url,init)=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,body});let data={},status=200;
  if(url.includes('rpc/trial_chat')){
   if(body.p_action==='reserve')data=code?{code,error:'blocked'}:priorMessage!==null?(body.p_message===priorMessage?{cached:true,reply:'saved reply',remaining:4}:{code:'TRIAL_CONFLICT',error:'changed'}):{remaining:5,rows:history||[{role:'user',content:'earlier question'},{role:'assistant',content:'earlier answer'}]};
   else if(body.p_action==='finish')data={reply:body.p_reply,remaining:4};
   else data={rows:[],remaining:5};
  }else if(url.includes('ai_personas'))data=[{instructions:'スピリットドラゴン'}];
  else if(url.includes(':embedContent'))data={embedding:{values:Array(768).fill(.1)}};
  else if(url.includes('match_knowledge'))data=[{title:'本棚',content:'reference'}];
   else if(url.includes(':generateContent')){data={candidates:[{content:{parts:[{text:reply}]}}]};if(providerFailure)status=429;}
  return new Response(JSON.stringify(data),{status});
 };
 return {calls,invoke:async(overrides={})=>{const res=response();await createGuestHandler({env,fetcher})({method:'POST',headers:{host:'site.test',origin:'https://site.test'},body:{message:'hello',requestId:randomUUID(),seikanMode:true},...overrides},res);return res;}};
}
test('guest generation uses server history, persona, RAG and selected mode',async()=>{
 const s=setup();assert.equal((await s.invoke()).code,200);
 const model=s.calls.find(c=>c.url.includes(':generateContent')).body;
 assert.equal(s.calls.filter(c=>c.url.includes(':generateContent')).length,1);
 assert.deepEqual(model.contents.map(c=>c.role),['user','model','user']);assert.equal(model.contents[0].parts[0].text,'earlier question');
 assert.match(model.systemInstruction.parts[0].text,/スピリットドラゴン.*本棚/s);assert.match(model.systemInstruction.parts[0].text,/深める・広げる・戻る・進む・そのままでいる/);assert.match(model.systemInstruction.parts[0].text,/現在の会話モード：静観/);
});
test('trial limit prevents Gemini calls and failures release only the held lease',async()=>{
 const s=setup({code:'TRIAL_LIMIT'});assert.equal((await s.invoke()).code,429);assert.ok(!s.calls.some(c=>c.url.includes('googleapis')));
 const f=setup({providerFailure:true});const failed=await f.invoke();assert.equal(failed.code,429);assert.equal(failed.body.code,'AI_RATE_LIMIT');
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
test('trial return path is one-turn, marked, and validates its flag',async()=>{
 const s=setup();const r=await s.invoke({body:{message:'今日はもういいや',requestId:randomUUID(),returnPath:true,seikanMode:false}});assert.equal(r.code,200);
 assert.equal(s.calls.find(c=>c.body?.p_action==='reserve').body.p_message,'今日はもういいや\n\n［戻れる逃げ道］');
 assert.match(s.calls.find(c=>c.url.includes(':generateContent')).body.systemInstruction.parts[0].text,/今回の返答だけ：戻れる逃げ道/);
 const invalid=setup();assert.equal((await invalid.invoke({body:{message:'test',requestId:randomUUID(),returnPath:'override'}})).code,400);assert.equal(invalid.calls.length,0);
});

test('guest sky gazing reaches Gemini and the reserved message',async()=>{
 const s=setup();assert.equal((await s.invoke({body:{message:'月',requestId:randomUUID(),skyGazing:true,returnPath:true}})).code,200);
 const model=s.calls.find(c=>c.url.includes(':generateContent')).body;
 assert.match(model.systemInstruction.parts[0].text,/現在の会話モード：空を眺める/);
 assert.doesNotMatch(model.systemInstruction.parts[0].text,/今回の返答だけ：戻れる逃げ道/);
 assert.equal(s.calls.find(c=>c.body?.p_action==='reserve').body.p_message,'月\n\n［空を眺める］');
});

test('guest deep mode uses existing history and a single generation',async()=>{
 const s=setup();const r=await s.invoke({body:{message:'',requestId:randomUUID(),deepExploration:true,modeStart:true}});
 assert.equal(r.code,200);const models=s.calls.filter(c=>c.url.includes(':generateContent'));assert.equal(models.length,1);
 assert.equal(models[0].body.contents[0].parts[0].text,'earlier question');
 assert.match(models[0].body.systemInstruction.parts[0].text,/自己探索：深く降りる/);
 assert.equal(s.calls.find(c=>c.body?.p_action==='reserve').body.p_message,'［深く降りるを選択］');
});
for(const modeStart of [true,false])test('guest deep theme is user data, scoped guidance and part of the reserved message: '+modeStart,async()=>{
 const s=setup(),deepTheme='仕事と人との関係';
 const r=await s.invoke({body:{message:modeStart?'':'まだ分からない',requestId:randomUUID(),deepExploration:true,deepTheme:' '+deepTheme+' ',modeStart}});
 assert.equal(r.code,200);
 const models=s.calls.filter(c=>c.url.includes(':generateContent'));assert.equal(models.length,1);
 const generated=models[0].body;
 assert.ok(generated.contents.at(-1).parts[0].text.includes(JSON.stringify({theme:deepTheme})));
 assert.ok(!generated.systemInstruction.parts[0].text.includes(deepTheme));
 assert.equal(generated.contents[0].parts[0].text,'earlier question');
 assert.ok(s.calls.find(c=>c.body?.p_action==='reserve').body.p_message.includes('［自己探索のテーマ：'+JSON.stringify(deepTheme)+'］'));
 assert.ok(!s.calls.some(c=>c.url.includes(':embedContent')));
});
test('guest deep finish summarizes once and releases its lease if generation fails',async()=>{
 const body={message:'今日はここまで。今回話したことを短く振り返ってください。',requestId:randomUUID(),deepExploration:true,deepTheme:'仕事',deepAction:'finish'};
 const s=setup();assert.equal((await s.invoke({body})).code,200);
 const models=s.calls.filter(c=>c.url.includes(':generateContent'));assert.equal(models.length,1);
 assert.match(models[0].body.systemInstruction.parts[0].text,/今回の依頼：自己探索を終えて短く振り返る/);
 assert.match(s.calls.find(c=>c.body?.p_action==='reserve').body.p_message,/［深く降りるの振り返りを希望］$/);
 const failure=setup({providerFailure:true});assert.equal((await failure.invoke({body})).code,429);
 assert.ok(!failure.calls.some(c=>c.body?.p_action==='finish'));
 const reserved=failure.calls.find(c=>c.body?.p_action==='reserve').body,release=failure.calls.find(c=>c.body?.p_action==='fail').body;
 assert.equal(reserved.p_request,release.p_request);assert.equal(reserved.p_lease,release.p_lease);
});
test('guest invalid deep metadata cannot reserve a turn or call a provider',async()=>{
 for(const extra of [{deepTheme:''},{deepTheme:'仕事'},{deepAction:'finish'},{deepExploration:true,deepTheme:null},{deepExploration:true,deepTheme:'あ'.repeat(81)},{deepExploration:true,deepTheme:'仕事\n'},{deepExploration:true,deepAction:'other'},{deepExploration:true,modeStart:true,deepAction:'finish'}]){
  const s=setup();const r=await s.invoke({body:{message:extra.modeStart?'':'確認',requestId:randomUUID(),...extra}});
  assert.equal(r.code,400);assert.equal(s.calls.length,0);
 }
});
test('guest retries keep theme and finish intent in the database comparison',async()=>{
 const body={message:'今日はここまで。今回話したことを短く振り返ってください。',requestId:randomUUID(),deepExploration:true,deepTheme:'仕事',deepAction:'finish'};
 const initial=setup();assert.equal((await initial.invoke({body})).code,200);
 const priorMessage=initial.calls.find(c=>c.body?.p_action==='reserve').body.p_message;
 const same=setup({priorMessage});const retried=await same.invoke({body:{...body,deepTheme:' 仕事 '}});
 assert.equal(retried.code,200);assert.equal(retried.body.reply,'saved reply');
 assert.ok(!same.calls.some(c=>c.url.includes(':generateContent')));
 for(const extra of [{deepTheme:'人との関係'},{deepAction:undefined}]){
  const changed=setup({priorMessage});const r=await changed.invoke({body:{...body,...extra}});
  assert.equal(r.code,409);assert.equal(r.body.code,'TRIAL_CONFLICT');
  assert.ok(!changed.calls.some(c=>c.url.includes(':generateContent')));
 }
});
test('guest leaving deep exploration does not continue theme or finish instructions',async()=>{
 const s=setup({history:[{role:'user',content:'今日はここまで\n\n［深く降りる］\n［自己探索のテーマ："仕事"］\n［深く降りるの振り返りを希望］'},{role:'assistant',content:'まだ分からないままです。'}]});
 assert.equal((await s.invoke({body:{message:'今日の予定を整理したい',requestId:randomUUID()}})).code,200);
 const generated=s.calls.find(c=>c.url.includes(':generateContent')).body;
 assert.match(generated.systemInstruction.parts[0].text,/自己探索の終了/);
 assert.doesNotMatch(generated.systemInstruction.parts[0].text,/【自己探索：深く降りる】|今回の依頼：自己探索を終えて短く振り返る/);
 assert.equal(generated.contents.at(-1).parts[0].text,'今日の予定を整理したい');
});

for(const modeStart of [true,false])test('guest pattern uses same scoped rules: '+modeStart,async()=>{
 const s=setup();assert.equal((await s.invoke({body:{message:modeStart?'':'断った',requestId:randomUUID(),patternExploration:true,modeStart}})).code,200);
 const models=s.calls.filter(c=>c.url.includes(':generateContent'));assert.equal(models.length,1);assert.match(models[0].body.systemInstruction.parts[0].text,/自己探索：パターンを見る/);
 assert.equal(s.calls.find(c=>c.body?.p_action==='reserve').body.p_message,modeStart?'［パターンを見るを選択］':'断った\n\n［パターンを見る］');
});
test('guest pattern rejects invalid and conflicting flags',async()=>{
 for(const flags of [{patternExploration:'yes'},{patternExploration:true,deepExploration:true},{patternExploration:true,selfReturn:true}]){
 const s=setup();assert.equal((await s.invoke({body:{message:'test',requestId:randomUUID(),...flags}})).code,400);assert.equal(s.calls.length,0);
 }
});

test('guest map is attached to the existing generation and scoped to the reserved request',async()=>{
 const map={version:1,id:randomUUID(),fields:{event:'架空の例：散歩',feeling:'涼しい',interpretation:'歩きやすい',reaction:'歩いた',afterglow:'よくわからない'}};
 const s=setup();assert.equal((await s.invoke({body:{message:'この図を見て',requestId:randomUUID(),mindMap:map}})).code,200);
 const models=s.calls.filter(c=>c.url.includes(':generateContent'));assert.equal(models.length,1);assert.ok(models[0].body.contents.at(-1).parts[1].text.includes(JSON.stringify(map)));assert.match(models[0].body.systemInstruction.parts[0].text,/本人の実体験として語らない/);
 assert.match(s.calls.find(c=>c.body?.p_action==='reserve').body.p_message,/参照した心の動きマップ/);
 const invalid=setup();assert.equal((await invalid.invoke({body:{message:'これ',requestId:randomUUID(),mindMap:{}}})).code,400);assert.equal(invalid.calls.length,0);
});

for(const modeStart of [true,false])test('guest direction uses same scoped rules: '+modeStart,async()=>{
 const s=setup();assert.equal((await s.invoke({body:{message:modeStart?'':'断った',requestId:randomUUID(),directionExploration:true,modeStart}})).code,200);
 const models=s.calls.filter(c=>c.url.includes(':generateContent'));assert.equal(models.length,1);assert.match(models[0].body.systemInstruction.parts[0].text,/自己探索：方角を見る/);
 assert.equal(s.calls.find(c=>c.body?.p_action==='reserve').body.p_message,modeStart?'［方角を見るを選択］':'断った\n\n［方角を見る］');
});
test('guest direction rejects invalid and conflicting flags',async()=>{
 for(const flags of [{directionExploration:'yes'},{directionExploration:true,deepExploration:true},{directionExploration:true,selfReturn:true}]){
 const s=setup();assert.equal((await s.invoke({body:{message:'test',requestId:randomUUID(),...flags}})).code,400);assert.equal(s.calls.length,0);
 }
});
