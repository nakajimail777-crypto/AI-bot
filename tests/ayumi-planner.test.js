import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/ayumi-planner.js';
test('reviewed proposals create only unchecked fresh items and reject malformed proposals',()=>{
 const input={title:'公開準備',items:['プロフィールを書く','申込先を確認'],done:true};
 const p=DragonAyumiPlanner.plan(input),q=DragonAyumiPlanner.plan(input);
 assert.equal(p.items.length,2);assert.ok(p.items.every(i=>i.done===false));assert.notEqual(p.items[0].id,q.items[0].id);assert.equal(input.done,true);
 for(const value of [null,{title:'',items:['x']},{title:'x',items:[]},{title:'x',items:[{text:'x',done:true}]},{title:'x',items:Array(21).fill('x')}])assert.throws(()=>DragonAyumiPlanner.plan(value));
});
