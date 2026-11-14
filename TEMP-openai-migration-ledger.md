# OpenAI API Migration Decision Ledger

**Application:** スピリットドラゴンAI / 本番WebのAI切替
**Current integration:** 公開本体はGemini REST。別のローカル編集室では両AIの実比較が完了。この作業コピーは本番Webに選択機能を追加する。
**Selected integration and model:** 既存のOpenAI gpt-5.4-mini-2026-03-17、reasoning low。既存Geminiモデル・768次元埋め込みを維持。
**Approved migration scope and feature-stage plan:** 2026-11-15「本番のスピリットドラゴンもGeminiとOpenAIを切り替えられるようにできますか？」により、本番Webの通常会話・各モード・ゲスト・歩みプランの選択機能を実装する。既定はGemini。Stage 3: 共有生成処理と料金・認証・保存・各モード検証。Stage 4: 選択UI、PC/携帯表示と実API確認。Stage 5: 本番接続設定と公開確認。既存キー再利用は以前の「同じキーでお願いします」を継承し、新しい保存先へ秘密値を書く前に保存先を確認する。LINE連携と管理者用の学習抽出はこのWeb選択欄の対象外でGeminiを維持する。
**Privacy and retention requirements:** OpenAIはstore:false。アカウント全体のZDR/地域保持設定は未確認で保証しない。本人が選んだAIへ既存の会話・その返信に必要な資料を送る。認証・DBの所有権管理・保存形式を維持。本棚の埋め込みはGeminiを継続しUIで説明。キーはサーバー環境変数のみ、公開画面に入力欄なし。
**Assessment or implementation:** 本番Web向けの実装・ローカル検証は完了、公開設定の確認待ち。下の比較編集室の記録は過去の完了済み段階として保持する。本番向けの最新状態は最後の Production stage 欄を参照。

Review every item against the application, selected model and provider, developer decisions, and approved scope. Add rows for newly documented capabilities or workload-specific differences; under the migration section, use one row per required workflow or invocation mode, even when sharing a provider, with its selected route, retained alternatives, code/documentation changes, and validation commands/results. Replace every placeholder with a concise, developer-visible decision; never claim a capability was implemented or tested without supporting evidence.

**Applicable:** Whether the capability benefits the application's behavior, workloads, or product requirements: `yes`, `no`, or `unknown`; support alone does not establish applicability.
**Supported:** Whether the selected model, provider, framework, and SDK can provide the capability: `yes`, `no`, `partial`, or `unknown`.
**Decision:** The capability's agreed migration outcome: `pending`, `implemented`, `already present`, `deferred`, `unsupported`, or `not applicable`. Use `deferred` only for a feature-specific developer decision or concrete blocker; justify `unsupported` or `not applicable` with capability or workload evidence.
**Implemented:** Mark `[x]` only after approved implementation is complete and verified; leave `[ ]` for pending, deferred, unsupported, or inapplicable items.
**Rationale or evidence:** The brief product, compatibility, privacy, cost, or scope justification; include the planned stage and developer-decision receipt, or relevant code, tests, and versioned official documentation.

## Model Selection

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Record a concrete supported model recommendation and suitability for each workload; models may be shared. | yes | yes | already present | [x] | 既存ラボは gpt-5.4-mini-2026-03-17、reasoning low。モデル階層を変更しない。公式モデル文書と既存実装を確認。通常会話の実応答を確認済み。各本体経路の品質・時間は未検証。 |
| Preserve an appropriate existing model; confirm material model or capability-tier changes. | yes | yes | already present | [x] | 既存ラボは gpt-5.4-mini-2026-03-17、reasoning low。モデル階層を変更しない。公式モデル文書と既存実装を確認。通常会話の実応答を確認済み。各本体経路の品質・時間は未検証。 |
| Account for workload quality, speed, latency, and cost. | yes | yes | already present | [x] | 既存ラボは gpt-5.4-mini-2026-03-17、reasoning low。モデル階層を変更しない。公式モデル文書と既存実装を確認。通常会話の実応答を確認済み。各本体経路の品質・時間は未検証。 |

## Instruction File Naming

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve existing instruction files; add compatibility files only with explicit approval, without renaming or rewriting existing files. | no | yes | not applicable | [ ] | 既存の指示ファイルを維持。ファイル名変更・互換ファイル追加の必要なし。 |

## Migrate from Chat Completions to the Responses API

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Migrate applicable OpenAI workloads to the Responses API. | yes | yes | implemented | [x] | Web通常会話・各モード・ゲスト・歩みプランは選択したproviderを共有生成処理へ渡す。Gemini互換を保持。LINEと管理者の学習抽出は既存のGeminiを継続。Stage 3の統合テスト完了。 |
| Preserve existing product behavior and approved provider compatibility. | yes | yes | implemented | [x] | Web通常会話・各モード・ゲスト・歩みプランは選択したproviderを共有生成処理へ渡す。Gemini互換を保持。LINEと管理者の学習抽出は既存のGeminiを継続。Stage 3の統合テスト完了。 |

