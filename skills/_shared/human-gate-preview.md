# Human Gate Artifact Preview (Shared Helper)

各人間ゲート step (07 / 10 / 13 / 16 / 21 / 21b / 21g / 23 / 26 + screens-lite のベースライン承認ゲート) で「確認対象成果物」を提示する際の
**唯一の標準フォーマット**。本ファイルは Single Source of Truth (SoT) であり、各 skill は
本ヘルパを Read して機械的に従う。

## 目的

人間ゲート時に成果物をスムーズに確認できるよう、2 階層の UX 改善を提供する:

1. **Clickable link 一覧** (baseline、全成果物): VSCode 拡張で ⌘+click で開ける
   `[label](file:///abs/path)` markdown link を提示する。
2. **Auto-open** (HTML のみ、step ごとに最大 1 つ): `pipeline.yaml` で
   declarative に指定された「主要 HTML」を `open` (macOS) / `xdg-open` (Linux) /
   `cmd.exe /c start` (Windows Git Bash 等) でブラウザ自動起動する。複数ファイル一斉 open は spam に
   なるため抑制する。

両方失敗した場合は、希望③ (path 文字列をそのまま貼り付け) に自動 degrade する。

加えて `refresh_index: true` (既定) のとき、各ゲートで `index.html` (全成果物インデックス) を自動再生成し link 一覧の先頭に追加する。人間ゲートはフェーズの区切りでもあるため、承認者がゲート時点の全成果物を 1 画面からまとめて確認できる (詳細は Step 2.5)。

---

## 入力契約 (各 skill が提供する)

各人間ゲート skill は本ヘルパ呼び出し前に、以下の情報を組み立てる:

```
step_id            = "13-human-gate-design"  # pipeline.yaml.human_gate.artifact_preview.auto_open.step_targets のキーと一致
app_name           = pipeline-state.json.app_name (もしくは artifacts/ 直下のディレクトリ名)
artifacts_root_abs = {repo_root}/artifacts/{app_name}    # `pwd` 取得後に組み立て

artifacts_to_review = [
  { kind: "md"  | "html" | "image" | "external_url",
    abs_path: "/absolute/path/...",   # external_url の場合は url を入れる
    label:    "human-readable label" },
  ...
]
```

- `kind`:
  - `md` → 📄 で link 表示。auto-open 対象外。
  - `html` → 🌐 で link 表示。primary HTML として step_targets に一致するなら auto-open。
  - `image` → 🖼️ で link 表示。auto-open 対象外。
  - `external_url` → 🎨 で URL 表示 (Figma / Confluence)。auto-open 対象外。
- `abs_path` は必ず絶対パス。`{repo_root}` は `pwd` (Bash) で取得する。
- `label` は VSCode 拡張上で表示される文字列。日本語可。

---

## 実行手順

### Step 1: pipeline.yaml の設定を Read

`pipeline.yaml` の `human_gate.artifact_preview` セクションを Read。

判定:
- `enabled: false` → preview block を生成せず、本ヘルパは何もしない。skill 側の従来 path 提示に fallback。
- `enabled: true` → Step 2 へ続行。

### Step 2: artifacts_to_review の組み立て (skill 側責務)

各 skill が自分の Step 0 で組み立てる (入力契約 参照)。本ヘルパは構築済みリストを受け取る前提。

### Step 2.5: 成果物インデックスの自動再生成 (refresh_index)

`pipeline.yaml.human_gate.artifact_preview.refresh_index` を判定:

- `false` → 本 Step を skip して Step 3 へ。
- `true` (既定) → `artifacts/{app_name}/index.html` を再生成し、ゲート時点の全成果物を 1 画面から確認できる状態にする。

**fail-open**: 生成に失敗してもゲートを止めない (auto-open と同じ degrade 方針)。`node` 不在・script 失敗時は index 行を追加せず、既存の link 一覧のみで続行する。

```bash
node "{repo_root}/scripts/build-artifact-index.mjs" "{artifacts_root_abs}" \
  && echo "[index] refreshed {artifacts_root_abs}/index.html" \
  || echo "[index] skip (generation failed, non-blocking)"
```

生成に成功したら、`artifacts_to_review` の**先頭**に index を 1 件追加する (link 一覧に必ず出す。auto-open はしない — 各 step の primary HTML を優先し spam を避けるため、index は link-only):

```
{ kind: "html", abs_path: "{artifacts_root_abs}/index.html", label: "📦 全成果物インデックス (この画面から全部見られます)" }
```

### Step 3: 主要 HTML を auto-open

