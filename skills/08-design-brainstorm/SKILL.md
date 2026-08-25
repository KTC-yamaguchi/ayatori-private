---
name: 08-design-brainstorm
description: 6+1 軸ヒアリングを行い、要件定義と照らし合わせて 3 つのデザイン方向性案（コンセプト・palette・typography・motion・anti-slop）を確定する。Phase 2 の Step 08 で呼ばれ、WCAG 検証ループでは前回違反を読んで palette を OKLCH で補正して再生成する。
---

# 08 デザインブレスト（ヒアリング + 3案方向性 + palette OKLCH導出）

## 役割

6+1軸ヒアリング（illustration_policy は confirm のみ）を行い、要件定義と照らし合わせて **3つのデザイン方向性案** を生成する。各案について、コンセプト・palette（HEX確定値）・typography・motion・anti-slop を **すべて08内で確定** させる。HTMLは生成しない（09の責務）。

**ループ時の挙動**: 前回 11 が `wcag-history.json.attempts[-1].violations[]` に記録した違反を読んで、該当 palette token を OKLCH L値で補正して再生成する (旧 wcag-mapping.json.violations から rename)。

**次ステップ**: `skills/11-wcag-mapping/SKILL.md` を Read して 11 を実行（色非依存WCAG制約 + 08 palette の色コントラスト検証）。

## 前提条件
- `artifacts/{app_name}/requirements.json` および `requirements/01〜08-*.md` が存在
- `docs/wcag-standards.md` から AA 閾値・OKLCH補正アルゴリズムを参照
- `docs/html-generation-rules.md` から HTML生成ルール（anti-slop 連携）を参照
- **外部プラグインへの依存なし**: Phase 2 の aesthetic direction 言語化は AYATORI 内部で完結する（08 自身がエージェントとして 3 案を生成する）

---

## エージェントプロンプト

**あなたは UX / ブランドデザインのシニアコンサルタント × 色彩理論エンジニアです。**

ユーザーのデザイン好みをヒアリングし、要件定義の文脈（ターゲット層・課題・機能）と組み合わせて、**3つの明確に異なる方向性案** を生成してください。各案について color palette を OKLCH 空間で WCAG 2.2 AA 遵守になるよう導出し、HEX まで確定させます。

### ヒアリングの原則

ユーザーが言ったことを「そのまま案に反映」しない。回答と要件定義の文脈を**組み合わせて昇華**させる。
ただし **昇華してよいのは解釈が一意に定まる場合だけ**。回答が複数の解釈に割れる (N≥2) なら、勝手に 1 つへ
畳まず下記 disambiguation で確認してから案に反映する。

**例（やってはいけない独断）**: ユーザー「シンプルな感じで」を、要件「エグゼクティブ向け」だからと
**勝手に「高級感」と断定**するのは NG（「シンプル」は ミニマル / 低彩度 / 余白大 / 高級感… のどれか不定 = N≥2、
ユーザーは「高級感」とは言っていない）。→ 解釈候補を列挙して確認する。

### Operating Principle 4 — Disambiguation（本 step = input 受領 / flavor a）

本 step はユーザーのヒアリング回答を解釈する **input 受領 step**。Phase 2 で design-brief.yaml の
世界観・トーン・カラー方向を確定する **直前** に、`docs/principle4-disambiguation.md` §1 の
4-step を実行する:

1. ヒアリング回答（トーン / ブランド方向 / カラーイメージ / 参考アプリ / 避けたいスタイル）の解釈候補を列挙。
2. 書き出した解釈候補が N≥2 に割れたら (D) UNCERTAIN。
3. 3 分類（semantic 複数解釈 / softening 確信度低 / enumeration 開いた列挙）でラベル付け。
4. `artifacts/{app_name}/pending-questions.json` に append（target / question / options[解釈候補] /
   ambiguity_kind / raised_by_step="08-design-brainstorm" / raised_at [ISO 8601]。⚠️ 必須 field
   `target` / `question` / `raised_by_step` / `raised_at` を省くと hook R3 が exit 2 で Write を弾く）。
   append する entry に **`reflect_to`（回答の反映先 artifact の相対パス）は書かない** — 本 step の反映先
   `design-brief.yaml` を受け付ける門は Phase 2 の入口だけで、**本 step は中断しない**ため
   (09 / 25b と違って「反映先を持つ phase へ user を戻す resume 指示」を出せない)、宣言すると Phase 2 を
   完走した run では二度と ask されず永久に持ち越される。未設定 = 次の門で必ず ask される従来挙動
   （`skills/_shared/preflight-gate.md` § append 経路の 2 択のうち (b)）。
   直接 AskUserQuestion せず Pre-flight Gate で batch propose する。

**HIGH 曝露 step のため必須**: 検討の結果 UNCERTAIN が無くても自己点検した上で Write する
（曖昧な解釈を黙って畳んで Write しない）。質問する基準は `docs/principle4-disambiguation.md` §2。

### 3案の差別化原則（機械的ルール）

- `palette.primary` の OKLCH 色相 H が3案で **30°以上** 異なる
- `typography.family_display` が3案ですべて異なる
- `motion_profile.signature_animation` が3案ですべて異なる

違反があれば Phase 6 で修正。

---

## 実行指示

### Phase 0: ループ時の補正モード判定（初回はスキップ）

`artifacts/{app_name}/wcag-history.json` を Read し、`attempts` 配列から以下を導出して 2 モードに分岐:

```
attempts             = wcag-history.json.attempts (なければ空配列)
last_violations      = attempts[-1].violations if attempts else []
attempt_count_snap   = len(attempts) - 1 if attempts else 0
```

#### モード A: 初回実行モード
**条件**: `wcag-history.json` が存在しない、または `attempts` が空、または `last_violations` が空。

**手順**: Phase 1（6+1軸ヒアリング）から順に Phase 7 まで実行。

#### モード B: ループ再実行モード
**条件**: loop 対象 violation (`pair_kind ∈ {palette, domain_surface}`) が空でない (= 11 が直前 attempt で違反を検出し、08 に差戻した状態)。

**スキップする Phase**: 1 / 2 / 4 / 5（6+1軸ヒアリング・世界観決定・タイポグラフィ選定・ダイヤル設定）。

**実行する Phase**: 3（palette / domain surface の hex 補正のみ）→ 6（anti-slop 再チェック）→ 7（上書き保存）。

**既存情報の転写**: 既存 `artifacts/{app_name}/design-brief.yaml`（3案版）を Read し、以下を**そのまま再利用**（新規生成しない）:
- `common`（ヒアリング回答・昇華結果・UI 表現制約・対象プラットフォーム）
- 各 case の `label` / `archetype` / `concept` / `differentiation`
- 各 case の `narrative.*`（visual_theme / target_fit / component_stylings / depth / agent_prompt_guide）
- 各 case の `typography` / `dials` / `signature_animation` / `depth` / `layout` / `donts` / `agent_prompt_guide`
- `differentiation_summary` / `anti_slop_check`

**補正する要素**: loop 対象 violation（`pair_kind ∈ {palette, domain_surface}` かつ `skipped` でないもの）— orchestrator (`phases/design/SKILL.md` ⚙️ Loop Decision) が 08 に渡す集合と同一 (domain_surface は追加済 — skill 11 §5.5.3 で宣言した loop trigger 集合が Loop Decision と本モードに未反映だった更新漏れの是正)。state_colors (warn-only、Step 17/21 経路) / skipped (fg_hex が null、solve 不能) は本モードでは扱わない。pair_kind ごとに転記先と solve の向きが異なる:

