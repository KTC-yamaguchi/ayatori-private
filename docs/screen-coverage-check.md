# 画面パターン網羅性チェック — 単一正典

AYATORI パイプラインで「画面が足りていない」「状態のパターンが抜けている」「画面の入口/出口（遷移元・戻り先）が成立していない」事象を**経験値依存せず自動検出**するための基準・判定ロジック・出力分類をこのファイルで一元管理する。
5レイヤー（L1〜L5）の判定基準を変更する場合は必ずこのファイルだけを更新し、参照元スキルは自動的に追従する。

> **レイヤーの 2 系統**: L1〜L4 は「**足りない画面・状態の抜け**」（画面を *追加* すべきか）を見る。**L5 は「既存画面間の入口/出口（到達性・戻り先存在）」**（画面間の *配線* が成立しているか）を見る。両者は remediation が異なる（L1〜L4＝画面追加 / L5＝エッジ・戻り導線・配線の補完）ため、出力構造も分けている（§4-5 / §6 参照）。

**参照元スキル**:
- `skills/14-screen-list-transition/SKILL.md` — 画面一覧生成直後の早期チェック（生成前トークン節約）。L5 も生成時に検出し `.mmd` をインライン補完する（**L5 の主たる修正点 = `.mmd` を所有するため**）
- `skills/17-screen-gen/SKILL.md` — 各画面の該当パターンを仕様書（`{画面名}.md`）に列挙する際の判定基準（§2 / §3 / §4-1〜4-4 のみ参照。列挙結果は Step 25a の sub-state 生成計画の入力になる）
- `skills/19-rubric-score/SKILL.md` — 採点ルーブリックに「画面カバレッジ」カテゴリ追加（`scores.json.current.coverage_check` / `connectivity_check` 生成、Step 20 ループと連動）
- `skills/20-loop-design/SKILL.md` — `ai_improvable_deductions` 計算で `coverage_check.overflow_deduction` + `connectivity_check.deductions_applied` を加算してループ判定に反映（`current.ai_improvable_deductions == 0` で exit）。**L5 の `.mmd` 構造系 defect は `fix_location=mmd_structure` として Step 14 へ route（chrome_plan と同型、ループ自動修正対象外）**
- `skills/21-screen-human-review/SKILL.md` — 人間レビュー時の Tips + 二択ゲート（安全網、`user_indicated_gaps[]` を split ownership で append）。L5 defect も提示する
- `skills/25c-state-pattern-score/SKILL.md` — sub-state 採点時の L1 ui_states 判定基準の参照スペック（sub-state 視点での再評価ロジック）
- `skills/28-impact-analysis/SKILL.md` / `skills/29-partial-screen-regen/SKILL.md` — delta 経路。Step 28 で new/affected 画面の入口/出口要件を構造化列挙、Step 29 で `.mmd` 編集後に L5 validator をゲートとして実行（新規画面の未配線を human gate でブロック）
- `skills/29b-reverse-propagate/SKILL.md` — screen-edit delta 経路。編集が nav（遷移）を変えた場合のみ、編集された画面に scope した L5 connectivity validator（§4-5-4）を実行し `screens/00-coverage-check.json` の `layers.l5_connectivity` に記録

**派生ビュー**: `screens/00-screen-nav.json`（`schemas/screen-nav.schema.json`）= `.mmd` から決定論的に導出する per-screen 入口/出口ビュー。SoT ではなく `.html` と同じ派生物。L5 validator の正規化入力 + 人間がフロー図全体を読まずに 1 画面の in/out を把握する用途。

