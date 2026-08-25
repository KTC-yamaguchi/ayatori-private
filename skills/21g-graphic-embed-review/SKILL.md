---
name: 21g-graphic-embed-review
description: Phase 3 の Step 21g。21f までに生成・後処理された正典グラフィック (screens/_shared/graphics/) を screens HTML へ <img> 相対参照で埋め込み、視覚レポートで提示して承認を取る人間ゲート。承認時に画面仕様書へ「使用グラフィック」節を追記し approvals.graphics_human_approved を立てる (Step 15 2nd save / Step 22 の入口 assert が読む)。修正指示の 3 分類 routing (配置 / 品質 / プロンプト) と per-slot 却下も本 step が担う。
---

# 21g: グラフィック埋め込み + 承認 → graphics_human_approved OR 差し戻し / 却下

## 役割

21e/21f で生成・後処理された正典グラフィックを、**どの画面のどこに入れるかを確定して
screens HTML に埋め込み、ユーザーの承認を取る** 人間ゲート (グラフィックブロックの最終 step)。
埋め込みは C-26 の正典相対参照 (`<img src="../_shared/graphics/{graphic_id}.(png|webp)"
alt width height>`) のみ。承認が Step 15 (2nd Confluence save) / Step 22 (Figma export) の
前提条件になる。

本書は **routing / 分岐判断のみ** を持つ。決定的処理は `scripts/` (gather-context /
embed-graphics / render-embed-review / commit-approval / route-rework)、対話テンプレート・
anchor 選定指針・差し戻し 3 分類の判別は `refs/embed-guide.md` (Step 2 以降でのみ Read) に
分離している。**一括タグ書き換え・src↔正典存在照合は script の責務で、LLM は挿入位置の判断
のみ行う** (pipeline.yaml `html_transform_policy: deterministic_script`)。前提条件 (21f 完了 /
未承認等) は **すべて Step 1 の script が機械判定する** — 手動で JSON を Read して確認しない。

## 実行指示

### Step 1: preflight (決定的)

```bash
node skills/21g-graphic-embed-review/scripts/gather-context.mjs {app_name}
```

stdout の JSON で routing する:

| 結果 | 行動 |
|---|---|
| `ok: true` | `mode`・`slots` (埋め込み対象 = fresh generated_files − excluded、配置メタ・埋め込み先実ファイル解決済み) を保持して Step 2 へ。`warnings` があれば user に明示してから進む (無言 fallback 禁止)。`mode == "re-embed"` は再入/配置修正のやり直し — 既存タグは apply が除去する (冪等) |
| `E_SCREENS_NOT_APPROVED` | 「Step 21 (画面 HTML 承認) が未完了です」を表示して中断 |
| `E_21B_NOT_DONE` | 21b へ差し戻して中断 |
| `E_BLOCK_SKIPPED` | skip 確定済み ({decided_by}) を表示して中断 — グラフィックブロックは実行しない |
| `E_ALREADY_APPROVED` | 承認済み ({step21g_approved_at}) を表示して中断 — **再質問しない** (P4-07)。routing は resume cascade に委ねる (次は Step 15 2nd save)。やり直しは設計 §5 の手動リセット運用による |
| `E_GEN_INCOMPLETE` | 21e/21f が未完了 — resume cascade の該当 step へ差し戻して中断 |
| `E_PENDING_SLOTS` | 生成未完了 slot が残っている state 不整合 (digest 不一致 / generated_files 欠落) — message を表示して中断 (黙って対象から落とさない)。21e の再実行を確認する |
| `E_CANON_MISSING` | 正典実ファイル欠落 (21f 完了記録と矛盾) — message を表示して中断 |
| `E_TARGET_FILES_MISSING` | 埋め込み先 main HTML が解決できない (screen, platform) 組がある (部分欠落含む — 21b 確定後の画面リネーム等) — plan の再確定 or 当該 slot の却下 (却下 script は本状態でも通る) を user に確認して中断 |
| `E_EMPTY_TARGET_SET` | 埋め込み対象 0 件 — 21e の全 slot excluded 時は decision=skip が契約 (state 不整合)。message を表示して中断 |
| `E_PROMPTS_MISSING` / `E_PROMPTS_INVALID` / `E_PLAN_MISSING` / `E_PLAN_INVALID` / `E_PLAN_MISMATCH` | 入力 artifact の欠落/不整合 — message を表示して中断 |
| その他 `E_*` / exit 1 | message を表示して中断 |

