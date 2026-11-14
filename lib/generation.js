import { createHash } from 'node:crypto';
import { rateLimitDetails } from './provider-errors.js';

const providers = Object.freeze({
  gemini: { label: 'Gemini', model: 'gemini-3.7-flash', key: 'GEMINI_API_KEY' },
  openai: { label: 'OpenAI', model: 'gpt-5.4-mini-2026-03-17', key: 'OPENAI_API_KEY' }
});

// Safe error details only. Provider bodies, prompts and credentials never escape.
export class GenerationError extends Error {
  constructor(status, message, { code = 'AI_UNAVAILABLE', providerStatus = null, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = 'GenerationError';
    this.status = status;
    this.code = code;
    this.providerStatus = providerStatus;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
export function resolveProvider(value) {
  if (value === undefined) return 'gemini';
  if (typeof value !== 'string' || !Object.hasOwn(providers, value)) {
    throw new GenerationError(400, '使うAIを選び直してください。', { code: 'INVALID_PROVIDER' });
  }
  return value;
}
export function providerInfo(value, env = process.env) {
  const id = resolveProvider(value), { label, model, key } = providers[id];
  return { id, label, model, available: typeof env[key] === 'string' && !!env[key].trim() };
}
export function requireProvider(value, env = process.env) {
  const info = providerInfo(value, env);
  if (!info.available) throw new GenerationError(503, `${info.label}は接続の準備中です。別のAIを選んでください。`, { code: 'PROVIDER_UNCONFIGURED' });
  return info;
}

function inputMessages(contents) {
  if (!Array.isArray(contents) || !contents.length) throw new GenerationError(400, '送信する内容を確認してください。', { code: 'INVALID_AI_INPUT' });
  return contents.map(message => {
    if (!['user', 'model'].includes(message?.role) || !Array.isArray(message.parts) || !message.parts.length) {
      throw new GenerationError(400, '送信する内容を確認してください。', { code: 'INVALID_AI_INPUT' });
    }
    const content = message.parts.map(part => {
      if (typeof part?.text === 'string') return { type: 'input_text', text: part.text };
      if (message.role === 'user' && part?.inlineData?.mimeType === 'application/pdf' && typeof part.inlineData.data === 'string') {
        return { type: 'input_file', filename: 'attached-document.pdf', file_data: `data:application/pdf;base64,${part.inlineData.data}` };
      }
      throw new GenerationError(400, '添付資料を確認してください。', { code: 'INVALID_AI_INPUT' });
    });
    // A plain assistant history message is a Responses easy input message.
    return message.role === 'model'
      ? { role: 'assistant', content: content.map(part => part.text).join('\n') }
      : { role: 'user', content };
  });
}

function extractGemini(data) {
  const candidate = data?.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
    throw new GenerationError(502, 'AIの返答が途中で止まりました。もう一度お試しください。', { code: 'AI_INCOMPLETE' });
  }
  const parts = candidate?.content?.parts;
  return Array.isArray(parts) ? parts.filter(part => part && !part.thought).map(part => typeof part.text === 'string' ? part.text : '').join('').trim() : '';
}
function extractOpenAI(data) {
  if (data?.status !== 'completed' || data?.error || data?.incomplete_details) {
    throw new GenerationError(502, 'AIの返答が途中で止まりました。もう一度お試しください。', { code: 'AI_INCOMPLETE' });
  }
  const messages = Array.isArray(data.output) ? data.output.filter(item => item?.type === 'message' && item.role === 'assistant') : [];
  if (messages.some(item => item.status && item.status !== 'completed')) {
    throw new GenerationError(502, 'AIの返答が途中で止まりました。もう一度お試しください。', { code: 'AI_INCOMPLETE' });
  }
  const parts = messages.flatMap(item => Array.isArray(item.content) ? item.content : []);
  if (parts.some(part => part?.type === 'refusal')) throw new GenerationError(502, 'この内容には返答できませんでした。表現を変えてお試しください。', { code: 'AI_REFUSAL' });
  return parts.filter(part => part?.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('').trim();
}

export async function generateText({ provider: value = 'gemini', instructions = '', contents,
  maxOutputTokens = 4096, responseSchema, schemaName = 'response', timeoutMs = 45000, generationConfig = {} } = {},
  { fetcher = fetch, env = process.env } = {}) {
  const { id: provider, model } = requireProvider(value, env);
  const key = env[providers[provider].key].trim();
  let endpoint, body, headers;
  if (provider === 'gemini') {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    body = { systemInstruction: { parts: [{ text: instructions }] }, contents,
      generationConfig: { ...generationConfig, maxOutputTokens,
        ...(responseSchema ? { responseMimeType: 'application/json', responseJsonSchema: responseSchema } : {}) } };
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
  } else {
    endpoint = 'https://api.openai.com/v1/responses';
    body = { model, instructions, input: inputMessages(contents), store: false,
      reasoning: { effort: 'low' }, max_output_tokens: maxOutputTokens,
      prompt_cache_key: 'spirit-dragon-' + createHash('sha256').update(instructions).digest('hex').slice(0, 32),
      ...(responseSchema ? { text: { format: { type: 'json_schema', name: schemaName, strict: true, schema: responseSchema } } } : {}) };
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  }
  let response;
  try {
    response = await fetcher(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new GenerationError(503, 'AIと通信できませんでした。入力は残っています。もう一度お試しください。', {
      code: ['AbortError', 'TimeoutError'].includes(error?.name) ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE'
    });
  }
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    if (response.status === 429) {
      const limit = rateLimitDetails(data, response.headers);
      throw new GenerationError(429, limit.error, { ...limit, providerStatus: 429 });
    }
    throw new GenerationError(502, 'AIの返答を受け取れませんでした。もう一度お試しください。', { providerStatus: response.status });
  }
  const text = provider === 'gemini' ? extractGemini(data) : extractOpenAI(data);
  if (!text) throw new GenerationError(502, 'AIから返答を受け取れませんでした。もう一度お試しください。', { code: 'AI_EMPTY_RESPONSE' });
  return { text, provider, model };
}
