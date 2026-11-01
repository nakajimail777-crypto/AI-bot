# Ver.4 公開前確認（2026-11-02 JST）

## 対象と現在地

- リポジトリ: nakajimail777-crypto/AI-bot
- 作業ブランチ: feature/ayumi-today-focus（開始HEAD 4fb4965）
- GitHub main: 366956429761fbe5d326501b2c628b7fa112833b（ls-remoteで確認）
- 公開対象: https://ai-bot-beta-one.vercel.app/
- 公開前コミットはローカルだけ。push/merge/deploy/本番SQLは未実行。
- Vercel接続プロジェクト・Production Branch設定、Supabaseプロジェクト・適用履歴・バックアップは未確認。利用可能な専用コネクタやCLIは見つからず、資格情報の新規作成は行っていない。

## 公開対象

既存の未公開コミット4fb4965（今日の重点、focus SQLとテスト等）と今回のVer.4差分が対象。画面順は「目標と現在地 → これまでの歩み → 全体のチェックリスト → 今日の1個 → 振り返り・記録・設定」。進捗の見え方について質問はあったが、追加変更の指示はないため配置は維持。

今回: api/ayumi-plan.js、assets/ayumi.js、assets/ayumi-focus-ui.js、assets/ayumi-journey.js、assets/ayumi-journey-ui.js、assets/ayumi.css、index.html、新journey SQL、journeyテスト2本、文書、ローカルpreviewスクリプト。
previewはNode起動時だけ動く合成データ用で、本番indexは読み込まない。
未追跡の20260910_guest_trial.sqlと20260912_line_chat.sqlはステージ・コミット・適用対象から除外する。

## DB適用前に照合する内容

実環境の既存Ayumi基礎/history/weeks/archive/daily/v2/v3適用を確認し、未適用分だけ schedule → focus → journey の順に適用、その後クライアントを公開する。schedule/focusは再実行可能ではないので一括再実行しない。

- 20261101_ayumi_schedule.sql: scheduled_on対応検証関数、schedule_revision列、旧クライアント保護トリガー。authenticatedへ新列のINSERT/UPDATE権限。
- 20261101_ayumi_focus.sql: focus_day/focus_revision列、検証関数、旧クライアント保護トリガー。authenticatedへ新列のINSERT/UPDATE権限。
- 20261102_ayumi_journey.sql: journey/journey_revision列、JSON制約、履歴の削除・書換防止/旧クライアント保護トリガー。authenticatedへ新列のINSERT/UPDATE権限。
- journey SQLはachieved_onを参照するCHECK制約を列挙して削除し、日付範囲制約に置換する。実DBに独自のCHECKがあればそれも該当し得るため、実行前に定義を確認し想定外なら止める。
- 行のDELETE/TRUNCATE、既存値の一括UPDATE、列削除はない。既存ID・チェック・従来achieved_onを維持。新列追加のデフォルトrevision=0はある。
- RLSポリシー・所有者条件・匿名拒否・ログイン方式の変更はない。ただし列単位GRANTは権限設定変更なので具体的な承認を取る。新しい資格情報・課金・外部サービスは不要。
- 各SQLはトランザクション、lock_timeout=5秒、statement_timeout=60秒。失敗時はそのSQLをロールバックし、結果不明時は履歴とスキーマ確認を先に行う。

## 復旧

適用前にバックアップ/復元可能性と現在の公開デプロイIDを確認する。DB列や履歴は削除しない。新形式保存開始後に旧版へ単純ロールバックすると保護トリガーにより更新が拒否されるため、旧版への差し戻しだけで保存復旧とは扱わない。障害時はAyumiの書き込みを一時停止し、互換性を維持した修正版を再配信する。新形式保存前で旧版への復帰が必要な場合も、対象版とDB互換を検証してから行う。バックアップ全体復元は新しい記録を失い得るため、別途確認なしに行わない。

## 確認済み・未確認

ローカルPGliteで移行2回、旧データ保持、RLS/匿名拒否、競合、履歴保護を検証済み。390pxと通常幅、選択/完了/取消/休み/復元、折りたたみを模擬保存で確認済み。専用lint/型検査/buildは未定義。
実Supabaseの適用履歴と制約、実認証での保存・RLS、実AI応答、Vercel管理画面の公開設定は未確認。ローカル成功を本番成功と扱わない。

## 公開直前に必要な確認

1. 既存の管理画面/正規接続でVercelとSupabaseの対象を特定し、DB適用履歴・制約・復旧手段を読み取り確認する（秘密情報をチャットに貼らない）。
2. 確認した本番DBへの必要SQL適用、とくに新列のauthenticated書き込み権限追加とachieved_on CHECK置換を個別承認する。
3. DB検証後、確認したProduction Branch/デプロイ経路でVer.4を公開する。一般の公開依頼は受領済みだが、親への公開直前報告前にpushしない。

拒否された操作はない。上記は未実行・確認待ちであり、公開を試して失敗した状態ではない。

公開前再検証: 288件成功、失敗/スキップ0。node --test tests/*.test.js を実行（npmはPATHにないため同一定義のNodeコマンドを使用）。ログ: C:/Users/81901/Documents/Codex/2026-11-02/task/ver4-release-tests.txt。公開中HTMLは改行差を除いてorigin/main:index.htmlと一致し、journey/focusスクリプトは未配信。
