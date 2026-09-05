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
  else if(url.includes('/conversations?'))body=options.foreign?[]:[{id:chat}];
  else if(url.includes('/messages?id='))body=options.prior||[];
  else if(url.includes('/messages?reply_to='))body=[{content:'保存済みの回答'}];
  else if(url.includes('chat_reserve_request')){body=null;if(options.rate){status=400;body={message:'CHAT_RATE_LIMIT'};}}
  else if(url.includes('/ai_personas?'))body=options.personas||[{instructions:'温かく静かに対話し、本人が選べる小さな一歩へつなげてください。'.repeat(3)}];
  else if(url.includes('order=sequence.desc'))body=options.history||[{role:'assistant',content:'前の回答',sequence:2},{role:'user',content:'前の質問',sequence:1}];
  else if(url.includes('googleapis.com')){body={candidates:[{content:{parts:options.parts||[{text:'新しい回答'}]}}]};status=options.geminiStatus||200;}
  else if(url.includes('chat_save_turn')){body={reply:'新しい回答'};if(options.saveError){status=400;body={message:options.saveError};}}
  else throw new Error('Unexpected URL');
  return new Response(JSON.stringify(body),{status});
 };
 const handler=createHandler({fetcher,env:options.env||env});
 const invoke=async(overrides={})=>{const res=response();await handler({method:'POST',headers:{authorization:'Bearer test-jwt'},body:{message:'こんにちは',conversationId:chat,requestId:request},...overrides},res);return res;};
 return{invoke,calls};
}
test('missing bearer never calls DB or Gemini',async()=>{const s=setup();assert.equal((await s.invoke({headers:{}})).code,401);assert.equal(s.calls.length,0);});
test('invalid JWT stops before reading history',async()=>{const s=setup({authStatus:401});assert.equal((await s.invoke()).code,401);assert.equal(s.calls.length,1);});
test('anonymous users rejected',async()=>{const s=setup({user:{is_anonymous:true}});assert.equal((await s.invoke()).code,401);assert.equal(s.calls.length,1);});
test('foreign conversation cannot invoke model',async()=>{const s=setup({foreign:true});assert.equal((await s.invoke()).code,404);assert.equal(s.calls.length,2);});
test('invalid IDs and oversize input rejected',async()=>{for(const body of [{message:'x',conversationId:'bad',requestId:request},{message:'x'.repeat(4001),conversationId:chat,requestId:request}]){const s=setup();assert.equal((await s.invoke({body})).code,400);assert.equal(s.calls.length,0);}});
test('persisted context reaches Gemini in order and JWT is not forwarded',async()=>{
 const s=setup();const res=await s.invoke();assert.equal(res.code,200);assert.equal(res.body.saved,true);
 const model=s.calls.find(c=>c.url.includes('googleapis'));
 assert.deepEqual(JSON.parse(model.init.body).contents.map(x=>x.role),['user','model','user']);
 assert.match(JSON.parse(model.init.body).systemInstruction.parts[0].text,/温かく静かに対話/);
 assert.equal(model.init.headers.Authorization,undefined);
 const save=s.calls.find(c=>c.url.includes('chat_save_turn'));
 assert.deepEqual(JSON.parse(save.init.body),{p_user_id:user,p_conversation_id:chat,p_request_id:request,p_message:'こんにちは',p_reply:'新しい回答',p_last_sequence:2});
 assert.equal(save.init.headers.apikey,env.SUPABASE_SECRET_KEY);
 assert.equal(s.calls.find(c=>c.url.includes('/conversations?')).init.headers.Authorization,'Bearer test-jwt');
});
test('idempotent retry returns stored reply without model usage',async()=>{const s=setup({prior:[{role:'user',content:'こんにちは'}]});const res=await s.invoke();assert.equal(res.body.reply,'保存済みの回答');assert.equal(s.calls.length,4);});
test('missing active persona prevents model usage',async()=>{const s=setup({personas:[]});const res=await s.invoke();assert.equal(res.code,503);assert.ok(!s.calls.some(c=>c.url.includes('googleapis')));});
test('same request ID with changed text rejected',async()=>{const s=setup({prior:[{role:'user',content:'別の文章'}]});assert.equal((await s.invoke()).code,409);});
test('rate limit prevents model usage',async()=>{const s=setup({rate:true});assert.equal((await s.invoke()).code,429);assert.ok(!s.calls.some(c=>c.url.includes('googleapis')));});
test('provider failure never saves a partial turn',async()=>{const s=setup({geminiStatus:429});assert.equal((await s.invoke()).code,429);assert.ok(!s.calls.some(c=>c.url.includes('chat_save_turn')));});
test('save failure is never reported as saved',async()=>{const s=setup({saveError:'unavailable'});const r=await s.invoke();assert.equal(r.code,502);assert.equal(r.body.saved,undefined);});
test('concurrent conversation update returns conflict',async()=>{const s=setup({saveError:'CHAT_CHANGED'});assert.equal((await s.invoke()).code,409);});
test('reasoning text is not saved as reply',async()=>{const s=setup({parts:[{thought:true,text:'private reasoning'},{text:'新しい回答'}]});const r=await s.invoke();assert.equal(r.body.reply,'新しい回答');assert.ok(!s.calls.find(c=>c.url.includes('chat_save_turn')).init.body.includes('private reasoning'));});
test('empty response not stored',async()=>{const s=setup({parts:[]});assert.equal((await s.invoke()).code,502);assert.ok(!s.calls.some(c=>c.url.includes('chat_save_turn')));});
test('config refuses a secret key in the public key variable',()=>{
 const original={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_PUBLISHABLE_KEY};
 process.env.SUPABASE_URL=env.SUPABASE_URL;process.env.SUPABASE_PUBLISHABLE_KEY='sb_secret_never_expose';
 try{const res=response();configHandler({method:'GET'},res);assert.equal(res.code,503);assert.ok(!JSON.stringify(res.body).includes('sb_secret'));}
 finally{for(const [key,value] of [['SUPABASE_URL',original.url],['SUPABASE_PUBLISHABLE_KEY',original.key]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
