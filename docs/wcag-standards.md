# WCAG 2.2 AA 単一正典

AYATORI パイプラインで参照する WCAG 基準・数値閾値・計算式・補正アルゴリズムをこのファイルで一元管理する。
バージョンや閾値を変更する場合は必ずこのファイルだけを更新し、参照元スキルは自動的に追従する。

**参照元スキル**:
- `skills/08-design-brainstorm/SKILL.md` — palette 導出時に閾値を参照（WCAG-aware OKLCH 計算）
- `skills/09-sample-html-gen/SKILL.md` — 生成 HTML の安全網再検証
- `skills/11-wcag-mapping/SKILL.md` — 色非依存制約の確定 + 08 palette の色コントラスト検証
- `skills/17-screen-gen/SKILL.md` — 全画面 HTML 生成時の contrast 遵守
- `skills/18-design-review/SKILL.md` — デザインレビュー時の整合性チェック

---

## 1. バージョン・準拠レベル

| 項目 | 値 |
|---|---|
| WCAG バージョン | **2.2** |
| 準拠レベル | **AA** |

**Phase 2 申し送り**: バージョン・準拠レベルは将来的にプロジェクト単位で上書き可能にする。`wcag-mapping.json.wcag_version` と `.conformance_level` に書き、docs からの値はデフォルトとして扱う設計余地を残す。

---

## 2. 準拠基準一覧（AYATORI 対象）

### 視認性（色・コントラスト）
- **1.4.3 コントラスト（最低限）** — テキストと背景のコントラスト比
- **1.4.11 非テキストコントラスト** — UI コンポーネント境界・アイコン・状態表示

### インタラクション
- **2.4.7 フォーカス可視性** — キーボードフォーカスが視覚的に確認可能
- **2.4.11 フォーカス不可視性（最低限）** — フォーカス要素が他要素で覆われない
- **2.5.8 ターゲットサイズ（最低限）** — タッチターゲットの最小サイズ

### モーション
- **2.3.3 インタラクションによるアニメーション** — prefers-reduced-motion 対応

### フォーム・認証
- **3.3.7 冗長な入力** — 同一セッション内で再入力を求めない
- **3.3.8 アクセシブル認証（最低限）** — 認知パズル・再入力不要

### テキスト
- **1.4.4 テキストのリサイズ** — テキストが200%まで拡大可能
- **1.4.12 テキストの間隔** — 行の高さ1.5倍以上、段落間2倍以上

**W3C 公式**: https://www.w3.org/TR/WCAG22/

---

## 3. 数値閾値（AYATORI 共通）

### コントラスト比

| 対象 | 閾値（AA） | 推奨（AAA） | 根拠 |
|---|---|---|---|
| 通常テキスト on 背景 | **4.5:1** | 7:1 | 1.4.3 |
| 大テキスト on 背景（18pt / 14pt Bold 以上） | **3:1** | 4.5:1 | 1.4.3 |
| 非テキスト UI 要素（ボタン境界・アイコン・状態表示） | **3:1** | — | 1.4.11 |

#### デエンファシステキストの 3:1 緩和ルール（AYATORI 独自）

1.4.3 は通常テキストに 4.5:1 を要求するが、AYATORI では「意図的に背景に退かせる UI ロール」を持つテキスト（補足ラベル・非アクティブナビ項目・サブブランド表示等）について、以下の 3 条件をすべて満たす場合に限り **3:1 に緩和** する。緩和されたテキストは「デエンファシス例外」タグを付与し、合格として扱う。ただし**実測コントラスト比と 1.4.3 非準拠である事実は評価レポートに必ず記録する**こと（緩和 ≠ 削除）。

**3 条件（AND）:**
1. **補足的・装飾的な役割**: タスク完了に必須でない情報（例: 組織名サブテキスト・プレースホルダー相当のラベル・非アクティブ状態の UI ラベル）
2. **同等情報が他の手段で確認可能**: 低コントラストテキストが伝える情報が、高コントラストの別要素（ページタイトル・アクティブ状態の表示等）でも参照できる
3. **意図的に背景に退く UI ロール**: 非アクティブナビ項目・サブブランド表示・ヘルパーラベルなど、視覚的に主要コンテンツより後退することが設計上意図されている

