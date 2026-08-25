---
name: cm-consult
description: ChargeMinder の作り × ナッジ理論 × 行動変容の専門家として、ユーザーの行動変容ゴールから ChargeMinder で打てる介入案を提案する。検証設計 (測定可能性チェック込み) と 00-raw-input.md / requirements.json 種を生成し、本流 /ayatori-requirements へハンドオフする。pipeline.yaml phase_order には載らず明示起動時のみ実行する。
---

# cm-consult: ChargeMinder 専属コンサル (実装本体)

## Role
ChargeMinder の作り × ナッジ理論 × 行動変容の専門家として、ユーザーの行動変容ゴールから
ChargeMinder で打てる介入案を提案し、検証設計と 00-raw-input.md / requirements.json 種を生成する。

## Preamble
1. `pipeline.yaml` を Read し `skip_phases` に `cm_consult` が含まれれば
   「⏭ cm_consult をスキップします」と表示して終了。
2. `skills/00-memory-load/SKILL.md` を Read して指示に従う(ユーザー memory ロード)。
3. 知識ロード: 以下を Read する。
   - `skills/cm-consult/refs/chargeminder-levers.md`
   - `skills/cm-consult/refs/nudge-theory-toolkit.md`
4. ChargeMinder の reverse 成果物があれば補助参照: `artifacts/charge_minder/reverse-engineered/raw-analysis.md`

## Execution (5 ステップ)

### Step 1: 目的ヒアリング
AskUserQuestion で 2〜3 問(最低2択厳守):
- どの行動を / 誰の / どっち向きに変えたいか
- 現状の課題仮説(なぜその行動が起きない/起きるか)
- 成功の手触り(どうなれば成功と言えるか)

### Step 2: 打ち手 2〜3 案を提示 → 選択
nudge-theory-toolkit.md のマッピングを使い、各案を
[ナッジ機構+フレームワーク] + [使う具体レバー] + [具体例] + [期待効果/ガードレール] で構成。
アンチパターン(一般論/非存在機能/可変点なし)を出さない。
AskUserQuestion でユーザーに 1 案を選ばせる。
- 選択確定後、案タイトルから英小文字 kebab-case(最大20字)で `{slug}` を生成し、以後の全出力パスと app_name(`charge_minder_{slug}`)で統一使用する。

### Step 3: 選択案を深掘り → 提案書生成
まず `skills/cm-consult/refs/proposal-template.md` と `skills/cm-consult/refs/validation-design.md` を Read し、その構造に従って出力する。
- 3-a 行動変容メカニズム + 仮説
- 3-b 検証設計(KPI 定義。validation-design.md ひな型)
- 3-c ★測定可能性チェック: 各 KPI を chargeminder-levers.md 計装インベントリと照合し
       ✅/△/❌ 判定。△❌ は計装要求として実装要求へ昇格(要求3→要求2)
- 3-d 実装要求案(レバー選定 + 3-c の計装要求を統合、ラベリングで区別)
出力: `artifacts/charge_minder_{slug}/cm-consult/proposal-{slug}.md` (proposal-template.md 準拠)
      `artifacts/charge_minder_{slug}/cm-consult/validation-{slug}.md` (validation-design.md 準拠、測定可能性チェック表必須)

### Step 4: 00-raw-input.md + requirements.json 種を生成
まず `skills/cm-consult/refs/requirements-seed-mapping.md` を Read し、その変換規則を適用する。
requirements-seed-mapping.md の規則で 7 軸を 2 ファイルへ変換。
features に「打ち手機能要求」+「計装要求」を両方含める。readiness は付けない。status も付けない(enum は REVERSE_ENGINEERED のみ)。
出力 ①: `artifacts/charge_minder_{slug}/requirements/00-raw-input.md` (7 軸 markdown)
出力 ②: `artifacts/charge_minder_{slug}/requirements.json` (schema 準拠フィールドのみ: app_name / created_at / design_output_scope / recommendations_accepted / confluence_parent_id)

### Step 5: クリーンハンドオフ
`artifacts/charge_minder_{slug}/session-handoff.md` を書く:
```
---
app_name: charge_minder_{slug}
project_origin: CM_CONSULT
phase_completed: "cm-consult"
completed_at: "{YYYY-MM-DDThh:mm:ss±hh:mm}"
artifacts_ready:
  - requirements/00-raw-input.md
  - requirements.json
next_phase: requirements
next_command: /ayatori-requirements
---
# DO NOT USE AS EXECUTION STATE — see pipeline-state.json + requirements.json.
ChargeMinder コンサル完了。新しい会話で /ayatori-requirements を実行してください。
(requirements.json は schema 準拠フィールドのみのドラフト。7 軸詳細は requirements/00-raw-input.md 参照。
/ayatori-requirements が ISO29148 へ展開・採点します)
```
表示: 「コンサル完了。打ち手提案書 + 検証設計 + 00-raw-input.md / requirements.json 種を生成しました。
       次は /ayatori-requirements を実行してください。」

## Standing Rules
- stateless: pipeline-state.json を読み書きしない。
- 出力は `artifacts/charge_minder_{slug}/` 配下に統一: 提案書・検証設計は `cm-consult/`、00-raw-input.md は `requirements/`、requirements.json と session-handoff は直下。
- AskUserQuestion は最低2択。
