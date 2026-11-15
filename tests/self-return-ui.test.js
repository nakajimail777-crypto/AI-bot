import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const source=(await readFile(new URL('../assets/app.js',import.meta.url),'utf8')).replace(/\nstart\(\);\s*$/, '\n');
const providerSource=await readFile(new URL('../assets/ai-provider.js',import.meta.url),'utf8');
const usageSource=await readFile(new URL('../assets/usage-ui.js',import.meta.url),'utf8');
function setup(){
 const nodes=new Map();
 const element=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',style:{},dataset:{},children:[],listeners:{},classList:{toggle(){},add(){},remove(){}},addEventListener(type,handler){this.listeners[type]=handler;},setAttribute(){},removeAttribute(){},close(){},showModal(){},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},focus(){}});
  return nodes.get(id);
 };
 const requests=[],deep={handlers:null,opens:[],closes:0,updates:[]};
 const DragonDeepExploration={create(handlers){deep.handlers=handlers;return{open(options){deep.opens.push(options);},close(){deep.closes++;},update(options){deep.updates.push(options);}};}};
 let finish,requested;
 const context=vm.createContext({document:{dispatchEvent(){},addEventListener(){},getElementById:element,createElement:type=>element(Symbol(type)),querySelector:()=>({open:true}),querySelectorAll:()=>[]},location:{search:''},window:{},DragonDeepExploration,crypto:{randomUUID},Event,setTimeout,clearTimeout,setInterval:()=>0,AbortSignal,URL,Blob,sessionStorage:{setItem(){},getItem(){return null;}},fetch:async(url,init)=>{requested={url,body:JSON.parse(init.body)};requests.push(requested);return new Promise(resolve=>{finish=resolve;});}});
 vm.runInContext(providerSource,context);
 vm.runInContext(usageSource,context);context.DragonUsage=context.window.DragonUsage;
 vm.runInContext(source,context);
 vm.runInContext(`aiProvider.configure({providers:[{id:'gemini',available:true},{id:'openai',available:true}]});ready=true;session={user:{id:'user'}};activeId='chat';selfReturn=true;globalThis.originalControls=controls;globalThis.originalRememberDraft=rememberDraft;
 db={auth:{getSession:async()=>({data:{session:{access_token:'test'}}})}};
 controls=()=>{};rememberDraft=()=>{};replyWaiting=()=>{};loadMessages=async()=>{};loadHistory=async()=>{};
 run=action=>{globalThis.completed=action();};`,context);
 return {context,nodes,element,deep,requests,get requested(){return requested;},respond:(payload={saved:true,reply:'reply',remaining:4})=>finish({ok:true,json:async()=>payload}),fail:()=>finish({ok:false,json:async()=>({error:'応答を取得できませんでした'})})};
}

async function restoreSavedDraft(saved){
 const s=setup();s.context.sessionStorage.getItem=key=>key==='dragon-draft-user'?JSON.stringify(saved):null;
 vm.runInContext(`db.from=()=>({select(){return this;},eq(){return this;},is(){return this;},maybeSingle:async()=>({data:{id:'chat'}})});
 session=null;rememberDraft=originalRememberDraft;globalThis.restored=changeSession({user:{id:'user'}});`,s.context);
 await s.context.restored;return s;
}

test('guests can open AI settings while saved conversation controls stay hidden and inactive',async()=>{
 const s=setup();let opened=false;s.element('manageDialog').showModal=()=>{opened=true;};
 vm.runInContext('session=null;trialReady=true;originalControls();',s.context);
 assert.equal(s.element('manageChats').hidden,false);assert.equal(s.element('manageChats').disabled,false);
 assert.equal(s.element('managedSavedChats').hidden,true);assert.equal(s.element('manageGuestHint').hidden,false);assert.equal(s.element('manageExportPdf').disabled,true);
 s.element('manageChats').onclick();assert.equal(opened,true);
 vm.runInContext('exportConversationsPdf(true)',s.context);await s.context.completed;assert.equal(s.requested,undefined);
 vm.runInContext("session={user:{id:'user'}};originalControls();",s.context);assert.equal(s.element('managedSavedChats').hidden,false);assert.equal(s.element('manageGuestHint').hidden,true);
 opened=false;vm.runInContext('planBusy=true;originalControls();',s.context);s.element('manageChats').onclick();assert.equal(opened,false);assert.equal(s.element('manageChats').disabled,true);
});

