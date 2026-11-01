globalThis.DragonAyumiJourneyUI={
 mount({host,summaryHost,getState,editGoal,commit,consult,openItems,notice,inputState}){
  const J=DragonAyumiJourney,A=DragonAyumi;
  const n=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  let projectId=null,formsDirty=false,busy=false,pending=false,pendingFinish=null,epoch=0,planId=crypto.randomUUID(),outcomeId=crypto.randomUUID(),reviewId=crypto.randomUUID(),rows=[];
  const fields={};host.className='ayumi-journey';const formStatus=n('p');formStatus.setAttribute('role','status');
  const summary=n('div'),reviewSummary=n('p'),history=n('details'),historyBody=n('div');history.id='journeyHistory';history.append(n('summary','成果・方針・振り返りの履歴'),historyBody);
  const editor=n('details');editor.id='journeyEditor';editor.append(n('summary','目標と方針を相談・編集する'));
  const goalForm=n('div');editor.append(goalForm);
  const dirtyForms=new Set(); function clearForm(id){dirtyForms.delete(id);formsDirty=dirtyForms.size>0;} function markForm(event){dirtyForms.add(event?.target?.closest('#journeyEditor,#journeyOutcome,#journeyReview')?.id||'journeyEditor');formsDirty=true;inputState?.();formStatus.textContent='未確定の入力があります。それぞれの確認ボタンで保存してください。';}
  function field(parent,key,label,type='textarea',max=1000){const wrap=n('label',label),input=n(type==='textarea'?'textarea':'input');input.id=key;input.setAttribute('aria-label',label);if(type!=='textarea')input.type=type;else input.rows=2;input.maxLength=max;wrap.append(input);parent.append(wrap);fields[key]=input;input.oninput=markForm;return input;}
  for(const [key,label] of [['purpose','目的（何のために）'],['criteria','達成条件（何を確認できたら達成か）'],['current','現在地'],['constraints','状況・制約（任意）']]){
   const input=field(goalForm,'journey-'+key,label);input.oninput=()=>{editGoal(key,input.value);};
  }
  const buttons=[];
  function button(parent,label,fn){const b=n('button',label);b.type='button';b.className='plain-button';b.onclick=fn;parent.append(b);buttons.push(b);return b;}
  function tryConsult(item){try{consult(J.prompt(getState().draft,item));}catch(e){notice(e.message);}}
  button(editor,'AIに進め方を相談する',()=>tryConsult());
  editor.append(n('p','AIとの相談は既存チャットの下書きになります。案をここで見直し、採用したときに正式な計画になります。'));
  const strategy=field(editor,'journey-strategy','採用したい方針（AIの案も手入力できます）');
  const actionList=n('div');actionList.id='journeyActionList';editor.append(n('p','採用する行動を開き、計画に含めるチェック・理由・完了目安を確認してください。'),actionList);
  button(editor,'行動を追加・習慣にする',openItems);
  const accept=button(editor,'内容を確認して方針を採用・保存',()=>save(p=>J.adopt(p,{id:planId,strategy:strategy.value,actions:rows.filter(r=>r.check.checked).map(r=>({item_id:r.id,reason:r.reason.value.trim(),complete_when:r.complete.value.trim(),weekdays:r.days.filter(x=>x.checked).map(x=>Number(x.value)),depends_on:[...r.deps.selectedOptions].map(o=>o.value)}))}),()=>{planId=crypto.randomUUID();clearForm('journeyEditor');}));accept.id='journeyAdopt';
  const outcome=n('details');outcome.id='journeyOutcome';outcome.append(n('summary','成果を記録する（チェックとは別）'));
  field(outcome,'outcome-date','測定・確認日','date');field(outcome,'outcome-value','測定値（任意）','number');fields['outcome-value'].step='any';field(outcome,'outcome-unit','単位（数値がある場合）','text',40);field(outcome,'outcome-text','成果の説明（数値がない場合は必須）');
  button(outcome,'内容を確認して成果を保存',()=>save(p=>J.outcome(p,{id:outcomeId,date:fields['outcome-date'].value,value:fields['outcome-value'].value===''?null:Number(fields['outcome-value'].value),unit:fields['outcome-unit'].value.trim(),text:fields['outcome-text'].value.trim()}),()=>{outcomeId=crypto.randomUUID();fields['outcome-value'].value='';fields['outcome-unit'].value='';fields['outcome-text'].value='';clearForm('journeyOutcome');}));
  const review=n('details');review.id='journeyReview';review.append(n('summary','振り返る・次の振り返り日を決める'));
  const reviewEvidence=n('p');review.append(reviewEvidence);
  field(review,'review-date','振り返る日','date');field(review,'review-burden','負担はどうでしたか','text',300);field(review,'review-note','実施状況と成果を見て気づいたこと');
  const choiceLabel=n('label','これからどうするか'),choice=n('select');choice.id='review-choice';choice.setAttribute('aria-label','これからどうするか');for(const [value,text] of [['continue','今の方針を続ける'],['consult','方針を相談し直す'],['revise','期限・目標を見直す']]){const o=n('option',text);o.value=value;choice.append(o);}choiceLabel.append(choice);review.append(choiceLabel);choice.onchange=event=>{markForm(event);revision.hidden=choice.value!=='revise';};
  const revision=n('div');revision.hidden=true;review.append(revision);field(revision,'review-title','見直した目標名','text',120);field(revision,'review-due','見直した期限（任意）','date');field(revision,'review-criteria','見直した達成条件');field(revision,'review-current','見直した現在地');
  field(review,'review-next','次の振り返り日（任意）','date');
  button(review,'内容を確認して振り返りを保存',()=>save(p=>{
   let next=J.review(p,{id:reviewId,date:fields['review-date'].value,choice:choice.value,burden:fields['review-burden'].value.trim(),note:fields['review-note'].value.trim(),next_date:fields['review-next'].value||null});
   if(choice.value==='revise'){next.title=fields['review-title'].value.trim();next.due_date=fields['review-due'].value||null;next.journey.goal.criteria=fields['review-criteria'].value;next.journey.goal.current=fields['review-current'].value;next.journey.active_plan_id=null;}
   return next;
  },()=>{reviewId=crypto.randomUUID();clearForm('journeyReview');if(choice.value==='consult')tryConsult();}));
  const retry=button(host,'未保存の変更を再試行して保存',()=>save(p=>p,()=>{pending=false;formsDirty=false;}));retry.hidden=true;
  summaryHost.append(summary);host.append(reviewSummary,editor,outcome,review,history,formStatus);
  const hint=n('p','方針案・成果・振り返りの入力は、それぞれの確認ボタンで保存します。ほかの未保存変更も一緒に保存します。');hint.className='ayumi-focus-help';host.append(hint);
  async function save(transform,onSuccess){
   if(busy||getState().loading)return;const generation=epoch;busy=true;refreshLocks();
   try{const next=transform(getState().draft);A.normalize(next);if(!pending)pendingFinish=onSuccess;pending=true;const result=await commit(next);if(generation!==epoch)return;if(result){pending=false;const finish=pendingFinish||onSuccess;pendingFinish=null;finish();}else notice('保存できていません。入力は残っています。再試行してください。');}
   catch(e){if(generation===epoch)notice(e.message);}finally{if(generation===epoch){busy=false;retry.hidden=!pending;refreshLocks();inputState?.();refresh();}}
  }
  function refreshLocks(){const s=getState();for(const b of buttons)b.disabled=busy||s.loading||!s.canSave;for(const input of host.querySelectorAll('input,textarea,select'))input.disabled=busy||s.loading||pending;}
  function buildActions(p){
   const plan=J.plan(p),previous=new Map(rows.map(r=>[r.id,r]));rows=[];actionList.replaceChildren();
   for(const item of p.items){
    const prior=previous.get(item.id),spec=plan?.actions.find(a=>a.item_id===item.id),row=n('details'),label=n('label'),check=n('input');check.type='checkbox';check.checked=prior?prior.check.checked:!!spec;check.setAttribute('aria-label',item.text+'を計画に含める');check.onchange=markForm;label.append(check,n('span',item.text||'名称未入力'));
    row.append(n('summary',item.text||'名称未入力'),label);
    const reason=field(row,'reason-'+item.id,'目標とのつながり：'+item.text,'textarea',300),complete=field(row,'complete-'+item.id,'完了目安：'+item.text,'textarea',300);reason.value=prior?prior.reason.value:spec?.reason||'';complete.value=prior?prior.complete.value:spec?.complete_when||'';
    const days=[];const dayGroup=n('div');dayGroup.className='journey-weekdays';dayGroup.append(n('p','習慣に取り組む曜日（単発には適用しません）'));
    for(let i=0;i<7;i++){const lab=n('label','日月火水木金土'[i]),c=n('input');c.type='checkbox';c.value=String(i);c.checked=prior?prior.days[i].checked:spec?spec.weekdays.includes(i):true;c.setAttribute('aria-label',item.text+'：'+'日月火水木金土'[i]+'曜日');c.onchange=markForm;lab.prepend(c);dayGroup.append(lab);days.push(c);}row.append(dayGroup);
    const deps=n('select');deps.multiple=true;deps.setAttribute('aria-label',item.text+'の前提作業');deps.onchange=markForm;for(const dep of p.items.filter(i=>i.id!==item.id&&!i.daily&&!i.weeks?.length)){const o=n('option',dep.text);o.value=dep.id;o.selected=prior?[...prior.deps.selectedOptions].some(x=>x.value===dep.id):spec?.depends_on.includes(dep.id)||false;deps.append(o);}const dl=n('label','先に終える作業（任意・複数選択）');dl.append(deps);row.append(dl);actionList.append(row);rows.push({id:item.id,check,reason,complete,days,deps});
   }
   if(!rows.length)actionList.append(n('p','まず行動を追加してください。AIの案も採用前に編集できます。'));
  }
  function refresh(){
   const {draft:p,saved}=getState();if(!p)return;
   const j=J.data(p),savedJ=J.data(saved||{}),plan=J.plan(p);
   if(projectId!==p.id){projectId=p.id;formsDirty=false;dirtyForms.clear();pending=false;rows=[];planId=crypto.randomUUID();outcomeId=crypto.randomUUID();reviewId=crypto.randomUUID();strategy.value=plan?.strategy||'';buildActions(p);for(const key of ['outcome-value','outcome-unit','outcome-text','review-burden','review-note'])fields[key].value='';fields['outcome-date'].value=fields['review-date'].value=A.dailyToday();fields['review-next'].value=j.next_review||'';choice.value='continue';revision.hidden=true;}
   if(!pending&&rows.map(r=>r.id).join('|')!==p.items.map(i=>i.id).join('|'))buildActions(p);
   for(const key of ['purpose','criteria','current','constraints'])if(document.activeElement!==fields['journey-'+key])fields['journey-'+key].value=j.goal[key];
   if(!dirtyForms.has('journeyReview')){fields['review-title'].value=p.title;fields['review-due'].value=p.due_date||'';fields['review-criteria'].value=j.goal.criteria;fields['review-current'].value=j.goal.current;}
   summary.replaceChildren(n('p','目的：'+(j.goal.purpose||'未設定')),n('p','達成条件：'+(j.goal.criteria||'未設定')),n('p','現在地：'+(j.goal.current||'未設定')),n('p','方針：'+(plan?.strategy||'未採用')));
   reviewSummary.textContent='次の振り返り日：'+(j.next_review||'未設定')+(j.next_review&&j.next_review<=A.dailyToday()?' ／ 実施状況・成果・負担を確認しましょう':'');reviewSummary.id='journeyNextReview';
   const counts=A.overallProgress(p.items),latest=j.outcomes.at(-1);reviewEvidence.textContent=`単発・週別チェック ${counts.done}/${counts.total}。最新の成果：${latest?latest.date+' '+(latest.value===null?'':latest.value+' '+latest.unit+' ')+latest.text:'未記録'}。成果はチェック数とは別に確認します。`;
   historyBody.replaceChildren();
   if(p.achieved_on)historyBody.append(n('p','従来の達成記録：'+p.achieved_on+'（旧チェック方式による記録）'));
   for(const o of [...savedJ.outcomes].reverse())historyBody.append(n('p',o.date+' ／ '+(o.value===null?'':o.value+' '+o.unit+' ／ ')+o.text));
   for(const r of [...savedJ.reviews].reverse())historyBody.append(n('p',r.date+' ／ '+{continue:'続ける',consult:'方針を相談',revise:'目標を見直す'}[r.choice]+' ／ 負担：'+r.burden+' ／ '+r.note+' ／ 見直し前の目標：'+r.title+' ／ 達成条件：'+r.goal.criteria+' ／ 現在地：'+r.goal.current+' ／ 期限：'+(r.due_date||'なし')));
   for(const h of [...savedJ.goal_history].reverse())historyBody.append(n('p',h.date+' に見直した以前の目標 ／ '+h.title+' ／ 目的：'+h.goal.purpose+' ／ 達成条件：'+h.goal.criteria+' ／ 現在地：'+h.goal.current+' ／ 期限：'+(h.due_date||'なし')));
   for(const plan of [...savedJ.plans].reverse())historyBody.append(n('p',plan.date+' 採用 ／ '+plan.strategy));
   for(const e of [...savedJ.events].reverse())historyBody.append(n('p',e.date+' ／ '+{active:'選択・再開',done:'完了',rest:'休み',cancelled:'休み取消'}[e.status]+' ／ '+(p.items.find(i=>i.id===e.item_id)?.text||p.deleted_items?.find(d=>d.item.id===e.item_id)?.item.text||'行動の記録')));
   if(!historyBody.children.length)historyBody.append(n('p','保存済みの成果・方針・振り返りはまだありません。'));
   formStatus.textContent=formsDirty?'未確定の入力があります。それぞれの確認ボタンで保存してください。':'';retry.hidden=!pending;refreshLocks();inputState?.();
  }
  return {refresh,hasEdits:()=>formsDirty,reset(){epoch++;projectId=null;formsDirty=false;dirtyForms.clear();pending=false;busy=false;pendingFinish=null;},open(ai){editor.open=true;editor.scrollIntoView({block:'start'});strategy.focus();if(ai)tryConsult();}};
 }
};
