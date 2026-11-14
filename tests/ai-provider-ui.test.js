import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../assets/ai-provider.js',import.meta.url),'utf8');
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
test('AI selection is inside conversation management and absent from the composer',()=>{
  const dialog=html.match(/<dialog id="manageDialog"[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(dialog);assert.match(dialog,/id="aiProvider"/);assert.match(dialog,/id="aiProviderHint"/);
  const composer=html.slice(html.indexOf('<div class="composer-wrap">'),html.indexOf('<dialog id="manageDialog"'));
  assert.doesNotMatch(composer,/id="aiProvider"/);
  assert.equal((html.match(/id="aiProvider"/g)||[]).length,1);
});
function fixture({storage=new Map()}={}){
  const element=()=>({value:'',children:[],listeners:{},replaceChildren(){this.children=[];},append(value){this.children.push(value);},addEventListener(name,fn){this.listeners[name]=fn;}});
  const select=element(),hint=element(),changes=[];let owner=null;
  const context=vm.createContext({document:{createElement:element}});vm.runInContext(source,context);
  const selector=context.DragonAIProvider.mount({select,hint,userId:()=>owner,onChange:id=>changes.push(id),storage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
  const configure=(openai=true,gemini=true)=>selector.configure({providers:[{id:'gemini',available:gemini},{id:'openai',available:openai}]});
  const choose=value=>{select.value=value;select.listeners.change();};
  return {select,hint,changes,selector,configure,choose,setOwner:value=>{owner=value;selector.restore();}};
}
test('Gemini is the initial choice and each user keeps a separate device preference',()=>{
  const s=fixture();assert.equal(s.select.disabled,true);s.configure();assert.equal(s.selector.get(),'gemini');
  s.choose('openai');assert.equal(s.selector.get(),'openai');assert.deepEqual(s.changes,['openai']);
  s.setOwner('alice');assert.equal(s.selector.get(),'gemini');s.choose('openai');
  s.setOwner('bob');assert.equal(s.selector.get(),'gemini');
  s.setOwner('alice');assert.equal(s.selector.get(),'openai');
  s.setOwner(null);assert.equal(s.selector.get(),'openai');
});
test('missing keys disable the choice without silently changing a saved OpenAI preference',()=>{
  const s=fixture();s.configure();s.choose('openai');s.configure(false);
  assert.equal(s.selector.get(),'openai');assert.equal(s.selector.available(),false);
  assert.equal(s.select.children.find(p=>p.value==='openai').disabled,true);assert.match(s.hint.textContent,/準備中/);
  s.choose('openai');assert.equal(s.changes.length,1);
  s.choose('gemini');assert.equal(s.selector.available(),true);assert.equal(s.selector.get(),'gemini');
});
test('an in-flight turn prevents provider changes, including synthetic change events',()=>{
  const s=fixture();s.configure();s.selector.setBusy(true);assert.equal(s.select.disabled,true);
  s.choose('openai');assert.equal(s.selector.get(),'gemini');assert.equal(s.select.value,'gemini');assert.equal(s.changes.length,0);
  s.selector.setBusy(false);s.choose('openai');assert.equal(s.selector.get(),'openai');
});
test('an invalid stored provider and unrecognized server providers are ignored',()=>{
  const s=fixture({storage:new Map([['spirit-dragon.ai-provider.guest','external']])});
  s.selector.configure({providers:[{id:'external',available:true},{id:'gemini',available:true}]});
  assert.equal(s.selector.get(),'gemini');s.choose('external');assert.equal(s.selector.get(),'gemini');assert.equal(s.select.children.length,2);
});
