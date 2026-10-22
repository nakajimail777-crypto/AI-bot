import {steps,groups,labels,createExperiment,validateExperiment,repeatExperiment,importReflection,consultationText} from './reaction-lab-model.js';
import {createLabStorage,labError} from './reaction-lab-storage.js';

if(typeof document!=='undefined'&&document.getElementById('openReactionLab'))mount();
function mount(){
 const entry=document.getElementById('openReactionLab');
 const node=(tag,text='',attrs={})=>{const e=document.createElement(tag);e.textContent=text;for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
 const button=(text,action)=>{const b=node('button',text,{type:'button'});b.addEventListener('click',action);return b;};
 const actions=(...buttons)=>{const group=node('div','',{class:'rl-actions'});group.append(...buttons);return group;};
 const dialog=node('dialog','',{class:'rl-dialog','aria-labelledby':'rl-title'});
 const content=node('div','',{class:'rl-content'}),live=node('p','',{role:'status','aria-live':'polite',tabindex:'-1',class:'rl-live'});
 const confirm=node('dialog','',{class:'rl-dialog rl-confirm','aria-labelledby':'rl-confirm-title'});
 dialog.append(content,live);document.body.append(dialog,confirm);
 let data=createExperiment(),revision=null,saved=null,savedAt=null,screen='home',origin=entry;
 let context={db:null,userId:null,generation:0},busy=false,controller=null,listToken=0,offset=0;
 let conversation=null,pending=null,consultText='',answer='',importData=null;
 const storage=createLabStorage(()=>context);
 const fingerprint=()=>JSON.stringify(data);
 const hasInput=()=>Object.values(data.fields).some(Boolean)||data.step>0||data.choice!=='undecided'||data.attempt!=='not_yet';
 const dirty=()=>saved!==fingerprint()&&hasInput();
 function announce(message){live.textContent=message;live.focus();}
 function sync(){
  const next=globalThis.getDragonReflectionContext?.()||{db:null,userId:null};
  if(next.userId!==context.userId){
   const previous=context.userId;context={...next,generation:context.generation+1};listToken++;
   if(previous){controller?.abort();busy=false;reset();importData=null;consultText='';answer='';if(confirm.open)confirm.close();if(dialog.open){screen='home';render();announce('ログアウトまたは利用者の変更により、前の入力を消去しました。');}}
  }else context={...context,...next};
 }
 document.addEventListener('dragon-reflection-session',sync);sync();
 function reset(next=createExperiment()){data=next;revision=null;saved=null;savedAt=null;conversation=null;pending=null;answer='';consultText='';}
 function show(next){if(busy)return;screen=next;render();}
 function open(){origin=document.activeElement;dialog.showModal();show('home');}
 entry.addEventListener('click',open);
 function close(){
  if(busy)return;if(confirm.open)confirm.close();dialog.close();
  if(origin?.isConnected&&origin.getClientRects().length)origin.focus();
  else {for(let parent=entry.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;entry.focus();}
 }
 function ask(title,description,choices){
  const previous=document.activeElement;
  confirm.replaceChildren(node('h2',title,{id:'rl-confirm-title',tabindex:'-1'}),node('p',description),actions(...choices.map(([title,action])=>button(title,()=>{confirm.close();action();})),button('キャンセル',()=>{confirm.close();previous?.focus();})));
  confirm.showModal();confirm.querySelector('h2').focus();
 }
 confirm.addEventListener('cancel',()=>{queueMicrotask(()=>content.querySelector('h2')?.focus());});
 function exit(later=false){
  if(screen==='import'){
   ask('引き継ぎをやめますか？','確認中の内容は実験記録に保存されません。元の振り返りは変更しません。',[
    ['引き継ぎをやめる',()=>{importData=null;show('home');}]
   ]);return;
  }
  if(busy&&controller){controller.abort();controller=null;context={...context,generation:context.generation+1};busy=false;render();}
  if(busy){announce('操作中です。完了してから終了できます。');return;}
  ask(later?'あとで続けるために保存しますか？':'ここまでの内容を保存しますか？',
   '保存しない場合、今回の入力や変更は閉じると失われます。以前保存した実験記録は残ります。AIとの会話履歴と長期記憶は別に扱われます。途中で終えても問題ありません。',[
    ['保存して閉じる',async()=>{if(!later)data.status=data.attempt==='skipped'?'skipped':'finished';if(await save()){reset();close();}}],
    ['今回の入力を保存せず閉じる',()=>{reset();close();}]
   ]);
 }
 dialog.addEventListener('cancel',event=>{event.preventDefault();exit();});
 window.addEventListener('beforeunload',event=>{if(dirty()||busy||importData){event.preventDefault();event.returnValue='';}});
 function replace(action){
  if(!dirty()){action();return;}
  ask('現在の入力をどうしますか？','別の記録を開く前に、現在の入力を保存できます。保存しない変更は失われます。',[
   ['保存して進む',async()=>{if(await save())action();}],['今回の変更を保存せず進む',action]
  ]);
 }
 function valid(){try{validateExperiment(data);return true;}catch{announce('入力は各項目2,000文字以内にしてください。長い文章はそのまま残しているので、短くしてから進んでください。');return false;}}
 function field(key,title,target=data.fields){
  const box=node('div','',{class:'rl-field'}),id=`rl-${key}`;
  const label=node('label',title+'（任意）',{for:id});
  const area=node('textarea','',{id,rows:'3','aria-describedby':`${id}-count`});area.value=target[key];
  const count=node('p','',{id:`${id}-count`,class:'rl-count'});
  function update(){target[key]=area.value;const length=Array.from(area.value).length;count.textContent=`${length} / 2,000文字${length>2000?'：文章を短くしてください。':''}`;area.setAttribute('aria-invalid',String(length>2000));}
  area.addEventListener('input',update);update();box.append(label,area,count);return box;
 }
 function choices(title,key,values){
  const group=node('fieldset');group.append(node('legend',title));
  for(const [value,text]of values){const label=node('label','',{class:'rl-choice'}),input=node('input','',{type:'radio',name:'rl-'+key,value});input.checked=data[key]===value;input.addEventListener('change',()=>{data[key]=value;});label.append(input,document.createTextNode(text));group.append(label);}return group;
 }
 function heading(title,description){content.replaceChildren(node('h2',title,{id:'rl-title',tabindex:'-1'}));if(description)content.append(node('p',description));live.textContent='';}
 function render(){
  listToken++;
  if(screen==='home'){
   heading('反応の実験室','感情はそのままでいい。次の行動は、小さく選び直せることがあります。選べなかったときも、自分を責める必要はありません。');
   content.append(node('p','5ステップすべてを進めなくても大丈夫です。AIを使わず、自分の言葉だけでも進められます。'));
   if(!context.userId)content.append(node('p','ログインせずに記入・振り返りができます。保存・再開・AI相談を使いたい場合は、書き始める前に通常画面からログインしてください。',{class:'rl-note'}));
   content.append(actions(button(hasInput()?'画面に残っている入力を続ける':'新しく始める',()=>show('card')),button('保存した実験を開く',()=>{offset=0;show('list');}),button('入力を新しくする',()=>replace(()=>{reset();show('card');})),button('閉じる',()=>exit())));
  }else if(screen==='card'){
   heading(`${data.step+1} / 5　${steps[data.step]}`,'空欄のまま進めます。もう十分と思ったら、ここで終えても大丈夫です。');
   if(data.step===2)content.append(choices('今回はどうしたいですか？','choice',[['undecided','まだ決めない'],['try','別の反応を試してみたい'],['keep','今の反応を変えずに観察する']]));
   if(data.step===4)content.append(choices('実験について','attempt',[['not_yet','まだ試していない'],['tried','試してみた'],['skipped','今回は見送った']]));
   for(const [key,title]of groups[data.step])content.append(field(key,title));
   if(data.step===2)content.append(node('p','今の反応を変えない場合、次の反応の欄は空欄でも大丈夫です。'));
   if(data.step===3)content.append(actions(button('あとで試す',()=>{data.status='planned';exit(true);}),button('今回は見送る',()=>{data.attempt='skipped';data.status='skipped';show('result');})));
   content.append(actions(button(data.step?'戻る':'入口へ',()=>{if(data.step){data.step--;show('card');}else show('home');}),button(data.step===4?'前後を見比べる':'次へ',()=>{if(!valid())return;if(data.step===4)show('result');else {data.step++;show('card');}})));
   content.append(actions(button('スピリットドラゴンに相談する',()=>{consultText=consultationText(data);answer='';show('consult');}),button('あとで続ける',()=>exit(true)),button('ここまでで終える',()=>exit())));
  }else if(screen==='result'){
   heading('試す前と、試した後','変化がなくても、まだ試していなくても大丈夫です。ここにあるのは、あなたが書いた言葉です。');
   const grid=node('div','',{class:'rl-comparison'});
   for(const [title,items]of [['試す前',[['いつもの反応',data.fields.usualReaction],['今回選んだ反応',data.choice==='keep'?'今の反応を変えずに観察する':data.fields.chosenReaction]]],['試した後',[['実際の反応',data.fields.actualReaction],['感じたこと',data.fields.afterFeelings],['新しく気づいたこと',data.fields.insight],['予想との違い',data.fields.difference]]]]){
    const section=node('section');section.append(node('h3',title));for(const [label,value]of items)section.append(node('h4',label),node('p',value||'未入力',{class:'rl-verbatim'}));grid.append(section);
   }
   content.append(node('p',data.attempt==='not_yet'?'まだ試していません。':data.attempt==='skipped'?'今回は見送っています。':'試した内容を振り返っています。'),grid);
   content.append(actions(button('記録を保存する',()=>{data.status=data.attempt==='skipped'?'skipped':'finished';save();}),button('内容を編集する',()=>show('card')),button('もう一度試す',()=>repeat(false)),button('少し変えて試す',()=>repeat(true)),button('ここで終える',()=>exit())));
  }else if(screen==='list')renderList();
  else if(screen==='consult')renderConsult();
  else if(screen==='import')renderImport();
  if(['list','consult','import'].includes(screen))content.append(button('ここまでで終える',()=>exit()));
  if(screen!=='import')content.append(node('p',saved===fingerprint()?`保存済み：${new Date(savedAt).toLocaleString()}`:'保存の操作をするまで、この入力は実験記録に残りません。',{class:'rl-note'}));
  if(revision&&['card','result'].includes(screen))content.append(button('この保存済み実験を削除する',()=>remove(data.id,revision)));
  content.querySelector('h2')?.focus();dialog.scrollTop=0;
 }
 function repeat(edit){replace(()=>{const next=repeatExperiment(data,edit);reset(next);show('card');announce('新しい実験を作りました。元の保存済み記録は変更しません。新しい実験はまだ保存していません。');});}
 async function operation(task){
  if(busy)return false;busy=true;const generation=context.generation;
  content.querySelectorAll('button,input,textarea').forEach(e=>e.disabled=true);announce('操作中です…');
  try{await task(generation);return generation===context.generation;}
  catch(error){if(generation===context.generation){busy=false;render();announce(labError(error));}return false;}
  finally{if(generation===context.generation){busy=false;}}
 }
 async function save(){
  if(!valid())return false;
  const payload=validateExperiment(data);
  return operation(async generation=>{
   const receipt=await storage.save(payload,revision);if(generation!==context.generation)return;
   if(receipt?.id!==payload.id||!receipt.revision||!Number.isFinite(Date.parse(receipt.saved_at)))throw new Error('INVALID_RECORD');
   revision=receipt.revision;saved=JSON.stringify(payload);savedAt=receipt.saved_at;busy=false;render();announce('実験記録を保存しました。長期記憶には登録していません。');
  });
 }
 function renderList(){
  heading('保存した実験','一覧では本文を表示しません。開いた記録だけを読み込めます。');
  const list=node('div');content.append(list,button('入口に戻る',()=>show('home')));const token=listToken;
  storage.list(offset).then(rows=>{
   if(token!==listToken||screen!=='list')return;
   if(!Array.isArray(rows))throw new Error('INVALID_RECORD');
   for(const row of rows){const item=validateExperiment(row.payload);const box=node('section','',{class:'rl-list-item'});
    box.append(node('p',`${new Date(row.saved_at).toLocaleString()} · ${steps[item.step]} · ${{draft:'途中',planned:'試す予定',finished:'ここまでで終了',skipped:'見送り'}[item.status]}`),actions(button('この実験を開く',()=>replace(()=>load(row.id))),button('削除する',()=>remove(row.id,row.revision))));list.append(box);}
   if(offset)list.append(button('前の20件',()=>{offset-=20;show('list');}));
   if(rows.length===20)list.append(button('次の20件',()=>{offset+=20;show('list');}));
   live.textContent=rows.length?`${rows.length}件を表示しました。`:'保存した実験はありません。';
  }).catch(error=>{if(token!==listToken||screen!=='list')return;live.textContent=labError(error);list.append(button('再試行する',()=>show('list')));});
 }
 async function load(id){return operation(async generation=>{
  const row=await storage.get(id);if(generation!==context.generation)return;
  if(!row||row.id!==id)throw new Error('INVALID_RECORD');reset(validateExperiment(row.payload));revision=row.revision;savedAt=row.saved_at;saved=fingerprint();busy=false;show(data.status==='finished'||data.status==='skipped'?'result':'card');
 });}
 function remove(id,rev){ask('この実験記録を削除しますか？','この削除は取り消せません。実験記録だけを削除します。AIとの会話履歴・長期記憶・元の振り返りは残ります。現在開いている同じ実験の未保存入力も消去します。',[
  ['実験記録を削除する',()=>operation(async generation=>{await storage.remove(id,rev);if(generation!==context.generation)return;if(data.id===id)reset();busy=false;offset=0;show('list');announce('実験記録を削除しました。会話履歴と長期記憶は変更していません。');})]
 ]);}
 function renderConsult(){
  heading('スピリットドラゴンに相談する','送信する内容を確認・編集してください。相談しなくても実験を進められます。');
  content.append(node('p','送信した内容と返答は通常の会話履歴に保存されます。実験記録・長期記憶への自動登録はしません。返答待ちをやめても、送信済みの相談は会話履歴に残る場合があります。既存の会話モード・添付・選択中の記憶は、この相談には引き継ぎません。',{class:'rl-note'}));
  const area=node('textarea','',{id:'rl-consult-text',rows:'7','aria-describedby':'rl-consult-count'});area.value=consultText;
  const count=node('p','',{id:'rl-consult-count'});
  const update=()=>{consultText=area.value;count.textContent=`${consultText.length} / 3,900文字。長い場合は送る部分を選んでください。元の記録は変更しません。`;};area.addEventListener('input',update);update();
  content.append(node('label','相談に送る文章',{for:'rl-consult-text'}),area,count);
  const buttons=[button('この内容を相談する',()=>consult(false))];if(data.step===2)buttons.push(button('候補を最大3つ相談する',()=>consult(true)));
  content.append(actions(...buttons,button('相談せず戻る',()=>show('card'))));
  if(answer){content.append(node('h3','スピリットドラゴンの返答'),node('p',answer,{class:'rl-verbatim'}),node('p','この返答は実験記録に反映していません。使いたい部分があれば、戻って自分の言葉で記入できます。'),button('戻って自分の言葉で記入する',()=>show('card')));}
 }
 async function consult(candidates){
  if(!consultText.trim()||consultText.length>3900){announce('相談する文章を1〜3,900文字にしてください。元の記録は変更しません。');return;}
  const text=consultText.trim(),step=data.step,key=JSON.stringify({text,step,candidates});
  const consultationGeneration=context.generation;
  controller=new AbortController();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(85000)]);
  await operation(async generation=>{
   content.append(button('返答を待つのをやめて終了する',()=>exit()));
   const ctx=await storage.authorized();if(generation!==context.generation)return;
   if(!conversation)conversation=crypto.randomUUID();
   const created=await ctx.db.from('conversations').upsert({id:conversation,user_id:ctx.userId,title:'反応の実験室の相談'},{onConflict:'id',ignoreDuplicates:true}).abortSignal(signal);
   if(created.error)throw created.error;if(generation!==context.generation)return;
   const auth=await ctx.db.auth.getSession();if(auth.error||!auth.data?.session)throw new Error('AUTH_REQUIRED');if(generation!==context.generation)return;
   if(!pending||pending.key!==key)pending={key,id:crypto.randomUUID()};
   const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth.data.session.access_token}`},body:JSON.stringify({message:text,conversationId:conversation,requestId:pending.id,reactionLab:{step,candidates}}),signal});
   const result=await response.json();if(generation!==context.generation)return;
   if(!response.ok){busy=false;render();announce(result.error||'相談できませんでした。文章は保持しています。');return;}
   if(typeof result.reply!=='string')throw new Error('INVALID_RECORD');answer=result.reply;pending=null;busy=false;render();announce('返答を表示しました。実験記録への反映はしていません。');
  });
  if(consultationGeneration===context.generation)controller=null;
 }
 function renderImport(){
  heading('振り返りから引き継ぐ内容','この内容を確認・編集してから実験室に引き継ぎます。スキップした項目は含めません。元の振り返りは変更しません。');
  for(const [key,title]of groups[0])content.append(field(key,title,importData.fields));
  content.append(actions(button('この内容で始める',()=>{try{validateExperiment(importData);}catch{announce('各項目2,000文字以内に編集してください。元の内容は変更しません。');return;}replace(()=>{reset(importData);importData=null;show('card');});}),button('引き継がず戻る',()=>{importData=null;show('home');})));
 }
 globalThis.openReactionLabFromReflection=source=>{
  if(busy)return;
  origin=entry;importData=importReflection(source);if(!dialog.open)dialog.showModal();show('import');
 };
}
