import {validateExperiment} from './reaction-lab-model.js';
export function labError(error){
 const code=error?.code||error?.message;
 if(code==='AUTH_REQUIRED')return '保存・一覧・削除・AI相談にはログインが必要です。未保存の入力はこの画面に残っています。';
 if(code==='SESSION_CHANGED')return '利用者が切り替わったため操作を中止しました。';
 if(code==='INVALID_RECORD')return '記録の形式や文字数を確認してください。保存済みの内容は変更していません。';
 if(String(error?.message).includes('LAB_CONFLICT'))return '別の画面で更新または削除されています。入力を手元に控え、一覧から開き直してください。';
 if(['42P01','42883','PGRST202','PGRST205'].includes(code))return '保存機能の準備がまだ完了していません。入力は画面に残っています。';
 return '通信または操作に失敗しました。入力は画面に残っています。通信状態を確認して、もう一度お試しください。';
}
export function createLabStorage(getContext){
 async function authorized(){
  const ctx={...getContext()};if(!ctx.db||!ctx.userId)throw new Error('AUTH_REQUIRED');
  let timer;
  const result=await Promise.race([ctx.db.auth.getUser(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('TIMEOUT')),15000);})]).finally(()=>clearTimeout(timer));
  if(getContext().generation!==ctx.generation)throw new Error('SESSION_CHANGED');
  if(result.error||result.data?.user?.id!==ctx.userId||result.data.user.is_anonymous)throw new Error('AUTH_REQUIRED');
  return ctx;
 }
 async function run(action){const ctx=await authorized();const result=await action(ctx);if(ctx.generation!==getContext().generation)throw new Error('SESSION_CHANGED');if(result.error)throw result.error;return result.data;}
 return {authorized,
  save(data,revision){const payload=validateExperiment(data);return run(({db})=>db.rpc('save_reaction_experiment',{p_id:payload.id,p_payload:payload,p_revision:revision}).abortSignal(AbortSignal.timeout(15000)));},
  remove(id,revision){return run(({db})=>db.rpc('delete_reaction_experiment',{p_id:id,p_revision:revision}).abortSignal(AbortSignal.timeout(15000)));},
  list(offset=0){return run(({db,userId})=>db.from('reaction_experiments').select('id,payload,revision,saved_at').eq('user_id',userId).order('saved_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+19).abortSignal(AbortSignal.timeout(15000)));},
  get(id){return run(({db,userId})=>db.from('reaction_experiments').select('id,payload,revision,saved_at').eq('user_id',userId).eq('id',id).maybeSingle().abortSignal(AbortSignal.timeout(15000)));}
 };
}