## Streaming

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve existing streaming and user-visible output behavior. | no | yes | not applicable | [ ] | 既存UIは返答を一括表示する。これを維持。ストリーミング追加は今回の切替検証に必須でなく、新しいUI動作は導入しない。 |
| Add streaming only where responsiveness benefits justify the approved change. | no | yes | not applicable | [ ] | 既存UIは返答を一括表示する。これを維持。ストリーミング追加は今回の切替検証に必須でなく、新しいUI動作は導入しない。 |
| Adapt typed Responses streaming events to existing rendering and consumption paths. | no | yes | not applicable | [ ] | 既存UIは返答を一括表示する。これを維持。ストリーミング追加は今回の切替検証に必須でなく、新しいUI動作は導入しない。 |
| Preserve complete-response workflows and defer disproportionate implementation changes. | no | yes | not applicable | [ ] | 既存UIは返答を一括表示する。これを維持。ストリーミング追加は今回の切替検証に必須でなく、新しいUI動作は導入しない。 |

## WebSocket Mode

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess persistent transport for long-running or tool-heavy workflows. | no | unknown | not applicable | [ ] | 短いHTTP要求を一度ずつ送る既存動作。長時間ツール実行や双方向接続なし。ラボは同時生成1件・45秒timeout・incomplete/refusal拒否を14件のテストで確認。WebSocket再接続は不要。 |
| Preserve existing HTTP and streaming behavior when WebSockets add insufficient value. | no | unknown | not applicable | [ ] | 短いHTTP要求を一度ずつ送る既存動作。長時間ツール実行や双方向接続なし。ラボは同時生成1件・45秒timeout・incomplete/refusal拒否を14件のテストで確認。WebSocket再接続は不要。 |
| Handle structured errors, failed or incomplete responses, and provider-specific concurrency limits; OpenAI allows one active response per `stream_id` lane, with concurrent lanes. | no | unknown | not applicable | [ ] | 短いHTTP要求を一度ずつ送る既存動作。長時間ツール実行や双方向接続なし。ラボは同時生成1件・45秒timeout・incomplete/refusal拒否を14件のテストで確認。WebSocket再接続は不要。 |
| Recover failed turns according to storage and Zero Data Retention requirements. | no | unknown | not applicable | [ ] | 短いHTTP要求を一度ずつ送る既存動作。長時間ツール実行や双方向接続なし。ラボは同時生成1件・45秒timeout・incomplete/refusal拒否を14件のテストで確認。WebSocket再接続は不要。 |
| Reconnect safely without duplicating visible output or side-effecting tool calls. | no | unknown | not applicable | [ ] | 短いHTTP要求を一度ずつ送る既存動作。長時間ツール実行や双方向接続なし。ラボは同時生成1件・45秒timeout・incomplete/refusal拒否を14件のテストで確認。WebSocket再接続は不要。 |

## Data Privacy and Residency

### Zero Data Retention

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Explicitly confirm Zero Data Retention and other retention requirements. | unknown | unknown | pending | [ ] | アカウントのZDR・保持契約は未確認。store:falseは既存ラボで維持し実要求をテスト。ZDR保証とは扱わない。本体の個人会話・DB資料は今回取得・送信していない。 |
| Verify endpoint, model, feature, tool, caching, and background-execution compatibility. | unknown | unknown | pending | [ ] | アカウントのZDR・保持契約は未確認。store:falseは既存ラボで維持し実要求をテスト。ZDR保証とは扱わない。本体の個人会話・DB資料は今回取得・送信していない。 |
| Configure stateless storage behavior when required. | yes | yes | already present | [x] | store:falseとローカルの会話管理を維持し、要求をテスト。アカウント全体のZDRや監査ログ保持の保証ではない。 |
| Preserve existing privacy and storage expectations. | yes | yes | already present | [x] | store:falseとローカルの会話管理を維持し、要求をテスト。アカウント全体のZDRや監査ログ保持の保証ではない。 |

### Data Residency

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Identify required storage and processing jurisdictions. | unknown | unknown | pending | [ ] | 地域要件やプロジェクト設定は未確認。既存ラボの標準endpointを維持し、地域設定変更なし。本体の実データを移す設計では別途確認が必要。 |
| Verify project settings, regional endpoints, and regional model or feature availability. | unknown | unknown | pending | [ ] | 地域要件やプロジェクト設定は未確認。既存ラボの標準endpointを維持し、地域設定変更なし。本体の実データを移す設計では別途確認が必要。 |
| Confirm residency or regional-processing tradeoffs with the developer. | unknown | unknown | pending | [ ] | 地域要件やプロジェクト設定は未確認。既存ラボの標準endpointを維持し、地域設定変更なし。本体の実データを移す設計では別途確認が必要。 |

