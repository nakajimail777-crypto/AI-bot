// Local-only UI fixture. No real Gemini calls, login or database writes.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {calculateUsage} from '../lib/pricing.js';
import {randomUUID} from 'node:crypto';
const user='11111111-1111-4111-8111-111111111111';
const conversation='22222222-2222-4222-8222-222222222222';
const request='33333333-3333-4333-8333-333333333333';
const chats=[{id:conversation,user_id:user,title:'表示確認用の会話',updated_at:new Date().toISOString(),archived_at:null}];
const rows=[{id:request,conversation_id:conversation,user_id:user,role:'user',content:'テストの質問',sequence:1},
 {id:randomUUID(),conversation_id:conversation,user_id:user,role:'assistant',reply_to:request,content:'これはローカルの表示確認です。実際のAIへの通信や、会話データの変更はありません。',sequence:2}];
const makeUsage=()=>{
 const generation=calculateUsage('gemini-3.7-flash',{usageMetadata:{promptTokenCount:1200,candidatesTokenCount:180,thoughtsTokenCount:80,totalTokenCount:1460}},{at:new Date('2026-09-08Z'),billingMode:'free'});
 const rag={...calculateUsage('gemini-embedding-2',{usageMetadata:{promptTokenCount:32}},{billingMode:'free'}),outcome:'succeeded'};
 return {generation,rag,estimatedUsd:generation.estimatedUsd+rag.estimatedUsd,recorded:true};
};
const receipts=new Map([[request,makeUsage()]]);
const sdk=`window.supabase={createClient(){let current={user:{id:'${user}',email:'preview@example.invalid'},access_token:'local-preview-only'};let listener;
 class Query{constructor(table){this.q={table,filters:[],op:'select'};}select(){return this;}eq(k,v){this.q.filters.push([k,v]);return this;}is(k,v){return this.eq(k,v);}not(){return this;}order(){return this;}range(){return this;}limit(){return this;}lt(k,v){this.q.lt=[k,v];return this;}maybeSingle(){this.q.single=true;return this;}insert(v){this.q.op='insert';this.q.value=v;return this;}update(v){this.q.op='update';this.q.value=v;return this;}then(a,b){return fetch('/preview/db',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(this.q)}).then(r=>r.json()).then(a,b);}}
 return {from:t=>new Query(t),auth:{getSession:async()=>({data:{session:current}}),onAuthStateChange:f=>{listener=f;},signOut:async()=>{current=null;listener?.('SIGNED_OUT',null);return {};}}};}};`;
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost');
 if(req.method==='POST'){
 let body='';for await(const part of req)body+=part;
 const data=JSON.parse(body||'{}');
 if(url.pathname==='/preview/db'){
 const source=data.table==='conversations'?chats:rows;
 if(data.op==='insert')source.push({...data.value,updated_at:new Date().toISOString(),archived_at:null});
 const selected=source.filter(row=>data.filters.every(([k,v])=>(row[k]??null)===v)).filter(row=>!data.lt||row[data.lt[0]]<data.lt[1]);
 if(data.op==='update')selected.forEach(row=>Object.assign(row,data.value));
 return json(res,{data:data.single?selected[0]||null:data.table==='messages'?[...selected].sort((a,b)=>b.sequence-a.sequence):selected,error:null});
 }
 if(url.pathname==='/api/chat'){
 if(data.message.includes('429'))return json(res,{error:'今はAIへのアクセスが集中しています。約3秒待ってから、もう一度お試しください。入力した内容は残っています。',code:'AI_RATE_LIMIT',retryAfterSeconds:3},429);
 if(!receipts.has(data.requestId)){
 rows.push({id:data.requestId,conversation_id:data.conversationId,user_id:user,role:'user',content:data.message,sequence:rows.length+1});
 rows.push({id:randomUUID(),conversation_id:data.conversationId,user_id:user,role:'assistant',reply_to:data.requestId,content:'ローカル確認用の回答です。トークン数と料金はテストデータです。',sequence:rows.length+1});
 receipts.set(data.requestId,makeUsage());}
 return json(res,{reply:'ローカル確認用の回答です。',requestId:data.requestId,saved:true,usage:receipts.get(data.requestId)});
 }
 }
 if(url.pathname==='/preview-sdk.js'){res.setHeader('Content-Type','text/javascript');return res.end(sdk);}
 if(url.pathname==='/api/config')return json(res,{url:'http://localhost',publishableKey:'sb_publishable_preview'});
 if(url.pathname==='/api/usage'){
 const ids=(url.searchParams.get('requestIds')||'').split(',');const total=[...receipts.values()].reduce((n,u)=>n+u.estimatedUsd,0);
 return json(res,{month:url.searchParams.get('month'),scope:url.searchParams.get('scope'),admin:true,turns:ids.filter(id=>receipts.has(id)).map(id=>({request_id:id,usage:receipts.get(id)})),monthly:{estimatedUsd:total,billedUsd:0,unknownCalls:0,billingUnknownCalls:0,trackingStartedAt:'2026-09-08T00:00:00Z',categories:[{category:'generation',estimated_usd:total,calls:receipts.size}]}});
 }
 const files={'/':'index.html','/assets/app.js':'assets/app.js','/assets/usage-ui.js':'assets/usage-ui.js','/assets/db.css':'assets/db.css'};
 const file=files[url.pathname];if(!file){res.writeHead(404);return res.end();}
 let content=await readFile(new URL('../'+file,import.meta.url),'utf8');
 if(file==='index.html')content=content.replace(/<script defer src="https:\/\/cdn\.jsdelivr[^>]+><\/script>/,'<script defer src="/preview-sdk.js"></script>').replace('<title>','<title>【ローカル確認】');
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(content);
 }catch{json(res,{error:'Preview error'},500);}
});
server.listen(4173,'127.0.0.1',()=>console.log('Local fixture: http://127.0.0.1:4173 (type 429 to test input retention)'));