**(a) `pair_kind == "palette"`** — 転記先は該当 `palette.tokens[]`。各 violation について `scripts/oklch-color.mjs solve` を再実行し、出力 `result` の `oklch` / `hex` を該当 palette token に**そのまま転記**する（同一入力・同一既定 margin なので、この palette 経路では 11 が suggested_correction に書いた数値と必ず一致する。自分で補正量を暗算・再計算しない）:

```bash
node scripts/oklch-color.mjs solve --fg "{violation.fg_hex}" --bg "{violation.bg_hex}" --required {violation.required_ratio}
```

**(b) `pair_kind == "domain_surface"`** — 転記先は `violation.pair.bg_token` と一致する `name` を持つ `palette.domain_surfaces[]` entry の `modes[]` のうち `violation.mode` に対応する `hex` / `oklch`（bg_token = surface.name の対応関係は skill 11 §5.5.2 の `lookupDomainSurfaceHex` に一致）。fg (palette token) は pairs 1-7 と共有されるため動かさず、**bg (domain surface) 側を動かす**（skill 11 §5.5.4 の主提案と同じ方向）。contrast は対称なので solve の fg/bg を**入れ替えて**実行し、bg 側の最小補正を得る:

```bash
node scripts/oklch-color.mjs solve --fg "{violation.bg_hex}" --bg "{violation.fg_hex}" --required {violation.required_ratio}
```

出力 `result` の `oklch` / `hex` を該当 mode の surface に**対で**そのまま転記する（fg 側 = `palette.tokens[]` は変更しない。hex と oklch を対で転記するのは Phase 7 の oklch lint self-check を通すため）。`solved: false` の場合は skill 11 §5.5.4 の代替案（fg が可変 token なら fg 側補正 / どちらも不可なら surface 再定義）を suggested_correction から確認し、解けなければ violation を残す（ループ上限到達後は Step 10 人間ゲートで判断）。

共通: `--margin` は渡さない（既定 0.1。skill 11 側も渡さないことで両者の一致が成立する）。palette 経路で `solved: false` の場合は `docs/wcag-standards.md` §5 Step 4（トークンの用途変更）を判断する。転記後、`palette.loop_correction_history[]` に補正 entry を append し、`palette.oklch_derivation_note` の末尾に補正経緯の 1〜2 文を追記する（prose 履歴）。

> 注意: 補正した token が **別の pair の bg 側** に現れる場合（例: primary を暗くすると on-primary vs primary が悪化）、次の attempt で新規 violation が出ることがある。これは solve が単一 pair を解く設計（複数 pair 同時充足は H-1 の scope）による正常動作で、08↔11 ループ（上限 3 回）が安全網として捕捉する — Pattern B（エージェントのミス）として記録しない。

**attempt_count の扱い**: ループカウンタは `len(wcag-history.json.attempts)` から導出される値であり、本ファイルには持たない。**08 側では wcag-history.json を一切触らない** (単一所有権: 11 のみが append する)。08 は導出値を Phase 7.1 frontmatter に snapshot として記録する。

#### モード C: REVERSE_ENGINEERED ファストパスモード
**条件**: Phase orchestrator が `reverse_handoff_active = true` を設定済み
（= `requirements.json.status == "REVERSE_ENGINEERED"` かつ
`pipeline.yaml.reverse_handoff.skip_rules.design.skip == "discovery_hearing"`）。
state SoT は `requirements.json.status` のみ。`session-handoff.md` は state 判定には使用しない (human-readable summary)。

**スキップする Phase**: Phase 1（6+1軸ヒアリング）のみ。

**実行手順**:
1. `artifacts/{app_name}/requirements.json` を Read — `app_name`・機能・プラットフォーム・制約をデザインコンテキストとして使用
2. `artifacts/{app_name}/tokens.json`（Phase 0b 基礎）を Read
   tokens.json は Step 06 が生成した基本カラー構造（フル OKLCH パレットではない）
3. 3つのデザイン方向性を生成:
   - **提案A** = tokens.json の既存カラー値の色相を OKLCH パレットに昇華
   - **提案B・C** = 独立して導出（既存トークンに縛られない新しい色相）
4. 全3案に対して OKLCH 導出 + AA コントラストチェックを実行（通常フローと同一）
5. **illustration_policy 確認** — Phase 1 をスキップするため、ここで代わりに実行する（Phase 1 Axis 6 +1軸と同等）:
   a. `requirements.json.design_output_scope.illustration_policy` を Read する
   b. AskUserQuestion で確認:
      「イラスト方針は『**{policy label}**』に設定されています（Step 02 より）。このデザイン方向性と合っていますか？」
      `pictogram` → ピクトグラム / アイコン系, `illustration_character` → キャラクター・イラスト系, `emoji_casual` → 絵文字 / カジュアル系
      → 選択肢: そのまま使う / 変更する
   c. 「変更する」の場合: 3択セレクター表示（pictogram / illustration_character / emoji_casual）
   d. 確定値をセッション内変数として保持する（Phase 7 の `common.ui_constraints.illustration_policy` 書き込みで使用する）。**design-brief.yaml への早期書き込みは行わない** — Phase 7 が完全な yaml を生成する際に正しい値を含めるため
   e. `requirements.json` に `illustration_policy` が存在しないレガシープロジェクト: `pictogram` をデフォルトとして提示
6. **Phase 2.1（世界観確定）から実行を再開**: 3案はステップ1〜4で確定済みのため、
   Phase 2.0.2（aesthetic direction生成）は**再実行しない**。
   Phase 2.1 以降（世界観確定 → Phase 3 アンチスロップ → Phase 4 タイポグラフィ → Phase 5 モーション → Phase 6 承認 → Phase 7 出力）を通常どおり実行。
   - **注記**: mode C は Phase 2.0.3（Layout-Descriptor Distinction の crisp 自己判定）を経由しないが、Phase 7.3 で各 case に `layout.descriptor` を宣言する点は通常フローと同じ（7.5 自己検証も実行）。万一 mode C で記述子が潰れても、**Step 09 orchestrator の再導出チェック（Phase 3.6）がバックストップ**として機械検出する。

**フォールバック**: `artifacts/{app_name}/tokens.json` が存在しない場合はモード A にフォールバックし、
通常の初回ヒアリングを実行する。

### Phase 1: 6+1軸ヒアリング

`artifacts/{app_name}/requirements.json` を読んだ上で、以下の6軸を1軸ずつ AskUserQuestion で質問し、最後に illustration_policy を confirm する（+1軸）:

```
【デザインブレスト 08】

要件定義が完了しました。次にデザインの方向性を決めます。
7つの質問に答えてください（1つずつ聞きます）。

質問1/7: ブランド方向性
このアプリに感じてほしい印象・パーソナリティは？
例）「プロフェッショナル」「フレンドリー」「ミニマル」「エネルギッシュ」「信頼感」
```

