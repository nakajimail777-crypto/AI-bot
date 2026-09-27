import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const source=(await readFile(new URL('../assets/app.js',import.meta.url),'utf8')).replace(/\nstart\(\);\s*$/, '\n');
function setup(){
 const nodes=new Map();
 const element=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',style:{},classList:{toggle(){},add(){},remove(){}},addEventListener(){},setAttribute(){},removeAttribute(){},close(){},showModal(){},replaceChildren(){},append(){},focus(){}});
  return nodes.get(id);
 };
 let finish,requested;
 const context=vm.createContext({document:{getElementById:element,querySelectorAll:()=>[]},location:{search:''},window:{},crypto:{randomUUID},setTimeout,clearTimeout,setInterval:()=>0,AbortSignal,URL,Blob,sessionStorage:{setItem(){},getItem(){return null;}},fetch:async(url,init)=>{requested={url,body:JSON.parse(init.body)};return new Promise(resolve=>{finish=resolve;});}});
 vm.runInContext(source,context);
 vm.runInContext(`ready=true;session={user:{id:'user'}};activeId='chat';selfReturn=true;globalThis.originalControls=controls;
 db={auth:{getSession:async()=>({data:{session:{access_token:'test'}}})}};
 controls=()=>{};rememberDraft=()=>{};replyWaiting=()=>{};loadMessages=async()=>{};loadHistory=async()=>{};
 run=action=>{globalThis.completed=action();};`,context);
 return {context,nodes,element,get requested(){return requested;},respond:()=>finish({ok:true,json:async()=>({saved:true,reply:'reply'})})};
}
test('activation uses an empty new message and leaves the unsent draft intact',async()=>{
 const s=setup();s.element('messageInput').value='未送信の下書き';
 vm.runInContext('submitMessage(true)',s.context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.requested.body.message,'');assert.equal(s.requested.body.modeStart,true);assert.equal(s.requested.body.selfReturn,true);
 s.respond();await s.context.completed;
 assert.equal(s.element('messageInput').value,'未送信の下書き');assert.equal(vm.runInContext('selfReturn',s.context),true);
});
test('normal mode turn maintains selection and clears only the sent draft',async()=>{
 const s=setup();s.element('messageInput').value='肩が重い';
 vm.runInContext('submitMessage()',s.context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.requested.body.message,'肩が重い');assert.equal(s.requested.body.selfReturn,true);
 s.respond();await s.context.completed;assert.equal(s.element('messageInput').value,'');assert.equal(vm.runInContext('selfReturn',s.context),true);
});
test('self-return keeps the composer available while a reply is pending',()=>{
 const s=setup();
 vm.runInContext('busy=true;originalControls();',s.context);
 assert.equal(s.element('messageInput').disabled,false);
 assert.equal(s.element('sendButton').disabled,true);
});
test('text entered while a self-return reply is pending remains as the next draft',async()=>{
 const s=setup();s.element('messageInput').value='肩が重い';
 vm.runInContext('submitMessage()',s.context);await new Promise(resolve=>setImmediate(resolve));
 s.element('messageInput').value='少し休んでみる';
 s.respond();await s.context.completed;
 assert.equal(s.element('messageInput').value,'少し休んでみる');
 assert.equal(vm.runInContext('selfReturn',s.context),true);
});
for(const change of ['leaveSelfReturn();','responseVersion++;','epoch++;'])test(`late response cannot overwrite new state after ${change}`,async()=>{
 const s=setup();s.element('messageInput').value='old';
 vm.runInContext('submitMessage()',s.context);await new Promise(resolve=>setImmediate(resolve));
 vm.runInContext(change,s.context);s.element('messageInput').value='new draft';
 s.respond();await s.context.completed;assert.equal(s.element('messageInput').value,'new draft');
});