test('a saved reply without a usage receipt stays provider-unknown and is labelled as cached',async()=>{
 const s=setup();s.element('messageInput').value='再送';
 vm.runInContext('submitMessage()',s.context);await new Promise(resolve=>setImmediate(resolve));
 const requestId=s.requested.body.requestId;
 s.respond({saved:true,reply:'保存されている返信',provider:null,model:null,replySource:'cached'});await s.context.completed;
 const receipt=vm.runInContext('usageCache',s.context).get(requestId);
 assert.equal(receipt.provider,null);assert.equal(receipt.model,null);assert.equal(s.context.DragonUsage.provider(receipt),'保存済みの返信');
});

for(const replySource of ['ai','fallback','cached'])test(`guest response metadata is attached only to a matching newly finished turn: source=${replySource}`,async()=>{
 const s=setup();s.element('messageInput').value='新しい相談';
 vm.runInContext(`session=null;trialReady=true;renderMessages=()=>{globalThis.didRender=true;};loadTrial=async()=>{rows=[{role:'user',content:'以前の相談'},{role:'assistant',content:'以前の回答'},{role:'user',content:'新しい相談'},{role:'assistant',content:'今回の回答'}];};submitMessage();`,s.context);
 await new Promise(resolve=>setImmediate(resolve));
 s.respond({reply:'今回の回答',remaining:3,provider:'openai',model:'gpt-5.4-mini-2026-03-17',replySource});await s.context.completed;
 const resultingRows=vm.runInContext('rows',s.context);
 assert.equal(resultingRows[1].usage,undefined);
 if(replySource==='cached'){assert.equal(resultingRows[3].usage,undefined);assert.equal(s.context.didRender,undefined);}
 else{assert.equal(resultingRows[3].usage.provider,'openai');assert.equal(resultingRows[3].usage.replySource,replySource);assert.equal(s.context.didRender,true);assert.match(s.context.DragonUsage.provider(resultingRows[3].usage),replySource==='fallback'?/定型の案内/:/OpenAI/);}
});

test('guest metadata does not label a mismatched history row or a changed session',async()=>{
 for(const changedSession of [false,true]){
  const s=setup();s.element('messageInput').value='相談';
  vm.runInContext(`session=null;trialReady=true;renderMessages=()=>{throw new Error('wrong history update');};loadTrial=async()=>{rows=[{role:'user',content:'別の相談'},{role:'assistant',content:'別の回答'}];${changedSession?'epoch++;':''}};submitMessage();`,s.context);
  await new Promise(resolve=>setImmediate(resolve));
  s.respond({reply:changedSession?'別の回答':'今回の回答',remaining:4,provider:'openai',replySource:'ai'});await s.context.completed;
  assert.equal(vm.runInContext('rows[1].usage',s.context),undefined);
 }
});

