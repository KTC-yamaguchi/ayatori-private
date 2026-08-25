---
name: 29c-req-propagate
description: Phase 5 screen-edit モードで 29b ゲートが「要件に昇格」と判断した逸脱を requirements/*.md へ反映する。append-only ID 規則と確認ゲートを通し、requirements.json は変更しない (INPUT 専用)。反映完了時に該当逸脱へ resolved_at を stamp して終端する。
---

# 29c Requirement Promotion (screen-edit mode)

## Role

Step 29b のゲートで「要件に昇格」に選ばれた逸脱 (手編集が導入した要件外追加 / 要件矛盾 / 要件削除) を、**要件定義書 `requirements/NN-*.md` へ実際に反映する**。screen-edit run の反映範囲を「画面仕様書まで」から「要件定義書まで」に伸ばす終端 step であり、これが走らない限り昇格は記録だけの状態 (`resolution == "要件に昇格"` かつ `resolved_at` 未設定 = 反映待ち) に留まる。

設計は Step 07 human-gate の昇格後処理と同型の**軽量パターン** (要件 md の prose 反映 + confirmed-decisions ledger 記録 + view 再生成)。Step 33 (req-delta 改訂) の手順は再利用しない — 33 は req-delta manifest / `req_delta.runs[]` に構造的に結合しており、それらを合成するアダプタの方が本 skill より大きくなるため。ただし 33 の **append-only ID 規則**と**セクション逐語保持の改訂規律**は本 skill にインライン規則として同じものを適用する。

## Preconditions

- `pipeline-state.json.delta.runs[-1].mode == "screen_edit"` かつ `screens_approved_at` set (Step 29b ゲート承認済み)
- `requirement-deviations.json` に `phase == "delta"` かつ `raised_by_step == "29b-reverse-propagate"` かつ `resolution == "要件に昇格"` かつ `resolved_at` 未設定の entry が 1 件以上 (無ければ本 step は no-op で Step 30 へ)
- `artifacts/{app_name}/requirements/NN-*.md` が存在

---

## Execution

### Step 0: Scope

`requirement-deviations.json` から昇格待ち entry を収集する: `phase == "delta"` AND `raised_by_step == "29b-reverse-propagate"` AND `resolution == "要件に昇格"` AND `resolved_at` 未設定。今回の 29b ゲート由来だけでなく、過去 run が中断 / 保留して残した反映待ちも同じ条件で拾う。`raised_by_step` filter は必須 — 2 段階 stamp は screen-edit 逆方向限定の契約で、forward (Step 29) 等の他経路が将来 `要件に昇格` を書く場合は各自のゲートで `resolved_at` まで即時 stamp するため、ここで拾ってはならない。

- **0 件** → 「昇格対象の逸脱はありません」と表示して Step 30 へ進む (本 step は no-op)。
- 1 件以上 → `promotion_target.doc` ごとにグループ化し、対象 doc + **全 `requirements/NN-*.md`** を Read する (ID 採番は全 doc 横断スキャンが必要なため)。
- **`promotion_target` が無い entry のフォールバック** (本 skill 導入前に `resolution = "要件に昇格"` だけ記録された旧逸脱など): 反映先未指定でも昇格待ちとして拾い、Step 1 で entry の `artifact` / `element` / `description` から反映先候補 (doc + セクション) を自ら特定して提案する。**反映先は Step 2 ゲートで必ず確認**し、候補が 1 つに絞れない場合はゲートで doc / セクションを質問する (推測のまま書かない — Operating Principle 4)。

**Hard constraints**:
- Write 先は以下のみ: `requirements/NN-*.md` (昇格反映) / `delta/req-promotion/*` (snapshot・manifest・report) / `requirement-deviations.json` (resolved_at stamp + view 再生成) / `pending-questions.json` (born-resolved ledger) / `pipeline-state.json` (`delta.runs[-1].req_promotion` のみ)。
- **`requirements.json` は READ-ONLY (INPUT 専用)** — `must/should/could` や 7 軸 hearing field を書き換えない。逆方向監査が「user 確定 input」として突合する baseline を汚染しないため。
- 画面 HTML / `screens/*.md` / デザインシステム (`tokens.json` / `design-brief.yaml` / `_shared/`) には触れない (Step 29b で反映済み)。

### Step 1: 改訂案の作成 (doc ごと)

`promotion_target.doc` ごとに現行内容を Read し、改訂案を作る。逸脱の `deviation_kind` で処理を分ける:

- **要件外追加** → 既存セクションへの行追加、または新規セクション追加。新規 ID を振る場合は **append-only 規則 (必須)**: 対象 ID 種別 (F-NN / UC-NN / NFR-NN / S-NN / AC-NN / E-NN / Entity N) を **`requirements/` 全 doc に対して grep** し (単一 doc の max は罠 — 例: F の最大が `05-features.md` 内では F-06 でも `02-scope.md` に F-08 が居れば次は F-09)、**全 doc 横断の最大値 + 1** を割り当てる。既存 ID の renumber / shift / 最大値未満の番号への挿入は禁止。
- **要件矛盾** → 衝突している要件記述を手編集後の現実に合わせて修正する (ID 不変、内容のみ変更)。
- **要件削除** → ID の削除は禁止 (append-only 保全)。該当要件の行に「（廃止: 画面から削除済み — YYYY-MM-DD）」の注記を付けて終端する。
- **整合**: 用語は逸脱 entry の `element` / 編集意図の表現に揃える。複数 doc に跨る相互参照 (例: 新 F-NN に受け入れ条件が要るなら `08-constraints.md` の AC 行) は必要最小限で追随させる。
- **書式**: 対象 doc の既存セクション形に合わせる (例: `05-features.md` は `## F-NN: {名称}（{MoSCoW}）` 見出し + `| 項目 | 内容 |` テーブル)。
- **Operating Principle 4 (補完禁止)**: 書く値はすべて (A) CONFIRMED (ユーザーの手編集内容 + ゲート承認) か (C) DERIVED であること。MoSCoW 区分・エラーケース・関連 UC 等、手編集から導出できない field は**発明しない** — Step 2 のゲートで batch 質問するか、`※不明 (unknown)` + 次回 ask 対象 field 名を併記して書く。

### Step 2: 確認ゲート (human)

- `skills/_shared/human-gate-preview.md` を Read して従う (`artifacts_to_review` = 変更対象の `requirements/NN-*.md` + `requirement-deviations-view.html`。`refresh_index` は既定 true)。
- 提示: doc ごとに **変更前 / 変更後 / 変更理由** をセクション単位で示し、どの逸脱 entry に対応するかを紐づける。変更しないセクションは**逐語保持**することを明記する。
- Step 1 で残った未確定 field (MoSCoW 等) があれば、同じゲートで batch 質問する (AskUserQuestion、選択肢上限 4。超える場合は plain chat の番号付きリスト)。
- AskUserQuestion「要件昇格の確認」:
  - Option A: 承認 — 提案どおり `requirements/*.md` へ反映する
  - Option B: 修正指示 — 指示を反映して Step 1 からやり直す
  - Option C: キャンセル — 今回は要件へ反映しない

**On B**: `feedback-log.md` に Pattern A を記録（数値ステップ番号 `[29]` を使う — `[29c]` ではなく — Phase 6 `/ayatori-delta-mini` の `int()` パーサが拾えるように）し、指示を反映して Step 1 へ戻る。

**On C**: follow-up で昇格の扱いを確認する:
- 保留 — `resolution == "要件に昇格"` のまま残す。⚠️ 本 run は Step 30 まで進んで**完了する**ため、resume では再開されない (Resume logic は run 完了判定が先に match する)。回収経路は**次回の screen-edit run** — 29b ゲートが「反映待ち」として引き継ぎ、Step 29c の Step 0 が拾う (run 中断時のみ resume が Step 29c を再開する)
- 容認に戻す — `resolution = "容認"` + `resolved_at` を書いて終端する (要件文書は変更されない)

いずれの場合も **Step 30 へ進む** (画面仕様書への反映は Step 29b で承認済みのため、run 自体は中断しない)。

### Step 3: 反映 (承認後)

1. `mkdir -p artifacts/{app_name}/delta/req-promotion/snapshots` し、**全 `requirements/NN-*.md` (01〜08、00 は除外)** を `{NN-doc}.snapshot.md` として複製する (append-only 検証の baseline。変更対象 doc だけを snapshot すると他 doc 由来の ID 重複を機械検出できないため全 doc を取る)。既存 snapshot は上書き (per-run)。
2. 承認された改訂を Write/Edit で `requirements/NN-*.md` へ反映する (変更セクション以外は逐語保持。`backup-on-edit.sh` が Write 前に `_backup/requirements/` へ自動退避する)。
3. `delta/req-promotion/change-manifest.json` を書く — 今回の昇格の機械可読な台帳 (`schemas/change-manifest.schema.json` の req-delta 変形。`source` キーは付けない):

```json
{
  "run_id": "{delta.runs[-1].run_id}",
  "app_name": "{app_name}",
  "created_at": "{ISO 8601}",
  "change_type": "spec_change",
  "change_description": "画面手編集の要件昇格: {1 行要約}",
  "directly_changed_docs": ["05-features.md"],
  "requirement_changes": [
    {
      "doc": "05-features.md",
      "section": "## F-09: {名称}",
      "type": "added",
      "dependency_category": "feature_flow",
      "summary": "{昇格内容の要約}",
      "impact_hint": "{関連する doc / ID}"
    }
  ]
}
```

- `type` は `added` / `modified` のみ使う (要件削除の廃止注記は `modified` — ID を消さないため `removed` は使わない)。
- `section` に主体 ID を含めること (checker が section から主体 ID を導出する)。

### Step 4: 機械検証 (cross-reference integrity)

```bash
node scripts/check-req-crossrefs.mjs artifacts/{app_name} \
  --manifest delta/req-promotion/change-manifest.json \
  --snapshots delta/req-promotion/snapshots \
  --report delta/req-promotion/cross-reference-integrity-report.md
```

- **exit 0 (PASS)** → Step 5 へ。
- **exit 1 (FAIL)** → report の違反 (ID 消失 / 途中挿入 / 宣言 doc 不一致) を修正して再実行。PASS になるまで Step 5 へ進まない。
- **exit 2 (入力不能)** → manifest の形式不備。Step 3-3 を修正して再実行。

### Step 5: 終端処理

1. 反映した昇格 entry へ `resolved_at` (ISO 8601) を stamp する (resolution は既に「要件に昇格」。main session が単一 writer として python merge)。
2. `node scripts/render-deviations-view.mjs artifacts/{app_name}/requirement-deviations.json` で view を再生成する。
3. `pending-questions.json` へ born-resolved entry を append する (確定 decision の記録。昇格 1 件につき 1 entry。hook R3 の必須 field を全部埋める): `target` = `requirements.{NN-doc}.{主体 ID or セクション slug}` (dot path 文法) / `question` = 「{element} を正式要件として requirements/*.md に反映するか」 / `raised_by_step` = `"29c-req-propagate"` / `raised_at` + `resolved_at` (ISO 8601) / `resolved_answer` = `"要件に昇格"`。born-resolved entry には **`reflect_to` (回答の反映先 artifact の `artifacts/{app_name}/` 相対パス) を書かない** — 振り分け script は `resolved_at` が set の entry を読む前に抜けるため値が使われる経路が無い (`skills/_shared/preflight-gate.md` § append 経路)。
4. `pipeline-state.json` の `delta.runs[-1]` に `req_promotion` を記録する (Bash; substitute `__PLACEHOLDERS__`):

```bash
python3 << 'PYEOF'
import json, os
from datetime import datetime, timezone
path = "artifacts/__APP_NAME__/pipeline-state.json"
if not os.path.exists(path):
    print(f"ERROR: {path} が見つかりません。"); exit(1)
data = json.loads(open(path).read())
if not data.get("delta", {}).get("runs"):
    print("ERROR: delta.runs が空です。"); exit(1)
data["delta"]["runs"][-1]["req_promotion"] = {
    "completed_at": datetime.now(timezone.utc).isoformat(),
    "promoted": __PROMOTED_COUNT__,
    "docs": __CHANGED_DOCS_LIST__
}
open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False))
print("OK: req_promotion written")
PYEOF
```

5. **Step 30 へ進む**。

---

## Output

- Updated `artifacts/{app_name}/requirements/NN-*.md` — 昇格分のみ反映 (**`requirements.json` は不変**)
- `artifacts/{app_name}/delta/req-promotion/` — `snapshots/` + `change-manifest.json` + `cross-reference-integrity-report.md`
- `artifacts/{app_name}/requirement-deviations.json` (+ view) — 昇格 entry に `resolved_at` (終端。次回 run で再提示されない)
- `artifacts/{app_name}/pending-questions.json` — born-resolved entries (confirmed-decisions ledger)
- `pipeline-state.json` — `delta.runs[-1].req_promotion` set
- **Next step**: Step 30 (Figma 部分更新 / fallback stub)
