const sumDigits = value => [...String(value)].reduce((sum, digit) => sum + Number(digit), 0);
function reduce(value) {
  while (value > 9 && ![11, 22, 33].includes(value)) value = sumDigits(value);
  return value;
}

// Accept a complete date, optionally labelled; never interpret arbitrary prose or IDs.
export function dragonNumbers(text) {
  const input = text.normalize('NFKC').trim();
  const match = input.match(/^(?:(?:生年月日|誕生日)\s*(?:は|[:：])?\s*)?(\d{4})(?:年|[\/.-])\s*(\d{1,2})(?:月|[\/.-])\s*(\d{1,2})日?(?:です)?[。！!]?$/)
    || input.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  const digits = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  const raw = sumDigits(digits);
  const nature = reduce(raw), guide = [11, 22].includes(day) ? day : reduce(sumDigits(day));
  return { nature, guide, formula: `龍性：${[...digits].join('＋')}＝${raw}${raw === nature ? '' : ` → ${nature}`}。龍導：${[11, 22].includes(day) ? day : [...String(day)].join('＋')}${day === guide ? '' : `＝${guide}`}。` };
}

export function knowledgeQueries(text) {
  const numbers = dragonNumbers(text);
  return numbers ? [`龍性${numbers.nature} 龍秘術 特徴 進み方`, `龍導${numbers.guide} 龍秘術 特徴 進み方`] : [text];
}

export function numberContext(text) {
  const numbers = dragonNumbers(text);
  return numbers ? `\n\n【サーバーで計算した数字】${numbers.formula}\n計算結果を使い、取得した参考資料と会話履歴の相談を結びつけて答えてください。資料にない数字の意味は作らず、数字から健康状態を判断しないでください。` : '';
}

export function uniqueKnowledge(rows) {
  return rows.filter((row, index) => rows.findIndex(other => other.title === row.title && other.content === row.content) === index);
}
