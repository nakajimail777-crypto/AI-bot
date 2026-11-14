// Standard text-only REST pricing, checked 2026-09-08.
// https://ai.google.dev/gemini-api/docs/pricing
export function priceFor(model, at = new Date()) {
  const later = new Date(at) >= new Date('2027-01-01T00:00:00Z');
  if (model === 'gemini-3.7-flash') return {
    version: later ? '2027-01-01' : '2026-09-08', currency: 'USD',
    input: later ? 1.5 : 0.75, output: later ? 7.5 : 3.75, cached: later ? 0.15 : 0.075
  };
  if (model === 'gemini-embedding-2') return { version: '2026-09-08', currency: 'USD', input: 0.2, output: 0, cached: 0.2 };
  // Standard Responses pricing, checked 2026-11-15.
  // https://developers.openai.com/api/docs/models/gpt-5.4-mini
  if (model === 'gpt-5.4-mini-2026-03-17') return { version: '2026-11-15', currency: 'USD', input: 0.75, output: 4.5, cached: 0.075 };
  return null;
}

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function calculateUsage(model, data, { at = new Date(), billingMode = 'unknown' } = {}) {
  if (model === 'gpt-5.4-mini-2026-03-17') return calculateOpenAIUsage(model, data, { at, billingMode });
  const u = data?.usageMetadata || {};
  const embedding = model === 'gemini-embedding-2';
  const input = count(u.promptTokenCount);
  const response = embedding ? 0 : count(u.candidatesTokenCount);
  const thinking = embedding ? 0 : count(u.thoughtsTokenCount ?? 0);
  const cached = count(u.cachedContentTokenCount ?? 0);
  const output = response === null || thinking === null ? null : response + thinking;
  const total = embedding ? input : count(u.totalTokenCount);
  const rates = priceFor(model, at);
  const mode = ['free', 'paid'].includes(billingMode) ? billingMode : 'unknown';
  const complete = !!rates && input !== null && output !== null && cached !== null && cached <= input;
  const estimatedUsd = complete ? Number((((input - cached) * rates.input + cached * rates.cached + output * rates.output) / 1e6).toFixed(12)) : null;
  return { model, input, response, thinking, output, total, cached, rates,
    estimatedUsd, billingMode: mode,
    billedUsd: mode === 'free' ? 0 : mode === 'paid' ? estimatedUsd : null };
}

function calculateOpenAIUsage(model, data, { at, billingMode }) {
  const usage = data?.usage;
  const input = count(usage?.input_tokens), output = count(usage?.output_tokens);
  // Output already includes reasoning tokens. Missing detail is unknown, not zero.
  const thinking = count(usage?.output_tokens_details?.reasoning_tokens);
  const cached = count(usage?.input_tokens_details?.cached_tokens);
  const response = output !== null && thinking !== null && thinking <= output ? output - thinking : null;
  const total = count(usage?.total_tokens);
  const rates = priceFor(model, at);
  const mode = ['free', 'paid'].includes(billingMode) ? billingMode : 'unknown';
  const complete = input !== null && output !== null && cached !== null && cached <= input
    && (thinking === null || thinking <= output) && (total === null || total === input + output);
  const estimatedUsd = complete ? Number((((input - cached) * rates.input + cached * rates.cached + output * rates.output) / 1e6).toFixed(12)) : null;
  return { provider: 'openai', model, input, response, thinking, output, total, cached, rates,
    estimatedUsd, billingMode: mode, billedUsd: mode === 'free' ? 0 : mode === 'paid' ? estimatedUsd : null };
}
