import { modeInstruction, blindSpotInstruction, emotionFocusInstruction, encouragementInstruction } from './chat-mode.js';
import { returnPathInstruction } from './return-path.js';

// Read on every generation. Never cache editable mode instructions across turns.
export async function resolveModeInstructions({ observation = false, blindSpot = false, emotionFocus = false, encouragement = false, returnPath = false }, { fetcher = fetch, env = process.env } = {}) {
  const modes = returnPath ? [['return_path', true, returnPathInstruction(true)]] : encouragement ? [['encouragement', true, encouragementInstruction(true)]] : [
    ['observation', observation, modeInstruction(observation)],
    ['blind_spot', blindSpot, blindSpotInstruction(blindSpot)],
    ['emotion_focus', emotionFocus, emotionFocusInstruction(emotionFocus)]
  ];
  const slugs = modes.filter(([, enabled]) => enabled).map(([slug]) => slug);
  let rows = [];
  if (slugs.length && env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
    try {
      const response = await fetcher(`${env.SUPABASE_URL}/rest/v1/ai_modes?slug=in.(${slugs.join(',')})&active=eq.true&select=slug,instructions,active,version`, {
        method: 'GET', cache: 'no-store',
        headers: { apikey: env.SUPABASE_SECRET_KEY, 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(3000)
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) rows = data;
      }
    } catch { /* Mode configuration must never prevent a conversation. */ }
  }
  return modes.map(([slug, enabled, fallback]) => {
    const row = enabled && rows.find(item => item?.slug === slug);
    return row?.active === true && typeof row.instructions === 'string' && row.instructions.trim()
      ? '\n\n' + row.instructions.trim() : fallback;
  }).join('');
}
