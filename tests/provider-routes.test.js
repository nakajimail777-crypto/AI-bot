import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../lib/chat.js';
import {createGuestHandler,trialProviderRequestId} from '../lib/guest-chat.js';
import {createPlanHandler} from '../api/ayumi-plan.js';
import configHandler from '../api/config.js';

const userId='11111111-1111-4111-8111-111111111111';
const conversationId='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
const memoryId='44444444-4444-4444-8444-444444444444';
const environment={SUPABASE_URL:'https://db.invalid',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_route_fixture',SUPABASE_SECRET_KEY:'server-route-fixture',GEMINI_API_KEY:'gemini-route-fixture',OPENAI_API_KEY:'openai-route-fixture'};
const modelNames={gemini:'gemini-3.7-flash',openai:'gpt-5.4-mini-2026-03-17'};
const history=[{role:'assistant',content:'SERVER_HISTORY_REPLY',sequence:2},{role:'user',content:'SERVER_HISTORY_QUESTION',sequence:1}];
const attachment={name:'fixture.pdf',mimeType:'application/pdf',data:Buffer.from('%PDF-1.4\nfixture-only\n%%EOF').toString('base64')};
const mindMap={version:1,id:'55555555-5555-4555-8555-555555555555',fields:{event:'MAP_EVENT_FIXTURE',feeling:'MAP_FEELING_FIXTURE',interpretation:'',reaction:'',afterglow:''}};
const decision={scores:{body_anchor:.5,mixed_state:.5,separate_gently:.5,self_choice:.5,rest_without_analysis:.5},response_strategy:'mixed_state',next_action:'acknowledge_only',reason_summary:'PRIVATE_CLASSIFIER_REASON'};
const response=()=>({headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers});
const isGeneration=call=>call.url.endsWith('/v1/responses')||call.url.includes(':generateContent');
const generations=fixture=>fixture.calls.filter(isGeneration);
const savedTurns=fixture=>fixture.calls.filter(call=>call.url.includes('/rpc/chat_save_turn'));
const trialCalls=(fixture,action)=>fixture.calls.filter(call=>call.url.includes('/rpc/trial_chat')&&call.body.p_action===action);

function fixture(options={}){
  const calls=[],trialSaved=new Map();
  const env={...environment,...options.env};
  const fetcher=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;
    const call={url:String(url),init,body};calls.push(call);
    if(call.url.endsWith('/auth/v1/user'))return json({id:userId,...options.user},options.authStatus||200);
    if(call.url.includes('/conversations?'))return json(options.foreign?[]:[{id:conversationId}]);
    if(call.url.includes('/messages?id='))return json(options.prior||[]);
    if(call.url.includes('/messages?reply_to='))return json([{content:'SAVED_ORIGINAL_REPLY'}]);
    if(call.url.includes('/api_turn_usage?'))return json(options.receipt?[{usage:options.receipt}]:[]);
    if(call.url.includes('/messages?conversation_id='))return json(options.history||history);
    if(call.url.includes('/memories?'))return json(options.foreignMemory?[]:[{id:memoryId,content:'SELECTED_MEMORY_FIXTURE'}]);
    if(call.url.includes('/rpc/chat_reserve_request'))return options.quota?json({message:'CHAT_RATE_LIMIT'},400):json(null);
    if(call.url.includes('/ai_personas?'))return json([{instructions:'PERSONA_FIXTURE: 本人の言葉と希望を尊重する。'}]);
    if(call.url.includes('/ai_modes?'))return json([]);
    if(call.url.includes(':embedContent'))return json({embedding:{values:Array(768).fill(.1)},usageMetadata:{promptTokenCount:9}});
    if(call.url.includes('/rpc/match_knowledge'))return json([{title:'REFERENCE_TITLE',content:'RAG_REFERENCE_FIXTURE'}]);
    if(isGeneration(call)){
      if(options.providerStatus)return json({error:{message:'DO_NOT_EXPOSE_UPSTREAM_DETAILS'}},options.providerStatus,{'Retry-After':'13'});
      const schemaName=body.text?.format?.name;
      const schema=body.generationConfig?.responseJsonSchema;
      const isDecision=schemaName==='self_return_decision'||schema?.properties?.scores;
      const isPlan=schemaName==='ayumi_plan'||schema?.properties?.items;
      const text=isDecision?JSON.stringify(decision):isPlan?(options.planText||JSON.stringify({title:'小さな散歩',items:['無理のない範囲で歩く']})):'今は結論を急がず、そのままでいて大丈夫です。';
      if(call.url.includes(':generateContent'))return json({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:10,totalTokenCount:130}});
      if(options.openaiResponse)return json(options.openaiResponse);
      return json({status:'completed',model:modelNames.openai,output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}],usage:{input_tokens:100,input_tokens_details:{cached_tokens:20},output_tokens:30,output_tokens_details:{reasoning_tokens:10},total_tokens:130}});
    }
    if(call.url.includes('/rpc/chat_save_turn')){
      if(options.missingReceiptMigration&&call.url.endsWith('chat_save_turn_with_usage'))return json({code:'PGRST202'},404);
      return json({reply:options.concurrentReceipt?'CONCURRENT_SAVED_REPLY':body.p_reply,usage:options.receiptUnavailable?null:(options.concurrentReceipt||body.p_usage)});
    }
    if(call.url.includes('/api_usage_events')||call.url.includes('/debug_events'))return json(null);
    if(call.url.includes('/rpc/trial_chat')){
      if(body.p_action==='reserve'){
        if(options.quota)return json({code:'TRIAL_LIMIT',error:'trial limit'});
        if(trialSaved.has(body.p_request))return json({cached:true,reply:trialSaved.get(body.p_request),remaining:5-trialSaved.size});
        return json({remaining:5-trialSaved.size,rows:[...history].reverse()});
      }
      if(body.p_action==='finish'){trialSaved.set(body.p_request,body.p_reply);return json({reply:body.p_reply,remaining:5-trialSaved.size});}
      return json(body.p_action==='state'?{rows:[],remaining:5}:{});
    }
    throw new Error('Unexpected mocked route: '+call.url);
  };
  async function invoke(kind,body={},overrides={}){
    const res=response();
    const headers=kind==='guest'?{host:'site.invalid',origin:'https://site.invalid'}:{authorization:'Bearer fixture-user-jwt'};
    const defaults=kind==='plan'?{goal:'無理なく散歩したい'}:{message:'この話をゆっくり確認したい',conversationId,requestId};
    const handler=kind==='guest'?createGuestHandler({env,fetcher}):kind==='plan'?createPlanHandler({env,fetcher}):createHandler({env,fetcher});
    await handler({method:'POST',headers,body:{...defaults,...body},...overrides},res);
    return res;
  }
  return {calls,env,invoke,trialSaved};
}

