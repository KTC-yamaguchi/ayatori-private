---
name: 01b-add-feature-question
description: 完走済プロジェクトへの機能追加要望を 7 軸ヒアリングで既存の ISO 29148 8 文書と矛盾しない形に詰め、req-delta/change-manifest.json を直接生成する。Phase 1d の Step 01b で /ayatori-add-feature から実行され、Phase 1c の Step 31 を bypass して接続する。
---

# 01b Add-Feature Question Agent (完走済プロジェクトへの機能追加ヒアリング)

## Language Rule

本ファイルは英語で記述するが、ユーザー向け出力 (AskUserQuestion のラベル / 質問文 / 進捗表示 / 推奨事項) は `pipeline.yaml → output_language` の言語 (現在 `ja`) でレンダリングする。

## Role

完走済プロジェクト (`pipeline-state.json.approvals.final_approved == true` または `completed_at_states` が立っている、二段階完了モデル)、またはベースライン承認済みの reverse 基線プロジェクト (`baseline_approved_at` が立っており、かつ `requirements.json.status == "REVERSE_ENGINEERED"`) への機能追加要望を、既存要件 (`requirements/01〜08.md`) と矛盾しない形で詰めるためのヒアリングエージェント。

skill 01-question (新規プロジェクト 7 軸ブレスト) とは別物。**前提が違う**:
- 既存の 8 ISO 29148 文書が存在し、それを context として読む
- ターゲットユーザー / 主要機能 / 採用技術スタック は既に確定済
- 追加機能の **スコープ** だけを聞く
- 既存の「将来検討」「Phase 2 以降」「v1 対象外」記述との **矛盾を検出** する

**Out of scope** (skill 01 と同じ):
- デザイン判断 / 技術スタック選定 / UI 構造

## Purpose / 解決する問題

完走済プロジェクトへの機能追加で、ユーザーが 2〜3 行で答えた短い回答をそのまま要件として扱ってしまい、ISO 29148 8 文書への波及が浅くなる問題を解消する。

本 skill は **7 軸の機能追加ヒアリング** を行い、ヒアリング結果を ISO 29148 8 観点に decompose して `req-delta/change-manifest.json` を直接生成する。これにより:

- **Step 31 編集前ヒアリング未対応問題**: 01b が change-manifest を直接生成するため、skill 31 を bypass できる
- **古い「Phase 2 / 将来検討」記述の残存問題**: 軸 7 で grep ベースの矛盾検出を実施し、`type: removed` / `type: modified` エントリを manifest に明示する
- **dependency_map のハードウェア機能未対応問題**: 軸 3 で「OS API / 権限 / 外部通信 / デバイス間通信を伴うか」を必ず問い、Yes なら `hardware_platform_feature` カテゴリを自動付与 (skill 32 の dependency_map で 06 + 07 + 08 同時 ripple)

## Preconditions

- `pipeline-state.json.approvals.final_approved == true` OR `pipeline-state.json.approvals.completed_at_states` is set OR (`pipeline-state.json.approvals.baseline_approved_at` is set **AND** `requirements.json.status == "REVERSE_ENGINEERED"` — 由来検査) (reverse 基線例外 — 本 skill の起動条件; SoT = CLAUDE.md § 完走後 Phase 共通 Entry Guard)
- `requirements/01-overview.md` 〜 `08-constraints.md` が全て存在
- `tokens.json` / `design-brief.yaml` / `screens/` 等が完走済 (本 skill では参照しないが、後続の `/ayatori-delta` で使われる。**reverse 基線プロジェクトでは design-brief.yaml / 画面 HTML が未生成のことがある** — 本 skill は参照しないため起動可。後続で材料が必要になった場合は `/ayatori-screens` の「基線確立 (screens-lite)」ルート [遷移図・共通部品の正典] / 「フル実行」ルート [画面 HTML] で整える)

---

## Interaction Style

- 各軸の opening question は `AskUserQuestion` (2-4 option + Other)
- 「Other」を選んだ場合は free-form 入力をチャットで受け取る
- 各軸の回答後、即座に `requirement_changes[]` の draft エントリを 1〜3 件決定する (decompose は本 skill の責務)

### Operating Principle 4 — Disambiguation (機能追加ヒアリング時の補完ガード)

