(() => {
  const tokens = n => Number.isFinite(n) ? n.toLocaleString('ja-JP') : '未取得';
  const money = n => Number.isFinite(n) ? `$${n.toFixed(6)}` : '未取得';
  function answer(usage) {
    if (!usage?.generation) return '使用量：未記録（計測開始前、または取得できなかった回答）';
    const g = usage.generation, rag = usage.rag;
    const lines = [
      `入力 ${tokens(g.input)} ／ 出力 ${tokens(g.output)} ／ 合計 ${tokens(g.total)} トークン`,
      `出力の内訳：回答 ${tokens(g.response)}・思考 ${tokens(g.thinking)}`,
      `推定API料金（有料換算・USD）：${money(usage.estimatedUsd)}`,
      `回答生成 ${money(g.estimatedUsd)} ／ RAG検索 ${money(rag?.estimatedUsd)}`,
      `RAG埋め込み入力：${tokens(rag?.input)} トークン`
    ];
    if (g.billingMode === 'free') lines.push('無料枠設定：回答生成の推定請求額 $0（有料換算額とは異なります）');
    else if (g.billingMode === 'unknown') lines.push('課金設定は未確認です。表示額は請求確定額ではありません。');
    if (rag?.outcome !== 'succeeded') lines.push('この回答では参考資料の検索を利用できませんでした。');
    if (!usage.recorded) lines.push('使用量の保存を確認できず、月間累計に含まれない可能性があります。');
    return lines.join('\n');
  }
  function monthly(data) {
    const m=data.monthly, label=data.scope==='all'?'サービス全体':'あなたの会話';
    const names={generation:'回答生成',rag_search:'RAG検索',document_embedding:'資料登録'};
    const lines=[`${data.month} ／ ${label} ／ 日本時間`,
      `月間推定API料金（有料換算・USD）：${money(m.estimatedUsd)}${m.unknownCalls ? ' ＋ 未取得分' : ''}`,
      `推定請求額：${m.billingUnknownCalls ? '未確定（課金設定または使用量が不明）' : money(m.billedUsd)}`];
    for(const row of m.categories || []) lines.push(`${names[row.category] || row.category}：${money(row.estimated_usd)} ／ ${row.calls}回${row.unknown ? `・未取得${row.unknown}回` : ''}`);
    if(m.trackingStartedAt) lines.push(`記録開始：${new Date(m.trackingStartedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}`);
    else lines.push('使用量はまだ記録されていません。');
    lines.push('記録できたAPI呼び出しのみの集計です。計測開始前・記録失敗・外部ツールの利用は含まれません。会話を削除しても累計は残ります。');
    return lines.join('\n');
  }
  window.DragonUsage={answer,monthly};
})();