**判定フロー:**
```
テキスト要素を確認
  → 条件 1・2・3 すべて満たす? → Yes → デエンファシス例外（3:1 以上で合格）
                                → No  → 通常の 1.4.3 チェック（4.5:1 必要）

判定:
  デエンファシス例外かつ 3:1 以上 → 合格（「デエンファシス例外」タグ）
  デエンファシス例外かつ 3:1 未満 → 違反
  通常テキストかつ 4.5:1 以上     → 合格
  通常テキストかつ 4.5:1 未満     → 違反
```

このルールに該当するテキストには `color.text-deemphasis` 系トークンを割当てること（17 のトークン参照ルール）。

**AYATORI 採用ポリシー**:
- **エグゼクティブ層向け・重要情報伝達**: AAA 相当（通常テキスト 7:1 以上）を推奨
- **一般業務用**: AA 必達（通常テキスト 4.5:1 以上）
- 文脈判定は `design-brief.yaml common.hearing_interpreted` のターゲット層から 11 が行う

### タッチターゲット

| 条件 | 閾値 | 根拠 |
|---|---|---|
| モバイル主軸アプリ（iOS/Android） | **44×44 px** | iOS HIG 推奨（2.5.8 の 24px を超える AYATORI 独自ルール） |
| Web 管理画面主軸 | **24×24 px**（最低） / **40×40 px**（推奨） | 2.5.8 |

#### ボタン主要/非主要のロールベース分類（AYATORI 独自）

WCAG 2.5.8 はターゲットサイズの最低ラインのみ規定するが、AYATORI では**役割（ロール）ベース**にさらに厳しい基準を適用する。17（画面仕様生成）と 18（レビュー採点）はこの分類で評価する。

**主要ボタン（44px 以上が必須）:**
- ページの主要 CTA（その画面で最も重要なアクション）
- フォーム送信・確定ボタン
- 取り消し不可な操作（承認・却下・削除など権限操作・破壊的操作）
- モーダル・ダイアログ内の確認 / キャンセルボタン

**非主要ボタン（32px 以上を許容）— 以下 3 条件をすべて満たす場合:**
1. **補助的なナビゲーション・表示制御**: ビュー切替（カレンダー/リスト）・週月切替・ページネーション・カレンダー前後ナビ等
2. **操作ミスのリスクが低い**: 誤操作しても取り消し可能、またはデータ損失が発生しない
3. **周囲に十分な余白**: 隣接するインタラクティブ要素との距離が 8px 以上あり、誤タップしにくい配置

**判定フロー:**
```
インタラクティブ要素を確認
  → 主要ボタンの定義に該当する? → Yes → 44px 以上が必須
                                → No  → 非主要ボタンの条件 1・2・3 すべて満たす?
                                          → Yes → 32px 以上で合格（「非主要ボタン」タグ）
                                          → No  → 44px 以上が必要（主要ボタン相当）

サイズ判定:
  主要ボタンかつ 44px 以上   → 合格
  主要ボタンかつ 44px 未満   → 違反
  非主要ボタンかつ 32px 以上 → 合格（「非主要ボタン」タグ）
  非主要ボタンかつ 32px 未満 → 違反
```

### フォーカスリング

| 項目 | 値 |
|---|---|
| 枠線幅 | 2px |
| オフセット | 2px |
| スタイル | solid |
| 色 | `--color-focus-ring` トークン（プライマリカラー相当） |
| 条件 | sticky header/footer に隠れない（2.4.11） |
| scroll-margin-top | 80px（sticky header 対策） |
| scroll-margin-bottom | 96px（sticky footer 対策） |

### タイポグラフィ

| 項目 | 値 |
|---|---|
| モバイル最小フォントサイズ | **12px**（AYATORI 独自規則、可読性確保） |
| モバイル本文推奨サイズ | 14px |
| 大テキスト境界 | 18pt（約 24px）または 14pt Bold（約 18.6px） |
| 行の高さ（line-height） | 1.5 以上（1.4.12） |
| 段落間スペース | フォントサイズの 2 倍以上（1.4.12） |

#### フォントサイズ階層の隣接 2px ルール（AYATORI 独自）

タイポグラフィ階層は隣接する階層間でフォントサイズ差を **2px 以上** 確保すること。1px 差が連続するスケールは「階層が不明瞭」として違反扱いとする。

- NG: 10 / 11 / 12 / 13 / 14px（1px 差連続）
- OK: 12 / 14 / 16 / 20 / 24px（全て 2px 以上）