01b は新規 7 軸ヒアリングで `change-manifest.json` (requirements 級 artifact) を生成するため、Phase 1a (01-question) と同じハルシネーション risk を持つ (新規ユーザー input の解釈)。`docs/principle4-disambiguation.md` §1 の 4-step を各軸の回答確定 / manifest entry draft の **直前** に適用する:
- **flavor (a) input 解釈**: ユーザーの軸回答の解釈候補を書き出して N≥2 に割れたら、補完せず `artifacts/{app_name}/pending-questions.json` に append (必須 field 4 件: `target` / `question` / `raised_by_step="01b-add-feature-question"` / `raised_at` [ISO 8601] + `ambiguity_kind` 付与 — ⚠️ 必須 field を省くと hook R3 が exit 2 で Write を弾く) するか、その軸の追加質問で確認する。この entry に **`reflect_to` (回答の反映先 artifact の `artifacts/{app_name}/` 相対パス) は書かない** — 本 skill の反映先は `change-manifest.json` であり、どの phase の `target_artifacts` にも受け手が無いため。未設定 = 次の門で必ず ask される従来挙動 (`skills/_shared/preflight-gate.md` § append 経路)。
- **flavor (b) 機能追加ガード (P4-02)**: `requirement_changes[]` に機能を足す前に、その機能がユーザー入力 (7 軸回答 / 既存要件) に根拠を持つか自問する。根拠の無い機能カテゴリの能動追加は禁止 (CLAUDE.md Rule 1)。
- **確定回答の ledger 記録**: 軸ヒアリングで確定した specifics は `pending-questions.json` に born-resolved entry として記録する (02 と同じ confirmed-decisions ledger。後続 Step 32 / Phase 5 の監査が「user 確定 input」として突合する source)。

手順 SoT は `docs/principle4-disambiguation.md` (参照のみ、コピペ禁止)。

### AskUserQuestion の 4 option 制約と plain chat fallback (必須遵守)

`AskUserQuestion` ツールは **1 件あたり最大 4 option + 自動 "Other"** の制約がある。本 skill の各 Axis で問う選択肢が 4 を超えるケースは plain chat で受ける必要がある。具体的な該当ケースと対処:

| 該当 Axis / 場面 | 選択肢数 | 対処 |
|---|---|---|
| Axis 1 機能スコープ Opening | 4 option (新規 / 拡張 / データ追加 / Other) | `AskUserQuestion` で OK |
| Axis 2 利用シーン Opening | 4 option (日常 / 特定状況 / 新ユーザー種別 / Other) | `AskUserQuestion` で OK |
| Axis 3 ハードウェア要件 (multiSelect) | 4 option (OS API / 外部通信 / 新永続化 / デバイス間通信) | `AskUserQuestion` multiSelect で OK |
| Axis 4 NFR (multiSelect) | 4 option (latency / セキュリティ / 信頼性 / アクセシビリティ) | `AskUserQuestion` multiSelect で OK |
| Axis 5 データ定義 Opening | 4 option (新規+既存変更 / 新規のみ / 既存変更のみ / 不要) | `AskUserQuestion` で OK |
| Axis 6 既存機能との関係 Opening | 4 option (最小化 / 拡張 / 再構成 / Other) | `AskUserQuestion` で OK |
| **Axis 7 grep ヒット行確認** (該当箇所多数) | **5 件以上のとき** | **plain chat** で行リストを提示し、各行を「矛盾 / 維持」で判定する判断結果を **チャット返信** で受ける (multiSelect で 5 件以上は不可) |
| **Axis 6 整合性自動チェックの再確認** | 通常 3 option (A/B/C) | `AskUserQuestion` で OK、ただし矛盾エントリが多数ある場合は plain chat で entry リストを先に提示してから AskUserQuestion で 3 択 |
| **既存 directly_changed_docs 確認** (skill 01b は自動計算のため通常不要) | 8 option | plain chat (将来 user が override したい場合) |

### Plain chat fallback の書式

`AskUserQuestion` で扱えない選択を plain chat に倒すときは、以下の書式に統一する:

```
[本文で選択肢を提示する。番号付きリストで N >= 5 件を列挙]
1. 〜〜〜
2. 〜〜〜
...
8. 〜〜〜

選択方法: 該当する番号をカンマ区切りで返信してください (例: 「1, 3, 5」)。
複合選択を許容する場合 / 単一選択強制の場合を本文で明示。
```

### 設計判断

「単一 free-form 入力を求めるとき AskUserQuestion を 1 option で代用しない」 ルール (`skills/00-memory-load/SKILL.md` 由来) と整合する。**4 option 超 → plain chat、1 option 未満の自由入力 → plain chat** が一貫した方針。

---

## Workflow

```
0. Context load (既存 requirements/*.md を全件 read)
1. Axis 1: 機能スコープ — 追加機能は何をするか、既存の何を補強するか
2. Axis 2: 利用シーン (UC) — 誰が / いつ / 何のために使うか
3. Axis 3: ハードウェア / プラットフォーム要件 — OS API / 権限 / 外部通信 / デバイス間通信
4. Axis 4: 非機能要件 — パフォーマンス / セキュリティ / 信頼性 / 利用環境
5. Axis 5: データ定義 — 新エンティティ / 状態
6. Axis 6: 既存機能との関係 — 既存 UC / F-NN / 画面遷移への影響
7. Axis 7: フェーズ整合性チェック (grep ベース自動探索)
8. Manifest decompose — ヒアリング結果を ISO 29148 8 観点に分解
9. change-manifest.json 直接書き出し + Step 31 を bypass する flag を設定
10. /ayatori-req-delta に handoff (Step 32 から start)
```

