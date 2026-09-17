import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from '../api/admin.js';
const id='11111111-1111-4111-8111-111111111111';
const env={SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SECRET_KEY:'secret',ADMIN_USER_IDS:id};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
async function run({action='save_candidate',method='POST',body={id,source:'web'},user=id,read=()=>json([])}={}) {
 const calls=[]; const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
 await createAdminHandler({env,fetcher:async(url,options)=>{calls.push({url,options});return url.includes('/auth/')?json({id:user}):read(url,options);}})({method,query:{action},body,headers:{authorization:'Bearer test'}},res);
 return {res,calls};
}
test('candidate writes require validated admin and POST',async()=>{
 const {res,calls}=await run({user:'22222222-2222-4222-8222-222222222222'});assert.equal(res.code,403);assert.equal(calls.length,1);
 assert.equal((await run({method:'GET'})).res.code,405);
 assert.equal((await run({body:{id:'invalid',source:'web'}})).res.code,400);
});
test('Web saves server-owned text from every message page; ignores supplied text',async()=>{
 let saved;
 const {res}=await run({body:{id,source:'web',original_text:'forged'},read:(url,opt)=>{
   if(opt.method==='POST'){saved=JSON.parse(opt.body);return new Response(null,{status:201});}
   if(url.includes('conversations?'))return json([{id}]);
   return json(url.includes('offset=0')?Array.from({length:100},(_,i)=>({role:'user',content:`message ${i}`})):[{role:'assistant',content:'final message'}]);
 }});
 assert.equal(res.code,201);assert.equal(saved.source_id,id);assert.equal(saved.session_id,id);assert.equal(saved.status,'candidate');assert.equal(saved.source_type,'conversation');assert.match(saved.original_text,/message 0/);assert.match(saved.original_text,/final message$/);assert.ok(!saved.original_text.includes('forged'));
});
test('LINE saves retained turns using anonymized session ID',async()=>{
 const hash='a'.repeat(64);let saved;
 const {res}=await run({body:{id:hash,source:'line'},read:(url,opt)=>{
  if(opt.method==='POST'){saved=JSON.parse(opt.body);return new Response(null,{status:201});}
  return json([{turns:[{message:'hello',reply:'world'}]}]);
 }});
 assert.equal(res.code,201);assert.equal(saved.session_id,hash);assert.equal(saved.original_text,'ユーザー: hello\n\nスピリットドラゴン: world');
});
test('missing and empty conversations never write',async()=>{
 for(const exists of [false,true]){
  const {res,calls}=await run({read:url=>json(exists&&url.includes('conversations?')?[{id}]:[])});
  assert.equal(res.code,exists?400:404);assert.ok(calls.every(c=>c.options.method!=='POST'));
 }
});
test('write failure is reported without leaking DB content',async()=>{
 const {res}=await run({read:(url,opt)=>opt.method==='POST'?json({secret:'private'},500):json(url.includes('conversations?')?[{id}]:[{role:'user',content:'hello'}])});
 assert.equal(res.code,503);assert.ok(!JSON.stringify(res.data).includes('private'));
});
test('candidate list is paginated and returns only text preview',async()=>{
 const {res,calls}=await run({action:'candidates',method:'GET',read:()=>json(Array.from({length:26},()=>({id,original_text:'x'.repeat(500),status:'candidate',created_at:'2026-09-18'})))});
 assert.equal(res.code,200);assert.equal(res.data.items.length,25);assert.equal(res.data.nextOffset,25);assert.equal(res.data.items[0].original_text.length,240);assert.match(calls[1].url,/order=created_at.desc,id.desc/);
});
