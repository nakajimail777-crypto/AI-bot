// Uses the existing Supabase client and authenticated session. No AI calls.
export function storageMessage(error) {
  if(error?.code==='AUTH_REQUIRED') return '記録の保存にはログインが必要です。画面を閉じてログインし、もう一度お試しください。';
  if(error?.code==='SESSION_CHANGED') return '利用者が切り替わったため、この操作を中止しました。';
  if(['42501','PGRST301','PGRST302'].includes(error?.code)) return 'ログインの状態を確認できませんでした。ログインし直して、もう一度お試しください。';
  if(['42P01','42883','PGRST202','PGRST205'].includes(error?.code)) return '保存機能の準備がまだ完了していません。入力を保持しています。時間をおいて再試行してください。';
  if(error?.code==='INVALID_RECORD') return '記録の形式を読み取れませんでした。元の記録は変更していません。';
  if(error?.code==='REFLECTION_CONFLICT'||String(error?.message).includes('REFLECTION_CONFLICT')) return '別の画面でこの記録が更新されました。入力を手元に控え、保存した振り返りを開き直してください。';
  if(error?.code==='TIMEOUT') return '保存結果を確認できませんでした。通信を確認して再試行してください。同じ記録として確認します。';
  return '通信または保存に失敗しました。入力は保持されています。通信状態を確認して再試行してください。';
}
function fail(code){return Object.assign(new Error(code),{code});}
async function authWithDeadline(auth) {
  let timer;
  try{return await Promise.race([auth.getUser(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('TIMEOUT')),15000);})]);}
  finally{clearTimeout(timer);}
}
export function createStorage(getContext) {
  let inFlight=null;
  async function authorized() {
    const context={...getContext()};
    if(!context.db||!context.userId) throw fail('AUTH_REQUIRED');
    const {data,error}=await authWithDeadline(context.db.auth);
    if(error||!data?.user||data.user.is_anonymous||data.user.id!==context.userId) throw fail('AUTH_REQUIRED');
    if(getContext().generation!==context.generation) throw fail('SESSION_CHANGED');
    return context;
  }
  async function run(operation) {
    const context=await authorized();
    const result=await operation(context);
    if(getContext().generation!==context.generation) throw fail('SESSION_CHANGED');
    if(result.error) throw result.error;
    return result.data;
  }
  return {
    save(reflection,kind,revision=null) {
      if(inFlight) return inFlight;
      const payload=structuredClone(reflection);
      if(!['draft','record'].includes(kind)) return Promise.reject(fail('INVALID_RECORD'));
      const request=run(({db})=>db.rpc('save_mind_reflection',{p_id:payload.id,p_kind:kind,p_payload:payload,p_revision:revision}).abortSignal(AbortSignal.timeout(15000)));
      inFlight=request.finally(()=>{inFlight=null;});
      return inFlight;
    },
    list(kind,offset=0) {
      return run(({db,userId})=>db.from('mind_reflections').select('id,kind,payload,saved_at,revision').eq('user_id',userId).eq('kind',kind).order('saved_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+19).abortSignal(AbortSignal.timeout(15000)));
    },
    get(id,kind) {
      return run(({db,userId})=>db.from('mind_reflections').select('id,kind,payload,saved_at,revision').eq('user_id',userId).eq('id',id).eq('kind',kind).maybeSingle().abortSignal(AbortSignal.timeout(15000)));
    }
  };
}
