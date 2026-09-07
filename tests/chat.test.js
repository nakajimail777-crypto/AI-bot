import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../lib/chat.js';
import configHandler from '../api/config.js';
const user='f1d680a0-9c2a-4a01-a001-000000000001', chat='f1d680a0-9c2a-4a01-b001-000000000001', request='f1d680a0-9c2a-4a01-9001-000000000001';
const env={SUPABASE_URL:'https://db.test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_test',GEMINI_API_KEY:'gemini-test'};
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};}
function setup(options={}){
 const calls=[];
 const fetcher=async(url,init)=>{
  calls.push({url,init});let body=[],status=200;
  if(url.endsWith('/auth/v1/user')){body={id:user,...options.user};status=options.authStatus||200;}
  else if(url.includes('/debug_events'))body=null;
  else if(url.includes('/api_usage_events')){body=null;status=options.usageFailure?503:200;}
  else if(url.includes('/api_turn_usage'))body=options.receipts||[];
  else if(url.includes('/conversations?'))body=options.foreign?[]:[{id:chat}];
  else if(url.includes('/messages?id='))body=options.prior||[];
  else if(url.includes('/messages?reply_to='))body=[{content:'保存済みの回答'}];
  else if(url.includes('chat_reserve_request')){body=null;if(options.rate){status=400;body={message:'CHAT_RATE_LIMIT'};}}
  else if(url.includes('/ai_personas?'))body=options.personas||[{instructions:'温かく静かに対話し、本人が選べる小さな一歩へつなげてください。'.repeat(3)}];
  else if(url.includes('order=sequence.desc'))body=options.history||[{role:'assistant',content:'前の回答',sequence:2},{role:'user',content:'前の質問',sequence:1}];
  else if(url.includes(':embedContent')){body={embedding:{values:Array(768).fill(0.1)},usageMetadata:{promptTokenCount:10}};status=options.embedStatus||200;}
  else if(url.includes('match_knowledge'))body=[{title:'資料',content:'検索された知識'}];
  else if(url.includes(':generateContent')){body=options.providerError || {candidates:[{content:{parts:options.parts||[{text:'新しい回答'}]}}],usageMetadata:options.noUsage?undefined:{promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:30,totalTokenCount:150}};status=options.geminiStatus||200;}
  else if(url.includes('chat_save_turn')){body={reply:'新しい回答',usage:JSON.parse(init.body).p_usage};if(options.saveError){status=400;body={message:options.saveError};}else if(options.missingMigration&&url.endsWith('with_usage')){status=404;body={code:'PGRST202'};}}
  else throw new Error('Unexpected URL');
  return new Response(JSON.stringify(body),{status});
 };
 const handler=createHandler({fetcher,env:options.env||env});
 const invoke=async(overrides={})=>{const res=response();await handler({method:'POST',headers:{authorization:'Bearer test-jwt'},body:{message:'こんにちは',conversationId:chat,requestId:request},...overrides},res);return res;};
 return{invoke,calls};
}
test('missing bearer never calls DB or Gemini',async()=>{const s=setup();assert.equal((await s.invoke({headers:{}})).code,401);assert.equal(s.calls.length,0);});
test('invalid JWT stops before reading history',async()=>{const s=setup({authStatus:401});assert.equal((await s.invoke()).code,401);assert.ok(!s.calls.some(c=>/messages|conversations|googleapis/.test(c.url)));});
test('anonymous users rejected',async()=>{const s=setup({user:{is_anonymous:true}});assert.equal((await s.invoke()).code,401);assert.ok(!s.calls.some(c=>/messages|conversations|googleapis/.test(c.url)));});
test('foreign conversation cannot invoke model',async()=>{const s=setup({foreign:true});assert.equal((await s.invoke()).code,404);assert.ok(!s.calls.some(c=>/messages|googleapis/.test(c.url)));});
test('invalid IDs and oversize input rejected',async()=>{for(const body of [{message:'x',conversationId:'bad',requestId:request},{message:'x'.repeat(4001),conversationId:chat,requestId:request}]){const s=setup();assert.equal((await s.invoke({body})).code,400);assert.equal(s.calls.length,0);}});
test('persisted context reaches Gemini in order and JWT is not forwarded',async()=>{
 const s=setup();const res=await s.invoke();assert.equal(res.code,200);assert.equal(res.body.saved,true);
 const model=s.calls.find(c=>c.url.includes(':generateContent'));
 assert.deepEqual(JSON.parse(model.init.body).contents.map(x=>x.role),['user','model','user']);
 assert.match(JSON.parse(model.init.body).systemInstruction.parts[0].text,/温かく静かに対話/);
 assert.match(JSON.parse(model.init.body).systemInstruction.parts[0].text,/検索された知識/);
 assert.equal(model.init.headers.Authorization,undefined);
 const save=s.calls.find(c=>c.url.includes('chat_save_turn'));
 const {p_usage,...savedFields}=JSON.parse(save.init.body);
 assert.deepEqual(savedFields,{p_user_id:user,p_conversation_id:chat,p_request_id:request,p_message:'こんにちは',p_reply:'新しい回答',p_last_sequence:2});
 assert.equal(p_usage.generation.output,50);assert.equal(p_usage.generation.total,150);assert.equal(p_usage.rag.input,10);
 assert.equal(save.init.headers.apikey,env.SUPABASE_SECRET_KEY);
 assert.equal(s.calls.find(c=>c.url.includes('/conversations?')).init.headers.Authorization,'Bearer test-jwt');
});
test('idempotent retry returns stored reply and usage without model usage',async()=>{const s=setup({prior:[{role:'user',content:'こんにちは'}],receipts:[{usage:{generation:{input:123}}}]});const res=await s.invoke();assert.equal(res.body.reply,'保存済みの回答');assert.equal(res.body.usage.generation.input,123);assert.ok(!s.calls.some(c=>/googleapis|api_usage_events/.test(c.url)));});
test('missing active persona prevents model usage',async()=>{const s=setup({personas:[]});const res=await s.invoke();assert.equal(res.code,503);assert.ok(!s.calls.some(c=>c.url.includes('googleapis')));});
test('same request ID with changed text rejected',async()=>{const s=setup({prior:[{role:'user',content:'別の文章'}]});assert.equal((await s.invoke()).code,409);});
test('rate limit prevents model usage',async()=>{const s=setup({rate:true});assert.equal((await s.invoke()).code,429);assert.ok(!s.calls.some(c=>c.url.includes('googleapis')));});
test('provider failure never saves a partial turn',async()=>{const s=setup({geminiStatus:429});assert.equal((await s.invoke()).code,429);assert.ok(!s.calls.some(c=>c.url.includes('chat_save_turn')));});
test('save failure is never reported as saved',async()=>{const s=setup({saveError:'unavailable'});const r=await s.invoke();assert.equal(r.code,502);assert.equal(r.body.saved,undefined);});
test('concurrent conversation update returns conflict',async()=>{const s=setup({saveError:'CHAT_CHANGED'});assert.equal((await s.invoke()).code,409);});
test('reasoning text is not saved as reply',async()=>{const s=setup({parts:[{thought:true,text:'private reasoning'},{text:'新しい回答'}]});const r=await s.invoke();assert.equal(r.body.reply,'新しい回答');assert.ok(!s.calls.find(c=>c.url.includes('chat_save_turn')).init.body.includes('private reasoning'));});
test('empty response not stored',async()=>{const s=setup({parts:[]});assert.equal((await s.invoke()).code,502);assert.ok(!s.calls.some(c=>c.url.includes('chat_save_turn')));});
test('RAG 429 degrades gracefully and still meters both calls',async()=>{const s=setup({embedStatus:429});assert.equal((await s.invoke()).code,200);assert.equal(JSON.parse(s.calls.find(c=>c.url.includes('api_usage_events')).init.body).length,2);assert.ok(!s.calls.some(c=>c.url.includes('match_knowledge')));});
test('usage write failure does not block reply save',async()=>{const s=setup({usageFailure:true});const r=await s.invoke();assert.equal(r.code,200);assert.equal(r.body.usage.recorded,false);});
test('missing migration falls back to unchanged save RPC',async()=>{const s=setup({missingMigration:true});const r=await s.invoke();assert.equal(r.code,200);assert.equal(r.body.usage,null);assert.ok(s.calls.some(c=>c.url.endsWith('/chat_save_turn')));});
test('daily 429 provides safe Japanese guidance and retry header',async()=>{const s=setup({geminiStatus:429,providerError:{error:{message:'private detail',details:[{violations:[{quotaId:'GenerateRequestsPerDay'}]},{retryDelay:'42s'}]}}});const r=await s.invoke();assert.equal(r.code,429);assert.equal(r.body.code,'AI_DAILY_LIMIT');assert.equal(r.headers['Retry-After'],'42');assert.match(r.body.error,/入力した内容は残っています/);assert.ok(!r.body.error.includes('private'));});
test('actual usage is persisted even when reply DB save fails',async()=>{const s=setup({saveError:'CHAT_CHANGED'});await s.invoke();const events=JSON.parse(s.calls.find(c=>c.url.includes('api_usage_events')).init.body);assert.equal(events[1].usage.input,100);assert.equal(events[1].outcome,'succeeded');assert.ok(!JSON.stringify(events).includes('こんにちは'));});
test('missing usage stays unknown',async()=>{const s=setup({noUsage:true});const r=await s.invoke();assert.equal(r.body.usage.generation.input,null);assert.equal(r.body.usage.estimatedUsd,null);});
test('config refuses a secret key in the public key variable',()=>{
 const original={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_PUBLISHABLE_KEY};
 process.env.SUPABASE_URL=env.SUPABASE_URL;process.env.SUPABASE_PUBLISHABLE_KEY='sb_secret_never_expose';
 try{const res=response();configHandler({method:'GET'},res);assert.equal(res.code,503);assert.ok(!JSON.stringify(res.body).includes('sb_secret'));}
 finally{for(const [key,value] of [['SUPABASE_URL',original.url],['SUPABASE_PUBLISHABLE_KEY',original.key]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