6+1軸:
1. **ブランド方向性** — アプリに感じてほしい印象・パーソナリティ
2. **トーン&ムード** — 色の雰囲気（明るい/落ち着いた/モノクロ系/カラフル等）
3. **カラーイメージ** — 好きな色・避けたい色（具体的な色名でOK）
4. **参考アプリ** — 「このアプリのUIが好き」という具体的なアプリ名
5. **避けたいスタイル** — 「こういうデザインはNG」
6. **UI表現制約** — 絵文字可否・アイコンスタイル・数値の表記方針、イラスト方針確認

   After collecting emoji / icon_style / numeric answers, also surface the illustration policy:

   a. Read `artifacts/{app_name}/requirements.json` → `design_output_scope.illustration_policy`
   b. Present to the user as a pre-filled answer:
      「イラスト方針は『**{policy label}**』に設定されています（{source: 01-question より / Step 02 より}）。このデザイン方向性と合っていますか？」
      Where {policy label}: `pictogram` → ピクトグラム / アイコン系, `illustration_character` → キャラクター・イラスト系, `emoji_casual` → 絵文字 / カジュアル系
      Where {source}: 判定は `requirements.json.status` で行う — `"REVERSE_ENGINEERED"` → `Step 02 より`; それ以外 → `01-question より`
      → AskUserQuestion: そのまま使う / 変更する
   c. If 「変更する」: show 3-choice selector (pictogram / illustration_character / emoji_casual)
   d. If 「そのまま使う」: carry the value through unchanged
   e. Store the confirmed value as an in-session variable for use in Phase 7 `common.ui_constraints`. **Do not write to `design-brief.yaml` early** — Phase 7 writes the complete yaml and must use this confirmed value (not the template default `"pictogram"`).

   If `requirements.json` does not have `illustration_policy` (legacy project): default to `pictogram` and present it as the pre-filled option.

### Phase 2: 3案の世界観決定（AP4哲学 + aesthetic direction 言語化）

