---
name: 15-confluence-save-design
description: デザイン成果物パッケージを Confluence に保存する。Atlassian MCP を用いて Phase 3 で 2 回（Step 16 承認後と Step 21 承認後）実行され、いずれも人間承認後のみ push する。
---

# 15 Confluence 保存（デザイン・画面）

## 役割

デザイン成果物パッケージを Confluence に保存する。Atlassian MCP（公式リモート MCP サーバー、`.mcp.json` で宣言）を使用する。

このステップは **2 回実行される**（いずれも人間承認後のみ — AYATORI 原則「承認前の成果物を外部に push しない」）：
- **1回目**: 16（デザイン用ドキュメント人間レビュー）承認の直後。`design-brief.yaml` + `style-guide.md` + `screens/00-screen-list.md` + `00-transition-map.mmd` (SSoT、Mermaid macro 埋め込み元) までを保存。`screens/*.md` の個別仕様書はまだ存在しないため保存対象に含まれない（glob で自動判定）。→ 17（全画面 HTML 生成）へ。
- **2回目**: 21（全画面 HTML の人間承認）の直後。追加で `screens/*.md` の全画面仕様書が揃っているため、同じ階層に差分更新（新規作成）される。→ 22（Figma 出力）へ。

---

## 実行指示

### Phase 0: グラフィックブロック整合 assert（2nd run のみ）

`pipeline-state.json` の `confluence.design.save_count` を確認し、**`save_count >= 1`（= 本実行が 2nd run）のときのみ**以下を評価する。1st run（`save_count == 0`）では評価しない — 無条件評価は Step 21 未承認・graphics 未着手の 1st save を自己 deadlock させる（設計 `docs/graphic-generation-design.md` §9-3）。

次の (a)〜(c) の**いずれも成立しない**場合、保存を起動せず中断し、resume cascade（`phases/screens/SKILL.md` 手順 8 の graphics 分岐）の該当 21x step へ差し戻す（25d/25e の layer1_skill_assert と同型）:

- (a) `pipeline-state.screens.graphics.decision == "skip"`
- (b) `pipeline-state.approvals.graphics_human_approved == true`（canonical フラグ — `step21g_approved_at` ではなくこちらを読む、設計 §9-2）
- (c) **legacy passthrough**: `pipeline-state.screens.graphics` キー未存在 AND `confluence.design.save_count >= 2`（グラフィックブロック導入前に 2nd save まで到達していた決定的証拠 — 差し戻し先の 21x 分岐はすべて `save_count < 2` 必須で match しないため、(c) が無いと resume 不能の deadlock になる）

> 条件を「skip 確定 or 21g 承認済み（+ legacy 証拠）」の**肯定形**で書くのは、`decision == "generate"` のまま 21g 未承認の素通り（連続 1 セッションでオーケストレータが 21e/21f から 15 へ直行するリーク）を塞ぐため。素通しすると「使用グラフィック」節の無い仕様書が Confluence に上がり、21g 反映後に再 save 機構が無いため Confluence↔HTML の乖離が固定される（設計 §3/§9-3）。

以下のファイルを読み込む：
- `artifacts/{app_name}/design-brief.yaml`
- `artifacts/{app_name}/style-guide.md`
- `artifacts/{app_name}/screens/00-screen-list.md`
- `artifacts/{app_name}/screens/00-transition-map.mmd`（SSoT — Confluence の Mermaid macro に CDATA でそのまま埋め込む。`.html` は派生のため Read しない）
- `artifacts/{app_name}/screens/*.md`（存在する画面仕様書を glob で全件列挙。1回目はゼロ件、2回目は全画面分）
- `artifacts/{app_name}/pipeline-state.json`（`confluence.requirements.page_id` / `confluence.design.*` を参照、なければ `{}` で lazy 初期化）

> 旧版では requirements.json から `confluence_project_page_id` 等を読んでいた。本 PR で cross-phase hot state は pipeline-state.json に集約 (memory 設計判断)。