**仕様起源**: Confluence page [3841098664](https://kinto-dev.atlassian.net/wiki/spaces/mord/pages/3841098664)

---

## 1. 背景と原則

### 1-1. 課題

AYATORI パイプラインで UI を出力した際、以下が経験値任せで検出されている：

- パスワード再設定の **成功状態** 画面（再設定後にどう表示されるか不明）
- フローの **最終ステップ** 画面（送信ボタン・完了画面など）
- ボタン押下後の **アクション結果** 画面（成功・失敗のフィードバック）

これを**自動検知＋誰がレビューしても検出できる**仕組みに平準化する。

### 1-2. 制約

全画面・全状態を生成するとトークン消費が膨らむ。そのため：

- 「本当に画面化が必要なもの」だけを選別
- 画面化が不要なものは Design System（DS）／コンポーネント／既存画面のデータ差し替えで吸収

---

## 2. 判定の3分類（出力分類）

画面化判定後、出力レベルを3つに分類する。

| 分類 | 説明 | 例 |
|---|---|---|
| **DS吸収** | デザインシステム／コンポーネント側に状態を持たせる。画面HTML出力なし | 入力欄の active/inactive/エラー、トースト、文言違いの Empty |
| **テンプレート代表1枚** | 横断的に使い回せるパターンは代表画面1枚のみ出力 | 共通の読み込みエラーダイアログ |
| **個別画面化** | 構造変化が個別画面で発生する場合、その画面ごとに出力 | アクション後の完了画面、Empty 時にセクションが消える画面 |

---

## 3. コンテンツ差し替え原則

画面化要否の判別軸となる独自ルール。

> **「テキスト／コンテンツの差し替えだけで状態が成立するか？」**
>
> - **YES** → 画面化は **不要**（DS 吸収 ／ 既存画面のデータ差し替えで対応）
> - **NO** → 画面化が **必要**（構造・レイアウト・配置が変わる）

### 3-1. 用語定義：動的コンテンツ

> **動的コンテンツ = 動的に差し替わるデータ。UIコードを変更せずに更新できるもの。**

具体例として、以下のような経路で更新されるデータを指す（これらに限らない）：

- CMS や管理画面から入稿されるデータ
- API / サーバから返るデータ
- DB に格納された値

例：カード内の商品名・価格、ニュース記事の本文、ユーザー名、お知らせメッセージ など

### 3-2. 画面化が不要な条件（3類型）

「コンテンツ差し替え原則」で画面化不要となるのは、以下のいずれかに該当する場合。

| 類型 | 説明 | 例 |
|---|---|---|
| **① 動的コンテンツの差し替え** | 上記定義の動的コンテンツを入れ替えるだけで成立する | カード内の文言・値の違い、商品リストの中身 |
| **② DSコンポーネントで吸収** | デザインシステムでバリエーション定義済み | 入力欄の active/inactive/エラー、トースト |
| **③ 仕様書で定義可能な単純テキスト** | UIコードに書く固定文言だが、構造に影響しない短い差分 | エラーメッセージの文面、placeholder |

### 3-3. 画面化が必要な条件

上記のいずれにも該当しない場合 = **UIコードの実装変更が必要なもの** は画面化する。特に注意すべき：

- 構造・レイアウトが変わる（例：Empty 時にセクションごと消える）
- 新規画面が必要（例：アクション後の完了画面）
- ボタンラベルが全く違う語に変わる場合（例：「次へ → 送信」）— テキスト差し替えだが UIコード側で分岐実装が必要なため画面化対象

---

## 4. レイヤーチェック（L1〜L5）

L1〜L4 は各レイヤー共通で「コンテンツ差し替え原則」を適用し、**DS吸収 / テンプレート代表1枚 / 個別画面化** のどれに該当するかを判定する。L5 は別系統（画面間の配線検証、§4-5）。

| Layer | 確認項目 | 由来 |
|---|---|---|
| **L1** | UI状態5パターン（Nothing / Loading / Partial / Error / Ideal）の網羅性。ただし DS で吸収できるものは除外 | Scott Hurff「5 UI States」 |
| **L2** | アクション結果画面の有無（ボタン押下後に状態が変わる系） | 独自（Nielsen「Visibility of system status」が関連） |
| **L3** | マルチステップフロー終端の有無（手順番号最大の画面） | 独自 |
| **L4** | コンテンツ差し替え原則で「差し替えだけでは成立しない画面」の不足検出 | 独自 |
| **L5** | **各画面の入口/出口（遷移元・戻り先）の存在検証**。到達できない画面 / 戻れない画面 / リンク切れ / 未配線画面を検出 | 独自（グラフ到達性 + chrome 階層） |

### 4-1. L1 — UI状態5パターン網羅性

Scott Hurff「5 UI States」を基準に、各画面が以下5状態のうち**画面化が必要な状態**を持つか確認する。

| 状態 | 説明 | 典型的な分類 |
|---|---|---|
| Nothing（空） | データが0件のとき | Empty にセクションごと消える → 個別画面化／文言差し替えのみ → DS吸収 |
| Loading（読み込み中） | API/通信待ち | 共通ダイアログ → テンプレート代表1枚／インライン → DS吸収 |
| Partial（一部のみ） | 部分的にデータがある／途中状態 | 構造変化があれば個別画面化 |
| Error（エラー） | 通信失敗・バリデーション失敗 | 共通エラーダイアログ → テンプレート代表1枚／文言違いのみ → DS吸収 |
| Ideal（理想状態） | データが揃っている通常状態 | デフォルト画面（必須） |

**判定フロー**:
1. 各画面ごとに5状態を列挙
2. 「コンテンツ差し替え原則」を適用して **DS吸収 / テンプレート代表1枚 / 個別画面化** に振り分け
3. **個別画面化** または **テンプレート代表1枚** に該当する状態が **画面リスト／HTML 出力に存在するか** を確認
4. 欠落しているものを抜け候補としてリストアップ

### 4-2. L2 — アクション結果画面の有無

ユーザーがボタンを押した結果、**状態が変わる系**のフィードバック画面が抜けていないか確認する。

**典型的なケース**:
- パスワード再設定 → 再設定**完了**画面
- フォーム送信 → 送信**完了**画面
- 削除操作 → 削除**完了** トースト or 完了画面
- 購入手続き → 購入**完了**画面

**判定フロー**:
1. 画面リスト／遷移図から「アクションを伴う画面（ボタン・送信・確定 等）」を抽出
2. 各アクションの**結果（成功 / 失敗）**を表示する画面の有無を確認
3. 結果が動的コンテンツ差し替えだけで成立するか判定（成立すれば DS吸収 OK）
4. 構造変化を伴う「結果画面」が抜けていればリストアップ

### 4-3. L3 — マルチステップフロー終端の有無

複数ステップで構成されるフロー（ウィザード／オンボーディング／チェックアウト 等）の **最終画面** が抜けていないか確認する。

**判定フロー**:
1. 画面リスト／遷移図から手順番号付き or ステップ表記のある画面群を抽出
2. 「手順 N / N」「最後のステップ」「送信」ボタンが押された後に遷移する画面の有無を確認
3. 完了画面が抜けていればリストアップ

### 4-4. L4 — コンテンツ差し替え原則による不足検出

L1〜L3 で網羅されない部分を「コンテンツ差し替えだけでは成立しないか？」の観点で総ざらいする。

**典型的な抜け**:
- 同じ画面でも **構造が変わる** バリエーション（例：管理者ビュー vs 一般ユーザービュー）
- **ボタンラベルが全く違う語** に変わる画面（例：「次へ」→「送信」）
- 機能フラグ／権限により **配置が変わる** 画面

**判定フロー**:
1. 画面リスト全体を見渡し、「動的コンテンツ差し替えで成立するか？」を各画面に問う
2. NO の場合、その画面が画面リストに含まれているか確認
3. 含まれていなければリストアップ

### 4-5. L5 — 各画面の入口/出口（到達性・戻り先存在）チェック

L1〜L4 が「足りない画面の抜け」を見るのに対し、**L5 は既存の画面同士が正しく配線されているか**を見る。入口（遷移元）・出口（戻り先/前方遷移）が成立していない画面は、到達できない／戻れない＝アプリとして成立しない。**初期生成・ユーザー追加・要件追加（delta）のいずれの経路でも発生し、特に画面追加時に起きやすい**ため、全経路（生成・採点・人間ゲート・delta）で検査する。

#### 4-5-0. SoT と派生ビュー

- **edge（遷移）の SoT は `screens/00-transition-map.mmd` のまま**。L5 は新しい SoT を作らない。
- 各画面の入口/出口は `.mmd` から決定論的に導出する。導出した per-screen 正規化ビューを `screens/00-screen-nav.json`（`schemas/screen-nav.schema.json`）として書き出す（`.html` と同じ派生物。authored 化＝直接編集は禁止、修正は常に `.mmd` へ）。
- validator は `.mmd`（ノード/エッジ）× `00-screen-list.md`（画面集合 + chrome 列）を突合して defect を検出する。

#### 4-5-1. `.mmd` → 入口/出口の導出規則

`.mmd` のグラフから、各 screen 形状ノード（rect）について:
- **entries[]** = そのノードへの inbound エッジ（`{from, via, kind}`）
- **exits[]** = そのノードからの outbound エッジ（`{to, via, kind}`）
- **kind** の決定: ラベルが `戻る` / `キャンセル` / `閉じる` 系、または bidirectional `<-->` → `back` / `close`。外部遷移ノード（trapezoid `[\...\]`）宛 → `external`。終端 → `terminal`。その他 → `forward`。
- `is_entry_point`: 開始ノード（`([...])` stadium = アプリ起動 / deeplink）から直接 inbound を受ける画面 → true。
- `is_terminal`: 外部遷移・アプリ終了など出口を持たないことが意図された画面 → true。

#### 4-5-2. 「自明な戻り省略」規約の narrow（重要）

従来 Step 14 の `.mmd` 生成規約は「全画面からホームへ戻る等の自明な戻りは描かない」だった。これは L5 検証と衝突する（戻りを省くと validator が dead_end を誤検出する）。そこで規約を以下に **narrow** する:

- **省略してよいのは chrome 由来の暗黙遷移のみ**:
  - ボトムタブ間の遷移（タブ親 ↔ タブ親、ボトムナビ経由で自明に相互到達）。
  - ヘッダー B 子画面 → その親への「戻る」（chrome=B が戻るボタンを持つことが保証されている）。
- **それ以外の戻り（モーダル close、ウィザード back、保存後に元画面へ戻る、エラーから再試行で戻る 等）は `.mmd` に明示必須**。

#### 4-5-3. chrome モデルとの連携 — 誤検知回避

§4-5-2 の暗黙遷移を validator に教えることで false-positive を防ぐ。ある画面の到達性/戻れる要件は以下のいずれかで充足とみなす:

- **chrome=A タブ親 ∧ ボトムメニュー=有** → ボトムナビ経由で相互到達可能 →「到達できる」「戻れる」を共に充足。
- **chrome=B 子画面 ∧ inbound forward edge ≥1** → その forward 元が親 → 親への暗黙 back で「戻れる」を充足（同時に `back_target_missing` の親特定にも使う）。
- 上記以外は **明示エッジが必要**（§4-5-2 と表裏一体）。

> **chrome 列が無い legacy / ファストパス / REVERSE_ENGINEERED プロジェクト**では chrome 連携をスキップし、明示エッジのみで検証する（過検出側に倒す）か `user_accepted_gaps` で握る。

#### 4-5-4. 検出ルール（5 種）

`00-screen-list.md` の画面集合 × `.mmd` のノード/エッジ を突合する。

> **突合の順序**: 画面一覧に `遷移図ノードID` 列があれば **ノード ID の完全一致を第一候補**とし、無い行は従来どおり画面名/画面ID の正規化一致 → 一意な包含関係で突合する（いずれも両側一意のペアのみ採用）。ID 列はリバース産の画面一覧（reverse Step 06 E3）が生成時に宣言する任意列で、ラベル語彙が `.mmd` と揃わない場合でも突合できるようにするためのもの（fuzzy マッチは導入しない = 誤マッチを持ち込まない）。forward の Step 14 は本列を付けない。
>
> ID 一致で突合できたノードが**画面以外の形状** (スタジアム等) だった場合は、**画面として扱う** (`.mmd` 生成側は矩形へ昇格し、突合側は検査対象に含める。いずれも warning に記録する) — 「画面かどうかを決める権限は画面一覧にある」ため。昇格しないと、その行は突合済みで消費されるのに glyph は画面でないままなので、当該画面が nav 出力と L5 Rule 3〜5 の**両方から無言で外れる** (= 「欠陥 0 件」ではなく「検査を受けていない」状態になる)。例外は `entry` (アプリ起動の疑似ノード) で、昇格させると `is_entry_point` の判定元が消えて起点から伸びる画面が誤って unreachable になるため warning のみに留める。

| # | defect_kind | 条件 | 起票での呼称 | fix_hint |
|---|---|---|---|---|
| 1 | `dangling_edge` | `.mmd` のエッジが、screen-list に存在しないノードを指す（既知の modal/external 疑似ノードを除く） | リンク切れ（遷移先が存在しない） | `mmd_edge` |
| 2 | `orphan_in_list` | screen-list の画面が `.mmd` にノードとして存在しない | **遷移図に配線されていない（追加時に頻発）** | `wire_new_screen` |
| 3 | `unreachable` | screen ノードの inbound 0 ∧ chrome=A タブ親でない ∧ `is_entry_point` でない | 到達できない画面 | `mmd_edge` |
| 4 | `dead_end` | screen ノードの outbound/戻り 0（chrome 暗黙戻り適用後）∧ `is_terminal` でない | 戻れない画面 | `mmd_edge`（戻り先が決まらない）/ `back_affordance`（戻り先は親で確定するが HTML に戻る導線が無い） |
| 5 | `back_target_missing` | chrome=B 子画面なのに親が特定できない（inbound forward edge 0） | 戻り先不明 | `mmd_edge` |

> **modal/external 疑似ノードの扱い**: `.mmd` の stadium(modal)/trapezoid(external) ノードは screen-list に無くても `dangling_edge` としない（既知の疑似ノードとして validator の許可リストに入れる）。

#### 4-5-5. fix_hint による routing（採点・ループとの接続）

L5 defect の修正先は L1〜L4（＝画面追加）と異なり、多くが `.mmd` 構造である。Step 19/20 は `fix_hint` で routing する:

| fix_hint | 修正先 | Step 20 ループ | scores.json |
|---|---|---|---|
| `back_affordance` | 画面 HTML（戻るボタン等の導線追加） | **自動修正対象**（Step 17 再生成で直る） | `connectivity_check.deductions_applied` に計上 → `ai_improvable_deductions` に加算 |
| `mmd_edge` / `wire_new_screen` | `.mmd` 構造（Step 14 所有） | **対象外**（HTML 再生成では直らない）。`fix_location=mmd_structure` タグで Step 14 へ route（chrome_plan と同型） | `deductions_applied` に含めない。tags[] に記録し Step 21 人間ゲートで提示 |

---

## 5. 判定例

| ケース | 判定 | 出力分類 | 理由 |
|---|---|---|---|
| トーストの文言違い | 不要 | DS吸収 | コンテンツ差し替えで成立 |
| 入力欄の active/inactive/エラー | 不要 | DS吸収 | コンポーネントで状態定義済 |
| Empty: 同じカード枠で文言だけ違う | 不要 | DS吸収 | コンテンツ差し替えで成立 |
| 共通の読み込みエラーダイアログ | 必要 | テンプレート代表1枚 | 各画面ごとではなく代表画面1枚で十分 |
| Empty: セクションが消える or 別レイアウトになる場合 | 必要 | 個別画面化 | 構造変化 |
| アクション後の完了画面（例：入力成功画面、購入完了画面） | 必要 | 個別画面化 | 新規構造 |
| ボタンラベルが「次へ → 送信」に変わる | 必要 | 個別画面化 | テキスト変更だが UIコード分岐実装が必要 |

---

## 6. AI 出力フォーマット

以下の JSON 形式で `00-coverage-check.json` に**抜け候補（L1〜L4 の `missing[]`）を出力するのは Step 14 の通常経路のみ**。Step 19 は同じ L1〜L4 判定基準で再評価するが、出力先は `scores.json.current.coverage_check`（別構造、`schemas/scores.schema.json` 参照）であり本フォーマットでは出力しない。個別 field の追記 writer（21 / 29 / 29b）は §6-1 の表を参照。

**リバース経路（Phase 0b の Step 06 E6 / Step 14 の REVERSE_ENGINEERED ファストパス / 14-lite）も同じファイルの writer** だが、書くのは **L1〜L4 が空の stub + `user_accepted_gaps: true`**（=「L1〜L4 の早期チェックを実施していない経路由来」の印）であり、抜け候補の判定はしない。空の `missing[]` を「欠陥なし」と読まないこと — L1〜L4 の判定は Step 19 / 21 の安全網に委ねる。stub の JSON 形の SoT は `skills/14-screen-list-transition/SKILL.md`「事前チェック: REVERSE_ENGINEERED ファストパス」節。いずれの経路でも `layers.l5_connectivity` / `summary.connectivity_defects` は `scripts/validate-connectivity.mjs --write` が patch する。

```json
{
  "coverage_check": {
    "checked_at": "2026-05-13T12:00:00Z",
    "scope": "screen_list | full_html",
    "layers": {
      "l1_ui_states": {
        "missing": [
          {
            "screen": "ホーム",
            "state": "Empty",
            "classification": "個別画面化",
            "reason": "データ0件時にセクションごと消える構造変化"
          }
        ]
      },
      "l2_action_result": {
        "missing": [
          {
            "screen": "パスワード再設定",
            "trigger_action": "再設定ボタン押下",
            "classification": "個別画面化",
            "reason": "再設定完了画面が抜けている"
          }
        ]
      },
      "l3_flow_end": {
        "missing": [
          {
            "flow": "オンボーディング (1/3 → 2/3 → 3/3)",
            "missing_screen": "完了画面",
            "classification": "個別画面化",
            "reason": "手順最大ステップの後に遷移する画面が画面リストに存在しない"
          }
        ]
      },
      "l4_content_replace": {
        "missing": [
          {
            "screen": "ダッシュボード（管理者）",
            "classification": "個別画面化",
            "reason": "一般ユーザービューと構造が異なるが画面リストに別画面として存在しない"
          }
        ]
      },
      "l5_connectivity": {
        "defects": [
          {
            "screen": "再設定完了",
            "defect_kind": "dead_end",
            "detail": "outbound エッジが .mmd に無い。完了後どこに戻るか未定義（戻れない画面）",
            "fix_hint": "mmd_edge"
          },
          {
            "screen": "08-notification-detail",
            "defect_kind": "orphan_in_list",
            "detail": "screen-list に追加されたが .mmd にノードが無く、どの画面からも開けない（未配線）",
            "fix_hint": "wire_new_screen"
          }
        ]
      }
    },
    "summary": {
      "total_missing": 4,
      "by_classification": {
        "個別画面化": 4,
        "テンプレート代表1枚": 0,
        "DS吸収": 0
      },
      "connectivity_defects": 2
    }
  }
}
```

**重要**: `DS吸収` に分類されたものは `missing` には含めない（画面化不要のため）。`missing` には **個別画面化** または **テンプレート代表1枚** が必要なのに画面リスト／HTML に存在しないものだけを記載する。`l5_connectivity.defects[]` は L1〜L4 の `missing[]`（足りない画面）とは独立で、`summary.connectivity_defects` に件数を別集計する（remediation が異なるため `total_missing` には合算しない）。

### 6-1. 任意フィールド (split ownership)

上記 4 必須フィールド (`checked_at` / `scope` / `layers` / `summary`) の他に、step ごとに独立 writer を持つ任意フィールドを持つ。`layers.l5_connectivity` も任意（legacy artifact 後方互換のため schema の required には含めない）。詳細スキーマは `schemas/coverage-check.schema.json` 参照。

| フィールド | 型 | writer | 用途 |
|---|---|---|---|
| `coverage_check.user_accepted_gaps` | boolean | Step 14 (`14-screen-list-transition`。ファストパス / 14-lite も同じ writer) / リバース経路は Phase 0b の Step 06 (`06-format-convert` の E6-4) も stub 生成時に書く | 抜け候補があっても user が「現状のまま」を選択した場合 `true`。リバース経路の stub では「L1〜L4 の早期チェック未実施」の印として `true` を書く（誰が書いたかではなく「L1〜L4 が未実施」だけを意味する） |
| `coverage_check.user_indicated_gaps[]` | array | Step 21 (`21-screen-human-review`) | 全画面 HTML レビューで user が指摘した不足画面のリスト。要素は `{indicated_at, description, related_layer}` |
| `coverage_check.layers.l5_connectivity.defects[]` | array | Step 14 (`14-screen-list-transition`。ファストパス / 14-lite も同じ writer) / リバース経路は Phase 0b の Step 06 (`06-format-convert` の E6-4) / requirement delta は Step 29 (`29-partial-screen-regen`) / screen-edit delta は Step 29b (`29b-reverse-propagate`、編集画面 scope)。**Step 14 (ファストパス / 14-lite) と Step 06 (E6-4) は writer 実体が `scripts/validate-connectivity.mjs --write`** (`summary.connectivity_defects` と 2 key 同時に patch し他 layer は保全)。**Step 29 / 29b は §4-5-4 の 5 ルールを LLM が適用して記録する** (script は編集画面への scope 指定を持たないため) | 各画面の入口/出口（到達性・戻り先）の違反一覧。要素は `{screen, defect_kind, detail, fix_hint}` |

> 同一 JSON ファイル内だが **keys が完全に分離** されているため、docs/artifact-file-responsibility.md 設計原則 3「単一所有権」の split-ownership 例外に該当 (key conflict なし)。`layers.l5_connectivity` のみ 06 (E6) / 14 (通常経路・ファストパス・14-lite) / 29 / 29b が共有するが、create と delta は step 実行が排他的、29 と 29b は delta の排他モード (requirement / screen-edit) で同一 run に同居しないため、こちらも競合しない。リバース経路の 06 → 14 (ファストパス / 14-lite) は同一プロジェクトで両方走りうるが **Phase 0b → Phase 3 の一方向で時系列に排他** であり、かつ 14 側は「既存ファイルがあれば stub を書かず L5 のみ refresh する」契約なので 06 の記録を潰さない。

---

## 7. パイプラインへの統合

新 Step は追加せず、既存 Step に組み込む。

| 挿入位置 | 役割 | 目的 |
|---|---|---|
| **Step 14（画面リスト作成）直後** | 画面リスト時点で AI が L1〜L4 を早期チェック + L5 connectivity を検出し `.mmd` をインライン補完 + `00-screen-nav.json` 派生生成 | 生成前に抜け・未配線を検出 → Step 17 の生成漏れ・到達不能画面を予防、**トークン節約に直結** |
| **Step 19（ルーブリック採点）に組込み** | 採点項目に「画面カバレッジ」カテゴリを追加し、L1〜L4 観点 + L5 connectivity 観点で減点判定 | 採点基準として常に問われるので漏れない。閾値割れなら Step 20 のループで自動再生成（L5 の HTML 系のみ、`.mmd` 構造系は Step 14 へ route） |
| **Step 21（画面人間レビュー）に組込み** | Tips提示 + Yes/No 二択ゲート + L5 defect 提示 | AI が見落とした分の安全網 |
| **Step 28 / 29（requirement delta）に組込み** | Step 28 で new/affected 画面の入口/出口要件を構造化列挙、Step 29 で `.mmd` 編集後に L5 validator をゲート実行 | **画面追加時の未配線（最頻発ケース）を delta 経路で確実に検出** |
| **Step 29b（screen-edit delta）に組込み** | パイプライン外で手編集された画面の nav 変更時、編集画面に scope した L5 validator（§4-5-4）を実行し `layers.l5_connectivity` に記録 | 手編集が遷移を壊していないか（リンク切れ・戻り先喪失）を検出し、人間ゲートに提示（HTML の自動修正はしない） |

---

## 8. 期待される効果

- 経験が浅いレビュアーでも、AI の抜け検出 + 二択ゲートで品質を担保できる
- DS 吸収・テンプレート 1 枚・個別画面化の3分類により、必要なものだけを出力 → トークン消費を抑制
- 経験者依存からの脱却
- **L5 により「到達できない画面 / 戻れない画面 / リンク切れ / 未配線画面」を生成・採点・delta の全経路で機械検出 → アプリとして成立しない画面の流出を防止**
