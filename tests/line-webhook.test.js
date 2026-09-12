import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createLineHandler, verifyLineSignature, lineTextMessages } from '../lib/line-webhook.js';

const user = 'U' + 'a'.repeat(32);
const env = { LINE_BOT_ENABLED: 'true', LINE_CHANNEL_SECRET: 'test-secret', LINE_CHANNEL_ACCESS_TOKEN: 'test-token', SUPABASE_URL: 'https://db.test', SUPABASE_SECRET_KEY: 'db-secret', GEMINI_API_KEY: 'gemini-test' };
const event = (changes = {}) => ({ type: 'message', webhookEventId: randomUUID(), replyToken: 'reply-token', source: { type: 'user', userId: user }, message: { type: 'text', text: 'こんにちは' }, ...changes });
function request(events, changes = {}) {
  const body = JSON.stringify({ destination: 'bot', events });
  return new Request('https://site.test/api/line-webhook', { method: 'POST', body, headers: { 'x-line-signature': createHmac('sha256', env.LINE_CHANNEL_SECRET).update(body).digest('base64') }, ...changes });
}
function setup({ state = { turns: [] }, failure, ragFailure = false, ...options } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body, headers: init.headers });
    let data = {}, status = 200;
    if (url.includes('rpc/line_chat')) data = body.p_action === 'reserve' ? state : { ok: true };
    else if (url.includes('ai_personas')) data = [{ instructions: 'PERSONA_FROM_DATABASE' }];
    else if (url.includes('embedContent')) { data = { embedding: { values: Array(768).fill(.1) } }; if (ragFailure) status = 503; }
    else if (url.includes('match_knowledge')) data = [{ title: '本棚', content: 'REFERENCE_FROM_DATABASE' }];
    else if (url.includes('generateContent')) { data = { candidates: [{ content: { parts: [{ thought: true, text: 'private thought' }, { text: 'こんにちは。' }] } }] }; if (failure === 'generation') status = 429; }
    else if (url.includes('api.line.me') && failure === 'send') status = 500;
    if (url.includes('rpc/line_chat') && body.p_action === 'finish' && failure === 'finish') status = 500;
    return new Response(JSON.stringify(data), { status });
  };
  return { calls, handler: createLineHandler({ env, fetcher, ...options }) };
}

test('signature verifies exact raw bytes including Japanese; fails closed', async () => {
  const raw = Buffer.from('{ "text": "こんにちは" }');
  const mac = createHmac('sha256', env.LINE_CHANNEL_SECRET).update(raw).digest('base64');
  assert.equal(verifyLineSignature(raw, mac, env.LINE_CHANNEL_SECRET), true);
  for (const signature of [null, '', mac.slice(1), 'x'.repeat(44)]) assert.equal(verifyLineSignature(raw, signature, env.LINE_CHANNEL_SECRET), false);
  assert.equal(verifyLineSignature(Buffer.from('{"text":"こんにちは"}'), mac, env.LINE_CHANNEL_SECRET), false);
  const s = setup();
  assert.equal((await s.handler(request([event()], { headers: { 'x-line-signature': 'bad' } }))).status, 401);
  assert.equal(s.calls.length, 0);
});

test('webhook verification, disabled bot and group messages never spend AI tokens', async () => {
  for (const [events, customEnv] of [[[], env], [[event()], { ...env, LINE_BOT_ENABLED: 'false' }], [[event({ source: { type: 'group', userId: user } })], env]]) {
    const s = setup({ env: customEnv });
    assert.equal((await s.handler(request(events))).status, 200);
    assert.equal(s.calls.length, 0);
  }
});

test('every 1-to-1 LINE friend can reach AI and gets an isolated history', async () => {
  const secondUser = 'U' + 'b'.repeat(32);
  const s = setup({ state: { turns: [], first: true } });
  await s.handler(request([event(), event({ source: { type: 'user', userId: secondUser }, message: { type: 'text', text: 'ダイエット' } })]));
  const reserves = s.calls.filter(c => c.body?.p_action === 'reserve');
  assert.equal(reserves.length, 2);
  assert.notEqual(reserves[0].body.p_user, reserves[1].body.p_user);
  assert.equal(s.calls.filter(c => c.url.includes('generateContent')).length, 2);
  assert.equal(s.calls.filter(c => c.url.includes('api.line.me')).length, 2);
});