### Step 2: 挿入位置の判断 + 一括埋め込み (対話準備)

`refs/embed-guide.md` を Read してから進める:

1. 判断素材を読む: 各 slot の `placements[].spec_file` (`screens/{screen}.md`、non-null のもの) +
   placement 記述。anchor 候補の探索は対象 main HTML への Grep / 部分 Read で行う (全文 Read
   しない — context 保護)。
2. slot × 埋め込み先ファイルごとに anchor (guide §1: 一意な逐語スニペット) と `attrs`
   (guide §2: `size_px` 基準の width/height、必要時のみ object_fit / class) を決め、placements
   draft を組み立てる。**取りこぼし禁止** — gather の `embed_targets` 全件を被覆する (外したい
   slot は Step 4-B の却下手順による)。
3. **dry-run 検証を通してから** 本実行する:

   ```bash
   node skills/21g-graphic-embed-review/scripts/embed-graphics.mjs {app_name} apply --stdin --dry-run <<'JSON'
   { "placements": [ { "graphic_id": "...", "file": "screens/web/01-home.html",
                       "insert_after": "<header class=\"app-header\">", 
                       "attrs": { "width": 800, "height": 400 } } ] }
   JSON
   ```

   `E_ANCHOR` は anchor を一意なスニペットに選び直して再実行。`E_VALIDATION` は `errors[]` に
   従い draft を直す (`E_BAD_INPUT` は stdin JSON 自体の不正)。dry-run OK → `--dry-run` なしで
   再実行 (script が self-backup してから一括書き換えし、対象外 graphic_id の孤児タグも除去する)。
4. placeholder 置き換え指定の slot は apply 後に旧 placeholder ブロックを Edit で除去する
   (guide §1)。

### Step 3: 人間ゲート preview + 一括提示

1. 視覚レポートを生成する (派生ビュー — 手焼き禁止):

   ```bash
   node skills/21g-graphic-embed-review/scripts/render-embed-review.mjs {app_name}
   ```

   `ok: false` / exit 1 でも**中断しない** (fail-open) — レポートなしで 2 の link 一覧のみに degrade する。
2. `skills/_shared/human-gate-preview.md` の規約に従い、link 一覧 + `refresh_index` + auto-open を
   行う。`step_id = "21g-graphic-embed-review"` (auto-open 対象 = `graphics/graphic-embed-review.html`、
   pipeline.yaml `step_targets`)。`artifacts_to_review` = 視覚レポート (kind: html、生成成功時) +
   埋め込んだ全 main HTML (kind: html) + 追記予定の `screens/{screen}.md` (kind: md)。
3. **`commit-approval.mjs {app_name} approve --dry-run` を通してから** guide §3 のフォーマットで
   全 slot を一括提示し、guide §4 の確定確認 (AskUserQuestion) を出す。dry-run の `warnings`
   (placeholder 残置 = Step 2-4 の Edit 除去漏れ検出等) があれば解消 or 提示に含めて明示する。
4. 分岐:
   - **承認** → Step 4-A。
   - **修正指示** → guide §5 の 3 分類で判別 → 配置起因は Step 2 を再実行 (再提示へ)、
     品質/プロンプト起因は Step 4-C (差し戻し routing)。**Pattern A を `feedback-log.md` に記録**
     (分類を併記)。
   - **slot 却下** → Step 4-B。**Pattern A を記録** (分類: 却下)。
   - **保留** → Step 5。

### Step 4: commit (決定的)

