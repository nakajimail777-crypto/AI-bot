import {prepareMarkdown, createChunks} from './bookshelf.js';
import {embed} from '../scripts/prepare-knowledge.mjs';
import {createMeter} from '../lib/usage.js';
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createBookshelfSyncHandler({ fetcher = fetch, env = process.env, embedder = embed } = {}) {
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
      const admins=(env.ADMIN_USER_IDS || '').split(',').map(id=>id.trim().toLowerCase()).filter(Boolean);
      if(!admins.includes(user.id.toLowerCase())) throw new HttpError(403, '管理者のみ利用できます。');
      async function db(path, { method = 'GET', body, prefer } = {}) {
        const response = await fetcher(url + path, { method, headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000) });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new HttpError(502, '本棚を更新できませんでした。');
        return data;
      }
      if(req.body?.candidateId) {
        const {candidateId, expected_updated_at}=req.body;
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateId) || typeof expected_updated_at!=='string' || !Number.isFinite(Date.parse(expected_updated_at))) throw new HttpError(400,'候補を開き直してください。');
        const rows=await db('/rest/v1/learning_items?id=eq.'+candidateId+'&select=id,learning_text,updated_at,bookshelf_document_id');
        const candidate=rows?.[0];
        if(!candidate) throw new HttpError(404,'学習候補が見つかりません。');
        if(candidate.updated_at!==expected_updated_at) throw new HttpError(409,'候補が更新されています。開き直して内容を確認してください。');
        if(candidate.bookshelf_document_id) {
          const books=await db('/rest/v1/knowledge_documents?id=eq.'+candidate.bookshelf_document_id+'&select=id,metadata');
          if(!books?.length) throw new HttpError(409,'資料が見つかりません。管理者に確認してください。');
          if(!books[0].metadata?.shelf_removed) return res.status(200).json({id:candidate.bookshelf_document_id,alreadyAdopted:true});
        }
        if(!candidate.learning_text?.trim()) throw new HttpError(400,'残したい学びを入力し、先に保存してください。');
        const title=candidate.learning_text.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0,100);
        const note=prepareMarkdown('学習候補.md',candidate.learning_text);
        const meter=createMeter({env,fetcher,embeddingCategory:'document_embedding'});
        let chunks;
        try { chunks=await createChunks(note.chunks,title,{embedder,fetcher:meter.fetch,key:geminiKey}); }
        finally { await meter.flush(); }
        const response=await fetcher(url+'/rest/v1/rpc/adopt_learning_item', {method:'POST',headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({p_id:candidateId,p_expected_updated_at:expected_updated_at,p_title:title,p_chunks:chunks}),signal:AbortSignal.timeout(30000)});
        const result=await response.json().catch(()=>null);
        if(!response.ok) {
          if(result?.message?.includes('CANDIDATE_CONFLICT')) throw new HttpError(409,'候補が更新されています。開き直して内容を確認してください。');
          throw new HttpError(502,'本棚に登録できませんでした。学びは保存されています。再試行してください。');
        }
        return res.status(200).json(result);
      }
      if(req.body?.action!=='sync_pending') throw new HttpError(400,'登録する学習候補を選んでください。');
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