test('uses isolated server history, live persona and bookshelf and delivers without thought text', async () => {
  const s = setup({ state: { turns: [{ message: 'earlier', reply: 'answer' }], first: true } });
  assert.equal((await s.handler(request([event()]))).status, 200);
  const generation = s.calls.find(c => c.url.includes('generateContent')).body;
  assert.match(generation.systemInstruction.parts[0].text, /PERSONA_FROM_DATABASE.*REFERENCE_FROM_DATABASE/s);
  assert.deepEqual(generation.contents.map(c => c.role), ['user', 'model', 'user']);
  assert.equal(generation.contents[0].parts[0].text, 'earlier');
  const reply = s.calls.find(c => c.url.includes('api.line.me')).body;
  assert.match(reply.messages[0].text, /こんにちは。/);
  assert.match(reply.messages[0].text, /運営者が確認できる場合/);
  assert.match(reply.messages[0].text, /https:\/\/ai-bot-beta-one.vercel.app\/data-handling.html/);
  assert.doesNotMatch(reply.messages[0].text, /private thought/);
  const reserves = s.calls.filter(c => c.body?.p_action === 'reserve');
  assert.match(reserves[0].body.p_user, /^[a-f0-9]{64}$/);
  assert.ok(s.calls.some(c => c.body?.p_action === 'finish' && c.body.p_remember));
  const stored = JSON.stringify(s.calls.filter(c => c.url.startsWith(env.SUPABASE_URL)).map(c => c.body));
  assert.ok(!stored.includes(user)); assert.ok(!stored.includes('reply-token'));
});

test('birthday searches both numbers and supplies calculated results with original history', async () => {
  const s = setup({ state: { turns: [{ message: '痩せたい', reply: '生年月日は？' }] } });
  await s.handler(request([event({ message: { type: 'text', text: '19850526' } })]));
  const queries = s.calls.filter(c => c.url.includes('embedContent')).map(c => c.body.content.parts[0].text);
  assert.equal(queries.length, 2);
  assert.match(queries[0], /龍性9/);
  assert.match(queries[1], /龍導8/);
  const generation = s.calls.find(c => c.url.includes('generateContent')).body;
  assert.match(generation.systemInstruction.parts[0].text, /サーバーで計算した数字/);
  assert.equal(generation.contents[0].parts[0].text, '痩せたい');
  assert.equal(generation.contents.at(-1).parts[0].text, '19850526');
});

test('data handling command is fixed, does not call AI or enter conversation history', async () => {
  const s = setup();
  await s.handler(request([event({ message: { type: 'text', text: 'データの扱い' } })]));
  assert.ok(!s.calls.some(c => c.url.includes('generativelanguage')));
  const reply = s.calls.find(c => c.url.includes('api.line.me')).body.messages[0].text;
  assert.match(reply, /data-handling.html/);
  assert.match(reply, /トーク画面のメッセージは残ります/);
  assert.equal(s.calls.find(c => c.body?.p_action === 'finish').body.p_remember, false);
});

test('later conversation replies do not repeat the data notice', async () => {
  const s = setup({ state: { turns: [{ message: 'こんにちは', reply: 'こんにちは' }], first: false } });
  await s.handler(request([event()]));
  assert.doesNotMatch(s.calls.find(c => c.url.includes('api.line.me')).body.messages[0].text, /data-handling.html/);
});

test('duplicates are ignored; busy and limited requests do not generate or enter history', async () => {
  const duplicate = setup({ state: { skip: true } });
  await duplicate.handler(request([event()])); assert.equal(duplicate.calls.length, 1);
  for (const code of ['BUSY', 'LIMIT']) {
    const s = setup({ state: { code } }); await s.handler(request([event()]));
    assert.ok(!s.calls.some(c => c.url.includes('googleapis')));
    assert.equal(s.calls.filter(c => c.url.includes('api.line.me')).length, 1);
    assert.equal(s.calls.find(c => c.body?.p_action === 'finish').body.p_remember, false);
  }
});

test('follow, reset, unsupported media and oversized text return non-AI responses', async () => {
  for (const e of [event({ type: 'follow' }), event({ message: { type: 'text', text: '会話をリセット' } }), event({ message: { type: 'image' } }), event({ message: { type: 'text', text: 'x'.repeat(4001) } })]) {
    const s = setup(); await s.handler(request([e]));
    assert.ok(!s.calls.some(c => c.url.includes('googleapis')));
    assert.equal(s.calls.filter(c => c.url.includes('api.line.me')).length, 1);
    assert.equal(s.calls.find(c => c.body?.p_action === 'reserve').body.p_reset, e.message?.text === '会話をリセット');
  }
});

test('provider failure returns friendly message; ambiguous delivery is never sent again', async () => {
  for (const failure of ['generation', 'send', 'finish']) {
    const s = setup({ failure }); await s.handler(request([event()]));
    assert.equal(s.calls.filter(c => c.url.includes('api.line.me')).length, 1);
    assert.ok(s.calls.some(c => c.body?.p_action === 'fail'));
    if (failure === 'generation') assert.match(s.calls.find(c => c.url.includes('api.line.me')).body.messages[0].text, /もう一度/);
  }
  const s = setup({ ragFailure: true }); await s.handler(request([event()]));
  assert.ok(s.calls.some(c => c.body?.p_action === 'finish'));
});

test('background work is registered and acknowledged before generation finishes', async () => {
  let registered;
  const s = setup({ waitUntil: promise => { registered = promise; } });
  assert.equal((await s.handler(request([event()]))).status, 200);
  assert.ok(registered instanceof Promise);
  await registered;
  assert.ok(s.calls.some(c => c.body?.p_action === 'finish'));
});

