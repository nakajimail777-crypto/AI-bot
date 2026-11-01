import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/ayumi.js';
const A=DragonAyumi,today='2026-11-01',tomorrow='2026-11-02';
const goal=()=>({id:'g',title:'Instagram公開準備（テスト）',due_date:'2026-11-09',items:Array.from({length:13},(_,n)=>({id:`i${n+1}`,text:`作業${n+1}`,done:n<5})),insight:'対象は初めての人。'});
test('5/13 proposes sixth without mutation; completion stays today and advances tomorrow',()=>{
 const p=goal(),before=JSON.stringify(p);assert.equal(A.focusState(p,today).item.id,'i6');assert.equal(JSON.stringify(p),before);
 const done=A.normalize(A.focusChange(p,'done','i6',today));
 assert.equal(A.overallProgress(done.items).done,6);assert.equal(A.focusState(done,today).kind,'done');
 assert.equal(A.focusState(structuredClone(done),today).item.id,'i6');assert.equal(A.focusState(done,tomorrow).item.id,'i7');
 assert.equal(A.overallProgress(A.focusChange(done,'done','i6',today).items).done,6);
 const more=A.focusChange(done,'start','i7',today);assert.equal(A.focusState(more,today).item.id,'i7');
});
test('explicit selection, existing today plans, unfinished carryover and future plans',()=>{
 let p=goal();p.items[5].scheduled_on=tomorrow;p.items[7].scheduled_on=today;p.items[8].scheduled_on=today;
 assert.equal(A.focusState(p,today).item.id,'i8');
 p=A.focusChange(p,'start','i10',today);assert.equal(A.focusState(p,today).item.id,'i10');
 assert.equal(A.focusState(p,tomorrow).item.id,'i6'); // existing plan for that day wins
 delete p.items[5].scheduled_on;assert.equal(A.focusState(p,tomorrow).item.id,'i10');
 assert.equal(p.items[7].scheduled_on,today);assert.equal(p.items[8].scheduled_on,today);
 assert.throws(()=>A.focusChange({...p,items:p.items.map(i=>i.id==='i10'?{...i,scheduled_on:'2026-12-01'}:i)},'start','i10',today));
});
test('rest does not complete tasks, resumes next day; undo keeps metadata consistent',()=>{
 let p=A.focusChange(goal(),'rest','i8',today);assert.equal(A.focusState(A.normalize(p),today).kind,'rest');assert.equal(A.overallProgress(p.items).done,5);
 assert.equal(A.focusState(p,tomorrow).item.id,'i8');
 p=A.focusChange(p,'done','i8',today);p=A.focusChange(p,'undo','i8',today);assert.equal(A.focusState(p,today).kind,'active');assert.equal(A.overallProgress(p.items).done,5);
 p=A.focusChange(p,'done','i8',today);p.items[7].done=false;assert.equal(A.normalize(p).focus_day.status,'active');
});
test('old completions are not dated today; deleted, recurring, archived and empty are handled',()=>{
 let p=goal();p.items.forEach(i=>i.done=true);assert.equal(A.focusState(p,today).kind,'complete');assert.equal(A.normalize(p).focus_day,null);
 p=goal();p.focus_day={date:today,item_id:'missing',status:'active'};assert.equal(A.focusState(p,today).item.id,'i6');
 for(const archived of [{archived:true},{deleted_goal:true}])assert.equal(A.focusState({...p,...archived},today).kind,'archived');
 assert.equal(A.focusState({...p,items:[]},today).kind,'empty');
 const daily={id:'d',text:'Daily',done:false,daily:A.dailyRange(today,tomorrow)};
 const weekly={id:'w',text:'Weekly',done:false,weeks:[{start:today,done:false}]};
 for(const items of [[daily],[weekly],[daily,weekly]])assert.equal(A.focusState({...p,items},today).kind,'records');
 assert.equal(A.focusState({...p,items:[{id:'f',text:'Future',done:false,scheduled_on:tomorrow}]},today).kind,'future');
 assert.throws(()=>A.focusChange({...p,items:[daily]},'done','d',today));
});
test('focused prompt contains only selected work, current goal and bounded note; never mutates',()=>{
 const p=goal(),before=JSON.stringify(p),prompt=A.focusPrompt(p,'i6',today);
 assert.match(prompt,/項目ID：i6/);assert.match(prompt,/今日の1個：作業6/);assert.match(prompt,/5\/13/);assert.match(prompt,/2026-11-09/);assert.match(prompt,/対象は初めての人/);
 assert.ok(!prompt.includes('作業7'));assert.match(prompt,/本人/);assert.equal(JSON.stringify(p),before);
 assert.throws(()=>A.focusPrompt(p,'i1',today));
 assert.throws(()=>A.normalize({...p,focus_day:{date:'2026-02-30',item_id:'i6',status:'done'}}));
});
test('Tokyo day changes at UTC 15:00 and unfinished blank input is not proposed',()=>{
 const RealDate=globalThis.Date;let now='2026-11-01T14:59:59Z';
 try{globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}};
  assert.equal(A.dailyToday(),'2026-11-01');now='2026-11-01T15:00:00Z';assert.equal(A.dailyToday(),'2026-11-02');
 }finally{globalThis.Date=RealDate;}
 assert.equal(A.focusState({...goal(),items:[{id:'blank',text:'',done:false}]},today).kind,'empty');
});
