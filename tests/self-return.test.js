import test from 'node:test';
import assert from 'node:assert/strict';
import {makeContext, validateDecision, decisionSchema, strategies, selfReturnReply, explicitBoundary, acceptableReply} from '../lib/self-return.js';
import {createHandler} from '../lib/chat.js';
import {createGuestHandler} from '../lib/guest-chat.js';
const decision = (action='acknowledge_only', strategy='body_anchor') => ({scores:Object.fromEntries(strategies.map(key=>[key,0.5])),response_strategy:strategy,next_action:action,reason_summary:'本人が言葉にした感覚を受け止める。'});
const jsonResponse = (value,status=200)=>new Response(JSON.stringify(value),{status});
const modelResponse = text=>jsonResponse({candidates:[{content:{parts:[{thought:true,text:'private thought'},{text}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10}});
test('strict schema rejects invalid, missing, extra, nonfinite and out of range scores',()=>{
 assert.deepEqual(validateDecision(decision()),decision());
 for(const value of [null,[],{...decision(),extra:true},{...decision(),scores:{}},{...decision(),scores:{...decision().scores,body_anchor:1.1}},{...decision(),scores:{...decision().scores,body_anchor:NaN}},{...decision(),scores:{...decision().scores,body_anchor:'0.5'}},{...decision(),response_strategy:'diagnosis'},{...decision(),next_action:'switch_mode'},{...decision(),reason_summary:'x'.repeat(241)}])assert.throws(()=>validateDecision(value));
 assert.deepEqual(decisionSchema.required,Object.keys(decision()));
});
test('minimal context separates speakers, excludes markers and limits history; selection is not a new statement',()=>{
 const history=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:'x'.repeat(2000)}));
 history.push({role:'user',content:'肩が重い\n\n［自分に戻る］'},{role:'assistant',content:'休みたいのでしょうか？'});
 const c=makeContext(history,'unsent draft',true);
 assert.equal(c.recent_turns.length,6);assert.ok(c.recent_turns.every(r=>r.content.length<=1200));
 assert.equal(c.latest_user_message,null);assert.equal(c.previous_ai_turn,'休みたいのでしょうか？');
 assert.equal(c.recent_turns.at(-2).content,'肩が重い');assert.ok(!JSON.stringify(c).includes('unsent draft'));
});
test('quoted or negated refusal is not promoted into a hard boundary',()=>{
 for(const text of ['「考えたくない」と相手に言われた','考えたくないわけではない','ここまででいい、ではなく続きを話したい'])assert.equal(explicitBoundary(makeContext([],text)),null);
});
test('explicit refusal or closure overrides a conflicting high body score and skips further generation',async()=>{
 for(const text of ['もう考えたくない','深掘りしたくない','まだ分からないままでいい','ここまででいい','少し落ち着いた']){
  let calls=0;
  const reply=await selfReturnReply({message:text,apiKey:'test',fetcher:async()=>{calls++;return modelResponse(JSON.stringify(decision('ask_one')));}});
  assert.equal(calls,1);assert.doesNotMatch(reply,/[?？]|どうしたい|呼吸|身体|body_anchor/);
 }
});
test('two-stage call enforces schema; freeform rationale and scores never reach reply generation',async()=>{
 const calls=[];
 const d=decision('ask_one','mixed_state');d.reason_summary='PRIVATE_REASON';
 const reply=await selfReturnReply({message:'AIに言われたから、そう思ってるだけかも',apiKey:'test',fetcher:async(url,init)=>{
  calls.push(JSON.parse(init.body));return modelResponse(calls.length===1?JSON.stringify(d):'AIの意見はいったん保留にできます。どのあたりが引っかかっていますか？');
 }});
 assert.equal(calls.length,2);assert.deepEqual(calls[0].generationConfig.responseJsonSchema,decisionSchema);
 assert.doesNotMatch(JSON.stringify(calls[1].contents),/PRIVATE_REASON|scores/);
 assert.equal((reply.match(/？/g)||[]).length,1);assert.doesNotMatch(reply,/本音/);
});
test('classification failures continue to a normal generation call',async()=>{
 for(const failure of ['timeout','http','json','schema']){
  let calls=0;
  const reply=await selfReturnReply({message:'今は肩が重いのが分かる',apiKey:'test',fetcher:async()=>{
   if(++calls===1){if(failure==='timeout')throw new DOMException('timed out','TimeoutError');if(failure==='http')return jsonResponse({},503);return modelResponse(failure==='json'?'not json':'{}');}
   return modelResponse('今は肩の重さが分かるんですね。その感覚から意味や答えを探さずにいても大丈夫です。');
  }});
  assert.equal(calls,2);assert.match(reply,/肩/);assert.doesNotMatch(reply,/[?？]/);
 }
});
test('full outage fallback does not ask again about sensations, wishes, body refusal or closure',async()=>{
 for(const message of ['肩が重い','休みたい気もする','身体に注意を向けたくない','まだ分からないままでいい','もう考えたくない']){
  const reply=await selfReturnReply({message,fetcher:async()=>{throw Error('offline');}});
  assert.doesNotMatch(reply,/[?？]|呼吸|どうしたい|本音|スコア/);
 }
 const entry=await selfReturnReply({modeStart:true,fetcher:async()=>{throw Error('offline');}});
 assert.equal((entry.match(/？/g)||[]).length,1);
});
test('reply boundary rejects internal JSON and multiple questions',()=>{
 for(const reply of ['{"scores":{}}','Gemini判定によると','どこですか？どうしたい？','これはあなたの本音です。'])assert.equal(acceptableReply(reply,'ask_one'),false);
 assert.equal(acceptableReply('どうしたい？','close_gently'),false);
});
test('selected memory and PDF reach only generation, never the minimal classifier',async()=>{
 const calls=[];
 const pdf={mimeType:'application/pdf',data:'test-pdf-bytes'};
 await selfReturnReply({message:'この話の気になるところを確認したい',recalledMemory:'SELECTED_OLD_MEMORY',pdf,fetcher:async(_,init)=>{
  calls.push(JSON.parse(init.body));return modelResponse(calls.length===1?JSON.stringify(decision()):'今は結論を急がずにいても大丈夫です。');
 }});
 assert.doesNotMatch(JSON.stringify(calls[0]),/SELECTED_OLD_MEMORY|test-pdf-bytes/);
 assert.match(JSON.stringify(calls[1].contents),/SELECTED_OLD_MEMORY/);
 assert.deepEqual(calls[1].contents[0].parts.at(-1).inlineData,pdf);
});
test('body refusal, tentative sorting and corrections reach generation as user data under the rules',async()=>{
 for(const message of ['身体には注意を向けたくない','全部混ざっていて少し整理したい','違う。休みたいのではない']){
  const calls=[];
  await selfReturnReply({message,fetcher:async(_,init)=>{calls.push(JSON.parse(init.body));return modelResponse(calls.length===1?JSON.stringify(decision()):'話してくれたことを受け止めます。');}});
  const payload=JSON.parse(calls[1].contents[0].parts[0].text);
  assert.equal(payload.conversation.latest_user_message,message);
  assert.match(calls[1].systemInstruction.parts[0].text,/AIが振り分けない/);
  assert.match(calls[1].systemInstruction.parts[0].text,/訂正はそのまま/);
  assert.match(calls[1].systemInstruction.parts[0].text,/不快なら勧めない/);
 }
});
const user='11111111-1111-4111-8111-111111111111',conversationId='22222222-2222-4222-8222-222222222222',requestId='33333333-3333-4333-8333-333333333333';
const env={SUPABASE_URL:'https://db.test',SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SECRET_KEY:'secret-test',GEMINI_API_KEY:'gemini-test'};
const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}});
for(const guest of [false,true])test(`${guest?'guest':'signed-in'} handler handles mode activation, outages and internal privacy`,async()=>{
 const calls=[];let saved;
 const fetcher=async(url,init)=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,body});
  if(url.includes('googleapis'))throw Error('offline');
  if(url.endsWith('/auth/v1/user'))return jsonResponse({id:user});
  if(url.includes('/conversations?'))return jsonResponse([{id:conversationId}]);
  if(url.includes('order=sequence.desc'))return jsonResponse([{role:'user',content:'今は肩が重い',sequence:1}]);
  if(url.includes('/messages?'))return jsonResponse([]);
  if(url.includes('ai_personas'))return jsonResponse([{instructions:'persona'}]);
  if(url.includes('chat_save_turn')){saved=body;return jsonResponse({reply:body.p_reply});}
  if(url.includes('rpc/trial_chat')){
   if(body.p_action==='reserve')return jsonResponse({rows:[{role:'user',content:'今は肩が重い'}]});
   if(body.p_action==='finish'){saved=body;return jsonResponse({reply:body.p_reply,remaining:4});}
  }
  return jsonResponse(null);
 };
 const res=response();
 await (guest?createGuestHandler:createHandler)({env,fetcher})({method:'POST',headers:{authorization:'Bearer test'},body:{message:'',conversationId,requestId,selfReturn:true,modeStart:true}},res);
 assert.equal(res.code,200);assert.ok(saved.p_reply);assert.doesNotMatch(saved.p_reply,/[?？]/);
 assert.ok(!calls.some(c=>c.url.includes('embedContent')));
 assert.doesNotMatch(JSON.stringify(calls.filter(c=>!c.url.includes('googleapis'))),/reason_summary|response_strategy|body_anchor/);
 assert.doesNotMatch(JSON.stringify(res.body),/scores|next_action|reason_summary/);
 const invalid=response();await (guest?createGuestHandler:createHandler)({env,fetcher})({method:'POST',headers:{authorization:'Bearer test'},body:{message:'',conversationId,requestId,modeStart:true}},invalid);
 assert.equal(invalid.code,400);
});
