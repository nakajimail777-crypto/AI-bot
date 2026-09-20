import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from '../api/admin.js';
import {LEARNING_EXTRACTION_PROMPT} from '../lib/learning-extraction.js';

const id='11111111-1111-4111-8111-111111111111';
const env={SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SECRET_KEY:'server',ADMIN_USER_IDS:id,GEMINI_API_KEY:'test-key'};
const draft='【問題・違和感があった応答】\n原因を断定した。\n【問題の理由】\n原因は語られていない。\n【改善原則】\n未確認の原因を補完しない。\n【残したい学び】\nユーザーの言葉を尊重し、根拠のない心理解釈を避ける。';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
const generated=(text=draft,finishReason='STOP')=>({candidates:[{finishReason,content:{parts:[{text:'private thought',thought:true},{text}]}}],usageMetadata:{promptTokenCount:800,candidatesTokenCount:180,thoughtsTokenCount:20,totalTokenCount:1000}});
async function invoke({body={id},method='POST',headers={authorization:'Bearer admin-session'},user={id},environment=env,original='ユーザー: うれしいな\nスピリットドラゴン: 過去に傷ついたからですね。',missing=false,ai=()=>json(generated()),logOk=true}={}) {
 const calls=[],res={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
 const fetcher=async(url,options)=>{
   calls.push({url,options});
   if(url.endsWith('/auth/v1/user'))return json(user);
   if(url.includes('/rest/v1/learning_items?'))return json(missing?[]:[{original_text:original}]);
   if(url.includes(':generateContent'))return ai();
   if(url.includes('/rest/v1/api_usage_events?'))return new Response(null,{status:logOk?201:503});
   throw Error('Unexpected access: '+url);
 };
 await createAdminHandler({env:environment,fetcher})({method,headers,query:{action:'extract_candidate'},body},res);
 return {res,calls};
}
test('extraction requires an authenticated admin, POST, and valid item ID',async()=>{
 for(const options of [{headers:{}},{user:{id:'22222222-2222-4222-8222-222222222222'}},{user:{id,is_anonymous:true}},{method:'GET'},{body:{id:'bad'}}]) {
  const {res,calls}=await invoke(options);
  assert.ok([400,401,403,405].includes(res.code));
  assert.ok(calls.every(call=>call.url.includes('/auth/')));
 }
});
test('analyzes only server-owned original text with dedicated prompt, returns unsaved draft',async()=>{
 const {res,calls}=await invoke({body:{id,original_text:'forged',learning_text:'must not save'}});
 assert.equal(res.code,200);assert.equal(res.data.text,draft);assert.equal(res.data.noCandidate,false);
 const request=JSON.parse(calls.find(call=>call.url.includes(':generateContent')).options.body);
 assert.deepEqual(request.systemInstruction.parts,[{text:LEARNING_EXTRACTION_PROMPT}]);
 assert.match(request.systemInstruction.parts[0].text,/良い対応/);
 assert.match(request.systemInstruction.parts[0].text,/単なる一般論/);
 assert.equal(request.contents.length,1);assert.match(request.contents[0].parts[0].text,/うれしいな/);
 assert.ok(!JSON.stringify(request).includes('forged'));
 assert.ok(calls.every(call=>!call.url.includes('ai_personas')&&!call.url.includes('knowledge_')&&!call.url.includes('ai_modes')));
 const writes=calls.filter(call=>call.options.method==='POST'||call.options.method==='PATCH');
 assert.equal(writes.length,2);assert.ok(writes.every(call=>call.url.includes(':generateContent')||call.url.includes('api_usage_events')));
 assert.equal(res.data.usage.generation.input,800);assert.equal(res.data.usage.generation.output,200);
 assert.ok(res.data.usage.estimatedUsd>0);assert.equal(res.data.usage.recorded,true);
 const event=JSON.parse(calls.find(call=>call.url.includes('api_usage_events')).options.body)[0];
 assert.equal(event.user_id,null);assert.equal(event.conversation_id,null);
 assert.equal(event.category,'generation');assert.ok(!JSON.stringify(event).includes('うれしいな'));
});
test('dedicated prompt reserves no-candidate only for conversations with no grounded reusable principle',()=>{
 assert.match(LEARNING_EXTRACTION_PROMPT,/明確な問題なし/);
 assert.match(LEARNING_EXTRACTION_PROMPT,/4項目の形式/);
 assert.match(LEARNING_EXTRACTION_PROMPT,/どちらも一つも見つからない場合だけ/);
});
test('no clear learning is a non-saving result',async()=>{
 const {res}=await invoke({ai:()=>json(generated('学習候補なし'))});
 assert.equal(res.code,200);assert.equal(res.data.noCandidate,true);
});
test('missing, empty, oversized text and missing AI config never call AI',async()=>{
 for(const [options,code] of [[{missing:true},404],[{original:'   '},400],[{original:'x'.repeat(60001)},413],[{environment:{...env,GEMINI_API_KEY:''}},503]]) {
  const {res,calls}=await invoke(options);assert.equal(res.code,code);
  assert.ok(!calls.some(call=>call.url.includes('googleapis')));
 }
});
test('failed or incomplete output cannot overwrite learning, and attempts are metered',async()=>{
 for(const [ai,code] of [[()=>json({error:{message:'private provider details'}},429),429],[()=>json({},500),502],[()=>{throw Error('private network details');},503],[()=>json(generated('', 'STOP')),502],[()=>json(generated(draft,'MAX_TOKENS')),502],[()=>json(generated('unstructured text')),502],[()=>json(generated(draft+'x'.repeat(20001))),502]]) {
  const {res,calls}=await invoke({ai});assert.equal(res.code,code);
  assert.ok(!JSON.stringify(res.data).includes('private'));assert.equal(res.data.usage.recorded,true);
  assert.ok(calls.some(call=>call.url.includes('api_usage_events')));
  assert.ok(!calls.some(call=>call.options.method==='PATCH'));
 }
});
test('usage recording failure does not discard a valid draft',async()=>{
 const {res}=await invoke({logOk:false});assert.equal(res.code,200);assert.equal(res.data.text,draft);assert.equal(res.data.usage.recorded,false);
});