`auto_open.mode` を判定:
- `none` → Step 4 へ (auto-open skip)
- `all`  → `target_types` に一致する全ファイルを open (非推奨、本パイプラインでは使用しない)
- `primary_only` (既定) → 以下のロジックで 1 ファイルだけ open

```
target_template = pipeline.yaml.human_gate.artifact_preview.auto_open.step_targets[step_id]

if target_template is null:
    # この step は auto-open しない (Figma 確認が主 等の理由)
    skip auto-open, go to Step 4

# {placeholder} を解決:
#   {first_platform} → ["web","mobile"] の固定順で design-samples/ 配下に最初に存在する platform (web 優先・無ければ mobile。ls の並びに依存しない)
# ※ 必要に応じて将来 placeholder を追加する場合は本ヘルパに登録する。
resolved_target_abs = {artifacts_root_abs}/{resolve_placeholders(target_template)}

# 該当ファイルが artifacts_to_review に含まれているかチェック
# (含まれていなければ skill 側の組み立て不整合 → skip して警告のみ)
if resolved_target_abs not in [a.abs_path for a in artifacts_to_review where kind == "html"]:
    warn "step_targets で指定された主要 HTML が artifacts_to_review に含まれていません: {resolved_target_abs}"
    skip auto-open, go to Step 4

# 存在チェック
if not file_exists(resolved_target_abs):
    warn "primary HTML が見つかりません: {resolved_target_abs}"
    skip auto-open, go to Step 4

# OS 判定 + open 呼び出し
```

**Bash 実装** (本ヘルパ呼び出し時に main session の Bash で実行):

```bash
TARGET="/abs/path/to/file.html"
if command -v open >/dev/null 2>&1; then
  # macOS
  open "$TARGET" && echo "[opened] $TARGET" || echo "[failed] open exit non-zero"
elif command -v xdg-open >/dev/null 2>&1; then
  # Linux (xdg-utils が入っている GNOME / KDE 系)
  (xdg-open "$TARGET" >/dev/null 2>&1 &) && echo "[opened] $TARGET (xdg-open)" || echo "[failed] xdg-open"
elif command -v cmd.exe >/dev/null 2>&1; then
  # Windows (Git Bash / MSYS2 / Cygwin / WSL): `start` は cmd.exe の builtin で PATH に無いため
  # 必ず `cmd.exe /c start "" "<file>"` の形で起動する (`""` は start の第 1 引数 "window title" の placeholder)。
  # POSIX path のままでも cmd.exe が現代の Windows では受け付けるが、もし開かない場合は
  # `cygpath -w "$TARGET"` で Windows ネイティブパス (例: `C:\Users\...`) に変換が必要なことがある。
  cmd.exe /c start "" "$TARGET" && echo "[opened] $TARGET (cmd.exe /c start)" || echo "[failed] cmd.exe start"
else
  # Windows ネイティブの cmd.exe / PowerShell 直接実行 + open/xdg-open/cmd.exe 全て不在の環境
  echo "[skip] no opener in PATH (open/xdg-open/cmd.exe all missing), fallback to link-only"
fi
```

> **Windows サポート方針**: Git Bash / MSYS2 / WSL では `cmd.exe` が PATH 上にあるため上記の `elif` 分岐で auto-open が機能する。PowerShell や `cmd.exe` 直接実行で本ヘルパを呼ぶケースは想定外 (Claude Code の Bash tool は POSIX shell 経由でしか動作しないため通常発生しない)。`start` (cmd.exe builtin) を直接検出する形では `command -v start` が見つからず常に link-only fallback に degrade してしまうため、必ず `cmd.exe /c start` の形で外側から起動すること。

戻り値:
- `[opened] ...` → Step 4 の link 一覧で該当 HTML に `← 自動で開きました` 注記を付ける
- `[failed] ...` / `[skip] ...` → 注記を付けず、link 一覧の末尾に degrade メッセージ追加

**重要**: auto-open Bash が失敗してもパイプラインを止めない (`fallback_on_failure: emit_path_only`)。

### Step 4: Clickable link 一覧の出力

以下のフォーマットで人間に向けて表示する (skill 側のメインゲート提示メッセージの直前):

```
**📋 確認対象成果物:**

- 📄 [requirements/01-overview.md](file:///{abs}/artifacts/{app_name}/requirements/01-overview.md) — 01 プロジェクト概要
- 📄 [requirements/02-scope.md](file:///{abs}/artifacts/{app_name}/requirements/02-scope.md) — 02 スコープ定義
- 🌐 [style-guide-view.html](file:///{abs}/artifacts/{app_name}/screens/style-guide-view.html) ← 自動でブラウザを開きました
- 🌐 [00-transition-map.html](file:///{abs}/artifacts/{app_name}/screens/00-transition-map.html)
- 🎨 [Figma file](https://www.figma.com/design/{file_key}/?node-id={page_id}) — Figma 上の最終確認

> VSCode 拡張上では link を **⌘+click** で OS 既定アプリで開けます。
> ターミナル直接実行の場合は path をコピーして手動で開いてください。
```

