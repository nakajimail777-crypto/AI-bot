import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanHandler} from '../api/ayumi-plan.js';
const owner='11111111-1111-4111-8111-111111111111';
const env={SUPABASE_URL:'https://db.invalid',SUPABASE_PUBLISHABLE_KEY:'public-fixture',SUPABASE_SECRET_KEY:'server-fixture',GEMINI_API_KEY:'ai-fixture'};
function fixture({user={id:owner},authStatus=200,reserveStatus=200,reserveError={},aiStatus=200,raw=JSON.stringify({title:'公開準備',items:['準備する','確認する']}),finishReason='STOP',network=false}={}){
 const calls=[];
 const fetcher=async(url,options={})=>{
  calls.push({url,options});if(network)throw new Error('private network info');
  if(url.endsWith('/auth/v1/user'))return Response.json(user,{status:authStatus});
  if(url.endsWith('/rpc/chat_reserve_request'))return Response.json(reserveError,{status:reserveStatus});
  if(url.includes('generativelanguage'))return Response.json({candidates:[{finishReason,content:{parts:[{thought:true,text:'private reasoning'},{text:raw}]}}]},{status:aiStatus});
  if(url.includes('/api_usage_events'))return new Response(null,{status:201});
  throw new Error('Unexpected request: '+url);
 };
 const handler=createPlanHandler({env,fetcher});
 return {calls,async run(req={}){const headers={};let status,body;const res={setHeader(k,v){headers[k]=v;},status(s){status=s;return this;},json(b){body=b;return this;}};await handler({method:'POST',headers:{authorization:'Bearer fixture'},body:{goal:'Instagramを公開したい'},...req},res);return {status,body,headers};}};
}
test('requires valid request and a verified nonanonymous user before spending',async()=>{
 for(const req of [{method:'GET'},{headers:{}},{body:{goal:''}},{body:{goal:'x'.repeat(2001)}}]){const f=fixture();assert.ok((await f.run(req)).status>=400);assert.equal(f.calls.length,0);}
 for(const options of [{user:{id:owner,is_anonymous:true}},{user:{}},{authStatus:401}]){const f=fixture(options);assert.equal((await f.run()).status,401);assert.equal(f.calls.length,1);}
});
test('uses existing model, verified owner and quota; returns only a proposal without saving goals',async()=>{
 const f=fixture(),result=await f.run({body:{goal:'公開したい',user_id:'other',done:true}});
 assert.equal(result.status,200);assert.equal(result.body.saved,false);assert.deepEqual(result.body.plan,{title:'公開準備',items:['準備する','確認する']});
 const quota=f.calls.find(c=>c.url.includes('reserve'));assert.deepEqual(JSON.parse(quota.options.body),{p_user_id:owner});
 const ai=f.calls.find(c=>c.url.includes('generativelanguage'));assert.match(ai.url,/gemini-3\.7-flash/);assert.equal(JSON.parse(ai.options.body).contents[0].parts[0].text,'公開したい');
 assert.ok(!f.calls.some(c=>/ayumi_projects|conversations|messages|chat_save/.test(c.url)));
 const usage=JSON.parse(f.calls.find(c=>c.url.includes('api_usage_events')).options.body);assert.equal(usage[0].user_id,owner);assert.ok(!JSON.stringify(usage).includes('公開したい'));
});
test('quota, provider errors and invalid or truncated outputs fail closed',async()=>{
 let f=fixture({reserveStatus:400,reserveError:{message:'CHAT_RATE_LIMIT'}});let r=await f.run();assert.equal(r.status,429);assert.equal(r.headers['Retry-After'],'60');assert.equal(f.calls.length,2);
 for(const options of [{reserveStatus:503},{aiStatus:429},{aiStatus:500},{raw:'not json'},{raw:JSON.stringify({title:'x',items:[{text:'x',done:true}]})},{raw:JSON.stringify({title:'x',items:Array(21).fill('x')})},{finishReason:'MAX_TOKENS'},{network:true}]){f=fixture(options);r=await f.run();assert.ok(r.status>=400);assert.equal(r.body.plan,undefined);assert.ok(!JSON.stringify(r.body).includes('private'));}
});
