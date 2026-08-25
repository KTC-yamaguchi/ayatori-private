---
name: 12-design-system
description: ⑫ E2E design system generation — tokens.json (W3C DTCG) → style guide → Style Dictionary multi-platform build
---

# E2E Design System

## Overview

End-to-end skill for step ⑫ design system generation.
Runs generate-tokens → (generate-style-guide + build-tokens) in sequence from two input files.

> **Figma 操作について**: Step 12 はコード成果物 (tokens.json / style-guide HTML / 各 platform 用 build/) の生成のみを行う。Figma への書き込み (Variables 3 コレクション = Primitives / Semantic / Component の登録) は **Step 24 (design-system-update)** が担当する。Step 12 では `FIGMA_MCP_ENABLED` による分岐はない (`pipeline.yaml` の `figma.affected_steps` にも Step 12 は含まれていない)。

## Input

| File | Required | Content |
|---|---|---|
| `artifacts/{app_name}/design-brief.yaml` | ✅ | Human-approved design direction, colors, typography, UI constraints (final:v1, filter by `selected_sample_id`)。**dual-theme × domain 拡張**: `cases[selected_sample_id].palette.domain_surfaces[]` (各 entry に `name` / `role` / `driver_tokens[]` / `contrast_pairs[]` / `modes[]`) も tokens.json に展開する |
| `artifacts/{app_name}/wcag-mapping.json` | ✅ | Color-agnostic constraints + criteria (loop invariant from step ⑪、Read only). Per-attempt violations は wcag-history.json 側 |

## Output

`build/` 配下のファイル群は `requirements.json.design_output_scope.platform_combo` / `mobile_framework` / `legacy_android_xml` の組合せで決まる。Flutter / KMP 選択時もネイティブ tokens（Swift + Compose）を必ず併出力する（Platform Channels や iOS Swift UI 用の安全網）。**Android XML（colors.xml / dimens.xml）は legacy opt-in**: `legacy_android_xml == true`（View システムを使うレガシー案件）のときのみ出力し、欠落 / `false` では生成しない（Android の既定出力は Compose のみ）。

| File | Skill | 出力条件 |
|---|---|---|
| `artifacts/{app_name}/tokens.json` | generate-tokens | 常に出力 |
| `artifacts/{app_name}/style-guide.md` | generate-style-guide | 常に出力 |
| `artifacts/{app_name}/screens/style-guide-view.html` | generate-style-guide | 常に出力 |
| `artifacts/{app_name}/build/css/variables.css` | build-tokens | `platform_combo` ∈ {`web_only`, `mobile_and_web`} |
| `artifacts/{app_name}/build/scss/_variables.scss` | build-tokens | `platform_combo` ∈ {`web_only`, `mobile_and_web`} |
| `artifacts/{app_name}/build/ts/tokens.js` + `tokens.d.ts` | build-tokens | `platform_combo` ∈ {`web_only`, `mobile_and_web`} |
| `artifacts/{app_name}/build/ios-swift/StyleTokens.swift` | build-tokens | `platform_combo` ∈ {`mobile_only`, `mobile_and_web`}（mobile_framework 不問） |
| `artifacts/{app_name}/build/android/colors.xml` + `dimens.xml` | build-tokens | `platform_combo` ∈ {`mobile_only`, `mobile_and_web`} かつ `legacy_android_xml == true`（legacy opt-in、欠落 / false は出力しない） |
| `artifacts/{app_name}/build/compose/StyleTokens.kt` | build-tokens | `platform_combo` ∈ {`mobile_only`, `mobile_and_web`}（mobile_framework 不問） |
| `artifacts/{app_name}/build/flutter/tokens.dart` | build-tokens | `platform_combo` 含 mobile かつ `mobile_framework == flutter` |
| `artifacts/{app_name}/build/kmp/StyleTokens.kt` | build-tokens | `platform_combo` 含 mobile かつ `mobile_framework == kmp` |

**生成ファイル数マトリクス** (`legacy_android_xml == true` のときは各行 +2 [colors.xml + dimens.xml]、web_only は対象外):

| platform_combo | mobile_framework | 数 |
|---|---|---|
| `web_only` | （適用外） | 4 |
| `mobile_only` | `native` | 2 |
| `mobile_only` | `flutter` | 3 |
| `mobile_only` | `kmp` | 3 |
| `mobile_and_web` | `native` | 6 |
| `mobile_and_web` | `flutter` | 7 |
| `mobile_and_web` | `kmp` | 7 |