for(const kind of ['chat','guest','plan']){
  test(`${kind}: missing provider preserves Gemini and explicit OpenAI reaches only its generation API`,async()=>{
    for(const provider of [undefined,'openai']){
      const s=fixture();const r=await s.invoke(kind,{provider});
      assert.equal(r.code,200);assert.equal(r.body.provider,provider||'gemini');
      assert.equal(r.body.model,modelNames[provider||'gemini']);
      assert.equal(generations(s).length,1);
      const generated=generations(s)[0];
      assert.equal(generated.url,provider==='openai'?'https://api.openai.com/v1/responses':'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent');
      if(provider==='openai'){
        assert.equal(generated.body.store,false);
        assert.equal(generated.init.headers.Authorization,'Bearer '+environment.OPENAI_API_KEY);
        assert.ok(!JSON.stringify(generated).includes('fixture-user-jwt'));
      }
      if(kind!=='plan')assert.equal(s.calls.filter(c=>c.url.includes(':embedContent')).length,1,'existing Gemini RAG remains enabled');
    }
  });
  test(`${kind}: invalid or unconfigured provider cannot consume quota or call either model`,async()=>{
    for(const provider of [null,'unknown',{},'OpenAI']){
      const s=fixture();assert.equal((await s.invoke(kind,{provider})).code,400);assert.equal(s.calls.length,0);
    }
    const s=fixture({env:{OPENAI_API_KEY:''}});
    assert.equal((await s.invoke(kind,{provider:'openai'})).code,503);assert.equal(s.calls.length,0);
  });
  test(`${kind}: shared quota stops selected OpenAI before generation`,async()=>{
    const s=fixture({quota:true});const r=await s.invoke(kind,{provider:'openai'});
    assert.equal(r.code,429);assert.equal(generations(s).length,0);assert.equal(savedTurns(s).length,0);assert.equal(trialCalls(s,'finish').length,0);
  });
  test(`${kind}: OpenAI refusal and incomplete output are not saved`,async()=>{
    for(const openaiResponse of [
      {status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'UNFINISHED_REPLY'}]}]},
      {status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'refusal',refusal:'REFUSAL_DETAILS'}]}]}
    ]){
      const s=fixture({openaiResponse});const r=await s.invoke(kind,{provider:'openai'});
      assert.equal(r.code,502);assert.equal(savedTurns(s).length,0);assert.equal(trialCalls(s,'finish').length,0);
      assert.equal(r.body.saved,undefined);assert.doesNotMatch(JSON.stringify(r.body),/UNFINISHED_REPLY|REFUSAL_DETAILS/);
      if(kind==='guest')assert.equal(trialCalls(s,'fail').length,1,'failed trial releases its own lease');
    }
  });
  test(`${kind}: provider throttling remains 429 with retry advice and no answer save`,async()=>{
    const s=fixture({providerStatus:429});const r=await s.invoke(kind,{provider:'openai'});
    assert.equal(r.code,429);assert.equal(r.headers['Retry-After'],'13');assert.equal(savedTurns(s).length,0);assert.equal(trialCalls(s,'finish').length,0);
    assert.doesNotMatch(JSON.stringify(r.body),/DO_NOT_EXPOSE_UPSTREAM_DETAILS/);
  });
}

