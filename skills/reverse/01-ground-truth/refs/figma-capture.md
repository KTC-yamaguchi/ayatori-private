# reverse Step 01 sub-module: Figma Capture (証拠アーカイブ)

Step 01 の A3 から Read される手順書。ユーザー指定の Figma URL から frame 単位の証拠
(design context + screenshot + variables) を capture し、`ground-truth/figma/` に
**再監査可能な形でアーカイブ**する。

**Live MCP 読みは本 sub-module のみ** — 下流 (Step 02 解析 / Step 03 provenance ref / Step 05 監査 /
Step 06 tokens 導出) はアーカイブされたファイルだけを読む。これにより provenance の `source_ref` が
ディスク上の安定した参照先を持ち、再実行・再監査が可能になる。

## 実行条件 / 冪等

- `source-inventory.json` の `sources.figma.present == true` かつ `mcp_enabled == true` のときのみ実行。
  `mcp_enabled == false` なら self-skip (Preamble が inventory 確定時に案内済み)。
- **冪等** (済み判定の基準は A0 と同一): inventory の全 `file_keys` について、`figma-manifest.json` の
  `frames[].node_id` が **確定 capture セット (`.capture-scope-{file_key}.json` の `node_ids`) を全て含む**
  ことを確認し、満たしていれば skip (確定セット不在の file_key は frames 1 件以上で済みとみなす)。
  満たさない file_key / 不足 node のみ **差分 capture** する (既存アーカイブは touch しない) —
  新 URL による file_key 追加も、F1.5 の union 更新で同一 file_key 内のスコープが広がった場合も
  この同じ判定で差分になる。manifest の存在だけでは済みとみなさない。

## アーカイブレイアウト

```
artifacts/{app_name}/ground-truth/figma/
├── figma-manifest.json                                  # capture インベントリ (schemas/figma-manifest.schema.json)
├── .enumeration-{file_key}.json                         # F1 列挙の構造化 dump (file 全体 URL のときのみ)
├── .clustering-{file_key}.json                          # F1.5 クラスタリング結果 (代表/変形/残骸の分類)
└── {file_key}/
    ├── {node-id}--{frame-slug}.png                      # frame レンダリング (視覚的証拠)
    ├── {node-id}--{frame-slug}.design-context.md        # get_design_context 原文 (構造・スタイルの :line 引用タゲット)
    └── variables.json                                   # get_variable_defs 結果 (best-effort。Step 06 の tokens 導出用)
```

命名規則:
- `{node-id}` = Figma node ID の `:` を `-` に置換 (例: `1:23` → `1-23`)。ファイル名に node 同一性を埋め込み、
  provenance ref だけで元 frame を特定できるようにする。
- `{frame-slug}` = frame 名を sanitize (lowercase / 空白→ハイフン / 特殊文字除去)。

**アーカイブ 3 種はすべて下流の引用先になる** (`figma_backed` の `source_ref`):
`design-context.md:line` (構造・文言) / `variables.json:line` (デザイントークン値) / `.png` (視覚のみ)。
`variables.json` は 1 行 1 トークンキーで書き出す (行アンカーで個別トークンを引用できるようにするため)。
加えて `figma-manifest.json:line` も引用先になる — `enumerated_not_captured` の変形名
(例: `スポット詳細_公開中` / `_非公開` / `_申請中`) は「その状態が存在する」ことの figma_backed 証拠として
引用できる (視覚・構造の中身の主張には capture 済み証拠が別途必要)。

## 手順

### F1: capture 対象 frame の確定

inventory の `urls` を file_key ごとに整理する:

- URL に `node-id` クエリが含まれる → その node (frame) のみ capture 対象 (列挙・クラスタリングは走らせない)。
- URL が file 全体 (node-id なし) → subagent が `get_metadata` で top-level ノードを列挙する。
  **列挙対象は frame に限らない** — 画面を component (symbol) として authoring するファイルがあるため、
  「frame または component で画面サイズ相当 (概ね幅 360〜1600 かつ高さ ≥600) のノード」を画面候補とする。
  subagent は列挙結果 (全候補の node_id / name / type / width / height / page) を
  `ground-truth/figma/.enumeration-{file_key}.json` に構造化 JSON で Write し、件数サマリのみ return する
  (候補一覧を main context に流さない)。

### F1.5: クラスタリング + 範囲確定ゲート (file 全体 URL のときのみ)

