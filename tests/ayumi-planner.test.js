import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/ayumi-planner.js';
test('reviewed proposals create only unchecked fresh items and reject malformed proposals',()=>{
 const input={title:'公開準備',items:['プロフィールを書く','申込先を確認'],done:true};
 const p=DragonAyumiPlanner.plan(input),q=DragonAyumiPlanner.plan(input);
 assert.equal(p.items.length,2);assert.ok(p.items.every(i=>i.done===false));assert.notEqual(p.items[0].id,q.items[0].id);assert.equal(input.done,true);
 for(const value of [null,{title:'',items:['x']},{title:'x',items:[]},{title:'x',items:[{text:'x',done:true}]},{title:'x',items:Array(21).fill('x')}])assert.throws(()=>DragonAyumiPlanner.plan(value));
});

test('adoption waits for saving, prevents repeated clicks and keeps proposals on failure',async()=>{
 const previousDocument=globalThis.document,previousFetch=globalThis.fetch;
 const elements=new Map();
 const element=()=>({value:'',hidden:false,disabled:false,textContent:'',children:[],replaceChildren(){this.children=[];},append(...nodes){this.children.push(...nodes);},setAttribute(){}});
 globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element};
 const el=id=>document.getElementById(id);
 globalThis.fetch=async()=>({ok:true,json:async()=>({plan:{title:'読書',items:['一頁読む']}})});
 try{
  let calls=0,settle;
  const planner=DragonAyumiPlanner.mount({context:()=>({session:{user:{id:'owner'}},db:{auth:{getSession:async()=>({data:{session:{user:{id:'owner'},access_token:'test'}}})}}}),apply:()=>{calls++;return new Promise((resolve,reject)=>{settle={resolve,reject};});}});
  el('ayumiPlanGoal').value='読書';await el('ayumiPlanGenerate').onclick();
  assert.equal(calls,0);
  const failed=el('ayumiPlanApply').onclick();await el('ayumiPlanApply').onclick();
  assert.equal(calls,1);assert.equal(el('ayumiPlanApply').disabled,true);assert.equal(el('ayumiPlanReview').hidden,false);
  settle.reject(new Error('通信に失敗'));await failed;
  assert.equal(el('ayumiPlanReview').hidden,false);assert.equal(el('ayumiPlanStatus').textContent,'通信に失敗');assert.equal(el('ayumiPlanApply').disabled,false);
  const saved=el('ayumiPlanApply').onclick();settle.resolve(true);await saved;
  assert.equal(el('ayumiPlanReview').hidden,true);assert.match(el('ayumiPlanStatus').textContent,/保存し、取り組み中/);
  await el('ayumiPlanGenerate').onclick();const cancelled=el('ayumiPlanApply').onclick();settle.resolve(false);await cancelled;
  assert.equal(el('ayumiPlanReview').hidden,false);
  const reset=el('ayumiPlanApply').onclick();planner.reset();settle.resolve(true);await reset;
  assert.equal(el('ayumiPlanStatus').textContent,'');
 }finally{globalThis.document=previousDocument;globalThis.fetch=previousFetch;}
});