- **A. 承認**: `node skills/21g-graphic-embed-review/scripts/commit-approval.mjs {app_name} approve`
  — 以下いずれの `E_*` でも state / MD は書かれていない。
  - `ok: true` → 完了報告 (対象 slot 数 / spec_updated / 次: Step 15 2nd save → Step 22) →
    **セッションの 21g を終了** (orchestrator の進行判定に委ねる)。
  - `E_EMBED_INCOMPLETE` → missing / violations / orphans に従い Step 2 で埋め込みを完成させて
    から再実行 (dry-run 済みなら通常起きない — 対話中に screens/ が変わったケース)。
  - `E_REWORK_OPEN` → rework_pending が未消費 — 21d の再確定が先 (routing 不整合。resume cascade
    を確認)。
  - `E_TARGET_FILES_MISSING` → 埋め込み先 main HTML が解決できない (screen, platform) 組がある
    (部分欠落含む) — plan の再確定 or 当該 slot の却下 (Step 4-B — 却下は本状態でも通る) を
    user に確認する。
  - `E_WRITE_VERIFY` → 承認フラグの write-back 検証失敗。pipeline-state.json を確認し、1 回だけ
    再実行する。解消しなければ **Pattern B を記録**して中断 (無言で先に進まない)。
- **B. 却下** (guide §6): reason を聞き取り、dry-run → 実行:

  ```bash
  node skills/21g-graphic-embed-review/scripts/commit-approval.mjs {app_name} reject --stdin <<'JSON'
  { "rejects": [ { "graphic_id": "...", "reason": "..." } ] }
  JSON
  ```

  正典ファイルは孤児として残る旨を報告する。残 slot があれば Step 3 (レポート再生成 → 再提示) へ。
  **全 slot 却下** (`decision=skip, decided_by=step21g`) なら「ブロック中止 — Step 15 (2nd save) へ
  素通し」を報告して終了。
- **C. 差し戻し routing** (**guide §5 が正本** — 分類判別・複数分類跨り時の順序・報告文・state
  書き込み内容はすべてそちらに従う。orchestrator の責務を代行する道具 — `phases/screens/SKILL.md`
  § Step 21g): dry-run → 実行:

  ```bash
  node skills/21g-graphic-embed-review/scripts/route-rework.mjs {app_name} prompt --stdin <<'JSON'
  { "items": [ { "graphic_id": "...", "instruction": "..." } ] }
  JSON
  ```

  (品質起因は `quality` mode、items は graphic_id のみ。) `ok: true` → guide §5 の報告文で
  **セッションの 21g を終了** (resume cascade が次 step を検知する)。

### Step 5: 保留

**commit script を呼ばず、何も書かない** (`graphics_human_approved` 未 set = 次回 resume cascade
が 21g を再起動する signal — 設計 §9-1 分岐 3 の else)。「埋め込み承認を保留しました。次回
セッションで 21g が再起動します」を報告。埋め込み済み HTML はディスクに残るため、次回は
`mode == "re-embed"` で Step 3 (提示) から実質再開できる。

## 失敗時の挙動

前提 NG (`E_*`) の対応は Step 1 / 4 に集約済み (再掲しない)。

| 失敗 | 対応 |
|---|---|
| `render-embed-review.mjs` 失敗 | 失敗ではなく degrade — link 一覧のみ (screens HTML 直接確認) で人間ゲートを続行する (fail-open) |
| `embed-graphics.mjs` が `E_POST_VERIFY` | 書き込み後検証で期待タグ欠落 — `_backup/` から復元して原因を確認する (Pattern B を記録) |
| `screens/{screen}.md` 不在 | 失敗ではない — gather が warnings で返す。承認 commit は当該画面の「使用グラフィック」節のみ skip する (明示告知) |
| `E_ANCHOR` / `E_VALIDATION` が解消できない | feedback-log.md に Pattern B を記録して user に報告 (書き込みはゼロのまま) |
| 配置起因修正が複数 platform variant に跨る | `skills/00-feedback-protocol/SKILL.md` の必須 4 ステップ (全 variant 洗い出し → 一括修正 → grep/diff 検証 → 報告) を適用する |
| node が使えない環境 | 縮退運転しない — anchor 一意性・src↔正典照合・C-26 準拠の機械検証を LLM の手動転記で代替すると検証なしの一括 HTML 書き換えになるため (21e と同じ扱い)。**保留** (Step 5 — 何も書かない) として報告し、環境復旧後の再実行を案内する |