test('OpenAI chat validates login, conversation ownership and selected memory ownership before generation',async()=>{
  for(const options of [{authStatus:401},{user:{is_anonymous:true}},{foreign:true},{foreignMemory:true}]){
    const s=fixture(options);const r=await s.invoke('chat',{provider:'openai',...(options.foreignMemory?{memoryId}:{})});
    assert.equal(r.code,options.authStatus||options.user?401:404);
    assert.equal(generations(s).length,0);assert.ok(!s.calls.some(c=>c.url.includes('chat_reserve_request')));
  }
  const s=fixture();assert.equal((await s.invoke('chat',{provider:'openai'},{headers:{}})).code,401);assert.equal(s.calls.length,0);
});

test('OpenAI gets server history, selected PDF/memory/map as user data and preserves a provider receipt',async()=>{
  const s=fixture();const r=await s.invoke('chat',{provider:'openai',attachment,memoryId,mindMap,history:[{role:'user',content:'CLIENT_FORGED_HISTORY'}]});
  assert.equal(r.code,200);
  const generated=generations(s)[0].body;
  assert.deepEqual(generated.input.map(x=>x.role),['user','assistant','user']);
  assert.equal(generated.input[0].content[0].text,'SERVER_HISTORY_QUESTION');
  assert.equal(generated.input[1].content,'SERVER_HISTORY_REPLY');
  assert.doesNotMatch(JSON.stringify(generated),/CLIENT_FORGED_HISTORY/);
  assert.match(generated.instructions,/PERSONA_FIXTURE/);assert.match(generated.instructions,/RAG_REFERENCE_FIXTURE/);
  const parts=generated.input.at(-1).content;
  assert.ok(parts.some(p=>p.type==='input_file'&&p.file_data==='data:application/pdf;base64,'+attachment.data));
  assert.match(JSON.stringify(parts),/SELECTED_MEMORY_FIXTURE/);assert.match(JSON.stringify(parts),/MAP_EVENT_FIXTURE/);
  assert.doesNotMatch(generated.instructions,/SELECTED_MEMORY_FIXTURE|MAP_EVENT_FIXTURE/);
  const saved=savedTurns(s)[0].body;
  assert.equal(saved.p_usage.provider,'openai');assert.equal(saved.p_usage.model,modelNames.openai);
  assert.equal(saved.p_usage.generation.output,30);assert.equal(saved.p_usage.generation.thinking,10);
  assert.match(saved.p_usage.attachment.sha256,/^[a-f0-9]{64}$/);
  assert.ok(!s.calls.filter(c=>c.url.startsWith(environment.SUPABASE_URL)).some(c=>JSON.stringify(c.body).includes(attachment.data)));
});

