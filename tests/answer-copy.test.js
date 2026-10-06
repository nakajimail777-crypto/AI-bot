import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../assets/app.js',import.meta.url),'utf8');
function setup({fallback=false,fail=false}={}){
 const copied=[],timers=[];
 const node=()=>({children:[],style:{},dataset:{},attrs:{},textContent:'',setAttribute(k,v){this.attrs[k]=v;},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},focus(){},select(){},setSelectionRange(){},remove(){this.removed=true;}});
 const body=node(),messages=node(),previous=node();previous.selectionStart=2;previous.selectionEnd=4;
 previous.setSelectionRange=(a,b)=>{previous.restored=[a,b];};
 const context=vm.createContext({document:{body,activeElement:previous,getSelection:()=>null,createElement:node,execCommand:()=>{if(fail)return false;copied.push(body.children.at(-1).value);return true;}},navigator:{clipboard:fallback?undefined:{writeText:async value=>copied.push(value)}},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},messages,rows:[],olderMore:false,session:null,DragonUsage:{answer:()=>''},usageCache:new Map()});
 vm.runInContext(source.slice(source.indexOf('async function copyAnswerText'),source.indexOf('function renderHistory')),context);
 return {context,copied,timers,body,messages,previous};
}
const samples=['短い回答','長い歌詞\n日本語と English 🎵\n'.repeat(1500),'[Verse]\n一行目\n二行目\n\n[Chorus]\n歌おう 🎶','# 見出し\n- 箇条書き\n**強調**\n```text\n記号 <>&\n```'];
for(const fallback of [false,true])test(`copies exact source independently and restores feedback (fallback=${fallback})`,async()=>{
 const s=setup({fallback});
 for(const value of samples){
  s.context.value=value;const button=vm.runInContext('answerCopyButton(value)',s.context);
  await button.onclick();assert.equal(s.copied.at(-1),value);assert.equal(button.textContent,'コピーしました ✓');
  s.timers.at(-1)();assert.equal(button.textContent,'コピー');
 }
 if(fallback){assert.ok(s.body.children.every(x=>x.removed));assert.deepEqual(s.previous.restored,[2,4]);}
});
test('clipboard rejection falls back; failure stays local and allows retry',async()=>{
 const s=setup({fallback:true,fail:true});
 const button=vm.runInContext('answerCopyButton("本文")',s.context);
 await button.onclick();assert.equal(button.textContent,'コピーできませんでした');assert.equal(s.copied.length,0);assert.ok(s.body.children[0].removed);
 s.context.navigator.clipboard={writeText:async value=>s.copied.push(value)};
 await button.onclick();assert.equal(s.copied[0],'本文');assert.equal(button.textContent,'コピーしました ✓');
 const t=setup();t.context.navigator.clipboard.writeText=async()=>{throw new Error('denied');};
 await vm.runInContext('copyAnswerText("fallback")',t.context);assert.equal(t.copied[0],'fallback');
});
test('render attaches copy only to assistant rows, including history and guest replies',async()=>{
 const s=setup();s.context.rows=[{role:'user',content:'質問'},{role:'assistant',content:samples[2]},{role:'assistant',content:samples[3]}];
 vm.runInContext('renderMessages()',s.context);
 const buttons=[];function walk(el){if(el.className==='answer-copy')buttons.push(el);for(const child of el.children)walk(child);}walk(s.messages);
 assert.equal(buttons.length,2);for(const b of buttons)await b.onclick();assert.deepEqual(s.copied,[samples[2],samples[3]]);
 assert.equal(s.messages.children[0].children.length,1);
});
test('existing whole-conversation copy still includes both speakers in sequence',async()=>{
 const s=setup(),button={};s.context.$=()=>button;s.context.run=fn=>fn();s.context.session={};s.context.activeId='chat';s.context.epoch=0;s.context.status=()=>{};
 const data=[{role:'user',content:'質問'},{role:'assistant',content:samples[2]}];
 const query={select(){return this;},eq(){return this;},order(){return this;},range:async()=>({data,error:null})};s.context.db={from:()=>query};
 vm.runInContext(source.slice(source.indexOf("$('copyChat').onclick="),source.indexOf("$('manageChats').onclick=")),s.context);
 await button.onclick();assert.equal(s.copied[0],`あなた\n質問\n\nスピリットドラゴンAI\n${samples[2]}`);
});
