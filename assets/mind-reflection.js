// Explicit user-owned storage; reflection contents are not sent to AI automatically.
import {createStorage,storageMessage} from './mind-reflection-storage.js';
export const feelings = ['不安','うれしい','いらだち','悲しさ','安心','戸惑い','特にわからない'];
export const afterglows = ['まだ気になっている','少し落ち着いた','別の見方もできそう','よくわからない','特に残っていない'];
export const fields = [
  {id:'event',title:'出来事',description:'何がありましたか？ 事実として思い出せる範囲で書いてください。',placeholder:'例：仕事の連絡にすぐ返信がありませんでした'},
  {id:'feeling',title:'感じたこと',description:'そのとき、どのような気持ちや身体感覚がありましたか？ 複数選んでも、言葉にできなくてもかまいません。',options:feelings},
  {id:'interpretation',title:'受け取り方',description:'その出来事を、自分はどのように受け取りましたか？',placeholder:'例：自分は後回しにされているのかもしれないと思った'},
  {id:'reaction',title:'反応',description:'そのあと、どのような行動や考えが起こりましたか？',placeholder:'例：何度も通知を確認した／すぐに別の作業を始めた'},
  {id:'afterglow',title:'振り返って感じること',description:'その出来事を思い返すと、どんな気持ちや身体の感覚がありますか？',options:afterglows}
];
export const countText = value => Array.from(value).length;
export function createReflection(id = globalThis.crypto.randomUUID()) {
  return {id,version:1,fields:Object.fromEntries(fields.map(f=>[f.id,{value:f.id==='feeling'?[]:'',skipped:false,...(f.id==='feeling'?{note:''}:{})}])),resultViewedAt:null};
}
export function selectFeeling(current, value, checked) {
  if(!feelings.includes(value)) return current;
  if(!checked) return current.filter(v=>v!==value);
  if(value==='特にわからない') return [value];
  return [...new Set([...current.filter(v=>v!=='特にわからない'),value])];
}
export function displayValue(item) {
  if(item.skipped) return 'スキップ';
  const value=Array.isArray(item.value)?[item.value.join('、'),item.note||''].filter(text=>text.trim()).join('\n'):item.value;
  return value.trim() ? value : '回答なし';
}
export function reflectionMessage(reflection) {
  return '心の動きを振り返りました。この内容をもとに、一緒に話したいです。\n\n'+fields.map(f=>`${f.title}\n${displayValue(reflection.fields[f.id])}`).join('\n\n');
}
export function combineMessage(draft, reflectionText) {
  if(!draft) return reflectionText;
  if(draft===reflectionText || draft.endsWith('\n\n'+reflectionText)) return draft;
  return draft+'\n\n'+reflectionText;
}
export function validate(reflection) {
  return fields.flatMap(f=>{
    const item=reflection.fields[f.id];
    if(item.skipped) return [];
    if(!f.options) return typeof item.value!=='string'||countText(item.value)>2000 ? [{id:f.id,message:'2,000文字以内にしてください。'}]:[];
    if(f.id==='feeling'&&(typeof (item.note??'')!=='string'||countText(item.note||'')>2000)) return [{id:f.id,message:'自由入力は2,000文字以内にしてください。'}];
    if(f.id==='feeling') return !Array.isArray(item.value)||item.value.some(v=>!feelings.includes(v))||(item.value.includes('特にわからない')&&item.value.length>1) ? [{id:f.id,message:'「特にわからない」は他の気持ちと同時に選べません。選び直してください。'}]:[];
    return item.value!==''&&!afterglows.includes(item.value)?[{id:f.id,message:'選択肢から選び直すか、選択を解除してください。'}]:[];
  });
}
export function restoreReflection(payload) {
  if(!payload||payload.version!==1||!/^[0-9a-f-]{36}$/i.test(payload.id||'')) throw Object.assign(new Error('INVALID_RECORD'),{code:'INVALID_RECORD'});
  const clean=createReflection(payload.id);
  for(const field of fields){
    const item=payload.fields?.[field.id];
    if(!item||typeof item.skipped!=='boolean') throw Object.assign(new Error('INVALID_RECORD'),{code:'INVALID_RECORD'});
    clean.fields[field.id]={value:structuredClone(item.value),skipped:item.skipped,...(field.id==='feeling'?{note:item.note??''}:{})};
  }
  if(fields.some(f=>validate({...clean,fields:{...clean.fields,[f.id]:{...clean.fields[f.id],skipped:false}}}).length)) throw Object.assign(new Error('INVALID_RECORD'),{code:'INVALID_RECORD'});
  if(payload.resultViewedAt!==null&&!Number.isFinite(Date.parse(payload.resultViewedAt))) throw Object.assign(new Error('INVALID_RECORD'),{code:'INVALID_RECORD'});
  clean.resultViewedAt=payload.resultViewedAt;
  return clean;
}

