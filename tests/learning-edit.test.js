import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from '../api/admin.js';
const id='11111111-1111-4111-8111-111111111111';
const stamp='2026-09-18T01:02:03.123456+00:00';
async function invoke({action='update_candidate',method='POST',user=id,body={id,learning_text:'学び',expected_updated_at:stamp},read=()=>new Response('[]')}={}) {
 const calls=[],res={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;}};
 await createAdminHandler({env:{SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SECRET_KEY:'server',ADMIN_USER_IDS:id},now:()=>new Date('2026-09-19T00:00:00Z'),fetcher:async(url,options)=>{calls.push({url,options});return url.includes('/auth/')?new Response(JSON.stringify({id:user})):read(url,options);}})({method,query:{action,id},body,headers:{authorization:'Bearer session'}},res);
 return {res,calls};
}
test('full detail returns original and saved learning; missing item is 404',async()=>{
 const original='全文'.repeat(1000);
 const {res}=await invoke({action:'candidate',method:'GET',read:()=>new Response(JSON.stringify([{id,original_text:original,learning_text:'保存済み'}]))});
 assert.equal(res.code,200);assert.equal(res.data.candidate.original_text,original);assert.equal(res.data.candidate.learning_text,'保存済み');
 assert.equal((await invoke({action:'candidate',method:'GET'})).res.code,404);
});
test('update only writes learning text and timestamp, preserving original and status',async()=>{
 const {res,calls}=await invoke({body:{id,learning_text:'<script>本文</script>\n次の行',expected_updated_at:stamp,original_text:'forged',status:'adopted'},read:()=>new Response(JSON.stringify([{id,learning_text:'保存',updated_at:stamp}]))});
 assert.equal(res.code,200);const patch=calls[1];assert.equal(patch.options.method,'PATCH');
 assert.deepEqual(JSON.parse(patch.options.body),{learning_text:'<script>本文</script>\n次の行',updated_at:'2026-09-19T00:00:00.000Z'});
 assert.ok(patch.url.includes('updated_at=eq.'+encodeURIComponent(stamp)));
});
test('conflicting update returns 409 and provider failures return safe 503',async()=>{
 assert.equal((await invoke()).res.code,409);
 const {res}=await invoke({read:()=>new Response('private details',{status:500})});assert.equal(res.code,503);assert.ok(!JSON.stringify(res.data).includes('private'));
});
test('update validation blocks bad ids, types, missing revision and oversized text',async()=>{
 for(const change of [{id:'invalid'},{learning_text:null},{learning_text:'x'.repeat(20001)},{expected_updated_at:'not a date'}]){
  const {res,calls}=await invoke({body:{id,learning_text:'学び',expected_updated_at:stamp,...change}});assert.equal(res.code,400);assert.equal(calls.length,1);
 }
 assert.equal((await invoke({method:'GET'})).res.code,405);
});
test('empty learning text can be saved intentionally',async()=>{
 const {res,calls}=await invoke({body:{id,learning_text:'',expected_updated_at:stamp},read:()=>new Response(JSON.stringify([{id,learning_text:'',updated_at:stamp}]))});assert.equal(res.code,200);assert.equal(JSON.parse(calls[1].options.body).learning_text,'');
});
test('non-admin cannot read detail or update candidate',async()=>{
 for(const action of ['candidate','update_candidate']){const {res,calls}=await invoke({action,method:action==='candidate'?'GET':'POST',user:'22222222-2222-4222-8222-222222222222'});assert.equal(res.code,403);assert.equal(calls.length,1);}
});
