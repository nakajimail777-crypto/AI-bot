import {createHash} from "node:crypto";

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !key.startsWith('sb_publishable_')) {
    return res.status(503).json({ error: 'ログインの準備中です。しばらくしてからお試しください。' });
  }
  if (req.query?.view === 'stepbook') {
    const hidden = () => res.status(200).json({url:null});
    const authorization = req.headers?.authorization;
    if (!authorization?.startsWith('Bearer ')) return hidden();
    try {
      const reply = await fetch(url+'/auth/v1/user', {
        headers:{apikey:key, Authorization:authorization}, signal:AbortSignal.timeout(6000)
      });
      if (!reply.ok) return hidden();
      const user = await reply.json();
      if (user.is_anonymous || !user.email_confirmed_at || typeof user.email !== 'string') return hidden();
      const digest = createHash('sha256').update(user.email.trim().toLowerCase()).digest('hex');
      return res.status(200).json({url:digest==='64e525bcd87221b4d1f8f3a09ba6f6e9e4c590e55f003beea25b4fb3bdd2f88f' ? 'https://ryuhijutsu-stepbook.nakajimail777.chatgpt.site/goal' : null});
    } catch { return hidden(); }
  }
  return res.status(200).json({ url, publishableKey: key });
}