test('OpenAI chat can answer when Gemini RAG key is absent without sending a Google request',async()=>{
  const s=fixture({env:{GEMINI_API_KEY:''}});const r=await s.invoke('chat',{provider:'openai'});
  assert.equal(r.code,200);assert.equal(generations(s).length,1);assert.ok(!s.calls.some(c=>c.url.includes('googleapis.com')));
});

for(const kind of ['chat','guest']){
  test(`${kind}: all conversation modes preserve the selected OpenAI route`,async()=>{
    const modes=['seikanMode','blindSpot','emotionFocus','encouragement','returnPath','skyGazing','deepExploration','patternExploration','directionExploration'];
    for(const mode of modes){
      const s=fixture();const r=await s.invoke(kind,{provider:'openai',[mode]:true});
      assert.equal(r.code,200,mode);assert.equal(generations(s).length,1,mode);
      assert.equal(generations(s)[0].url,'https://api.openai.com/v1/responses',mode);
      assert.equal(r.body.provider,'openai',mode);
    }
    if(kind==='chat'){
      const s=fixture();assert.equal((await s.invoke(kind,{provider:'openai',reactionLab:{step:2,candidates:false}})).code,200);
      assert.match(generations(s)[0].body.instructions,/反応の実験室/);
    }
  });
  test(`${kind}: self-return uses OpenAI twice and keeps reference data outside its classifier`,async()=>{
    const s=fixture();const r=await s.invoke(kind,{provider:'openai',selfReturn:true,mindMap,...(kind==='chat'?{attachment,memoryId}:{})});
    assert.equal(r.code,200);assert.equal(generations(s).length,2);
    const [classify,reply]=generations(s).map(c=>c.body);
    assert.equal(classify.text.format.name,'self_return_decision');assert.equal(classify.text.format.strict,true);
    assert.doesNotMatch(JSON.stringify(classify),/SELECTED_MEMORY_FIXTURE|MAP_EVENT_FIXTURE|data:application\/pdf/);
    assert.match(JSON.stringify(reply.input),/MAP_EVENT_FIXTURE/);
    if(kind==='chat'){
      assert.match(JSON.stringify(reply.input),/SELECTED_MEMORY_FIXTURE/);
      assert.ok(reply.input[0].content.some(p=>p.type==='input_file'));
    }
    assert.doesNotMatch(JSON.stringify(reply.input),/PRIVATE_CLASSIFIER_REASON|"scores"/);
    assert.doesNotMatch(r.body.reply,/PRIVATE_CLASSIFIER_REASON|scores/);
    assert.ok(generations(s).every(c=>c.url==='https://api.openai.com/v1/responses'));
    assert.ok(!s.calls.some(c=>c.url.includes(':embedContent')));
  });
}

