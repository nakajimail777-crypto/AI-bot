# スピリットドラゴンAI：DB接続版

## 実装済み・公開前

GitHub `nakajimail777-crypto/AI-bot` の `main`、コミット `97e72faa078df3d3394c5237027b832349871d6b` を基に作成。
公開サイトはまだ更新していない。

- メールのログインリンク（Supabase Auth）。
- 利用者ごとの会話一覧、履歴の再表示、ページ分割、ログアウト。
- 選択中の会話と未送信文章を同じタブの再読み込み後に復元。
- APIはSupabaseでトークンを検証してから所有者を確認。
- 同じ会話の直近40メッセージ・合計48,000文字以内をGeminiに渡す。
- 既存のGeminiモデル名・GEMINI_API_KEY環境変数は維持。
- 質問とAI回答はDBトランザクションで同時保存。失敗時は成功と表示しない。
- 再送は同じrequestIdを使用。保存済みなら元の回答を返す。
- 同時更新を検知したら409を返し、会話を再読み込みして再送する。
- 利用者ごとに1分10回の生成要求制限。
- クライアント用SDKは2.115.0に固定し、SRIで改変を検証。
- 会話本文をHTMLとして解釈しない。APIは秘密情報や会話本文をログに記録しない。

## DBと公開環境の状態

- Supabase: `kbuqvvxwvxlmjwvsbihb`（Tokyo）。
- 初期テーブル作成済み。`003_atomic_chat_turn.sql` 相当も適用済み。
- 一括保存、所有者チェック、再送、競合、送信制限の実DBテストはPASS。
- Vercel `crypto-3ce8/ai-bot` の Production に `SUPABASE_URL` を追加済み。
- Supabase Site URL を `https://ai-bot-beta-one.vercel.app/` に設定。
- 未完了: 以下のキー設定、GitHub反映、Vercelデプロイ、本当のメールログインとGemini応答の確認。

## Vercelに設定する変数

Productionを対象に設定する。既存の `GEMINI_API_KEY` は維持する。

| 変数 | 設定内容 |
|---|---|
| SUPABASE_URL | https://kbuqvvxwvxlmjwvsbihb.supabase.co （設定済み） |
| SUPABASE_PUBLISHABLE_KEY | SupabaseのPublishable key（sb_publishable_から始まる） |
| SUPABASE_SECRET_KEY | SupabaseのSecret key（サーバー専用） |

キー値は本人が管理画面からVercelへ直接入力する。チャット・HTML・リポジトリに入れない。
公開キーの変数にsecretを入れると `/api/config` は503で停止し、値を返さない。
サーバーのsecretキーはAPIが所有者を検証した後の保存処理だけに使う。

## 公開手順

1. 2つのキーをVercelに設定。
2. ユーザーのGitHub反映承認を得る。
3. mainが基準コミットから変わっていないことを再確認。変わっていれば差分を統合。
4. 本フォルダの本番用ファイルを反映。`api/index.html` は元のまま維持。
5. Vercelのデプロイ完了を確認。
6. 本人のメールでログインし、日本語のテスト会話を1往復送信。
7. 再読み込み・新規会話・過去の履歴を開く・ログアウトを確認。

Supabase標準SMTPは管理メンバーのメールアドレスのみを対象とする試用サービス。
一般のお客様へ提供する前にカスタムSMTPが必要。現在の公式資料では標準SMTPは1時間2通に制限される。
https://supabase.com/docs/guides/auth/auth-smtp

## 検証範囲

`node --test tests/chat.test.js`：15項目PASS（通信先はモック）。
実Supabase：DBのトランザクション・アクセス制限テストPASS（テストはROLLBACK）。
ブラウザー：模擬ログイン、保存、再読み込み、履歴、エラー時の入力保持、デスクトップ・390px幅を確認。コンソールエラーなし。
画面確認は `work/preview.mjs` の試験用データを使用した。本当のメール送信・AI応答・APIからDBへの接続の証明ではない。
`work/` のプレビューサーバーや模擬認証コードは公開しない。