### モーション

| 項目 | 値 |
|---|---|
| prefers-reduced-motion | **必須対応** — @media で animation/transition を disable |
| 非本質的アニメーション | 250ms 以下なら prefers-reduced-motion 外でも許可 |
| パララックス・大規模モーション | prefers-reduced-motion 有効時は完全 disable |

### フォーム

| 項目 | 値 |
|---|---|
| エラー識別 | 色だけでなく、アイコン＋テキスト併用（1.4.1・3.3.1） |
| 冗長入力防止 | autocomplete 属性で同一セッション内の再入力を回避（3.3.7） |
| アクセシブル認証 | CAPTCHA で認知パズル禁止、autocomplete/password manager 親和（3.3.8） |

---

## 4. 計算式

### 4.1 sRGB → リニア化

W3C 相対輝度計算の前処理。各 RGB チャンネル（0〜255 を 0〜1 に正規化後）に適用:

```
C_linear = C_srgb / 12.92                              (C_srgb <= 0.03928)
C_linear = ((C_srgb + 0.055) / 1.055) ^ 2.4            (C_srgb  > 0.03928)
```

### 4.2 相対輝度 L

```
L = 0.2126 × R_linear + 0.7152 × G_linear + 0.0722 × B_linear
```

L の範囲: 0（真っ黒）〜 1（真っ白）

### 4.3 コントラスト比

```
contrast_ratio = (L_lighter + 0.05) / (L_darker + 0.05)
```

- `L_lighter`: 2色のうち L 値が大きい方
- `L_darker`: 2色のうち L 値が小さい方
- 範囲: 1（同色）〜 21（純黒×純白）

### 4.4 計算例（検証用）

> **数値の出所**: 下表は `scripts/wcag-contrast.mjs`（本 §4 を厳密実装）が生成した値。
> **手計算で更新しないこと** — 色を変えたら `echo '{"cases":[...]}' | node scripts/wcag-contrast.mjs` で再生成する。
> 旧版は手計算由来の誤差があり、`#C5A33C`/`#0C0C0D` を 6.90:1 と誤記していた（実際は 8.08:1。AAA 7:1 判定が覆る差）。
> これが「対比度を手計算 / LLM で見積もると揺れる」実例であり、計算を script に寄せた理由。

| fg | bg | L_fg | L_bg | ratio | 判定（通常テキスト AA） |
|---|---|---|---|---|---|
| `#E8DCC8` | `#141414` | 0.725 | 0.007 | 13.60:1 | ✅ |
| `#C5A33C` | `#0C0C0D` | 0.384 | 0.004 | 8.08:1 | ✅ |
| `#888888` | `#FFFFFF` | 0.246 | 1.000 | 3.54:1 | ❌（AA 不合格） |

---

## 5. OKLCH 補正アルゴリズム（08 / 11 で使用）

### 背景

AP5 検証で確認された通り、HEX を直接微調整すると色相がずれやすい。OKLCH 色空間は **L（明度）・C（彩度）・H（色相）** が知覚に整合しており、**L を変えても色相が保存される**性質がある。WCAG 補正は OKLCH 経由で行う。

### 5.1 補正手順

**補正量の算出は `scripts/oklch-color.mjs solve` が行う（LLM は暗算しない）**。
アルゴリズム詳細の正本は script 本体 + golden eval（`skills/08-design-brainstorm/evals/`）であり、
本節はその人間可読の再掲。skill 08 / 11 は `--margin` を渡さない（既定 0.1 を共有し、両者の
solve 結果が一致することを保証する）:

```bash
node scripts/oklch-color.mjs solve --fg "#8C847C" --bg "#EDE7DC" --required 3
```

solve の決定論アルゴリズム（優先順位は下記のとおり）:

- **目標 ratio = required + 安全マージン（既定 0.1）**。閾値ちょうどに着地させない
  （2.99 vs 3.0 型の閾値ぎわ事故の再発防止）。既に required を満たす pair は補正しない（冪等）。
- **Stage 1: 明度 L のみ調整**（最優先）— fg の L を bg の輝度から離す方向（bg が明るいなら
  fg を暗く、bg が暗いなら fg を明るく）へ動かし、目標を満たす**最小の変化量**を 0.001 刻みで
  算出する。上限: 累積 ±0.15。H（色相）は**完全固定**、C（彩度）は保持。
  目標に届かない場合でも、予算端で required を満たすならその値を採用し
  `margin_not_met: true` を報告する（取れる余裕は全部取る）。
