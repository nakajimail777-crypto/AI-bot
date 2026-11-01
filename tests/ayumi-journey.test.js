import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/ayumi.js';
import '../assets/ayumi-journey.js';
const A=DragonAyumi,J=DragonAyumiJourney;
const date='2026-11-01',next='2026-11-02';
const base=()=>({id:'goal',title:'読書を楽しむ（合成データ）',items:[{id:'a',text:'本を選ぶ',done:false},{id:'b',text:'1ページ読む',done:false,daily:A.dailyRange(date,'2026-11-03')},{id:'c',text:'メモを書く',done:false}],insight:'',due_date:null});
const action=(item_id,extra={})=>({item_id,reason:'読書を続けるため',complete_when:'内容を1つ確認する',weekdays:[0,1,2,3,4,5,6],depends_on:[],...extra});
const planned=()=>{const p=base();p.journey=J.empty();p.journey.goal={purpose:'楽しむ',criteria:'感想を言える',current:'本を探している',constraints:'短時間'};return J.adopt(p,{strategy:'少しずつ読む',actions:p.items.map(i=>action(i.id))},date);};
test('legacy data has no consent, preserves IDs, checks, undated insights and achieved_on',()=>{
 const p={...base(),achieved_on:'2026-10-01'};p.items[0].done=true;
 const copy=JSON.stringify(p),n=A.normalize(p);assert.equal(J.state(p,date).kind,'strategy');assert.equal(n.journey.active_plan_id,null);assert.deepEqual(n.items,p.items);
 assert.equal(A.prepareAchievement({...p,items:[]},p).achieved_on,p.achieved_on);assert.equal(A.confirmedAchievement(p,p),null);assert.equal(JSON.stringify(p),copy);
 assert.equal(A.prepareAchievement({...base(),items:[{id:'a',text:'done',done:true}]},null).achieved_on,null);
});
test('only adopted items; reason and completion condition mandatory; cyclic prerequisites rejected',()=>{
 const p=planned();assert.throws(()=>J.adopt(p,{strategy:'x',actions:[action('a',{reason:''})]}));assert.throws(()=>J.adopt(p,{strategy:'x',actions:[action('a',{depends_on:['c']}),action('c',{depends_on:['a']})]}),/循環/);
 const limited=J.adopt(p,{strategy:'1個ずつ',actions:[action('c')]},date);assert.equal(J.state(limited,date).item.id,'c');assert.equal(limited.journey.plans.length,2);
 assert.throws(()=>J.adopt(p,{strategy:'x',actions:[action('a',{depends_on:['b']})]}),/一度きり/);
});
test('stable current choice, scheduled dates and prerequisite ordering',()=>{
 let p=planned();p.items[0].scheduled_on=next;p=J.adopt(p,{strategy:'順番に',actions:[action('a'),action('b',{depends_on:['a']}),action('c',{depends_on:['a']})]},date);
 assert.equal(J.state(p,date).kind,'none');assert.equal(J.state(p,next).item.id,'a');
 p=J.change(p,'start','a',next);const before=JSON.stringify(p);assert.equal(J.state(p,next).kind,'active');assert.equal(J.state(structuredClone(p),next).item.id,'a');assert.equal(JSON.stringify(p),before);
 p=J.change(p,'done','a',next);assert.equal(J.state(p,next).kind,'done');assert.equal(J.state(p,'2026-11-03').item.id,'b');assert.equal(p.journey.outcomes.length,0);
});
test('daily habit completes only one occurrence, respects weekdays, never queues missed dates',()=>{
 let p=planned();p.items[0].done=true;p.items[2].done=true;
 p=J.change(p,'start','b',date);p=J.change(p,'done','b',date);assert.equal(p.items[1].done,false);assert.equal(p.items[1].daily.checks.filter(c=>c.done).length,1);
 assert.equal(J.state(p,date).kind,'done');assert.equal(J.state(p,next).item.id,'b');assert.equal(J.state(p,'2026-11-04').kind,'none');
 assert.equal(J.state(J.adopt(p,{strategy:'日曜だけ',actions:[action('b',{weekdays:[0]})]},date),next).kind,'none');
 const undone=J.change(p,'undo','b',date);assert.equal(undone.items[1].daily.checks[0].done,false);assert.equal(J.state(undone,date).kind,'active');
});
test('weekly habits use current week only; future weekly schedule never pulled forward',()=>{
 let p=planned();p.items=[{id:'w',text:'週のメモ',done:false,weeks:[{start:'2026-10-20',done:false},{start:date,done:false,scheduled_on:next}]}];p=J.adopt(p,{strategy:'週1回',actions:[action('w')]},date);
 assert.equal(J.state(p,date).kind,'none');p=J.change(p,'done','w',next);assert.equal(p.items[0].weeks[0].done,false);assert.equal(p.items[0].weeks[1].done,true);assert.equal(J.state(p,'2026-11-08').kind,'none');
});
test('rest does not count, cancellation with no eligible candidate and event history remain',()=>{
 let p=planned();p.items.forEach(i=>{i.scheduled_on='2027-01-01';});p=J.change(p,'rest',null,date);assert.equal(J.state(p,date).kind,'rest');assert.equal(A.overallProgress(p.items).done,0);
 const repeated=J.change(p,'rest',null,date);assert.equal(repeated.journey.events.length,1);p=J.change(p,'unrest',null,date);assert.equal(J.state(p,date).kind,'none');assert.equal(p.journey.events.length,2);assert.equal(J.state(p,next).kind,'none');
});
test('additional work is explicit; retries and undo preserve event history without duplicate completion',()=>{
 let p=J.change(planned(),'done','a',date);p=J.change(p,'done','a',date);assert.equal(p.journey.events.length,1);assert.equal(J.state(p,date).kind,'done');
 p=J.change(p,'start','c',date);p=J.change(p,'done','c',date);p=J.change(p,'undo','c',date);assert.equal(p.items[0].done,true);assert.equal(p.items[2].done,false);assert.equal(p.journey.events.filter(e=>e.status==='done').length,2);
 assert.equal(J.state({...p,archived:true},date).kind,'archived');assert.throws(()=>J.change({...p,archived:true},'rest',null,date));
});
test('measurement history is independent, validated, and retry uses stable ID',()=>{
 const p=planned(),o={id:'m1',date:'2020-01-01',value:2,unit:'冊',text:'確認した数'};
 const next=J.outcome(p,o);assert.deepEqual(next.items,p.items);assert.equal(next.journey.outcomes.length,1);assert.equal(J.outcome(next,o).journey.outcomes.length,1);
 assert.throws(()=>J.outcome(p,{...o,value:NaN}));assert.throws(()=>J.outcome(p,{...o,unit:''}));assert.throws(()=>J.outcome(p,{...o,value:null,text:''}));assert.throws(()=>J.outcome(p,{...o,date:'2999-01-01'}));
});
test('review records snapshots and next date only on explicit operation, consultation clears adoption',()=>{
 const p=planned(),copy=JSON.stringify(p),r={id:'r1',date:'2020-01-01',choice:'consult',burden:'軽い',note:'無理なく続ける',next_date:'2020-01-08'};
 const next=J.review(p,r);assert.equal(JSON.stringify(p),copy);assert.equal(next.journey.active_plan_id,null);assert.equal(next.journey.plans.length,1);assert.deepEqual(next.journey.reviews[0].goal,p.journey.goal);assert.equal(next.journey.next_review,r.next_date);assert.equal(J.review(next,r).journey.reviews.length,1);
 assert.throws(()=>J.review(p,{...r,next_date:r.date}));assert.equal(J.state(next,date).kind,'strategy');
});
test('bounded AI context is scoped to goal and selected action, no mutation',()=>{
 const p=planned();p.items[2].text='UNRELATED_ACTION';const before=JSON.stringify(p),prompt=J.prompt(p,'a',date);assert.ok(!prompt.includes('UNRELATED_ACTION'));assert.match(prompt,/項目ID：a/);assert.match(prompt,/極端な制限/);assert.match(prompt,/採用するまで/);assert.equal(JSON.stringify(p),before);
});
test('revision written and identical response-loss retry recognized for new data',async()=>{
 const p={...planned(),version:1,journey_revision:2};let payload,calls=0;
 const q={update(v){payload=v;return this;},eq(){return this;},select(){return this;},async maybeSingle(){return ++calls===1?{data:null,error:{code:'network'}}:{data:{...p,...payload,version:2},error:null};}};
 const db={auth:{async getUser(){return {data:{user:{id:'owner'}}};}},from(){return q;}};
 const saved=await A.save(db,'owner',p);assert.equal(payload.journey_revision,3);assert.equal(saved.version,2);
});

test('goal revisions preserve prior fields once per saved version without fabricating old dates',()=>{
 const previous={...planned(),version:4};const edited=structuredClone(previous);edited.title='別の目標';edited.journey.goal.current='進んだ';
 const saved=A.prepareAchievement(edited,previous);assert.equal(saved.journey.goal_history.length,1);assert.equal(saved.journey.goal_history[0].title,previous.title);assert.equal(saved.journey.goal_history[0].goal.current,previous.journey.goal.current);assert.equal(saved.journey.goal_history[0].date,A.dailyToday());
 assert.equal(A.prepareAchievement(saved,previous).journey.goal_history.length,1);
});
test('maximum supported fields fit existing AI composer limit',()=>{
 const p=planned();for(const key of Object.keys(p.journey.goal))p.journey.goal[key]='字'.repeat(1000);p.journey.plans[0].strategy='字'.repeat(1000);p.title='字'.repeat(120);p.items[0].text='字'.repeat(300);p.journey.plans[0].actions[0].reason='字'.repeat(300);p.journey.plans[0].actions[0].complete_when='字'.repeat(300);
 const before=JSON.stringify(p);assert.ok(J.prompt(p,'a',date).length<=4000);assert.equal(JSON.stringify(p),before);
});