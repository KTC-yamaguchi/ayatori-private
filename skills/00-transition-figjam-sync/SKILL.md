---
name: 00-transition-figjam-sync
description: screens/00-transition-map.mmd（純 Mermaid テキスト）を SSoT として FigJam へ単方向反映する共通プロトコル。FIGMA_MCP_ENABLED == true のとき、greenfield（Step 14）と delta（Step 29）の両方から呼ばれる。
---

# 00 遷移図 FigJam 同期プロトコル (共通)

## 役割

`artifacts/{app_name}/screens/00-transition-map.mmd` (純 Mermaid テキスト) を **SSoT (Single Source of Truth)** として、**FigJam に単方向反映** する共通プロトコル。greenfield (Step 14) と delta (Step 29) の両方から呼ばれる。

**SSoT 原則**:
- `.mmd` の Mermaid テキストが唯一の真実 (HTML 内 embedded から独立 `.mmd` に切り出し済)
- `.html` (template + `.mmd` で機械的に生成された派生物) と FigJam は両方とも SSoT (`.mmd`) から派生する read-only な配信物
- データフローは **単方向 (`.mmd` → FigJam / `.mmd` → `.html`)**。FigJam → `.mmd` や HTML → `.mmd` の回写経路は提供しない
- 複数 writer (Step 14 / Step 29) が独自に generate_diagram を叩く形は禁止 — 必ず本 skill 経由 (single writer 経路の強制)

Step 12 (design-system) と同じパターンで `00-` prefix 共通プロトコルとして実装。

---

## 適用条件

- 環境変数 `FIGMA_MCP_ENABLED == "true"`
- 呼び出し元が `artifacts/{app_name}/screens/00-transition-map.mmd` を生成 / 修正した直後
- `FIGMA_MCP_ENABLED != "true"` の場合は本 skill 全体をスキップし、`.mmd` + `.html` のみで運用する

---

## 入力