### 保存するページ階層

```
プロジェクトページ（06 で作成済み、page_id は pipeline-state.confluence.requirements.page_id）
└── デザイン
    ├── 01. デザインブリーフ
    ├── 02. スタイルガイド
    ├── 03. 画面一覧
    ├── 04. 画面遷移図
    └── 05. 画面仕様（2回目の実行時に追加される）
        ├── {画面名1}
        ├── {画面名2}
        └── ...
```

> `tokens.json`・`wcag-mapping.json` は内部処理用のため Confluence には保存しない。

---

### Step 1: 親プロジェクトページの確認

`pipeline-state.json` の `confluence.requirements.page_id` (06 で保存済み) を確認する：

- **非 null**: そのページ配下に「デザイン」子ページを作成する
- **null**: AskUserQuestion で「Confluence のプロジェクトページ URL または page ID を教えてください」と確認する
- それでも未回答の場合: Step 3 をスキップし `pipeline-state.json.confluence.design.save_status = "failed"` を記録して次ステップへ進む

---

### Step 2: 「デザイン」親ページを作成する（初回のみ）

`pipeline-state.json` の `confluence.design.page_id` を確認する：

- **非 null**: 既存ページを再利用。作成処理をスキップ。
- **null**: 新規作成する：

```
<Atlassian MCP の実際のツール名>(
  title: "デザイン",
  content: "<p>{app_name} のデザイン成果物一覧</p>",
  parent_id: confluence.requirements.page_id
)
```

→ 作成された page_id を `pipeline-state.json.confluence.design.page_id` に保存する (Read or {} → merge → Write back)。

---

### Step 3: ページを作成または更新する

**処理順（Confluence サイドバー表示順 = 作成順）:**

```
処理順: ["01-design-brief", "02-style-guide", "03-screen-list", "04-transition-map", "05-{画面名}..."]
```

**Markdown → Confluence storage 形式への変換ルール:** `skills/06-confluence-save-req/SKILL.md` と同じルールを適用すること。

**カラー hex の色チップ（01 デザインブリーフ）:** `design-brief.yaml` の `palette` を Confluence の表として描画する際、各 `#RRGGBB` の前に色見本絵文字を付与する（`{chip} #RRGGBB`、例 `🟦 #1D3557`）。`{chip}` は `skills/_shared/color-chip-mapping.md` の決定論マッピングに従う。CSS スウォッチを描画できない Confluence でも色相が一目で分かるようにするため。`style-guide.md`（02）は Step 12 生成時に既にチップ付与済みのため、そのまま変換すればよい。ただしチップ未付与の legacy な `style-guide.md`（本対応より前に生成されたもの）を再保存する場合は、01 と同様に変換時にチップを付与し、同一パッケージ内で 01/02 が不揃いにならないようにする。

各ドキュメントキーについて：

```
existing_id = pipeline-state.json の confluence.design.doc_page_ids[doc_key]
design_parent_page_id = pipeline-state.json の confluence.design.page_id  # Step 2 で保存済み

if existing_id is null:
    page_id = <MCPツール create>(
      title: "{連番}. {ページタイトル}",
      content: {内容をstorage形式に変換},
      parent_id: design_parent_page_id
    )
else:
    page_id = <MCPツール update>(
      page_id: existing_id,
      title: "{連番}. {ページタイトル}",
      content: {内容をstorage形式に変換}
    )
    if update エラーの場合:
        page_id = <MCPツール create>(...)  # 新規作成にフォールバック

pipeline-state.json の confluence.design.doc_page_ids[doc_key] = page_id  # Read or {} → merge → Write back
```

**ページタイトル対応表:**