## Processing Tiers

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess tier requirements separately for each distinct workload. | yes | yes | already present | [x] | 既存の既定・同期処理を維持。ラボの通常対話は実応答成功。本体Webも既定の同期処理を利用し、tierを変更しない。 |
| Standard processing. | yes | yes | already present | [x] | 既存の既定・同期処理を維持。ラボの通常対話は実応答成功。本体Webも既定の同期処理を利用し、tierを変更しない。 |
| Priority processing. | no | unknown | not applicable | [ ] | ラボは既存の同期REST・既定処理を維持。Priority/Flex/Batch/Reservedへの変更を要する待ち時間・一括処理・契約要件はない。LINE・管理者経路は未変更、Webは選択機能のみ追加。 |
| Flex processing. | no | unknown | not applicable | [ ] | ラボは既存の同期REST・既定処理を維持。Priority/Flex/Batch/Reservedへの変更を要する待ち時間・一括処理・契約要件はない。LINE・管理者経路は未変更、Webは選択機能のみ追加。 |
| Batch processing. | no | unknown | not applicable | [ ] | ラボは既存の同期REST・既定処理を維持。Priority/Flex/Batch/Reservedへの変更を要する待ち時間・一括処理・契約要件はない。LINE・管理者経路は未変更、Webは選択機能のみ追加。 |
| Reserved processing. | no | unknown | not applicable | [ ] | ラボは既存の同期REST・既定処理を維持。Priority/Flex/Batch/Reservedへの変更を要する待ち時間・一括処理・契約要件はない。LINE・管理者経路は未変更、Webは選択機能のみ追加。 |
| Confirm pricing, latency, availability, retention, and developer preferences. | yes | yes | already present | [x] | 既存の既定・同期処理を維持。ラボの通常対話は実応答成功。本体Webも既定の同期処理を利用し、tierを変更しない。 |

## Prompt Caching

### Prompt Cache Keys

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| For GPT-5.6 and later, omit new cache keys by default and preserve existing keys; for earlier models, use stable cache keys for reusable prompt prefixes. | yes | yes | implemented | [x] | 5.4-mini向けに指示文と要求形式版のSHA-256からstable prompt_cache_keyを生成。質問内容に依存せず、秘密値を含めない。14/14テスト、更新後実応答成功。 |
| Avoid cache-key and prefix fragmentation. | yes | yes | implemented | [x] | 5.4-mini向けに指示文と要求形式版のSHA-256からstable prompt_cache_keyを生成。質問内容に依存せず、秘密値を含めない。14/14テスト、更新後実応答成功。 |

### Extended Cache Retention for Earlier Models

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess extended retention for eligible models against developer retention requirements. | unknown | unknown | pending | [ ] | 既定キャッシュ保持を維持し、extended retentionは指定しない。保持要件未確認なので延長は未採用。今回の動作に保持期間変更は不要。 |

### Explicit Cache Breakpoints for GPT-5.6 and Later

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Apply supported explicit breakpoints to stable, reusable content. | no | no | not applicable | [ ] | 選択モデルは5.4-mini。5.6以降の機能を適用せず、通常のprefix再利用を維持。 |
| Choose implicit or explicit-only caching according to conversation and privacy requirements; record any breakpoint deferral separately. | no | no | not applicable | [ ] | 選択モデルは5.4-mini。5.6以降の機能を適用せず、通常のprefix再利用を維持。 |

### Prompt Cache Diagnostics

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Plan how to obtain a suitable comparison response ID and use `prompt_cache_options.comparison_response_id` on eligible GPT-5.6-and-later Responses requests; record evidenced workflow or retained-framework limitations. | no | no | not applicable | [ ] | 5.6以降のcomparison_response_idは選択モデル対象外。既存usageのcached_tokensで料金を計算。unknownを0と仮定しない。 |

## State Management

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Select local or server-side state according to architecture, privacy, and developer approval. | yes | yes | already present | [x] | ラボはタブのsessionStorageに履歴を保持し、交互のuser/assistant本文を毎回再送。本体は既存DB保存のまま。OpenAI側のstored-response chainingは使わない。ツール履歴は発生しない。 |
| Preserve complete conversation, reasoning, tool-call, and tool-output replay for stateless workflows. | yes | yes | already present | [x] | ラボはタブのsessionStorageに履歴を保持し、交互のuser/assistant本文を毎回再送。本体は既存DB保存のまま。OpenAI側のstored-response chainingは使わない。ツール履歴は発生しない。 |
| Use stored-response chaining only when retention is permitted and approved. | no | yes | not applicable | [ ] | 既存は全履歴再送とstore:false。保存済みResponseを連鎖する変更は不要。 |

### Instruction Persistence Gotcha

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve durable instructions across stateless replay and stored-response chaining. | yes | yes | already present | [x] | 毎回トップレベルinstructionsを再送。指示変更時にラボの会話を新しく始める既存確認UIを維持。順序付き履歴とinstructionsはテスト済み。 |
| Replay instruction input items or resend top-level instructions when required. | yes | yes | already present | [x] | 毎回トップレベルinstructionsを再送。指示変更時にラボの会話を新しく始める既存確認UIを維持。順序付き履歴とinstructionsはテスト済み。 |

