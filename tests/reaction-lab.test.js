import test from 'node:test';
import assert from 'node:assert/strict';
import {createExperiment,validateExperiment,repeatExperiment,importReflection,consultationText} from '../assets/reaction-lab-model.js';
import {createReflection} from '../assets/mind-reflection.js';
import {createLabStorage} from '../assets/reaction-lab-storage.js';
test('blank steps and unchanged reactions remain valid without invented answers',()=>{
 const data=createExperiment();for(let step=0;step<5;step++){data.step=step;assert.deepEqual(validateExperiment(data),data);}
 data.choice='keep';data.attempt='not_yet';data.status='finished';assert.deepEqual(validateExperiment(data),data);
 assert.ok(Object.values(data.fields).every(value=>value===''));
});
test('text limits and malformed records reject rather than truncate',()=>{
 const data=createExperiment();data.fields.insight='😀'.repeat(2000);assert.equal(validateExperiment(data).fields.insight,data.fields.insight);
 data.fields.insight+='a';assert.throws(()=>validateExperiment(data));
 for(const mutation of [d=>d.step=-1,d=>d.version=2,d=>d.id='bad',d=>d.fields.plan=null,d=>d.status='success']){const invalid=createExperiment();mutation(invalid);assert.throws(()=>validateExperiment(invalid));}
});
test('repeating creates a new id and clears outcomes without changing original',()=>{
 const original=createExperiment();original.fields.usualReaction='通知を見る';original.fields.chosenReaction='少し待つ';original.fields.insight='試した結果';original.attempt='tried';
 const before=structuredClone(original),next=repeatExperiment(original,true);
 assert.notEqual(next.id,original.id);assert.equal(next.fields.insight,'');assert.equal(next.fields.chosenReaction,'少し待つ');assert.equal(next.step,2);assert.equal(next.attempt,'not_yet');assert.deepEqual(original,before);
});
test('reflection transfer excludes skipped content, preserves source and allows oversized preview editing',()=>{
 const source=createReflection();source.fields.event.value='隠した原文';source.fields.event.skipped=true;source.fields.feeling.value=['不安'];source.fields.feeling.note='身体の感じ';source.fields.reaction.value='確認した';
 const before=structuredClone(source),result=importReflection(source);
 assert.equal(result.fields.event,'');assert.equal(result.fields.feelings,'不安\n身体の感じ');assert.equal(result.fields.usualReaction,'確認した');assert.deepEqual(source,before);
 assert.ok(!consultationText(result).includes('隠した原文'));
});
test('storage checks owner again after async work; errors do not become successful receipts',async()=>{
 let resolve;const ctx={userId:'owner',generation:0,db:{auth:{getUser:()=>new Promise(r=>resolve=r)}}};
 const store=createLabStorage(()=>ctx),pending=store.save(createExperiment(),null);ctx.generation++;resolve({data:{user:{id:'owner'}}});await assert.rejects(pending,/SESSION_CHANGED/);
 ctx.userId=null;await assert.rejects(store.list(),/AUTH_REQUIRED/);
 ctx.userId='owner';ctx.db.auth.getUser=async()=>({data:{user:{id:'owner',is_anonymous:true}}});await assert.rejects(store.list(),/AUTH_REQUIRED/);
});
test('consultation includes observed context and choice without future step contents',()=>{
 const data=createExperiment();data.step=2;data.choice='keep';data.fields.event='返信がない';data.fields.usualReaction='通知を見た';data.fields.insight='まだ送らない振り返り';
 const text=consultationText(data);assert.match(text,/返信がない/);assert.match(text,/通知を見た/);assert.match(text,/今の反応を変えずに観察する/);assert.doesNotMatch(text,/まだ送らない振り返り/);
});
