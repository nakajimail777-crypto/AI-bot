import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorage,storageMessage} from '../assets/mind-reflection-storage.js';
import {createReflection,restoreReflection} from '../assets/mind-reflection.js';
test('double save shares one operation, preserves id and allows a retry after network failure',async()=>{
 let calls=0,release;
 const context={userId:'owner',generation:0,db:{auth:{getUser:async()=>({data:{user:{id:'owner'}}})},rpc:(_name,args)=>{calls++;return {abortSignal:()=>new Promise(resolve=>{release=()=>resolve({data:args});})};}}};
 const store=createStorage(()=>context),data=createReflection();
 const a=store.save(data,'draft'),b=store.save(data,'draft');assert.equal(a,b);
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,1);release();assert.equal((await a).p_id,data.id);
 context.db.rpc=()=>({abortSignal:async()=>({error:{code:'NETWORK'}})});
 await assert.rejects(store.save(data,'record'));
 context.db.rpc=(_n,args)=>({abortSignal:async()=>({data:args})});
 assert.equal((await store.save(data,'record')).p_id,data.id);
});
test('session switch rejects late results and anonymous users cannot save',async()=>{
 let resolveUser;const context={userId:'owner',generation:0,db:{auth:{getUser:()=>new Promise(r=>{resolveUser=r;})}}};
 const store=createStorage(()=>context),pending=store.save(createReflection(),'draft');
 context.generation++;resolveUser({data:{user:{id:'owner'}}});await assert.rejects(pending,/SESSION_CHANGED/);
 context.userId=null;await assert.rejects(store.save(createReflection(),'draft'),/AUTH_REQUIRED/);
});
test('stored input is validated even if skipped, and note survives round trip',()=>{
 const data=createReflection();data.fields.feeling.note='自分の言葉';assert.deepEqual(restoreReflection(data),data);
 data.fields.event.skipped=true;data.fields.event.value='あ'.repeat(2001);assert.throws(()=>restoreReflection(data),/INVALID_RECORD/);
 assert.match(storageMessage({code:'PGRST202'}),/準備/);
});