if(typeof document!=='undefined') mount();
function mount() {
  const entry=document.getElementById('mindReflectionEntry');
  if(!entry) return;
  let reflection=createReflection(), started=false, view={screen:'home'}, depth=0;
  let trigger=null, closing=false, confirmTrigger=null, exitTarget=null, shareText='';
  let connection={db:null,userId:null,generation:0}, saving=false, savedFields=null, draftFields=null;
  let savedAt=null, revisions={draft:null,record:null}, listVersion=0, pendingRetry=null;
  const storage=createStorage(()=>({...connection}));
  const fingerprint=()=>JSON.stringify(reflection.fields);
  const isSaved=()=>savedFields===fingerprint();
  const hasInput=()=>fields.some(f=>reflection.fields[f.id].skipped||reflection.fields[f.id].value?.length||reflection.fields[f.id].note?.length);
  function syncConnection(){
    const next=globalThis.getDragonReflectionContext?.()||{db:null,userId:null};
    if(next.userId!==connection.userId){
      connection={...next,generation:connection.generation+1};listVersion++;
      if(connectionPreviousUser){
        reflection=createReflection();started=false;savedFields=null;draftFields=null;savedAt=null;revisions={draft:null,record:null};shareText='';saving=false;pendingRetry=null;
        if(confirmation.open)confirmation.close();if(dialog.open){view={screen:'home'};render();announce('利用者が切り替わりました。前の利用者の入力は画面から消去しました。');}
      }
    }else connection={...connection,...next};
    connectionPreviousUser=next.userId;
  }
  let connectionPreviousUser=null;
  const token=crypto.randomUUID();
  const dialog=el('dialog',{className:'mr-dialog','aria-labelledby':'mr-title'});
  const content=el('div',{className:'mr-content'});
  const live=el('p',{className:'mr-status',role:'status','aria-live':'polite'});
  const confirmation=el('dialog',{className:'mr-dialog mr-confirm','aria-labelledby':'mr-confirm-title'});
  dialog.append(content); document.body.append(dialog,confirmation);
  const intro='最近あった出来事を振り返りながら、何を感じ、どう受け取り、どのように反応したのかを整理できます。正解を探したり、感情を変えたりする必要はありません。自分のことを少し深く理解するための時間です。';
  const preview='記録は「記録を保存する」、下書きは「あとで続ける」を押したときに保存します。保存していない変更はページを閉じると消えます。';
  document.addEventListener('dragon-reflection-session',syncConnection);syncConnection();
  function announce(text){live.textContent=text;}
  function focus(node){node.focus();node.scrollIntoView({block:'nearest'});}
  function begin(){started=true;go({screen:'observe'});}
  function go(next,edit=false){
    if(saving){announce('保存中です。完了するまでお待ちください。');return;}
    view=next; depth++;
    history.pushState({...history.state,mindReflection:{token,depth,view}},'');
    render(edit);
  }
  function open(screen,source){
    if(closing) return;
    trigger=source;
    dialog.showModal();
    if(screen==='observe') started=true;
    go({screen,from:{screen:'home'}});
  }
  for(const button of entry.querySelectorAll('[data-mr-open]')) button.addEventListener('click',()=>open(button.dataset.mrOpen,button));
  function end(target=null){
    if(saving){announce('保存中です。完了するまでお待ちください。');return;}
    exitTarget=target instanceof HTMLElement?target:null;
    if(confirmation.open) confirmation.close();
    dialog.close();
    if(depth>0){closing=true;history.go(-depth);} else restoreTrigger();
  }
  function restoreTrigger(){
    if(exitTarget){entry.closest('.exploration-menu').open=false;focus(exitTarget);exitTarget=null;return;}
    entry.open=true;
    entry.closest('.self-exploration').open=true;
    entry.closest('.exploration-menu').open=true;
    trigger?.focus();
  }
  function closeRequest(){
    if(saving){announce('保存中です。完了するまでお待ちください。');return;}
    if(view.screen==='result') {if(isSaved())end();else confirmClose();}
    else if(view.screen==='share') go({screen:'result'});
    else if(view.screen==='about'||view.screen==='theory') go(view.from||{screen:'home'});
    else end();
  }
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeRequest();});
  confirmation.addEventListener('cancel',event=>{event.preventDefault();cancelClose();});
  function cancelClose(){confirmation.close();confirmTrigger?.focus();announce('閉じる操作をキャンセルしました。入力は保持されています。');}
  function confirmClose(){
    if(isSaved()){end();return;}
    if(confirmation.open) return;
    confirmTrigger=document.activeElement;
    confirmation.replaceChildren(
      el('h2',{id:'mr-confirm-title',tabIndex:-1},'保存せずに閉じますか？'),
      el('p',{},'入力内容はこのページを開いている間だけ保持されます。再読み込みやページを閉じると消えます。'),
      el('p',{id:'mr-confirm-save-note'},'「保存して閉じる」を選ぶと、保存を確認してから閉じます。'),
      actions(button('保存して閉じる',()=>{confirmation.close();save('record',true);}),button('保存せずに閉じる',end),button('キャンセル',cancelClose))
    );
    confirmation.showModal();focus(confirmation.querySelector('h2'));
  }
  window.addEventListener('popstate',()=>{
    if(closing){closing=false;depth=0;restoreTrigger();return;}
    const state=history.state?.mindReflection;
    if(saving){history.pushState({...history.state,mindReflection:{token,depth,view}},'');announce('保存中です。完了するまでお待ちください。');return;}
    if(confirmation.open) confirmation.close();
    if(state?.token===token){
      depth=state.depth;view=state.view;if(!dialog.open)dialog.showModal();render();
    }else{
      const wasResult=dialog.open&&view.screen==='result'&&!isSaved();
      depth=0;
      if(wasResult){go(view);confirmClose();} else {dialog.close();restoreTrigger();}
    }
  });
  window.addEventListener('beforeunload',event=>{
    if(saving||(hasInput()&&!isSaved()&&draftFields!==fingerprint())){
      event.preventDefault();event.returnValue='';
    }
  });
  function header(title,description,stage){
    content.replaceChildren();
    if(stage) content.append(el('p',{className:'mr-eyebrow'},stage));
    content.append(el('h2',{id:'mr-title',tabIndex:-1},title));
    if(description)content.append(el('p',{},description));
  }
  function render(edit=false){
    live.textContent='';
    switch(view.screen){
      case 'home':
        header('心の動きに気づく',intro);
        content.append(el('p',{},'短時間で気軽に始められます。書きたくない項目は飛ばしてもかまいません。'),actions(button('振り返りを始める',begin,true),button('使い方を見る',()=>go({screen:'about',from:view})),button('もっと深く学ぶ',()=>go({screen:'theory',from:view}))),button('閉じる',end));
        content.append(actions(button('下書きを再開',()=>openList('draft')),button('保存した振り返りを見る',()=>openList('record')),button('新しく振り返る',newReflection)));
        break;
      case 'observe': observe();break;
      case 'review':
        header('振り返りを確認する','入力した内容をもとに、出来事・感じたこと・受け取り方・反応・振り返って感じることのつながりを整理します。これは診断や評価ではなく、自分の体験を見やすくするためのものです。','確認');
        results();
        content.append(actions(button('整理して見る',()=>{if(!reflection.resultViewedAt||!isSaved())reflection.resultViewedAt=new Date().toISOString();go({screen:'result'});},true),button('修正する',()=>go({screen:'observe'},true)),button('戻る',()=>go({screen:'observe'}))));
        break;
      case 'result':
        header('あなたの心の動き','出来事、感じたこと、受け取り方、反応、そして振り返って感じることを整理しました。','振り返り');
        results();
        content.append(actions(button('スピリットドラゴンに相談する',()=>{shareText=reflectionMessage(reflection);go({screen:'share'});},true)));
        content.append(el('p',{},'同じ出来事でも、受け取り方やそのときの状態によって、感じ方や反応は変わります。今回の整理は、あなたを決めつけるものではありません。'),el('p',{id:'mr-save-note'},stateLine()),actions(button('もう一度振り返る',()=>go({screen:'observe'},true),true),recordSaveButton(),button('閉じる',confirmClose)),el('p',{},'この見方の背景を知りたい場合は、詳しい解説を読めます。'),button('もっと深く学ぶ',()=>go({screen:'about',from:view})));
        break;
      case 'about':
        header('この観察方法について','この機能では、出来事そのものだけでなく、感じたこと、受け取り方、反応、振り返って感じることのつながりに注目します。日常の体験を整理し、自分の心の動きに気づくための見方です。');
        content.append(actions(button('理論的な背景を読む',()=>go({screen:'theory',from:view}),true),button('今回は読まない',()=>go(view.from||{screen:'home'})),button('閉じる',()=>go(view.from||{screen:'home'}))));
        break;
      case 'theory': theory();break;
      case 'share': share();break;
      case 'list': renderList();break;
    }
    content.append(el('p',{className:'mr-preview'},preview),live);
    live.tabIndex=-1;
    dialog.scrollTop=0;
    const target=edit?content.querySelector('textarea:not(:disabled),input:not(:disabled),.mr-skip'):null;
    focus(target||content.querySelector('h2'));
  }
  function observe(){
    header('今日の心の動きを振り返る','最近印象に残った出来事を一つ選び、そこから心の動きを順番に見ていきます。うまく説明できなくても大丈夫です。','観察 · 5つの項目');
    content.append(el('p',{},'すべて任意です。空欄のまま進めます。スキップした内容は、解除すると元に戻ります。'));
    const errors=el('div',{className:'mr-errors',hidden:true,tabIndex:-1,role:'alert'});
    content.append(errors);
    const groups=new Map();
    function showErrors(list){
      errors.replaceChildren();errors.hidden=!list.length;
      if(!list.length) return;
      errors.append(el('p',{},'入力内容を確認してください。'));
      for(const error of list){
        const field=fields.find(f=>f.id===error.id),group=groups.get(error.id);
        group.querySelector('.mr-error').textContent=error.message;
        errors.append(button(field.title+'：'+error.message,()=>focus(group.querySelector('textarea,input'))));
      }
      focus(errors);
    }
    for(const [i,f] of fields.entries()){
      const item=reflection.fields[f.id];
      const group=el('fieldset',{className:'mr-field'});
      const legend=el('legend',{id:`mr-${f.id}-label`},`${i+1}. ${f.title}`);
      legend.append(el('span',{className:'mr-optional'},'任意'));
      const description=el('p',{id:`mr-${f.id}-description`},f.description);
      const error=el('p',{className:'mr-error',id:`mr-${f.id}-error`,'aria-live':'polite'});
      const controls=el('div',{});
      const described=`mr-${f.id}-description mr-${f.id}-error`;
      group.append(legend,description,controls,error);
      if(!f.options){
        const counter=el('p',{className:'mr-count',id:`mr-${f.id}-count`});
        const textarea=el('textarea',{id:`mr-${f.id}`,rows:3,placeholder:f.placeholder,'aria-labelledby':legend.id,'aria-describedby':described+' '+counter.id});
        textarea.value=item.value;
        const update=()=>{
          if(countText(textarea.value)>2000){
            textarea.value=item.value;
            error.textContent='2,000文字を超える入力は受け付けませんでした。元の内容は保持されています。文章を短くしてから入力してください。';
          } else error.textContent='';
          item.value=textarea.value;counter.textContent=`残り ${2000-countText(item.value)} 文字（最大2,000文字）`;
          if(!errors.hidden) errors.hidden=true;
        };
        textarea.addEventListener('input',event=>{if(!event.isComposing)update();});
        textarea.addEventListener('compositionend',update);
        update();controls.append(textarea,counter);
      }else{
        controls.append(el('p',{},f.id==='feeling'?'複数選択できます。「特にわからない」は単独で選びます。':'1つ選べます。選ばずに進んでもかまいません。'));
        const options=el('div',{className:'mr-options'});
        f.options.forEach((value,n)=>{
          const input=el('input',{type:f.id==='feeling'?'checkbox':'radio',name:`mr-${f.id}`,value,id:`mr-${f.id}-${n}`,'aria-describedby':described});
          input.checked=f.id==='feeling'?item.value.includes(value):item.value===value;
          input.addEventListener('change',()=>{
            if(f.id==='feeling'){
              const before=item.value;item.value=selectFeeling(before,value,input.checked);
              options.querySelectorAll('input').forEach(other=>{other.checked=item.value.includes(other.value);});
              if(before.some(v=>!item.value.includes(v)&&v!==value)) announce('同時に選べない選択肢を解除しました。現在の選択：'+item.value.join('、'));
            }else item.value=value;
            error.textContent='';
          });
          const label=el('label',{className:'mr-option',htmlFor:input.id});label.append(input,el('span',{},value));options.append(label);
        });
        controls.append(options);
        if(f.id==='feeling'){
          const label=el('label',{htmlFor:'mr-feeling-note'},'自分の言葉で書く（任意）');
          const hint=el('p',{id:'mr-feeling-note-hint'},'選択肢だけでも、自由入力だけでも、両方でもかまいません。「特にわからない」を選んだまま、身体の感覚などを書いても大丈夫です。');
          const note=el('textarea',{id:'mr-feeling-note',rows:3,placeholder:'例：胸のあたりがぎゅっとした。少し寂しかった。','aria-describedby':'mr-feeling-note-hint mr-feeling-note-count mr-feeling-error'});
          note.value=item.note||'';
          const counter=el('p',{className:'mr-count',id:'mr-feeling-note-count'});
          const updateNote=()=>{
            if(countText(note.value)>2000){note.value=item.note||'';error.textContent='2,000文字を超える入力は受け付けませんでした。元の内容は保持されています。文章を短くしてから入力してください。';}
            else error.textContent='';
            item.note=note.value;counter.textContent=`残り ${2000-countText(item.note)} 文字（最大2,000文字）`;
          };
          note.addEventListener('input',event=>{if(!event.isComposing)updateNote();});
          note.addEventListener('compositionend',updateNote);
          updateNote();controls.append(label,hint,note,counter);
        }
        if(f.id==='afterglow') controls.append(button('選択を解除',()=>{item.value='';options.querySelectorAll('input').forEach(input=>{input.checked=false;});announce('振り返って感じることの選択を解除しました。');}));
      }
      const skip=button('',()=>{item.skipped=!item.skipped;syncSkip();announce(`${f.title}：${item.skipped?'スキップしました。入力内容は保持されています。':'スキップを解除しました。'}`);});
      skip.classList.add('mr-skip');
      function syncSkip(){
        skip.textContent=item.skipped?'スキップ済み — 解除する':'この項目をスキップ';
        skip.setAttribute('aria-pressed',String(item.skipped));
        skip.setAttribute('aria-label',`${f.title}：${skip.textContent}`);
        controls.querySelectorAll('textarea,input,button').forEach(control=>{control.disabled=item.skipped;});
      }
      syncSkip();group.append(skip);groups.set(f.id,group);content.append(group);
    }
    content.append(el('p',{id:'mr-draft-note'},'「あとで続ける」で下書きを保存できます。「戻る」では、このページ内に入力を保持します。'),actions(button('次へ',()=>{const list=validate(reflection);if(list.length)showErrors(list);else go({screen:'review'});},true),button('あとで続ける',()=>save('draft')),button('戻る',()=>go({screen:'home'}))));
  }
  function results(){
    for(const f of fields){const section=el('section',{className:'mr-result'});section.append(el('h3',{},f.title),el('p',{},displayValue(reflection.fields[f.id])));content.append(section);}
  }
  function stateLine(){return isSaved()?`保存済み · ${new Date(savedAt).toLocaleString()}`:'未保存';}
  function recordSaveButton(){const node=button(isSaved()?'保存済み':'記録を保存する',()=>save('record'));node.disabled=isSaved();return node;}
  async function save(kind,closeAfter=false){
    if(saving)return false;
    const generation=connection.generation;
    let payload;
    try{payload=restoreReflection(reflection);}catch(error){announce(storageMessage(error));focus(live);return false;}
    saving=true;pendingRetry=null;
    content.querySelectorAll('button,input,textarea').forEach(node=>{node.disabled=true;});
    announce('保存中です…');focus(live);
    try{
      const receipt=await storage.save(payload,kind,revisions[kind]);
      if(generation!==connection.generation)return false;
      if(!receipt?.saved_at||!receipt?.revision||receipt.id!==reflection.id||receipt.kind!==kind)throw new Error('Invalid save receipt');
      revisions[kind]=receipt.revision;
      if(kind==='record') {savedFields=JSON.stringify(payload.fields);savedAt=receipt.saved_at;revisions.draft=null;draftFields=null;}
      else draftFields=JSON.stringify(payload.fields);
      saving=false;
      if(closeAfter){end();return true;}
      if(kind==='draft') go({screen:'home'});else render();
      announce(kind==='draft'?'下書きを保存しました。「下書きを再開」から続けられます。':`記録を保存しました。${new Date(savedAt).toLocaleString()}`);focus(live);
      return true;
    }catch(error){
      if(generation!==connection.generation)return false;
      saving=false;pendingRetry={kind,closeAfter};render();
      announce(storageMessage(error));focus(live);
      content.append(button('再試行する',()=>save(kind,closeAfter)));
      if(!connection.userId) content.append(button('入力を保持してログイン',loginWithInput));
      return false;
    }finally{if(generation===connection.generation)saving=false;}
  }
  function loginWithInput(){
    // Explicit login handoff only; never persisted on typing or normal navigation.
    try{sessionStorage.setItem('dragon-reflection-login',JSON.stringify({payload:reflection,expires:Date.now()+15*60*1000}));}
    catch{announce('ログイン前の入力を保持できませんでした。内容を手元に控えてからログインしてください。');focus(live);return;}
    end();document.getElementById('profile').click();
  }
  function recoverLogin(){
    if(!connection.userId)return;
    let pending;
    try{pending=JSON.parse(sessionStorage.getItem('dragon-reflection-login')||'null');sessionStorage.removeItem('dragon-reflection-login');}catch{return;}
    if(!pending||pending.expires<Date.now())return;
    try{reflection=restoreReflection(pending.payload);started=true;view={screen:reflection.resultViewedAt?'result':'observe'};
      if(!dialog.open)open(view.screen,entry.querySelector('[data-mr-open]'));else render();
      announce('ログイン前の入力を復元しました。まだ記録は保存していません。');
    }catch{ /* Invalid handoff is discarded, never sent to storage. */ }
  }
  document.addEventListener('dragon-reflection-session',recoverLogin);recoverLogin();
  function replaceCurrent(action){
    if(!hasInput()||isSaved()||draftFields===fingerprint()){action();return;}
    confirmTrigger=document.activeElement;
    confirmation.replaceChildren(el('h2',{id:'mr-confirm-title',tabIndex:-1},'現在の入力をどうしますか？'),el('p',{},'別の振り返りを開く前に、現在の入力を下書きに残せます。'),actions(
      button('下書きに保存して進む',async()=>{confirmation.close();if(await save('draft'))action();}),
      button('入力を破棄して進む',()=>{confirmation.close();action();}),
      button('キャンセル',()=>{confirmation.close();confirmTrigger?.focus();})
    ));confirmation.showModal();focus(confirmation.querySelector('h2'));
  }
  function newReflection(){replaceCurrent(()=>{reflection=createReflection();savedFields=null;draftFields=null;savedAt=null;revisions={record:null,draft:null};started=true;go({screen:'observe'});});}
  function openList(kind){go({screen:'list',kind,offset:0});}
  function renderList(){
    const kind=view.kind,offset=view.offset||0,currentVersion=++listVersion;
    header(kind==='draft'?'下書きを再開':'保存した振り返り','開きたい振り返りを選んでください。');
    const list=el('div',{});content.append(list,actions(button('戻る',()=>go({screen:'home'}))));
    announce('読み込んでいます…');
    storage.list(kind,offset).then(rows=>{
      if(currentVersion!==listVersion||view.screen!=='list')return;
      if(!Array.isArray(rows))throw new Error('Invalid list');
      for(const row of rows){
        const section=el('section',{className:'mr-result'});
        section.append(el('p',{},`${kind==='draft'?'下書き':'保存済み'} · ${new Date(row.saved_at).toLocaleString()}`));
        // Keep private content out of list titles until the user opens the record.
        section.append(button('この振り返りを開く',()=>replaceCurrent(async()=>{
          const version=connection.generation;
          try{
            const latest=await storage.get(row.id,kind);if(version!==connection.generation)return;
            if(!latest)throw Object.assign(new Error('INVALID_RECORD'),{code:'INVALID_RECORD'});
            const restored=restoreReflection(latest.payload);
            const record=kind==='record'?latest:await storage.get(row.id,'record');
            if(version!==connection.generation)return;
            reflection=restored;started=true;savedAt=record?.saved_at||null;savedFields=record?JSON.stringify(restoreReflection(record.payload).fields):null;
            revisions={draft:kind==='draft'?latest.revision:null,record:record?.revision||null};draftFields=kind==='draft'?fingerprint():null;
            go({screen:kind==='draft'?'observe':'result'});
          }catch(error){announce(storageMessage(error));focus(live);}
        })));list.append(section);
      }
      if(offset>0)list.append(button('前の20件',()=>go({screen:'list',kind,offset:Math.max(0,offset-20)})));
      if(rows.length===20)list.append(button('次の20件',()=>go({screen:'list',kind,offset:offset+20})));
      announce(rows.length?`${rows.length}件を読み込みました。`:'保存した内容はありません。');
    }).catch(error=>{
      if(currentVersion!==listVersion||view.screen!=='list')return;
      announce(storageMessage(error));list.append(button('再試行する',()=>render()));
      if(!connection.userId)list.append(button('入力を保持してログイン',loginWithInput));
    });
  }
  function share(){
    header('スピリットドラゴンに相談する','会話に渡す内容を確認・編集できます。次の画面で、いつもの送信ボタンを押すと送信されます。');
    content.append(el('p',{},'渡した内容は通常の会話下書きとして扱われます。送信後は通常の会話履歴に残ります。振り返り記録の保存とは別です。'));
    content.append(el('p',{},'スキップした項目の元の文章は含めません。書きかけのメッセージがある場合は、その後ろに追加します。会話のモード・添付資料・選択中の記憶は引き継がれます。'));
    const label=el('label',{htmlFor:'mr-share-text'},'会話に渡す内容');
    const area=el('textarea',{id:'mr-share-text',rows:10,'aria-describedby':'mr-share-count mr-share-error'});
    area.value=shareText;
    const count=el('p',{id:'mr-share-count',className:'mr-count'});
    const error=el('p',{id:'mr-share-error',className:'mr-error',role:'alert'});
    const composer=document.getElementById('messageInput');
    const limit=composer.maxLength>0?composer.maxLength:4000;
    function update(){
      shareText=area.value;
      const length=combineMessage(composer.value,shareText).length;
      count.textContent=`書きかけを含め ${length.toLocaleString()} / ${limit.toLocaleString()}文字（絵文字などは2文字分になる場合があります）`;
      error.textContent=length>limit?`会話の上限を${(length-limit).toLocaleString()}文字分超えています。渡す文章を短くしてください。振り返りの元の内容は変わりません。`:'';
    }
    area.addEventListener('input',update);update();
    content.append(label,area,count,error,actions(button('会話入力欄へ入れる',()=>{
      update();
      if(!shareText.trim()){error.textContent='会話に渡す内容を入力するか、結果に戻ってください。';focus(area);return;}
      if(combineMessage(composer.value,shareText).length>limit){focus(area);return;}
      if(composer.disabled){error.textContent='現在、会話入力欄を利用できません。結果に戻って画面を閉じ、ログインや返答待ちの状態を確認してから、もう一度お試しください。';return;}
      composer.value=combineMessage(composer.value,shareText);
      composer.dispatchEvent(new Event('input',{bubbles:true}));
      end(composer);
    },true),button('結果に戻る',()=>go({screen:'result'}))));
  }
  function theory(){
    header('伝統的な理論を参考にした見方','この観察方法は、伝統的な仏教心理学であるアビダンマの理論を参考にしています。心の状態や体験の生じ方を細かく捉える考え方ですが、ここで紹介する内容は自己理解のための一つの見方です。科学的に確定した事実や診断結果として断定するものではありません。');
    content.append(el('h3',{},'専門用語について'),el('p',{},'アビダンマには、心の働きを分類するための専門用語があります。この機能では、まず日常的な言葉で体験を振り返り、必要な場合にのみ専門用語を確認できる構成にしています。'));
    const terms=el('section',{className:'mr-terms',id:'mr-terms',hidden:true});
    const heading=el('h3',{tabIndex:-1},'専門用語の説明');
    const toggle=button('専門用語の説明を見る',()=>{
      terms.hidden=!terms.hidden;toggle.setAttribute('aria-expanded',String(!terms.hidden));
      toggle.textContent=terms.hidden?'専門用語の説明を見る':'専門用語の説明を閉じる';
      if(!terms.hidden) focus(heading);
    });
    toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',terms.id);
    terms.append(heading,el('h4',{},'アビダンマ'),el('p',{},'ここでは「伝統的な仏教心理学」として紹介しています。体験を整理するための参考となる考え方です。'),el('p',{},'この画面の5項目は日常の振り返り用です。伝統的な分類と一対一に対応するものとしては扱いません。'),el('p',{},'用語解説は確認用の短い案です。詳しい分類や用語の追加は、内容を確認してから行います。'),button('説明を閉じる',()=>{terms.hidden=true;toggle.textContent='専門用語の説明を見る';toggle.setAttribute('aria-expanded','false');focus(toggle);}));
    content.append(actions(toggle,button('日常の振り返りに戻る',()=>go({screen:started?'observe':'home'}))),terms,el('p',{},'内容に納得できない部分があっても問題ありません。自分に合う範囲で、日常の体験を振り返るために利用してください。'),actions(button('観察を始める',begin,true),button('閉じる',()=>go(view.from||{screen:'home'}))));
  }
}
function el(tag,attrs={},text){
  const node=document.createElement(tag);
  for(const [name,value] of Object.entries(attrs)){
    if(name in node && !name.startsWith('aria-'))node[name]=value;else node.setAttribute(name,String(value));
  }
  if(text!==undefined)node.textContent=text;
  return node;
}
function button(label,handler,primary=false){const node=el('button',{type:'button',className:primary?'mr-primary':''},label);node.addEventListener('click',handler);return node;}
function disabledButton(label,description){return el('button',{type:'button',disabled:true,'aria-describedby':description},label);}
function actions(...children){const node=el('div',{className:'mr-actions'});node.append(...children);return node;}