for(const guest of [false,true])test(`selected provider travels with the pending request and switching changes its identity: guest=${guest}`,async()=>{
 const s=setup();s.element('messageInput').value='短く話す';
 if(guest)vm.runInContext('session=null;trialReady=true;loadTrial=async()=>{};',s.context);
 vm.runInContext('submitMessage()',s.context);await new Promise(resolve=>setImmediate(resolve));
 const first=s.requested.body.requestId;assert.equal(s.requested.body.provider,'gemini');
 // A failed send retains the pending request and editable draft until the AI changes.
 s.fail();await assert.rejects(s.context.completed,/応答を取得できませんでした/);
 s.element('aiProvider').value='openai';s.element('aiProvider').listeners.change();
 assert.equal(vm.runInContext(guest?'trialPending':'pending',s.context),null);
 vm.runInContext('submitMessage()',s.context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.requested.body.provider,'openai');assert.notEqual(s.requested.body.requestId,first);
 s.respond();await s.context.completed;
});
test('activation uses an empty new message and leaves the unsent draft intact',async()=>{
 const s=setup();s.element('messageInput').value='未送信の下書き';
 vm.runInContext('submitMessage(true)',s.context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.requested.body.message,'');assert.equal(s.requested.body.modeStart,true);assert.equal(s.requested.body.selfReturn,true);
 s.respond();await s.context.completed;
 assert.equal(s.element('messageInput').value,'未送信の下書き');assert.equal(vm.runInContext('selfReturn',s.context),true);
});
test('normal mode turn maintains selection and clears only the sent draft',async()=>{
 const s=setup();s.element('messageInput').value='肩が重い';
 vm.runInContext('submitMessage()',s.context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.requested.body.message,'肩が重い');assert.equal(s.requested.body.selfReturn,true);
 s.respond();await s.context.completed;assert.equal(s.element('messageInput').value,'');assert.equal(vm.runInContext('selfReturn',s.context),true);
});
test('self-return keeps the composer available while a reply is pending',()=>{
 const s=setup();
 vm.runInContext('busy=true;originalControls();',s.context);
 assert.equal(s.element('messageInput').disabled,false);
 assert.equal(s.element('sendButton').disabled,true);
});
test('text entered while a self-return reply is pending remains as the next draft',async()=>{
 const s=setup();s.element('messageInput').value='肩が重い';
 vm.runInContext('submitMessage()',s.context);await new Promise(resolve=>setImmediate(resolve));
 s.element('messageInput').value='少し休んでみる';
 s.respond();await s.context.completed;
 assert.equal(s.element('messageInput').value,'少し休んでみる');
 assert.equal(vm.runInContext('selfReturn',s.context),true);
});
for(const change of ['leaveSelfReturn();','responseVersion++;','epoch++;'])test(`late response cannot overwrite new state after ${change}`,async()=>{
 const s=setup();s.element('messageInput').value='old';
 vm.runInContext('submitMessage()',s.context);await new Promise(resolve=>setImmediate(resolve));
 vm.runInContext(change,s.context);s.element('messageInput').value='new draft';
 s.respond();await s.context.completed;assert.equal(s.element('messageInput').value,'new draft');
});

test('opening deep exploration only opens theme selection and keeps the current mode and draft',()=>{
 const s=setup();s.element('messageInput').value='下書き';
 s.element('deepExploration').onclick();
 assert.equal(s.requests.length,0);assert.equal(s.deep.opens.length,1);assert.equal(s.deep.opens[0].hasContext,false);
 assert.equal(vm.runInContext('deepExploration',s.context),false);assert.equal(vm.runInContext('selfReturn',s.context),true);
 assert.equal(s.element('messageInput').value,'下書き');assert.equal(vm.runInContext('activeId',s.context),'chat');
 vm.runInContext("rows=[{role:'user',content:'直前の話'}];",s.context);s.element('deepExploration').onclick();
 assert.equal(s.deep.opens[1].hasContext,true);assert.equal(s.requests.length,0);
});

for(const guest of [false,true])test('deep theme selection starts exploration and exit keeps the conversation and draft: guest='+guest,async()=>{
 const s=setup();s.element('messageInput').value='下書き';
 if(guest)vm.runInContext('session=null;trialReady=true;loadTrial=async()=>{};',s.context);
 s.element('deepExploration').onclick();s.deep.handlers.onStart('人間関係');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.requested.url,guest?'/api/guest-chat':'/api/chat');
 if(!guest)assert.equal(s.requested.body.conversationId,'chat');
 assert.equal(s.requested.body.deepExploration,true);assert.equal(s.requested.body.deepTheme,'人間関係');assert.equal(s.requested.body.deepAction,undefined);
 assert.equal(s.requested.body.message,'');assert.equal(s.requested.body.selfReturn,false);assert.equal(s.requested.body.modeStart,true);
 s.respond();await s.context.completed;assert.equal(s.element('messageInput').value,'下書き');
 assert.equal(vm.runInContext('deepExploration',s.context),true);assert.equal(vm.runInContext('deepTheme',s.context),'人間関係');
 vm.runInContext('submitMessage()',s.context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.requested.body.deepTheme,'人間関係');assert.equal(s.requested.body.deepAction,undefined);assert.equal(s.requested.body.modeStart,false);assert.equal(s.requested.body.message,'下書き');
 s.respond();await s.context.completed;s.element('messageInput').value='次の下書き';
 const sent=s.requests.length;s.element('endDeepExploration').onclick();
 assert.equal(vm.runInContext('deepExploration',s.context),false);assert.equal(vm.runInContext('deepTheme',s.context),'');
 assert.equal(vm.runInContext('activeId',s.context),'chat');assert.equal(s.element('messageInput').value,'次の下書き');assert.equal(s.requests.length,sent);
});

