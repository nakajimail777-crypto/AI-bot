// The focus is a reference to an existing item / daily occurrence, never a task copy.
globalThis.DragonAyumiFocusUI={
 mount({host,getState,act,consult,openRecords,openChecklist,openEditor,notice,onDateChange}){
  let locked=false,shownDate=null;
  host.className='ayumi-focus-card';host.tabIndex=-1;host.setAttribute('aria-label','今日の1個');
  const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  function render(){
   const {draft,saved,dirty,loading,canSave}=getState();host.replaceChildren();if(!draft)return;
   const J=DragonAyumiJourney,view=J.state(draft),today=view.date;shownDate=today;
   const savedView=saved&&J.state(saved,today),recorded=JSON.stringify(draft.journey?.focus||null)===JSON.stringify(saved?.journey?.focus||null);
   const doneSaved=view.kind==='done'&&savedView?.kind==='done'&&recorded;
   const restSaved=view.kind==='rest'&&savedView?.kind==='rest'&&recorded;
   host.append(node('h3',doneSaved?'✓ 今日の分は完了しました':restSaved?'今日はお休みです':'今日の1個'));
   const status=node('p');status.setAttribute('role','status');host.append(status);
   const actions=node('div');actions.className='ayumi-focus-actions';
   const button=(text,fn,save=false)=>{const b=node('button',text);b.type='button';b.className='plain-button';b.disabled=loading||locked||(save&&!canSave);b.onclick=fn;actions.append(b);return b;};
   async function run(action,id,chat=false){
    if(locked||getState().loading)return;
    if(today!==DragonAyumi.dailyToday()){render();notice('日付が変わりました。今日の1個を確認してください。');return;}
    locked=true;render();try{const result=await act(action,id,today);if(result&&chat)consult(result,id,today);}catch(e){notice(e.message);}finally{locked=false;render();}
   }
   if(view.item){const title=node('p',view.item.text);title.className='ayumi-focus-title'+(doneSaved?' simple-done':'');host.append(title);}
   if(view.spec){host.append(node('p','理由：'+view.spec.reason),node('p','完了目安：'+view.spec.complete_when));}
   if(doneSaved){status.textContent='今日の分は完了。ここで終わって大丈夫。';button('完了を取り消して保存',()=>run('undo',view.item.id),true);}
   else if(restSaved){status.textContent='完了数は変わりません。再開する日も自分で選べます。';button('休みを取り消して保存',()=>run('unrest',null),true);}
   else if(['done','rest'].includes(view.kind)){status.textContent='未保存です。入力は残っています。';button('再試行して保存',()=>run('retry',null),true);}
   else if(['active','suggested'].includes(view.kind)){
    status.textContent=view.kind==='active'?'選んだ行動の続きから。':'採用した計画からの候補です。まだ実施には数えていません。';
    if(view.kind==='suggested')button('これにする',()=>run('start',view.item.id),true);
    button('AIと相談',()=>run('start',view.item.id,true),true);
    if(view.kind==='active')button('完了して保存',()=>run('done',view.item.id),true).classList.add('ayumi-focus-primary');
    button('今日は休む',()=>run('rest',view.item.id),true);
   }else if(view.kind==='strategy'){
    status.textContent='進め方がまだ決まっていません。既存の行動や記録は残っています。';button('進め方を相談する',()=>openEditor(true));button('自分で方針を決める',()=>openEditor(false));
   }else if(view.kind==='archived')status.textContent='保管中の目標です。再開すると今日の1個を選べます。';
   else{status.textContent='今日の予定はありません。未来の予定や前提の行動は、全体の計画で確認できます。';button('全体の計画を見る',openChecklist);button('今日は休む',()=>run('rest',null),true);}
   host.append(actions);
   const candidates=J.candidates(draft,today);
   if(candidates.length&&view.kind!=='archived'){
    const fold=node('details'),label=node('label','取り組む行動'),select=node('select');fold.className='ayumi-focus-choice';fold.append(node('summary',doneSaved||restSaved?'追加でもう1個進める（任意）':'別の候補'));
    select.setAttribute('aria-label','今日の1個を選ぶ');for(const c of candidates){const o=node('option',c.item.text);o.value=c.item.id;o.selected=c.item.id===view.item?.id;select.append(o);}label.append(select);fold.append(label);
    const choose=node('button','この行動にして保存');choose.type='button';choose.disabled=loading||locked||!canSave;choose.onclick=()=>run('start',select.value);fold.append(choose);host.append(fold);
   }
   if(draft.items.some(i=>i.daily||i.weeks?.length)){const b=node('button','続けている習慣・日々の記録を見る');b.type='button';b.className='plain-button';b.onclick=openRecords;host.append(b);}
   host.append(node('p','今日の重点です。この1個だけで目標達成を保証するものではありません。'));
   const help=node('p',dirty?'未保存の目標・行動・一言の変更も、保存操作で一緒に記録します。':'選択と実施は別の記録です。AI相談文は自分で確認して送信します。');help.className='ayumi-focus-help';host.append(help);
   if(!canSave)host.append(node('p','保存するにはログインしてください。'));
  }
  function tick(){if(host.closest('dialog')?.open&&shownDate!==DragonAyumi.dailyToday()){render();onDateChange?.();}}
  const timer=setInterval(tick,15000);timer.unref?.();document.addEventListener('visibilitychange',tick);window.addEventListener('focus',tick);
  return {render};
 }
};