## Reasoning

### Encrypted Reasoning Items

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve complete encrypted reasoning items across stateless turns and tool calls. | no | yes | not applicable | [ ] | 既存ラボ・本体の状態は表示済み会話本文であり、暗号化reasoning項目やツール反復を保持していない。既存項目の削除・再構成は行わず、新規のreasoning永続化は追加しない。 |
| Preserve original ordering, encrypted payloads, and tool-call identifiers. | no | yes | not applicable | [ ] | 既存ラボ・本体の状態は表示済み会話本文であり、暗号化reasoning項目やツール反復を保持していない。既存項目の削除・再構成は行わず、新規のreasoning永続化は追加しない。 |
| Avoid replacing original reasoning items with summaries or reconstructed text. | no | yes | not applicable | [ ] | 既存ラボ・本体の状態は表示済み会話本文であり、暗号化reasoning項目やツール反復を保持していない。既存項目の削除・再構成は行わず、新規のreasoning永続化は追加しない。 |

### Reasoning Effort

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Explicitly configure supported reasoning effort for each applicable model and workload. | yes | yes | already present | [x] | 既存ラボのlowを維持。5.4-mini公式文書でサポート確認。変更なし。本体の二段階判定等はlowを維持してStage 4で評価する。 |
| Preserve established preferences or confirm new quality, latency, and cost tradeoffs. | yes | yes | already present | [x] | 既存ラボのlowを維持。5.4-mini公式文書でサポート確認。変更なし。本体の二段階判定等はlowを維持してStage 4で評価する。 |
| Verify selected model and provider support. | yes | yes | already present | [x] | 既存ラボのlowを維持。5.4-mini公式文書でサポート確認。変更なし。本体の二段階判定等はlowを維持してStage 4で評価する。 |

### Reasoning Preservation

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess supported cross-turn versus current-turn reasoning preservation. | yes | partial | already present | [x] | 既存のuser/assistant本文履歴・順序・長さ上限を維持。ツール反復やencrypted reasoningのリプレイは既存に存在しない。推論本文を画面に出さない。 |
| Preserve required history while respecting context size, latency, privacy, and developer preferences. | yes | partial | already present | [x] | 既存のuser/assistant本文履歴・順序・長さ上限を維持。ツール反復やencrypted reasoningのリプレイは既存に存在しない。推論本文を画面に出さない。 |

### Reasoning Summaries and Tool-Call Preambles

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess reasoning summaries and tool-call preambles for the existing product experience. | no | unknown | not applicable | [ ] | 本人向け返答本文のみを表示する既存体験を維持。推論概要・ツールpreambleを使うUIはなく、追加しない。 |
| Preserve existing user-visible behavior and distinguish summaries from verbosity and message phases. | no | unknown | not applicable | [ ] | 本人向け返答本文のみを表示する既存体験を維持。推論概要・ツールpreambleを使うUIはなく、追加しない。 |
| Verify selected model, provider, and SDK support. | no | unknown | not applicable | [ ] | 本人向け返答本文のみを表示する既存体験を維持。推論概要・ツールpreambleを使うUIはなく、追加しない。 |

## Verbosity

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Configure supported response verbosity for each applicable request. | yes | yes | already present | [x] | 独立したverbosity値は設定せず既存の指示文で調整。公式モデル能力を確認し、今回出力の長さや利用者の選好を変更しない。 |
| Preserve established preferences or ask the developer before selecting a new setting. | yes | yes | already present | [x] | 独立したverbosity値は設定せず既存の指示文で調整。公式モデル能力を確認し、今回出力の長さや利用者の選好を変更しない。 |
| Confirm output-length, user-experience, latency, cost, model, and provider compatibility. | yes | yes | already present | [x] | 独立したverbosity値は設定せず既存の指示文で調整。公式モデル能力を確認し、今回出力の長さや利用者の選好を変更しない。 |

## Maximum Output Tokens

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve existing output limits when appropriate. | yes | yes | already present | [x] | ラボは既存max_output_tokens 4096を維持。不完全応答を拒否。推論tokenはoutputに含まれるため料金へ二重加算しない。本体self-returnの各2048等は未変更。 |
| Avoid inventing a limit without an application or developer requirement. | yes | yes | already present | [x] | ラボは既存max_output_tokens 4096を維持。不完全応答を拒否。推論tokenはoutputに含まれるため料金へ二重加算しない。本体self-returnの各2048等は未変更。 |
| Account for both visible output and reasoning tokens. | yes | yes | already present | [x] | ラボは既存max_output_tokens 4096を維持。不完全応答を拒否。推論tokenはoutputに含まれるため料金へ二重加算しない。本体self-returnの各2048等は未変更。 |