test('selecting an existing mode clears deep exploration and its theme',()=>{
 for(const id of ['selfReturn','skyGazing','emotionFocus','blindSpot','returnPath','seikanMode','encouragement','patternExploration','directionExploration']){
 const s=setup();vm.runInContext("deepExploration=true;deepTheme='仕事';selfReturn=false;submitMessage=()=>{};",s.context);s.element(id).onclick();
 assert.equal(vm.runInContext('deepExploration',s.context),false,id);assert.equal(vm.runInContext('deepTheme',s.context),'',id);assert.equal(s.deep.closes,1,id);
 }
});

for(const guest of [false,true])test('failed deep activation retries the same theme with the same request identity: guest='+guest,async()=>{
 const s=setup();s.element('messageInput').value='まだ送らない';
 if(guest)vm.runInContext('session=null;trialReady=true;loadTrial=async()=>{};',s.context);
 s.deep.handlers.onStart('これから');await new Promise(resolve=>setImmediate(resolve));const first=s.requested.body.requestId;
 s.fail();await assert.rejects(s.context.completed,/応答を取得できませんでした/);
 assert.equal(s.element('messageInput').value,'まだ送らない');assert.equal(vm.runInContext('deepTheme',s.context),'これから');
 s.deep.handlers.onStart('これから');await new Promise(resolve=>setImmediate(resolve));assert.equal(s.requested.body.requestId,first);
 s.fail();await assert.rejects(s.context.completed,/応答を取得できませんでした/);
 s.deep.handlers.onStart('家族');await new Promise(resolve=>setImmediate(resolve));assert.notEqual(s.requested.body.requestId,first);assert.equal(s.requested.body.deepTheme,'家族');
 s.respond();await s.context.completed;assert.equal(s.element('messageInput').value,'まだ送らない');
});

for(const guest of [false,true])test('deep finish sends a separate control turn and preserves private composer material: guest='+guest,async()=>{
 const s=setup();s.element('messageInput').value='まだ送らない下書き';
 vm.runInContext("deepExploration=true;deepTheme='人間関係';selfReturn=false;selectedMemory={id:'memory',label:'選んだ記憶'};attachedPdf={id:'pdf',name:'draft.pdf',data:'private'};globalThis.getDragonMindMapContext=()=>{throw Error('control turn must not read the map')};",s.context);
 if(guest)vm.runInContext('session=null;trialReady=true;loadTrial=async()=>{};',s.context);
 s.deep.handlers.onFinish();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.requested.body.deepExploration,true);assert.equal(s.requested.body.deepTheme,'人間関係');assert.equal(s.requested.body.deepAction,'finish');assert.equal(s.requested.body.modeStart,false);
 assert.equal(s.requested.body.message,vm.runInContext('DEEP_FINISH_MESSAGE',s.context));assert.equal(s.requested.body.mindMap,null);assert.equal(s.requested.body.memoryId,undefined);assert.equal(s.requested.body.attachment,undefined);
 assert.equal(vm.runInContext('deepExploration',s.context),true);assert.equal(s.element('messageInput').value,'まだ送らない下書き');
 s.element('messageInput').value='待っている間に直した下書き';s.respond();await s.context.completed;
 assert.equal(vm.runInContext('deepExploration',s.context),false);assert.equal(vm.runInContext('deepTheme',s.context),'');assert.equal(vm.runInContext(guest?'trialPending':'pending',s.context),null);
 assert.equal(s.element('messageInput').value,'待っている間に直した下書き');assert.equal(vm.runInContext('selectedMemory.id',s.context),'memory');assert.equal(vm.runInContext('attachedPdf.id',s.context),'pdf');
 assert.match(s.element('status').textContent,/振り返りを会話に残しました/);assert.equal(s.deep.closes,1);
});