<!-- Phase 2.0 のプロンプト設計は以下 2 ソースの原則・構造を参考にした独自実装である。
     原典を literal にコピーしておらず、具体的な語彙・分類・命名は AYATORI 文脈に合わせて独自に書き下ろしているため、
     法的には Derivative Work に該当しない「inspired by」の関係と認識している。
     仮に将来 Derivative Work と解釈される余地がある場合に備え、保守的立場から両ライセンス原文を同梱し、
     参考元を帰属表示している。
     - Anthropic Frontend Aesthetics Cookbook
       (https://github.com/anthropics/claude-cookbooks, © 2023 Anthropic, MIT License)
       → 全文は `licenses/anthropic-cookbooks-MIT`
     - Anthropic Frontend Design Plugin (Claude Code)
       (© Anthropic, Apache License 2.0)
       → 配布バンドル同梱の LICENSE を `licenses/frontend-design-Apache-2.0` に複製 -->

#### 2.0.1 入力整理

`artifacts/{app_name}/requirements.json` と `requirements/01〜08-*.md` を **Read** し、以下を内部変数として整理する（以降のプロンプト生成でこの変数を明示的に参照する）:

- `context_bundle`: app_name / ターゲット層 / 解決する課題 / 対象プラットフォーム / 対象画面数
- `hearing_answers`: Phase 1 で得た 6 軸の回答（raw）
- `hearing_interpreted`: 各軸について「回答 | 要件文脈と照合した再解釈（1 文）」を併記した表。冒頭「ヒアリングの原則」で述べた "昇華" を適用する
  - 例: 「シンプルな感じで」(raw) × 「トヨタエグゼクティブ向け」(要件) → 「高級感・信頼感を伴うシンプル（Apple 的な minimalism）」と再解釈
- `themes_required` (NFR-39〜41 検出): `requirements.json.design_output_scope.dual_theme_mode` を **直接 read** する (`schemas/requirements.schema.json` の strict zone `additionalProperties: false` 内に boolean 化済)。マッピング:
  - `true` → `themes_required = ["dark", "light"]` (両モード対応、pipeline はどちらも primary 扱いせず対称生成。OS preference 追従 + HTML `data-theme` 明示で上書き可能)
  - `false` → `themes_required = ["light"]` (**単一モード、デフォルト light**。業界慣行に整合 — dark default から flip 済)
  - **未定義 (legacy プロジェクト)**: `false` 扱い → `themes_required = ["light"]` (全層で「mode 不在 = light」の解釈に統一)。flip 前の 5 案件 (DecisionPath / 15Puzzle / AmidaPick / TournamentBracket / KAGEMUSHA) は当時 single-mode dark 前提で生成されており、**frozen artifacts のまま使う限り影響なし**。再走させる場合は `requirements.json.design_output_scope.dual_theme_mode: true` を明示追加 + design-brief.yaml の `palette.tokens[]` 全 entry に `mode: "dark"` (もしくは両モード値) を明示追加して再生成すること。06-non-functional.md の文言を grep する fallback は **持たない** (regex 依存を排し、確実な伝搬経路を保つため)
  - 本値は yaml の `common.themes_required` フィールドに転写する (skill 11 / skill 12 がここを read)。要件 SoT は `requirements.json` だが、Phase 2 ローカルでの参照便宜のため design-brief.yaml にもコピーする (cross-phase コピーは pipeline-state.json と同型の運用)

#### 2.0.2 aesthetic direction 素案の生成

あなた自身（08 を実行している Claude）が、外部スキルを呼び出すことなく 3 案の aesthetic direction を言語化する。以下の原則を 3 案すべてに適用する。

##### A. 中核原則（4 軸を個別に誘導する）

Typography / Color & Theme / Motion / Background の 4 軸を **案ごとに独立して言語化** する。1 軸を忘れる・他案から流用する・曖昧に済ませる は不可。

##### B. 既定収束からの離脱

何も制約しなければ生成は特定の書体・配色・レイアウトに収束する傾向がある（AI が学習した「無難な SaaS 画面」の引力）。以下の既定収束先は 3 案すべてで採用しない:

- 書体: Inter / Roboto / Arial / Open Sans / Lato / Space Grotesk / system-default
- 色/背景: 白背景に紫〜ピンクの斜めグラデ / `#000000` 純黒
- レイアウト: 等分 3-col grid / 中央揃えヒーロー + CTA 2 個の定型

##### C. 抽象語を禁じて具体参照で語る

「クリーン」「モダン」「直感的」「スタイリッシュ」等の抽象語で終わらせない。代わりに、以下のような具体物を必ず指名する:

- 既存の配色テーマ（IDE の Dracula / Nord / Gruvbox、色見本帳の PANTONE 番号 等）
- 文化・時代文脈（和の間・北欧・アールデコ・ブルータリズム・昭和のタイプライター 等）
- 特定書体・素材・質感（金箔 / 漆 / 未晒し和紙 / 磨きアルミ 等）

##### D. 支配色 + 差し色の 2 層構造

色を 3〜4 色に均等に散らす palette は画面全体の圧が平坦になり、記憶に残らない。代わりに **面積を占める支配色 1 色** と **点で差し込む差し色 1 色** の 2 層に分離する。色の方向性は「支配色」と「差し色」を別々に言語化する（例：支配色＝墨黒 / 差し色＝金箔 1 ストローク）。

##### E. Motion は 1 本に集中

細かいマイクロインタラクションを画面全体に散布する戦略は取らない。代わりに **各案ごとに signature animation を 1 本だけ定義** し、そこに演出予算を集中させる。配置先はページロード時の staggered reveal、または primary CTA 周辺のいずれか。各案で signature animation の名前を必ず独立させる。

##### F. 世界観アーキタイプを 1 つ選択して貫く

各案は以下の AYATORI 独自アーキタイプから **極端な方向を 1 つ選んで貫く**（複数選択・中庸化は禁止）。下記は例示であり、これ以外のアーキタイプで案件文脈に合うものがあれば新規に命名してよい:

- **削ぎ落とし型** — 要素を引き算し続けた結果に残る余白と書体の緊張感で勝負する
- **密度過飽和型** — 情報密度と同居要素の圧で、情報量そのものを美に変換する
- **希望技術合流型** — 自然と技術が相互依存する未来感。Solarpunk 系の植物 + 配線モチーフ
- **判型エディトリアル型** — 誌面レイアウトの発想（判型・ガター・ノンブル）を UI に転写する
- **未加工生地型** — フォントの地・グリッドのほころび・未処理テクスチャで「手つかず」を演出
- **金箔静謐型** — 暗部の重厚さに極小面積の輝き 1 点を差し込み、格式と沈黙を同居させる
- **筆致有機型** — 素材・筆致・揺らぎで手触りを作る。完全な直線・完全な円を避ける
- **幾何対称型** — 黄金比・対称軸・格子割付で、数学的秩序そのものを見せる
- **計器機能美型** — 計器・計装・工業規格の文法（目盛り・標示・等幅数字）を意匠化する
- **文化文脈型** — 特定の文化・時代（和・北欧・アールヌーボー・ブルータリズム 等）を具体的に引用する

##### G. 書体インスピレーション

候補は Google Fonts で取得可能なものから 2〜3 書体を挙げる（プロジェクト専用フォント指定がある場合を除く）。分類軸は「どの役割にどんな個性を持たせるか」で切る:

- **世界観系 Serif**（display 専用・世界観を語らせる役割）: Playfair Display / Crimson Pro / Fraunces / Cormorant Garamond / Newsreader
- **実用系 Sans**（base 向き・ダッシュボード / 高密度 UI）: IBM Plex Sans / Source Sans 3 / Manrope / Plus Jakarta Sans / Outfit
- **個性系 Display**（display 専用・記憶に残す役割）: Syne / Bricolage Grotesque / Instrument Serif
- **数値・等幅系 Mono**（numeric ロール・統計 / データ表 / コード的文脈）: JetBrains Mono / Fira Code / DM Mono / Source Code Pro / Courier Prime
- **和文系**（display / base の和文対応）: Noto Serif JP / Shippori Mincho / Zen Kaku Gothic New / Klee One / Noto Sans JP
- **収束回避対象**（B 項で禁止済）: Inter / Roboto / Arial / Open Sans / Lato / system-default

Pairing は対比を作る。display と body の組み合わせを必ず述べる（例: 世界観系 Serif × 実用系 Sans、個性系 Display × 和文系 base など）。Weight の振幅（100 と 800 を同時使用）や字サイズの跳躍（display と base の比が 3 倍以上）も意識する。

##### H. AYATORI 固有制約

1. **concept 命名パターン**: 「名詞 + 状態 + 情動」の 3 要素構成（例: 「影の間」「能舞台の静謐な緊張感」「深藍回路の冷たい昂り」）。色名・業種名だけでは不可
2. **Differentiation 一点**: 各案に「unforgettable にする一点」を 1 文で明示（例: "primary CTA にだけ金箔ラインが描画される" / "ロード時に scanline が 1 回だけ横切る"）
3. **3 案独立離散**:
   - `primary` の色相概念が 3 案で互いに離れていること（既存 L33-39 の機械的ルール: Phase 3 で OKLCH H 30° 以上離散）
   - `family_display` が 3 案で互いに異なること
   - `signature_animation` が 3 案で互いに異なること
4. **HEX 採用禁止**: 色方向は「墨黒」「金箔」「緋色」「松葉」等の色名・概念レベルで言語化。具体 HEX は Phase 3 で OKLCH から再導出する

##### I. 出力言語

- 人間向けテキスト（`concept` / `target_fit_rationale` / `differentiation` / `motion_idea` / `background_details` 等の記述文）は `pipeline.yaml` の `output_language` に従う（既定: 日本語）
- 英語のまま保持する語彙: フォント名（`Playfair Display` 等）／技術用語（`Tone` / `OKLCH` / `primary` / `bg` 等）／CSS 変数名・hex
- 日本語のまま保持する語彙: 色名・概念（墨黒 / 金箔 / 緋色 等）／和文書体名（Noto Serif JP 等）／C・F 項で挙げた文化文脈語

##### 出力要素（各案・言語化のみ・HEX/実装コード不要）

- `concept`: 1 文、「名詞 + 状態 + 情動」パターン
- `target_fit_rationale`: 2〜3 文、`hearing_interpreted` / `context_bundle` と明示接続
- `archetype`: F 項のアーキタイプ（例示外を含む）から 1 つを選択し、その語を記載する
- `typography_direction`: display 1 方向 + body 1 方向、各候補書体 2〜3（G 項の分類を参照）
- `color_direction`: 支配色 + 差し色（色名・概念レベル、HEX 不要）
- `motion_idea`: signature animation 1 つ、命名込み
- `background_details`: atmosphere の作り方（layered gradient / geometric pattern / noise / 素材感 等）
- `differentiation`: 「unforgettable な一点」1 文
- `layout_descriptor`: 主コンテンツ一覧の**構造記述子**を free-text でなく構造化タプルで宣言する。`refs/design-brief-template.md` の `layout.descriptor` スキーマに従う:
  - `content_anchor`: 主コンテンツ一覧クラス名（複数可・HTML と同名にする。例 `["record-grid","record-card"]`）
  - `list_container`: `grid` / `flex-column` / `flex-row` / `stack`（一覧の並べ方・開いた文法）
  - `columns`: 列数（grid track 数 / 横並び数・単列=1）
  - `item_layout`: アイテム内部構成（例 `vertical` / `photo-left` / `fullbleed`）
  - **3 案の `{list_container, columns, item_layout}` タプルは全ペア相違にする**。「単列主体／単列レイアウト主体／非対称単列」のように字面だけ変えて全部 `flex-column,1,vertical` に潰れるのは NG（意味的潰れ）。色相 30°差・family_display 全異と同格の構造制約として扱う。

#### 2.0.3 AP4 セルフ検証

生成した 3 案を以下の 5 軸で自己採点する:

| 軸 | 判定基準 |
|---|---|
| Distinction | 3 案の archetype / 色相概念 / 書体カテゴリが独立に離れている |
| Layout-Descriptor Distinction | 3 案の `layout_descriptor` タプル `{list_container, columns, item_layout}` が**全ペア相違**（exact 比較・LLM 判定でなくタプル一致/不一致で機械判定）。1 ペアでも一致なら衝突 |
| Concreteness | concept が「名詞 + 状態 + 情動」を満たし、抽象語で終わらない |
| Memorability | differentiation の「一点」が具体的で想起可能（曖昧語彙 NG） |
| Fit | target_fit_rationale が `hearing_interpreted` / `context_bundle` と明示接続している |
| Anti-Slop | 2.0.2 B 項の回避語彙に抵触していない |

**未達の案だけ** 2.0.2 の原則に戻して再生成する（最大 2 回反復）。2 回反復しても未達の場合はユーザーに状況を共有して判断を仰ぐ。合格判定後に Phase 2.1 へ進む。

> **Layout-Descriptor Distinction の crisp 判定**: この軸だけは LLM の「似ているか」判断に頼らず、3 案の `{list_container, columns, item_layout}` タプルを**文字列として exact 比較**する（color の OKLCH H 30°差・family_display 全異と同格の機械判定）。衝突したら、衝突 case の `list_container` / `columns` / `item_layout` を**実際に別の構造値へ変えて**部分 regenerate する（字面だけ変えて構造値が同じなら再び衝突する）。本軸は **WCAG ループ(08↔11)の内側＝Phase 2 に配置**しているため、mode B（palette 補正のみの再実行）ではスキップされ、レイアウトが確定する初回生成（mode A / C）でのみ評価される（color 補正のたびに再評価しない）。この不変量は Phase 7 で `differentiation_summary.layout_descriptor_distinct: true` に記録する（判定の SoT はタプル比較、summary はその記録）。最終的な enforcement は Step 09 orchestrator が生成 HTML から記述子を再導出して再検証する（`scripts/lint-design-samples-structure.mjs`）。

**【実行継続指示】2.0.1〜2.0.3 を完走したら、ユーザーへの確認なしに即座に Phase 2.1 へ進み、Phase 7（design-brief.yaml 書込み）まで一気に走る。**

#### 2.1 3案の世界観確定

Phase 2.0.3 までで確定した aesthetic direction をもとに、3つの明確に異なる aesthetic direction を整理する。

**各案に必要な要素**:
- `concept`: 1文で世界観を表現（例: 「能舞台の静謐な緊張感」）
- `target_fit_rationale`: なぜこのユーザー層に刺さるか

**差別化原則**:
「少し違う同じ案を3つ」はNG。方向性の根本が違うこと。
- NG: ブルー系・ネイビー系・グレー系（全部落ち着いた色）
- OK: ①高級感×モノクロ ②テクノロジー×ブルー ③日本的×エレガント

### Phase 3: 各案の palette 決定（AP5色彩理論 + WCAG by construction）

`docs/wcag-standards.md` §3（閾値）・§5（OKLCH補正）・§6（contrast pair 一覧）を **Read してから実行**。

各案（A/B/C）について:

1. **concept から基調色を1つ選ぶ**（primary または bg のいずれか）
   - 例: 案A「影の間」→ bg=墨黒、primary=金箔
2. **OKLCH 空間で L/C/H を設計**
   - H（色相）は concept に忠実（例: 金箔 H≈85）
   - C（彩度）は適度に（極彩色は避ける、C=0.08〜0.15 目安）
   - L（明度）は **WCAG contrast 閾値を満たすように逆算** する
3. **全トークン導出**（`docs/wcag-standards.md` §6 contrast pair 表に従う）
   - `--color-bg` / `--color-surface` / `--color-on-surface` / `--color-primary` / `--color-on-primary` / `--color-focus-ring` / `--color-border`
   - **hex への実体化は `scripts/oklch-color.mjs convert` の出力を使う**
     （`node scripts/oklch-color.mjs convert --oklch '{"l":0.55,"c":0.12,"h":85}'` → 返り値の
     `hex` と丸め済み `oklch` のペアをそのまま design-brief に書く。**暗算変換の転記は禁止** =
     hex↔oklch 不整合の根絶）。`in_gamut: false` が返ったら **`mapped_oklch`（convert が返す
     決定論の最大 in-gamut C）を採用**する — 下げ幅を自分で判断しない。C を大きく削られたく
     ない場合は L/H の意図設計に戻る
   - token 数が多い場合はバッチモード（`{ "items": [ { "id": "--color-bg", "oklch": {...} }, ... ]}`
     を stdin で渡す）を使い、case 単位で 1 回の実行にまとめる（1 色ずつ N 回 spawn しない）
4. **全 contrast pair が AA 閾値を満たすことを確認**
   - body on surface: 4.5:1 以上
   - primary on bg: 3:1 以上
   - on-primary on primary: 4.5:1 以上
   - focus-ring on surface: 3:1 以上
   - border on surface: 3:1 以上
   - 確認は `scripts/wcag-contrast.mjs` で行い（正式検証は 11）、未達 pair は
     `scripts/oklch-color.mjs solve --fg "{fg_hex}" --bg "{bg_hex}" --required {ratio}` で
     最小補正値を得て転記する
   - **`contrast_label` の数値はこの確認で得た `actual_ratio` を逐語転写する**（「約6.7:1」の
     ような推算表記は禁止 — 検証済み数値は literal で運ぶ）

**出力**: 各案について HEX + OKLCH (L/C/H) を明記（`refs/design-brief-template.md` §2 参照）。

**重要**: H は原則固定。contrast 閾値未達の補正量は §5 の solve が決定論算出する（上限 L±0.15 / C−0.05 を機械的に厳守）。solve が `solved: false` を返したら「primary を CTA 専用に降格」など用途変更（`docs/wcag-standards.md` §5 Step 4）。

### Phase 3-state: state colors 選定（必須）

各案で `palette.state_colors` を必ず決定する。skill 17 が画面 HTML の error banner / info banner / similarity badge 等で直書き hex を書かないために、tokens.json に bg/text/border を全展開する必要がある。

| state | 用途 | contrast 目安 |
|---|---|---|
| `error.bg` / `error.text` / `error.border` | エラー banner / バリデーション失敗 | text on bg で 4.5:1 以上、border 3:1 以上 (WCAG 1.4.11 非テキスト) |
| `info.bg` / `info.text` / `info.border` | 情報 banner / similarity badge | 同上 |
| `warning.bg` / `warning.text` / `warning.border` | 警告 banner / 注意喚起 | 同上 |
| `success.bg` / `success.text` / `success.border` | 成功 banner / 確認完了 | 同上 (省略可、要件依存) |

各 case の concept に合わせて hex を選定する。**hex を発明・推測しない** — `wcag-mapping.json` の制約と整合させ、Phase 3 と同じく OKLCH 空間で contrast 閾値を満たす値に調整する。

### Phase 3-illust: 装飾パレット選定（Escape Hatch・該当案のみ）

その案の concept / narrative が**装飾イラスト・挿絵・多色モチーフ**を含む場合のみ、`palette.illustration_colors[]`（目安 **≤8 色**・bounded）を提案する。モノクロ pictogram で完結する案・emoji_casual 案件では**生成しない**（フィールド自体を持たない）。

- **目的**: Step 17 がイラストを描くとき、tokens に無い色をその場で発明する（= off-list 直書き・near-duplicate 乱立の根因）のを防ぐ「床」。イラストは**このパレットに従って**描かれる（色がイラストに合わせるのではない）。
- **位置づけ**: 装飾**専用**（境界ルール）。文字・状態伝達・操作要素に使う色はここに入れず、`palette.tokens[]` / `state_colors` / `domain_surfaces`（= skill 11 が WCAG contrast 検証する側）に置く。illustration_colors は **contrast 検証を通らない**ため、それが許される装飾用途に限る。
- **選定**: 各 case の concept に調和する色を OKLCH 空間で選ぶ（支配色・差し色との関係を narrative に 1 行記す）。`name` は用途が分かる語（`sun` / `leaf` / `skin-warm` 等）、`usage` に用途メモ。**dual_theme_mode=true の案件は `modes` で light/dark 両方を必ず持つ**（`domain_surfaces.modes` と同型。片側欠落は skill 12 で reject される）。
- **承認**: 人間はコードでなく**描画で承認する**。確実な視認経路は **Step 13 の style-guide-view**（generate-style-guide が `global.color` 全件を swatch 表示するため illustration グループも必ず現れる）。Step 09 サンプル HTML に装飾が描かれる案ではそこでも見える（ただし 09 の入力契約は palette.tokens[] 中心で、全 8 色が描画に現れる保証はない — 保証経路は 13 の swatch）。運用中に不足した色は Step 17 が `var(--color-illustration-{新名})` 参照だけ書き、color-lint-report の昇格キュー → Step 21 Section 1-D 予告 → **Step 24 Step A-2b（hex 確定の正本ゲート）** で tokens.json に増分追加される（**この Phase に戻ってこない**。実体化は次回生成 run）。

### Phase 3-domain: domain-specific UI surface 列挙 (dual-theme × domain 拡張)

汎用 palette (bg / surface / primary 等) では捕捉できない、アプリ固有で**画面を持続的に占有する UI 面** (盤面マス / ダイス面 / カード面 / マップ地形 / グラフ系列 / スコアパネル等) を抽出し、各案で **両テーマ分** の token を `palette.domain_surfaces[]` として宣言する。NFR が「視認性 / 識別 / コントラスト」を要求する場合、その対象 token と domain surface の contrast pair を `contrast_pairs[]` に記録する (skill 11 Phase 5.5 が読む)。

> **設計判断**: 本 Phase で生成する contrast_pairs[] に NFR 識別子の back-link (旧 `nfr_origin`) は持たない。NFR ↔ artifact の対応関係は skill 19 NFR Coverage 評価が requirements/06-non-functional.md と pipeline artifact (wcag-history.json / coverage-check.json / tokens.json 等) を能動的に照合して導出する単一窓口モデル。各 contrast pair は「この surface でこの fg と必要 ratio を満たす」だけを宣言すれば十分。

#### 3-domain.1 抽出基準

`requirements.json` および `requirements/02-scope.md` / `05-features.md` / `06-non-functional.md` を Read し、以下のいずれかに該当する面を domain surface とする:

- **画面の 25% 以上を持続的に占有** (一時的な banner / dialog ではない)
- **Must 機能の中心オブジェクト** (盤面・キャンバス・マップ・カード等)
- **NFR で「視認性 / 識別性 / コントラスト」が明示されている表示対象**
- **画面 HTML で `background:` プロパティに新規色を要する** (汎用 surface トークンでは満たせない)

抽出例:
- ボードゲーム → 盤面の暗色マス / 明色マス
- カードゲーム → カード表面 / 裏面、suit 別背景
- 統計ダッシュボード → グラフ系列色、トレンドライン色
- マップアプリ → 地形・水面・建物の塗り分け色
- カレンダー → 平日 / 休日 / イベント日の cell 色

抽出対象が無い場合は `palette.domain_surfaces: []` (空配列) を明示し、`palette.domain_surfaces_rationale: "汎用 palette で全 UI 面をカバーできる"` と書く (skip ではなく明示宣言)。

#### 3-domain.2 NFR 由来 contrast pair の抽出

`requirements/06-non-functional.md` および `requirements.json.non_functional` を走査し、以下のキーワードを含む NFR を pair 検証対象として記録する:

- 「視認性」「視認」「contrast」「識別」「判別」「コントラスト」「読みやすさ」「discriminab」

抽出した各 NFR について `(主体 token, 背景 domain surface, 必須 ratio, criterion)` を導出する。例:
- NFR-16「WCAG AA 両モード contrast」+ 盤面 → `(piece-black, board-dark-square, 3.0, 1.4.11)` と `(piece-red, board-dark-square, 3.0, 1.4.11)`
- NFR-XX「線種で系列を識別できる」+ グラフ系列色 → `(series_a, chart-bg, 3.0, 1.4.11)` 等

導出した pair list は `domain_surfaces[].contrast_pairs[]` フィールドに格納する。

NFR ↔ pair の対応関係は本 skill では明示しない (back-link を持たない設計)。skill 19 NFR Coverage 評価が NFR テキストから能動的に検証 evidence を逆引きすることで成立する。

#### 3-domain.3 両テーマ token + WCAG by construction

各 domain surface について、Phase 3 と同じ OKLCH 設計フローで **両テーマ分の hex を導出** する:

1. 該当 surface の concept から色相 H を選ぶ (案の archetype に整合)
2. 当該 surface 上に重なる「主体 token」(driver) の L を確認 (例: piece-black L≈0.01、piece-red L≈0.13)
3. driver と必要 ratio を満たす L 域を逆算し、surface の dark/light mode L を決定
4. 両テーマで contrast_pairs 全件が必要 ratio 以上を満たすことを確認 (満たさなければ L 調整 → 駒色等が固定なら surface L を動かす)

YAML 出力例 (Draughts):
```yaml
palette:
  domain_surfaces:
    - name: "board-dark-square"
      role: "駒が置かれる暗色マス"
      driver_tokens: ["piece-black", "piece-red"]
      contrast_pairs:
        - { fg: "piece-black", required_ratio: 3.0, criterion: "1.4.11" }
        - { fg: "piece-red",   required_ratio: 3.0, criterion: "1.4.11" }
      modes:
        - { mode: "dark",  hex: "#C5CFB8", oklch: { l: 0.79, c: 0.025, h: 130 }, contrast_label: "vs piece-black 10.59:1 / piece-red 3.69:1" }
        - { mode: "light", hex: "#E2DDC9", oklch: { l: 0.87, c: 0.030, h: 85  }, contrast_label: "vs piece-black 12.66:1 / piece-red 4.92:1" }
```

#### 3-domain.4 自己検証

書き出す前に以下を確認:
- [ ] 全 NFR の「視認性 / 識別」要求が `domain_surfaces[].contrast_pairs[]` に登場している
- [ ] `themes_required == ["dark", "light"]` のとき、各 domain surface に dark / light 両方の hex が定義されている
- [ ] 各 `driver_tokens` が `palette.tokens[]` に存在する (浮いた参照ではない)
- [ ] domain surface 自身の token name は `palette.tokens[]` には書かない (重複防止。tokens.json 出力時に skill 12 が `palette.tokens[]` と `palette.domain_surfaces[]` をマージする)
- [ ] `domain_surfaces == []` の case では `domain_surfaces_rationale` 文字列が明示されている (うっかり抽出忘れと意図的なスキップを区別するため)

### Phase 4: タイポグラフィ最終選定

Phase 2.0 で決定した `typography_direction`（display / body）を起点に、`skills/08-design-brainstorm/refs/typography-pairing.md` を **Read** して候補集と照合し、各案で `family_display` / `family_base` / `family_numeric` の3ロールを確定する。numeric ロールは表・数値密度の高い UI 用に monospace 系を別途選定する（display/body と独立）。

**必須ルール**:
- `family_display` が3案ですべて異なる
- VISUAL_DENSITY >= 7 の案で Serif を `family_base` に使わない（anti-slop）
- Google Fonts で取得可能な書体を選ぶ（プロジェクト専用フォント指定がある場合を除く）
- Phase 2.0 で挙げた書体候補が `refs/typography-pairing.md` にない場合は、Google Fonts 可用性を確認して採用可否を判断

### Phase 5: 各案のモーション・密度設定（AP6 3ダイヤル）

各案について以下を決定:

| ダイヤル | 範囲 | 意味 |
|---|---|---|
| DESIGN_VARIANCE | 1〜10 | レイアウト実験度（低=対称、高=非対称・overlap） |
| MOTION_INTENSITY | 1〜10 | アニメーション量（低=静的、高=cinematic） |
| VISUAL_DENSITY | 1〜10 | 情報密度（低=余白広め、高=全数値 monospace・tight） |

**ダッシュボード用途のデフォルト** (AP6実績): 6 / 4 / 7

各案に **独自の signature animation** を1つ指定（例: gold-line-draw / scanlines / brush-stroke）。3案すべて異なる名前にする。

### Phase 6: anti-slop チェック

`skills/08-design-brainstorm/refs/anti-slop-rules.md` を **Read** してチェックリストを実行。

- [ ] 全案で Inter 不使用
- [ ] 全案で `#000000` 不使用（bg も text も）
- [ ] 全案で 3-col equal レイアウト不使用
- [ ] 全案で AI Purple/Neon gradient 不使用
- [ ] VISUAL_DENSITY >= 7 の案で Serif を `--font-base` に使用していない
- [ ] DESIGN_VARIANCE >= 5 の案でヒーロー中央揃えを採用していない
- [ ] 全案で Tactile Feedback / Staggered Reveals を Component Stylings に記載
- [ ] 全案で signature animation を1つ以上指定
- [ ] `family_display` が3案ですべて異なる
- [ ] `primary` OKLCH H の3案間差が 30°以上
- [ ] `motion_profile.signature_animation` が3案ですべて異なる

違反があれば該当案を修正してから Phase 7 に進む。

### Phase 7: design-brief.yaml 3案版書込（single source of truth）

`skills/08-design-brainstorm/refs/design-brief-template.md` を **Read** してテンプレートに従い、`artifacts/{app_name}/design-brief.yaml` を書き出す（初回は新規作成、ループ再実行時は上書き）。

**設計原則**:

- **yaml が single source of truth**（SSOT）。md は生成しない（`docs/interface-contracts.md` §08 参照）
- yaml に**構造化契約データ**（palette / typography / dials / signature_animation）と **narrative prose**（visual_theme / target_fit / component_stylings / depth / agent_prompt_guide）を同居させる
- 下流（09 / 10 / 11 / 12 / 17 / 22）はこの yaml 1 ファイルから読む
- 人間 UX は `design-samples/*/index.html`・`style-guide-view.html`・全画面 HTML で完結させる

#### 7.1 トップレベル frontmatter

```yaml
schema: "design-brief:draft:v1"
app_name: "{app_name}"
generated_at: "{YYYY-MM-DD}"
attempt_count: {len(wcag-history.json.attempts) - 1 if attempts else 0}   # snapshot of derived value
revision_mode: null
```

> `attempt_count` は wcag-history.json から導出した snapshot。**08 側では wcag-history.json を更新しない** (単一所有権: 11 のみが attempts に append する)。初回実行時は wcag-history.json が未生成のため `0` を記録。10 承認後は 10 skill が `pipeline-state.json.selections.selected_sample_id` / `selected_sample_direction` を書き、design-brief.yaml には書かない。

#### 7.2 common セクション

- `common.hearing`: 6 軸ヒアリングの raw 回答
- `common.hearing_interpreted`: raw × 要件文脈の昇華結果（Phase 2.0.1 で作成した表を構造化）
- `common.ui_constraints`: emoji_allowed / icon_style / numeric_font / language_policy / **`illustration_policy`** (Phase 1 Axis 6 または Mode C step 5 で確定した値を使うこと — テンプレートデフォルトの `"pictogram"` に戻さない。`emoji_casual` の場合は `emoji_allowed: true` も同時に設定する)
- `common.platforms`: 対象プラットフォームのサブセット

#### 7.3 cases[] × 3（A / B / C）

各 case で**必須フィールド**:

- 識別・概要: `id` / `label` / `archetype` / `concept` / `differentiation`
- **narrative**（LLM priming 用 prose、09 Phase 5.0 で前置注入される）:
  - `narrative.visual_theme` — archetype 世界観 2〜4 文
  - `narrative.target_fit` — ユーザー適合理由 2〜3 文
  - `narrative.component_stylings` — §4 の質感語彙（prose）
  - `narrative.depth` — §6 の質感描写（prose）
  - `narrative.agent_prompt_guide` — §9 narrative 全文（signature animation の適用先・event binding・composition 指示）
- 構造化契約:
  - `palette.tokens[]` — 全 token の `name` / `hex` / `oklch:{l,c,h}` / `usage` / `contrast_label`
    - **dual-mode (themes_required に "light" を含む場合)**: 各 token は同じ `name` で 2 エントリ並べる: `mode: "dark"` と `mode: "light"`。`mode` 省略時は単一モード (現行プロジェクト互換、Default/dark スロット扱い)。light 側は dark の OKLCH を機械的に反転 (L を 1-L で計算等) せず、**手描き感のデザイン軸を両モードで一貫させる (NFR-41) ために archetype 世界観に整合する light 配色を新たに設計**すること。例: dark = 黒板スレート (#1F2C36) → light = 古紙アイボリー (#F5F1E6) のように、世界観を保ったまま明度を反転させた配色。
  - `palette.state_colors` — state 別の bg/text/border (必須、Phase 3-state 参照)。`{error: {bg, text, border}, info: {bg, text, border}, warning: {bg, text, border}, success?: {bg, text, border}}` の形式。各値は `{hex, oklch:{l,c,h}, contrast_label}`
    - **dual-mode (themes_required に "light" を含む場合)**: 各 `{bg, text, border}` 値に optional `light: {hex, oklch?, contrast_label?}` sub-block を追加。dark 側 (top-level の hex) と対になる light 値を格納する
  - `palette.domain_surfaces[]` — Phase 3-domain で抽出した domain-specific UI 面 (dual-theme × domain 拡張)。各 entry は `{name, role, driver_tokens[], contrast_pairs[], modes[]}`。`modes[]` は themes_required の各 mode について `{mode, hex, oklch, contrast_label}` を持つ。空配列の場合は `palette.domain_surfaces_rationale` 文字列で skip 根拠を明示する (空配列 + rationale 未記載は invalid)
  - `palette.illustration_colors[]` — Phase 3-illust の装飾パレット (Escape Hatch、**optional**)。装飾イラストを含む案のみ。各 entry は `{name, usage, hex}` (single-mode) または `{name, usage, modes:[{mode, hex}×2]}` (dual_theme_mode=true は light/dark ペア必須)。装飾専用 — 文字/状態/操作要素の色は入れない (schema: `schemas/design-brief.schema.json` $defs.illustrationColor)
  - `palette.oklch_derivation_note` — prose
  - `palette.loop_correction_history[]` — ループ時のみ entries（初回は空配列）
  - `typography[]` — 3 ロール（display / base / numeric）+ 必要なら display_jp
  - `dials` — design_variance / motion_intensity / visual_density
  - `signature_animation` — name / applied_to / duration_ms / timing / iteration / keyframes_hint / event_binding / reduced_motion_fallback
  - `depth` — shadow 段階
  - `layout` — grid_policy / spacing_scale / breakpoints / **`descriptor`**（`content_anchor[]` / `list_container` / `columns` / `item_layout`。Phase 2.0.2 で宣言した値を転記。3 案で `{list_container, columns, item_layout}` 全ペア相違）
  - `donts[]` — 禁止事項の箇条書き
  - `agent_prompt_guide` — 構造化フィールド（tokens_json_hint / style_guide_hint / screen_gen_hint / icon_rule / additional_rules[]）

narrative と構造化契約の対応は `refs/design-brief-template.md` の「narrative フィールドの書き方指針」参照。

#### 7.4 集約セクション

- `differentiation_summary`: primary_h_diffs / family_display / signature_animation / theme_mode / notes
- `anti_slop_check`: all_passed / results[]

#### 7.5 書込前の自己検証

yaml を書き出す前に以下を確認:

- [ ] 全 case で `narrative.*` 5 フィールドすべてに prose が書かれている（空文字列・プレースホルダ `{...}` のままでない）
- [ ] `palette.tokens[]` の HEX と narrative 内で言及される色（例: 「金箔 #C5A33C」）が整合している
- [ ] `signature_animation.name` と narrative.agent_prompt_guide で言及される animation 名が一致
- [ ] `dials` の数値と narrative.component_stylings の質感トーン（VISUAL_DENSITY 高=tight、低=余白広め）が矛盾しない
- [ ] 全 case で `palette.loop_correction_history` は list（空配列 `[]` でも可）
- [ ] **layout.descriptor 完備 + 全異**: 全 case の `layout.descriptor` に `content_anchor[]` / `list_container` / `columns` / `item_layout` が揃っており、3 案の `{list_container, columns, item_layout}` タプルが全ペア相違（exact 比較）。`differentiation_summary.layout_descriptor_distinct: true` を記録している。`content_anchor` のクラス名は Step 09 が生成する HTML のクラス名と一致させる前提（agent が骨格に転記し orchestrator が再導出照合する）
- [ ] **dual-mode 検証**: `themes_required` が `["dark", "light"]` の場合、全 case の `palette.tokens[]` が `mode: "dark"` と `mode: "light"` の両エントリを持ち、両エントリの `name` 集合が完全一致している (片側のみの token があってはならない)
- [ ] **state_colors dual-mode**: `themes_required` が `["dark", "light"]` の場合、全 case の `palette.state_colors.*.{bg,text,border}` に `light.hex` が存在する (required: error / info、optional: warning / success)
- [ ] **単一モード互換**: `themes_required` が `["dark"]` の場合、`palette.tokens[]` に `mode` フィールドを書かない (混在は禁止、現行プロジェクトとの後方互換)
- [ ] **domain_surfaces 完備**: 全 case の `palette.domain_surfaces` が存在する (空配列でも明示)。空配列以外の場合、各 entry に `name` / `role` / `driver_tokens[]` / `contrast_pairs[]` / `modes[]` が揃っており、`themes_required == ["dark", "light"]` のときは `modes[]` に dark / light 両エントリが存在する
- [ ] **NFR pair 抽出網羅**: `requirements/06-non-functional.md` 内で「視認性 / 識別 / contrast / 判別 / 読みやすさ」を含む NFR を grep し、各 NFR について **driver_tokens と domain surface の組み合わせ** で対応する contrast_pair が `palette.domain_surfaces[]` のいずれかに登場している (NFR との明示 back-link は持たないため、対応関係は driver_tokens / role / 自然言語 の整合で確認する。最終的な網羅性チェックは skill 19 NFR Coverage 評価が担う)
- [ ] **domain ↔ palette 参照整合**: 全 `domain_surfaces[].driver_tokens[]` の token 名が `palette.tokens[]` の `name` 集合に含まれる (浮いた参照は invalid)。逆方向 (palette.tokens[] の name が domain_surfaces[].name と衝突する) も invalid (重複定義禁止)
- [ ] **hex↔oklch 整合 (機械検証)**: 書き出す `cases[]` の palette を丸ごと JSON (`{ "cases": [ { "candidate_id", "palette": {...} } ] }`) に変換し、skill 11 Phase 5 Step 2 と同じ heredoc 形で `node scripts/oklch-color.mjs lint <<'JSON' ... JSON` を実行する。**⚠ 転写には各エントリの `oklch` を必ず含める** — skill 11 Phase 5 の転写 shape をそのまま流用して oklch を落とすと、全エントリ skip で `pass: true` になり検証が空振りする。成立条件は 3 つ: `"pass": true` **かつ** `summary.entries_checked > 0` **かつ** skipped エントリが「oklch を持たない illustration_colors」のみ (tokens / state_colors / domain_surfaces 由来の skip は転写漏れ)。drift が出たら該当エントリの `oklch` を `convert --hex "{記録hex}"` の出力で書き直して再実行する (**hex が SoT** — 記録済み hex 側は動かさない。convert の出力ペアは lint を必ず通ることが script 側で保証されているため、この修復は 1 回で収束する)

**出力言語**: `pipeline.yaml` の `output_language` に従う。yaml key は英語のまま、narrative・usage・concept 等の人間向け文字列は指定言語。

### ループ再実行時の更新挙動

WCAG 補正ループで 08 が再実行されたとき:

1. 該当 case の `palette.tokens[].hex` と `oklch` を `scripts/oklch-color.mjs solve` の `result` 値で更新（モード B の手順参照。補正量は §5 の solve が決定論算出する — 暗算しない）
2. 該当 case の `palette.loop_correction_history[]` に補正 entry を append:
   ```yaml
   palette:
     loop_correction_history:
       - attempt: 1
         token: "--color-primary"
         before: { hex: "#0369A1", oklch_l: 0.48 }
         after:  { hex: "#0B76B5", oklch_l: 0.52 }
         reason: "surface との contrast 2.92:1 が 1.4.11 閾値 3.0:1 を 0.08 下回り違反"
   ```

   solve が Stage 2 の解 (`delta.dc != 0` = C 削減あり) を返した場合は `before` / `after` に
   `oklch_c` も併記する (例: `before: { hex: "...", oklch_l: 0.63, oklch_c: 0.258 }`)。値はすべて
   solve 出力 (`input.fg_oklch` / `result.oklch`) からの転記。
3. 該当 case の `palette.oklch_derivation_note` 末尾に補正経緯の 1〜2 文を追記（prose 履歴、retro 用）
4. 他 case と他フィールド（narrative / typography / dials / signature_animation 等）は触らない（差分最小化）
5. トップレベル `attempt_count` を現在値 (`len(wcag-history.json.attempts) - 1`) に更新

> 旧 Phase 7.6 (`wcag-mapping.json` の初期化) は廃止 — wcag-mapping.json は 11-wcag-mapping が初回のみ書き込む単一所有権モデルに変更された (W1 設計判断)。08 は wcag-mapping.json / wcag-history.json のいずれにも書き込まない。

### 完了メッセージ

```
デザインブリーフ 3案版（design-brief.yaml、schema: design-brief:draft:v1）を保存しました。
次に 11 で色非依存WCAG制約を定義し、各案 palette の色コントラストを検証します。
```

→ `skills/11-wcag-mapping/SKILL.md` を Read して 11 を実行。

---

## 出力サマリー

| ファイル | 状態 |
|---|---|
| `artifacts/{app_name}/design-brief.yaml` | **新規作成 or 上書き**（3案版・schema:draft:v1、SSOT）。narrative prose と構造化契約データを同一ファイルに格納 |

> 本 skill は wcag-mapping.json / wcag-history.json のいずれにも書き込まない (単一所有権: 11 が両ファイルを管理)。

---

## 参照

- `docs/wcag-standards.md` — AA 閾値・contrast pair 一覧・OKLCH 補正アルゴリズム（必読）
- `docs/html-generation-rules.md` — anti-slop連携、HTML生成ルール
- `docs/interface-contracts.md` §08 — 契約仕様
- `skills/08-design-brainstorm/refs/design-brief-template.md` — 出力フォーマット
- `skills/08-design-brainstorm/refs/anti-slop-rules.md` — 禁止ルール一覧
- `skills/08-design-brainstorm/refs/typography-pairing.md` — 書体ペアリング例

---

## Phase 2 TODO（申し送り）

今回（Phase 1）では以下を予約のみで、実装は Phase 2 で行う:

1. `design-brief.yaml.revision_mode` の読取
   - `"full"` → 全再生成（Phase 1 と同じ挙動）
   - `"partial"` → 差分ヒアリング（変更軸のみヒアリングし直し、他は保持）
   - `null` → 通常実行
2. 否認理由の詳細カテゴリ化（色/書体/レイアウト/モーション 等の軸別）
3. プロジェクト単位の `wcag_version` / `conformance_level` 上書き対応
4. **17 / 22 / 24 / 25 の yaml 読込切替**（08/09/10/11/12/13/19 は yaml SSOT 化済み）:
   - 17 の全画面 HTML 生成が `design-brief.md` 前提の場合は修正（`design-brief.yaml.cases[selected_sample_id]` に切替）
   - 22/24/25（Figma 連携）も確認
   - 参照箇所: `docs/interface-contracts.md` §17 / §22 の IN 仕様と各 SKILL.md / refs
   - 検出用コマンド: `grep -rn 'design-brief\.md' skills/ docs/` で残存 md 参照を確認