---

## Step 0: Context Load

`artifacts/{app_name}/requirements/01-overview.md` 〜 `08-constraints.md` を **全件 Read** する。

### ID 番号は append-only — 既存最大値 + 1 から追加 (renumber 禁止)

全 ID 種別の **既存最大値** を集計し、新規 ID は **max + 1 から追加 (append-only)** で割り当てる。既存 ID 番号の **shift / renumber (番号付け替え) は禁止**:

- 既存の機能 ID (F-NN) を集計 → 新機能の next ID = `F-{max+1}` (append only)
- 既存の UC ID (UC-NN) を集計 → 新 UC の next ID = `UC-{max+1}`
- 既存の NFR ID (NFR-NN) を集計 → 新 NFR の next ID = `NFR-{max+1}`
- 既存の画面 ID (S-NN) を集計 → 新画面の next ID = `S-{max+1}`
- 既存の AC ID (AC-NN) を集計 → 新 AC の next ID = `AC-{max+1}`
- 既存の Entity 番号 (Entity N) を集計 → 新 Entity = `Entity {max+1}`
- 既存のエラーケース ID (E-NN) を集計 → 新エラーケース = `E-{max+1}`

**意味的順序の表現**: 新機能を「既存 F-05 と F-06 の間に位置付けたい」等のケースでも、**番号は append (F-08 等) で割り当て、表示順序は section の配置順で表現** する。番号順序と意味順序は独立。

- 既存の "Phase 2" "将来検討" "Won't" "v1 対象外" "v1 範囲外" "未来の" "今後の検討" を grep で予備マッピング (Axis 7 で再利用)

```bash
grep -rEHn "Phase 2|Phase 3|将来検討|将来実装|v1 対象外|v1 対象範囲外|v1 範囲外|Won't|won't|^.*以降.*検討|将来の拡張|未来の|今後の検討" artifacts/{app_name}/requirements/
```

### Step 0 grep 結果の reusable 設計 (必須遵守)

旧版は「結果を内部メモリに保持」と 1 行だけ書かれており、Axis 7 で再実行してしまう実装パターンが起きやすかった (実 invoke テストで実際に発生)。以下のルールを明確化:

1. **Step 0 で 1 回だけ実行する**:
   - 上記 grep を Bash ツールで 1 回実行し、結果 (filepath:line:content の全行) を **本 skill 実行中の内部メモリ** に保持する
   - 結果は構造化して保持 (entry list: `[{file, line, content}, ...]`) — 後段の Axis 7 で各 entry を判定する

2. **Axis 7 では絶対に再 grep しない**:
   - Step 0 で保持した結果を **そのまま reuse** する
   - 同じ grep を Bash ツールで再実行することは **禁止** (性能 + 一貫性のため、Step 0 と Axis 7 で結果が違うと判定がブレる)
   - Axis 7 が追加の grep を要する場合 (例: 新機能の特定キーワード grep — F-03 modification なら "1 タップ開局" "0 タップ" 等) は、Axis 7 内で **別の grep として明示的に実行** し、Step 0 grep とは別のメモリ領域に保持する

3. **拡張 grep が必要なシナリオ**:
   - 新機能が既存「1 タップ開局」等の **キャッチフレーズ的記述** を変える場合、Step 0 grep ではヒットしない (Step 0 grep は "Phase 2" 等のフェーズワードのみ)
   - その場合、Axis 6 の deep-dive 段階 or Axis 7 の最初に **追加 grep を 1 回実行**:
     ```bash
     grep -rEHn "<新機能と矛盾する可能性のあるキャッチフレーズ>" artifacts/{app_name}/requirements/
     ```
   - 例 (ReversiOne BLE 対戦テスト): `grep "1 タップ開局|1 タップで|0 タップ|スタート画面|モード選択を持たない|hot-seat 専用"` 等
   - 拡張 grep は **追加 1 回まで** に抑える (それ以上は YAGNI、Axis 6 deep-dive のチャット入力で吸収する)

4. **内部メモリ保持の概念モデル**:
   - 本 skill は単一プロセス (1 conversation) 内で完結するため、永続化は不要
   - LLM の context window 内に「Step 0 grep 結果」「拡張 grep 結果」を構造化テキストとして保持
   - Step 9 (manifest 書き出し) の `hearing_metadata` フィールドに grep 結果のサマリ (カテゴリ別件数) を記録 — 後日の audit / re-run 時に参照可能

---

## Axis 1: 機能スコープ (Feature Scope)

**Opening question** (`AskUserQuestion`):
> 「追加したい機能を一言で表すと?」

Options (free-text を Other に倒す):
- 新規機能 (例: チャット機能、共有機能、対戦機能)
- 既存機能の拡張 (例: 設定項目追加、表示モード追加)
- データ機能追加 (例: 履歴保存、エクスポート、検索)
- 他 (free-form)