for(const guest of [false,true])test('failed deep finish retains the theme and retries its request without sending the draft: guest='+guest,async()=>{
 const s=setup();s.element('messageInput').value='下書き';vm.runInContext("deepExploration=true;deepTheme='仕事';selfReturn=false;",s.context);
 if(guest)vm.runInContext('session=null;trialReady=true;loadTrial=async()=>{};',s.context);
 s.deep.handlers.onFinish();await new Promise(resolve=>setImmediate(resolve));const first=s.requested.body.requestId;
 s.fail();await assert.rejects(s.context.completed,/応答を取得できませんでした/);
 assert.equal(vm.runInContext('deepExploration',s.context),true);assert.equal(vm.runInContext('deepTheme',s.context),'仕事');assert.equal(s.element('messageInput').value,'下書き');assert.equal(s.deep.closes,0);
 s.element('messageInput').value='修正した下書き';s.deep.handlers.onFinish();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.requested.body.requestId,first);assert.equal(s.requested.body.deepAction,'finish');assert.notEqual(s.requested.body.message,'修正した下書き');
 s.respond();await s.context.completed;assert.equal(vm.runInContext('deepExploration',s.context),false);assert.equal(s.element('messageInput').value,'修正した下書き');
});

for(const action of ['start','finish'])test('saved deep '+action+' restores the pending request identity after reload',async()=>{
 const s=setup();let saved;s.context.sessionStorage.setItem=(key,value)=>{saved=JSON.parse(value);};
 vm.runInContext("rememberDraft=originalRememberDraft;deepExploration=true;deepTheme='仕事';selfReturn=false;",s.context);s.element('messageInput').value='再読込しても送らない下書き';
 if(action==='start')s.deep.handlers.onStart('仕事');else s.deep.handlers.onFinish();
 await new Promise(resolve=>setImmediate(resolve));const first=s.requested.body.requestId;
 s.fail();await assert.rejects(s.context.completed,/応答を取得できませんでした/);
 assert.equal(saved.pending.requestId,first);assert.equal(saved.pending.mapKey,'null');assert.equal(saved.deepTheme,'仕事');
 const restored=await restoreSavedDraft(saved);
 assert.equal(vm.runInContext('activeId',restored.context),'chat');assert.equal(vm.runInContext('deepTheme',restored.context),'仕事');assert.equal(restored.element('messageInput').value,'再読込しても送らない下書き');
 if(action==='start')restored.deep.handlers.onStart('仕事');else restored.deep.handlers.onFinish();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(restored.requested.body.requestId,first);assert.equal(restored.requested.body.deepTheme,'仕事');assert.equal(restored.requested.body.modeStart,action==='start');assert.equal(restored.requested.body.deepAction,action==='finish'?'finish':undefined);
 restored.respond();await restored.context.completed;assert.equal(restored.element('messageInput').value,'再読込しても送らない下書き');
});