## 出力

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/screens/{platform}/*.html` | Step 2 で対象 slot の `<img>` 正典相対参照を挿入 (writer 実体は `embed-graphics.mjs` — 対象 graphic_id のタグのみ触る scope 分離。置換前に `_backup/` へ self-backup)。却下時は当該タグを除去 |
| `artifacts/{app_name}/screens/{screen}.md` | Step 4-A のみ「使用グラフィック」節 (graphic_id / 配置 / alt / 由来 = AI 生成 + 承認日) を ayatori:graphics-used マーカー間に追記/置換 (冪等、writer 実体は `commit-approval.mjs`)。Step 15 (2nd save) がこれを拾う |
| `artifacts/{app_name}/graphics/graphic-embed-review.html` | Step 3 の視覚レポート (派生ビュー — 毎回丸ごと再生成、writer 実体は `render-embed-review.mjs`。render 失敗時は不在で link-only degrade)。srcdoc 内の画像は data URI 内包の自己完結 HTML — 閲覧環境の file:// 読取ブロックで破像しない + 単体ファイルで共有可 |
| `artifacts/{app_name}/pipeline-state.json` | 4-A: `approvals.graphics_human_approved = true` + `approvals.step21g_approved_at` (canonical フラグ — cascade / Step 15・22 assert はこちらを読む。**21g に completed_at は無い** — 人間ゲート step は完了 = 承認) / 4-B: `generated_files[]` entry 削除 + `excluded_slots[]` append (+全却下時 `decision=skip, decided_by=step21g`) / 4-C: `rework_pending[]` append + `prompts_confirmed_at`・`step21e/21f_completed_at` クリア (writer 実体は `route-rework.mjs` — 呼び出し責務は orchestrator § Step 21g)。保留時は更新しない |
| `artifacts/{app_name}/feedback-log.md` | 修正指示・却下指示が出た場合の Pattern A 記録 (3 分類 / 却下の別を併記) |

## 完了後

- 4-A (承認) → Step 15 (2nd Confluence save — 使用グラフィック節を含む仕様書を保存) → Step 22
  (Figma export — 埋め込み済み HTML は既存キャプチャ経路のまま書き出せる)。
  orchestrator の resume cascade / Step 15・22 の入口 assert が `graphics_human_approved` を読む。
- 4-B 全 slot 却下 (skip) → Step 15 (2nd save) へ素通し。
- 4-C (差し戻し) → resume cascade が 21d (プロンプト起因) / 21e (品質起因) を再起動する。再生成
  後に 21g が再度提示する (既埋め込みタグは apply が除去して差し替える)。
- 保留 → 本セッションのグラフィックブロックはここで終了。次回 `/ayatori-screens` 再実行時に
  resume cascade (`decision == "generate"` AND NOT `graphics_human_approved` の else 分岐 → 21g、
  設計 §9-1) が 21g を再起動する。

## 参照

- `docs/graphic-generation-design.md` — 挿入位置設計の SoT (§7 埋め込み形式・artifact 責務 / §9-1 resume cascade / §9-2b 差し戻し 3 分類・21g/29 共通契約 / §11 per-slot 却下)
- `pipeline.yaml` — C-26 (埋め込み形式の constraint) / `screens.graphic_generation` (html_transform_policy / skip_semantics / ordering)
- `skills/21e-graphic-generate/scripts/preflight.mjs` — 鮮度判定 digest (`sourceDigestOf`) の SoT (import 共有で byte 一致契約、設計 §9-2b)
- `schemas/pipeline-state.schema.json` — `screens.graphics.*` / `approvals.graphics_human_approved` の schema
- `schemas/graphic-plan.schema.json` — 配置メタ (READ-ONLY)
- `skills/_shared/human-gate-preview.md` — 人間ゲート preview 規約
- `skills/00-feedback-protocol/SKILL.md` — 配置修正が variant 横断になる場合の必須 4 ステップ