絵文字凡例 (固定):
- 📄 = MD ファイル
- 🌐 = HTML ファイル
- 🖼️ = 画像 (PNG / JPG / SVG)
- 🎨 = 外部 URL (Figma / Confluence)

label 規約:
- 1 件あたり 1 行
- `[ファイル名 or 短いラベル](file:///abs/path) — 簡潔な説明` の形式
- ファイル名はリポジトリ root からの相対パス先頭部分を省略してよい (例: `requirements/01-overview.md`)
- VSCode 拡張上で表示される際の **可読性** を最優先 (内部キーや技術用語は label に出さない)

### Step 5: Auto-open 失敗時の degrade メッセージ

`open` 系コマンドが見つからない / 全て exit non-zero だった場合のみ、link 一覧の末尾に以下を追記:

```
> ℹ️ ブラウザ自動起動は失敗 (OS opener 不在 or 起動エラー) のためスキップしました。
> 上記 link を ⌘+click で開くか、path をコピーしてブラウザに貼り付けてください。
```

ファイル個別の存在チェック失敗 (path が無い) は別途警告を該当 link 行の右に付与する:

```
- 🌐 [missing.html](file:///abs/path/missing.html) ⚠️ ファイルが見つかりません
```

---

## 各 step での呼び出し例 (skill 側はこの形で構築する)

### Step 07 (要件承認、`07-human-gate-req`)

ファイル名は `skills/06-confluence-save-req/SKILL.md` の処理順 (canonical SoT) に準拠する。**変更時はそちらも同期すること**。

Confluence URL は `pipeline.yaml.confluence.url_template` の `{page_id}` を `pipeline-state.json.confluence.requirements.page_id` で置換して組み立てる (page ID は文字列のみ保存、`schemas/pipeline-state.schema.json` L198-216 に base URL / space は無いため本テンプレートが唯一の SoT)。

```
confluence_url = pipeline.yaml.confluence.url_template.replace("{page_id}", pipeline-state.json.confluence.requirements.page_id) if page_id else null

artifacts_to_review = [
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/01-overview.md",         label: "01 プロジェクト概要" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/02-scope.md",            label: "02 スコープ定義" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/03-user-flow.md",        label: "03 ユーザーフロー" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/04-use-cases.md",        label: "04 ユースケース一覧" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/05-features.md",         label: "05 機能一覧" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/06-non-functional.md",   label: "06 非機能要件" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/07-data-definition.md",  label: "07 データ定義・外部連携" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/08-constraints.md",      label: "08 制約・前提・受け入れ条件" },
  { kind: "external_url", abs_path: confluence_url,                                              label: "Confluence (要件 親ページ)" } if confluence_url,
]
```
Auto-open: なし (step_targets = null)。

### Step 10 (サンプル選択、`10-sample-human-review`)

```
# ["web", "mobile"] の固定順で存在する platform だけを残す (ls の結果順に依存しない = 環境非依存)
platforms = [p for p in ["web", "mobile"] if file_exists(artifacts/{app_name}/design-samples/{p}/index.html)]
first_platform = platforms[0]

artifacts_to_review = [
  { kind: "html", abs_path: "{artifacts_root_abs}/design-samples/{p}/index.html", label: "{p} サンプル (3案切替式)" }
    for p in platforms
]
```
Auto-open: `design-samples/{first_platform}/index.html`。

### Step 13 (スタイルガイド承認、`13-human-gate-design`)

```
artifacts_to_review = [
  { kind: "md",   abs_path: "{artifacts_root_abs}/style-guide.md",                label: "スタイルガイド (MD)" },
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/style-guide-view.html", label: "パーツカタログ (HTML)" },
]
```
Auto-open: `screens/style-guide-view.html`。

### Step 16 (画面一覧 + 遷移図、`16-design-doc-human-review`)