---

## Agent Prompt

When executing this skill, follow Steps 1–3 in order.

---

**You are a design system engineer executing the step ⑫ pipeline end-to-end.**

### Step 1: Generate tokens.json

Read `skills/12-design-system/refs/generate-tokens.md` and execute its Agent Prompt with `{app_name}` set to the current project.

Do not proceed to Step 2 until tokens.json has been written successfully and passes the Verification Checklist in generate-tokens.md.

---

### Step 2: Style guide & platform build (sequential)

`tokens.json` の生成が確認できたら、Step 2a → Step 2b の順に **直列で** 実行する。2a は軽量 (ファイル 2 枚) なので main で直接実行し、2b は重処理 (config.mjs ~300行 + npx style-dictionary + 9 platform 検証) なので subagent に隔離する。

> **設計判断**: 過去は 2a/2b を「並列 subagent」化していたが、(1) 2a は subagent 化する文脈量が無い、(2) subagent は main から Bash / Write 権限を継承しないため sandbox 拒否で頻繁に失敗する、という 2 つの理由で「2a=main / 2b=subagent」の直列フローに改めた。subagent permission は `.claude/settings.json` の `permissions.allow` で repo 全体に明示済み。

#### Step 2a: Generate style guide (main で直接実行)

`skills/12-design-system/refs/generate-style-guide.md` を Read し、Agent Prompt をそのまま **main context で** 実行する。subagent には委譲しない。

Expected outputs:
- `artifacts/{app_name}/style-guide.md`
- `artifacts/{app_name}/screens/style-guide-view.html`

2a が完了し、両ファイルが書き出されたことを確認してから 2b に進む。

#### Step 2b: Build platform files (subagent で隔離実行)

`.claude/agents/ayatori-build-tokens-runner.md` subagent に委譲する。orchestrator が直接 `npx style-dictionary build` を実行しない理由は同 agent 定義の「なぜ subagent 化するのか」セクション参照。

呼び出し:

```
Agent({
  subagent_type: "ayatori-build-tokens-runner",
  description: "Step 12 build-tokens for {app_name}",
  prompt: """
app_name: {app_name}
platform_combo: {requirements.json.design_output_scope.platform_combo}
mobile_framework: {requirements.json.design_output_scope.mobile_framework or "(n/a)"}
legacy_android_xml: {requirements.json.design_output_scope.legacy_android_xml or false}
"""
})
```

agent は `< 500 char` の summary を返す。Expected outputs: 2〜9 files under `artifacts/{app_name}/build/` (`platform_combo` + `mobile_framework` + `legacy_android_xml` で決定 — 上の file-count matrix 参照)。

**前提**: repo root で `npm ci` が一度実行済みで、`node_modules/.bin/style-dictionary` が存在すること (README 「依存パッケージのインストール」参照)。前提が崩れていた場合、subagent は `status: prerequisites_missing` を返してくる — その場合は main 側で `npm ci` を 1 度実行してから再起動。

---

### Step 3: Report results

After Step 2a (main) and Step 2b (subagent return) both complete, report the following:

```
## E2E Design System — 実行結果

### tokens.json
- トークン数: {count}
- カラー: {n}トークン / スペーシング: {n}トークン / タイポグラフィ: {n}トークン

### style-guide-view.html
- 生成: ✅ / ❌
- セクション数: 6

### build-tokens
- platform_combo: {value}
- mobile_framework: {value or "(n/a)"}
- legacy_android_xml: {true / false}
- 生成ファイル数: {n} / {expected} (web_only=4 / mobile_only+native=2 / mobile_only+flutter|kmp=3 / mobile_and_web+native=6 / mobile_and_web+flutter|kmp=7、legacy_android_xml=true は +2)
- 失敗プラットフォーム: {list or なし}

### 確認事項
- [ ] style-guide-view.html をブラウザで開いて6セクションが表示されることを確認
- [ ] build/ 配下のファイルを確認
```

---

## Verification Checklist