test('legacy activation draft without map or deep fields retries its existing request after reload',async()=>{
 const s=setup();let saved;s.context.sessionStorage.setItem=(key,value)=>{saved=JSON.parse(value);};s.element('messageInput').value='以前の下書き';
 vm.runInContext('rememberDraft=originalRememberDraft;submitMessage(true);',s.context);await new Promise(resolve=>setImmediate(resolve));const first=s.requested.body.requestId;
 s.fail();await assert.rejects(s.context.completed,/応答を取得できませんでした/);
 delete saved.pending.mapKey;delete saved.pending.deepTheme;delete saved.pending.deepAction;delete saved.deepTheme;
 const restored=await restoreSavedDraft(saved);vm.runInContext('submitMessage(true)',restored.context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(restored.requested.body.requestId,first);assert.equal(restored.requested.body.selfReturn,true);assert.equal(restored.requested.body.modeStart,true);
 restored.respond();await restored.context.completed;assert.equal(restored.element('messageInput').value,'以前の下書き');
});

test('guest finish remains completed when refreshing its saved history fails',async()=>{
 const s=setup();s.element('messageInput').value='まだ送らない下書き';
 vm.runInContext("session=null;trialReady=true;deepExploration=true;deepTheme='仕事';selfReturn=false;loadTrial=async()=>{throw Error('history unavailable');};",s.context);
 s.deep.handlers.onFinish();await new Promise(resolve=>setImmediate(resolve));s.respond({saved:true,reply:'今回の振り返り',remaining:3});
 await assert.rejects(s.context.completed,/振り返りは保存され、自己探索を終了しました/);
 assert.equal(vm.runInContext('deepExploration',s.context),false);assert.equal(vm.runInContext('deepTheme',s.context),'');assert.equal(vm.runInContext('trialPending',s.context),null);assert.equal(vm.runInContext('trialRemaining',s.context),3);
 assert.equal(s.element('messageInput').value,'まだ送らない下書き');assert.equal(s.deep.closes,1);
 s.deep.handlers.onFinish();await new Promise(resolve=>setImmediate(resolve));assert.equal(s.requests.length,1);
});

test('deep feedback is editable composer text and never sends automatically',()=>{
 const s=setup();vm.runInContext("deepExploration=true;deepTheme='家族';selfReturn=false;",s.context);
 s.deep.handlers.onFeedback('少し近いです。');assert.equal(s.element('messageInput').value,'少し近いです。');assert.equal(s.requests.length,0);
 s.element('messageInput').value='自分の言葉';s.deep.handlers.onFeedback('まだ分かりません。');
 assert.equal(s.element('messageInput').value,'自分の言葉\nまだ分かりません。');assert.equal(s.requests.length,0);
 s.element('messageInput').value='長'.repeat(4000);s.deep.handlers.onFeedback('違います。');assert.equal(s.element('messageInput').value.length,4000);assert.match(s.element('status').textContent,/いっぱい/);
 for(const state of ['busy=true;','busy=false;input.disabled=true;','input.disabled=false;deepExploration=false;']){
  s.element('messageInput').value='保持';vm.runInContext(state,s.context);s.deep.handlers.onFeedback('追加');assert.equal(s.element('messageInput').value,'保持');
 }
 assert.equal(s.requests.length,0);
});

test('deep feedback controls follow only the latest feeling-check reply',()=>{
 const s=setup();vm.runInContext("deepExploration=true;deepTheme='仕事';selfReturn=false;rows=[{role:'assistant',content:'気持ちを確かめる\\nまだ仮の見方です。'}];originalControls();",s.context);
 assert.equal(s.deep.updates.at(-1).active,true);assert.equal(s.deep.updates.at(-1).theme,'仕事');assert.equal(s.deep.updates.at(-1).feedback,true);
 vm.runInContext("rows.push({role:'user',content:'違います'});originalControls();",s.context);assert.equal(s.deep.updates.at(-1).feedback,false);
 vm.runInContext("rows.push({role:'assistant',content:'場面をたどる\\nそのときのことを教えてください。'});originalControls();",s.context);assert.equal(s.deep.updates.at(-1).feedback,false);
});

test('deep theme and draft survive serialization and ordinary exit clears only the mode state',()=>{
 const s=setup();let saved;s.context.sessionStorage.setItem=(key,value)=>{saved=JSON.parse(value);};s.element('messageInput').value='未送信の文章';
 vm.runInContext("deepExploration=true;deepTheme='これから';selfReturn=false;",s.context);
 vm.runInContext('rememberDraft=originalRememberDraft;rememberDraft();',s.context);
 assert.equal(saved.deepExploration,true);assert.equal(saved.deepTheme,'これから');assert.equal(saved.text,'未送信の文章');
 s.element('endDeepExploration').onclick();assert.equal(saved.deepExploration,false);assert.equal(saved.deepTheme,'');assert.equal(saved.text,'未送信の文章');
});

test('new conversation and existing conversation selection clear the deep theme',async()=>{
 for(const target of ['new','history']){
  const s=setup();vm.runInContext("deepExploration=true;deepTheme='家族';selfReturn=false;",s.context);
  if(target==='new')s.element('newChat').onclick();
  else{vm.runInContext("chats=[{id:'other',title:'別の会話'}];renderHistory();",s.context);s.element('history').children[0].onclick();await s.context.completed;}
  assert.equal(vm.runInContext('deepExploration',s.context),false,target);assert.equal(vm.runInContext('deepTheme',s.context),'',target);assert.equal(s.deep.closes,1,target);
  assert.equal(vm.runInContext('activeId',s.context),target==='new'?null:'other');assert.equal(s.requests.length,0);
 }
});

test('new conversation immediately refreshes deep controls with no active mode or conversation context',()=>{
 const s=setup();vm.runInContext("controls=originalControls;deepExploration=true;deepTheme='家族';selfReturn=false;rows=[{role:'user',content:'家族の話'}];controls();",s.context);
 assert.equal(s.deep.updates.at(-1).active,true);assert.equal(s.deep.updates.at(-1).hasContext,true);
 s.element('newChat').onclick();const state=s.deep.updates.at(-1);
 assert.equal(state.active,false);assert.equal(state.theme,'');assert.equal(state.hasContext,false);assert.equal(s.element('deepExplorationState').hidden,true);assert.equal(s.requests.length,0);
});

test('changing account clears the deep theme and closes its dialog',async()=>{
 const s=setup();vm.runInContext("deepExploration=true;deepTheme='家族';selfReturn=false;loadTrial=async()=>{};globalThis.sessionChanged=changeSession(null);",s.context);await s.context.sessionChanged;
 assert.equal(vm.runInContext('deepExploration',s.context),false);assert.equal(vm.runInContext('deepTheme',s.context),'');assert.equal(s.deep.closes,1);assert.equal(s.requests.length,0);
});

test('guest can leave deep exploration after quota runs out without a request or login dialog',()=>{
 const s=setup();let loginOpened=false;s.element('authDialog').showModal=()=>{loginOpened=true;};s.element('messageInput').value='残しておく';
 vm.runInContext("session=null;trialReady=true;trialRemaining=0;deepExploration=true;deepTheme='仕事';selfReturn=false;originalControls();",s.context);
 assert.equal(s.deep.updates.at(-1).canSend,false);assert.equal(s.element('endDeepExploration').disabled,false);
 s.element('endDeepExploration').onclick();assert.equal(vm.runInContext('deepExploration',s.context),false);assert.equal(vm.runInContext('deepTheme',s.context),'');
 assert.equal(s.element('messageInput').value,'残しておく');assert.equal(s.requests.length,0);assert.equal(loginOpened,false);
});

test('pattern activation and exit preserve conversation, selected memory and draft',async()=>{
 const s=setup();s.element('messageInput').value='未送信';vm.runInContext("selectedMemory={id:'memory'}",s.context);
 s.element('patternExploration').onclick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.requested.body.patternExploration,true);assert.equal(s.requested.body.deepExploration,false);assert.equal(s.requested.body.selfReturn,false);assert.equal(s.requested.body.message,'');assert.equal(s.requested.body.conversationId,'chat');assert.equal(s.requested.body.memoryId,undefined);
 s.respond();await s.context.completed;assert.equal(s.element('messageInput').value,'未送信');assert.equal(vm.runInContext('selectedMemory.id',s.context),'memory');
 s.element('endDeepExploration').onclick();assert.equal(vm.runInContext('patternExploration',s.context),false);assert.equal(vm.runInContext('activeId',s.context),'chat');
});
test('other modes exit pattern and mode label reflects selection',()=>{
 for(const id of ['deepExploration','selfReturn','skyGazing','emotionFocus','blindSpot','returnPath','seikanMode']){
 const s=setup();vm.runInContext('patternExploration=true;selfReturn=false;originalControls();submitMessage=()=>{};',s.context);
 assert.equal(s.element('deepExplorationLabel').textContent,'自己探索 ＞ パターンを見る');
 s.element(id).onclick();if(id==='deepExploration')s.deep.handlers.onStart('人間関係');assert.equal(vm.runInContext('patternExploration',s.context),false);
 }
});

