class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createBookshelfSyncHandler({ fetcher = fetch, env = process.env } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    try {
      const bearer = req.headers.authorization;
      if (typeof bearer !== 'string' || !/^Bearer [^\s]+$/.test(bearer)) throw new HttpError(401, 'ログインしてください。');
      const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: publicKey, SUPABASE_SECRET_KEY: secret, GEMINI_API_KEY: geminiKey } = env;
      if (!url || !publicKey || !secret || !geminiKey) throw new HttpError(503, '本棚の準備中です。');
      const userResponse = await fetcher(`${url}/auth/v1/user`, { headers: { apikey: publicKey, Authorization: bearer }, signal: AbortSignal.timeout(12000) });
      const user = await userResponse.json().catch(() => null);
      if (!userResponse.ok || !user?.id || user.is_anonymous) throw new HttpError(401, 'ログインし直してください。');
      async function db(path, { method = 'GET', body, prefer } = {}) {
        const response = await fetcher(url + path, { method, headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000) });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new HttpError(502, '本棚を更新できませんでした。');
        return data;
      }
      const drafts = await db('/rest/v1/knowledge_documents?status=eq.draft&metadata-%3E%3Eingestion_status=eq.pending_embedding&select=id,title,metadata&limit=10');
      let synced = 0;
      for (const document of drafts || []) {
        const content = document?.metadata?.content;
        if (typeof content !== 'string' || !content.trim() || content.length > 12000) continue;
        const embedded = await fetcher('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey }, body: JSON.stringify({ content: { parts: [{ text: `task: retrieval | document: ${document.title}\n${content.trim()}` }] }, output_dimensionality: 768 }), signal: AbortSignal.timeout(20000) });
        const embeddingData = await embedded.json().catch(() => null);
        const vector = embeddingData?.embedding?.values || embeddingData?.embeddings?.[0]?.values;
        if (!embedded.ok || !Array.isArray(vector) || vector.length !== 768) throw new HttpError(502, '本棚の検索準備に失敗しました。');
        await db('/rest/v1/knowledge_chunks?on_conflict=document_id,chunk_index', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { document_id: document.id, chunk_index: 0, content: content.trim(), embedding: vector, metadata: { source_type: document.metadata?.source_type || 'owner_conversation' } } });
        await db(`/rest/v1/knowledge_documents?id=eq.${document.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'active', updated_at: new Date().toISOString(), metadata: { ...document.metadata, ingestion_status: 'ready' } } });
        synced += 1;
      }
      return res.status(200).json({ synced, ready: true });
    } catch (error) {
      return res.status(error.status || 503).json({ error: error instanceof HttpError ? error.message : '本棚を更新できませんでした。' });
    }
  };
}

export default createBookshelfSyncHandler();