- [ ] tokens.json exists and contains 7 groups: `global.color`, `global.typography`, `global.spacing`, `global.border-radius`, `global.shadow`, `semantic`, `component`
- [ ] **State colors (bg/text/border) が必須**: `global.color.{error,warning,info,success}-{bg,text,border}` が tokens.json に存在すること。`design-brief.yaml.palette.state_colors` から展開する。詳細は `refs/generate-tokens.md` Step 3b / Step 5 / Step 6 参照
- [ ] **Domain surface tokens が必須** (dual-theme × domain 拡張): `design-brief.yaml.cases[selected].palette.domain_surfaces[]` が空配列でなければ、全 entry の `name` が tokens.json `global.color.{name}` として存在すること。dual-mode のときは対称 nested 構造 `global.color.{name}.modes.dark.$value` + `…modes.light.$value` を両方持つ。single-mode のときは `global.color.{name}.$value` 直書き。各 entry の `modes[]` から該当 mode の `hex` を展開する。`$description` には `role` と各 `contrast_pairs[]` の検証結果サマリを記載。空配列の場合は `palette.domain_surfaces_rationale` の有無を確認するだけで token 出力はスキップ
- [ ] **Phase 3 への契約**: skill 17 が画面 HTML で `var(--color-error-bg)` / `var(--color-board-dark-square)` 等を直書き hex なしで参照できるよう、state colors 全 12 トークン + domain surface トークン全件が揃っていること
- [ ] **Illustration colors (`palette.illustration_colors[]` 非空のときのみ)**: 全 entry が `global.color.illustration-{name}` として存在し `$description` に "decorative-only" 付記。dual-mode 案件は light/dark 対称 (片側欠落はエラー停止 → skill 08 Phase 3-illust へ差し戻し)。未定義 design-brief では `illustration-*` を一切生成しない (legacy fallback)。詳細は `refs/generate-tokens.md` Step 3f
- [ ] **semantic.icon ロール語彙**: 対応する global token が存在する範囲で `semantic.icon.{default, muted, on-primary, active}` alias が存在 (skill 17 のアイコン親色ガイド + color-lint-report の共通語彙)
- [ ] **dual-theme symmetric (D1-a)**: `requirements.json.design_output_scope.dual_theme_mode == true` の場合、すべての theme-aware color token が `modes.dark` + `modes.light` の **対称 nested 構造** を持ち、両 mode のキー集合が完全一致 (orphan mode 禁止)。semantic / component の color alias パスも `{...modes.dark}` / `{...modes.light}` で mode 明示。theme-agnostic な値 (spacing / typography / shadow 等) は `modes` を持たない flat のまま
- [ ] **NFR 由来 pair の整合**: wcag-history.json の最新 attempt の **loop 対象 violations** (`pair_kind ∈ {palette, domain_surface}`) が **空配列** であること。pass していなければ tokens.json 生成を中断し skill 11 ループに戻す (**ただし attempt が max_attempts 到達済 = warning_passthrough の場合は中断せず続行**し、AA 未達を承知で Step 13 人間ゲートが承認/差し戻しを判断する。skill 09 Phase 1 / interface-contracts.md:739 と同じ扱い — max 到達後に 11 へ戻すとデッドロックするため)。**warn-only の `state_colors` は残存可** (loop 非発動 — Step 21 Section 1-E で人間が再判断する。ここでゲートすると warn-only の state_colors が永遠に Step 21 へ到達できない)。**file 不在 / attempts 空 = 未検証** — 「違反なし」と誤読せず tokens.json 生成を中断し、Step 11 実行を要求する (preamble の resume 分岐は `draft:v1` 限定のため、`final:v1` + wcag-history 不在の legacy / 手動 stub 経路でここに到達し得る。skill 09 Phase 1 の `attempt_count == 0` と同じ扱い、レビュー対応)。NFR との明示 back-link は持たない (Phase 3 skill 19 NFR Coverage 評価が逆引きする)
- [ ] style-guide.md exists
- [ ] **style-guide.md の Domain Surfaces セクション** (domain_surfaces が空でなければ必須): 各 surface について `name` / `role` / `driver_tokens` / 各 mode の hex / contrast_pairs (fg / required / criterion 3 列) を記載 (NFR back-link 列は持たない)
- [ ] screens/style-guide-view.html exists and its `:root` CSS variables match tokens.json values
- [ ] build/ contains expected files per platform_combo + mobile_framework + legacy_android_xml (see file-count matrix in Output)
- [ ] build-tokens Verification Checklist (per-platform value checks) passes
