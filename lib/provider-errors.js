export function rateLimitDetails(data, headers, now = Date.now()) {
  const details = Array.isArray(data?.error?.details) ? data.error.details : [];
  const daily = details.some(d => (Array.isArray(d?.violations) ? d.violations : []).some(v => /per.?day|daily/i.test(`${v?.quotaId || ''} ${v?.quotaMetric || ''}`)));
  const retry = details.find(d => typeof d?.retryDelay === 'string')?.retryDelay;
  const seconds = retry && /^(\d+(?:\.\d+)?)s$/.test(retry) ? Math.ceil(parseFloat(retry)) : null;
  const header = headers?.get?.('retry-after');
  const headerSeconds = header == null ? null : /^\d+$/.test(header) ? Number(header) : Math.ceil((Date.parse(header) - now) / 1000);
  const values = [seconds, headerSeconds].filter(v => Number.isFinite(v) && v > 0);
  const retryAfterSeconds = values.length ? Math.min(86400, Math.max(...values)) : null;
  return { code: daily ? 'AI_DAILY_LIMIT' : 'AI_RATE_LIMIT', retryAfterSeconds,
    error: daily
      ? 'AIの1日あたりの利用上限に達しました。上限が回復してから、もう一度お試しください。入力した内容は残っています。'
      : `今はAIへのアクセスが集中しているか、利用上限に達しています。${retryAfterSeconds ? `約${retryAfterSeconds}秒待ってから` : '少し時間をおいて'}、もう一度お試しください。入力した内容は残っています。` };
}
