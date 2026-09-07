import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateUsage} from '../lib/pricing.js';
import {createMeter} from '../lib/usage.js';
import {rateLimitDetails} from '../lib/provider-errors.js';
import {createUsageHandler,japanMonth} from '../api/usage.js';

const at=new Date('2026-09-08T00:00:00Z');
test('Flash calculation includes thinking and cache discount without double counting',()=>{
 const u=calculateUsage('gemini-3.7-flash',{usageMetadata:{promptTokenCount:1000000,cachedContentTokenCount:200000,candidatesTokenCount:200000,thoughtsTokenCount:300000,totalTokenCount:1500000}},{at,billingMode:'paid'});
 assert.equal(u.estimatedUsd,2.49);assert.equal(u.billedUsd,2.49);assert.equal(u.output,500000);assert.equal(u.total,1500000);
});
test('pricing change is dated and free billing differs from paid equivalent',()=>{
 const data={usageMetadata:{promptTokenCount:1000000,candidatesTokenCount:1000000,totalTokenCount:2000000}};
 assert.equal(calculateUsage('gemini-3.7-flash',data,{at,billingMode:'free'}).billedUsd,0);
 assert.equal(calculateUsage('gemini-3.7-flash',data,{at}).estimatedUsd,4.5);
 assert.equal(calculateUsage('gemini-3.7-flash',data,{at:new Date('2027-01-01Z')}).estimatedUsd,9);
 assert.equal(calculateUsage('gemini-3.7-flash',data,{at}).billedUsd,null);
});
test('embedding metadata and absent or invalid counts',()=>{
 assert.equal(calculateUsage('gemini-embedding-2',{usageMetadata:{promptTokenCount:1000000}},{at}).estimatedUsd,0.2);
 for(const value of [undefined,null,-1,'50',NaN])assert.equal(calculateUsage('gemini-3.7-flash',{usageMetadata:{promptTokenCount:value}},{at}).estimatedUsd,null);
 assert.equal(calculateUsage('unknown',{}, {at}).estimatedUsd,null);
});
test('each actual retry has its own ID, flushing twice never duplicates a write',async()=>{
 const writes=[];const m=createMeter({env:{SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'test'},fetcher:async(url,init)=>{
 if(url.includes('api_usage_events')){writes.push(JSON.parse(init.body));return new Response(null,{status:201});}
 return new Response(JSON.stringify({usageMetadata:{promptTokenCount:7}}));
 }});
 const url='https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent';
 await m.fetch(url,{});await m.fetch(url,{});await m.flush();await m.flush();
 assert.equal(writes.length,1);assert.equal(writes[0].length,2);assert.notEqual(writes[0][0].id,writes[0][1].id);
});
test('timeout is unknown; provider 429 without usage is recorded as rejected',async()=>{
 const m=createMeter({fetcher:async()=>{throw new Error('timeout');}});
 await assert.rejects(m.fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent',{}));
 assert.equal(m.events[0].estimated_usd,null);assert.equal(m.events[0].outcome,'unknown');
 const r=createMeter({fetcher:async()=>new Response('{}',{status:429})});
 await r.fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent',{});
 assert.equal(r.events[0].estimated_usd,0);assert.equal(r.events[0].outcome,'rejected');
});
test('retry guidance only uses positive verified delays',()=>{
 assert.equal(rateLimitDetails({},new Headers()).retryAfterSeconds,null);
 assert.equal(rateLimitDetails({error:{details:[{retryDelay:'5.2s'}]}},new Headers({'retry-after':'9'})).retryAfterSeconds,9);
 assert.equal(rateLimitDetails({},new Headers({'retry-after':'bad'})).retryAfterSeconds,null);
});
test('Japanese month changes at UTC 15:00, including year boundary',()=>{
 assert.equal(japanMonth(new Date('2026-09-30T14:59:59Z')),'2026-09');
 assert.equal(japanMonth(new Date('2026-09-30T15:00:00Z')),'2026-10');
 assert.equal(japanMonth(new Date('2026-12-31T15:00:00Z')),'2027-01');
});
const user='11111111-1111-4111-8111-111111111111';
function apiSetup(admin=false){
 const calls=[];const env={SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'secret',SUPABASE_PUBLISHABLE_KEY:'public',USAGE_ADMIN_USER_IDS:admin?user:''};
 const handler=createUsageHandler({env,fetcher:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(url.includes('/auth/')?{id:user}:url.includes('api_turn_usage')?[]:{}));}});
 const invoke=async(query={})=>{const res={setHeader(){},status(c){this.code=c;return this;},json(body){this.body=body;return this;}};await handler({method:'GET',headers:{authorization:'Bearer valid'},query},res);return res;};
 return{invoke,calls};
}
test('non-admin cannot obtain global totals',async()=>{const s=apiSetup();assert.equal((await s.invoke({scope:'all'})).code,403);assert.equal(s.calls.length,1);});
test('admin aggregate still scopes answer receipts to the authenticated user',async()=>{const s=apiSetup(true);const r=await s.invoke({scope:'all',requestIds:user});assert.equal(r.code,200);assert.equal(JSON.parse(s.calls[1].init.body).p_user_id,null);assert.match(s.calls[2].url,new RegExp('user_id=eq.'+user));});
test('filter injection and array query parameters rejected',async()=>{for(const query of [{month:'2026-13'},{requestIds:'x)&user_id=neq.x'},{scope:['all']},{requestIds:['x']}]){const s=apiSetup();assert.equal((await s.invoke(query)).code,400);assert.equal(s.calls.length,1);}});
