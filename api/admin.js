const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 25;
const MESSAGE_PAGE_SIZE = 100;
const SHELF = 'metadata->>origin=eq.bookshelf';

export function createAdminHandler({env = process.env, fetcher = fetch, now = () => new Date()} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    const fail = (status, error) => res.status(status).json({error});
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return fail(405, 'この画面では閲覧のみ利用できます。');
    }
    const bearer = req.headers?.authorization;
    if (typeof bearer !== 'string' || !/^Bearer [^\s]+$/.test(bearer)) return fail(401, 'ログインが必要です。');
    const {SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: publicKey, SUPABASE_SECRET_KEY: secret} = env;
    // Conversation access is explicitly granted, never inherited from usage-report access.
    const admins = (env.ADMIN_USER_IDS || '').split(',').map(id => id.trim().toLowerCase()).filter(id => UUID.test(id));
    if (!url || !publicKey || !secret || !admins.length) return fail(503, '管理画面の接続・管理者設定が必要です。');
    try {
      const auth = await fetcher(url + '/auth/v1/user', {
        headers: {apikey: publicKey, Authorization: bearer}, signal: AbortSignal.timeout(5000)
      });
      const user = await auth.json().catch(() => null);
      if (!auth.ok || !UUID.test(user?.id || '') || user.is_anonymous) return fail(401, 'ログインし直してください。');
      if (!admins.includes(user.id.toLowerCase())) return fail(403, '管理者のみ利用できます。');

      const q = req.query || {};
      const action = q.action ?? 'summary';
      if (!['summary', 'books', 'book', 'conversations', 'conversation'].includes(action)) return fail(400, '操作を確認してください。');
      if (['book', 'conversation'].includes(action) && (typeof q.id !== 'string' || !UUID.test(q.id))) return fail(400, '対象の指定が正しくありません。');
      const offsetText = q.offset ?? '0';
      if (typeof offsetText !== 'string' || !/^(0|[1-9]\d{0,6})$/.test(offsetText)) return fail(400, 'ページの指定が正しくありません。');
      const offset = Number(offsetText);
      const headers = {apikey: secret, Authorization: `Bearer ${secret}`};
      async function read(path) {
        const result = await fetcher(url + '/rest/v1/' + path, {headers, signal: AbortSignal.timeout(10000)});
        if (!result.ok) throw new Error('ADMIN_READ_FAILED');
        const rows = await result.json();
        if (!Array.isArray(rows)) throw new Error('ADMIN_BAD_RESPONSE');
        return rows;
      }
      async function count(path) {
        const result = await fetcher(url + '/rest/v1/' + path, {
          method: 'HEAD', headers: {...headers, Prefer: 'count=exact'}, signal: AbortSignal.timeout(10000)
        });
        const total = result.headers?.get('content-range')?.match(/\/(\d+)$/)?.[1];
        if (!result.ok || total === undefined || !Number.isSafeInteger(Number(total))) throw new Error('ADMIN_COUNT_FAILED');
        return Number(total);
      }
      const page = (rows, size) => ({items: rows.slice(0, size), nextOffset: rows.length > size ? offset + size : null});
      if (action === 'summary') {
        const until = now();
        const since = new Date(until.getTime() - 7 * 86400000);
        const [books, conversations] = await Promise.all([
          count(`knowledge_documents?${SHELF}&or=(metadata->>shelf_removed.is.null,metadata->>shelf_removed.eq.false)&select=id`),
          count(`conversations?updated_at=gte.${encodeURIComponent(since.toISOString())}&updated_at=lte.${encodeURIComponent(until.toISOString())}&select=id`)
        ]);
        return res.status(200).json({books, recentConversations: conversations, since: since.toISOString(), until: until.toISOString(), candidates: null});
      }
      if (action === 'books') {
        const rows = await read(`knowledge_documents?${SHELF}&select=id,title,source_name,updated_at,metadata&order=updated_at.desc,id.desc&limit=${PAGE_SIZE + 1}&offset=${offset}`);
        return res.status(200).json(page(rows, PAGE_SIZE));
      }
      if (action === 'book') {
        const rows = await read(`knowledge_documents?${SHELF}&id=eq.${q.id}&select=id,title,source_name,metadata&limit=1`);
        if (!rows.length) return fail(404, '資料が見つかりません。本棚を更新してください。');
        const chunks = await read(`knowledge_chunks?document_id=eq.${q.id}&select=content,chunk_index&order=chunk_index.asc&limit=${MESSAGE_PAGE_SIZE + 1}&offset=${offset}`);
        return res.status(200).json({document: rows[0], ...page(chunks, MESSAGE_PAGE_SIZE)});
      }
      if (action === 'conversations') {
        const rows = await read(`conversations?select=id,title,updated_at,archived_at&order=updated_at.desc,id.desc&limit=${PAGE_SIZE + 1}&offset=${offset}`);
        return res.status(200).json(page(rows, PAGE_SIZE));
      }
      const rows = await read(`conversations?id=eq.${q.id}&select=id,title,updated_at,archived_at&limit=1`);
      if (!rows.length) return fail(404, '会話が見つかりません。削除された可能性があります。');
      const messages = await read(`messages?conversation_id=eq.${q.id}&select=id,role,content,sequence&order=sequence.asc&limit=${MESSAGE_PAGE_SIZE + 1}&offset=${offset}`);
      // Keep the detail response separate from future candidate-extraction actions.
      return res.status(200).json({conversation: rows[0], ...page(messages, MESSAGE_PAGE_SIZE)});
    } catch {
      return fail(503, '管理データを読み込めませんでした。時間をおいて再試行してください。');
    }
  };
}
export default createAdminHandler();
