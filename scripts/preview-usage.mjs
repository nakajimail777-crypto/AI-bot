// Local-only UI fixture. No real AI calls, login or database writes.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {calculateUsage} from '../lib/pricing.js';
import {randomUUID} from 'node:crypto';
import {previewReply} from '../lib/preview-example-replies.js';
import {deepMessage} from '../lib/deep-exploration.js';
const user='11111111-1111-4111-8111-111111111111';
const conversation='22222222-2222-4222-8222-222222222222';
const request='33333333-3333-4333-8333-333333333333';
const chats=[{id:conversation,user_id:user,title:'表示確認用の会話',updated_at:new Date().toISOString(),archived_at:null}];
const rows=[{id:request,conversation_id:conversation,user_id:user,role:'user',content:'テストの質問',sequence:1},
 {id:randomUUID(),conversation_id:conversation,user_id:user,role:'assistant',reply_to:request,content:'これはローカルの表示確認です。実際のAIへの通信や、会話データの変更はありません。',sequence:2}];
const models={gemini:'gemini-3.7-flash',openai:'gpt-5.4-mini-2026-03-17'};
const makeUsage=(provider='gemini')=>{
 const generation=calculateUsage(models[provider],provider==='openai'?{usage:{input_tokens:1200,input_tokens_details:{cached_tokens:0},output_tokens:260,output_tokens_details:{reasoning_tokens:80},total_tokens:1460}}:{usageMetadata:{promptTokenCount:1200,candidatesTokenCount:180,thoughtsTokenCount:80,totalTokenCount:1460}},{at:new Date('2026-09-08Z'),billingMode:'paid'});
 const rag={...calculateUsage('gemini-embedding-2',{usageMetadata:{promptTokenCount:32}},{billingMode:'free'}),outcome:'succeeded'};
 return {provider,model:models[provider],generation,rag,estimatedUsd:generation.estimatedUsd+rag.estimatedUsd,recorded:true};
};
const receipts=new Map([[request,makeUsage()]]);
const guestRows=[],projects=[];
const sdk=`window.supabase={createClient(){let current=new URLSearchParams(location.search).has('guest')?null:{user:{id:'${user}',email:'preview@example.invalid'},access_token:'local-preview-only'};let listener;
 class Query{constructor(table){this.q={table,filters:[],op:'select'};}select(){return this;}eq(k,v){this.q.filters.push([k,v]);return this;}is(k,v){return this.eq(k,v);}not(){return this;}order(){return this;}range(){return this;}limit(){return this;}lt(k,v){this.q.lt=[k,v];return this;}maybeSingle(){this.q.single=true;return this;}abortSignal(){return this;}insert(v){this.q.op='insert';this.q.value=v;return this;}upsert(v){return this.insert(v);}update(v){this.q.op='update';this.q.value=v;return this;}then(a,b){return fetch('/preview/db',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(this.q)}).then(r=>r.json()).then(a,b);}}
 return {from:t=>new Query(t),auth:{getSession:async()=>({data:{session:current}}),getUser:async()=>({data:{user:current?.user||null}}),onAuthStateChange:f=>{listener=f;},signOut:async()=>{current=null;listener?.('SIGNED_OUT',null);return {};}}};}};`;
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}
const server=http.createServer(async(req,res)=>{
 try{
 res.setHeader('Cache-Control','no-store');
 const url=new URL(req.url,'http://localhost');
 if(req.method==='POST'){
 let body='';for await(const part of req)body+=part;
 const data=JSON.parse(body||'{}');
 if(url.pathname==='/preview/db'){
 const source=data.table==='conversations'?chats:data.table==='messages'?rows:data.table==='ayumi_projects'?projects:[];
 if(data.op==='insert')source.push({...data.value,user_id:user,version:1,updated_at:new Date().toISOString(),archived_at:null});
 const selected=source.filter(row=>data.filters.every(([k,v])=>(row[k]??null)===v)).filter(row=>!data.lt||row[data.lt[0]]<data.lt[1]);
 if(data.op==='update')selected.forEach(row=>Object.assign(row,data.value));
 return json(res,{data:data.single?selected[0]||null:data.table==='messages'?[...selected].sort((a,b)=>b.sequence-a.sequence):selected,error:null});
 }
 if(url.pathname==='/api/chat'||url.pathname==='/api/guest-chat'){
 const provider=data.provider==='openai'?'openai':'gemini';
 if(data.message.includes('429'))return json(res,{error:'今はAIへのアクセスが集中しています。約3秒待ってから、もう一度お試しください。入力した内容は残っています。',code:'AI_RATE_LIMIT',retryAfterSeconds:3},429);
 if(data.message.includes('待機'))await new Promise(resolve=>setTimeout(resolve,1500));
 const label=`【${provider==='openai'?'OpenAI':'Gemini'}の模擬応答】`;
 let reply=label+'\n'+previewReply(data.message);
 if(data.deepExploration){
  const theme=data.deepTheme||'今の話題';
  reply=data.deepAction==='finish'
   ? `最初に気になっていたこと：${theme}\n話してみて気づいた気持ち：この表示確認では確定していません。\nまだ分からないこと：本人の言葉で、あとから直せます。\n\n${label}`
   : data.modeStart
    ? `「${theme}」について、最近なんとなく心に残っている場面はありますか？\n\n${label}`
    : /近い|違い|分かりません/.test(data.message)
     ? `今の返事を受け取りました。その場面のどの部分が、今も心に残っていますか？\n\n${label}`
     : `気持ちを確かめる\nこれは画面確認用の仮説です。人と会いたい気持ちと、自分の時間を取っておきたい気持ちが、両方あるという捉え方は近いですか？\n\n${label}`;
 }
 const target=url.pathname==='/api/guest-chat'?guestRows:rows;
 if(!receipts.has(data.requestId)){
 target.push({id:data.requestId,conversation_id:data.conversationId,user_id:user,role:'user',content:data.deepExploration?deepMessage(data.message,data.modeStart,{theme:data.deepTheme||'',action:data.deepAction||''}):data.message,sequence:target.length+1});
 target.push({id:randomUUID(),conversation_id:data.conversationId,user_id:user,role:'assistant',reply_to:data.requestId,content:reply,provider,model:models[provider],sequence:target.length+1});
 receipts.set(data.requestId,makeUsage(provider));}
 return json(res,{reply,requestId:data.requestId,saved:true,provider,model:models[provider],usage:receipts.get(data.requestId),remaining:Math.max(0,5-guestRows.length/2)});
 }
 if(url.pathname==='/api/ayumi-plan')return json(res,{plan:{title:data.goal.slice(0,120),items:['まず一つ小さく試す','試して気づいたことを書く']},provider:data.provider||'gemini',preview:true,saved:false});
 }
 if(url.pathname==='/preview-sdk.js'){res.setHeader('Content-Type','text/javascript');return res.end(sdk);}
 if(url.pathname==='/api/config')return json(res,url.searchParams.get('view')==='stepbook'?{url:null}:{url:'http://localhost',publishableKey:'sb_publishable_preview',defaultProvider:'gemini',providers:Object.entries(models).map(([id,model])=>({id,label:id==='openai'?'OpenAI':'Gemini',model,available:id!==(process.env.PREVIEW_UNAVAILABLE||'')}))});
 if(url.pathname==='/api/guest-chat')return json(res,{rows:guestRows,remaining:Math.max(0,5-guestRows.length/2)});
 if(url.pathname==='/api/usage'){
 const ids=(url.searchParams.get('requestIds')||'').split(',');const total=[...receipts.values()].reduce((n,u)=>n+u.estimatedUsd,0);
 return json(res,{month:url.searchParams.get('month'),scope:url.searchParams.get('scope'),admin:true,turns:ids.filter(id=>receipts.has(id)).map(id=>({request_id:id,usage:receipts.get(id)})),monthly:{estimatedUsd:total,billedUsd:0,unknownCalls:0,billingUnknownCalls:0,trackingStartedAt:'2026-09-08T00:00:00Z',categories:[{category:'generation',estimated_usd:total,calls:receipts.size}]}});
 }
 if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
 const file=url.pathname==='/'?'index.html':/^\/assets\/[a-z0-9-]+\.(?:js|css)$/.test(url.pathname)?url.pathname.slice(1):null;
 if(!file){res.writeHead(404);return res.end();}
 let content=await readFile(new URL('../'+file,import.meta.url),'utf8');
 if(file==='index.html')content=content.replace(/<script defer src="https:\/\/cdn\.jsdelivr[^>]+><\/script>/,'<script defer src="/preview-sdk.js"></script>').replace('<title>','<title>【ローカル確認】').replace('スピリットドラゴン <span','表示確認・模擬応答 <span');
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(content);
 }catch{json(res,{error:'Preview error'},500);}
});
const port=Number(process.env.PREVIEW_PORT||4174);
server.listen(port,'127.0.0.1',()=>console.log(`Local fixture: http://127.0.0.1:${port} (mock responses only; ?guest for guest; type 429 to test input retention)`));
