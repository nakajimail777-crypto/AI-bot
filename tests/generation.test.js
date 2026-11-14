import test from 'node:test';
import assert from 'node:assert/strict';
import { generateText, resolveProvider, providerInfo, requireProvider, GenerationError } from '../lib/generation.js';

const env = { GEMINI_API_KEY: 'dummy-gemini-key', OPENAI_API_KEY: 'dummy-openai-key' };
const contents = [{ role: 'user', parts: [{ text: 'こんにちは' }] }];
const openai = (text = 'こんにちは。') => ({ status: 'completed', output: [
  { type: 'reasoning', summary: [{ text: 'PRIVATE_REASONING' }] },
  { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }
] });
const gemini = (text = 'こんにちは。') => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'PRIVATE_REASONING' }, { text }] } }] });
const json = (data, status = 200, headers) => new Response(JSON.stringify(data), { status, headers });

test('provider choice defaults only when omitted and availability never exposes a key', () => {
  assert.equal(resolveProvider(undefined), 'gemini');
  for (const value of ['', null, {}, ['openai'], '__proto__', 'OpenAI']) assert.throws(() => resolveProvider(value), error => error.status === 400);
  assert.deepEqual(providerInfo('openai', env), { id: 'openai', label: 'OpenAI', model: 'gpt-5.4-mini-2026-03-17', available: true });
  assert.equal(providerInfo('openai', { OPENAI_API_KEY: '   ' }).available, false);
  assert.doesNotMatch(JSON.stringify(providerInfo('openai', env)), /dummy-openai-key|OPENAI_API_KEY/);
  assert.throws(() => requireProvider('openai', {}), error => error.status === 503 && error.code === 'PROVIDER_UNCONFIGURED');
});

test('missing or invalid provider fails before a provider request', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return json(openai()); };
  await assert.rejects(generateText({ provider: 'openai', contents }, { env: {}, fetcher }), { code: 'PROVIDER_UNCONFIGURED' });
  await assert.rejects(generateText({ provider: 'unknown', contents }, { env, fetcher }), { code: 'INVALID_PROVIDER' });
  assert.equal(calls, 0);
});

test('Gemini preserves its REST payload, role/content shape, output budget and schema', async () => {
  const schema = { type: 'object', required: ['answer'], additionalProperties: false, properties: { answer: { type: 'string' } } };
  let call;
  const result = await generateText({ instructions: 'same instruction', contents, maxOutputTokens: 2048, responseSchema: schema,
    generationConfig: { temperature: 0.2 } }, { env, fetcher: async (url, init) => { call = { url, init, body: JSON.parse(init.body) }; return json(gemini()); } });
  assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent');
  assert.equal(call.init.headers['x-goog-api-key'], env.GEMINI_API_KEY);
  assert.deepEqual(call.body, { systemInstruction: { parts: [{ text: 'same instruction' }] }, contents,
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json', responseJsonSchema: schema } });
  assert.deepEqual(result, { text: 'こんにちは。', provider: 'gemini', model: 'gemini-3.7-flash' });
  assert.ok(call.init.signal instanceof AbortSignal);
});

test('Responses keeps instruction hierarchy, chronological history, PDF data and stateless requests', async () => {
  let call;
  const history = [...contents, { role: 'model', parts: [{ text: '前の返答' }] }, { role: 'user', parts: [
    { text: 'このPDFについて' }, { inlineData: { mimeType: 'application/pdf', data: 'JVBERi0xLjQ=' } }
  ] }];
  const result = await generateText({ provider: 'openai', instructions: 'PERSONA_AND_RULES', contents: history, maxOutputTokens: 1234 }, {
    env, fetcher: async (url, init) => { call = { url, init, body: JSON.parse(init.body) }; return json(openai()); }
  });
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  assert.equal(call.init.headers.Authorization, `Bearer ${env.OPENAI_API_KEY}`);
  assert.equal(call.body.model, 'gpt-5.4-mini-2026-03-17');
  assert.equal(call.body.instructions, 'PERSONA_AND_RULES');
  assert.equal(call.body.store, false);
  assert.deepEqual(call.body.reasoning, { effort: 'low' });
  assert.equal(call.body.max_output_tokens, 1234);
  assert.deepEqual(call.body.input, [
    { role: 'user', content: [{ type: 'input_text', text: 'こんにちは' }] },
    { role: 'assistant', content: '前の返答' },
    { role: 'user', content: [{ type: 'input_text', text: 'このPDFについて' }, { type: 'input_file', filename: 'attached-document.pdf', file_data: 'data:application/pdf;base64,JVBERi0xLjQ=' }] }
  ]);
  assert.equal(call.body.previous_response_id, undefined);
  assert.equal(call.body.conversation, undefined);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_REASONING/);
  assert.deepEqual(result, { text: 'こんにちは。', provider: 'openai', model: 'gpt-5.4-mini-2026-03-17' });
});

test('OpenAI JSON schema is strict and cache key follows instructions rather than user content', async () => {
  const requests = [];
  const schema = { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } };
  const fetcher = async (_, init) => { requests.push(JSON.parse(init.body)); return json(openai('{"answer":"a"}')); };
  for (const [instructions, message] of [['stable', 'one'], ['stable', 'two'], ['changed', 'one']]) {
    await generateText({ provider: 'openai', instructions, contents: [{ role: 'user', parts: [{ text: message }] }], responseSchema: schema, schemaName: 'plan' }, { env, fetcher });
  }
  assert.deepEqual(requests[0].text.format, { type: 'json_schema', name: 'plan', strict: true, schema });
  assert.equal(requests[0].prompt_cache_key, requests[1].prompt_cache_key);
  assert.notEqual(requests[0].prompt_cache_key, requests[2].prompt_cache_key);
  assert.doesNotMatch(requests[0].prompt_cache_key, /stable|one/);
});

