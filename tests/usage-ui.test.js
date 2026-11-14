import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context=vm.createContext({window:{}});
vm.runInContext(await readFile(new URL('../assets/usage-ui.js',import.meta.url),'utf8'),context);
const ui=context.window.DragonUsage;
test('unrecorded replies and unknown metadata never display zero cost',()=>{
 assert.match(ui.answer(null),/未記録/);
 const text=ui.answer({generation:{billingMode:'unknown'},recorded:false});
 assert.match(text,/未取得/);assert.ok(!text.includes('$0.000000'));assert.match(text,/月間累計に含まれない/);
});
test('monthly view identifies unknown amounts and admin scope',()=>{
 const text=ui.monthly({month:'2026-09',scope:'all',monthly:{estimatedUsd:1,billedUsd:0,unknownCalls:2,billingUnknownCalls:1,categories:[]}});
 assert.match(text,/サービス全体/);assert.match(text,/未取得分/);assert.match(text,/未確定/);
});

test('answer labels come from the response receipt and distinguish local fallback text',()=>{
 assert.equal(ui.provider({provider:'openai',generation:{model:'gpt-5.4-mini-2026-03-17'}}),'OpenAI · gpt-5.4-mini-2026-03-17');
 assert.equal(ui.provider({generation:{model:'gemini-3.7-flash'}}),'Gemini · gemini-3.7-flash');
 assert.equal(ui.provider(null),'');
 assert.equal(ui.provider({provider:'openai',replySource:'fallback',generation:{model:'gpt-5.4-mini-2026-03-17'}}),'定型の案内');
 assert.equal(ui.provider({provider:'openai',replySource:'cached'}),'保存済みの返信');
 assert.match(ui.answer({provider:'openai',generation:{model:'gpt-5.4-mini-2026-03-17',input:50,output:20,total:70}}),/OpenAI/);
});