実プロダクトの Figma file は画面サイズ級ノードを数百件持つが、大半は状態変形 (`_公開中`/`_非公開`)・
プラットフォーム変形 (`_pc`/`_sp`)・連番ページ (`_1`〜`_7`)・明示的残骸 (`bak_*`)・自動命名コンテナ
(`Frame 1234`) であり、リバース要件生成に必要なのは **固有画面 1 回ずつ + 変形の存在記録**。
全変形の full capture は design-context コスト (数千 token × 数分/frame) を増やすだけで証拠価値が増えない
— 変形の**名前**自体が「その状態が存在する」証拠になる (manifest 経由で引用可、下記 F3)。

1. main が列挙直後に実行する:
   `node scripts/cluster-figma-candidates.mjs {app_name}`
   — 同名 dedup / 残骸・自動命名の分離 / 命名クラスタリング (画面 ID prefix `R-10-2` 優先 →
   名前 prefix) / 代表選定 (frame 優先・面積最大) を決定論で行い、
   `.clustering-{file_key}.json` と提案表 (stdout) を出す。LLM 呼び出しなし・追加コスト実質ゼロ。
2. **範囲確定ゲート (AskUserQuestion 1 回)**: 提案表の数字 (代表 N 件 / 畳んだ変形 M 件 /
   自動命名 K 件 / 残骸 D 件) と **予想所要** (≈ 2〜3 分/frame、並列 batch で短縮) を提示し、
   capture セットを確定する。既定案 = **代表セットのみ**。選択肢に含める:
   - 代表セットのみ (推奨 — 件数 + 予想所要を併記)
   - 代表 + 自動命名の大型ノードも含める (自動命名は「名前を付けていない実画面」の可能性があるため、
     **黙って捨てず opt-in で提示する**のが必須 — 提案表に面積上位が出る)
   - 手動調整 (ファミリ単位で追加/除外。畳んだ変形の実物が必要なら node_id 指定で個別追加)
   - 段階案: 核心ファミリだけ先に capture し、残りは後で差分 capture (冪等なので安全)
3. 確定したセットを F2 の capture 対象にし、**確定 node_id を
   `ground-truth/figma/.capture-scope-{file_key}.json` に Write する**
   (`{ "file_key": "...", "node_ids": [...] }`)。`.clustering-{file_key}.json` もディスクに残す —
   F3 の manifest 組み立てが両方を読み、「頼んでいない (out_of_scope)」と「頼んだのに証拠が無い
   (capture_failed)」を区別する。確定セットを残さないと script は両者を区別できず、収集失敗を
   「人間が意図して外した」として記録してしまう。差分 capture で範囲を広げたときは本ファイルも
   更新する (union)。

クラスタリングの限界に注意: 名前 prefix ヒューリスティックは過剰結合しうる (別画面が同ファミリに
畳まれる)。ゲートで提示する表は「代表がどの変形を畳んだか」を明示するので、疑わしいファミリは
手動調整で分割する。判断に迷う場合は capture に倒す (増える分は差分 capture で安全に足せる)。

### F2: subagent 起動 (batch 分割)

`ayatori-figma-ground-truth-collector` subagent を **batch 単位で並列起動**する (Agent tool。
agent 定義が `model: haiku` を pin — capture は転写作業のため)。**capture 実行は全て
subagent 内** — verbose な Figma MCP 応答 (design context / metadata) を main context に入れない。

- **1 batch = 3 frame 以下** (要素の多い詳細画面は 1〜2)。design context は 1 frame あたり数千〜
  1.5 万 token 級で、これを超える batch は subagent の context を使い切って停止する。
- 各 batch は共有ファイル (manifest) に書かず **fragment** (`.batch{N}-frames.json`) だけを書く —
  並列の Read→merge→Write back は互いの更新を失うため。
- frame 名の復元は `.enumeration-{file_key}.json` / `.clustering-{file_key}.json` が担う
  (manifest 組み立てが両方を読む) — batch が name を返さず終了しても名前は失われない。
  node-id 直指定 (列挙なし) の capture では batch fragment の `frames[].name` が唯一の名前源。

Input (main → subagent、batch ごと):

```
repo_root: {絶対パス}
app_name: {app_name}
batch_id: {N}
output_dir: {repo_root}/artifacts/{app_name}/ground-truth/figma/
targets:
  - file_key: {key}
    url: {元 URL}
    node_ids: [{node-id}, ...]   # 本 batch の担当分 (≤3)。空 = 列挙のみ (F1 — .enumeration-{file_key}.json に Write)
```

Return (subagent → main、short summary のみ):

```
captured: {file_key ごとの frame 件数}
variables: {file_key ごとの有無}
fragment: ground-truth/figma/.batch{N}-frames.json
warnings: [...]                  # 取得失敗 frame / variables 未対応 等
```

### F3: manifest 組み立て + 完了検証 (main)

