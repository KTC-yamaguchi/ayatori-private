---
name: 21a-graphic-recommend
description: Phase 3 の Step 21a。Step 21 で承認された main HTML からピクトグラム類を決定的に抽出し、アプリ/コンテンツのカテゴリから推定される「ユーザーの期待」に基づいてグラフィック作成の必要性を分析、5 部構成の推奨レポート graphics/graphic-recommend.md + 候補位置を画面プレビュー上でハイライトする視覚レポート graphic-recommend.html (派生、2 ファイル構成) を生成する。人間ゲートではなく、最終判断は後続の 21b (graphic-hearing) が行う。分析不能時は fail-open で degrade し 21b のユーザー完全判断モードに直行する。
---

# 21a: グラフィック必要性分析 → 推奨レポート生成

## 役割

Step 21 で承認された main (default) HTML を入力に、**AI 生成グラフィック (イラスト / キャラクター / 写真) の作成必要性を自動分析し、推奨レポートを生成**する。実現可能性の検証結果 (I-5) と設計 SoT・用語整理は `docs/graphic-generation-design.md`。

- **判断軸は「アプリ/コンテンツのカテゴリから推定されるユーザーの期待」のみ**。「オーナーの意向」は AYATORI では取得できないため判断軸に含めない (レポートにもその旨を明記する)。
- レポート全体は **(E) PROPOSED** — 本 step は人間ゲートではなく、要否の最終判断は Step 21b の人間ゲートでユーザーが行う (推奨が外れても「参考にされない」だけで下流は壊れない)。
- 分析が成立しない場合は **fail-open** — エラー停止せず degrade して 21b (ユーザー完全判断) に直行する。

本書は **routing / 分岐判断のみ** を持つ。決定的処理は同梱 script、レポート書式は参照資料に分離している (progressive disclosure — 21b と同じ分担):

| ファイル | 責務 |
|---|---|
| `SKILL.md` (本書) | routing / 分岐判断 |
| `scripts/extract-inventory.mjs` | 前提 assert + 画面インベントリの決定的抽出 (SVG 形状署名照合、LLM 不要・node stdlib のみ)。HTML 全文は返さない = context 保護 |
| `scripts/render-recommend-html.mjs` | 視覚レポート `graphics/graphic-recommend.html` の決定的生成 (2 ファイル構成 — MD=テキスト詳細 / HTML=候補位置を画面プレビュー上でハイライト)。SoT は MD §4、手焼き禁止 |
| `scripts/commit-completed.mjs` | `pipeline-state.json` への完了記録 (`screens.graphics.step21a_completed_at` のみ — key 分離)。通常完了はレポートの存在を assert |
| `scripts/preflight.mjs` | 上記 script 群が共有する前提 assert + main 画面 stem 解決。各 script の E_* code を同一に保つ |
| `scripts/svg-scan.mjs` | SVG ブロック列挙 + 形状署名の共有ヘルパ (extract-inventory / render-recommend-html が import。lint-screen-colors.mjs との同期規約はヘッダ参照) |
| `refs/report-guide.md` | レポート固定見出し (5 部構成)・カテゴリ帯対応表・統制規約・degrade 書式・視覚レポート anchor 規約 §7 (Step 2 でのみ Read) |

## 前提条件

Step 21 承認済み / グラフィック要否が未確定 / 上流 scope が skip でない / 21a 未実行 / 2nd Confluence save 未通過 — **すべて Step 1 の script が機械判定する** (手動で JSON を Read して確認しない)。

## 実行指示

### Step 1: 前提 assert + インベントリ抽出 (決定的)

```bash
node skills/21a-graphic-recommend/scripts/extract-inventory.mjs {app_name}
```

stdout の JSON で routing する:

| 結果 | 行動 |
|---|---|
| `ok: true` | `inventory`・`category_sources`・`illustration_policy` を保持して Step 2 へ |
| `E_SCREENS_NOT_APPROVED` | 「Step 21 (画面 HTML 承認) が未完了です」を表示して中断 |
| `E_DECISION_ALREADY_SET` | 確定済み ({decision}) を表示して中断 — 再分析しない。routing は resume cascade に委ねる |
| `E_UPSTREAM_SKIP` | 上流 skip の記録は orchestrator の責務 (設計 §9-1)。本 step は何もせず中断 |
| `E_ALREADY_DONE` | 実行済みを表示して中断 — Step 21b へ進む (再分析しない) |
| `E_PAST_2ND_SAVE` | 「グラフィックの後付け追加は delta 領域です (設計 §5)」を表示して中断 |
| `E_NO_SCREENS` | **degrade 経路** — Step 3-B へ (分析対象なしの fail-open skip) |
| その他 `E_*` | message を表示して中断 |
| exit code ≠ 0 (内部エラー) | **degrade 経路** — Step 3-B へ (抽出失敗の fail-open skip、設計 §8-4) |

### Step 2: カテゴリ判定 + 推奨レポート生成 (LLM — 判断はここに集中する)

`refs/report-guide.md` を Read してから進める:

1. `category_material_available == true` の場合: `requirements/00-raw-input.md` / `requirements/01-overview.md` (存在するもの) を Read し、guide §2 の固定対応表でカテゴリ帯を分類する。`design-brief.yaml` が存在すれば補正材料として Read する (guide §2 補正規則 — 不在時は補正なしの fail-open)。**統制 4 か条 (guide §3) を厳守する**。
2. `icon_contexts` を guide §8 の signal 表で 2 分類する — **① 機能アイコン (据え置き) / ② グラフィック代替候補**。② は全件を §4 候補へ昇格する (「ピクトグラム中心」は候補列挙の抑制材料にしない)。
3. 候補スロットを洗い出す (guide §4 — **網羅列挙・優先度順**、個別推奨は種別 × 期待度帯の固定表から引く。入力タスク画面は負の規則で候補外。絞り込みは 21b の役割)。`illust_placeholders` は data-scene 直取り、`meaningful_visuals` (コア UI) はガードレール節へ。
4. 候補スロットが 1 件以上あるとき: 各スロットの位置 anchor を guide §7 の語彙・検証規約に従って選定する (検証できない anchor は省略 = fail-open。HTML 全文 Read はしない)。
5. guide §1 の固定見出し構造 (5 部構成 + 3-b 分類節 + §4 直後の `ayatori:slot-anchors` コメント) でレポートを組み立て、`artifacts/{app_name}/graphics/graphic-recommend.md` に Write する。
6. **inventory-only degrade**: `category_material_available == false`、または統制 1 (逐語引用) が満たせない場合は、guide §5 の書式 (推奨 = `※ 不明 (unknown)` + 次回 ask 対象併記) に degrade してレポートを Write する (インベントリ部と ガードレール部・3-b・slot-anchors は通常どおり出す)。

### Step 2b: 視覚レポート生成 (決定的、fail-open)

```bash
node skills/21a-graphic-recommend/scripts/render-recommend-html.mjs {app_name}
```

MD §4 (表 + slot-anchors) から `graphics/graphic-recommend.html` — 候補位置を画面プレビュー上でハイライトする派生ビュー — を再生成する。routing:

| 結果 | 行動 |
|---|---|
| `ok: true` | `fallbacks[]` があれば完了報告に「位置ハイライトなし {N} 件」を含める。Step 3 へ |
| `ok: true, slots: 0` | 候補なし — 視覚レポートは生成されない (正常)。Step 3 へ |
| `E_MD_PARSE` | **差し戻し** — §4 見出し構造が壊れている (「候補 0 件」ではない)。Step 2-5 に戻って MD を修正し再実行する (既存 HTML は削除されていない) |
| その他 `E_*` / exit code ≠ 0 | **fail-open** — 視覚レポートなしで Step 3 へ進む (21b は MD のみで提示可能)。`feedback-log.md` に Pattern B を 1 行記録する |

### Step 3: 完了 commit (決定的)

