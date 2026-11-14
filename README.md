# スピリットドラゴンAI：DB接続版

## 2026-11-15：WebのAI切り替え

2026-11-15に本番公開済み。Gemini / OpenAIの実返信、AIをまたぐ履歴の引き継ぎ、保存・再読み込み、スマホ表示を確認。357件の自動テストがすべて成功。以下の初期導入記録とは別の更新。

- 「会話の管理」→「使うAI」で Gemini / OpenAI を選ぶ。既定はGemini、選択は利用者ごとにこの端末へ保存する。
- 次の返答から選択を反映し、既存の会話履歴・モード・添付・歩みのプラン作成を引き継ぐ。送信中は切り替えない。
- 返答の利用記録からAI名を表示し、「自分に戻る」のローカル定型文は「定型の案内」と区別する。ゲストの過去の返答には接続先の保存情報がないため、AI名を推測しない。
- 本棚の検索・登録は `gemini-embedding-2` / 768次元を継続。LINEと管理者の学習抽出はWebの選択欄に連動しない。
- サーバーの `OPENAI_API_KEY` で `gpt-5.4-mini-2026-03-17` Responsesを使用する。`store:false`、reasoning `low`。既存の `GEMINI_API_KEY` はそのまま保持する。
- OpenAIキーが未設定なら選択欄に「準備中」と表示し、生成を呼ばない。キーは公開画面・リポジトリに保存しない。本人の承認を受けてVercel ProductionへSecretとして登録済み。
- OpenAIの保存には既存の `chat_save_turn_with_usage` が必要。未導入時は旧保存RPCへ代替せず、Geminiを選ぶ案内を返す。
- 使用量は実際の各HTTP呼出しを記録。キャッシュ割引と推論トークンを重複なく計算し、使用量が不明な場合は金額を確定しない。`OPENAI_BILLING_MODE` は必要な場合だけ `paid` / `free` を明示し、既定の `unknown` は請求額を断定しない。

検証コマンド: `node --test --test-concurrency=1 tests/*.test.js`。UIの模擬確認は `node scripts/preview-usage.mjs`（実API・DB接続なし、公開対象外）。元プロジェクトから不足していたゲスト/LINEのSQLを変更せず復元したが、本作業では本番DBへ適用しない。今回の実装・実API確認・公開状況は `TEMP-openai-migration-ledger.md` に記録する。

## 初期導入時の記録：実装済み・公開前

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
