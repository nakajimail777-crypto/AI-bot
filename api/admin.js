const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LINE_HASH = /^[0-9a-f]{64}$/;
const PAGE_SIZE = 25;
const MESSAGE_PAGE_SIZE = 100;
const SHELF = 'metadata->>origin=eq.bookshelf';

export function createAdminHandler({env = process.env, fetcher = fetch, now = () => new Date()} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    const fail = (status, error) => res.status(status).json({error});
    if (req.method !== 'GET' && !(req.method === 'POST' && ['save_candidate', 'update_candidate'].includes(req.query?.action))) {
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
      if (!['summary', 'books', 'book', 'conversations', 'conversation', 'line_conversations', 'line_conversation', 'candidates', 'save_candidate', 'candidate', 'update_candidate'].includes(action)) return fail(400, '操作を確認してください。');
      if (['book', 'conversation', 'candidate'].includes(action) && (typeof q.id !== 'string' || !UUID.test(q.id))) return fail(400, '対象の指定が正しくありません。');
      if (action === 'line_conversation' && (typeof q.id !== 'string' || !LINE_HASH.test(q.id))) return fail(400, '対象の指定が正しくありません。');
      if (['save_candidate', 'update_candidate'].includes(action) && req.method !== 'POST') return fail(405, 'POSTで保存してください。');
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
      if (action === 'candidate') {
        const rows = await read(`learning_items?id=eq.${q.id}&select=id,original_text,learning_text,status,created_at,updated_at&limit=1`);
        if (!rows.length) return fail(404, '学習候補が見つかりません。');
        return res.status(200).json({candidate:rows[0]});
      }
      if (action === 'update_candidate') {
        const {id, learning_text, expected_updated_at} = req.body || {};
        if (typeof id !== 'string' || !UUID.test(id) || typeof learning_text !== 'string' || learning_text.length > 20000 || typeof expected_updated_at !== 'string' || expected_updated_at.length > 64 || !Number.isFinite(Date.parse(expected_updated_at))) return fail(400, '保存内容を確認してください。学びは20,000文字以内で入力してください。');
        // Compare-and-set prevents another editor's saved changes from being overwritten.
        const result = await fetcher(url + '/rest/v1/learning_items?id=eq.' + id + '&updated_at=eq.' + encodeURIComponent(expected_updated_at) + '&select=id,learning_text,updated_at', {
          method:'PATCH', headers:{...headers, 'Content-Type':'application/json', Prefer:'return=representation'},
          body:JSON.stringify({learning_text, updated_at:now().toISOString()}), signal:AbortSignal.timeout(10000)
        });
        if (!result.ok) return fail(503, '学びを保存できませんでした。入力内容は残っています。再試行してください。');
        const rows = await result.json();
        if (!Array.isArray(rows)) throw new Error('ADMIN_BAD_RESPONSE');
        if (!rows.length) return fail(409, '別の画面で更新されたか、候補が削除されています。入力内容をコピーしてから開き直してください。');
        return res.status(200).json({candidate:rows[0]});
      }
      if (action === 'candidates') {
        const rows = await read(`learning_items?select=id,created_at,original_text,status&order=created_at.desc,id.desc&limit=${PAGE_SIZE + 1}&offset=${offset}`);
        return res.status(200).json({...page(rows, PAGE_SIZE), items: rows.slice(0, PAGE_SIZE).map(row => ({...row, original_text: row.original_text.slice(0, 240)}))});
      }
      if (action === 'save_candidate') {
        const {id, source} = req.body || {};
        if (!['web', 'line'].includes(source) || typeof id !== 'string' || !(source === 'web' ? UUID : LINE_HASH).test(id)) return fail(400, '対象の会話が正しくありません。');
        const items = [];
        if (source === 'line') {
          const rows = await read(`line_chat_sessions?user_hash=eq.${id}&select=turns&limit=1`);
          if (!rows.length) return fail(404, '会話が見つかりません。');
          for (const turn of rows[0].turns || []) {
            if (typeof turn.message === 'string') items.push({role:'user', content:turn.message});
            if (typeof turn.reply === 'string') items.push({role:'assistant', content:turn.reply});
          }
        } else {
          const rows = await read(`conversations?id=eq.${id}&select=id&limit=1`);
          if (!rows.length) return fail(404, '会話が見つかりません。');
          // Read all pages; never silently save only the visible detail page.
          for (let start = 0;; start += 100) {
            const batch = await read(`messages?conversation_id=eq.${id}&select=role,content,sequence&order=sequence.asc&limit=100&offset=${start}`);
            items.push(...batch);
            if (batch.length < 100) break;
            if (items.length >= 10000) return fail(413, '会話が長すぎるため保存できませんでした。');
          }
        }
        const original_text = items.filter(item => typeof item.content === 'string' && item.content.trim()).map(item => `${item.role === 'user' ? 'ユーザー' : item.role === 'assistant' ? 'スピリットドラゴン' : item.role}: ${item.content}`).join('\n\n');
        if (!original_text) return fail(400, '保存する会話本文がありません。');
        if (original_text.length > 1000000) return fail(413, '会話が長すぎるため保存できませんでした。');
        const result = await fetcher(url + '/rest/v1/learning_items', {
          method:'POST', headers:{...headers, 'Content-Type':'application/json', Prefer:'return=minimal'},
          body:JSON.stringify({source_type:'conversation', source_id:id, session_id:id, original_text, status:'candidate'}), signal:AbortSignal.timeout(10000)
        });
        if (!result.ok) return fail(503, '学習候補に保存できませんでした。時間をおいて再試行してください。');
        return res.status(201).json({saved:true});
      }
      if (action === 'summary') {
        const until = now();
        const since = new Date(until.getTime() - 7 * 86400000);
        const [books, conversations, lineConversations] = await Promise.all([
          count(`knowledge_documents?${SHELF}&or=(metadata->>shelf_removed.is.null,metadata->>shelf_removed.eq.false)&select=id`),
          count(`conversations?updated_at=gte.${encodeURIComponent(since.toISOString())}&updated_at=lte.${encodeURIComponent(until.toISOString())}&select=id`),
          count(`line_chat_sessions?updated_at=gte.${encodeURIComponent(since.toISOString())}&updated_at=lte.${encodeURIComponent(until.toISOString())}&select=user_hash`)
        ]);
        return res.status(200).json({books, recentConversations: conversations + lineConversations, webRecentConversations: conversations, lineRecentConversations: lineConversations, since: since.toISOString(), until: until.toISOString(), candidates: null});
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
      if (action === 'line_conversations') {
        const rows = await read(`line_chat_sessions?select=user_hash,updated_at&order=updated_at.desc,user_hash.asc&limit=${PAGE_SIZE + 1}&offset=${offset}`);
        return res.status(200).json(page(rows, PAGE_SIZE));
      }
      if (action === 'line_conversation') {
        const rows = await read(`line_chat_sessions?user_hash=eq.${q.id}&select=user_hash,updated_at,turns&limit=1`);
        if (!rows.length) return fail(404, 'LINE会話が見つかりません。保持期間を過ぎた可能性があります。');
        const turns = Array.isArray(rows[0].turns) ? rows[0].turns : [];
        const items = [];
        for (const turn of turns) {
          if (typeof turn?.message === 'string') items.push({role:'user',content:turn.message});
          if (typeof turn?.reply === 'string') items.push({role:'assistant',content:turn.reply});
        }
        return res.status(200).json({lineConversation:{user_hash:rows[0].user_hash,updated_at:rows[0].updated_at},items,nextOffset:null});
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
