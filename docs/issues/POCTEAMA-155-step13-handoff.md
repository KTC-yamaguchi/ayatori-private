# POCTEAMA-155 — Phase 2 step13 完了フラグが Phase 3 へ引き継がれない

- Jira: https://kinto-dev.atlassian.net/browse/POCTEAMA-155
- Branch: `feature/POCTEAMA-155-step13-handoff-fix`
- 発生バージョン: 5/18 マージ版 AYATORI
- 調査範囲: `skills/13-human-gate-design/skill.md` / `phases/design/SKILL.md` / `phases/screens/SKILL.md` / `skills/10-sample-human-review/skill.md`

---

## 1. 動かないこと（再現現象）

`/ayatori-design` で Step 13 を「承認」しても、次セッションの `/ayatori-screens` 起動時に
「Phase 2 (Design System) が未完了」と判定され、再度 Step 13 承認を求められる（または exit）。

実際には今回ユーザーが `pipeline-state.json.approvals.step13_approved_at` を手動で埋めることで Phase 3 へ進めた。

---

## 2. 問題点（コードベース上の根本原因）

> **Note**: 以下の行番号参照は **本 PR 適用前 (commit [`5834723`](https://github.com/kinto-dev/dev-automation-poc/tree/5834723)) 時点** のスナップショット。当時の根本原因を保存する目的で、参照を更新せず原文のまま残し、各リンクは commit `5834723` の permalink を指している。

### 2-1. Skill 13 の Write 指示が narrative 1 行で構造化されていない（最重要）

[`skills/13-human-gate-design/skill.md` L24-L29](https://github.com/kinto-dev/dev-automation-poc/blob/5834723/skills/13-human-gate-design/skill.md#L24-L29):

```
## 承認後の処理

承認の場合:
- `artifacts/{app_name}/pipeline-state.json` の `approvals.step13_approved_at` に ISO 8601 datetime を記録する (Read or {} → merge → Write back パターン)。
- `requirements.json` には書かない (INPUT 専用)。
→ Phase SKILL.md の Completion セクションへ戻る
```

比較対象：[`skills/10-sample-human-review/skill.md` L62-L99](https://github.com/kinto-dev/dev-automation-poc/blob/5834723/skills/10-sample-human-review/skill.md#L62-L99) では「**Step 1: design-brief.yaml 更新**」「**Step 2: pipeline-state.json.selections に記録**」「**Step 3: design-samples/ を退避**」「**Step 4: 完了報告**」と **明示的な番号付きステップ + JSON 例 + 不変量** で構造化されている。

Skill 13 は同じ「pipeline-state.json への書き込み」を narrative の bullet 1 行で済ませているため、エージェントが Write を **物理的にスキップしても気付かない**。今回の障害はこの実装ギャップで発生した可能性が高い（issue description でユーザーも「自分で手動更新した」と明記）。

### 2-2. Phase 2 Completion に safety-net write がない

[`phases/design/SKILL.md` L153-L171](https://github.com/kinto-dev/dev-automation-poc/blob/5834723/phases/design/SKILL.md#L153-L171) (`## Completion`) は **`session-handoff.md` を上書き**する一方で、`pipeline-state.json.approvals.step13_approved_at` が空のまま完了に到達しても再保証しない。

→ Skill 13 で書き漏れたら、Phase 2 完了アナウンス（"Phase 2 complete. Run /ayatori-screens ..."）まで通ってしまい、ユーザーは正しく終わったと信じる。次セッションで初めて発覚する。

### 2-3. ブレストやり直し時のクリーンアップから `session-handoff.md` が抜けている

[`skills/13-human-gate-design/skill.md` L36-L46](https://github.com/kinto-dev/dev-automation-poc/blob/5834723/skills/13-human-gate-design/skill.md#L36-L46) のやり直しパス削除リスト：

- `design-brief.yaml` / `wcag-mapping.json` / `wcag-history.json` / `tokens.json` / `style-guide.md` / `style-guide-view.html` / `screens/` / `scores.json`
- `pipeline-state.json` の `selections.*` と `approvals.step13_approved_at` unset

→ **`session-handoff.md` が削除リストにない**。やり直し後に旧 handoff（古い `completed_at`、`phase_completed: "2-design"`）が残ってしまうと、次の `/ayatori-design` 起動時の [Preamble L14-L27](https://github.com/kinto-dev/dev-automation-poc/blob/5834723/phases/design/SKILL.md#L14-L27) で REVERSE_ENGINEERED 経路と誤認しないまでも、ユーザー視点では矛盾した artifact が残る。

### 2-4. Phase 2 単独実行（Phase 1a/1b スキップ）の正式サポートが未明文化

issue description ④ の通り、`/ayatori-question` / `/ayatori-requirements` をスキップして `/ayatori-design` から開始する場合、`pipeline-state.json.approvals.step07_approved_at` 等を **誰が・どのタイミングで埋めるか** がどこにも書かれていない。今回はユーザーが pipeline-state.json を新規作成して step07_approved_at を手書きで埋めた。

`phases/design/SKILL.md` Preamble は step07 を **チェックしていない** ため Phase 2 自体は走るが、Phase 3 入口で step13 を見るのと同じ思想で言えば、Phase 2 の開始要件を pipeline-state.json で表現するなら入口アサートが必要。

### 2-5. （副次）`session-handoff.md` と `pipeline-state.json` の役割が docstring に出ていない

[`phases/design/SKILL.md` L45-L51](https://github.com/kinto-dev/dev-automation-poc/blob/5834723/phases/design/SKILL.md#L45-L51) の Artifact responsibility ブロックには `pipeline-state.json` ← Step 13 と書かれているが、`session-handoff.md` の writer/reader は別ブロックで暗黙的（[L154](https://github.com/kinto-dev/dev-automation-poc/blob/5834723/phases/design/SKILL.md#L154)）。CLAUDE.md の責務マップにも `session-handoff.md` は載っていない（POCTEAMA-141 で追加された新ファイルだが責務分離原則に未統合）。

→ 厳密には dual-SoT ではないが、メンテナの認識ズレを誘発する。

---

## 3. 対応方針

### Fix-1【必須】Skill 13 を Skill 10 と同型のステップ構造に書き直す

`skills/13-human-gate-design/skill.md` の `## 承認後の処理` を以下のように分解：

```
### 承認の場合

**Step 1: pipeline-state.json に承認時刻を記録**

Read or `{}` で lazy 初期化し、approvals セクションに merge：

```json
{
  "approvals": {
    "step13_approved_at": "2026-05-20T15:30:00+09:00"
  }
}
```

(Write back 完了確認まで本 skill の責務。次の completion へ進む前に Read で再検証)

**Step 2: 完了報告**

承認時刻を表示してから Phase SKILL.md の Completion セクションへ戻る。
```

JSON ブロックを置くだけで LLM の Write 実行率が上がる（Skill 10 が安定して走っているのと同じ理由）。

### Fix-2【推奨】Phase 2 Completion に safety-net write を追加

[`phases/design/SKILL.md` L153-L171](https://github.com/kinto-dev/dev-automation-poc/blob/5834723/phases/design/SKILL.md#L153-L171) の冒頭に：

```
0. Read `artifacts/{app_name}/pipeline-state.json`. もし `approvals.step13_approved_at` が空なら
   現在時刻 (ISO 8601, +09:00) を埋めて Write back する。
   (Skill 13 で書き漏れた場合の安全網。書き込み済みなら no-op)
```

二重防御。Fix-1 が効いていれば常に no-op になる。

### Fix-3【必須】Skill 13 のやり直しパス削除リストに `session-handoff.md` を追加

[L36-L46](https://github.com/kinto-dev/dev-automation-poc/blob/5834723/skills/13-human-gate-design/skill.md#L36-L46) の削除リストに 1 行追加：

```
- artifacts/{app_name}/session-handoff.md (もし phase_completed == "2-design" なら削除)
```

`phase_completed` が `"3-screens"` 以降の handoff は触らない（Phase 3 の進捗を破壊しないため）。

### Fix-4【任意】Phase 2 単独実行サポートの明文化

選択肢 A: `phases/design/SKILL.md` Preamble に「Phase 2 単独実行モード」セクションを追加し、pipeline-state.json が無ければ stub を自動生成する。

選択肢 B: `README.md` または `docs/setup.md` に「Phase 2 から開始する場合の事前準備」節を追加して人手で stub を用意する手順を書く。

→ POCTEAMA-155 のスコープには直接含めず、別チケットでも良い（issue 確認質問 #3 にあたる）。

### Fix-5【任意】CLAUDE.md 責務マップに `session-handoff.md` を追加

責務マップに 1 行追加：

| `session-handoff.md` | Phase 完了マーカー（次 Phase への引き継ぎ） | 各 Phase の Completion セクション | 次 Phase の Preamble | （schema なし、固定 frontmatter） |

責務分離原則への統合。

---

## 4. 作業ステップ

1. このノートを `docs/issues/POCTEAMA-155-step13-handoff.md` にコミット（本コミット）
2. Fix-1: `skills/13-human-gate-design/skill.md` の `## 承認後の処理` 書き直し
3. Fix-2: `phases/design/SKILL.md` Completion に safety-net write を追加
4. Fix-3: Skill 13 やり直しパスに `session-handoff.md` 削除を追加
5. Fix-5: CLAUDE.md 責務マップ更新
6. （Fix-4 は別チケット候補としてコメントのみ残す）
7. テスト：既存 artifact（例: TournamentBracket）の `pipeline-state.json.approvals.step13_approved_at` を一時的に unset → `/ayatori-design` を Step 13 だけ再走 → 自動で書き戻り、`/ayatori-screens` が起動できることを確認

---

## 5. 未確定事項

- **既存 artifact の migration**: 4/30 版で `requirements.json.step13_approved_at` に直書きされていたデータの扱い。新パイプラインは pipeline-state.json を見るため、旧 artifact は migration スクリプトか「手動で pipeline-state.json を作成」案内が要る（issue 確認質問 #5）。

---

## 6. レビュー対応 (2026-05-21 追記)

初回 PR (commit `c59b674`) は Step 13 の write 漏れ症状を直したが、レビューで「アーキテクチャ整理が残っている」と指摘された。以下を追加対応した。

### P1: Phase 2 / Phase 3 Preamble の Dual SoT 排除

- `phases/design/SKILL.md` step 4b: `session-handoff.md.project_origin` 参照を削除し、`requirements.json.status == "REVERSE_ENGINEERED"` のみで判定するよう変更
- `phases/screens/SKILL.md` step 4b: 同上
- `skills/08-design-brainstorm/skill.md` モード C 条件: state SoT を `requirements.json.status` に統一する旨を明記
- 結果: REVERSE_ENGINEERED 判定の SoT は `requirements.json.status` のみ。`session-handoff.md` が古い / 欠落 / 不整合でも下流挙動には影響しなくなった

### P2: `session-handoff.md` を summary-only に格下げ

- 各 Phase Completion (`phases/design` / `phases/screens` / `phases/reverse`) で書き出す際に **`# DO NOT USE AS EXECUTION STATE — see pipeline-state.json + requirements.json.`** バナーを必ず含める
- `project_origin` 等の frontmatter field は legacy 互換のために残すが、削除されても下流挙動には影響しないと注記
- `CLAUDE.md` 責務マップに `session-handoff.md` 行を追加 (役割: human-readable summary のみ、state 判定 readers は無し)
- `CLAUDE.md` 設計原則に「state SoT は 2 ファイルのみ」原則 (7) を新規追加
- `skills/13-human-gate-design/skill.md` のブレストやり直しパス: session-handoff.md 削除条件 (`phase_completed == "3-screens"` なら削除しない) を撤廃し、無条件削除に単純化 (state は pipeline-state 側に残る)

### P3: `pipeline-state.json` に `schema_version` 追加

- `schemas/pipeline-state.schema.json` に `schema_version` field (optional) を追加
- 現行 version: `"2026-05-21"` (POCTEAMA-155 で導入)
- 欠落している legacy artifact は読み込み互換 — 新規 init 時のみ書き込み
- `pipeline.yaml` file_topology の note と lazy_init stub 形を更新
- `CLAUDE.md` 設計原則 4 (lazy 初期化) に `schema_version` を含めた stub 形式を明記

### P4: Standalone 実行の明文化

- `CLAUDE.md` Pipeline Execution セクション直下に「Standalone Phase 実行」サブセクションを追加
- `/ayatori-design` / `/ayatori-screens` / `/ayatori-retro` 単独起動時に必要な `pipeline-state.json` 最小 stub 例と必要 approvals key の対応表を掲載
- REVERSE_ENGINEERED 経路から流入する場合の `requirements.json.status` 設定方法も併記

### Misc: Timezone 表記の通一化

- Skill 13 / Phase 2 Completion での "+09:00 mandatory" 表現を "ISO 8601 datetime (`Z` または offset 付き)" に緩和。他フェーズ表記と整合。

---

## 7. 動作確認の指針

セッション間 propagation を要するため、artifact 状態セットアップは `scripts/poc-test-step13-handoff.sh` (本 PR で追加) を利用する。各テストは **別の Claude Code 会話** で `/ayatori-*` を実際に起動して観測する。

### Test T1: 通常 propagation (P2 → P3)

目的: Step 13 fix が write を確実に行い、次セッションの Phase 3 が pipeline-state から step13_approved_at を拾えること。

```bash
bash scripts/poc-test-step13-handoff.sh <app_name> T1
# → 新セッション: /ayatori-screens を実行
# → Phase 3 が「Phase 2 未完了」エラー無しで Step 14 に入れば PASS
```

### Test T1.5: Skill 13 自体の write 動作検証 (root cause fix 回帰テスト)

目的: POCTEAMA-155 の根本原因修正 (Skill 13 を Skill 10 同型に構造化した Step 1/2/3) が **safety-net に頼らず単独で機能** することを検証する。T2 では Phase 2 Completion の safety-net が補完してしまうため、root cause fix そのものの回帰検出には別シナリオが必要。

```bash
bash scripts/poc-test-step13-handoff.sh <app_name> T1.5
# → 新セッション: /ayatori-design → Skill 13 で承認
# → Skill 13 Step 3「完了報告」表示直後に **手動でセッション中断** (Completion の safety-net 発火前)
bash scripts/poc-test-step13-handoff.sh <app_name> inspect
# → approvals.step13_approved : <ISO 8601> ならば PASS (Skill 13 が独力で書いた)
#   (unset) ならば FAIL (Skill 13 の write を LLM がスキップ = バグ再発)
```

### Test T2: safety-net 発火

目的: Skill 13 が万一 write をスキップしても Phase 2 Completion の safety-net (POCTEAMA-155 §6 Fix-2) が補完すること。

```bash
bash scripts/poc-test-step13-handoff.sh <app_name> T2
# → 新セッション: /ayatori-design を実行
# → Skill 13 で承認 → Completion で step13_approved_at が補完される
bash scripts/poc-test-step13-handoff.sh <app_name> inspect
# → approvals.step13_approved : <ISO 8601 timestamp> なら PASS
```

### Test T3: ブレスト再実行時の旧 handoff 無条件削除

目的: 古い `session-handoff.md` が disposable summary として無条件に消され、かつ pipeline-state の他 keys (step07_approved_at 等) は保持されること。

```bash
bash scripts/poc-test-step13-handoff.sh <app_name> T3
# → 新セッション: /ayatori-design → Step 13 で「ブレストからやり直す」を選択
bash scripts/poc-test-step13-handoff.sh <app_name> inspect
# → session-handoff.md exists: no、step07_approved 保持 → PASS
```

### その他

- **既存 artifact の互換性**: legacy artifact で `pipeline-state.json` に `schema_version` が無くても `/ayatori-design` / `/ayatori-screens` が正常起動 (schema 上 `schema_version` is optional)。
- **REVERSE_ENGINEERED 経路**: `requirements.json.status = "REVERSE_ENGINEERED"` のみ設定し `session-handoff.md` を **削除した状態** で `/ayatori-design` を起動 → ファストパス mode C に入ることを確認 (Phase 0b 流入の SoT が `requirements.json` のみで足りる検証)。
- **Standalone 起動**: 空のディレクトリに `requirements.json` (最小) と `pipeline-state.json` (`{ "schema_version": "2026-05-21", "app_name": "...", "approvals": { "step07_approved_at": "..." } }`) を置き、`/ayatori-design` 単独起動できることを確認 (CLAUDE.md "Standalone Phase 実行" セクション)。

### 復元

各テスト後はスクリプト同梱の backup から復元できる:

```bash
bash scripts/poc-test-step13-handoff.sh <app_name> restore
```
