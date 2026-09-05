const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function createHandler({ fetcher = fetch, env = process.env } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const startedAt = Date.now();
    let stage = 'validation', userId = null, conversationIdForLog = null, requestIdForLog = null, recordEvent = async () => {};
    try {
      const bearer = req.headers.authorization;
      if (typeof bearer !== 'string' || !/^Bearer [^\s]+$/.test(bearer)) throw new HttpError(401, 'ログインしてください。');
      const { message, conversationId, requestId } = req.body || {};
      if (typeof message !== 'string' || !message.trim() || message.length > 4000 || !UUID.test(conversationId || '') || !UUID.test(requestId || '')) {
        throw new HttpError(400, 'メッセージは1〜4,000文字で入力してください。');
      }
      const text = message.trim();
      conversationIdForLog = conversationId; requestIdForLog = requestId;
      const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: publicKey, SUPABASE_SECRET_KEY: secret, GEMINI_API_KEY: geminiKey } = env;
      if (!url || !publicKey || !secret || !geminiKey) throw new HttpError(503, '会話保存の準備中です。しばらくしてからお試しください。');
      async function request(path, { server = false, method = 'GET', body } = {}) {
        const headers = { apikey: server ? secret : publicKey, 'Content-Type': 'application/json' };
        if (!server) headers.Authorization = bearer;
        const response = await fetcher(url + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000) });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          console.error('supabase_request_failed', {
            path: path.split('?')[0],
            status: response.status,
            code: data?.code || null,
            message: data?.message || null
          });
          if (path.startsWith('/auth/')) throw new HttpError(401, 'ログインし直してください。');
          if (data?.message === 'CHAT_RATE_LIMIT') throw new HttpError(429, '送信が続いています。1分ほど待ってからお試しください。');
          if (['CHAT_CHANGED', 'CHAT_ID_CONFLICT'].includes(data?.message)) throw new HttpError(409, '会話が更新されました。履歴を開き直してから送信してください。');
          if (data?.message === 'CHAT_NOT_FOUND') throw new HttpError(404, 'この会話は利用できません。');
          throw new HttpError(502, '会話を保存・読み込みできませんでした。入力を残しているので、もう一度お試しください。');
        }
        return data;
      }
      recordEvent = async (eventType, status, details = {}) => {
        try {
          await request('/rest/v1/debug_events', { server: true, method: 'POST', body: {
            user_id: userId, conversation_id: conversationIdForLog, request_id: requestIdForLog,
            event_type: eventType, status, stage, duration_ms: Date.now() - startedAt,
            error_code: details.errorCode || null, metadata: details.metadata || {}
          } });
        } catch { /* 診断記録の失敗で会話を止めない */ }
      };
      stage = 'authentication';
      const user = await request('/auth/v1/user');
      if (!user?.id || user.is_anonymous) throw new HttpError(401, 'メールでログインしてください。');
      userId = user.id;
      await recordEvent('chat_request', 'started');
      stage = 'conversation';
      const chats = await request(`/rest/v1/conversations?id=eq.${conversationId}&user_id=eq.${user.id}&archived_at=is.null&select=id`);
      if (!chats?.length) throw new HttpError(404, 'この会話は利用できません。');
      const prior = await request(`/rest/v1/messages?id=eq.${requestId}&conversation_id=eq.${conversationId}&select=id,role,content,reply_to`);
      if (prior.length) {
        if (prior[0].role !== 'user' || prior[0].content !== text) throw new HttpError(409, '会話が更新されました。履歴を開き直してください。');
        const answers = await request(`/rest/v1/messages?reply_to=eq.${requestId}&conversation_id=eq.${conversationId}&select=content`);
        if (answers.length) return res.status(200).json({ reply: answers[0].content, requestId, saved: true });
        throw new HttpError(409, '会話の保存状態を確認してください。');
      }
      await request('/rest/v1/rpc/chat_reserve_request', { server: true, method: 'POST', body: { p_user_id: user.id } });
      stage = 'persona';
      const personas = await request('/rest/v1/ai_personas?slug=eq.spirit_dragon&active=eq.true&select=instructions&limit=1', { server: true });
      const persona = personas?.[0]?.instructions;
      if (typeof persona !== 'string' || !persona.trim()) throw new HttpError(503, 'スピリットドラゴンの心を準備しています。しばらくしてからお試しください。');
      let knowledge = [];
      stage = 'rag';
      try {
        const embedded = await fetcher('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
          body: JSON.stringify({ content: { parts: [{ text: `task: retrieval | query: ${text}` }] }, output_dimensionality: 768 }),
          signal: AbortSignal.timeout(12000)
        });
        const embeddingData = await embedded.json().catch(() => null);
        const vector = embeddingData?.embedding?.values || embeddingData?.embeddings?.[0]?.values;
        if (!embedded.ok || !Array.isArray(vector) || vector.length !== 768) throw new Error('RAG_EMBED_FAILED');
        knowledge = await request('/rest/v1/rpc/match_knowledge', { server: true, method: 'POST', body: {
          query_embedding: vector, match_threshold: 0.58, match_count: 4
        } });
        await recordEvent('rag_search', 'succeeded', { metadata: { matches: knowledge.length } });
      } catch {
        knowledge = [];
        await recordEvent('rag_search', 'degraded', { errorCode: 'RAG_UNAVAILABLE' });
      }
      stage = 'history';
      const history = await request(`/rest/v1/messages?conversation_id=eq.${conversationId}&select=role,content,sequence&order=sequence.desc&limit=40`);
      const lastSequence = history[0]?.sequence ?? 0;
      const recent = []; let size = text.length;
      for (const row of history) {
        if (size + row.content.length > 48000) break;
        recent.push(row); size += row.content.length;
      }
      recent.reverse();
      while (recent[0]?.role === 'assistant') recent.shift();
      const contents = [...recent.map(row => ({ role: row.role === 'assistant' ? 'model' : 'user', parts: [{ text: row.content }] })), { role: 'user', parts: [{ text }] }];
      const shelfContext = knowledge.length ? `\n\n【本棚から見つかった参考資料】\n${knowledge.map((item, index) => `${index + 1}. ${item.title}\n${item.content}`).join('\n\n')}\n\n参考資料にない事実は推測せず、必要なら分からないと伝えてください。` : '';
      stage = 'generation';
      const generated = await fetcher('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: persona.trim() + shelfContext }] }, contents, generationConfig: { maxOutputTokens: 4096 } }), signal: AbortSignal.timeout(45000)
      });
      const data = await generated.json().catch(() => null);
      if (!generated.ok) throw new HttpError(generated.status === 429 ? 429 : 502, generated.status === 429 ? 'AIの利用上限に達しました。時間をおいてお試しください。' : 'AIの応答を取得できませんでした。もう一度お試しください。');
      const reply = data?.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('').trim();
      if (!reply || reply.length > 32000) throw new HttpError(502, 'AIの応答を取得できませんでした。もう一度お試しください。');
      stage = 'save';
      const saved = await request('/rest/v1/rpc/chat_save_turn', { server: true, method: 'POST', body: {
        p_user_id: user.id, p_conversation_id: conversationId, p_request_id: requestId,
        p_message: text, p_reply: reply, p_last_sequence: lastSequence
      } });
      await recordEvent('chat_request', 'succeeded', { metadata: { rag_matches: knowledge.length } });
      return res.status(200).json({ reply: saved.reply, requestId, saved: true });
    } catch (error) {
      await recordEvent('chat_request', 'failed', { errorCode: error instanceof HttpError ? `HTTP_${error.status}` : 'UNEXPECTED' });
      return res.status(error.status || 503).json({ error: error instanceof HttpError ? error.message : '通信に時間がかかっています。入力を残しているので、もう一度お試しください。' });
    }
  };
}