test('client sends map snapshot only on ordinary sends and refreshes retry id when map changes',async()=>{
 const s=setup();vm.runInContext("selfReturn=false;globalThis.getDragonMindMapContext=()=>({version:1,id:'map',fields:{event:'first'}})",s.context);
 s.element('messageInput').value='これ';vm.runInContext('submitMessage()',s.context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.requested.body.mindMap.fields.event,'first');const firstId=s.requested.body.requestId;
 vm.runInContext("globalThis.getDragonMindMapContext=()=>null",s.context);s.respond();await s.context.completed;
 s.element('messageInput').value='これ';vm.runInContext('submitMessage()',s.context);await new Promise(resolve=>setImmediate(resolve));assert.equal(s.requested.body.mindMap,null);assert.notEqual(s.requested.body.requestId,firstId);s.respond();await s.context.completed;
 vm.runInContext("globalThis.getDragonMindMapContext=()=>{throw Error('must not read map')};patternExploration=true;",s.context);
 vm.runInContext('submitMessage(true)',s.context);await new Promise(resolve=>setImmediate(resolve));assert.equal(s.requested.body.mindMap,null);s.respond();await s.context.completed;
});

test('direction activation and exit preserve conversation, selected memory and draft',async()=>{
 const s=setup();s.element('messageInput').value='未送信';vm.runInContext("selectedMemory={id:'memory'}",s.context);
 s.element('directionExploration').onclick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.requested.body.directionExploration,true);assert.equal(s.requested.body.deepExploration,false);assert.equal(s.requested.body.selfReturn,false);assert.equal(s.requested.body.message,'');assert.equal(s.requested.body.conversationId,'chat');assert.equal(s.requested.body.memoryId,undefined);
 s.respond();await s.context.completed;assert.equal(s.element('messageInput').value,'未送信');assert.equal(vm.runInContext('selectedMemory.id',s.context),'memory');
 s.element('endDeepExploration').onclick();assert.equal(vm.runInContext('directionExploration',s.context),false);assert.equal(vm.runInContext('activeId',s.context),'chat');
});
test('other modes exit direction and mode label reflects selection',()=>{
 for(const id of ['patternExploration','deepExploration','selfReturn','skyGazing','emotionFocus','blindSpot','returnPath','seikanMode']){
 const s=setup();vm.runInContext('directionExploration=true;selfReturn=false;originalControls();submitMessage=()=>{};',s.context);
 assert.equal(s.element('deepExplorationLabel').textContent,'自己探索 ＞ 方角を見る');
 s.element(id).onclick();if(id==='deepExploration')s.deep.handlers.onStart('人間関係');assert.equal(vm.runInContext('directionExploration',s.context),false);
 }
});