| 処理順 | doc_key | タイトル | ソースファイル |
|---|---|---|---|
| 1 | 01-design-brief | 01. デザインブリーフ | `design-brief.yaml` |
| 2 | 02-style-guide | 02. スタイルガイド | `style-guide.md` |
| 3 | 03-screen-list | 03. 画面一覧 | `screens/00-screen-list.md` |
| 4 | 04-transition-map | 04. 画面遷移図 | `screens/00-transition-map.mmd` (SSoT) を直接 Read して Mermaid コードブロックとして埋め込み ＋ (FIGMA_MCP_ENABLED=true のとき) FigJam URL を本文先頭に埋め込み (下記詳細) |
| 5〜 | 05-{画面名} | 05. {画面名} 画面仕様 | `screens/{画面名}.md`（1回目はゼロ件、2回目は全件） |

> 画面数が可変のため、05 以降の連番は画面ファイルの数に応じて自動採番する。
> 1 回目の実行では `screens/{画面名}.md` がまだ存在しない（14 時点）ため、05〜はスキップされる。
> 2 回目の実行（21 承認後）で追加される。

**遷移図ページの本文構成（`.mmd` SSoT 化後）:**

`04-transition-map` ページの本文は以下の 2 パートで構成する:

1. **FigJam URL** (FIGMA_MCP_ENABLED=true のときのみ、本文先頭):

   ```html
   <p>📐 <a href="{figma-state.json の nodes.transition_map.url}">FigJam で編集可能な遷移図を開く</a></p>
   <p style="color:#6B7280;font-size:12px;">FigJam は <code>.mmd</code> (SSoT) から派生する read-only な配信物です。編集は議論用で、確定したら 00-transition-map.mmd を修正して Step 14 / 29 を再実行してください。</p>
   ```

