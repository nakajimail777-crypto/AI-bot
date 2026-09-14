import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminHandler} from '../api/admin.js';

const admin='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const lineHash='a'.repeat(64);
const env={SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'server-only',ADMIN_USER_IDS:admin};
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(data){this.data=data;return this;}});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
async function invoke({query={},headers={authorization:'Bearer admin-session'},method='GET',environment=env,user={id:admin},read=()=>json([])}={}){
  const calls=[],res=response();
  const handler=createAdminHandler({env:environment,now:()=>new Date('2026-09-13T03:00:00Z'),fetcher:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/auth/v1/user'))return json(user);
    return read(url,options);
  }});
  await handler({method,headers,query},res);
  return {res,calls};
}
test('unauthenticated and unsupported methods perform no requests',async()=>{
  for(const args of [{headers:{}},{headers:{authorization:'Bearer bad extra'}},{method:'POST'}]){
    const {res,calls}=await invoke(args);assert.equal(calls.length,0);assert.equal(res.code,args.method?405:401);
    assert.match(res.headers['Cache-Control'],/no-store/);
  }
});
test('missing admin list fails closed, including usage-only admins',async()=>{
  const {res,calls}=await invoke({environment:{...env,ADMIN_USER_IDS:'',USAGE_ADMIN_USER_IDS:admin}});
  assert.equal(res.code,503);assert.equal(calls.length,0);
});
test('ordinary members and anonymous sessions cannot query private tables',async()=>{
  for(const user of [{id:other},{id:admin,is_anonymous:true},{id:'invalid'}]){
    const {res,calls}=await invoke({user});assert.equal(res.code,user.id===other?403:401);assert.equal(calls.length,1);
  }
});
test('Supabase must validate token even if a forged session claims an admin id',async()=>{
  const res=response();let calls=0;
  await createAdminHandler({env,fetcher:async()=>{calls++;return json({id:admin},401);}})({method:'GET',headers:{authorization:'Bearer forged'},query:{}},res);
  assert.equal(res.code,401);assert.equal(calls,1);
});
test('query validation prevents injection and malformed page requests',async()=>{
  for(const query of [{action:'conversation',id:admin+'&select=*'},{action:'line_conversation',id:lineHash+'x'},{action:'line_conversation',id:[lineHash]},{action:'book',id:[admin]},{action:'remove'},{action:'conversations',offset:'-1'},{offset:'1.2'},{offset:['0']},{action:['books']}]){
    const {res,calls}=await invoke({query});assert.equal(res.code,400);assert.equal(calls.length,1);
  }
});
test('summary uses exact counts and a bounded seven-day interval; candidates stay unavailable',async()=>{
  const {res,calls}=await invoke({read:async(url,options)=>{
    assert.equal(options.method,'HEAD');assert.equal(options.headers.Prefer,'count=exact');
    return new Response(null,{status:200,headers:{'content-range':`*/${url.includes('knowledge_documents')?1204:url.includes('line_chat_sessions')?12:2050}`}});
  }});
  assert.equal(res.code,200);assert.equal(res.data.books,1204);assert.equal(res.data.recentConversations,2062);assert.equal(res.data.candidates,null);
  assert.equal(res.data.webRecentConversations,2050);assert.equal(res.data.lineRecentConversations,12);
  assert.equal(res.data.since,'2026-09-06T03:00:00.000Z');
  assert.match(calls[1].url,/origin=eq.bookshelf/);assert.match(calls[1].url,/shelf_removed.is.null/);
  assert.match(calls[2].url,/updated_at=gte.*updated_at=lte/);
  assert.match(calls[3].url,/line_chat_sessions.*updated_at=gte/);
});
test('missing count and DB failure are errors, never misleading zero counts',async()=>{
  for(const read of [()=>new Response(null,{status:200}),()=>json({message:'sensitive db details'},500)]){
    const {res}=await invoke({read});assert.equal(res.code,503);assert.equal(res.data.books,undefined);assert.ok(!JSON.stringify(res.data).includes('sensitive'));
  }
});
test('list pagination has a deterministic tie-breaker and never returns the sentinel row',async()=>{
  for(const action of ['books','conversations','line_conversations']){
    const {res,calls}=await invoke({query:{action,offset:'25'},read:()=>json(Array.from({length:26},(_,id)=>({id})))});
    assert.equal(res.code,200);assert.equal(res.data.items.length,25);assert.equal(res.data.nextOffset,50);
    assert.match(calls[1].url,action==='line_conversations'?/order=updated_at.desc,user_hash.asc&limit=26&offset=25/:/order=updated_at.desc,id.desc&limit=26&offset=25/);
    assert.equal(calls[0].options.headers.Authorization,'Bearer admin-session');assert.equal(calls[1].options.headers.Authorization,'Bearer server-only');
  }
});
test('final list page has no next offset',async()=>{
  const {res}=await invoke({query:{action:'conversations'},read:()=>json([{id:admin}])});assert.equal(res.data.nextOffset,null);
});
test('deleted conversation and non-bookshelf document never expose child content',async()=>{
  for(const action of ['conversation','book']){
    const {res,calls}=await invoke({query:{action,id:admin}});assert.equal(res.code,404);assert.equal(calls.length,2);
    if(action==='book')assert.match(calls[1].url,/origin=eq.bookshelf/);
  }
});
test('conversation detail reads ordered messages in bounded pages, read-only',async()=>{
  const {res,calls}=await invoke({query:{action:'conversation',id:admin,offset:'100'},read:url=>json(url.includes('messages?')?Array.from({length:101},(_,i)=>({id:i,role:'user',content:'<script>literal text</script>',sequence:i+101})):[{id:admin,title:'Private',archived_at:'2026-09-12'}])});
  assert.equal(res.code,200);assert.equal(res.data.items.length,100);assert.equal(res.data.nextOffset,200);
  assert.match(calls[2].url,new RegExp(`conversation_id=eq.${admin}.*order=sequence.asc&limit=101&offset=100`));
  assert.ok(calls.every(c=>!c.options.method||c.options.method==='GET'));assert.ok(calls.every(c=>!c.options.body));
});
test('book detail uses chunk pagination and retains literal content',async()=>{
  const {res,calls}=await invoke({query:{action:'book',id:admin},read:url=>json(url.includes('knowledge_chunks')?[{chunk_index:0,content:'<img onerror=alert(1)>'}]:[{id:admin,title:'Book'}])});
  assert.equal(res.code,200);assert.equal(res.data.items[0].content,'<img onerror=alert(1)>');assert.equal(res.data.nextOffset,null);assert.match(calls[2].url,/order=chunk_index.asc/);
});
test('LINE list exposes only hashes and timestamps, with deterministic pagination',async()=>{
  const {res,calls}=await invoke({query:{action:'line_conversations',offset:'25'},read:()=>json(Array.from({length:26},(_,i)=>({user_hash:String(i).padStart(64,'0'),updated_at:'2026-09-13'})))});
  assert.equal(res.data.items.length,25);assert.equal(res.data.nextOffset,50);
  assert.match(calls[1].url,/select=user_hash,updated_at/);assert.ok(!calls[1].url.includes('turns'));
});
test('LINE detail validates hash and flattens retained turns without raw identifiers',async()=>{
  const turns=[{message:'相談です',reply:'返答です'},{message:'<script>literal</script>',reply:'続き'}];
  const {res,calls}=await invoke({query:{action:'line_conversation',id:lineHash},read:()=>json([{user_hash:lineHash,updated_at:'2026-09-13',turns}])});
  assert.equal(res.code,200);assert.deepEqual(res.data.items.map(x=>x.role),['user','assistant','user','assistant']);
  assert.equal(res.data.items[2].content,'<script>literal</script>');assert.equal(res.data.nextOffset,null);
  assert.deepEqual(Object.keys(res.data.lineConversation).sort(),['updated_at','user_hash']);
  assert.match(calls[1].url,new RegExp(`user_hash=eq.${lineHash}`));
});
test('missing LINE session returns 404 without querying another table',async()=>{
  const {res,calls}=await invoke({query:{action:'line_conversation',id:lineHash}});
  assert.equal(res.code,404);assert.equal(calls.length,2);
});
test('network and malformed table results fail without leaking provider messages',async()=>{
  for(const read of [()=>{throw Error('private-key-or-content');},()=>json({unexpected:true})]){
    const {res}=await invoke({query:{action:'books'},read});assert.equal(res.code,503);assert.ok(!JSON.stringify(res.data).includes('private-key'));
  }
});
