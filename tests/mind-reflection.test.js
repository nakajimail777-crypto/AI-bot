import test from 'node:test';
import assert from 'node:assert/strict';
import {createReflection,selectFeeling,displayValue,validate,countText,fields,reflectionMessage,combineMessage} from '../assets/mind-reflection.js';

test('all blank fields can continue, without inferring any result',()=>{
  const state=createReflection('test');
  assert.deepEqual(validate(state),[]);
  assert.deepEqual(fields.map(f=>displayValue(state.fields[f.id])),Array(5).fill('回答なし'));
});
test('skip masks the original answer without losing it',()=>{
  const state=createReflection('test');
  state.fields.event.value='連絡を待っていました';
  state.fields.event.skipped=true;
  assert.equal(displayValue(state.fields.event),'スキップ');
  state.fields.event.skipped=false;
  assert.equal(displayValue(state.fields.event),'連絡を待っていました');
});
test('unknown feeling replaces other feelings and can itself be replaced',()=>{
  assert.deepEqual(selectFeeling(['不安','戸惑い'],'特にわからない',true),['特にわからない']);
  assert.deepEqual(selectFeeling(['特にわからない'],'安心',true),['安心']);
  assert.deepEqual(selectFeeling(['不安'],'戸惑い',true),['不安','戸惑い']);
  assert.deepEqual(selectFeeling(['不安'],'不安',false),[]);
});
test('invalid options and mutually exclusive values do not pass validation',()=>{
  const state=createReflection('test');
  state.fields.feeling.value=['不安','特にわからない'];
  state.fields.afterglow.value='未定義';
  assert.deepEqual(validate(state).map(e=>e.id),['feeling','afterglow']);
});
test('2000 Unicode codepoints are accepted; 2001 are rejected',()=>{
  const state=createReflection('test');
  state.fields.event.value='😊'.repeat(2000);
  assert.equal(countText(state.fields.event.value),2000);
  assert.deepEqual(validate(state),[]);
  state.fields.event.value+='あ';
  assert.equal(validate(state)[0].id,'event');
});
test('rendering preserves literal user text and never generates interpretation',()=>{
  const value='<script>alert(1)</script>\n  自分の言葉';
  assert.equal(displayValue({value,skipped:false}),value);
  assert.equal(displayValue({value:['安心','うれしい'],skipped:false}),'安心、うれしい');
});
test('sharing excludes retained values in skipped fields and does not mutate results',()=>{
  const state=createReflection('test');
  state.fields.event.value='送らない内容';state.fields.event.skipped=true;
  state.fields.interpretation.value='本人の言葉';
  const before=JSON.stringify(state),message=reflectionMessage(state);
  assert.ok(!message.includes('送らない内容'));
  assert.ok(message.includes('出来事\nスキップ'));
  assert.ok(message.includes('受け取り方\n本人の言葉'));
  assert.equal(JSON.stringify(state),before);
});
test('sharing keeps unfinished chat text and avoids appending an identical suffix twice',()=>{
  assert.equal(combineMessage('書きかけ\n','結果'),'書きかけ\n\n\n結果');
  assert.equal(combineMessage('書きかけ\n\n結果','結果'),'書きかけ\n\n結果');
  assert.equal(combineMessage('','結果'),'結果');
});
test('feeling notes work alone or with choices, survive skipping, and reach consultation text',()=>{
  const state=createReflection('test'),item=state.fields.feeling;
  item.note='胸がぎゅっとした。\n少し寂しかった。';
  assert.equal(displayValue(item),item.note);
  item.value=['不安'];
  assert.equal(displayValue(item),'不安\n'+item.note);
  assert.ok(reflectionMessage(state).includes(item.note));
  item.skipped=true;
  assert.equal(displayValue(item),'スキップ');
  assert.ok(!reflectionMessage(state).includes(item.note));
  item.skipped=false;
  assert.deepEqual(validate(state),[]);
  item.note='あ'.repeat(2001);
  assert.equal(validate(state)[0].id,'feeling');
});
