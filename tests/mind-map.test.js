import test from 'node:test';
import assert from 'node:assert/strict';
import {createReflection,restoreReflection} from '../assets/mind-reflection.js';
import {mapCards,createMindMap} from '../assets/mind-map.js';
const sample=()=>createReflection('11111111-1111-4111-8111-111111111111');
test('map keeps five explicit fields, notes, unknowns and exact whitespace without mutation',()=>{
 const r=sample();r.fields.event.value=' 体重が増加した\n';r.fields.feeling.value=['戸惑い'];r.fields.feeling.note='おなかの肉が引っかかる';r.fields.interpretation.value='ちょっと動きにくい';r.fields.reaction.value='ダイエット頑張ろう';r.fields.afterglow.value='よくわからない';
 const before=JSON.stringify(r),cards=mapCards(r);
 assert.deepEqual(cards.map(c=>c.text),[' 体重が増加した\n','戸惑い\nおなかの肉が引っかかる','ちょっと動きにくい','ダイエット頑張ろう','よくわからない']);assert.equal(JSON.stringify(r),before);
 assert.deepEqual(mapCards(restoreReflection(r)),cards);
});
test('blank and skipped fields do not expose hidden input or invent feelings',()=>{
 const r=sample();assert.deepEqual(mapCards(r).map(c=>c.text),Array(5).fill('まだ言葉になっていない'));
 r.fields.feeling.note='非表示の内容';r.fields.feeling.skipped=true;r.fields.event.value=' \n ';
 assert.equal(mapCards(r)[1].text,'スキップした項目');assert.ok(!JSON.stringify(mapCards(r)).includes('非表示の内容'));assert.equal(mapCards(r)[0].text,'まだ言葉になっていない');
});
function dom(){
 const doc={createElement:tag=>new Element(tag),createTextNode:text=>({tag:'#text',textContent:text})};
 class Element{constructor(tag){this.tag=tag;this.ownerDocument=doc;this.children=[];this.attrs={};this.listeners={};}setAttribute(k,v){this.attrs[k]=v;}append(...nodes){this.children.push(...nodes);}prepend(n){this.children.unshift(n);}replaceChildren(...nodes){this.children=nodes;}addEventListener(k,f){this.listeners[k]=f;}}
 return new Element('host');
}
test('map is opt-in, accessible, reusable and removable, and treats HTML as text',()=>{
 const host=dom();let returned;const map=createMindMap(host,node=>{returned=node;});const panel=host.children[0];assert.equal(panel.hidden,true);
 const r=sample();const literal='<img src=x onerror=alert(1)>\n'+'長'.repeat(2000);r.fields.event.value=literal;
 const toggle=map.show(r),list=panel.children[3];assert.equal(panel.hidden,false);assert.equal(toggle.attrs['aria-expanded'],'true');assert.equal(list.children.length,5);
 assert.equal(list.children[0].children[0].children[1].textContent,literal);
 assert.equal(list.children[0].children[1].attrs['aria-hidden'],'true');
 toggle.listeners.click();assert.equal(list.hidden,true);assert.equal(toggle.attrs['aria-expanded'],'false');toggle.listeners.click();assert.equal(list.hidden,false);
 const back=panel.children[2].children[1];back.listeners.click();assert.equal(returned,back);
 map.show(sample());assert.equal(host.children.length,1);assert.equal(list.children.length,5);assert.equal(list.children[0].children[0].children[1].textContent,'まだ言葉になっていない');
 map.clear();assert.equal(panel.hidden,true);assert.equal(list.children.length,0);
});