## Assistant Message Phases

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve supported assistant-message phases across requests and replay. | no | unknown | not applicable | [ ] | 既存製品は最終返答本文のみ。commentaryやツール反復に依存しない。既存のphase項目はなく、追加のharness再設計は不要。 |
| Retain structured assistant outputs rather than collapsing them to plain text. | no | unknown | not applicable | [ ] | 既存製品は最終返答本文のみ。commentaryやツール反復に依存しない。既存のphase項目はなく、追加のharness再設計は不要。 |
| Test relevant commentary and tool-loop behavior. | no | unknown | not applicable | [ ] | 既存製品は最終返答本文のみ。commentaryやツール反復に依存しない。既存のphase項目はなく、追加のharness再設計は不要。 |

## Context Compaction

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess native compaction for long-running conversations and tool-heavy workflows. | no | unknown | not applicable | [ ] | 既存ラボの24メッセージ・48,000文字上限、指示24,000文字を維持。native compactionやencrypted項目を使う長期tool loopなし。要約で履歴を変える変更は今回不要。 |
| Confirm changes to compaction strategy with the developer. | no | unknown | not applicable | [ ] | 既存ラボの24メッセージ・48,000文字上限、指示24,000文字を維持。native compactionやencrypted項目を使う長期tool loopなし。要約で履歴を変える変更は今回不要。 |
| Configure appropriate in-request or standalone compaction and thresholds. | no | unknown | not applicable | [ ] | 既存ラボの24メッセージ・48,000文字上限、指示24,000文字を維持。native compactionやencrypted項目を使う長期tool loopなし。要約で履歴を変える変更は今回不要。 |
| Preserve encrypted compaction items during manual state management. | no | unknown | not applicable | [ ] | 既存ラボの24メッセージ・48,000文字上限、指示24,000文字を維持。native compactionやencrypted項目を使う長期tool loopなし。要約で履歴を変える変更は今回不要。 |
| Verify privacy requirements and model or provider compatibility. | no | unknown | not applicable | [ ] | 既存ラボの24メッセージ・48,000文字上限、指示24,000文字を維持。native compactionやencrypted項目を使う長期tool loopなし。要約で履歴を変える変更は今回不要。 |

## Structured Outputs

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve required structured-output schemas, validation, parsing, and error handling. | yes | yes | implemented | [x] | self-return判定と歩みプランにはResponses text.formatのstrict JSON schemaと既存のローカル検証を使用する。通常会話は自由文。Stage 3で二段階の資料分離・構造不正・拒否・不完全出力を検証完了。 |
| Verify model and provider compatibility and add focused schema tests. | yes | yes | implemented | [x] | self-return判定と歩みプランにはResponses text.formatのstrict JSON schemaと既存のローカル検証を使用する。通常会話は自由文。Stage 3で二段階の資料分離・構造不正・拒否・不完全出力を検証完了。 |
| Avoid imposing structured outputs on unrestricted-text workflows. | yes | yes | implemented | [x] | self-return判定と歩みプランにはResponses text.formatのstrict JSON schemaと既存のローカル検証を使用する。通常会話は自由文。Stage 3で二段階の資料分離・構造不正・拒否・不完全出力を検証完了。 |

## Tools

### Tool Choice

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Preserve automatic, required, or restricted tool-selection behavior. | no | unknown | not applicable | [ ] | モデルが実行するツールは現状ない。RAGはサーバー処理。tool選択や権限を変更する必要なし。 |
| Confirm meaningful changes to tool-use policy with the developer. | no | unknown | not applicable | [ ] | モデルが実行するツールは現状ない。RAGはサーバー処理。tool選択や権限を変更する必要なし。 |

### Tool Search and Additional Tools

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess deferred tool discovery for large or dynamic tool catalogs. | no | unknown | not applicable | [ ] | 動的tool catalogなし。追加toolやtool-search replayは不要。安定した指示prefixと通常会話を維持する。 |
| Preserve correctly positioned additional-tool items and append-only replay. | no | unknown | not applicable | [ ] | 動的tool catalogなし。追加toolやtool-search replayは不要。安定した指示prefixと通常会話を維持する。 |
| Maintain stable cached prefixes without unnecessary tool-search complexity. | no | unknown | not applicable | [ ] | 動的tool catalogなし。追加toolやtool-search replayは不要。安定した指示prefixと通常会話を維持する。 |
| Confirm adoption or higher-lift implementation with the developer. | no | unknown | not applicable | [ ] | 動的tool catalogなし。追加toolやtool-search replayは不要。安定した指示prefixと通常会話を維持する。 |

