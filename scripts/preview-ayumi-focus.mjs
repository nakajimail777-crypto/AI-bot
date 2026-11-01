// Local-only fixture. No real Supabase, Gemini, credentials or production writes.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const before=process.argv.includes('--before');
const root=new URL('../',import.meta.url),port=before?4207:4206;
const owner='11111111-1111-4111-8111-111111111111';
const titles=['コンセプトを決める','アカウント名を決める','新アカウントを作成','プロフィールを完成させる','商品と受付ルールを確定','投稿① 自己紹介を作る','サービスの魅力を紹介する','セッション案内を書く','感想の掲載許可を確認する','申し込み導線を確認する','デザインを仕上げる','公開前に点検する','公開して受付を開始する'];
const sample=()=>({id:'33333333-3333-4333-8333-333333333333',user_id:owner,title:'Instagram公開準備（テストデータ）',due_date:'2026-11-09',version:1,items:titles.map((text,i)=>({id:`step${i+1}`,text,done:i<5})),insight:'対象は初めて龍秘術を知る方。やさしい言葉で伝える。',focus_day:null});
const store={ayumi_projects:[sample()],conversations:[],messages:[]};let fault='',writes=0;
const sdk=`window.supabase={createClient(){let current={user:{id:'${owner}',email:'preview@example.invalid'},access_token:'fixture'};let listener;
window.fixtureSignOut=()=>{current=null;listener?.('SIGNED_OUT',null);};
class Q{constructor(table){this.q={table,filters:[],op:'select'};}select(){return this;}eq(k,v){this.q.filters.push([k,v]);return this;}is(k,v){return this.eq(k,v);}order(){return this;}range(){return this;}limit(){return this;}maybeSingle(){this.q.single=true;return this;}insert(value){this.q.op='insert';this.q.value=value;return this;}update(value){this.q.op='update';this.q.value=value;return this;}then(a,b){return fetch('/fixture',{method:'POST',body:JSON.stringify(this.q)}).then(r=>r.json()).then(a,b);}}
return {from:t=>new Q(t),auth:{getSession:async()=>({data:{session:current}}),getUser:async()=>({data:{user:current?.user}}),onAuthStateChange:f=>listener=f,signOut:async()=>{window.fixtureSignOut();return {};}}};}};`;
const fixture=`let fixtureDate='2026-11-01';DragonAyumi.dailyToday=()=>fixtureDate;
document.addEventListener('DOMContentLoaded',()=>{
const box=document.createElement('details');box.id='fixtureControls';box.innerHTML='<summary>検証用の操作（本番にはありません）</summary><p id="fixtureStatus"></p>';document.getElementById('ayumiDialog').append(box);
for(const [label,action] of [['次の保存を失敗させる','fail'],['次の保存で競合','conflict'],['次の保存を遅延','slow'],['11/2に進める','tomorrow'],['保存中にログアウト','logout'],['初期状態に戻す','reset'],['毎日だけの目標','daily'],['週別だけの目標','weekly'],['項目ゼロの目標','empty'],['全項目完了の目標','complete'],['目標切替の確認','multiple']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=async()=>{if(action==='tomorrow'){fixtureDate='2026-11-02';window.dispatchEvent(new Event('focus'));}else if(action==='logout'){window.fixtureSignOut();}else await fetch('/fixture-control',{method:'POST',body:JSON.stringify({action})});document.getElementById('fixtureStatus').textContent=label+'：設定済み';};box.append(b);}
const timer=setInterval(()=>{if(!document.getElementById('newChat').disabled){clearInterval(timer);document.getElementById('openAyumi').click();}},100);
});`;
http.createServer(async(req,res)=>{
 const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 try{
  const path=new URL(req.url,`http://localhost:${port}`).pathname;
  if(path==='/fixture-control'){
   let body='';for await(const c of req)body+=c;const {action}=JSON.parse(body);
   if(['reset','daily','weekly','empty','complete','multiple'].includes(action)){
    const p=sample();store.ayumi_projects=[p];fault='';writes=0;
    if(action==='daily')p.items=[{id:'daily',text:'1ページ読む',done:false,daily:{start:'2026-11-01',end:'2026-11-02',timezone:'Asia/Tokyo',checks:[{date:'2026-11-01',done:false},{date:'2026-11-02',done:false}]}}];
    if(action==='weekly')p.items=[{id:'weekly',text:'週の振り返り',done:false,weeks:[{start:'2026-11-01',done:false}]}];
    if(action==='empty')p.items=[];
    if(action==='complete'){p.items.forEach(i=>i.done=true);p.achieved_on='2026-10-31';}
    if(action==='multiple')store.ayumi_projects.push({...sample(),id:'44444444-4444-4444-8444-444444444444',title:'読書（別のテスト目標）',items:[{id:'book',text:'本を選ぶ',done:false}]});
   }else fault=action;return json({ok:true});
  }
  if(path==='/fixture'){
   let body='';for await(const c of req)body+=c;const q=JSON.parse(body),source=store[q.table]||[];
   if(q.op!=='select'){
    const mode=fault;fault='';
    if(mode==='slow')await new Promise(r=>setTimeout(r,2000));
    if(mode==='fail')return json({data:null,error:{code:'fixture_failure'}});
    if(mode==='conflict'&&source[0]){source[0].version++;source[0].insight='別タブの変更（テスト）';}
   }
   let rows=source.filter(row=>q.filters.every(([k,v])=>(row[k]??null)===v));
   if(q.op==='insert'){if(source.some(r=>r.id===q.value.id))return json({data:null,error:{code:'23505'}});const row={...q.value,user_id:owner,version:1};source.push(row);rows=[row];writes++;}
   if(q.op==='update'){rows.forEach(row=>Object.assign(row,q.value));writes+=rows.length;}
   return json({data:q.single?rows[0]||null:rows,error:null});
  }
  if(path==='/fixture-sdk.js'){res.setHeader('Content-Type','text/javascript');return res.end(sdk);}
  if(path==='/fixture-setup.js'){res.setHeader('Content-Type','text/javascript');return res.end(fixture);}
  if(path==='/api/config')return json({url:`http://localhost:${port}`,publishableKey:'fixture'});
  if(path==='/api/ayumi-plan')return json({preview:true,plan:{title:'ローカルの案',items:['1ページ読む','一言残す']}});
  if(path==='/api/chat')return json({error:'ローカル確認ではAIへ送信しません。'},503);
  if(path==='/api/guest-chat')return json({rows:[],remaining:5});
  if(path.startsWith('/api/'))return json({turns:[],monthly:{}});
  const name=path==='/'?'index.html':path.slice(1);if(name!=='index.html'&&!/^assets\/[a-z0-9.-]+$/.test(name)){res.writeHead(404);return res.end();}
  let content=before&&['index.html','assets/ayumi.js','assets/ayumi.css'].includes(name)?execFileSync('git',['show','3669564:'+name],{cwd:root}):await readFile(new URL(name,root));
  if(name==='index.html')content=content.toString().replace(/<script defer src="https:\/\/cdn\.jsdelivr[^>]+><\/script>/,'<script defer src="/fixture-sdk.js"></script>').replace('<script defer src="/assets/app.js">','<script defer src="/fixture-setup.js"></script><script defer src="/assets/app.js">').replace('<h2 id="ayumiTitle">','<p>ローカル検証：架空の13項目・5個完了。本番には保存されません。</p><h2 id="ayumiTitle">');
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(content);
 }catch(e){json({error:e.message},500);}
}).listen(port,'127.0.0.1',()=>console.log(`Local fixture: http://localhost:${port}/`));