- **Stage 2: 彩度 C を削減**（Stage 1 で解決できない場合）— C を 0.01 刻みで下げて明度調整の
  余地を作り（上限: 累積 −0.05）、各 C で Stage 1 の L 探索を再実行する。H は固定。
- **Step 3: H（色相）は ±0° 固定**（原則）— 色相を変えるとコンセプトが崩壊する。
- **Step 4: トークンの用途変更** — solve が `solved: false` を返した場合の人間 / LLM の判断領域:
  - primary を本文背景 → CTA アクセント専用に降格
  - 本文背景には secondary から別の色を採用
  - `design-brief.yaml cases[X].donts[]` に「primary は CTA のみ使用」と明記

> 旧版は「L ±0.05 刻み / C ±0.02 刻み」の手動手順を定めていたが、この刻み幅は LLM が暗算
> しやすいように置いた足場だった。script 化に伴い**上限（L±0.15 / C−0.05 / H 固定）だけを
> ポリシー**として残し、刻みは「最小補正の決定論算出」に置き換えた
> （例: ShinMemo の 2.99→3.1 補正は必要 dL=−0.009 に対し旧刻みでは −0.05 と 5 倍の過剰補正になる）。

### 5.2 補正上限

| 基準 | 値 |
|---|---|
| 1案あたりの補正反復 | **最大 3 回**（08↔11 ループの attempt 管理は skill 11 の責務。solve 1 呼び出し = §5.1 の 1 パス） |
| 補正量の上限 | L 累積 ±0.15、C 累積 −0.05、H 完全固定（solve が機械的に厳守する） |
| 補正失敗時（solve が `solved: false`） | `violations[]` に `suggested_correction: null` を記録、feedback-log に Pattern B、人間ゲートへ（Step 4 の用途変更を検討） |

### 5.3 補正例

実例（ShinMemo: border vs surface が 2.99:1 で必要 3.0 に 0.01 不足だった違反）:

```bash
$ node scripts/oklch-color.mjs solve --fg "#8C847C" --bg "#EDE7DC" --required 3
# → solved: true / policy_step: 1
#    result.oklch: { l: 0.609, c: 0.015, h: 67.5 }   (元: l 0.618)
#    result.hex:   "#89817A"
#    summary:      "L 0.618→0.609 (-0.009)、C・H 固定 → 3.11:1 (必要 3)"
```

`suggested_correction` には solve 出力の `summary` を**逐語転写**する（数値の再推定・再計算は
禁止 — 検証済み数値は literal で運ぶ）。skill 08 mode B は同じ solve を再実行し `result` の
oklch / hex をそのまま palette に転記する（同一入力・同一既定 margin の決定論なので skill 11 の
提示と必ず一致する。**この一致保証は pair_kind=palette の violation に限る** — domain_surface の
bg 側補正（skill 11 §5.5.4 の fg/bg swap 提案）や skipped は mode B の対象外）。

### 5.4 OKLCH ↔ HEX 変換

**正典実装は `scripts/oklch-color.mjs`**（Björn Ottosson 標準行列。決定論実装であり、
旧版の「Claude の色空間計算能力に依存」を廃止）:

```bash
node scripts/oklch-color.mjs convert --hex "#3B5BDB"
node scripts/oklch-color.mjs convert --oklch '{"l":0.50,"c":0.18,"h":253}'
node scripts/oklch-color.mjs lint brief.json   # design-brief の hex↔oklch 整合検証 (exit 1 = drift)
```

LLM が変換値を暗算・推定してはならない。色域外の oklch は chroma reduction（L・H 固定で C のみ
削減）で写像され `in_gamut: false` が報告される。目視確認の補助には https://oklch.com が使える
（CSS Color 4 と同じ行列なので **gamut 内の色では**本 script と一致する。gamut 外の写像方式は
ツールごとに異なるため一致を期待しない）。

---

## 6. contrast pair 検証対象（11 が計算する組合せ）

### 各案 palette について、以下の組合せ全てを検証