### Parallel Tool Calls

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess concurrent execution of independent tools. | no | unknown | not applicable | [ ] | モデルのtool呼出しは存在しない。同時実行・順序・副作用の新規設計は導入しない。LINE送信等の既存アプリ処理も未変更。 |
| Preserve execution order, shared-state assumptions, approvals, and side-effect controls. | no | unknown | not applicable | [ ] | モデルのtool呼出しは存在しない。同時実行・順序・副作用の新規設計は導入しない。LINE送信等の既存アプリ処理も未変更。 |
| Confirm behavior-changing concurrency with the developer. | no | unknown | not applicable | [ ] | モデルのtool呼出しは存在しない。同時実行・順序・副作用の新規設計は導入しない。LINE送信等の既存アプリ処理も未変更。 |

### Programmatic Tool Calling

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess supported programmatic coordination of tool calls. | no | unknown | not applicable | [ ] | モデルがコードでtoolを組み合わせる実行環境なし。通常の対話API切替に不要。権限・承認・副作用は既存アプリのまま。 |
| Verify model, provider, SDK, tool, and execution-environment support. | no | unknown | not applicable | [ ] | モデルがコードでtoolを組み合わせる実行環境なし。通常の対話API切替に不要。権限・承認・副作用は既存アプリのまま。 |
| Preserve permissions, approvals, side-effect controls, and application behavior. | no | unknown | not applicable | [ ] | モデルがコードでtoolを組み合わせる実行環境なし。通常の対話API切替に不要。権限・承認・副作用は既存アプリのまま。 |
| Distinguish programmatic calling from ordinary sequential or parallel function calling. | no | unknown | not applicable | [ ] | モデルがコードでtoolを組み合わせる実行環境なし。通常の対話API切替に不要。権限・承認・副作用は既存アプリのまま。 |
| Test execution, results, failures, and changed approval behavior. | no | unknown | not applicable | [ ] | モデルがコードでtoolを組み合わせる実行環境なし。通常の対話API切替に不要。権限・承認・副作用は既存アプリのまま。 |

### Model-Aligned Tool Interfaces

| Guidance item | Applicable | Supported | Decision | Implemented | Rationale or evidence |
|---|---|---|---|---|---|
| Assess conventional repository-search, patch-oriented editing, or other model-aligned tool interfaces. | no | unknown | not applicable | [ ] | 利用者向け対話アプリで、リポジトリ編集や検索toolを提供していない。tool interfaceの再設計は対象外。 |
| Confirm higher-lift tool redesign with the developer before implementation. | no | unknown | not applicable | [ ] | 利用者向け対話アプリで、リポジトリ編集や検索toolを提供していない。tool interfaceの再設計は対象外。 |

## Historical outcome: comparison editor

**Implemented or already present:** Stage 1: 全経路を調査。ラボのcached input割引・unknown値・reasoning二重計上防止・stable cache keyを実装。
**Remaining work:** 今回の承認範囲（編集室での比較）の実装と両方の実APIによる確認は完了。本体改修・実人格/本棚接続は対象外。本体SQLの2ファイル不足は別件として残る。
**Developer decisions requiring follow-up:** 今回の比較機能について追加判断待ちなし。Geminiキーの所在を案内後、本人がコピー・入力して接続した。キー文字列の表示・取得・コピーはエージェントが行っていない。
**Validation evidence:** ラボ14/14成功、git diff --check成功。更新後の実際のOpenAI応答をブラウザーで確認（入力1,548/output23、概算$0.0013）。本体baselineは291件中289成功・2失敗（欠落SQLによるENOENT）。全移行完了とは扱わない。


## Historical workload inventory (superseded by Production stage)

| 経路 | 現行・代替 | 状態・必要な検証 |
|---|---|---|
| ログインWeb / lib/chat.js | Gemini通常生成→将来OpenAI選択可、埋め込みGemini維持 | 未変更。認証・所有権・予約・履歴・PDF・記憶・マップ・保存・使用量を保持して検証する。 |
| ゲスト / lib/guest-chat.js | Gemini→将来OpenAI選択可 | 未変更。cookie・quota・lease・サーバー管理履歴を保持。DBテストは欠落SQLで未完了。 |
| 自分に戻る / lib/self-return.js | GeminiによるJSON判定7秒＋返答25秒 | 未変更。両方を同じproviderへ対応させ、schema・境界・fallback・添付を判定へ送らない動作を検証する。 |
| LINE / lib/line-webhook.js | Gemini、40秒期限 | 未変更。署名・冪等性・予約・prepare/send/finish維持。実際のLINE送信は依頼なしのため実行しない。DBテストは欠落SQL。 |
| 歩みプラン / api/ayumi-plan.js | Gemini JSON案、45秒 | 未変更。Responses schemaと既存検証を維持。案を自動採用・保存しない。 |
| 学習抽出 / lib/learning-extraction.js | Gemini、所定見出し、45秒 | 未変更。元の会話・候補を自動保存しない。管理者の使用量分離を維持。 |
| 埋め込み検索・登録 | gemini-embedding-2 / 768次元 | 維持する方針。OpenAI埋め込みへ単純変更すると既存ベクトル空間と合わない。 |
| ローカル編集室 | OpenAI Responses / Gemini対応口 | OpenAIライブ確認済み。Geminiはキー未設定。人格・本棚・専用モード未接続を画面とREADMEで明示。 |