2. **Mermaid コードブロック** (常に埋め込み):

   `artifacts/{app_name}/screens/00-transition-map.mmd` を直接 Read し、**`---` 行を separator として split** したうえで (00-transition-figjam-sync Step 1 と同じ規約)、各 flowchart を独立した Confluence Mermaid macro として並べて埋め込む:

   ```html
   <ac:structured-macro ac:name="code"><ac:parameter ac:name="language">mermaid</ac:parameter><ac:plain-text-body><![CDATA[
   {flowchart 1 の内容}
   ]]></ac:plain-text-body></ac:structured-macro>
   <ac:structured-macro ac:name="code"><ac:parameter ac:name="language">mermaid</ac:parameter><ac:plain-text-body><![CDATA[
   {flowchart 2 の内容}
   ]]></ac:plain-text-body></ac:structured-macro>
   ```

   **split は常に必須**: 単一 flowchart の場合 (split 結果 1 件) は macro が 1 つ出力されるだけで、複数 flowchart の場合は macro が複数並ぶ。`---` を Confluence Mermaid macro 内にそのまま渡す形は採用しない — `---` は Mermaid 標準の diagram separator ではなく YAML front matter 用途のため、Confluence Mermaid macro のバージョンによっては `---` 以降がサイレントに無視されたり、パースエラーで空白になるリスクがある (PR #75 r3287137164)。multi-flowchart は subgraph 6 個超過時のレアケースだが、発生した際に Confluence 側だけサイレントに壊れることを防ぐため、単一/複数を問わず同一経路で処理する。

**抽出手順** (FigJam URL 埋め込み):

1. `artifacts/{app_name}/figma-state.json` を Read。ファイルが存在しない、または `nodes.transition_map` が未生成の場合は FigJam URL の埋め込みをスキップ（Mermaid コードブロックのみで保存）
2. `nodes.transition_map.url` を取り出して上記 HTML テンプレートの `{...}` に埋める
3. 1 回目の実行 (14 → 15) でも `nodes.transition_map` は Step 14 の Step 3-Figma で先に作成済みのため、ここでの埋め込みは有効
4. 2 回目以降 (21 承認後 → 15 再実行) も同じロジックで動く

**抽出手順** (Mermaid コードブロック):

1. `artifacts/{app_name}/screens/00-transition-map.mmd` を Read (`.html` から `.mmd` SSoT に切り出し済)
2. **`---` 行を separator として split し flowchart 配列を得る** (00-transition-figjam-sync Step 1 と同じ規約)。単一 flowchart の場合は 1 件配列になる
3. 各 flowchart を独立した `<ac:structured-macro ac:name="code">...<ac:plain-text-body><![CDATA[...]]></ac:plain-text-body></ac:structured-macro>` に CDATA でラップする
4. 全 macro を `.mmd` 内の出現順序を保ったまま遷移図ページ本文に並べて埋め込む (FigJam URL ブロックの後ろ)。**HTML から抜粋する旧ロジックは削除済み**

---

**画面仕様ページへの Figma リンク埋め込み（2回目の実行で必須）:**

各画面仕様ページ（05〜）のコンテンツ末尾に以下を追加する：

```html
<h2>Figma デザイン</h2>
<ul>
  <li><a href="https://www.figma.com/design/{file_key}?node-id={mobile_node_id_url}">Mobile 版を Figma で開く</a></li>
</ul>
```

**node-id 抽出手順** (重要):

1. `artifacts/{app_name}/figma-state.json` を Read して `nodes.screens` 全エントリから **`platform == "mobile"` かつ `state == "default"`** の画面エントリを取得する。
   - キー形式は `mobile/{画面名}` (新形式 / Step 22 以降) を想定。旧形式 `mobile-{画面名}` も存在しうる (legacy)。**キーの命名に頼らず必ず `platform`・`state` フィールドで判定する**。
   - 該当画面のエントリが見つからない場合（mobile を出力しないプロジェクト等）は Figma リンク埋め込みをスキップする。
2. **エントリ形式の正規化**: 値は 2 形式が混在しうる:
   - **新形式** (Step 22 以降): object `{node_id, platform, state, url}`
   - **旧形式** (legacy): string (node-id 直値)

   必ず以下のタイプガードで node-id を抽出する:

   ```js
   const node_id_raw = typeof entry === 'string' ? entry : entry.node_id;
   ```

   raw entry を URL に直接埋め込むと object 形式の場合 `node-id=[object Object]` となりリンクが壊れる
3. URL 用に `:` → `-` 変換: `const mobile_node_id_url = node_id_raw.replace(':', '-');` (例: `"42:2"` → `"42-2"`)
4. `file_key` は同 `figma-state.json` の `file_key` を使用する

> 1 回目の実行時点では Figma 出力（22）はまだ行われていないため、Figma リンクの埋め込みは 2 回目（21 承認後 → 15 再実行）で初めて有効になる。

---

### Step 4: ステータスを記録する

全ページ処理完了後：

- 全て成功 → `pipeline-state.json` の `confluence.design.save_status = "success"` を保存
- 一部失敗 → `pipeline-state.json` の `confluence.design.save_status = "failed"` を保存（成功分の ID は保存済み）

あわせて実行回を追跡するカウンタを更新する：

```
pipeline-state.json.confluence.design.save_count = (既存値 or 0) + 1
```

---

### フォールバック（MCP 利用不可時）

Atlassian MCP が利用できない場合：

1. 「Confluenceへのデザイン保存をスキップしました。`artifacts/{app_name}/screens/` のファイルを参照してください。」と表示
2. `pipeline-state.json` の `confluence.design.save_status = "failed"` を保存
3. 次ステップへ進む（分岐は下記）

---

## 完了後（実行回による分岐）

`pipeline-state.json.confluence.design.save_count` の値で分岐する：

- **1 回目（`save_count == 1`）:**
  「Confluence にデザイン用ドキュメント（デザインブリーフ・スタイルガイド・画面一覧・画面遷移図）を保存しました。17 全画面 HTML 生成へ進みます。」
  → `skills/17-screen-gen/SKILL.md` を Read して 17 を実行

- **2 回目（`save_count >= 2`）:**
  「Confluence に全画面仕様書（{N}画面分）を追加保存しました。22 Figma 出力へ進みます。」
  → `skills/22-figma-export/SKILL.md` を Read して 22 を実行