1. 全 batch 完了後、main が実行する:
   `node scripts/build-figma-manifest.mjs {app_name}`
   — ディスク上のアーカイブ実体 (design-context.md / .png / variables.json) と fragment (frame 名) と
   `.enumeration-*` / `.clustering-*` (名前・ファミリ・未 capture 記録) から `figma-manifest.json` を
   決定論で組み立てる (node_id で突合)。手書き・subagent による直接更新は禁止。
   列挙済みで capture しなかったノードは `enumerated_not_captured` (node_id / name / family / reason)
   として manifest に残る — **下流は「アーカイブに無い」を「画面が存在しない」と解釈してはならない**
   (文書 index の「範囲外 (未収集)」と同じ思想)。実物が必要になったら node_id 指定の差分 capture で足す。
2. script の出力サマリ (frames / without screenshot / without design-context / without name /
   enumerated-not-captured) を確認し、欠損 frame は該当 batch のみ再起動する (差分 capture → script 再実行)。
   screenshot のみで design-context が無い frame は「視覚証拠のみ」として有効 (canvas 型ノード等で
   design-context が取得できないケースは正常系)。
2.5. **転写忠実度の機械検査 (必須・backstop)** — worker の「verbatim 完了」自己申告は検証せずに信用しない。
   worker は Phase 2 の自己機械検査 (collector agent 定義参照) で書き出し直後に同じ検査を行い
   その場で復元するのが第一防衛線 — 本検査はその漏れを拾う backstop であり、発火 = worker 側の
   自己検査が機能しなかったシグナルとして warning に残す。main が全 design-context ファイルに対して
   機械検査を行う:
   検査対象はアーカイブ実体のパスを明示して指定する (カレントディレクトリ依存の裸 glob では
   1 件も走査されず、「検出なし」と区別がつかないまま通過する):
   - 要約プレースホルダ語句の検出:
     `grep -rl -i -E "omitted|preserved in|truncated|for brevity|Large code output" artifacts/{app_name}/ground-truth/figma/`
   - 本文実体の検出: 同ディレクトリ配下の `*.design-context.md` のうち `data-node-id` の出現 0 件の
     ファイルを列挙 (verbatim な design context はコード本文に data-node-id 属性を含む)
   - **走査したファイル数を必ず併記する** (`ls artifacts/{app_name}/ground-truth/figma/*/*.design-context.md | wc -l`)
     — 0 件走査を「汚染 0 件」と読み替えないため。
   要約汚染と判定したファイルは該当 frame のみ再 capture する (repair batch — prompt に
   「省略・要約・placeholder 禁止 / spill ファイルからの script 抽出を第一選択」を明記)。
   ⚠️ 検査語は design context 本文に正常に現れうる一般語のため、**判定は再 capture の起動条件に留め、
   ファイルを削除しない** (`data-node-id` 0 件も canvas 型ノードでは正常系 — screenshot-only 候補として扱う)。
   PNG の実体検査も同時に行う: 5 KB 未満の PNG は 1x1 空レンダー等の不良の可能性 —
   `node -e` で先頭 8 byte の PNG シグネチャとサイズを確認し (`file` コマンドは
   `.claude/settings.json` の許可対象外で runtime prompt に依存するため使わない)、
   再 export しても空なら削除して screenshot: null に倒す (誤解を招く偽視覚証拠を残さない)。
3. `ground-truth/figma/figma-manifest.json` を Read し、schema (`schemas/figma-manifest.schema.json`)
   の必須 field と、targets の全 file_key がエントリされていることを確認する。

## 制約

- **READ 方向専用** — Figma への書き込み (generate_figma_design / use_figma) は一切行わない。
  Phase 3 の `figma-state.json` / `figma-capture-runner` (書き込み方向) とは無関係で、触らない。
- PNG の保存は `download_assets` が返す一時 URL を `node scripts/download-figma-asset.mjs <url> <path>`
  でダウンロードする (Node 内蔵 fetch。外部 CLI 不要 — Operating Principle 1 準拠)。
- **asset URL は使い捨て** — リクエストごとに再発行され短期で失効する。取得したら即ダウンロードする。
  「再取得して完全一致するか」による検証は成立しない (URL 文字列の不一致は破損の証拠ではない)。
- **転写の忠実度** = 「原文 verbatim + 段落境界の空白のみ正規化」。応答がツールの spill ファイルと
  してディスクに残った場合は手写しせず script 抽出で組み立てる (byte-exact)。手写しする場合は
  機械照合 (構造トークンの個数・順序 / 行数・バイト量) が必須 — 手順は collector agent 定義を参照。
- subagent の必要権限 (`Bash(node:*)` / `Bash(mkdir:*)` / `Write(./artifacts/**)`) は
  `.claude/settings.json` で宣言済み (Operating Principle 2)。
