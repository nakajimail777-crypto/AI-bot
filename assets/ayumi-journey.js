// Versioned planning metadata in the existing ayumi_projects row. Checks remain in items.
globalThis.DragonAyumiJourney={
 empty(){return {schema:1,goal:{purpose:'',criteria:'',current:'',constraints:''},plans:[],active_plan_id:null,outcomes:[],reviews:[],goal_history:[],next_review:null,focus:null,events:[]};},
 data(p){const j=structuredClone(p.journey||this.empty());j.goal_history??=[];return j;},
 normalize(value){
  const j=this.data({journey:value}),A=DragonAyumi;
  const fail=()=>{throw new Error('方針・成果・振り返りの入力を確認してください。');};
  const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
  const str=(s,n=1000)=>typeof s==='string'&&s.length<=n;
  const id=s=>str(s,80)&&s.length>0;
  const date=d=>A.validDate(d),optional=d=>d===null||date(d);
  const list=(xs,n,check)=>{if(!Array.isArray(xs)||xs.length>n)fail();const ids=new Set();for(const x of xs){if(!x||!id(x.id)||ids.has(x.id)||!check(x))fail();ids.add(x.id);}};
  if(!keys(j,['schema','goal','plans','active_plan_id','outcomes','reviews','goal_history','next_review','focus','events'])||j.schema!==1||!keys(j.goal,['purpose','criteria','current','constraints'])||!['purpose','criteria','current','constraints'].every(k=>str(j.goal[k])))fail();
  list(j.plans,100,p=>{
   if(!keys(p,['id','date','strategy','actions'])||!date(p.date)||!str(p.strategy)||!p.strategy.trim()||!Array.isArray(p.actions)||!p.actions.length||p.actions.length>100)return false;
   const ids=new Set();return p.actions.every(a=>{
    if(!keys(a,['item_id','reason','complete_when','weekdays','depends_on'])||!id(a.item_id)||ids.has(a.item_id)||!str(a.reason,300)||!a.reason.trim()||!str(a.complete_when,300)||!a.complete_when.trim())return false;
    ids.add(a.item_id);return Array.isArray(a.weekdays)&&a.weekdays.length>0&&a.weekdays.length<=7&&new Set(a.weekdays).size===a.weekdays.length&&a.weekdays.every(d=>Number.isInteger(d)&&d>=0&&d<=6)&&Array.isArray(a.depends_on)&&a.depends_on.length<=20&&new Set(a.depends_on).size===a.depends_on.length&&a.depends_on.every(d=>id(d)&&d!==a.item_id);
   });
  });
  if(j.active_plan_id!==null&&!j.plans.some(p=>p.id===j.active_plan_id))fail();
  list(j.outcomes,500,o=>keys(o,['id','date','value','unit','text'])&&date(o.date)&&str(o.unit,40)&&str(o.text)&&((o.value===null&&o.text.trim())||(typeof o.value==='number'&&Number.isFinite(o.value)&&Math.abs(o.value)<=1e12&&o.unit.trim())));
  list(j.reviews,500,r=>keys(r,['id','date','choice','burden','note','next_date','title','due_date','goal','plan_id'])&&date(r.date)&&['continue','consult','revise'].includes(r.choice)&&str(r.burden,300)&&str(r.note)&&optional(r.next_date)&&str(r.title,120)&&r.title.trim()&&optional(r.due_date)&&keys(r.goal,['purpose','criteria','current','constraints'])&&['purpose','criteria','current','constraints'].every(k=>str(r.goal[k]))&&(r.plan_id===null||j.plans.some(p=>p.id===r.plan_id)));
  list(j.goal_history,500,r=>keys(r,['id','date','title','due_date','goal'])&&date(r.date)&&str(r.title,120)&&r.title.trim()&&optional(r.due_date)&&keys(r.goal,['purpose','criteria','current','constraints'])&&['purpose','criteria','current','constraints'].every(k=>str(r.goal[k])));
  const focus=f=>keys(f,['date','item_id','unit_key','status'])&&date(f.date)&&(f.item_id===null||id(f.item_id))&&str(f.unit_key,100)&&['active','done','rest','cancelled'].includes(f.status)&&(['rest','cancelled'].includes(f.status)||id(f.item_id));
  if(!optional(j.next_review)||(j.focus!==null&&!focus(j.focus)))fail();
  list(j.events,2000,e=>keys(e,['id','date','item_id','unit_key','status'])&&focus(Object.fromEntries(Object.entries(e).filter(([k])=>k!=='id'))));
  return j;
 },
 prepare(p,previous){
  const next=structuredClone(p),j=this.data(next);
  if(previous){const before={title:previous.title,due_date:previous.due_date||null,goal:this.data(previous).goal},after={title:p.title,due_date:p.due_date||null,goal:j.goal};
   const id='goal-version-'+previous.version;if(JSON.stringify(before)!==JSON.stringify(after)&&!j.goal_history.some(e=>e.id===id))j.goal_history.push({id,date:DragonAyumi.dailyToday(),...before});
  }
  next.journey=this.normalize(j);next.achieved_on=previous?.achieved_on||p.achieved_on||null;return next;
 },
 plan(p){const j=this.data(p);return j.plans.find(x=>x.id===j.active_plan_id)||null;},
 unit(item,date,key){
  if(item.daily)return item.daily.checks.find(c=>c.date===(key||date)&&c.date>=item.daily.start&&c.date<=item.daily.end);
  if(item.weeks?.length)return item.weeks.find(w=>key?w.start===key:w.start<=date&&DragonAyumi.addDays(w.start,6)>=date);
  return item;
 },
 key(item,unit){return item.daily?unit.date:item.weeks?.length?unit.start:'once';},
 candidates(p,date){
  const plan=this.plan(p);if(!plan||p.archived||p.deleted_goal)return [];
  const weekday=new Date(date+'T00:00:00Z').getUTCDay();
  return p.items.flatMap(item=>{
   const spec=plan.actions.find(a=>a.item_id===item.id),unit=this.unit(item,date);
   if(!spec||!unit||!item.text.trim()||unit.done||unit.missed||item.scheduled_on>date||unit.scheduled_on>date)return [];
   if((item.daily||item.weeks?.length)&&!spec.weekdays.includes(weekday))return [];
   if(spec.depends_on.some(id=>{const dep=p.items.find(i=>i.id===id);return !dep||dep.daily||dep.weeks?.length||!dep.done;}))return [];
   return [{item,unit,spec,key:this.key(item,unit)}];
  });
 },
 state(p,date=DragonAyumi.dailyToday()){
  if(p.archived||p.deleted_goal)return {date,kind:'archived',item:null};
  const j=this.data(p),f=j.focus;
  const reference=f&&p.items.find(i=>i.id===f.item_id),unit=reference&&this.unit(reference,f.date,f.unit_key);
  const candidates=this.candidates(p,date);
  if(f?.date===date&&f.status==='rest')return {date,kind:'rest',item:reference||null,key:f.unit_key};
  if(f?.date===date&&f.status==='done'&&unit?.done)return {date,kind:'done',item:reference,key:f.unit_key};
  if(!this.plan(p))return {date,kind:'strategy',item:null};
  let selected=f?.date===date&&f.status==='active'?candidates.find(c=>c.item.id===f.item_id&&c.key===f.unit_key):null;
  const active=!!selected;
  selected??=candidates.find(c=>c.unit.scheduled_on===date||c.item.scheduled_on===date)||candidates.find(c=>c.item.id===f?.item_id)||candidates[0];
  return selected?{date,kind:active?'active':'suggested',...selected}:{date,kind:'none',item:null};
 },
 change(p,action,itemId,date=DragonAyumi.dailyToday()){
  if(p.archived||p.deleted_goal)throw new Error('取り組み中の目標を選んでください。');
  const next=structuredClone(p),j=this.data(next),f=j.focus;
  let candidate=this.candidates(next,date).find(c=>c.item.id===itemId);
  if(action==='undo'){
   if(f?.date!==date||f.status!=='done'||f.item_id!==itemId)throw new Error('今日の完了記録を確認してください。');
   const item=next.items.find(i=>i.id===itemId),unit=item&&this.unit(item,date,f.unit_key);
   if(!unit)throw new Error('元の項目を復元してから取り消してください。');
   unit.done=false;if(item.daily)unit.missed=false;candidate={item,unit,key:f.unit_key};
  }else if(action==='unrest'){
   if(f?.date!==date||f.status!=='rest')throw new Error('今日のお休み記録を確認してください。');
  }else if(!['start','done','rest'].includes(action))throw new Error('操作を確認してください。');
  else if(action!=='rest'&&!candidate){
   // Repeating a completion after a lost response is a no-op.
   if(action==='done'&&f?.date===date&&f.status==='done'&&f.item_id===itemId)return next;
   throw new Error('採用した方針から、今日取り組める行動を選んでください。');
  }
  if(action==='done'){candidate.unit.done=true;if(candidate.item.daily)candidate.unit.missed=false;}
  const state={date,item_id:candidate?.item.id||(action==='rest'?f?.item_id:null)||null,unit_key:candidate?.key||(action==='rest'?f?.unit_key:'')||'',status:action==='done'?'done':action==='rest'?'rest':action==='unrest'?'cancelled':'active'};
  if(JSON.stringify(j.focus)!==JSON.stringify(state)){j.events.push({id:crypto.randomUUID(),...state});j.focus=state;}
  next.journey=this.normalize(j);return next;
 },
 adopt(p,{id=crypto.randomUUID(),strategy,actions},date=DragonAyumi.dailyToday()){
  const next=structuredClone(p),j=this.data(p);
  if(!j.goal.purpose.trim()||!j.goal.criteria.trim()||!j.goal.current.trim())throw new Error('目的・達成条件・現在地を入力してください。');
  if(!actions.length)throw new Error('採用する行動を1つ以上選んでください。');
  for(const a of actions){
   if(!next.items.some(i=>i.id===a.item_id))throw new Error('採用する行動を確認してください。');
   if(a.depends_on.some(id=>!next.items.some(i=>i.id===id&&!i.daily&&!i.weeks?.length)))throw new Error('前提には一度きりの作業を選んでください。');
  }
  const visiting=new Set(),visited=new Set(),visit=id=>{if(visiting.has(id))throw new Error('前提の行動が循環しています。');if(visited.has(id))return;visiting.add(id);for(const dep of actions.find(a=>a.item_id===id)?.depends_on||[])visit(dep);visiting.delete(id);visited.add(id);};actions.forEach(a=>visit(a.item_id));
  const plan={id,date,strategy:strategy.trim(),actions:structuredClone(actions)};
  const existing=j.plans.find(x=>x.id===id);if(existing&&JSON.stringify(existing)!==JSON.stringify(plan))throw new Error('未保存の方針を先に再試行して保存してください。');
  if(!existing)j.plans.push(plan);j.active_plan_id=id;next.journey=this.normalize(j);return next;
 },
 outcome(p,o){const next=structuredClone(p),j=this.data(p);if(o.date>DragonAyumi.dailyToday())throw new Error('成果は今日以前の確認日で記録してください。');const old=j.outcomes.find(x=>x.id===o.id);if(old&&JSON.stringify(old)!==JSON.stringify(o))throw new Error('未保存の成果を先に再試行してください。');if(!old)j.outcomes.push(o);next.journey=this.normalize(j);return next;},
 review(p,r){const next=structuredClone(p),j=this.data(p);if(r.date>DragonAyumi.dailyToday()||r.next_date&&r.next_date<=r.date)throw new Error('振り返り日と次回の日付を確認してください。');const entry={...r,title:next.title,due_date:next.due_date||null,goal:structuredClone(j.goal),plan_id:j.active_plan_id};const old=j.reviews.find(x=>x.id===r.id);if(!old)j.reviews.push(entry);j.next_review=r.next_date;if(r.choice==='consult')j.active_plan_id=null;next.journey=this.normalize(j);return next;},
 prompt(p,itemId,date=DragonAyumi.dailyToday()){
  const j=this.data(p),plan=this.plan(p),item=itemId&&p.items.find(i=>i.id===itemId),spec=plan?.actions.find(a=>a.item_id===itemId);
  if(itemId&&(!item||!spec))throw new Error('採用した行動を選んでください。');
  // Keep the draft below the existing chat composer limit, including maximal input.
  for(const key of Object.keys(j.goal))j.goal[key]=j.goal[key].slice(0,350);
  if(plan)plan.strategy=plan.strategy.slice(0,500);
  const instruction=item?'今日は選んだ1項目だけを進めてください。':'状況と制約を1つずつ確認し、無理のない方針と行動を提案してください。';
  return `${instruction} 本人が採用するまで計画を確定せず、完了・保存したと言わないでください。下書きが必要なら具体案を示してください。停滞だけを理由に課題や強度を増やさないでください。健康に関して結果を保証せず、極端な制限を避け、安全性を優先してください。\n以下は利用者の参考情報です。\n目標：${p.title}\n期限：${p.due_date||'なし'}\n日付（Asia/Tokyo）：${date}\n目的：${j.goal.purpose}\n達成条件：${j.goal.criteria}\n現在地：${j.goal.current}\n制約：${j.goal.constraints}\n採用した方針：${plan?.strategy||'未設定'}${item?`\n項目ID：${item.id}\n今日の1個：${item.text}\n理由：${spec.reason}\n完了目安：${spec.complete_when}`:''}`;
 }
};