```
artifacts_to_review = [
  { kind: "md",   abs_path: "{artifacts_root_abs}/screens/00-screen-list.md",       label: "画面一覧" },
  { kind: "md",   abs_path: "{artifacts_root_abs}/screens/00-transition-map.mmd",   label: "遷移図 SSoT (純 Mermaid)" },
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/00-transition-map.html",  label: "遷移図 HTML (派生)" },
  # FIGMA_MCP_ENABLED=true 時のみ FigJam URL を追加:
  { kind: "external_url", abs_path: "{figma-state.nodes.transition_map.url}",       label: "遷移図 FigJam (編集可)" },
]
```
Auto-open: `screens/00-transition-map.html`。

### ベースライン承認ゲート (screens-lite Route A、`screens-lite-baseline-gate`)

skill を持たない phase 内工程 (`phases/screens/SKILL.md` § Execution — screens-lite の lite-4b) が呼び出す。基線材料は index に集約されているため index を主に据える (auto-open 対象)。

```
artifacts_to_review = [
  { kind: "html", abs_path: "{artifacts_root_abs}/index.html",                     label: "成果物インデックス (基線材料をこの 1 画面で確認)" },
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/00-transition-map.html",  label: "遷移図 HTML (派生、L5 defects の確認用)" },
]
```
Auto-open: `index.html`。Step 2.5 (`refresh_index`) が先頭に自動追加する index と path が重複するため、**1 行に統合して提示する**。押印後の index 再生成 (承認印をタイムラインに載せる目的) は呼び出し側 lite-4c の責務。

### Step 21 (全画面 HTML、`21-screen-human-review`)

```
# screens/web/*.html / screens/web-sm/*.html / screens/mobile/*.html を全列挙 (state variant 含む)
artifacts_to_review = [
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/web/{name}.html",        label: "Web · {name}" } for each,
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/web-sm/{name}.html",     label: "Web SM · {name}" } for each,
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/mobile/{name}.html",     label: "Mobile · {name}" } for each,
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/style-guide-view.html",  label: "パーツカタログ" },
]
```
Auto-open: なし (step_targets = null、画面数が多すぎて spam になるため、Figma 確認が主)。

### Step 21b (グラフィック要否ヒアリング、`21b-graphic-hearing`)

```
artifacts_to_review = [
  { kind: "html", abs_path: "{artifacts_root_abs}/graphics/graphic-recommend.html", label: "グラフィック候補スロット 視覚レポート" } if file_exists,  # 候補 0 件 / render 失敗時は不在
  { kind: "md",   abs_path: "{artifacts_root_abs}/graphics/graphic-recommend.md",   label: "グラフィック必要性 推奨レポート" } if mode == report,
  { kind: "md",   abs_path: "{artifacts_root_abs}/screens/00-screen-list.md",       label: "画面一覧" },
]
```
Auto-open: `graphics/graphic-recommend.html` (不在なら本ヘルパの存在チェックが warn + skip → link 一覧のみ)。

### Step 21g (グラフィック埋め込み承認、`21g-graphic-embed-review`、POCTEAMA-190)

```
# 埋め込んだ main HTML は gather-context.mjs の embed_targets (slot × platform × theme) から列挙
artifacts_to_review = [
  { kind: "html", abs_path: "{artifacts_root_abs}/graphics/graphic-embed-review.html", label: "グラフィック埋め込みレビュー (視覚レポート)" } if file_exists,  # render 失敗時は不在
  { kind: "html", abs_path: "{artifacts_root_abs}/screens/{platform}/{name}.html",     label: "{platform} · {name} (埋め込み済み)" } for each embed_target (重複除去),
  { kind: "md",   abs_path: "{artifacts_root_abs}/screens/{screen}.md",                label: "{screen} 仕様書 (使用グラフィック節 追記予定)" } for each 対象 screen,
]
```
Auto-open: `graphics/graphic-embed-review.html` (不在なら本ヘルパの存在チェックが warn + skip → link 一覧のみ)。

### Step 23 (最終承認、`23-human-final-approval`)

```
artifacts_to_review = [
  { kind: "external_url", abs_path: "https://www.figma.com/design/{file_key}/?node-id={page_id}", label: "Figma 最終確認" },
]
# scores.json / figma-state.json はサマリーをチャットで提示するため preview block には載せない
```
Auto-open: なし。Figma URL を ⌘+click で開く想定。

### Step 26 (Retro 成果物確認、`26-retro` Phase 0)

要件 8 MD は Step 07 と同じ canonical 順 (`01-overview / 02-scope / 03-user-flow / 04-use-cases / 05-features / 06-non-functional / 07-data-definition / 08-constraints`、`skills/06-confluence-save-req/SKILL.md` 参照) で列挙する。SKILL.md 側は `ls artifacts/{app_name}/requirements/*.md` で動的取得しても、固定順で羅列してもどちらでもよい (動的取得の方が rename に強い)。

