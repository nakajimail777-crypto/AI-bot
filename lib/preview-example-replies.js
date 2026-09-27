// Local-preview fixtures for the acceptance examples. Production never imports this file.
export function previewReply(message) {
  const text = String(message || '').trim();
  if (text === 'AIに言われたからそう思っているだけかも') return '私の言葉も提案の一つなので、いったん保留にして大丈夫です。今すぐ自分の考えを決めず、そのままにしておくこともできます。';
  if (text === '別の見方を知りたい') return '別の見方として、今すぐ一つに決める代わりに、小さく試してから考える方法もありそうです。合わなければ採用しなくて大丈夫です。';
  if (text === '具体的に何をすればいい？') return 'まず、今やることを一つだけ短く書き出してください。次に5分だけ着手し、続けるか休むかはその時点で決められます。';
  if (text === '今日はもう考えたくない') return '今日はこれ以上考えなくて大丈夫です。整理も結論も増やさず、ここでそのまま休みましょう。';
  return 'ローカル確認用の回答です。トークン数と料金はテストデータです。';
}