test('malformed payloads and large bodies rejected before external calls', async () => {
  const s = setup();
  assert.equal((await s.handler(new Request('https://site.test/'))).status, 405);
  assert.equal((await s.handler(request(null))).status, 400);
  assert.equal((await s.handler(request([], { body: 'x'.repeat(262145) }))).status, 413);
  assert.equal(s.calls.length, 0);
});

test('LINE splitting preserves emoji and keeps within API limits', () => {
  const text = 'あ'.repeat(4899) + '🐉'.repeat(5100);
  const messages = lineTextMessages(text);
  assert.equal(messages.map(m => m.text).join(''), text);
  assert.ok(messages.every(m => m.text.length <= 4900 && !/[\uD800-\uDBFF]$/.test(m.text)));
  assert.throws(() => lineTextMessages('a'.repeat(24501)));
});

test('SQL isolates users, deduplicates, enforces leases/limits, caps history and resets', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; grant usage on schema public to service_role;');
    const sql = await readFile(new URL('../supabase/migrations/20260912_line_chat.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql); // Migration can be applied twice.
    const a = 'a'.repeat(64), b = 'b'.repeat(64);
    const call = async (u, eventId, lease, action, message = null, reply = null, reset = false, remember = false) =>
      (await db.query('select line_chat($1,$2,$3,$4,$5,$6,$7,$8) as result', [u, eventId, lease, action, message, reply, reset, remember])).rows[0].result;
    const id = randomUUID(), lease = randomUUID();
    await db.exec('set role anon');
    await assert.rejects(call(a, id, lease, 'reserve', 'private'), /permission denied/);
    await assert.rejects(db.query('select * from line_chat_sessions'), /permission denied/);
    await db.exec('set role authenticated');
    await assert.rejects(call(a, id, lease, 'reserve', 'private'), /permission denied/);
    await db.exec('set role service_role');
    assert.deepEqual((await call(a, id, lease, 'reserve', 'private')).turns, []);
    assert.equal((await call(a, id, randomUUID(), 'reserve', 'changed')).skip, true);
    const busyId = randomUUID(), busyLease = randomUUID();
    assert.equal((await call(a, busyId, busyLease, 'reserve', 'parallel')).code, 'BUSY');
    await call(a, busyId, busyLease, 'prepare', null, 'busy');
    await call(a, busyId, busyLease, 'finish'); // Must not release the first event's lease.
    assert.equal((await call(a, randomUUID(), randomUUID(), 'reserve', 'parallel')).code, 'BUSY');
    await assert.rejects(call(b, id, lease, 'prepare', null, 'wrong user'), /LINE_LEASE/);
    await assert.rejects(call(a, id, randomUUID(), 'prepare', null, 'wrong lease'), /LINE_LEASE/);
    await call(a, id, lease, 'prepare', null, 'private reply');
    await call(a, id, lease, 'finish', null, null, false, true);
    assert.equal((await call(a, id, lease, 'reserve', 'private')).skip, true);
    const bId = randomUUID(), bLease = randomUUID();
    assert.deepEqual((await call(b, bId, bLease, 'reserve', 'other')).turns, []);
    await call(b, bId, bLease, 'fail');
    await db.exec('reset role');
    assert.equal((await db.query('select turns from line_chat_sessions where user_hash=$1', [a])).rows[0].turns[0].message, 'private');
    for (let i = 0; i < 22; i++) {
      await db.query('update line_chat_sessions set minute_count=0 where user_hash=$1', [a]);
      const e = randomUUID(), l = randomUUID();
      await call(a, e, l, 'reserve', 'question ' + i);
      await call(a, e, l, 'prepare', null, 'answer ' + i);
      await call(a, e, l, 'finish', null, null, false, true);
    }
    assert.equal((await db.query('select turns from line_chat_sessions where user_hash=$1', [a])).rows[0].turns.length, 20);
    await db.query('update line_chat_sessions set minute_count=5 where user_hash=$1', [a]);
    assert.equal((await call(a, randomUUID(), randomUUID(), 'reserve', 'limited')).code, 'LIMIT');
    await db.query('update line_chat_sessions set minute_count=0,day_count=100 where user_hash=$1', [a]);
    assert.equal((await call(a, randomUUID(), randomUUID(), 'reserve', 'limited')).code, 'LIMIT');
    await db.query('update line_chat_sessions set day_count=0 where user_hash=$1', [a]);
    const resetId = randomUUID(), resetLease = randomUUID();
    assert.deepEqual((await call(a, resetId, resetLease, 'reserve', '会話をリセット', null, true)).turns, []);
    await call(a, resetId, resetLease, 'prepare', null, 'reset');
    await call(a, resetId, resetLease, 'finish');
    assert.equal((await db.query('select count(*)::int as n from line_chat_events where user_hash=$1 and (message is not null or reply is not null)', [a])).rows[0].n, 0);
    await db.exec('update line_chat_daily set attempts=500');
    assert.equal((await call(b, randomUUID(), randomUUID(), 'reserve', 'global limit')).code, 'LIMIT');
  } finally { await db.close(); }
});
