# AYATORI

要件定義から Figma デザイン生成・品質評価・差分更新までを Claude Code で一気通貫実行するパイプライン。

**現在のフェーズ**: R&D-3 / R&D-4（個別スキル実装完了 + パイプライン結合テスト）  
**詳細仕様**: [Confluence](https://kinto-dev.atlassian.net/wiki/spaces/mord/pages/3740237924)  
**R&D計画**: [Confluence](https://kinto-dev.atlassian.net/wiki/spaces/mord/pages/3740237934)  
**26-step 構成（trial 1–3 検証済み）**: [Confluence 3767469072](https://kinto-dev.atlassian.net/wiki/spaces/mord/pages/3767469072)

> 全 **35 ステップ × 7 Phase + 独立コマンド 1 個**（基本 26 ステップ + 差分更新 27–30 + 要件差分 31–33 + delta-mini 振り返り 34 + 配布物生成 35）。
> Phase 1c (`/ayatori-req-delta`) と Phase 5 (`/ayatori-delta`) は完了後の差分更新 / 要件変更伝播用の追加 Phase。Step 35 (`/ayatori-export`) は配布物 HTML 生成用の独立コマンド。

---

## メンバー向け：動作構成・スキル配置ガイド

### 動作構成（3-Layer アーキテクチャ）

```
Layer 1: CLAUDE.md（ルーター）
    → pipeline.yaml を参照して Phase を案内（7 Phase）

Layer 2: phases/*/SKILL.md（Phase オーケストレーター × 17）
    → status / reverse / reverse-verify / question / requirements / req-delta / design / screens / retro / delta
    → 各 Phase が担当 Step を順番に実行

Layer 3: skills/NN-name/SKILL.md（Step スキル + 共通ヘルパー。実測は `find skills -name SKILL.md | wc -l`）
    → Phase SKILL.md が Read して実行するプラグイン
    → 共通: 00-early-exit / 00-feedback-protocol / 00-figma-mode-detect / 00-memory-load / 00-memory-write / 00-transition-figjam-sync

Layer 4: .claude/agents/*.md（subagent × 3）
    → Step 09 / 12 / 22 から並列起動される副エージェント
    → ayatori-sample-html-builder / ayatori-build-tokens-runner / figma-capture-runner
```

**実行の流れ**:
```
ユーザーが claude を起動
    ↓
CLAUDE.md（ルーター）が読み込まれる
    ↓
/ayatori-question コマンドを実行（Phase 1a）
    ↓
phases/question/SKILL.md が skills/01-question/SKILL.md を Read して実行
    ↓
Phase 完了 → 次の Phase へ（別会話で /ayatori-requirements → /ayatori-design → ...）
```

### 動作方式（6 つのモード）

| モード | コマンド | 用途 |
|---|---|---|
| **ステータス確認** | `/ayatori-status` | 全プロジェクトの進捗状況を一覧表示し、次のアクションを推奨 |
| **グリーンフィールド実行** | `/ayatori-question` → `/ayatori-requirements` → `/ayatori-design` → `/ayatori-screens` → `/ayatori-retro`（各 Phase を別会話で実行） | 新規アプリを 0 から設計・実装 |
| **リバースエンジニアリング** | `/ayatori-reverse` → `/ayatori-design` → `/ayatori-screens`（Route A = 基線確立で終える／Route B = 画面 HTML まで作る）→ 基線で終えた場合は `/ayatori-add-feature`・`/ayatori-delta`（`/ayatori-retro` は画面レビューの振り返りなので基線プロジェクトでは入場不可） | 既存アプリの資料（コード・既存ドキュメント［Confluence / Jira / ローカル］・Figma）を突合して要件を抽出し AYATORI パイプラインへ。**Confluence 親ページ ID・Jira 課題キー・Figma URL は実行中に答えるだけでよい**（reverse Step 01 が取得して `ground-truth/` にアーカイブ、Figma は `FIGMA_MCP_ENABLED=true` 必須。Jira 課題は時点の変更要求記録として裏取りに使う）。**実コードのみ配置が必要** — `artifacts/{app_name}/input-sources/{stack}/`（`{stack}` は ios-swift / be-python / kmp 等の自由名。repo URL を渡した場合は Preamble が取得コマンドを提示、パイプラインは取得しない）。ローカル文書は `input-sources/docs/`（md・txt・pdf）。コード不在時は Figma 中心の縮退モードで実行できる。資料が多い場合は収集前に件数と予想所要を提示して範囲を確認する（文書 50 ページ超 / Jira 30 課題超で予算ゲート、Figma は file 全体 URL なら列挙後に必ず範囲確定ゲート。まず核心だけ収集し、後から差分追加も可） |
| **対象限定突合（Phase 0c）** | `/ayatori-reverse-verify` | リバースで起こした要件記述・画面仕様のうち、**改修対象として指定した機能・画面の関連範囲だけ**を実コード・文書アーカイブ・Figma capture と突き合わせ、食い違いを人間確認のうえ訂正する（任意・反復実行）。コードの読み違いによる誤りを改修着手前に潰すのが目的。全範囲の再突合・コード修正・要件変更はスコープ外 |
| **要件レベル差分（Phase 1c）** | `/ayatori-req-delta` | Step 07 承認後に **UI 生成前** に要件変更を 8 ISO 29148 ドキュメント全体に伝播 || **完了後差分（Phase 5）** | `/ayatori-delta` | `final_approved == true`（または reverse 基線の `baseline_approved_at` + `requirements.json.status == "REVERSE_ENGINEERED"` の由来検査）後に要件変更を部分画面再生成 + Figma 部分更新で反映 |
| **配布物生成（独立）** | `/ayatori-export` | 画面定義書 / 要件定義書の MD 群を結合し、画像を base64 inline 埋め込みした自己完結 HTML を出力。社外パートナー共有・ドキュメント納品向け |
| **個別スキルテスト** | `skills/NN-name/SKILL.md` を直接 Read して実行 | 担当スキルの単体テスト・開発 |

**Phase の SKILL.md が skills/ 配下の SKILL.md を Read する。** skills/ 側の SKILL.md を更新すれば Phase 実行にも反映される。

> **`SKILL.md` を書く / 直すときは [`docs/skill-authoring-convention.md`](docs/skill-authoring-convention.md)（Skill 作成規約）に従うこと。** frontmatter（`name` / `description`）・命名・本文構成の SoT。

### スキルの配置場所

**担当するスキルを実装したら、`skills/NN-name/SKILL.md` を上書きする：**

```
phases/                  ← Phase オーケストレーター (17)
├── status/SKILL.md             /ayatori-status（ダッシュボード）
├── reverse/SKILL.md             /ayatori-reverse → reverse Steps 01-06（05 レビューゲート含む）+ 06-confluence-save-req（Confluence 保存を再利用）
├── reverse-verify/SKILL.md      /ayatori-reverse-verify → verify Steps V1-V3（Phase 0c, 対象限定 3 ソース突合）
├── question/SKILL.md            /ayatori-question → Step 01
├── requirements/SKILL.md        /ayatori-requirements → Steps 02-07
├── req-delta/SKILL.md           /ayatori-req-delta → Steps 31-33（Phase 1c, 要件差分）
├── add-feature/SKILL.md         /ayatori-add-feature → Step 01b（Phase 1d, 完走後機能追加）
├── design/SKILL.md              /ayatori-design → Steps 08-13
├── screens/SKILL.md             /ayatori-screens → Steps 14-25
├── retro/SKILL.md               /ayatori-retro → Step 26
├── delta/SKILL.md               /ayatori-delta → Steps 27-30（Phase 5, 完了後差分）
├── delta-mini/SKILL.md          /ayatori-delta-mini → Step 34（Phase 6, delta / req-delta 軽量振り返り）
└── export/SKILL.md              /ayatori-export → Step 35（独立コマンド, 配布物生成）

skills/                  ← 共通ヘルパー + Step スキル (SKILL.md 実測 76 本。phase 専用群は reverse/ reverse-verify/ 等のグループ dir 配下)
├── 00-early-exit/SKILL.md                    # 共通: 早期 EXIT 判定（全 phase 共通）
├── 00-feedback-protocol/SKILL.md             # 共通: feedback-log Pattern A/B/C 規約
├── 00-figma-mode-detect/SKILL.md             # 共通: FIGMA_MCP_ENABLED 判定 SoT
├── 00-memory-load/SKILL.md                   # 共通: メモリ読み込み
├── 00-memory-write/SKILL.md                  # 共通: メモリ書き込み
├── 00-transition-figjam-sync/SKILL.md        # 共通: 遷移図 .mmd → FigJam 単方向同期（Step 14 / 29 から呼び出し）
│
├── reverse/                                  # Phase 0b reverse の step スキル群（グループディレクトリ）
│   ├── 01-ground-truth/SKILL.md              # Phase 0b reverse: ground-truth 収集
│   ├── 02-source-analysis/SKILL.md           # Phase 0b reverse: ソース解析（B-01〜B-07）
│   ├── 03-requirements-gen/SKILL.md          # Phase 0b reverse: ISO 29148 要件生成
│   ├── 04-comparison/SKILL.md                # Phase 0b reverse: ギャップ分析
│   ├── 05-review-gate/SKILL.md               # Phase 0b reverse: リバースレビューゲート（監査 + 人間確認）
│   └── 06-format-convert/SKILL.md            # Phase 0b reverse: AYATORI フォーマット変換
│
├── reverse-verify/                           # Phase 0c の step スキル群（グループディレクトリ）
│   ├── 01-target-scope/SKILL.md              # Phase 0c: 改修対象の確定 + 関連範囲の人間承認
│   ├── 02-targeted-crosscheck/SKILL.md       # Phase 0c: 承認範囲だけの 3 ソース突合（再読プロトコル）
│   └── 03-discrepancy-gate/SKILL.md          # Phase 0c: 食い違いの人間判断 + 記述への反映
│
├── 01-question/SKILL.md                      # Phase 1a: 7軸ヒアリング
├── 02-iso-breakdown/SKILL.md                 # Phase 1b: ISO 29148 構造化
├── 03-rubric-gen/SKILL.md                    # Phase 1b: ルーブリック生成
├── 04-scoring/SKILL.md                       # Phase 1b: AI 採点
├── 05-loop-req/SKILL.md                      # Phase 1b: フィードバックループ
├── 06-confluence-save-req/SKILL.md           # Phase 1b: Confluence 保存（要件）
├── 07-human-gate-req/SKILL.md                # Phase 1b: 人間承認 [gate]
│
├── 08-design-brainstorm/SKILL.md             # Phase 2: 3 方向性ブレスト + design-brief.yaml
├── 09-sample-html-gen/SKILL.md               # Phase 2: サンプル HTML × 3 生成（subagent 並列）
├── 10-sample-human-review/SKILL.md           # Phase 2: 採用方向性選択 [gate]
├── 11-wcag-mapping/SKILL.md                  # Phase 2: WCAG 2.2 AA + ループ制御
├── 12-design-system/SKILL.md                 # Phase 2: 3 層 tokens + Style Dictionary build
├── 13-human-gate-design/SKILL.md             # Phase 2: スタイルガイド承認 [gate]
│
├── 14-screen-list-transition/SKILL.md        # Phase 3: 画面一覧 + 遷移図 (.mmd SSoT + 派生 HTML + 任意 FigJam 同期) + coverage-check
├── 15-confluence-save-design/SKILL.md        # Phase 3: Confluence 保存（pre/post-loop 2 回実行）
├── 16-design-doc-human-review/SKILL.md       # Phase 3: 画面ドキュメント承認 [gate]
├── 17-screen-gen/SKILL.md                    # Phase 3: 全画面 HTML + 状態フレーム
├── 18-design-review/SKILL.md                 # Phase 3: 3 層デザインレビュー
├── 19-rubric-score/SKILL.md                  # Phase 3: ルーブリック採点（coverage-check 再評価込み）
├── 20-loop-design/SKILL.md                   # Phase 3: フィードバックループ
├── 21-screen-human-review/SKILL.md           # Phase 3: 全画面 HTML 承認 [gate]
├── 22-figma-export/SKILL.md                  # Phase 3: Figma 出力（subagent 経由 HTML キャプチャ）
├── 23-human-final-approval/SKILL.md          # Phase 3: 最終承認 [gate]
├── 24-design-system-update/SKILL.md          # Phase 3: Variables 3 コレクション + ComponentSet 構築
├── 25-component-build/SKILL.md               # Phase 3: コンポーネントインスタンス配置
│
├── 26-retro/SKILL.md                         # Phase 4: 振り返り + 改善案 [gate]
│
├── 27-change-detect/SKILL.md                 # Phase 5 delta: 変更検出
├── 28-impact-analysis/SKILL.md               # Phase 5 delta: 影響範囲分析 [gate]
├── 29-partial-screen-regen/SKILL.md          # Phase 5 delta: 部分画面再生成 + 遷移図 .mmd 部分修正 + 任意 FigJam 再同期 [gate]
├── 30-partial-figma-update/SKILL.md          # Phase 5 delta: Figma 部分更新 [gate]
│
├── 31-req-change-detect/SKILL.md             # Phase 1c req-delta: 要件変更検出
├── 32-req-impact-analysis/SKILL.md           # Phase 1c req-delta: 8 ISO 文書間影響分析 [gate]
├── 33-req-revision/SKILL.md                  # Phase 1c req-delta: 修正案レビュー [gate]
│
└── 35-md-to-html-export/SKILL.md             # Phase Export (独立): 画面定義書 / 要件定義書 MD → 自己完結 HTML

.claude/agents/          ← Subagent (8)
├── ayatori-figma-ground-truth-collector.md  # reverse Step 01: Figma 証拠アーカイブ収集（READ 専用・verbose 隔離）
├── ayatori-sample-html-builder.md   # Step 09: 1 platform 分の HTML を主 context 外で生成
├── ayatori-build-tokens-runner.md   # Step 12: Style Dictionary v5 build を sandbox 隔離で実行
├── ayatori-requirements-auditor.md  # Step 07/29/29b + reverse Step 05: 要件トレース監査（生成 context 隔離）
├── ayatori-screen-state-builder.md  # Step 25b: sub-state HTML 派生生成
├── ayatori-train-enumerator.md      # train: 画面機能の機械列挙（正解非参照）
├── ayatori-train-persona.md         # train: オーナー役ペルソナ（ground_truth 唯一の Reader）
└── figma-capture-runner.md       # Step 22/25e: Figma キャプチャを並列実行（verbose レスポンス隔離）

.claude/skills/          ← symlink → phases/ (Claude Code 登録用)
├── ayatori-status/SKILL.md          /ayatori-status
├── ayatori-reverse/SKILL.md
├── ayatori-reverse-verify/SKILL.md  /ayatori-reverse-verify（Phase 0c, 対象限定突合）
├── ayatori-question/SKILL.md
├── ayatori-requirements/SKILL.md
├── ayatori-req-delta/SKILL.md       /ayatori-req-delta（Phase 1c, 要件差分）
├── ayatori-design/SKILL.md
├── ayatori-screens/SKILL.md
├── ayatori-retro/SKILL.md
├── ayatori-delta/SKILL.md           /ayatori-delta（Phase 5, 完了後差分）
└── ayatori-export/SKILL.md          /ayatori-export（独立, 配布物 HTML 生成）
```

> 人間承認ゲートは **07 / 10 / 13 / 16 / 21 / 23 / 26 / 28 / 29 / 30 / 32 / 33** の計 **12 箇所**（基本フロー 7 + delta 3 + req_delta 2）。該当する `skills/NN-*/SKILL.md` で AskUserQuestion を呼び出す。

### スキル実装の参考資料

| 資料 | 場所 | 内容 |
|---|---|---|
| Step スキル定義 | `skills/NN-name/SKILL.md` | 各ステップの詳細プロンプト・実行指示・出力フォーマット |
| パイプライン定義 | `pipeline.yaml` | Phase/Step 構成・loop 閾値・gate / 全ファイル責務マップ (`file_topology`) の単一真実原典 |
| プロジェクトルール | `CLAUDE.md` | パイプライン運用原則・feedback-log 規約 (artifact 責務マップは `docs/artifact-file-responsibility.md`) |
| インターフェース契約 | `docs/interface-contracts.md` | 全ステップの入出力 JSON スキーマ・依存関係 |
| Artifact JSON スキーマ | `schemas/*.schema.json` | `artifacts/{app_name}/` 配下の各ファイル仕様（draft 2020-12） |
| HTML 生成ルール | `docs/html-generation-rules.md` | Step 09 / 17 共通: anti-slop 14 項目 / 16:9 / inline SVG / 状態フレーム etc. |
| 画面パターン coverage | `docs/screen-coverage-check.md` | Step 14 早期チェック + Step 19 ルーブリック再評価仕様 |
| WCAG 標準 | `docs/wcag-standards.md` | WCAG 2.2 AA 適用範囲・contrast pair 定義（pairs 1-15） |
| DTCG 参照 | `docs/dtcg-spec-ref.md` | Step 12 トークン JSON の DTCG 準拠仕様 |
| サンプルデータ | `docs/test-fixtures/` | テスト用サンプル入力・期待出力 |
| AYATORI 仕様書 | [Confluence](https://kinto-dev.atlassian.net/wiki/spaces/mord/pages/3740237924) | パイプライン定義・ルーブリック・外部標準 |
| 26-step composition | [Confluence 3767469072](https://kinto-dev.atlassian.net/wiki/spaces/mord/pages/3767469072) | trial 1–3 検証済みステップ構成 |

### 開発フロー

```
1. skills/NN-name/SKILL.md を編集
2. skills/NN-name/SKILL.md を直接 Read して単体テスト
3. /ayatori-status で現在の進捗を確認
4. /ayatori-question から Phase 実行で結合テスト
5. PR を作成
```

---

## 前提条件

| 項目 | 要件 |
|---|---|
| Claude Code CLI | 最新版（`claude --version` で確認） |
| Claude モデル | **Claude 5 世代を推奨**（Opus 5 / Fable 5 / Sonnet 5）。CLAUDE.md は軽量・gotcha 中心・詳細は SoT ポインタ経由で参照する方針で最適化済みで、参照到達性の recall 検証（5 問）を Fable 5 / Opus 5 で実施。旧世代でも構造上は動作する設計だが未検証 |
| Node.js | 22 以上（`node -v` で確認）。Style Dictionary v5（`engines.node: ">=22.0.0"`）の実行に必要 |
| Figma アカウント | **Full seat 必須**（Dev seat では 22 / 24 / 25 の Write-to-Canvas が動作しない。Step 12 はコード生成のみで Figma を触らないため Full seat 不要） |
| Atlassian アカウント | Confluence への読み書き権限 |
| Takumi Guard | パイプライン実行 PC に社内標準セキュリティツール **Takumi Guard** が導入済みであること（[導入手順（社内 Confluence）](https://kinto-dev.atlassian.net/wiki/spaces/ITKanri/pages/3807478775/Takumi+Guard)）。AYATORI は `npm ci` 等でネットワークから依存パッケージを取得するため、実行環境側のセキュリティ対策を前提とする |

---

## セットアップ

### 1. 環境変数

`~/.zshrc` に追記して `source ~/.zshrc` を実行：

```bash
# Figma（14 / 17 / 18 / 22 / 24 / 25 / 29 を Figma MCP で動かす場合のみ。Step 12 は対象外）
# Step 14 / 29 は遷移図の FigJam 同期 — .mmd / .html 生成は MCP 無くても動作する
export FIGMA_MCP_ENABLED=true
export FIGMA_FILE_KEY="your-figma-file-key"   # Figma URL の figma.com/design/{ここ}/... から取得
```

> **⚠ 重要 — `FIGMA_MCP_ENABLED` は Figma MCP モードで動かすための必須スイッチです**
>
> このフラグが Claude Code プロセスに渡っていないと、Steps 17 / 18 / 22 / 24 / 25 は **すべてスタブモードに落ちます** (Figma への書き込み・キャプチャが行われない。Step 12 は Figma を触らない設計なので対象外)。Step 14 / 29 の遷移図 FigJam 同期も同フラグで制御 — false の場合は `.mmd` / `.html` 生成までは行い、FigJam 同期のみスキップする。よくあるハマりどころ:
>
> 1. **`~/.zshrc` に追記したが、既存の Claude Code プロセスは古い env のまま** → Claude Code を完全終了して、新しい terminal から再起動
> 2. **`/mcp` で Figma を `Connected` にしたから動くはず** → 接続状態と env var は別物。**両方** 必要
> 3. **`!export FIGMA_MCP_ENABLED=true` を Claude セッション内で実行した** → 後続の Bash tool 呼び出しに継承されない。`~/.zshrc` か `.claude/settings.local.json` に永続化する必要あり

設定確認：

```bash
echo "FIGMA_MCP_ENABLED=[$FIGMA_MCP_ENABLED]"      # → [true] が出ればOK / [] (空) は未設定
echo $FIGMA_FILE_KEY
```

`FIGMA_MCP_ENABLED` が `[]` (空) のまま Phase 2/3 を実行すると、各 Figma 関連ステップが warn メッセージを出してスタブモードで継続します。Figma MCP モードで実行したい場合は必ず `[true]` 表示を確認してから Claude Code を起動してください。

### 1.5. Atlassian MCP の接続（OAuth）

Confluence / Jira への接続は **Atlassian 公式リモート MCP サーバー**（`.mcp.json` で `https://mcp.atlassian.com/v1/mcp/authv2` を宣言済み）を使用する。認証は OAuth 2.1 のため、**API トークンや環境変数の設定は不要**。初回のみ以下を実施：

1. Claude Code のチャット欄に `/mcp` と入力
2. `atlassian` を選択
3. ブラウザで Atlassian の OAuth 認証（kinto-dev.atlassian.net へのアクセス許可）を完了する
4. `/mcp` で `atlassian: ✅ Connected` になっていることを確認

> **旧方式の廃止**: 以前の `.mcp.json` は `npx -y mcp-atlassian` + `CONFLUENCE_*` 環境変数（API トークン）を使用していたが、npm 上の `mcp-atlassian` は本家（PyPI 配布）とは別物の非公式パッケージであり、バージョン未固定の npx 実行はサプライチェーンリスクがあるため公式リモート MCP に移行した。`~/.zshrc` に残っている `CONFLUENCE_USER_EMAIL` / `CONFLUENCE_API_TOKEN` / `CONFLUENCE_BASE_URL` は削除してよい。

### 1.6. グラフィック生成 API キー（OpenAI — Step 21c / 21e を使う場合のみ）

グラフィック生成ブロック（21a-21g）のうち **21c（テイストサンプル生成）と 21e（本生成）** が
OpenAI Images API を呼ぶ。それ以外の Phase / Step には不要（キー未設定でもパイプラインは
止まらず、21c / 21e 到達時に degrade 分岐が設定案内を出す）。

1. **キーの取得**: チーム共有のサービスアカウント `ayatori-openai` のキーを使う。取得先はチーム内で
   共有している (シークレットの在り処を指す情報はリポジトリに記載しない — TFS Standard 13.02.03
   シークレットの保存要件に基づく)。不明な場合はチームのチャンネルで確認する。
2. **設定** (キーファイル方式 — 推奨):
   ```bash
   node scripts/setup-image-key.mjs   # ~/.ayatori/image-api-key を作成 (権限 600) してエディタで開く
   ```
   開いたファイルにキーだけを 1 行貼り付けて保存する（引用符・`KEY=` などは不要）。
   **ターミナルを開く必要はない** — Claude Code のチャットで実行を依頼するか、プロンプトに
   `!node scripts/setup-image-key.mjs` と入力すればその場で実行できる（キー自体は開いた
   ファイルに自分で貼るため、会話ログにキーは載らない）。
   **設定後の再起動は不要**（21c / 21e が実行時にファイルを直読する）。ホーム直下なので
   案件をまたいで共通・リポジトリを再クローンしても再設定不要。
3. **設定確認**:
   ```bash
   node scripts/setup-image-key.mjs --doctor   # 実効ソース・残存コピー・警告を報告
   ```
   > 診断が見る env は**実行したプロセス**のもの。VSCode 内の Claude Code で失敗した場合は、
   > **同じ session 内で**実行する（チャットで実行を依頼するか `!node scripts/setup-image-key.mjs --doctor`）—
   > 別の新しいターミナルでは VSCode が固定した env が見えず、故障が再現しない（POCTEAMA-408 の原障害と同型）。

> **⚠ キーを repo 管理下のファイルに書かないこと** — リポジトリ内の `settings.json`（commit される）/
> `pipeline.yaml` / SKILL.md / docs 等は禁止（全員の clone にキーが載る）。ホーム側の
> `~/.ayatori/image-api-key` は git 管理外・権限 600 であり禁止対象では**ない**。各メンバーが
> 自分のマシンで 1 回設定する（キーは repo に同梱されない — これは意図した設計）。
>
> **旧方式（env 経路）の注意**: `~/.zshrc` の export / `.claude/settings.local.json` の `env` ブロック /
> ホームの `~/.claude/settings.json` の `env` も互換のため引き続き有効
> （優先順: env `AYATORI_IMAGE_API_KEY` → キーファイル → env `OPENAI_API_KEY`）
> だが、新規設定には推奨しない — `~/.zshrc` は非対話 shell（Claude Code の Bash tool）から見えず、
> VSCode は起動時の env を固定するため **VSCode 自体を再起動するまで反映されない**（POCTEAMA-408 の
> 実障害）。env 経路を使う場合のみ設定後の再起動が必要。**`settings.json` 系から `env` を消す場合は
> Claude Code を終了してから編集すること** — 実行中の Claude Code は permission entry を記録する
> たびに記憶している内容でファイルを書き戻すため、session 中の削除は復活する（詳細: `docs/setup.md`）。セッション内の `!export ...` は後続の
> Bash tool 呼び出しに継承されない。キーは原則 1 箇所に集約すること（多重設置は `--doctor` が警告）。
> 任意の上書き（エンドポイント / モデル）は「環境変数一覧」表と `docs/setup.md`
> 「グラフィック生成 API キー」を参照。

### 2. 依存パッケージのインストール

リポジトリルートで Node.js 依存をインストール：

```bash
cd ~/path/to/ayatori
npm ci
```

`package.json` で `style-dictionary@5.4.0` と `pdf-lib@1.17.1` を厳密固定（範囲指定 `^` を使わない）しており、`npm ci` 1 回で全プロジェクトに使い回せる。`npm ci` は commit 済みの `package-lock.json`（全パッケージに sha512 integrity ハッシュ付き）と完全一致でのみインストールするため、新規メンバー / 別マシンでも同じ version が検証つきで解決される（`npm install` と異なり lockfile を書き換えない）。

**理由**: Step 12（デザインシステムビルド）で `tokens.json` を CSS / SCSS / TS / Swift / Kotlin / Dart / Android XML に変換するために Style Dictionary v5 を使用する。事前にローカルへインストールしておくことで、パイプライン実行中に `npx` の初回ダウンロード待ちや、オフライン環境での失敗、プロジェクトごとの version drift を回避できる。Style Dictionary v5 は Node.js 22 以上が必須（前提条件の表を参照）。pdf-lib はユーザー提供のローカル PDF 文書が 10 ページを超えて Read tool の native 経路で読めないとき、`scripts/split-pdf.mjs` が読める大きさの part に分割するために使用する（PDF のレンダリングと違い、ページ分割は純 JS で完結するため「外部 CLI を導入しない」原則と両立する）。

> 過去はプロジェクトごとに `/tmp/sd-{app_name}/` で ad-hoc に `npm install style-dictionary@5` を実行していたが、subagent の sandbox 拒否 / version drift / 実行時間の問題で廃止。

> **サードパーティライセンス**: 本 repo が使用する OSS / 外部サービスの帰属表示は [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)、ライセンス原文は [`licenses/`](./licenses/) に集約している。npm / npx 依存・MCP サーバ・CDN ライブラリ・同梱アセットを新規追加する際は `THIRD-PARTY-NOTICES.md` §10 の運用ルールに従い、同じ PR 内でライセンス対応を行うこと。

### 2.5. Subagent 権限の確認

AYATORI パイプラインは複数の subagent (`figma-capture-runner` / `ayatori-sample-html-builder` / `ayatori-build-tokens-runner`) を使用する。これらは main session の permission を継承しないため、`.claude/settings.json` の `permissions.allow` で `Bash(mkdir:*)` / `Bash(cp:*)` / `Bash(ls:*)` / `Bash(npm:*)` / `Bash(node:*)` 等の個別エントリと `Bash(npx style-dictionary:*)`、`Write(./artifacts/**)` を明示的に許可している。npx は無制限許可 (`Bash(npx:*)`) にせず style-dictionary 限定に絞っている（任意の外部パッケージ即時実行を防ぐ）。なお `rm` 系は誤動作時の被害を限定するため `artifacts/*/build[/*]` のみ許可する形で範囲を絞っている。

設定の有無は次で確認:

```bash
grep -A 10 permissions .claude/settings.json
```

`.claude/settings.local.json` で個人の override をしている場合はそちらも併せて確認すること。`Bash(npm:*)` / `Bash(npx style-dictionary:*)` / `Write(./artifacts/**)` 等の entry が見えていれば OK。無い場合は subagent 実行時に sandbox 拒否で停止するので、settings.json を更新してから Claude Code を再起動する。

### 3. Claude Code プラグインのインストール

Step 08 デザインブレストは AYATORI 内部で完結するため、必須の外部プラグインはありません。`bash scripts/setup.sh` は現時点では空プラグイン配列のまま（将来プラグイン追加時の受け皿として残置）で、実行する必要はありません。`.claude/settings.json` の `enabledPlugins` も空です。

#### 2.1 Figma MCP（オプション / Phase 3 以降）

Phase 3 以降（Step 14 / 17 / 18 / 22 / 24 / 25）と Phase 5 delta（Step 29 / 30）で Figma MCP を使う場合のみ、個別にインストール：

```bash
claude plugin install figma@claude-plugins-official
```

### 4. Figma MCP 認証

Claude Code 起動後、初回セッションで自動的に認証フローが走る。  
ブラウザで表示される URL を開いて Figma アカウントで承認するだけ。

### 5. 動作確認

```bash
cd ~/path/to/ayatori
claude  # Claude Code を起動
```

CLAUDE.md を読んだ瞬間にパイプラインが開始される。  
**初回テスト（グリーンフィールド）**: 架空のアプリ企画（例：「猫の写真共有アプリ」）で `/ayatori-question` から走らせること。  
**初回テスト（リバースエンジニアリング）**: `https://github.com/kinto-dev/kagemusha-ai-video` を使って `/ayatori-reverse` をテストする。KMP/CMP + HeyGen API の実アプリ。  
**サンプルデータ**: `docs/test-fixtures/sample-app/` に実行済みサンプルあり。05 以降を試す際の参考に。

---

## 環境変数一覧

| 変数名 | 必須 | 用途 |
|---|---|---|
| `FIGMA_MCP_ENABLED` | ⬜ | `true` にすると 14 / 17 / 18 / 22 / 24 / 25 / 29 / 30 が Figma 書き込みモードで動作（省略時はスタブ）。Step 14 / 29 は遷移図 FigJam 同期のみが本フラグの対象 (`.mmd` / `.html` 生成は常時実行)。Step 12 は Figma を触らない設計なので影響しない |
| `FIGMA_FILE_KEY` | ⬜ | Figma ファイルキー（`FIGMA_MCP_ENABLED=true` 時のみ必要） |
| `AYATORI_IMAGE_API_KEY` | ⬜ | グラフィック生成 API (OpenAI Images) のキー。21c テイストサンプル / 21e グラフィック生成で使用。**推奨設置場所は env ではなくキーファイル `~/.ayatori/image-api-key`**（`node scripts/setup-image-key.mjs` で作成 — 実行時直読のため再起動不要・案件横断・再クローン耐性あり）。解決の優先順は env `AYATORI_IMAGE_API_KEY` → キーファイル → env `OPENAI_API_KEY` で、どこにも無ければ各 skill が degrade 分岐で案内を出す（パイプラインは止まらない）。取得・設定は `docs/setup.md`「グラフィック生成 API キー」参照。**キーを repo 管理下のファイルに書かないこと** |
| `AYATORI_IMAGE_API_BASE` / `AYATORI_IMAGE_MODEL` / `AYATORI_IMAGE_MODEL_TRANSPARENT` | ⬜ | 生成 API の任意上書き（エンドポイント / 非透過 slot モデル / 透過 slot モデル）。モデル既定値の SoT は `pipeline.yaml` `screens.graphic_generation.tool` / `tool_transparent`（gpt-image-2 / gpt-image-1.5）。モデル系 env は **21e の実行時呼び出し先のみ**を差し替える一時的な knob（21d が確定する `graphic-prompts.json` の `tool` / 鮮度判定 digest には影響しない — 恒久変更は pipeline.yaml 側を編集） |

> Atlassian（Confluence / Jira）認証は環境変数を使わない。公式リモート MCP の OAuth 接続（セットアップ「1.5. Atlassian MCP の接続」参照）で行う。

---

## カスタマイズガイド

このパイプラインを新しいチーム / プロジェクトで使う場合、以下の項目を変更する。

### 必須

| 変更箇所 | ファイル | 説明 |
|---|---|---|
| 出力言語 | `pipeline.yaml` → `output_language` | 成果物の記述言語。`ja` / `ko` / `en` 等 |
| Confluence 認証 | `/mcp` → `atlassian` で OAuth 接続 | 公式リモート MCP（`.mcp.json` 定義済み）。API トークン環境変数は不要 |
| Confluence 保存先 | Step 01 実行中に対話で指定 | `confluence_parent_id` — 保存先の親ページ |

### 任意

| 変更箇所 | ファイル | 説明 |
|---|---|---|
| ループ閾値 | `pipeline.yaml` → 各 Phase の `loop.pass_condition` | 合格スコア基準。デフォルト: Phase 1b `total >= 80 AND 全軸 >= per_axis_min(12)`、Phase 2 `wcag-history.attempts[-1].violations (loop 対象 = palette / domain_surface) is empty`（state_colors は warn-only）、Phase 3 `current.ai_improvable_deductions == 0` |
| 最大試行回数 | `pipeline.yaml` → 各 Phase の `loop.max_attempts` | デフォルト: 3 |
| Figma 連携 | `~/.zshrc` → `FIGMA_MCP_ENABLED=true` + `FIGMA_FILE_KEY` | 未設定時は MD/HTML スタブで動作 |
| デフォルト Design 出力範囲 | `pipeline.yaml` → `default_design_output_scope` | platform_combo / screen_coverage / state_pattern / mobile_framework のデフォルト |
| スキップ phase | `pipeline.yaml` → `skip_phases: []` | 非本番環境で特定 phase をスキップ |

### 変更不要

| 項目 | 理由 |
|---|---|
| `interface-contracts.md` | JSON スキーマの唯一の定義元。変更すると全 Step に影響 |
| `skills/NN-name/SKILL.md` | Step 実装の実体。カスタマイズではなく開発対象 |
| `phases/*/SKILL.md` | Phase オーケストレーター。`pipeline.yaml` と `skills/` を読むだけ |

> **Confluence / Figma が使えない場合**: 両方とも MCP 接続方式。MCP が利用不可なら自動的にローカル保存にフォールバックし、パイプラインは中断せず継続する。

---

## ディレクトリ構成

```
ayatori/
├── CLAUDE.md                         # ルーター + 運用原則 (責務マップは docs/ へ)
├── pipeline.yaml                     # パイプライン定義 (単一真実原典 / file_topology)
├── package.json                      # Node.js 依存 (style-dictionary@5.4.0 / pdf-lib@1.17.1 厳密固定)
├── package-lock.json                 # 全マシン同一 version 解決用
├── .mcp.json                         # MCP サーバー設定（Atlassian / Figma）
├── .claude/
│   ├── settings.json                 # subagent 用 Bash/Write 権限の事前宣言
│   ├── settings.local.json           # 個人 override（任意）
│   ├── agents/                       # Subagent
│   │   ├── ayatori-figma-ground-truth-collector.md  # reverse Step 01: Figma 証拠アーカイブ収集（READ 専用・context 隔離）
│   │   ├── ayatori-sample-html-builder.md   # Step 09: 1 platform の HTML 生成（context 隔離）
│   │   ├── ayatori-build-tokens-runner.md   # Step 12: Style Dictionary build（sandbox 隔離）
│   │   ├── ayatori-requirements-auditor.md  # Step 07/29/29b + reverse Step 05: 要件トレース監査
│   │   ├── ayatori-screen-state-builder.md  # Step 25b: sub-state HTML 派生生成
│   │   ├── ayatori-train-enumerator.md      # train: 画面機能の機械列挙
│   │   ├── ayatori-train-persona.md         # train: オーナー役ペルソナ
│   │   └── figma-capture-runner.md       # Step 22/25e: Figma キャプチャ並列実行
│   └── skills/                       # Phase 登録（symlink → phases/）
│       ├── ayatori-status/SKILL.md
│       ├── ayatori-reverse/SKILL.md
│       ├── ayatori-reverse-verify/SKILL.md  # Phase 0c
│       ├── ayatori-question/SKILL.md
│       ├── ayatori-requirements/SKILL.md
│       ├── ayatori-req-delta/SKILL.md       # Phase 1c
│       ├── ayatori-design/SKILL.md
│       ├── ayatori-screens/SKILL.md
│       ├── ayatori-retro/SKILL.md
│       └── ayatori-delta/SKILL.md           # Phase 5
├── phases/                           # Phase オーケストレーター (17)
│   ├── status/SKILL.md               # /ayatori-status
│   ├── reverse/SKILL.md              # /ayatori-reverse → reverse Steps 01-06（05 レビューゲート含む）+ 06-confluence-save-req（Confluence 保存を再利用）
│   ├── reverse-verify/SKILL.md       # /ayatori-reverse-verify → verify Steps V1-V3 (Phase 0c)
│   ├── question/SKILL.md             # /ayatori-question → Step 01
│   ├── requirements/SKILL.md         # /ayatori-requirements → Steps 02-07
│   ├── req-delta/SKILL.md            # /ayatori-req-delta → Steps 31-33 (Phase 1c)
│   ├── add-feature/SKILL.md          # /ayatori-add-feature → Step 01b (Phase 1d)
│   ├── design/SKILL.md               # /ayatori-design → Steps 08-13
│   ├── screens/SKILL.md              # /ayatori-screens → Steps 14-25
│   ├── retro/SKILL.md                # /ayatori-retro → Step 26
│   ├── delta/SKILL.md                # /ayatori-delta → Steps 27-30 (Phase 5)
│   ├── delta-mini/SKILL.md           # /ayatori-delta-mini → Step 34 (Phase 6)
│   └── export/SKILL.md               # /ayatori-export → Step 35（独立コマンド）
├── skills/                           # 共通ヘルパー (6) + Step スキル (35)
│   ├── 00-early-exit/                # 早期 EXIT 判定（全 phase 共通）
│   ├── 00-feedback-protocol/         # feedback-log Pattern A/B/C 規約
│   ├── 00-figma-mode-detect/         # FIGMA_MCP_ENABLED 判定 SoT
│   ├── 00-memory-load/               # メモリ読み込み
│   ├── 00-memory-write/              # メモリ書き込み
│   ├── 00-transition-figjam-sync/    # 遷移図 .mmd → FigJam 単方向同期（Step 14 / 29 から呼び出し）
│   ├── reverse/                      # Phase 0b reverse の step スキル群（グループディレクトリ）
│   │   ├── 01-ground-truth/          # 証拠収集: Confluence + ローカル文書 + Figma
│   │   ├── 02-source-analysis/
│   │   ├── 03-requirements-gen/
│   │   ├── 04-comparison/
│   │   ├── 05-review-gate/
│   │   └── 06-format-convert/
│   ├── reverse-verify/               # Phase 0c の step スキル群（グループディレクトリ）
│   │   ├── 01-target-scope/          # 対象確定 + 関連範囲の人間承認
│   │   ├── 02-targeted-crosscheck/   # 承認範囲だけの突合（再読プロトコル）
│   │   └── 03-discrepancy-gate/      # 食い違いの人間判断 + 記述への反映
│   ├── 01-question/                  # Phase 1a
│   ├── 02-iso-breakdown/             # Phase 1b: 02-07
│   ├── 03-rubric-gen/
│   ├── 04-scoring/
│   ├── 05-loop-req/
│   ├── 06-confluence-save-req/
│   ├── 07-human-gate-req/                            # [gate]
│   ├── 08-design-brainstorm/         # Phase 2: 08-13
│   ├── 09-sample-html-gen/                           # subagent 並列実行
│   ├── 10-sample-human-review/                       # [gate]
│   ├── 11-wcag-mapping/                              # WCAG 2.2 AA + Phase 2 loop control
│   ├── 12-design-system/                             # subagent build-tokens
│   ├── 13-human-gate-design/                         # [gate]
│   ├── 14-screen-list-transition/    # Phase 3: 14-25  (coverage-check 早期チェック含む)
│   ├── 15-confluence-save-design/                    # 2 回実行 (pre/post-loop)
│   ├── 16-design-doc-human-review/                   # [gate]
│   ├── 17-screen-gen/
│   ├── 18-design-review/
│   ├── 19-rubric-score/                              # coverage-check 再評価
│   ├── 20-loop-design/
│   ├── 21-screen-human-review/                       # [gate]
│   ├── 22-figma-export/                              # subagent 経由
│   ├── 23-human-final-approval/                      # [gate]
│   ├── 24-design-system-update/                      # Variables 3 collections + ComponentSet + audit.js
│   ├── 25-component-build/                           # Atom/Molecule/Organism
│   ├── 26-retro/                     # Phase 4                          # [gate]
│   ├── 27-change-detect/             # Phase 5 delta
│   ├── 28-impact-analysis/                           # [gate]
│   ├── 29-partial-screen-regen/                      # [gate]
│   ├── 30-partial-figma-update/                      # [gate]
│   ├── 31-req-change-detect/         # Phase 1c req-delta
│   ├── 32-req-impact-analysis/                       # [gate]
│   └── 33-req-revision/                              # [gate]
├── docs/
│   ├── setup.md                      # 詳細セットアップ手順
│   ├── interface-contracts.md        # ステップ間インターフェース契約
│   ├── html-generation-rules.md      # Step 09 / 17 共通 HTML ルール (anti-slop / 16:9 / inline SVG)
│   ├── screen-coverage-check.md      # 画面パターン網羅性チェック仕様
│   ├── wcag-standards.md             # WCAG 2.2 AA / contrast pairs 1-15
│   ├── dtcg-spec-ref.md              # DTCG 準拠仕様（tokens.json）
│   ├── data-architecture/
│   │   └── retro-data-pipeline.md    # 26 振り返りデータパイプライン仕様
│   ├── templates/
│   │   └── transition-map.template.html  # 遷移図 HTML wrapper テンプレート（.mmd → .html 派生用）
│   ├── images/                       # README 用画像
│   └── test-fixtures/
│       ├── sample-inputs.md
│       ├── sample-app/               # 実行済みサンプル
│       └── expected/                 # 期待出力サンプル
├── schemas/                          # artifacts/{app_name}/ 各ファイルの一元仕様（draft 2020-12）
│   ├── requirements.schema.json      # プロジェクト要件（INPUT）
│   ├── rubric.schema.json            # Phase 1b 採点基準（ループ不変量）
│   ├── scoring-history.schema.json   # Phase 1b 採点 attempt 履歴
│   ├── wcag-mapping.schema.json      # Phase 2 WCAG 不変量（constraints / criteria）
│   ├── wcag-history.schema.json      # Phase 2 WCAG 違反 attempt 履歴
│   ├── design-brief.schema.json      # Phase 2 design-brief.yaml の schema
│   ├── scores.schema.json            # Phase 3 デザイン採点結果（current snapshot）
│   ├── coverage-check.schema.json    # Phase 3 画面パターン coverage 結果
│   ├── change-manifest.schema.json   # Phase 5 (delta) / Phase 1c (req-delta) / Phase 1d (add-feature) 変更マニフェスト
│   ├── pipeline-state.schema.json    # クロスフェーズ状態（承認時刻 / 選択結果 / Confluence ID）
│   ├── figma-state.schema.json       # Figma MCP feature state（FIGMA_MCP_ENABLED=true 時のみ）
│   ├── feedback-log.schema.md        # フィードバックログ形式規約
│   ├── history-summary.schema.md     # クロスプロジェクト履歴形式規約
│   └── templates/history/            # artifacts/history/ 初期化テンプレート
├── scripts/                          # 補助スクリプト（profile-context.mjs = context 消費プロファイラ, docs/context-profiler.md 参照）
└── artifacts/                        # パイプライン実行成果物（自動生成・Git 管理外）
    ├── history/                      # 全プロジェクト横断履歴（index / project summaries）
    └── {app_name}/
        ├── input-sources/            # **ユーザー提供の一次ソース** (INPUT, optional)。リバース系・整合チェック系の ground-truth。
        │   ├── ios-swift/            # 例: iOS Swift プロジェクト
        │   ├── be-python/            # 例: バックエンド Python
        │   └── kmp/                  # 例: Kotlin Multiplatform 等、プラットフォーム別サブディレクトリで配置
        ├── requirements.json         # プロジェクト要件（純粋な記述、INPUT）
        ├── rubric.json               # Phase 1b 採点基準（criteria 定義のみ）
        ├── scoring-history.json      # Phase 1b 採点 attempt 履歴（04 が append）
        ├── wcag-mapping.json         # 11 で確定した WCAG 不変量
        ├── wcag-history.json         # Phase 2 WCAG 違反 attempt 履歴
        ├── scores.json               # Phase 3 デザイン採点結果（current snapshot）
        ├── pipeline-state.json       # クロスフェーズ状態（承認時刻 / 選択 / Confluence ID）
        ├── tokens.json               # 3 層構造デザイントークン
        ├── design-brief.yaml         # 08 で決定したデザイン方向性（yaml SSOT）
        ├── style-guide.md            # 12 で生成したスタイルガイド
        ├── feedback-log.md           # パイプライン中の修正・指摘記録
        ├── pipeline-improvements.md  # 26 の振り返りレポート
        ├── requirements/             # 要件定義ドキュメント（01-08）
        ├── design-samples/           # 09 のサンプル HTML 3 案
        ├── screens/                  # 全画面 HTML + 状態 + style-guide-view.html + 00-coverage-check.json + 00-transition-map.mmd (SSoT) + 00-transition-map.html (派生)
        ├── build/                    # Step 12 Style Dictionary build 出力（css/scss/ts/swift/kotlin/dart/xml）
        ├── req-delta/                # Phase 1c 成果物（change-manifest / impact-analysis / run-history）
        ├── delta/                    # Phase 5 成果物（change-manifest / impact-analysis / snapshots）
        ├── reverse-engineered/       # Phase 0b 中間成果物（status=REVERSE_ENGINEERED 時のみ）
        └── figma-state.json          # Figma MCP の node-id / variable-id 管理（FIGMA_MCP_ENABLED=true 時のみ）
```

`artifacts/{app_name}/` 配下のファイル責務マップは `docs/artifact-file-responsibility.md`、および `pipeline.yaml` の `file_topology` が SoT。

---

## パイプライン概要

7 Phase × 35 Steps（基本 26 ステップ + 差分更新 27-30 + 要件差分 31-33 + delta-mini 振り返り 34 + 配布物生成 35）+ 独立コマンド 1 個（`/ayatori-export`）。基本 26 ステップ構成は [Confluence 3767469072](https://kinto-dev.atlassian.net/wiki/spaces/mord/pages/3767469072) 準拠:

```
Status:   /ayatori-status         パイプライン進捗ダッシュボード（全プロジェクト一覧・次アクション推奨）

Phase 0b: /ayatori-reverse        01 ground-truth 収集 → 02 ソース解析（B-01〜B-07）
                               → 03 ISO 29148 要件生成 → 04 比較・ギャップ分析（任意）
                               → 05 リバースレビューゲート → 06 AYATORI フォーマット変換 → 06-confluence-save-req Confluence 保存（再利用）
                               ※ 既存アプリのリバースエンジニアリング。完了後は /ayatori-design から継続。

Phase 1a: /ayatori-question       01 7 軸ヒアリング
Phase 1b: /ayatori-requirements   02 ISO 29148 変換 → 03 ルーブリック生成 → 04 AI 採点
                               → 05 ループ判定 → 06 Confluence 保存 → 07 人間承認(gate)
                               合格条件: total >= 80 AND 全軸 >= per_axis_min(12) / max_attempts: 3

Phase 1c: /ayatori-req-delta      31 要件変更検出 → 32 影響分析(gate) → 33 修正案レビュー(gate)
                               ※ Step 07 承認後の要件変更を 8 ISO 文書間に伝播（UI 生成前）

Phase 2:  /ayatori-design         08 デザインブレスト → 11 WCAG マッピング (color-agnostic constraints)
                               → 09 サンプル HTML × 3（subagent 並列）→ 10 サンプル選択(gate)
                               → 12 デザインシステム生成（3 層 tokens + Style Dictionary build, subagent）
                               → 13 スタイルガイド承認(gate)
                               ループ: 11 が contrast 違反検出時に 08 へ戻す / max_attempts: 3
                               B-3: palette / domain_surface が loop trigger、state_colors は warn-only

Phase 3:  /ayatori-screens        14 画面一覧・遷移図 (.mmd SSoT + 派生 HTML + 任意 FigJam 同期)
                                  + 画面パターン早期チェック
                               → 16 ドキュメントレビュー(gate) → 15 Confluence 保存（1 回目）
                               → 17 全画面 HTML + 状態フレーム → 18 デザインレビュー
                               → 19 ルーブリック採点（coverage-check 再評価含む）
                               → 20 ループ判定 → 21 全画面 HTML 承認(gate)
                               → [15 Confluence 2 回目再実行] → 22 Figma 出力（subagent キャプチャ）
                               → 23 最終承認(gate) → 24 デザインシステム更新（Variables 3 collections + ComponentSet + audit.js）
                               → 25 コンポーネントインスタンス配置
                               ループ合格条件: current.ai_improvable_deductions == 0 / max_attempts: 3

Phase 4:  /ayatori-retro          26 振り返り + パイプライン改善案 + 最終承認(gate)

Phase 5:  /ayatori-delta          27 変更検出 → 28 影響分析(gate) → 29 部分画面再生成 + 遷移図 .mmd 部分修正 + FigJam 再同期(gate)
                               → 30 Figma 部分更新(gate)
                               ※ final_approved == true (または reverse 基線の baseline_approved_at) 後に要件変更を最小範囲で反映。
                               design system / preserved screens は frozen、affected/new のみ regen。
```

**人間ゲート**: **07 / 10 / 13 / 16 / 21 / 23 / 26 / 28 / 29 / 30 / 32 / 33** の計 **12 箇所**（Claude が AskUserQuestion で一時停止）。
**実行単位**: 各 Phase は独立した会話で実行し、`artifacts/{app_name}/` を介して状態を引き継ぐ。
**ステータス確認**: `/ayatori-status` はいつでも実行可能。全プロジェクトの Phase 別進捗をテーブル表示し、次に実行すべき Phase コマンドを推奨する。

---

## Jira チケット ↔ パイプライン マッピング

**Jira プロジェクト**: [POCTEAMA](https://kinto-dev.atlassian.net/jira/software/projects/POCTEAMA/boards/3695)

### Epic 一覧

| Epic | 対象範囲 | 状態 |
|---|---|---|
| AYATORI-1: 要件 Agent | Steps 01-07 (Phase 1a / 1b) | 実装完了 |
| AYATORI-2: UI デザイン生成 | Steps 08-12 / 14-17 / 22 / 24-25 (Phase 2 / 3) | 実装完了 |
| AYATORI-3: 品質評価基盤 | Steps 11 / 18-20 / 26 | 実装完了 |
| AYATORI-4: History 参照 | 全ステップ横断 | 実装完了 |

> Step ↔ Skill の最新配置は `pipeline.yaml` の `phase_order` / `steps:` 配列を SoT として参照する。
---

## 2段階ロードマップ

> 詳細: [AYATORI仕様書 §7](https://kinto-dev.atlassian.net/wiki/spaces/mord/pages/3740237924) / [Webツール化 実装設計書](https://kinto-dev.atlassian.net/wiki/spaces/mord/pages/3740893189)

### Step 1: Claude Code パイプライン実証（現在 — R&D-3 / R&D-4）

Claude Code 自体がオーケストレーターを担う。自前のアーキテクチャ設計は不要。
個別スキル実装（R&D-3）が完了し、結合テスト・改善ループ（R&D-4）の段階。

- `CLAUDE.md`（ルーター）→ `phases/*/SKILL.md`（Phase）→ `skills/NN-name/SKILL.md`（Step）
- `/ayatori-*` コマンドで Phase 単位実行、`skills/` で個別テスト
- 各 PR 後の振り返り（Phase 4 retro）でパイプライン改善案を継続反映

| フェーズ | 内容 | 状態 |
|---|---|---|
| R&D-1 | 既存スキル動作検証 | 完了 |
| R&D-2 | ルーブリック採点精度検証 | 完了 |
| R&D-3 | 単体スキル実装（35 ステップ + 5 共通ヘルパー + 3 subagent） | 完了 |
| R&D-4 | パイプライン結合テスト + 改善ループ | 進行中 |

### Step 2: Claude API + オーケストレーションによる Web ツール化

Step 1 で検証済みのプロンプト・スキルを Claude API 用に移植し、
チーム全体で統一された運用環境を構築する。

**エージェント構成（8エージェント + 1オーケストレーター）**

| エージェント | モデル | 担当ステップ | 接続ツール |
|---|---|---|---|
| オーケストレーター | Sonnet（またはコード） | 全体フロー制御・ループ判定 | なし（ステートストアのみ） |
| 要件定義エージェント | Sonnet | 01 / 02 | Atlassian MCP |
| 品質管理エージェント | **Opus** | 03 / 04 | Atlassian MCP |
| デザインコンセプトエージェント | Sonnet | 08 / 09 / 10 | なし |
| デザインシステムエージェント | Sonnet | 12 / 24 / 25 | Style Dictionary v5 (12) / Figma MCP + Variables API (24 / 25) + Atlassian MCP |
| 画面生成エージェント | Sonnet | 14 / 17 / 22 | Figma MCP |
| Confluence保存エージェント | Sonnet | 06 / 15 | Atlassian MCP |
| デザイン評価エージェント | **Opus** | 18 / 19 | Figma MCP + REST API + Claude Vision |
| 振り返りエージェント | **Opus** | 26 | Atlassian MCP |

### Step 1 → Step 2 の関係

Step 1（`skills/NN-name/SKILL.md`）で検証したプロンプト・スキルを、
Step 2 で上記エージェント構成に移植する。**Step 1 の成果なしに Step 2 に着手しない。**

---

## スキル実装時の注意（Step 1）

**3-Layer 構成により、スキルの実体は `skills/NN-name/SKILL.md` の 1 箇所に集約されている。**

| レイヤー | ファイル | 役割 |
|---|---|---|
| Layer 1 | `CLAUDE.md` | ルーター（Phase コマンドへ誘導） |
| Layer 2 | `phases/*/SKILL.md` | Phase オーケストレーター（Step を順番に Read） |
| Layer 3 | `skills/NN-name/SKILL.md` | Step スキル実体（実装対象） |

**運用ルール**: `skills/NN-name/SKILL.md` を編集するだけで Phase 実行・単体テストの両方に反映される。
`pipeline.yaml` が Phase↔Step のマッピングを定義しているため、別途同期する必要はない。

---

## Figma MCP について

`FIGMA_MCP_ENABLED` 未設定 or `false`（デフォルト）の場合のフォールバック挙動はステップごとに異なる:

| ステップ | フォールバック挙動 |
|---|---|
| **17 / 18 / 22 / 24 / 25** | MD / HTML 出力のスタブとして動作（Figma を触らずローカルファイルで成果物を継続生成） |
| **14 / 29**（遷移図 FigJam 同期） | `.mmd` (SSoT) と派生 `.html` の生成は常時実行。FigJam 同期 (`00-transition-figjam-sync`) のみスキップ |
| **30**（delta Figma 部分更新） | Figma 書き込みのみをスキップ。`pipeline-state.json.delta.runs[-1].figma_status = "skipped_stub_mode"` を記録し、Step 5 gate へ直接遷移して承認時に Step 6 / 7 を完走させる |

検証はまずスタブモードで動作確認してから Figma MCP を有効化すること。

`FIGMA_MCP_ENABLED=true` の場合、上記 8 ステップ（14 / 17 / 18 / 22 / 24 / 25 / 29 / 30）が Figma MCP 経由で `{app_name}` ページ / FigJam ボードに書き込む。
**方針**:
- **Step 14 / 29**（遷移図 FigJam 同期）は `.mmd` SSoT から `generate_diagram` + `use_figma` (subgraph tint 後追い塗装) で FigJam に単方向反映。共通 skill `00-transition-figjam-sync` 経由で single writer 経路を強制。delta はクリーン上書き方式。
- **Step 22**（画面出力）は `generate_figma_design`（HTML キャプチャ）を **第一選択**。subagent (`figma-capture-runner`) が並列キャプチャを実行し、verbose レスポンスを主 context から隔離する。
- **Step 24**（デザインシステム更新）は Variables 3 コレクション（Primitives / Semantic / Component）登録と ComponentSet 構築を担当。`audit.js` Self-Audit でレイアウト整合性を検証する。
- **Step 25** はコンポーネントインスタンスを画面に配置。
- **Step 30**（delta）は preserved frame の node_id を再利用し、affected/new のみ部分更新。
- **Step 12** はコード生成のみで Figma を触らない（Variables 登録は 24 が担当）。

モード判定の SoT は **Step 17 / 18 / 22 / 24 / 25** が対象で、`skills/00-figma-mode-detect/SKILL.md` が Bash 経由で OS env var を直接読み、判定結果を各 step に渡す。
**Step 14 / 29**（遷移図 FigJam 同期）と **Step 30**（delta Figma 部分更新）は mode-detect の対象外で、自身の手順内で `FIGMA_MCP_ENABLED` を確認して fallback（同期 / 書き込みスキップ）を定義する。

---

## セッションの再開

中断後に再開する場合は `claude` を起動し直すと自動でプロジェクト選択画面が出る。  
`artifacts/{app_name}/` の状態ファイルを読んで中断ステップから自動復帰する。

**再開前のステータス確認（推奨）**: `/ayatori-status` を実行すると、全プロジェクトの Phase 別進捗がテーブル表示され、次に実行すべきコマンドが推奨される。