test('saved chat retries reject known provider mismatches and do not guess a missing receipt',async()=>{
  for(const savedProvider of ['gemini','openai'])for(const selectedProvider of ['gemini','openai']){
    const s=fixture({prior:[{role:'user',content:'この話をゆっくり確認したい'}],receipt:{provider:savedProvider,model:modelNames[savedProvider]}});
    const r=await s.invoke('chat',{provider:selectedProvider});
    assert.equal(r.code,savedProvider===selectedProvider?200:409);
    assert.equal(generations(s).length,0);assert.ok(!s.calls.some(c=>c.url.includes('chat_reserve_request')));
    if(r.code===200){assert.equal(r.body.reply,'SAVED_ORIGINAL_REPLY');assert.equal(r.body.provider,savedProvider);}
  }
  for(const provider of ['gemini','openai']){
    const legacy=fixture({prior:[{role:'user',content:'この話をゆっくり確認したい'}]});
    const result=await legacy.invoke('chat',{provider});
    assert.equal(result.code,200);assert.equal(result.body.reply,'SAVED_ORIGINAL_REPLY');
    assert.equal(result.body.provider,null);assert.equal(result.body.model,null);assert.equal(result.body.replySource,'cached');
    assert.equal(generations(legacy).length,0);
  }
});

test('a committed answer without its optional receipt never inherits the selected AI label',async()=>{
  for(const provider of ['gemini','openai']){
    const s=fixture({receiptUnavailable:true});const r=await s.invoke('chat',{provider});
    assert.equal(r.code,200);assert.equal(r.body.saved,true);assert.equal(r.body.usage,null);
    assert.equal(r.body.provider,null);assert.equal(r.body.model,null);assert.equal(r.body.replySource,'cached');
    assert.equal(savedTurns(s).length,1);
  }
});

test('concurrent save winner from another provider is never attributed to the selected AI',async()=>{
  const s=fixture({concurrentReceipt:{provider:'gemini',model:modelNames.gemini}});
  const r=await s.invoke('chat',{provider:'openai'});
  assert.equal(r.code,409);
  assert.equal(r.body.saved,undefined);assert.equal(r.body.reply,undefined);
});

test('OpenAI cannot fall back to legacy save without a durable provider receipt',async()=>{
  const s=fixture({missingReceiptMigration:true});const r=await s.invoke('chat',{provider:'openai'});
  assert.equal(r.code,503);assert.equal(r.body.saved,undefined);
  assert.equal(savedTurns(s).length,1);assert.ok(savedTurns(s)[0].url.endsWith('chat_save_turn_with_usage'));
  assert.ok(!s.calls.some(c=>c.url.endsWith('/rpc/chat_save_turn')));
});

test('Gemini keeps legacy save compatibility when the receipt migration is unavailable',async()=>{
  const s=fixture({missingReceiptMigration:true});const r=await s.invoke('chat');
  assert.equal(r.code,200);assert.equal(r.body.saved,true);assert.equal(r.body.provider,null);assert.equal(r.body.replySource,'cached');
  assert.equal(savedTurns(s).length,2);assert.ok(savedTurns(s)[1].url.endsWith('/rpc/chat_save_turn'));
});

test('guest provider change gets a separate quota reservation while same-provider retry is cached',async()=>{
  const s=fixture();const first=await s.invoke('guest',{provider:'gemini'});
  const cookie=first.headers['Set-Cookie'];
  const overrides={headers:{host:'site.invalid',origin:'https://site.invalid',cookie}};
  const second=await s.invoke('guest',{provider:'openai'},overrides);
  const third=await s.invoke('guest',{provider:'openai'},overrides);
  assert.equal(first.body.remaining,4);assert.equal(second.body.remaining,3);assert.equal(third.body.remaining,3);
  assert.equal(third.body.cached,true);assert.equal(third.body.provider,'openai');assert.equal(generations(s).length,2);
  const requests=trialCalls(s,'reserve').map(c=>c.body.p_request);
  assert.equal(requests[0],requestId);assert.notEqual(requests[1],requestId);assert.equal(requests[2],requests[1]);
  assert.equal(requests[1],trialProviderRequestId(requestId.toUpperCase(),'openai'));
  assert.equal(trialCalls(s,'finish').length,2);
});