**Deep-dive** (常に 1 回):
- 「具体的にどう動作する? 入力 / 処理 / 出力 を 1-2 文で」(チャット入力)

**出力 (decompose)**: `requirement_changes[]` の draft:
- `doc: 05-features.md` / `section: F-{next ID} {機能名}` / `type: added` / `dependency_category: feature_flow`

---

## Axis 2: 利用シーン (Use Cases)

**Opening question** (`AskUserQuestion`):
> 「この機能を **誰が** **いつ** 使いますか?」

Options (シナリオベース):
- 既存ユーザーが日常的に使う (例: 毎回 / ほぼ毎回起動時に)
- 既存ユーザーが特定状況で使う (例: 結果画面で / 設定で / 失敗時に)
- 新しいユーザー種別が出現 (例: 対戦相手、管理者、視聴者)
- 他 (free-form)

**Deep-dive** (条件付き):
- 「新しいユーザー種別が出現」を選んだ場合: 「そのユーザーはアプリ内で何ができる / 何ができない?」
- 既存ユーザーの場合: 「トリガー → ゴールの 1 行フロー」

**出力 (decompose)**: `requirement_changes[]` 追加:
- `doc: 04-use-cases.md` / `section: UC-{next ID} {UC 名}` / `type: added` / `dependency_category: feature_flow`
- (新ユーザー種別がある場合) `doc: 05-features.md` / `section: ユーザー種別` / `type: modified` / `dependency_category: user_type_role`

---

## Axis 3: ハードウェア / プラットフォーム要件 (Hardware / Platform)

**極めて重要** (`hardware_platform_feature` カテゴリ判定の trigger): この軸で `hardware_platform_feature` カテゴリ判定を確定させる。

**Opening question** (`AskUserQuestion`, multiSelect: true):
> 「この機能は以下のいずれかを必要としますか? (該当を全て選択、無しなら次へ)」

Options (multiSelect):
- OS API / 権限 (Bluetooth / WiFi / NFC / GPS / カメラ / マイク / push 通知 / バイオメトリクス / クリップボード 等)
- 外部通信 (HTTP / WebSocket / gRPC / 既存通信機能の追加変更を除く)
- 新しいデータ永続化基盤 (DataStore / SQLDelight 以外 — Keychain / CloudKit / Firestore 等)
- デバイス間通信 (BLE peer / Nearby Share 等、同時複数 player の状態同期を伴う)

→ いずれか 1 つ以上選択された場合は **`hardware_platform_feature` カテゴリで manifest entry を作る**:

**出力 (decompose)**: `requirement_changes[]` 追加 (hardware_platform_feature 該当時のみ):
- `doc: 05-features.md` / `section: F-{N} の hardware 要件` / `type: added` / **`dependency_category: hardware_platform_feature`** ← skill 32 dependency_map で 06+07+08 同時 ripple を起こす重要カテゴリ
- (Bluetooth / 外部通信 などの具体的記載は Axis 4, 5, 6 の出力で補強)

該当なしの場合: Axis 3 はスキップ (manifest entry なし)。

**Deep-dive** (Hardware 該当時のみ): 「対応 OS (iOS x.x+ / Android x.x+) / 必須権限 / fallback パス (権限拒否時の挙動) を箇条書きで」(チャット入力)

---

## Axis 4: 非機能要件 (NFR)

> **既存 NFR の自然 extend ルール (本 Axis の前提として必読)**:
>
> 既存 NFR の多くは「**全インタラクティブ要素 / 全画面に適用**」と書かれている性質を持つため、新規 UI 要素 (新ダイアログ / ペアリング UI / 色選択ボタン等) にも **追加 NFR を書かなくても自動適用** される。例:
> - **NFR-08 (44pt タップ領域、ReversiOne 例)**: "全てのインタラクティブ要素に適用" → 新ボタン / 新 toggle にも自動適用
> - **NFR-09 / NFR-10 (WCAG AA コントラスト)**: "全テキスト / 全 UI 境界線に適用" → 新規 UI 要素にも自動適用
> - **NFR-12 (スクリーンリーダー)**: "盤面 1 マスあたり読み上げ 1 秒以下" → 新 UI 要素にも準じて適用
>
> このため Axis 4 の選択肢のうち「アクセシビリティ / 多言語 / 大型タップ」は、**選んでも選ばなくても挙動は同じ** (新規 NFR を立てるかどうかの判断のみ)。判断基準:
> - **選ぶ (= 新 NFR-{N} を立てる)**: 既存 NFR で表現できない **新機能特有のアクセシビリティ要件** (例: BLE ペアリング UI で「視覚障害者向け音声フィードバック」を加える等) がある場合
> - **選ばない (= 既存自然 extend に委ねる)**: 新 UI 要素は既存 NFR-08〜NFR-12 の適用範囲内で十分な場合 (大半のケース)