test('incomplete, refused, malformed and empty OpenAI outputs never become a reply', async () => {
  const fixtures = [
    { ...openai(), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    { ...openai(), status: 'failed', error: { message: 'secret provider detail' } },
    { ...openai(), status: 'in_progress' },
    { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'PRIVATE_REFUSAL' }] }] },
    { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'incomplete', content: [{ type: 'output_text', text: 'partial' }] }] },
    { status: 'completed', output: [] },
    { output_text: 'not a REST response' },
    null,
    openai('   ')
  ];
  for (const data of fixtures) {
    await assert.rejects(generateText({ provider: 'openai', contents }, { env, fetcher: async () => json(data) }), error => {
      assert.equal(error.status, 502); assert.doesNotMatch(JSON.stringify(error) + error.message, /secret provider detail|PRIVATE_REFUSAL|partial/); return true;
    });
  }
});

test('explicit Gemini truncation, safety stop and malformed content fail safely', async () => {
  for (const data of [{ candidates: [{ ...gemini().candidates[0], finishReason: 'MAX_TOKENS' }] },
    { candidates: [{ ...gemini().candidates[0], finishReason: 'SAFETY' }] }, { candidates: [{ content: { parts: {} } }] }, {}]) {
    await assert.rejects(generateText({ contents }, { env, fetcher: async () => json(data) }), error => error instanceof GenerationError && error.status === 502);
  }
});

test('rate limits preserve verified retry guidance and errors never expose upstream text', async () => {
  for (const provider of ['gemini', 'openai']) {
    await assert.rejects(generateText({ provider, contents }, { env, fetcher: async () => json({ error: { message: 'PRIVATE_KEY_OR_PROMPT' } }, 429, { 'Retry-After': '12' }) }), error => {
      assert.equal(error.status, 429); assert.equal(error.providerStatus, 429); assert.equal(error.retryAfterSeconds, 12); assert.doesNotMatch(error.message, /PRIVATE_KEY_OR_PROMPT/); return true;
    });
    await assert.rejects(generateText({ provider, contents }, { env, fetcher: async () => json({ error: { message: 'PRIVATE_KEY_OR_PROMPT' } }, 401) }), error => {
      assert.equal(error.status, 502); assert.equal(error.providerStatus, 401); assert.doesNotMatch(error.message, /PRIVATE_KEY_OR_PROMPT/); return true;
    });
  }
});

test('timeouts and upstream JSON errors do not leak details or retry automatically', async () => {
  let attempts = 0;
  await assert.rejects(generateText({ provider: 'openai', contents }, { env, fetcher: async () => { attempts++; throw new DOMException('PRIVATE_CONNECTION_DETAIL', 'TimeoutError'); } }), error => error.code === 'AI_TIMEOUT' && !error.message.includes('PRIVATE_'));
  assert.equal(attempts, 1);
  await assert.rejects(generateText({ provider: 'openai', contents }, { env, fetcher: async () => new Response('not json') }), error => error.status === 502);
});

test('unsupported attachments are rejected locally without sending partial content', async () => {
  let calls = 0;
  await assert.rejects(generateText({ provider: 'openai', contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'text/html', data: 'abc' } }] }] }, {
    env, fetcher: async () => { calls++; return json(openai()); }
  }), { code: 'INVALID_AI_INPUT' });
  assert.equal(calls, 0);
});