test('guest OpenAI uses server-owned history and rejects cross-site requests',async()=>{
  const s=fixture();const r=await s.invoke('guest',{provider:'openai',history:[{role:'user',content:'CLIENT_FORGED_HISTORY'}]});
  assert.equal(r.code,200);assert.match(JSON.stringify(generations(s)[0].body.input),/SERVER_HISTORY_QUESTION/);assert.doesNotMatch(JSON.stringify(generations(s)[0].body),/CLIENT_FORGED_HISTORY/);
  const denied=fixture();assert.equal((await denied.invoke('guest',{provider:'openai'},{headers:{host:'site.invalid',origin:'https://attacker.invalid'}})).code,403);assert.equal(denied.calls.length,0);
});

test('Ayumi uses strict structured output and returns an unsaved proposal only',async()=>{
  const s=fixture();const r=await s.invoke('plan',{provider:'openai'});
  assert.equal(r.code,200);assert.equal(r.body.saved,false);assert.deepEqual(r.body.plan,{title:'小さな散歩',items:['無理のない範囲で歩く']});
  const generated=generations(s)[0].body;
  assert.equal(generated.text.format.name,'ayumi_plan');assert.equal(generated.text.format.strict,true);
  assert.deepEqual(generated.text.format.schema.required,['title','items']);
  assert.ok(!s.calls.some(c=>/ayumi_projects|ayumi_items|chat_save_turn/.test(c.url)));
  for(const planText of ['not-json',JSON.stringify({title:'',items:['a']}),JSON.stringify({title:'x',items:[]})]){
    const invalid=fixture({planText});const rejected=await invalid.invoke('plan',{provider:'openai'});
    assert.equal(rejected.code,502);assert.equal(rejected.body.plan,undefined);
  }
});

test('Ayumi rejects anonymous and invalid login before quota or selected AI',async()=>{
  for(const options of [{authStatus:401},{user:{is_anonymous:true}}]){
    const s=fixture(options);assert.equal((await s.invoke('plan',{provider:'openai'})).code,401);
    assert.equal(generations(s).length,0);assert.ok(!s.calls.some(c=>c.url.includes('chat_reserve_request')));
  }
});

test('public config exposes availability and model names without any private credentials',async()=>{
  const keys=Object.keys(environment),before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try{
    Object.assign(process.env,environment);
    const r=response();await configHandler({method:'GET',headers:{},query:{}},r);
    assert.equal(r.code,200);assert.equal(r.body.defaultProvider,'gemini');
    assert.deepEqual(r.body.providers.map(p=>({id:p.id,available:p.available})),[{id:'gemini',available:true},{id:'openai',available:true}]);
    for(const p of r.body.providers)assert.deepEqual(Object.keys(p).sort(),['available','id','label','model']);
    const serialized=JSON.stringify(r.body);
    for(const key of ['SUPABASE_SECRET_KEY','OPENAI_API_KEY','GEMINI_API_KEY'])assert.ok(!serialized.includes(environment[key]));
    process.env.OPENAI_API_KEY='';
    const absent=response();await configHandler({method:'GET',headers:{},query:{}},absent);
    assert.equal(absent.body.providers.find(p=>p.id==='openai').available,false);
    const privateLink=response();await configHandler({method:'GET',headers:{},query:{view:'stepbook'}},privateLink);
    assert.deepEqual(privateLink.body,{url:null},'private Stepbook branch must not expose main config');
  }finally{
    for(const key of keys)if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];
  }
});
