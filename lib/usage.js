import { randomUUID } from 'node:crypto';
import { calculateUsage } from './pricing.js';

// One event per actual HTTP attempt. No prompts, answers, vectors or credentials.
export function createMeter({ fetcher = fetch, env = process.env, userId = null, conversationId = null, requestId = randomUUID(), embeddingCategory = 'rag_search', now = () => new Date() } = {}) {
  const events = [];
  let persisted = false;
  async function meteredFetch(url, init) {
    const match = String(url).match(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/([^/:]+):(generateContent|embedContent)$/);
    if (!match) return fetcher(url, init);
    const event = { id: randomUUID(), user_id: userId, conversation_id: conversationId, request_id: requestId,
      occurred_at: now().toISOString(), category: match[2] === 'generateContent' ? 'generation' : embeddingCategory,
      model: match[1], http_status: null, outcome: 'unknown' };
    let response;
    try {
      response = await fetcher(url, init);
      event.http_status = response.status;
      event.outcome = response.ok ? 'succeeded' : 'rejected';
      return response;
    } finally {
      let data = null;
      try { data = response ? await response.clone().json() : null; } catch { /* Missing metadata remains unknown. */ }
      event.usage = calculateUsage(event.model, data, { at: event.occurred_at, billingMode: env.GEMINI_BILLING_MODE });
      // A rejected request with no usage is not charged in this estimate. A timeout is unknown.
      if (event.outcome === 'rejected' && data?.usageMetadata == null) {
        event.usage.estimatedUsd = 0;
        event.usage.billedUsd = 0;
      }
      event.estimated_usd = event.usage.estimatedUsd;
      event.billed_usd = event.usage.billedUsd;
      events.push(event);
    }
  }
  async function flush() {
    if (persisted) return true;
    if (!events.length) return true;
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error('UNCONFIGURED');
      const response = await fetcher(env.SUPABASE_URL + '/rest/v1/api_usage_events?on_conflict=id', {
        method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
          'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(events), signal: AbortSignal.timeout(3000)
      });
      if (!response.ok) throw new Error('WRITE_FAILED');
      persisted = true;
    } catch { console.warn('usage_recording_unavailable'); }
    return persisted;
  }
  function summary() {
    const generation = events.findLast(e => e.category === 'generation');
    const rag = events.findLast(e => e.category === 'rag_search');
    const known = events.every(e => e.estimated_usd !== null);
    return { generation: generation?.usage || null, rag: rag ? { ...rag.usage, outcome: rag.outcome } : null,
      estimatedUsd: known ? events.reduce((sum, e) => sum + e.estimated_usd, 0) : null,
      recorded: persisted, eventIds: events.map(e => e.id) };
  }
  return { fetch: meteredFetch, flush, summary, events };
}