呼び出し元から以下を受け取る:

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `app_name` | string | ✅ | プロジェクト識別子 (artifacts/{app_name}/ と一致) |
| `mmd_path` | string | ✅ | `artifacts/{app_name}/screens/00-transition-map.mmd` (既存ファイル、Pure Mermaid) |
| `mode` | "create" \| "delta" | ✅ | `"create"` = greenfield (Step 14), `"delta"` = 部分修正 (Step 29) |
| `existing_file_key` | string \| null | mode="delta" 時のみ | `figma-state.json.nodes.transition_map.file_key` から取得 |
| `existing_node_id` | string \| null | optional (mode="delta" 時に呼び出し元が保持していれば渡してよい) | `figma-state.json.nodes.transition_map.node_id` から取得した値。**現状の Step 3 は page 全 node を full-clear するため本 skill の手順内では未参照**。呼び出し元との互換 / ログ目的で受け取り口だけ残している。渡さなくても (null でも) 動作に差は無い (PR #75 review) |

---

## 手順 (7 ステップ)

### Step 1: .mmd ファイルから Mermaid を読み込み

`mmd_path` を Read し、内容を取得する。`.mmd` は SSoT (純 Mermaid テキスト) なので、HTML 抽出ロジック (正規表現等) は不要。

**図分割の扱い**: 1 つの `.mmd` 内に複数 `flowchart` が **`---` 区切りで連結** されている場合は分割して配列で扱い、各 `flowchart` を独立した呼び出しとして generate_diagram に流す (`generate_diagram` は 1 呼び出し = 1 flowchart のため)。`---` 行を separator として split すれば良い。

---

### Step 2: 翻訳は不要 — `.mmd` をそのまま使う

現行記法への統一以降、`.mmd` (SSoT) は **既に `generate_diagram` 互換形式** で書かれている (`classDef` + `:::class` ではなく、ノード単位 `style` + 形状記法 `([])`/`[\\]`)。HTML 表示と FigJam 表示の見た目を一致させるため、本 skill での翻訳ロジックは廃止。

Step 1 で読み込んだ `.mmd` 内容をそのまま Step 5 の `generate_diagram` に渡す。

**`.mmd` が満たすべき形式** (Step 14 / 29 の Mermaid 生成ガイド側で担保):

- ELK init ディレクティブ (`%%{init: ...}%%`): 含めて OK (Mermaid.js / generate_diagram の両方で扱える)
- `classDef` / `:::class` 記法: **使わない**。ノード単位の `style {id} fill:...,stroke:...` で表現する
- ノード ID: camelCase 推奨 (`scrInput`、`mdlDelete` 等)
- 形状:
  - 画面 = `scrInput[コード入力画面]` (rectangle)
  - モーダル = `mdlDelete([削除確認ダイアログ])` (stadium、pill 表現)
  - 外部 = `extShare[\OS シェアシート\]` (trapezoid)
  - 開始 = `start([アプリ起動])` (stadium、`style start fill:#D1FAE5,stroke:#10B981` で緑色)
- subgraph: `subgraph input [コード入力] ... end` + `style input fill:#FFEDD5` で tint 指定
- `\n` 含むラベル: 半角スペースに置換
- 特殊文字 (`:`, `(`, `)` 等) を含むラベル: quotes で囲む (例: `-->|"BottomNav: テンプレート"|`)

**subgraph の `fill` 文の扱い**:
- Mermaid.js (HTML 描画) では `style input fill:#FFEDD5` が反映される
- `generate_diagram` (FigJam) では `fill` 文が無視される (FigJam section のデフォルト色になる)
- → Step 6 で `use_figma` 後追い塗装で対応

---

### Step 3 (mode="delta" のみ): 旧 diagram を FigJam から全削除 (page full-clear)

`mode == "create"` の場合はスキップ。

`mode == "delta"` の場合:

1. Skill tool で `figma:figma-use-figjam` をロード (use_figma の MANDATORY prerequisite。リポジトリには本 skill は存在せず、figma plugin が提供する)
2. `mcp__figma__use_figma` を呼ぶ — **page 上の全 node を無条件削除** (full-clear):

```javascript
(async () => {
  // 遷移図 FigJam は create 時に generate_diagram が専用新規ファイルとして作る (Step 5-B)。
  // = このページには本プロジェクトの遷移図しか無い。よって page 全 node を消して再生成すれば
  //   section 名 (= subgraph ラベル) に依存せず確実に clean-overwrite できる。
  const children = [...figma.currentPage.children];
  let removed = 0;
  const failed = [];
  for (const n of children) {
    try { n.remove(); removed++; }
    catch (e) { failed.push({ id: n.id, type: n.type, error: String(e) }); }
  }
  const summary = { total: children.length, removed, failed };
  // 削除に失敗した node が 1 つでもあれば旧図が残存し「重複」を再発させ得るため warning を残す
  console.log("[figjam-full-clear]", JSON.stringify(summary));
  figma.closePlugin(
    `full-clear: removed ${removed}/${children.length}` +
    (failed.length ? ` (WARNING: ${failed.length} 件削除失敗・旧図残存リスク)` : "")
  );
  return summary;
})();
```

- 引数: `fileKey: <existing_file_key>`, `code: 上記コード`, `skillNames: "figma-use-figjam"`
- 削除は同期 API (`node.remove()`) で完結するため、非同期制約 (loadFontAsync 等) に抵触しない
- **削除結果の確認**: 上記コードは削除/失敗件数を `summary` (`{total, removed, failed}`) として `console.log` + `closePlugin` メッセージに出す。`use_figma` は return value を main session に返さないことがある (`Code executed with no return value`) が、`figma.closePlugin(...)` のメッセージは表示されるため件数を確認できる。**`failed.length > 0` (= `removed < total`) を検出した場合は旧 node が残存し本修正の意図 (重複防止) と逆行するため、`feedback-log.md` に Pattern C として記録し**、再生成 (Step 5) は続行しつつ呼び出し元に「旧図が一部残存している可能性」を報告する (full-clear が全消去できなかったケースの可視化)
- **なぜ name match でなく full-clear か**: `generate_diagram` は **subgraph ラベルを FigJam SECTION 名にする** (diagram の `name` 引数は SECTION 名にならない) ため、「`{app_name} 画面遷移図` 名の SECTION を消す」方式は **削除キーが実在せず空振り → 旧図残存 + 新図追加 = 重複** する (実際に発生した事故)。加えて start (`start([アプリ起動])`) / modal (`mdlDelete([…])`) / external (`extShare[\…\]`) 等の loose ノードと connector は page root に散在し `type==='SECTION'` フィルタの対象外で取りこぼす。遷移図ファイルは専用 (create で新規作成) なので、**page 全 node を無条件で消す full-clear** が最も単純かつ確実。section 名・loose ノード・複数 flowchart・旧形式 (外枠なし / 旧 classDef) の `.mmd` 由来の図、いずれも区別なく一掃でき、レガシー図の初回 delta でも重複が残らない。
- これにより `<existing_file_key>` 内の旧 diagram (全 node) がすべて削除され、新 diagram を同じファイル内に clean に追加できる

**前提と安全性**: full-clear が安全なのは「遷移図 FigJam ファイルが本プロジェクトの遷移図専用」であることに依存する (create-mode の `generate_diagram` が新規ファイルを作るため成立)。**将来この前提を崩す変更 (例: 既存の共有ボードに `fileKey` 指定で遷移図を相乗りさせる) を入れる場合は本 Step を見直すこと**。なお、その専用ボードに人が手で足した注記は full-clear で消えるが、`.mmd` が SSoT で FigJam は派生 (再生成可) なので許容する。履歴を見たいなら `git log artifacts/{app_name}/screens/00-transition-map.mmd`。

---

### Step 4: figma:figma-generate-diagram skill をロード

`mcp__figma__generate_diagram` の MANDATORY prerequisite。Skill tool で `figma:figma-generate-diagram` をロード。

---

### Step 5: generate_diagram を呼び出し

#### 5-A. ベース引数

```
name: "{app_name} 画面遷移図"
mermaidSyntax: <Step 1 で読み込んだ .mmd の中身そのまま>
userIntent: "AYATORI パイプライン Step {14 or 29} から、SSoT (00-transition-map.mmd) を FigJam に同期"
planKey: <pipeline.yaml の figma.plan_key を読み取り (env FIGMA_PLAN_KEY が設定されていればそちらを優先)>
```

`planKey` は skill にハードコードしない (PR #75 review)。解決順序:

1. 環境変数 `FIGMA_PLAN_KEY` が設定されていればその値を使う (`bash -lc 'echo "$FIGMA_PLAN_KEY"'` で取得)
2. 未設定の場合は `pipeline.yaml` の `figma.plan_key` を Read して使う
3. どちらも空であれば `generate_diagram` 呼び出しを中止し、`feedback-log.md` に Pattern C として記録した上で本 skill 全体をスキップ (FigJam 同期は次回まで延期)

`.mmd` は `generate_diagram` 互換形式に統一されているため、翻訳・変換不要。Step 1 の Read 結果をそのまま `mermaidSyntax` に渡す。複数 flowchart (`---` 区切り) の場合は split して各 flowchart ごとに本 step を実行。

#### 5-B. mode 別の追加引数

- `mode == "create"`: `fileKey` は **指定しない** (新規ファイルが作成される)
- `mode == "delta"`: `fileKey: <existing_file_key>` を指定 (Step 3 で旧 diagram を削除済みなので、新 diagram が clean に追加される)

#### 5-C. レイアウト最適化は Step 14 / 29 の責務

記法統一以降、本 skill は `.mmd` を **そのまま** `generate_diagram` に渡すだけ。レイアウト判断 (`flowchart TD` vs `LR`、bidirectional `<-->` 集約、ノード形状選択 等) は `.mmd` を書く Step 14 / 29 側の責務 (Step 14 SKILL.md の「Mermaid 生成ガイド」参照)。

#### 5-D. 戻り値

```json
{
  "diagramId": "...",
  "name": "...",
  "claimFileUrl": "https://www.figma.com/board/{file_key}?…"
}
```

`claimFileUrl` から `file_key` を URL パスから抽出 (例: `https://www.figma.com/board/jvTwZzBwoJ1Nmde1KDb3Uk` → `file_key = "jvTwZzBwoJ1Nmde1KDb3Uk"`)。

`node_id` (生成された diagram の親 section / shape の ID) は Step 7 で `get_figjam` で取得する。

---

### Step 6: tint hybrid 後追い塗装

AYATORI の業務単位グルーピング (subgraph tint) を FigJam に反映するため、`use_figma` で各 section の `fills` を後追い設定する。

#### 6-A. 前準備 (.mmd の subgraph_id ↔ FigJam section.id の突合)

PR #75 review: `.mmd` の `style {subgraph_id} fill:#XXX` から色は取れるが、`{subgraph_id}` は Mermaid 内部の識別子で FigJam 上の `section.id` ("X:Y" 形式) とは別物。`generate_diagram` は subgraph の `[label]` 部分 (人間可読の表示名) を FigJam section の `name` に設定するため、**突合キーは label と section.name の完全一致** となる。

##### 6-A-1: FigJam 側 (section.id, section.name) マップ取得

`mcp__figma__get_figjam` で生成された全 section の ID を取得:

```
fileKey: <Step 5 で取得した file_key>
nodeId: "0:1"  # canvas root
```

レスポンスの `<section id="X:Y" name="認証">…</section>` から `(section.id, section.name)` のマップを構築する。

##### 6-A-2: .mmd 側 (subgraph_id, label, fill_hex) マップ取得

Step 1 で読み込んだ `.mmd` テキストを行単位で走査し、各 subgraph について以下を抽出する:

- `subgraph {subgraph_id} [{label}]` 行 → `(subgraph_id, label)` のペア
- `style {subgraph_id} fill:#{XXXXXX}` 行 → `(subgraph_id, fill_hex)` のペア

例 `.mmd` 抜粋:
```
subgraph input [コード入力]
  scrInput[コード入力画面]
end
style input fill:#FFEDD5
```
→ `{subgraph_id: "input", label: "コード入力", fill_hex: "#FFEDD5"}`

##### 6-A-3: subgraph → FigJam section の突合

`.mmd` の各 `{subgraph_id, label, fill_hex}` について、6-A-1 で得た FigJam section マップから `section.name === label` を満たす entry を探す:

1. マッチした場合: `(section.id, fill_hex)` のペアを作り 6-B で hex 変換 → 6-C の `tints[]` に渡す
2. ラベル衝突 (同 label の subgraph が `.mmd` 内に複数): 警告ログを出し、最初に出現した section のみ塗装する。Step 14 / 29 で `.mmd` 生成時に label を unique にすることで担保される
3. マッチしない (FigJam 側に対応する name の section がない、`generate_diagram` が一部 subgraph をスキップした等): 警告ログのみ出し、tint 塗装はスキップ (section デフォルト色のまま)

#### 6-B. AYATORI tint パレット → FigJam section palette マッピング

FigJam の section 色は固定 palette のみが「palette match」と認識される (custom 扱いになると UI 上の swatch クリック不可)。AYATORI の 7 色を近似マッピング:

| AYATORI tint | hex | FigJam palette | hex | h() 引数 |
|---|---|---|---|---|
| peach | #FFEDD5 | Light orange | #FFF7F0 | `h(0xff, 0xf7, 0xf0)` |
| sky | #DBEAFE | Light blue | #F5FBFF | `h(0xf5, 0xfb, 0xff)` |
| sage | #DCFCE7 | Light green | #EBFFEE | `h(0xeb, 0xff, 0xee)` |
| lavender | #EDE9FE | Light violet | #F8F5FF | `h(0xf8, 0xf5, 0xff)` |
| rose | #FCE7F3 | Light pink | #FFF0FA | `h(0xff, 0xf0, 0xfa)` |
| mint | #CCFBF1 | Light teal | #F1FEFD | `h(0xf1, 0xfe, 0xfd)` |
| gray | #F3F4F6 | Light gray | #F9F9F9 | `h(0xf9, 0xf9, 0xf9)` |

6-A-2 で `.mmd` から抽出した `fill_hex` を本表で FigJam palette hex に変換し、6-A-3 で対応付けた `section.id` と組合せて 6-C の `tints[]` に渡す (HTML は派生物のため解析対象にしない)。

#### 6-C. use_figma 呼び出し

Skill tool で `figma:figma-use-figjam` をロード (前 Step 3 で読み込み済みなら不要だが安全のため再度ロード推奨)。

```javascript
(async () => {
  const h = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 });
  const tints = [
    { id: '<section_id_1>', fill: h(0xff, 0xf7, 0xf0) }, // peach → Light orange
    { id: '<section_id_2>', fill: h(0xf5, 0xfb, 0xff) }, // sky → Light blue
    // ... 全 subgraph 分繰り返し
  ];
  for (const t of tints) {
    const node = await figma.getNodeByIdAsync(t.id);
    if (node && node.type === 'SECTION') {
      node.fills = [{ type: 'SOLID', color: t.fill }];
    }
  }
  figma.closePlugin();
})();
```

引数:
- `fileKey: <Step 5 で取得した file_key>`
- `code: 上記コード`
- `skillNames: "figma-use-figjam"`

注: `use_figma` は return value を main session に返さない場合がある (`Code executed with no return value`)。これは正常で、`node.fills` の変更は実際に適用される。

---

### Step 7: figma-state.json に記録

`artifacts/{app_name}/figma-state.json` の `nodes.transition_map` を更新する。

#### 7-A. 新規 file_key と node_id を取得

`mcp__figma__get_figjam` で全体 (nodeId="0:1") を取得し、**最上位 (canvas 直下) に最初に出現する section または shape の `id`** を代表 node_id として抽出する。`generate_diagram` は subgraph ラベルを SECTION 名にするため固定の section 名で引き当てられない。node_id は「人間が FigJam の該当箇所に飛ぶための代表 id」用途なので、最上位ノードのいずれか 1 つで足りる (full-clear 方式では削除に node_id を使わないため、引き当て精度は不要)。

**最上位ノードが 1 つも見つからない場合 (生成失敗 / 空図 / `get_figjam` 取得失敗)**: 後段「失敗時の挙動」と整合させ、`node_id=""` (空文字) を設定して継続する。FigJam URL (`file_key` 由来) は確定しているため、人間が後から該当ノードに飛ぶ運用は維持できる。node_id 不在を理由にエラー停止させない。

**複数 diagram (`.mmd` 内 `---` 区切りで複数 flowchart) の場合**: schema 上 `node_id` は string 固定のため、**最初に出現した最上位 section / shape の id を 1 つだけ保存** する。他 diagram の id は永続化しないが、後で `get_figjam` を `file_key` 単位で再取得すれば全 node を辿れるため運用上問題ない (代表 id があれば人間が FigJam に飛べる)。

#### 7-B. 書き込みパターン

```python
# Read or {} → merge → Write back パターン
import json, os
from datetime import datetime, timezone

path = f"artifacts/{app_name}/figma-state.json"
data = json.loads(open(path).read()) if os.path.exists(path) else {}
data.setdefault("nodes", {})
data["nodes"]["transition_map"] = {
    "file_key": file_key,
    "node_id": node_id,  # 取得した最上位 node の id
    "url": f"https://www.figma.com/board/{file_key}",
    "generated_at": datetime.now(timezone.utc).isoformat()
}
# その他のキー (file_key, app_name 等) は触らない
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
```

mode="delta" でも同じ書き込みで OK (file_key は不変、node_id は新しいもの、generated_at は最新)。

履歴フィールド (`delta_runs[]` 等) は持たない。SSoT 原則に従い「常に最新版だけ」。

---

## 出力

| 種別 | パス | 内容 |
|---|---|---|
| 副作用 (FigJam) | `https://www.figma.com/board/{file_key}` | tint 塗装済みの遷移図が反映される |
| ファイル更新 | `artifacts/{app_name}/figma-state.json` | `nodes.transition_map = {file_key, node_id, url, generated_at}` |
| 戻り値 (呼び出し元へ) | string (FigJam URL) | 呼び出し元 (Step 14 / Step 29) は URL をユーザーに表示する用途で使う |

---

## 失敗時の挙動

- `generate_diagram` がエラーで返した場合: `figma-state.json.nodes.transition_map` を **更新しない** (旧データを保持)。エラー内容を呼び出し元に報告 + `feedback-log.md` に Pattern C として記録
- `use_figma` (Step 3 or 6) がエラーで返した場合: 該当ステップだけスキップして次に進む (Step 3 失敗時は並列追加状態が残るが、generate_diagram は実行する)。`feedback-log.md` に Pattern C として記録
- `get_figjam` でファイル取得失敗の場合: figma-state.json の `node_id` を空文字に設定して継続 (FigJam URL だけは確定しているので、後で人間が node-id を補足する可能性)

---

## 呼び出し元 (Step 14 / Step 29) からの利用パターン

### Step 14 (greenfield)

```
1. 00-transition-map.mmd を生成・保存 (SSoT)
2. 00-transition-map.html を template + .mmd で機械的に生成 (派生)
3. FIGMA_MCP_ENABLED == "true" なら本 skill を Read してその手順に従い:
   - app_name, mmd_path, mode="create"
4. 戻り値の FigJam URL をユーザーに表示
```

### Step 29 (delta)

```
1. impact-analysis.md の transition_changes があれば 00-transition-map.mmd の Mermaid を部分修正 (SSoT)
2. 00-transition-map.html を template + 更新済み .mmd で再生成 (派生)
3. FIGMA_MCP_ENABLED == "true" かつ figma-state.json.nodes.transition_map.file_key が存在するなら本 skill を Read してその手順に従い:
   - app_name, mmd_path, mode="delta", existing_file_key=<file_key>, existing_node_id=<node_id>
4. file_key が null (過去に FIGMA_MCP_ENABLED=false で生成された旧 artifact) の場合は本 skill 全体をスキップ
5. 戻り値の FigJam URL を Step 7 human approval gate の AskUserQuestion に併記
```

---

## 完了後

呼び出し元の skill (14 or 29) に戻る。本 skill は単方向同期のみを責務とし、それ以外の処理 (画面一覧生成、Confluence 保存、人間ゲート等) は呼び出し元の責務。
