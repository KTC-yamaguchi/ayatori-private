---
name: 25-component-build
description: Phase 3 の Step 25。Step 24 で構築した Primitives Variables（色）を、Step 22 でキャプチャ済みの画面フレームに一括バインドする。ComponentSet 配下のノードは Step 24 でバインド済みのため触らない。
---

# 25 Variables バインド・動作確認

## 役割
24 で構築した Primitives Variables（色）を、22 でキャプチャ済みの画面フレームに
一括バインドする。**Step 24 が ComponentSet (atoms/molecules/organisms) を `figma-state.json.nodes.components.*` に記録済の前提とする** (物理配置場所は variantsArchive / libraryFrame のいずれか、本 step では参照しない)。

**責務分離 (混同禁止):**
- **画面フレーム** (Step 22 でキャプチャした Frame ツリー) には Primitives 色のみバインドする ← 本 step の責務
- **ComponentSet 配下のノード** には Step 24 で Variables (Primitives/Semantic/Component) バインド済 ← 本 step では触らない

## 前提条件
- 24 完了（{app_name}/Primitives コレクション登録済み。スタブモードでは `screens.step24_figma_status = "skipped_stub_mode"` + `step24_completed_at` の記録のみ）
- `skills/00-figma-mode-detect/SKILL.md` の判定で `mode == "enabled"`（`disabled` の場合は下記「Step 0」のスタブ手順のみ実行）
- 以下は enabled mode のみの前提:
  - **Step 24 完了時に `figma-state.json.nodes.components.{atoms,molecules,organisms}` が埋まっている** (物理配置場所は問わない)
  - キャプチャ済み画面フレームが Figma ページ上に存在する
  - `figma-state.json` に `nodes.screens` の node-id が記録済み

---

## エージェントプロンプト

**あなたはデザインシステムエンジニアです。**

Primitives の色変数を、キャプチャ済み画面フレームの全ノード（fills / strokes）に
一括バインドします。

### Step 0: Figma mode 判定 (最初に必ず実行)

> **Mode 判定は `skills/00-figma-mode-detect/SKILL.md` で一元化されている。** 独自の env var チェックは行わず、本スキルを呼び出して結果を取得する。

Read and execute `skills/00-figma-mode-detect/SKILL.md` to resolve `mode`:
- `mode == "enabled"`: Step A へ進む
- `mode == "disabled"`: 下記スタブ手順のみ実行して Step 25a へ進む (**Step A〜E は実行しない**)

#### スタブ手順 (`mode == "disabled"` の場合)

Step 22 の `skipped_stub_mode` / Step 24 Step -1 と同型。本 step の作業対象 (キャプチャ済み画面フレーム + Primitives Variables) は Figma MCP 必須のため、disabled 環境ではバインド対象が存在しない。skip した旨の記録と完了タイムスタンプの書き込みだけを行う — **これを省略すると `step25_completed_at` が立たず、`phases/screens/SKILL.md` の resume 規則が Step 25 で恒久スタックして Step 25a (sub-state 要否ヒアリング) に到達できない**。

1. `artifacts/{app_name}/pipeline-state.json` を Read (or init stub) し、以下を merge して Write back:
   - `screens.step25_figma_status = "skipped_stub_mode"` (skip した旨の記録、`schemas/pipeline-state.schema.json` 準拠)
   - `screens.step25_completed_at = {ISO 8601 現在時刻}`
2. `figma-state.json` は **作成・更新しない** (disabled 時はファイルが存在しないのが原則。REVERSE_ENGINEERED bootstrap 等の別経路で既に存在する場合もあるが、その場合も本 step は触らない)
3. ユーザーへ表示: 「スタブモードのため Step 25 (Variables バインド) を skip しました。25a (sub-state パターン要否ヒアリング) へ進みます。」
4. → `skills/25a-state-pattern-plan/SKILL.md` を Read して実行

### Step A: 色マッピング作成

`tokens.json` の `global.color.*` を読み込み、各キー `K` の hex 値を Figma 変数名 `color/{K}` にマッピングする。