**Opening question** (`AskUserQuestion`, **`multiSelect: true`** — L53 の Axis overview と後続 Step A/B/C の前提に整合):
> 「この機能の **品質** で特に気を付けたいことは? (複数選択可。※ アクセシビリティ等は既存 NFR で自然 extend されるため、新機能特有の追加要件がある場合のみ選択)」

Options (multiSelect):
- レスポンス時間 / latency (例: 即時応答必須、N 秒以内 — **新機能特有の数値目標を立てる場合に選択**)
- セキュリティ / プライバシー (例: 暗号化、認証、データ最小化 — **新機能特有の脅威モデルがある場合に選択**)
- 信頼性 / エラーリカバリ (例: 再接続、リトライ、状態保持 — **新機能特有の障害シナリオがある場合に選択**)
- アクセシビリティ / 多言語 / 大型タップ (※ 既存 NFR で自然 extend される — **新機能特有の追加要件がある場合のみ選択**、なければ未選択で OK)

> **0 選択の扱い**: 4 option 全て未選択も valid (新機能特有の NFR は不要、既存 NFR の自然 extend のみで足りる)。0 選択時は 06-non-functional.md への新 NFR 追加は 0 件 (Axis 3 hardware 該当による暗黙必須 NFR は別途別経路で追加される)。

### Axis 3 hardware 該当時の暗黙必須 NFR (表示と挙動を明確化)

Axis 3 で `hardware_platform_feature` 該当 (OS API / 外部通信 / 新永続化 / デバイス間通信 のいずれかが選択) だった場合、**セキュリティ + 信頼性 の 2 つの新 NFR は automatic** として扱う。理由: ハードウェア機能は新機能特有の脅威モデル (例: BLE Just Works ペアリングの中間者攻撃懸念、相手送信データの検証必要) + 障害シナリオ (例: 切断 / タイムアウト / 権限拒否) が必ず生じるため。

`AskUserQuestion` ツールには option の preselect 機能が無いため、以下の **明示的な表示 + 自動付与** の二段階で表現する:

```
Step A (Axis 4 Opening 直前の表示、user に明示):
  > 「Axis 3 で hardware_platform_feature 該当を確認しました。
  >   以下 2 つの新 NFR は自動的に決定機能 NFR として追加されます (Axis 4 で
  >   選び直さなくても OK):
  >   - NFR-{N}: セキュリティ — 認証 / データ検証 / 個人情報非送信 等
  >   - NFR-{N+1}: 信頼性 / エラーリカバリ — 切断 / タイムアウト / 権限拒否時の動作
  >  Axis 4 ではそれ以外の品質要件 (latency / アクセシビリティ等) のみ選択してください。」

Step B (内部 decompose):
  Axis 3 結果が hardware 該当 → Axis 4 結果の multiSelect option 中に
  「セキュリティ」「信頼性」が含まれていなくても、自動的に
  requirement_changes[] に以下を追加:
  - {doc: 06-non-functional.md, section: NFR-{N} {セキュリティ NFR}, type: added, dependency_category: nfr}
  - {doc: 06-non-functional.md, section: NFR-{N+1} {信頼性 NFR}, type: added, dependency_category: nfr}

Step C (Axis 4 Options から該当 2 件を除去 or グレーアウト表示):
  Step A で表示済のため、Axis 4 multiSelect options から「セキュリティ / プライバシー」と
  「信頼性 / エラーリカバリ」を **除去** する (重複選択させない)。
  Axis 4 options が hardware 該当時は 2 つに減る:
  - レスポンス時間 / latency
  - アクセシビリティ / 多言語 / 大型タップ
  ※ hardware 非該当時は通常通り 4 options (旧版同等)
```

これにより Axis 3 暗黙必須 default の AskUserQuestion 表現不能問題 を解消。ユーザーは「セキュリティ / 信頼性は確定済」を理解した上で他の品質要件のみ選べる。

**Deep-dive**: 「具体的な数値目標 / 受け入れ条件 (例: 3 秒以内 / 99% 成功率 / 切断検出 1 秒以内)」(チャット入力、無しなら "Phase 2 で決定")

**出力 (decompose)**: `requirement_changes[]` 追加:
- `doc: 06-non-functional.md` / `section: NFR-{next ID} {NFR 名}` / `type: added` / `dependency_category: nfr`
- (注: Axis 3 で hardware_platform_feature 該当時は、本 entry は dependency_category=hardware_platform_feature の entry とは別の独立 entry として記録する。manifest 内で **同じ doc に複数 entry** を持つことは仕様上 OK)
- (注: 「アクセシビリティ / 多言語 / 大型タップ」を選ばなかった場合、新 NFR は **作らない** — 既存 NFR の自然 extend に委ねる。manifest entry も無し)

---

## Axis 5: データ定義 (Data Entity)

**Opening question** (`AskUserQuestion`):
> 「この機能で **新しいデータ** が必要ですか?」