- **A. 通常完了 / inventory-only degrade** (レポートを Write した場合):

  ```bash
  node skills/21a-graphic-recommend/scripts/commit-completed.mjs {app_name}
  ```

  - `E_REPORT_MISSING` → レポートの Write 漏れ。Step 2-5 に戻って Write してから再実行する。
  - `ok: true` → 完了報告 (推奨 3 段階の結論 / 候補スロット数 / レポートパス / 視覚レポートパス [生成時]) → **Step 21b (graphic-hearing) へ**。

- **B. fail-open skip** (Step 1 で `E_NO_SCREENS` または抽出スクリプト非 0 exit):
  1. `feedback-log.md` に Pattern B を記録する (`skills/00-feedback-protocol/SKILL.md` の規約。例: `- **[21a] Pattern B (分析 degrade)**: screens HTML 0 件で必要性分析を skip → {原因} → 21b をレポートなしモードで続行`)。
  2. ```bash
     node skills/21a-graphic-recommend/scripts/commit-completed.mjs {app_name} --degraded "{原因の要約}"
     ```
  3. 完了報告「21a の必要性分析を skip しました (fail-open)。Step 21b はレポートなし (ユーザー完全判断モード) で進みます」→ **Step 21b へ**。

## 失敗時の挙動

前提 NG / 抽出失敗 / 視覚レポート失敗 / カテゴリ材料欠損の対応は Step 1 / 2 / 2b の routing 表・手順に集約済み (再掲しない)。

| 失敗 | 対応 |
|---|---|
| node が使えない環境 | 縮退運転 — 本書 + guide の契約に従い、同じ assert / 抽出 (画面 HTML の Read は必要最小限) / 完了記録を手動 (Read / Write) で行う |

## 出力

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/graphics/graphic-recommend.md` | **本 skill が単一 writer** (Step 2)。schema なし — `refs/report-guide.md` §1 の固定見出し構造が機械可読性を担保 (`delta/feature-add-brief.md` と同型)。degrade skip (Step 3-B) 時は生成しない (不在 = 21b が `mode: plain` に fallback する疎結合 — 設計 §8-4)。再生成時 (通常起きない) は既存を `_backup/graphics/` へ退避してから上書き |
| `artifacts/{app_name}/graphics/graphic-recommend.html` | **派生ビュー** (SoT = MD §4)。writer は `render-recommend-html.mjs` のみ (Step 2b、手焼き禁止 — `color-lint-report.html` と同型)。候補スロット 0 件・render 失敗時は不在 (21b は存在チェックだけで提示に含めるかを分岐する疎結合)。srcdoc 内の画像は data URI 内包の自己完結 HTML — 閲覧環境の file:// 読取ブロックで破像しない |
| `artifacts/{app_name}/pipeline-state.json` | `screens.graphics.step21a_completed_at` のみ (writer は `commit-completed.mjs`、key 分離 — `decision`/`decided_by` は 21b・orchestrator の territory)。**degrade 完了でも記録する** (21b preflight の起動前提) |
| `artifacts/{app_name}/feedback-log.md` | Step 3-B (fail-open skip) 時の Pattern B 記録 |

## 完了後

- Step 3-A / 3-B いずれも → **Step 21b (graphic-hearing)** へ。
- レポート推奨とユーザー実選択の突合 (shadow-run 計測) は **21b が決定 commit 時に記録する** (本 step は関与しない)。

## 参照

- `docs/graphic-generation-design.md` — 挿入位置設計の SoT (§2 step 体系 / §3 前後依存 / §5 上流方針 / §7 artifact 責務 / §8-4 skip 動線・degrade / §9 resume cascade)
- 実現可能性検証レポート — 抽出方式・カテゴリ統制・shadow-run 計測計画の一次資料
- `skills/21b-graphic-hearing/SKILL.md` — 本レポートの唯一の reader (人間ゲート)
- `scripts/lint-screen-colors.mjs` — SVG 形状署名照合の同方式元 (svgBlocks / svgSignature)