- **dual-mode (D1-a)**: 各 token は `modes.dark.$value` + `modes.light.$value` の対称 nested 構造。両 mode を別 mapping として保持し、Figma の Dark / Light モードに対応させる。
  ```
  colorMapping = { dark: {}, light: {} }
  for each [K, token] in tokens.global.color:
    if token.modes && token.modes.dark && token.modes.light:
      colorMapping.dark[K]  = token.modes.dark.$value
      colorMapping.light[K] = token.modes.light.$value
    else:
      // theme-agnostic (rare): 両 mode に同 hex を入れる
      colorMapping.dark[K] = colorMapping.light[K] = token.$value
  ```
- **single-mode (legacy)**: 各 token は `$value` を直接持つ flat 構造。従来通り `colorMapping[K] = token.$value`。
- dual-mode 判定: いずれかの color token に `modes.dark` + `modes.light` 構造が存在すれば dual-mode。Step 24 sync-figma-tokens (refs/sync-figma-tokens.md) の Step 1a の dual-mode 検出と同一ロジック。

- リネーム禁止: `tokens.json` のキーをそのまま使用（例: `background` → `color/background`、省略禁止）
- `tokens.json` を唯一のソース・オブ・トゥルースとする
- 12（`refs/generate-tokens.md`）および 24 の命名規則と揃える

### Step B: 全画面フレームに色バインドを一括適用

`figma-state.json` の `nodes.screens` に記録された node-id を対象に、
`use_figma` で以下を実行する。

> **node-id 抽出ルール** (重要): `nodes.screens.{key}` の値は **2 形式が混在** する。必ずタイプガードで抽出してから `figma.getNodeByIdAsync` 等に渡すこと。
> - **新形式** (Step 22 以降): object `{node_id, platform, state, url}`
> - **旧形式** (legacy): string (node-id 直値)
>
> ```js
> const node_id = typeof entry === 'string' ? entry : entry.node_id;
> const node = await figma.getNodeByIdAsync(node_id);
> ```
>
> raw entry を直接 `getNodeByIdAsync` に渡すと object 形式の場合 `null` が返り、走査が空振りする。

1. 各フレームの全子ノードを `findAll` で走査
2. SOLID fills / strokes の hex 値を Step A のマッピングと照合
3. 一致したら `figma.variables.setBoundVariableForPaint()` でバインド
4. バインド件数（fills / strokes 別）を記録して返す

### Step C: 伝播テスト

Primitives の `color/background`（`tokens.json` の先頭キー）を仮の色（例: `#FF0000`）に変更し、
キャプチャ済み全画面の該当色が連動して変わることを `get_screenshot` で確認する。
確認後、元の値に戻す。

### Step D: figma-state.json 更新

```json
"variables": {
  "bind_status": "success",
  "bound_fills": {件数},
  "bound_strokes": {件数},
  "bound_at": "{今日の日付}"
}
```

### Step E: pipeline-state.json 更新 (必須)

`artifacts/{app_name}/pipeline-state.json` を Read (or init stub) し、`screens.step25_completed_at = {ISO 8601 現在時刻}` を merge して Write back する。**これを省略すると `phases/screens/SKILL.md` の resume 規則が Step 25 完了を検知できず、Step 25a に進めない** (`step25_completed_at` set が Step 25a への遷移条件)。

---

## 完了後

「Variables バインドが完了しました。25a（sub-state パターン要否ヒアリング）へ進みます。」
→ `skills/25a-state-pattern-plan/SKILL.md` を Read して実行

(Phase 3 は二段階完了モデル: Step 25 の後は Step 26 ではなく **Step 25a** に自然遷移する — `phases/screens/SKILL.md` Step 25 の遷移規則参照。Step 26 retro は Phase 4 `/ayatori-retro` で別会話として起動される。スタブモード時は Step 0 のスタブ手順内で skip 記録・完了メッセージ・Step 25a への遷移まで完結するため、本セクションは enabled mode 専用。)
