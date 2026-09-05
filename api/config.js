export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !key.startsWith('sb_publishable_')) {
    return res.status(503).json({ error: 'ログインの準備中です。しばらくしてからお試しください。' });
  }
  return res.status(200).json({ url, publishableKey: key });
}