Options (single-select、複合ケースを 1 option として独立提示):
- **新規追加 + 既存変更** (複合: 新エンティティ追加 AND 既存への field 追加 / type 変更を同時に行う。BLE 機能等のように「BleSession 新規 + GameRecord に opponent_type 追加」が同居するケース)
- 新規のみ (新エンティティ / 新フィールド / 新ステートを追加。既存エンティティは触らない)
- 既存変更のみ (既存エンティティに field 追加 / type 変更。新エンティティは作らない)
- 不要 (純粋な UI / 制御ロジックのみ、データ層 touch なし)

> **設計判断**: 旧版は「必要 / 既存変更 / 不要 / 他」の 4 択で複合ケースが Other に押し込まれ decompose の質が低下していた。「Other → 自由記述」では構造化された出力に decompose しにくいため、複合 option を独立 1 択として明示提示する。多くの機能追加 (BLE / GPS / カメラ等のハードウェア系) は new entity + existing field 追加が同居するため、本 option は実質的によく選ばれる。

**Deep-dive** (「新規追加 + 既存変更」「新規のみ」「既存変更のみ」のいずれかが選ばれた場合):
- 新エンティティ部分: 「エンティティ名 + 主要フィールド (3-5 個) + 永続化レイヤー (DataStore / SQLDelight / etc.)」(チャット入力)
- 既存変更部分: 「対象エンティティ + 追加フィールド + マイグレーション手順 (SQLDelight `ALTER TABLE ... ADD COLUMN ...` 等)」(チャット入力)
- 両方該当の場合 (「新規追加 + 既存変更」): 上記 2 つを 1 つの返答で記述してもらう

**出力 (decompose)**: `requirement_changes[]` 追加 (option 別):
- 新規追加 + 既存変更:
  - `doc: 07-data-definition.md` / `section: {新エンティティ名}` / `type: added` / `dependency_category: data_entity`
  - `doc: 07-data-definition.md` / `section: {既存エンティティ名} ({field名} 追加)` / `type: modified` / `dependency_category: data_entity`
- 新規のみ: 上記 added entry のみ
- 既存変更のみ: 上記 modified entry のみ

不要の場合: Axis 5 はスキップ。

---

## Axis 6: 既存機能との関係 (Impact on Existing)

**Opening question** (`AskUserQuestion`):
> 「既存の画面遷移 / UC / 機能への影響を最小化したいですか?」

Options:
- 最小化 (既存画面に integrate、新画面は最小限)
- 自然な拡張 (新画面 / 新 UC を追加、既存は触らない)
- 既存を再構成 (既存 UC / 画面構造を変更する必要あり)
- 他 (free-form)

### 整合性自動チェック — ユーザー意図と decompose 結果の矛盾検出 (Opening question 直後に必ず実行)

ユーザーの選択を受けた直後、Axis 1〜5 で decompose 済の `requirement_changes[]` を走査して「ユーザーの意図と矛盾しないか」を自動チェックする:

```
if ユーザー選択 == "最小化":
  count_modified_existing_F = decompose 結果のうち
    (doc == "05-features.md" AND type == "modified")  # 既存 F-NN 修正
    OR (doc == "04-use-cases.md" AND type == "modified")  # 既存 UC 修正
    OR (doc == "03-user-flow.md" AND type == "modified")  # 画面遷移概念図 / タスク表 / 戻る動作 修正
  の件数

  if count_modified_existing_F >= 2:
    # 「最小化」と「既存修正多数」が矛盾している疑い
    Display warning と再確認:
    > 「『画面遷移最小化』を選択しましたが、Axis 1〜5 で以下の既存仕様の修正が
    >   {N} 件 decompose されています:
    >   - {decomposed entry 一覧 (最大 5 件)}
    >  これは『最小化』の制約と整合しますか?
    >  (A) Yes: 上記修正は既存 UI / フロー要素を物理的に変えず内部挙動 / 文言のみ変更で、
    >          画面遷移概念図 (03-user-flow.md L23-29 等) には影響しない
    >  (B) No: 『自然な拡張』を再選択 (既存修正を撤回 or 別の実装方針へ)
    >  (C) 別意図: free-form で説明」

  elif count_modified_existing_F == 1:
    軽い注意のみ表示 (再選択は要求しない):
    > 「Axis 1〜5 で 1 件の既存修正があります ({entry summary})。
    >   『画面遷移最小化』の範囲内として扱います。」

if ユーザー選択 == "自然な拡張":
  count_modified_existing_F = (同上)
  if count_modified_existing_F >= 1:
    # 「自然な拡張」と「既存修正あり」も微妙に矛盾 (自然な拡張 = 既存は触らない、のため)
    Display warning と再確認:
    > 「『自然な拡張 (既存は触らない)』を選択しましたが、Axis 1〜5 で既存修正が
    >   {N} 件 decompose されています。本当に既存修正を撤回しますか?
    >   (Yes: 撤回 / No: 『既存を再構成』に変更)」

if ユーザー選択 == "既存を再構成":
  チェック不要 (矛盾しない、修正多数を許容する選択肢のため)
```

