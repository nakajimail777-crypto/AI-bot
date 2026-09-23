import test from 'node:test';
import assert from 'node:assert/strict';
import {createBookshelfSyncHandler} from '../api/bookshelf-sync.js';
const id='11111111-1111-4111-8111-111111111111',stamp='2026-09-22T00:00:00Z';
async function run({admin=true,removed=false,candidate={id,learning_text:'他の対話でも使える学び',updated_at:stamp},body={candidateId:id,expected_updated_at:stamp},embeddingError=false,rpcError=false}={}){
 const calls=[],embedded=[],res={setHeader(){},status(c){this.code=c;return this;},json(v){this.data=v;return this;}};
 await createBookshelfSyncHandler({env:{SUPABASE_URL:'https://db.invalid',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SECRET_KEY:'secret',GEMINI_API_KEY:'test',ADMIN_USER_IDS:admin?id:'other'},embedder:async text=>{embedded.push(text);if(embeddingError)throw Error('failed');return Array(768).fill(.01);},fetcher:async(url,options={})=>{
 calls.push({url,options});
 if(url.includes('/auth/'))return Response.json({id});
 if(url.includes('/learning_items?'))return Response.json(candidate?[candidate]:[]);
 if(url.includes('/knowledge_documents?'))return Response.json([{id,metadata:{shelf_removed:removed}}]);
 if(url.endsWith('/rpc/adopt_learning_item'))return Response.json(rpcError?{message:'CANDIDATE_CONFLICT'}:{id,alreadyAdopted:false},{status:rpcError?400:200});
 throw Error('Unexpected request '+url);
 }})({method:'POST',headers:{authorization:'Bearer session'},body},res);
 return {res,calls,embedded};
}
test('ordinary users cannot trigger embedding or writes',async()=>{const r=await run({admin:false});assert.equal(r.res.code,403);assert.equal(r.calls.length,1);});
test('only saved learning is embedded and atomic registration is used',async()=>{const r=await run({candidate:{id,learning_text:'再利用する学び',original_text:'秘密の元会話',updated_at:stamp},body:{candidateId:id,expected_updated_at:stamp,learning_text:'偽の本文'}});assert.equal(r.res.code,200);assert.match(r.embedded.join(),/再利用する学び/);assert.doesNotMatch(r.embedded.join(),/秘密|偽の本文/);assert.equal(r.calls.filter(c=>c.url.endsWith('/rpc/adopt_learning_item')).length,1);});
test('empty, missing and stale candidates never embed',async()=>{for(const candidate of [null,{id,learning_text:'',updated_at:stamp},{id,learning_text:'学び',updated_at:'2026-09-21T00:00:00Z'}]){const r=await run({candidate});assert.ok([400,404,409].includes(r.res.code));assert.equal(r.embedded.length,0);}});
test('retry of adopted item avoids duplicate embeddings and registration',async()=>{const r=await run({candidate:{id,updated_at:stamp,bookshelf_document_id:id}});assert.equal(r.res.data.alreadyAdopted,true);assert.equal(r.embedded.length,0);assert.equal(r.calls.length,3);});
test('removed learning is re-embedded and registered',async()=>{const r=await run({removed:true,candidate:{id,updated_at:stamp,learning_text:'修正した学び',bookshelf_document_id:id}});assert.equal(r.res.code,200);assert.equal(r.res.data.alreadyAdopted,false);assert.equal(r.embedded.length,1);});
test('embedding failure does not write and concurrent edits return conflict',async()=>{const r=await run({embeddingError:true});assert.equal(r.res.code,503);assert.equal(r.calls.length,2);assert.equal((await run({rpcError:true})).res.code,409);});
test('missing selection does not trigger legacy batch',async()=>{const r=await run({body:{}});assert.equal(r.res.code,400);assert.equal(r.calls.length,1);});
