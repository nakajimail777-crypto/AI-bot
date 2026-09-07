const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function japanMonth(at = new Date()) {
  return new Date(at.getTime() + 9 * 3600000).toISOString().slice(0,7);
}
export function createUsageHandler({ fetcher = fetch, env = process.env, now = () => new Date() } = {}) {
  return async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    const fail = (status,error) => res.status(status).json({error});
    if(req.method !== 'GET') return fail(405,'Method not allowed');
    const bearer = req.headers.authorization;
    if(typeof bearer !== 'string' || !/^Bearer [^\s]+$/.test(bearer)) return fail(401,'ログインしてください。');
    const {SUPABASE_URL:url,SUPABASE_PUBLISHABLE_KEY:publicKey,SUPABASE_SECRET_KEY:secret}=env;
    if(!url || !publicKey || !secret) return fail(503,'使用量の集計を準備中です。');
    try {
      const auth = await fetcher(url+'/auth/v1/user',{headers:{apikey:publicKey,Authorization:bearer},signal:AbortSignal.timeout(5000)});
      const user = await auth.json().catch(()=>null);
      if(!auth.ok || !UUID.test(user?.id || '') || user.is_anonymous) return fail(401,'ログインし直してください。');
      const admin = (env.USAGE_ADMIN_USER_IDS || '').split(',').map(x=>x.trim()).filter(x=>UUID.test(x)).includes(user.id);
      const q = req.query || {};
      const month = q.month ?? japanMonth(now());
      if(typeof month !== 'string' || !/^20\d\d-(0[1-9]|1[0-2])$/.test(month)) return fail(400,'月の指定を確認してください。');
      const scope = q.scope || 'self';
      if(!['self','all'].includes(scope)) return fail(400,'集計範囲を確認してください。');
      if(scope === 'all' && !admin) return fail(403,'全体の集計は管理者のみ確認できます。');
      const ids = typeof q.requestIds === 'string' && q.requestIds ? q.requestIds.split(',') : [];
      if(q.requestIds !== undefined && typeof q.requestIds !== 'string' || ids.length > 50 || ids.some(id=>!UUID.test(id))) return fail(400,'回答の指定を確認してください。');
      const headers = {apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json'};
      async function read(path,body) {
        const r=await fetcher(url+'/rest/v1/'+path,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});
        if(!r.ok) throw new Error('USAGE_UNAVAILABLE');
        return r.json();
      }
      const [monthly,turns] = await Promise.all([
        read('rpc/api_usage_month',{p_month:month+'-01',p_user_id:scope==='all'?null:user.id}),
        ids.length ? read(`api_turn_usage?user_id=eq.${user.id}&request_id=in.(${ids.join(',')})&select=request_id,usage&limit=50`) : []
      ]);
      return res.status(200).json({month,scope,admin,monthly,turns});
    } catch { return fail(503,'使用量を読み込めませんでした。会話はそのまま続けられます。'); }
  };
}
export default createUsageHandler();