この自動チェックは **ユーザーの選択意図と decompose 結果の整合性を保証** する。過去事例: ReversiOne BLE 対戦テストで、ユーザーは「画面遷移最小化」を選んだが、Axis 2 で「F-03 を modified (起動 → 即盤面 → ダイアログ経由)」が decompose された。これは「F-03 は modified だが画面遷移概念図には影響する」ケースで、最小化制約と矛盾する可能性があった。本自動チェックがあれば、ユーザーに「F-03 modification は既存遷移概念図にも影響しますが、それでも最小化として扱いますか?」と確認できる。

**Deep-dive**: 「変更を要する既存の UC / F-NN / 画面を箇条書きで (なければ"なし")」(チャット入力 + grep ベース予備チェック)

**出力 (decompose)**: `requirement_changes[]` 追加:
- (「既存を再構成」または変更ありの場合) `doc: 03-user-flow.md` / `section: {影響範囲}` / `type: modified` / `dependency_category: feature_flow`
- (画面遷移最小化制約あり) `doc: 08-constraints.md` / `section: 設計制約` / `type: modified` / `dependency_category: constraint`

---

## Axis 7: フェーズ整合性チェック (Phase Consistency Auto-Detect)

Step 0 で実行した grep 結果を再利用。各ヒット行について:

```
ヒット例:
01-overview.md:35: PoC スコープ: 1 台 hot-seat の 2 人プレイのみ。CPU 対戦 / Bluetooth 対戦 ... は v1 対象外 (Phase 2 候補)
02-scope.md:26: - Bluetooth 対戦 (近距離 2 台)
00-raw-input.md:6: Bluetooth やインターネットを使った対戦機能は将来実装することとし...
```

**判定** (本 skill が LLM 推論で実行):
- ヒット行のキーワード (例: Bluetooth, BLE, 位置情報, カメラ 等) と、Axis 1〜6 で確定した追加機能の主要キーワードを照合
- 矛盾あり (= 機能を v1 に繰り上げるが、既存記述は依然「Phase 2」「将来」と書かれている) → manifest に `type: removed` または `type: modified` を追加
- 矛盾なし → preserve

**00-raw-input.md は対象外** (歴史的ブレスト記録、改竄禁止)。grep ヒットしても manifest entry を作らない。

**出力 (decompose)**: `requirement_changes[]` 追加 (矛盾あり時のみ):
- (例 1) `doc: 02-scope.md` / `section: Phase 2 以降 (v1 対象外) / Bluetooth 対戦 行` / `type: removed` / `dependency_category: scope`
- (例 2) `doc: 01-overview.md` / `section: アプリの位置づけ / PoC スコープ 行` / `type: modified` / `dependency_category: scope`

ユーザーに **発見した矛盾箇所を一覧で提示** し、各箇所について **(a) 削除 / (b) 書き換え / (c) 保留** を `AskUserQuestion` で確認 (該当行が多い場合は plain chat で受ける)。

---

## Step 8: Manifest Decompose

Axis 1〜7 の出力を統合して `requirement_changes[]` 配列を完成させる。

**重複統合**: 同じ `(doc, section)` 組への複数 entry はマージしない (1 セクション = 1 entry 設計、ただし type が異なる場合は別エントリ)。

**`directly_changed_docs` の自動計算**:
```
directly_changed_docs = unique(requirement_changes[].doc)
```

つまり 01b で touch する全ての doc を `directly_changed_docs` に入れる。これは Step 32 で「impacted を ripple する起点ドキュメント集合」になるため、本 skill の出力経由なら **ユーザーが Q2 で起点 doc を選ぶ作業が不要**。

---

## Step 9: change-manifest.json 直接書き出し

```bash
mkdir -p artifacts/{app_name}/req-delta
```

`run_id` の計算は skill 31 Step 4 と同じロジック (`YYYY-MM-DD-NNN` 連番、既存 `req_delta.runs[]` を count)。

```json
{
  "app_name": "{app_name}",
  "run_id": "{YYYY-MM-DD-NNN}",
  "created_at": "{ISO8601}",
  "change_description": "{Axis 1 deep-dive answer}",
  "directly_changed_docs": ["..."],
  "requirement_changes": [
    { "doc": "...", "section": "...", "type": "added|modified|removed", "dependency_category": "..." , "summary": "...", "impact_hint": "..." }
  ],
  "source": "skill-01b"
}
```

`source: "skill-01b"` フィールドを追加: skill 31 がこの manifest を見たときに「既に 01b で生成済」と判断して Step 31 を bypass するための sentinel。

Write to `artifacts/{app_name}/req-delta/change-manifest.json`.