| # | fg | bg | 必要 ratio | 根拠 |
|---|---|---|---|---|
| 1 | `color.on-surface`（本文） | `color.surface` | 4.5:1 | 1.4.3 |
| 2 | `color.on-surface-variant` | `color.surface` | 4.5:1 | 1.4.3 |
| 3 | `color.primary` | `color.surface` | 3:1 | 1.4.11（UI境界） |
| 4 | `color.on-primary` | `color.primary` | 4.5:1 | 1.4.3（CTAテキスト） |
| 5 | `color.focus-ring` | `color.surface` | 3:1 | 1.4.11（フォーカスリング） |
| 6 | `color.border` | `color.surface` | 3:1 | 1.4.11（境界線） |
| 7 | `color.on-bg`（全体テキスト） | `color.bg`（全体背景） | 4.5:1 | 1.4.3 |
| 8 | `state_colors.error.text` | `state_colors.error.bg` | 4.5:1 | 1.4.3（エラーテキスト） |
| 9 | `state_colors.error.border` | `state_colors.error.bg` | 3:1 | 1.4.11（エラーボーダー） |
| 10 | `state_colors.info.text` | `state_colors.info.bg` | 4.5:1 | 1.4.3（情報テキスト） |
| 11 | `state_colors.info.border` | `state_colors.info.bg` | 3:1 | 1.4.11（情報ボーダー） |
| 12 | `state_colors.warning.text` | `state_colors.warning.bg` | 4.5:1 | 1.4.3（警告テキスト、optional） |
| 13 | `state_colors.warning.border` | `state_colors.warning.bg` | 3:1 | 1.4.11（警告ボーダー、optional） |
| 14 | `state_colors.success.text` | `state_colors.success.bg` | 4.5:1 | 1.4.3（成功テキスト、optional） |
| 15 | `state_colors.success.border` | `state_colors.success.bg` | 3:1 | 1.4.11（成功ボーダー、optional） |

- 大テキスト専用トークン（例: hero 見出し）は **3:1** で OK
- large_text 扱いにするには、フォントサイズ 18pt 以上または 14pt Bold 以上が要件
- **state_colors pairs (8-15)**: `required` は error / info、`optional` は warning / success。design-brief.yaml に該当 state が定義されていない場合 (warning/success) は対応 pair をスキップする。

---

## 7. wcag-mapping.json / wcag-history.json への反映（11 が書く構造）

ループ不変量 (`wcag-mapping.json`) と attempt 履歴 (`wcag-history.json`) の 2 ファイルに分離されている。

**wcag-mapping.json**（初回のみ書込・以降不変）:

```json
{
  "app_name": "string",
  "wcag_version": "2.2",
  "conformance_level": "AA",
  "constraints": { /* §3 の値を反映 */ },
  "criteria": [ /* §2 の各基準に対する色非依存ルール */ ]
}
```

**wcag-history.json**（11 が attempt ごとに 1 件 append）:

```json
{
  "app_name": "string",
  "attempts": [
    {
      "attempt_count": 0,
      "timestamp": "ISO-8601",
      "violations": [
        {
          "candidate_id": "a | b | c",
          "criterion_id": "1.4.3 | 1.4.11 | 2.4.7 | 2.5.8",
          "pair": {
            "fg_token": "color.on-surface",
            "bg_token": "color.surface"
          },
          "fg_hex": "#E8DCC8",
          "bg_hex": "#141414",
          "actual_ratio": 4.12,
          "required_ratio": 4.5,
          "suggested_correction": "L +0.08 で 4.68:1 達成見込み"
        }
      ]
    }
  ]
}
```

- 最新 attempt の `violations[]` が空 → 全案 AA 準拠、09 へ進める
- 最新 attempt の `violations[]` に項目あり → `phases/design/SKILL.md` が 08 に差戻す
- `attempt_count` は配列 index と一致（旧 `wcag_loop.attempt_count` は消滅）。`max_attempts` は `pipeline.yaml.design.loop.max_attempts` で参照

---

## 8. Phase 2 申し送り

| 予約フィールド | 目的 | Phase 1 での値 |
|---|---|---|
| `wcag_version` | プロジェクト単位でバージョン変更可能にする | "2.2" 固定 |
| `conformance_level` | AA/AAA 切替 | "AA" 固定 |
| `pipeline.yaml.design.loop.max_attempts` | プロジェクト単位でループ上限調整 | 3 固定 |
| 補正アルゴリズム（OKLCH）の拡張 | HSL/LCH への切替可能化 | OKLCH 固定 |