test('direction guest activation uses the existing guest endpoint and preserves draft',async()=>{
 const s=setup();vm.runInContext('session=null;trialReady=true;trialRemaining=5;selfReturn=false;loadTrial=async()=>{};',s.context);s.element('messageInput').value='まだ送らない';
 s.element('directionExploration').onclick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.requested.url,'/api/guest-chat');assert.equal(s.requested.body.directionExploration,true);assert.equal(s.requested.body.message,'');assert.equal(s.requested.body.modeStart,true);
 s.respond();await s.context.completed;assert.equal(s.element('messageInput').value,'まだ送らない');
});
test('direction survives draft serialization and switching to pattern clears it',()=>{
 const s=setup();let saved;s.context.sessionStorage.setItem=(key,value)=>{saved=JSON.parse(value);};
 vm.runInContext("directionExploration=true;selfReturn=false;submitMessage=()=>{};",s.context);
 vm.runInContext('rememberDraft=originalRememberDraft;rememberDraft();',s.context);assert.equal(saved.directionExploration,true);
 s.element('patternExploration').onclick();assert.equal(vm.runInContext('directionExploration',s.context),false);assert.equal(saved.directionExploration,false);assert.equal(saved.patternExploration,true);
});

for(const guest of [false,true])test('direction reselect reviews same conversation without toggling off: guest='+guest,async()=>{
 const s=setup();if(guest)vm.runInContext('session=null;trialReady=true;trialRemaining=5;loadTrial=async()=>{};',s.context);
 s.element('messageInput').value='未送信の言葉';
 s.element('directionExploration').onclick();await new Promise(resolve=>setImmediate(resolve));const first=s.requested.body.requestId;
 s.respond();await s.context.completed;
 s.element('directionExploration').onclick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.requested.body.directionExploration,true);assert.equal(s.requested.body.modeStart,true);assert.equal(s.requested.body.message,'');assert.notEqual(s.requested.body.requestId,first);
 if(!guest)assert.equal(s.requested.body.conversationId,'chat');
 s.respond();await s.context.completed;assert.equal(s.element('messageInput').value,'未送信の言葉');
 s.element('endDeepExploration').onclick();assert.equal(vm.runInContext('directionExploration',s.context),false);
});