**Snapshot 作成**: skill 31 Step 5 と同じ手順で、全要件ドキュメント (`requirements/` の `NN-*.md`、`00-raw-input.md` を除く) を `req-delta/snapshots/{doc}.snapshot.md` にコピーする (directly_changed に限定しない — skill 33 の相互参照チェックが baseline と現状を同じ母集合で比較できるようにするため)。

**pipeline-state.json への run stub append**: skill 31 Step 6 と同じ Python ブロックを実行 (`req_delta.runs[].run_id / change_description / initiated_at` を append)。本 skill の場合は run_id 命名規則を skill 31 と共有する。

---

## Step 10: Handoff to /ayatori-req-delta (Step 32 から start)

`/ayatori-req-delta` (Phase 1c) の Preamble は change-manifest.json が既に存在することを検出し、`source == "skill-01b"` フィールドを見て Step 31 を bypass、**Step 32 から resume** する。

具体的な Preamble 分岐ロジックの追加は `.claude/skills/ayatori-req-delta/SKILL.md` および `phases/req-delta/SKILL.md` 側で行う (「source: skill-01b の manifest がある場合は Step 32 から start」ルール)。

本 skill の最終出力 (ユーザー向け):

```
✅ 機能追加ヒアリング完了
   追加機能: {feature_name}
   change-manifest.json に {N} 件の requirement_changes を記録
   directly_changed_docs: {list}
   フェーズ整合性: {phase_conflicts} 件の矛盾を検出 (manifest に removed/modified として記録済)

📋 次のステップ: 新しい会話で `/ayatori-req-delta` を実行してください。
   - skill 31 (change-detect) は自動 skip
   - Step 32 (impact-analysis) から start し、人間ゲートで影響範囲を確認
   - Step 33 (revision) で 8 ISO 29148 文書を整合性を保って更新

その後、UI / Figma への反映は `/ayatori-delta` (Phase 5) で実施。
```

---

## Hard constraints

1. **新規プロジェクトでは起動しない** — Phase 1d Preamble Entry guard (CLAUDE.md § 完走後 Phase 共通 Entry Guard 参照 — `baseline_approved_at` の reverse 基線例外を含む) が拒否した場合、本 skill は呼ばれない。万一直接呼ばれた場合の defense-in-depth として、同じ判定 (基線例外込み) を再評価し、拒否時は「⚠️ 本 skill は完走済またはベースライン承認済みプロジェクト用です。新規プロジェクトは `/ayatori-question` を使ってください。」と表示して終了
2. **`00-raw-input.md` を改竄しない** — Axis 7 の grep ヒットで manifest entry を作らない
3. **既存 requirements/*.md を直接編集しない** — 編集は skill 33 (revision) の責務。本 skill は manifest 生成のみ
4. **設計判断 / 技術スタック選定をしない** — Axis 3 でハードウェア要件を聞くが、「BLE のどのプロファイルを使うか」「どのライブラリを使うか」は本 skill のスコープ外 (06-non-functional / 08-constraints が定義する)
5. **ユーザー回答を 1 行で済ませない** — 各 Axis の deep-dive は最低 1 ターン回す。趣旨は「2-3 行回答をそのまま要件にしない」なので、本 skill が ヒアリング深度を担保する
6. **ID 番号 append-only 強制** — 新規 ID (F-NN / UC-NN / NFR-NN / S-NN / AC-NN / Entity N / E-NN) は Step 0 で集計した **既存最大値 + 1 から追加のみ**。既存 ID 番号の **shift (例: F-06 → F-07 ずらし) / renumber (番号付け替え) を含む decompose は禁止**。意味的順序の表現は番号順ではなく section 配置順で行う。本制約により、後続 skill 33 の **相互参照機械検証 (sub-step 4.5)** が grep ベースで成立 (= 削除済 ID 参照の残存 / 新規 ID の参照漏れ / append-only 規則違反、を機械的に検出可能になる)。番号 shift パターンを許容すると shift mapping table が必要になり LLM 精度依存になるため、構造的に shift 不能にする設計を採用

---

## Output

- `artifacts/{app_name}/req-delta/change-manifest.json` (skill 01b 生成、`source: "skill-01b"` 付き)
- `artifacts/{app_name}/req-delta/snapshots/{doc}.snapshot.md` (全要件ドキュメント分、`00-raw-input.md` を除く)
- `artifacts/{app_name}/pipeline-state.json` — `req_delta.runs[]` に run stub append (`initiated_at` 設定済、`impact_approved_at` / `revisions_approved_at` は未設定)

## 参照

- `skills/31-req-change-detect/SKILL.md` — manifest スキーマと run_id 規約を共有
- `skills/32-req-impact-analysis/SKILL.md` — dependency_map (hardware_platform_feature カテゴリ追加済)
- `skills/33-req-revision/SKILL.md` — Consistency rule / フェーズ整合性検証
- `.claude/skills/ayatori-req-delta/SKILL.md` — Preamble に「source: skill-01b の manifest 検出時の Step 31 bypass」ロジックを追加