## Historical verification and blockers

- 本体HEADとorigin HEAD: f51be5dc44cc3268414c5aa969ae15e819d156e8。変更前baselineとして実行。
- package-lockなしのため npm ci は失敗。npm install --package-lock=false --ignore-scripts --no-audit --no-fund で25パッケージを導入、manifestは変更なし。
- node --test --test-concurrency=1 --test-reporter=spec tests/*.test.js: 289 pass / 2 fail / 291 total、240秒。ログは switching-lab/.runtime/baseline-tests.log（Git対象外）。
- 不足ファイル: supabase/migrations/20260910_guest_trial.sql、supabase/migrations/20260912_line_chat.sql。HEADのgit tree・該当path履歴・既知の別checkoutにも同名ファイルなし。SQLを推測再作成せず、DBへ適用しない。
- node --test switching-lab/server.test.mjs: 14 pass / 0 fail。料金のcached .075/uncached .75/output4.5 USD per millionを確認。使用量不明なら概算省略。
- ラボ: http://127.0.0.1:4187/、更新後PID18520。新規キー作成・本番DB変更・GitHub送信・公開なし。
- 保護対象homepage SHA256: E8D3497C6638A9E13DE64BC1F6DDC5C0320094D3A203D38F1A2B4A4F16F9FA31（変更なし）。

## Official documentation checked 2026-11-14

- https://developers.openai.com/api/docs/models/gpt-5.4-mini.md
- https://developers.openai.com/api/docs/guides/migrate-to-responses
- https://developers.openai.com/api/docs/guides/your-data
- https://developers.openai.com/api/docs/guides/structured-outputs.md
- https://developers.openai.com/api/docs/guides/prompt-caching.md

## Comparison stage: 2026-11-15 handoff

- Scope receipt: 「まず編集室だけで、話し方を比較できればよい」。上記本体ワークロードのpending項目は将来の任意作業であり、今回の実装対象ではない。
- 実装済み: `/api/lab/compare` が同じ指示・単発質問だけを両providerへ送る。片側失敗・未接続を分離し、自動再送なし。通常会話は元の履歴を維持する。
- `/api/lab/connect` は本人入力のGeminiキーで固定の短文を1回生成して検証し、成功時だけサーバーメモリを更新。ファイル・process.env・設定書出しに保存せず、入力欄は送信前とfinallyに消去。45秒・同時1操作・実API呼出数10件/分・origin/token制限を適用。
- 検証: `node --test --test-concurrency=1 --test-reporter=spec tests/*.test.js switching-lab/server.test.mjs` は315件中313成功・2失敗。失敗は既知の2つの欠落SQLのみ。ラボ24件は全成功。ログ: `switching-lab/.runtime/compare-stage-tests.log`。
- ブラウザー: 両側表示/片側失敗をmockで検証。PC1280x720と390x844の携帯幅、結果位置へのスクロール、固定入力、接続欄の消去、保存通知、不正JSON読込エラー、通常会話への切替を確認。console errorなし。mockサーバーは停止。
- 実際の比較endpointからOpenAI応答「いってらっしゃい、ゆっくり歩いてきてください。」を確認。入力1502/output39、画面概算$0.0013。Geminiは未接続表示で実呼出しなし。
- Google AI Studioの既存キー一覧を本人アカウントで確認。本人はキーの場所が不明と回答したため、既存の「Gemini API Key」のコピーと編集室への入力を本人へ引継ぐ。キー値は未表示・未取得・未コピー。新規キー作成なし。
- 未完了: Gemini本人入力後の実接続と、両方の実AIによる比較。ローカルサーバーPID320/port4187は起動継続。GitHub送信・本番変更なし。
- Gemini公式確認: https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash 、 https://ai.google.dev/api/generate-content 、 https://aistudio.google.com/docs/api-key 。既存RESTモデルとAPIキー確認先を維持。

## Comparison stage completed: 2026-11-15

- 本人から接続後の画面が届き、編集室でGemini接続済みと通常会話の実応答を確認。キー入力欄は空で、サーバーを再起動せず接続を保持した。
- 「同じ質問で比べる」から既存の無害な接続確認質問を明示送信。両方の実応答が並び「2つの返答を受け取りました」を確認。
- OpenAI gpt-5.4-mini-2026-03-17: input1502/output53、画面概算$0.0014。Gemini gemini-3.7-flash: input1124/output203。表示された入力条件は共通で、providerごとのtokenizerや出力長の差は許容する。
- 両方とも実APIの成功結果。console errorなし。スクリーンショット: `openai-gemini-live-comparison.png`。今回の「編集室だけで話し方を比較」について完了。本体・公開先・DBの変更なし。既知のSQLテスト2件は対象外の未解決事項として維持。

## Production stage: 2026-11-15

Scope receipt: 本番でもGemini/OpenAIを切り替える今回の依頼。作業コピー spirit-dragon-production-switch、branch codex/production-ai-switch、baseline f51be5dc44cc3268414c5aa969ae15e819d156e8。既存ローカル編集室は変更しない。

| Workload | Decision | Code / validation |
|---|---|---|
| Logged-in Web + all existing modes | Gemini default / OpenAI optional | lib/chat.js → lib/generation.js; auth, owner, quota, history, attachment, selectedmemory, map, persistedusageを保持。テスト中。 |
| Guest Web | Gemini default / OpenAI optional | lib/guest-chat.js; cookie/lease/quota/serverhistory保持。provider別の要求IDにより誤ったcachedreplyを防止。 |
| Self-return classifier and reply | Same selected provider for both | lib/self-return.js; JSON schema、7秒/25秒、境界・fallback・添付の判定除外を保持。 |
| Ayumi planning | Selected provider, JSON proposal | api/ayumi-plan.js; strict schemaと既存validatePlan、本人確認・quota、saved:falseを保持。 |
| LINE | Retain Gemini | Web selector外。署名/順序/期限/送信を変更しない。実LINE送信なし。 |
| Admin learning extraction | Retain Gemini | Web selector外。専用管理画面の抽出、承認・保存動作を変更しない。 |
| RAG search and registration | Retain Gemini embedding 2, 768 dimensions | 既存ベクトル空間と互換。OpenAI生成でも検索はGeminiを利用。 |
| UI / historical response usage | Implemented and verified | 「会話の管理」に選択欄を設置。実返信のprovider、定型案内、接続先不明の保存返信を区別。ゲストは確定した新規返信だけラベルを付ける。 |

- 欠落SQLの原本を、元プロジェクト スピリットドラゴン/supabase/migrations で発見。元のGUEST-TRIAL-DEPLOYMENT.md / LINE-DEPLOYMENT.mdが同名ファイルとRPCを参照。2ファイルを変更せず復元、DBへの実適用はしない。guest SHA256 37DEB39F6BA30B7B8B4FDF62066838DB91EAE787B5B323748D58B96CA873EEED; LINE C91834077DCF4EE675FC20EF04E37079F0360CC8DB2E61C6E1FDF88AC4F04D93。
- 既存の依存パッケージを旧作業コピーから複製。package.jsonの変更なし。
- 本番用環境変数OPENAI_API_KEYの登録先確認とデプロイ検証は未完了。

### Production implementation and validation completed

- 追加の本人指示「つかうAI の項目を会話の管理の中にしまいましょう」を反映し、選択欄・案内を会話の管理ダイアログ先頭へ移動。入力欄の上から取り除いた。ゲストもAI設定だけ利用でき、会話のPDF/記憶/削除操作はログイン済み利用者に限定。
- Backend: lib/generation.jsの両provider経路、self-return二段階、chat/guest/Ayumiへの接続、料金・使用量を実装。アカウント・所有権・quota・会話保存・PDF/記憶/マップの分離を保持。
- 再送: 既知の異なるproviderは409。任意の使用量記録が保存されなかった場合は接続先をGeminiと推測せず「保存済みの返信」とする。同時保存の勝者が別AIである場合も誤表示しない。
- Full suite: node --test --test-concurrency=1 --test-reporter=spec tests/*.test.js → **357/357 pass**, fail0, 130.5秒。output/production-switch-release-tests.log。以前の2件の欠落SQLテストも原本復元で成功。検証用fixtureのコピー機能stubを実usage UIへ更新した。
- 実OpenAI呼出し4回: 通常会話200/1.813秒(input31/output6)、Ayumiプラン200/2.663秒(input346/output252, 7項目, saved:false)、self-return判定200/2.123秒(input1743/output159)、返答200/2.046秒(input3200/output75)。全てcompleted。既存キーをメモリで読み、無害な試験文章だけ送信。本番DBへは接続していない。
- Browser: localhost4174の模擬環境でGemini/OpenAI往復切替・返信の正しいラベル・429で入力維持・Ayumi案作成・PCと390×844の表示・会話の管理への移設・再読込時の選択保持・ゲストの設定/送信を確認。consoleerrorなし。mobileの最終画像 output/provider-management-mobile.png。
- homepage SHA256変更なし: E8D3497C6638A9E13DE64BC1F6DDC5C0320094D3A203D38F1A2B4A4F16F9FA31。
- Vercel crypto-3ce8/ai-bot のEnvironment Variables画面でOPENAIを検索しNo Results Found。既存キーの値は表示・コピーしていない。本番ProductionへOPENAI_API_KEYを追加する前の登録先確認待ち。
- 公開は未実施。GitHub push、Vercel本番更新、本番DBへのSQL実行はまだ行っていない。本番への登録許可後はデプロイと両providerの実応答・再読込を確認する。