Confluence URL は要件 / デザイン共通の `pipeline.yaml.confluence.url_template` を `page_id` で置換する。個別 8 要件ドキュメント / 各画面ドキュメントは親ページから navigate できるため retro 段階では親 1 件に集約する (Step 07 / 21 で個別 link は既に提示済)。

```
url_template               = pipeline.yaml.confluence.url_template
confluence_req_url         = url_template.replace("{page_id}", pipeline-state.json.confluence.requirements.page_id) if page_id else null
confluence_design_url      = url_template.replace("{page_id}", pipeline-state.json.confluence.design.page_id)        if page_id else null
figma_url                  = ("https://www.figma.com/design/" + figma-state.json.file_key + "/?node-id=" + figma-state.json.page_id) if file_key else null   # Step 23 と同形式 (canonical /design/{key}/?node-id={page_id})

artifacts_to_review = [
  # Phase 1 要件 (8 MD、canonical 順)
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/01-overview.md",         label: "01 プロジェクト概要" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/02-scope.md",            label: "02 スコープ定義" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/03-user-flow.md",        label: "03 ユーザーフロー" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/04-use-cases.md",        label: "04 ユースケース一覧" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/05-features.md",         label: "05 機能一覧" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/06-non-functional.md",   label: "06 非機能要件" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/07-data-definition.md",  label: "07 データ定義・外部連携" },
  { kind: "md",           abs_path: "{artifacts_root_abs}/requirements/08-constraints.md",      label: "08 制約・前提・受け入れ条件" },
  { kind: "external_url", abs_path: confluence_req_url,                                          label: "Confluence (要件 親ページ)" } if confluence_req_url,
  # Phase 2 design system
  { kind: "md",           abs_path: "{artifacts_root_abs}/style-guide.md",               label: "スタイルガイド (MD)" },
  { kind: "html",         abs_path: "{artifacts_root_abs}/screens/style-guide-view.html", label: "パーツカタログ" },
  # Phase 3 screens
  { kind: "md",           abs_path: "{artifacts_root_abs}/screens/00-screen-list.md",    label: "画面一覧" },
  { kind: "external_url", abs_path: figma_url, label: "Figma (画面)" } if figma_url,
  { kind: "external_url", abs_path: confluence_design_url, label: "Confluence (画面 親ページ)" } if confluence_design_url,
]
```
Auto-open: なし。数値サマリーと Confluence/Figma URL 確認が主。

---

## Subagent 経由の場合

人間ゲート skill は **すべて main session 上で実行** されるため、subagent 権限の考慮は不要。
ただし `.claude/settings.json` に `Bash(open:*)`, `Bash(xdg-open:*)`, `Bash(cmd.exe:*)`, `Bash(command -v:*)`
を main session 用に明示的に許可済。`start` (cmd.exe builtin) は単独で起動できないため
permission listing からも除外している。

---

## 失敗モード対応 (希望③ degrade)

CLAUDE.md Operating Principle 1 の例外条項 (OS 同梱コマンド) により、`open` / `xdg-open` / `cmd.exe`
が不在の OS であっても **エラー停止させない**。link 一覧表示 (希望②) は常に成功するため、最低限の
UX (希望③: path 貼り付け) は確実に提供される。

具体的な失敗パターンと挙動:

| パターン                                  | 挙動                                                |
|-------------------------------------------|-----------------------------------------------------|
| `open` / `xdg-open` / `cmd.exe` 全て不在  | auto-open skip + degrade メッセージ追加 (link-only UX に degrade) |
| Windows ネイティブ cmd.exe / PowerShell 直接実行 | (想定外、Claude Code Bash tool は通常 POSIX shell 経由) Git Bash / MSYS2 / WSL 経由なら正常動作 |
| primary HTML ファイル不在                 | auto-open skip + 該当 link 行に ⚠️ 警告              |
| `pipeline.yaml.human_gate.artifact_preview.enabled = false` | 本ヘルパ全体を skip (skill 側従来 path 提示に fallback) |
| `step_targets[step_id]` が null           | auto-open skip (link 一覧のみ、これは正常動作)        |
| Bash の権限拒否                            | auto-open skip + degrade メッセージ追加              |

---

## 関連

- `pipeline.yaml` § `human_gate.artifact_preview` — declarative 設定の SoT
- `CLAUDE.md` § Operating Principle 1 — OS 同梱コマンド例外条項
- `.claude/settings.json` — Bash permission 許可リスト
- 各人間ゲート skill (`skills/{07,10,13,16,21,23,26}-*/SKILL.md`) — 本ヘルパを Read する側
