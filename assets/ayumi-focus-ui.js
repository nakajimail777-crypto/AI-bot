// UI for a reference to one existing item; never creates a second task list.
globalThis.DragonAyumiFocusUI={
 mount({host,getState,act,consult,openRecords,openChecklist,openEditor,notice}){
  let locked=false,shownDate=null;
  host.className='ayumi-focus-card';host.tabIndex=-1;host.setAttribute('aria-label','今日の1個');
  const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  function render(){
   const {draft,saved,dirty,loading,canSave}=getState();host.replaceChildren();if(!draft)return;
   const view=DragonAyumi.focusState(draft),today=view.date;shownDate=today;
   const recorded=saved?.focus_day?.date===today&&saved.focus_day.item_id===draft.focus_day?.item_id&&saved.focus_day.status===draft.focus_day?.status;
   const doneSaved=view.kind==='done'&&recorded&&saved.items.find(i=>i.id===view.item.id)?.done;
   const restSaved=view.kind==='rest'&&recorded;
   const heading=node('h3',doneSaved?'✓ 今日の分は完了しました':restSaved?'今日はお休みです':'今日の1個');heading.id='ayumiFocusHeading';host.append(heading);
   const status=node('p');status.setAttribute('role','status');host.append(status);
   const actions=node('div');actions.className='ayumi-focus-actions';
   const button=(text,fn,{save=false}={})=>{const b=node('button',text);b.type='button';b.className='plain-button';b.disabled=loading||locked||(save&&!canSave);b.onclick=fn;actions.append(b);return b;};
   async function run(action,id,chat=false){
    if(locked||getState().loading)return;
    if(today!==DragonAyumi.dailyToday()){render();notice('日付が変わりました。今日の1個を確認してください。');return;}
    locked=true;render();
    try{
     const result=await act(action,id,today);
     if(result&&chat)consult(result,id,today);
    }catch(e){notice(e.message);}
    finally{locked=false;render();}
   }
   const more=()=>{
    const alternatives=draft.items.filter(i=>!i.daily&&!i.weeks?.length&&i.text.trim()&&!i.done&&(!i.scheduled_on||i.scheduled_on<=today));
    if(!alternatives.length)return;
    const fold=node('details');fold.className='ayumi-focus-choice';fold.append(node('summary',doneSaved||restSaved?'もう1個進める／選び直す':'別の項目を選ぶ'));
    const label=node('label','取り組む項目');const select=node('select');select.setAttribute('aria-label','今日の1個を選ぶ');
    alternatives.forEach(i=>{const option=node('option',i.text);option.value=i.id;option.selected=i.id===view.item?.id;select.append(option);});label.append(select);fold.append(label);
    const choose=node('button','この項目を選んで保存');choose.type='button';choose.className='plain-button';choose.disabled=loading||locked||!canSave;choose.onclick=()=>run('start',select.value);fold.append(choose);host.append(fold);
   };
   if(view.item){const title=node('p',view.item.text);title.className='ayumi-focus-title'+(view.item.done?' simple-done':'');host.append(title);}
   if(doneSaved){
    status.textContent='ひとつ進みました。今日はここで終わって大丈夫です。';
    const next=DragonAyumi.focusState({...draft,focus_day:null},today).item;
    if(next)host.append(node('p','次回の1個：'+next.text));
    button('完了を取り消して保存',()=>run('undo',view.item.id),{save:true});
   }else if(restSaved){
    status.textContent='作業の完了数は変わりません。次回は続きから始められます。';
   }else if(view.kind==='done'||view.kind==='rest'){
    status.textContent='この操作は未保存です。接続を確認して、もう一度保存してください。';
    button('再試行して保存',()=>run(view.kind,view.item?.id),{save:true});
   }else if(view.kind==='active'||view.kind==='suggested'){
    status.textContent=view.kind==='suggested'?'まずはこの1個から。別の項目も選べます。':'この項目の続きから始めましょう。';
    button('AIと一緒に進める',()=>run('start',view.item.id,true),{save:true});
    button('完了して保存',()=>run('done',view.item.id),{save:true}).classList.add('ayumi-focus-primary');
    button('今日は休む',()=>run('rest',view.item.id),{save:true});
   }else if(view.kind==='already-done'){
    status.textContent='この項目は完了しています。今日完了した記録はありません。続ける場合は別の項目を選べます。';
   }else if(view.kind==='empty'){
    status.textContent='小さな一歩を1つ用意しましょう。';
    button('AIと小さな一歩を考える',()=>openEditor(true));button('自分で追加する',()=>openEditor(false));
   }else if(view.kind==='archived'){
    status.textContent='保管中の目標です。取り組み中に戻すと今日の1個を選べます。';
   }else if(view.kind==='complete'){
    status.textContent='全体の作業が完了しています。保存済みの目標達成を下で振り返れます。';
   }else{
    status.textContent=view.kind==='future'?'次の作業には未来の着手予定があります。予定日まで待つか、全体の項目を確認できます。':'単発の作業候補はありません。毎日・週別の記録を続けられます。';
    if(view.kind==='records'&&draft.items.some(i=>i.daily))button('日々の記録・ほかの予定を見る',openRecords);
    else button('全体のチェックリストで確認する',openChecklist);
   }
   host.append(actions);
   if(view.kind!=='archived')more();
   if(['active','suggested','done','rest'].includes(view.kind)){
    const help=node('p',dirty?'未保存の項目・期限・一言の変更も、上の保存操作で一緒に保存します。':'開始・選択・完了・休みの操作で保存します。AI相談文は自分で確認して送信できます。');help.className='ayumi-focus-help';host.append(help);
    if(!canSave)host.append(node('p','記録するにはログインしてください。'));
   }
  }
  function tick(){if(host.closest('dialog')?.open&&shownDate!==DragonAyumi.dailyToday())render();}
  const timer=setInterval(tick,15000);timer.unref?.();
  document.addEventListener('visibilitychange',tick);window.addEventListener('focus',tick);
  return {render};
 }
};
