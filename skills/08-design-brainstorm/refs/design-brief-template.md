# design-brief.yaml テンプレート（3案版 / schema: design-brief:draft:v1）

08-design-brainstorm が 3 案生成後に `artifacts/{app_name}/design-brief.yaml` として書き出すフォーマットの骨格。
**この構造は `docs/interface-contracts.md` §08 OUT と厳密に整合させる**。

## 設計方針（md なし、yaml 単独 SSOT）

- 08 Phase 2（v2 以降）では **`design-brief.yaml` のみ** を出力する（md は生成しない）
- yaml には **構造化契約データ**（palette HEX / OKLCH / typography / dials / signature_animation）と **narrative prose**（archetype 物語 / OKLCH 導出根拠 / §9 Agent Prompt Guide 全文）を同一ファイルに格納する
- 下流（09 / 10 / 11 / 12 / 17 / 22）はこの yaml を single source of truth として読む
- 人間は `design-samples/*/index.html`（09 成果物）・`style-guide-view.html`（12 成果物）・全画面 HTML（17 成果物）を見て判断する。yaml/brief を直接読ませない UX
- Confluence 共有が必要になった場合は 15 で yaml → markdown へ rendered view を生成する（将来実装）

## ファイル全体テンプレート

```yaml
schema: "design-brief:draft:v1"
app_name: "{app_name}"
generated_at: "{YYYY-MM-DD}"
attempt_count: 0                       # WCAG ループ回数 snapshot（08 側では +1 しない、phases/design/SKILL.md が一元管理）
revision_mode: null                    # null | "full" | "partial"（partial は Phase 2 TODO）

# 10 承認後に追加される（draft:v1 時点では未書込）
# selected_sample_id: "A"
# selected_label: "計器盤の正確な静謐"
# approved_at: "2026-04-24"

# =============================================================
# 共通情報（3 案に共通して適用される前提）
# =============================================================
common:
  hearing:                             # 6 軸ヒアリング raw 回答
    brand_direction: "{#1: ブランド方向性の raw 回答}"
    tone_mood: "{#2: トーン&ムード}"
    color_image: "{#3: カラーイメージ}"
    reference_apps: "{#4: 参考アプリ}"
    avoid_styles: "{#5: 避けたいスタイル}"
    ui_constraint_raw: "{#6: UI 表現制約の raw 回答}"

  hearing_interpreted:                 # raw × 要件文脈の昇華結果
    - axis: "ブランド"
      raw: "プロ・信頼・安全・精密"
      context: "飲酒運転防止／運行記録法令対応"
      sublimated: "計器・統制を源泉とした信頼感 — 業務 UI で『正しさが目に見える』を徹底"
    - axis: "トーン"
      raw: "グレー層＋アクセント"
      context: "地図中心リアルタイム"
      sublimated: "地図を邪魔しないミディアムグレー・シェル"
    # ... 6 軸分

  ui_constraints:
    emoji_allowed: false
    icon_style: "svg-line-round"       # フォントアイコン禁止・SVG 線画のみ
    illustration_policy: "pictogram"   # pictogram | illustration_character | emoji_casual (emoji_casual 選択時は emoji_allowed: true に変更すること)
    icon_stroke_width: "1.5"
    numeric_font: "monospace-required"
    language_policy: "japanese-required"   # 英語ラベル禁止

  platforms: ["web", "mobile"]    # requirements.json.design_output_scope.platform_combo に準拠（web_only→["web"] / mobile_only→["mobile"] / mobile_and_web→["web","mobile"]）

# =============================================================
# 3 案（10 承認後も棄却案含めて保持）
# =============================================================
cases:

  # ─────────────────────────────────────────────────────────
  # 案 A
  # ─────────────────────────────────────────────────────────
  - id: "A"
    label: "計器盤の正確な静謐"             # 方向性名
    archetype: "計器機能美型"               # 10 archetype のいずれか + 独自命名可
    concept: "計器盤の正確な静謐"            # 1 文（名詞 + 状態 + 情動）
    differentiation: "KPI 数値の横で mini-gauge 針が 1Hz で同期振動"  # unforgettable な一点

    # ──────────────────────────────────────────────────────
    # narrative（LLM priming 用の prose。09 Phase 5.0 で前置注入される）
    # ──────────────────────────────────────────────────────
    narrative:

      visual_theme: |
        計器盤・管制コンソールの文法（目盛り・等幅数字・精密罫線）で、
        飲酒チェックと運行記録という「正しさ」を視覚化する。
        Waze 的リアルタイム地図を、計装盤に取り囲まれた監視卓として位置付ける。

      target_fit: |
        法人フリート管理者にとって「法令対応の正しさ」が一目で分かる必要がある。
        計器の目盛り文法は「測定している・記録している・規程に沿っている」という
        メッセージを装飾なしで伝える。ドライバー側でもメーター UI は
        自動車計器盤との連続性があり学習コストが最小。

      component_stylings: |
        ボタン Primary: min-height 44px（モバイル）/ 40px（web）、hover 時 translateY(-1px) +
        primary-tinted shadow。計装リアリズムのため装飾的な glow/bloom は使わない。
        KPI タイル: 右端に 24px 幅の mini-gauge（SVG 線画、stroke-linecap="round"）、
        値と針が 1Hz で同期振動。値 + 単位 + mini-gauge の 3 要素セット必須。
        地図 overlay パネル: backdrop-filter: blur(18px) + inset 1px highlight で
        深海ガラスの質感。border は rgba(100,116,139,0.24) で輪郭補強。
        Tactile Feedback: 全 clickable に :active scale(0.98) + 120ms ease-out。

      depth: |
        暗色計装の重厚さを出すため shadow は硬く濃く（rgba(3,10,30,0.55)）、
        段階は sm / md / lg の 3 段階 + hover 時の primary-tinted shadow。
        ガラス製計器盤の冷たい反射を想起させる。

      agent_prompt_guide: |
        17 全画面 HTML では gauge-tick-sweep を KPI 値表示要素に適用する。
        1Hz で同期振動するため全 KPI の針が揃って動く演出（animation-delay を揃える）。
        prefers-reduced-motion: reduce 時は gauge-tick-sweep を static（針固定）にする。
        アイコンはインライン SVG のみ、stroke-linecap="round"・stroke-width="1.5"。
        Phosphor/Lucide 系のトレースは OK。
        KPI タイルは必ず「値＋単位＋mini-gauge」3 要素セットで構成する。
        amber（#F59E0B）はアラート・未提出の 1 バッジのみで使用し、テキスト併記を必須にする（1.4.1）。

    # ──────────────────────────────────────────────────────
    # 構造化契約データ（machine 用 hard constraint）
    # ──────────────────────────────────────────────────────

    palette:
      tokens:
        - name: "--color-bg"
          hex: "#0B1220"
          oklch: { l: 0.16, c: 0.04, h: 255 }
          usage: "全体背景（深夜空の灰青）"
          contrast_label: null
        - name: "--color-surface"
          hex: "#111A2E"
          oklch: { l: 0.20, c: 0.04, h: 255 }
          usage: "計器盤シェル・カード"
          contrast_label: null
        - name: "--color-on-surface"
          hex: "#E3EBF5"
          oklch: { l: 0.92, c: 0.02, h: 240 }
          usage: "本文テキスト（氷白）"
          contrast_label: "on-surface: 約13.99:1 ✅"
        - name: "--color-on-surface-variant"
          hex: "#8FA0B6"
          oklch: { l: 0.66, c: 0.03, h: 245 }
          usage: "副情報・ラベル"
          contrast_label: "on-surface: 約6.57:1 ✅"
        - name: "--color-primary"
          hex: "#0B76B5"
          oklch: { l: 0.52, c: 0.12, h: 232 }
          usage: "CTA・選択状態（azure calibration）"
          contrast_label: "on-surface: 約3.54:1 ✅"
        - name: "--color-on-primary"
          hex: "#FFFFFF"
          oklch: { l: 1.00, c: 0.00, h: 0 }
          usage: "CTA 上テキスト"
          contrast_label: "on-primary: 約4.91:1 ✅"
        - name: "--color-focus-ring"
          hex: "#38BDF8"
          oklch: { l: 0.78, c: 0.13, h: 230 }
          usage: "フォーカスリング（sky-400）"
          contrast_label: "on-surface: 約7.73:1 ✅"
        - name: "--color-border"
          hex: "#64748B"
          oklch: { l: 0.55, c: 0.03, h: 257 }
          usage: "境界線（slate-500）"
          contrast_label: "on-surface: 約3.65:1 ✅"
        - name: "--color-accent-warn"
          hex: "#F59E0B"
          oklch: { l: 0.76, c: 0.16, h: 70 }
          usage: "アラート・警戒バッジ（1 点差し色）"
          contrast_label: null

      # ──────────────────────────────────────────────────────
      # state_colors (必須)
      # 各 state の bg/text/border を全展開して palette.state_colors に格納する。
      # skill 12 が tokens.json.global.color.{error,info,warning,success}-{bg,text,border}
      # に展開し、skill 17 が画面 HTML で var(--color-error-bg) 等を参照する。
      # 直書き hex を画面に書かないための SoT。
      # required: error / info、optional: warning / success
      #
      # ⚠ 注意: 下記の hex は **calibration example** で、
      # 実プロジェクトでは docs/wcag-standards.md §5 OKLCH 補正アルゴリズム
      # (scripts/oklch-color.mjs convert/solve) を実行して
      # brand color と整合する hex を導出すること。
      # テンプレ値を copy-paste するのは Anti-Pattern (AP-2 と同種、generic 化)。
      # 必ず案ごとに contrast 4.5:1 (text) / 3:1 (border) を満たすことを
      # skill 11 で独立検証 (pairs 8-15) する。
      # ──────────────────────────────────────────────────────
      state_colors:
        error:
          bg:     { hex: "#2C1214", oklch: { l: 0.13, c: 0.05, h: 15 }, contrast_label: null }
          text:   { hex: "#FC8080", oklch: { l: 0.67, c: 0.14, h: 20 }, contrast_label: "text vs bg: 約7.13:1 ✅ AAA" }
          border: { hex: "#E05454", oklch: { l: 0.58, c: 0.18, h: 20 }, contrast_label: "border vs bg: 約5.5:1 ✅ AA" }
        info:
          bg:     { hex: "#0E1C26", oklch: { l: 0.13, c: 0.03, h: 230 }, contrast_label: null }
          text:   { hex: "#7AC8F5", oklch: { l: 0.77, c: 0.10, h: 220 }, contrast_label: "text vs bg: 約7.5:1 ✅ AAA" }
          border: { hex: "#3BA8E8", oklch: { l: 0.65, c: 0.13, h: 220 }, contrast_label: "border vs bg: 約5.2:1 ✅ AA" }
        warning:                                                          # optional
          bg:     { hex: "#2A1E0C", oklch: { l: 0.14, c: 0.05, h: 60 }, contrast_label: null }
          text:   { hex: "#F7C060", oklch: { l: 0.80, c: 0.14, h: 75 }, contrast_label: "text vs bg: 約7.8:1 ✅ AAA" }
          border: { hex: "#E9A020", oklch: { l: 0.70, c: 0.16, h: 75 }, contrast_label: "border vs bg: 約5.8:1 ✅ AA" }
        success:                                                          # optional
          bg:     { hex: "#0D1D12", oklch: { l: 0.13, c: 0.03, h: 150 }, contrast_label: null }
          text:   { hex: "#6EDB95", oklch: { l: 0.80, c: 0.13, h: 150 }, contrast_label: "text vs bg: 約8.0:1 ✅ AAA" }
          border: { hex: "#2EB96A", oklch: { l: 0.66, c: 0.16, h: 148 }, contrast_label: "border vs bg: 約5.5:1 ✅ AA" }

      oklch_derivation_note: |
        計装盤コンセプトに合わせて深夜空色の bg（L=0.16）で重厚さを出し、
        氷白の on-surface（L=0.92）で高可読性を確保。
        primary は azure calibration（H=232、L=0.52）で深海ターコイズ領域。
        surface との contrast 3.54:1（1.4.11 クリア）と on-primary 白との 4.91:1（1.4.3 クリア）を
        両立する L を選定。
        アラート用 amber は H=70 で primary と補色関係になり「警戒目視性」が最大化。

      loop_correction_history: []      # ループで補正した場合に append
        # - attempt: 1
        #   token: "--color-primary"
        #   before: { hex: "#0369A1", oklch_l: 0.48 }

      # ──────────────────────────────────────────────────────
      # dual-mode (NFR-39〜41) の例
      # themes_required が ["dark", "light"] のとき:
      #   - palette.tokens[] の各 name を mode: "dark" / mode: "light" の 2 エントリで並べる
      #   - palette.state_colors の各 bg/text/border に light: sub-block を追加
      # themes_required が ["dark"] (現行互換 / 単一モード) のとき:
      #   - mode フィールド・light sub-block は書かない (skill 11 / 12 が単一モードとして解釈)
      # 下記は dual-mode 構造の参考のみ。実プロジェクトでは
      # archetype 世界観を保ったまま明度反転した light 配色を別途設計すること
      # (機械的な L 反転は禁止。NFR-41「両モードで一貫させる」)
      # ──────────────────────────────────────────────────────

      # dual-mode tokens 例 (--color-bg だけ抜粋):
      #   tokens:
      #     - name: "--color-bg"
      #       mode: "dark"
      #       hex: "#0B1220"
      #       oklch: { l: 0.16, c: 0.04, h: 255 }
      #       usage: "全体背景 (深夜空)"
      #       contrast_label: null
      #     - name: "--color-bg"
      #       mode: "light"
      #       hex: "#F1F3F8"
      #       oklch: { l: 0.95, c: 0.01, h: 255 }
      #       usage: "全体背景 (朝光ペーパー、夜空と同 H で世界観を保つ)"
      #       contrast_label: null
      #
      # dual-mode state_colors 例 (error.bg だけ抜粋):
      #   state_colors:
      #     error:
      #       bg:
      #         hex: "#2C1214"
      #         oklch: { l: 0.13, c: 0.05, h: 15 }
      #         contrast_label: null
      #         light:
      #           hex: "#FBE9E7"
      #           oklch: { l: 0.94, c: 0.04, h: 15 }
      #           contrast_label: null
        #   after:  { hex: "#0B76B5", oklch_l: 0.52 }
        #   reason: "surface との contrast 2.92:1 が 1.4.11 閾値 3.0:1 を 0.08 下回り違反"

    typography:
      - role: "display"
        family: "Plus Jakarta Sans"
        weights: [600, 700]
        source: "Google Fonts"
        usage: "見出し・KPI 値（幾何学プレミアム）"
      - role: "base"
        family: "IBM Plex Sans"
        weights: [400, 500, 700]
        source: "Google Fonts"
        usage: "本文・UI ラベル（計装中立）"
      - role: "numeric"
        family: "JetBrains Mono"
        weights: [500, 700]
        source: "Google Fonts"
        usage: "速度・距離・時刻・利用率（エンジニアリング等幅）"
      - role: "display_jp"               # 和文併用がある場合
        family: "Noto Sans JP"
        weights: [500, 700]
        source: "Google Fonts"
        usage: "日本語見出し併用"

    dials:                               # §5 Layout ダイヤル
      design_variance: 6
      motion_intensity: 4
      visual_density: 8

    signature_animation:
      name: "gauge-tick-sweep"
      applied_to: [".kpi-tile .mini-gauge .needle"]
      duration_ms: 1000
      timing: "cubic-bezier(0.22, 1, 0.36, 1)"
      iteration: "infinite"
      keyframes_hint: "rotate 0→8°→0"
      event_binding: null                # タップ/スクロール等のイベント駆動の場合は詳細
      reduced_motion_fallback: "disable"

    depth:
      shadow_sm: "0 1px 2px rgba(3,10,30,0.35)"
      shadow_md: "0 4px 16px rgba(3,10,30,0.55)"
      shadow_lg: "0 16px 40px rgba(3,10,30,0.65)"
      shadow_primary: "0 10px 24px rgba(11,118,181,0.28)"    # CTA hover 時

    layout:
      grid_policy: "12-col / 3-col equal 禁止、計器盤的に 1fr 2fr 1fr や 2fr 3fr の非対称"
      spacing_scale: [4, 8, 12, 16, 24, 32, 48]
      breakpoints: [375, 768, 1024, 1440]

      # ──────────────────────────────────────────────────────
      # layout.descriptor (3案構造差の crisp 判定の SoT)
      # ──────────────────────────────────────────────────────
      # 「色だけ違う・構造同じ」退化を機械検出するため、layout を free-text でなく
      # **構造記述子** で宣言する。値は開いている (閉じたメニューにはしない) が構造化されて
      # いるので distinct 判定が厳密なタプル比較になる (primary OKLCH H 30°差・family_display
      # 全異と同格)。記述子は **主コンテンツ一覧クラス (content_anchor)** に錨を打つので、
      # 装飾 (overlay/underline/::before/border/shadow 等) は対象外 = キーワード除外リスト
      # 不要で装飾ノイズが自動除外される。
      #
      # 不変量: 3 案 (A/B/C) の descriptor タプル {list_container, columns, item_layout} が
      # 全ペア相違であること (differentiation_summary.layout_descriptor_distinct に記録)。
      # 同義に潰れていないか (例: A「単列主体」B「単列レイアウト主体」C「非対称単列」は字面別だが
      # 全部 flex-column,1 で潰れ = NG) を構造値で判定する。
      #
      # content_anchor は brief↔HTML でクラス名一致が前提 (Step 09 agent が骨格に転記し、
      # orchestrator が生成 HTML から同名クラスの構造を再導出して照合する)。
      descriptor:
        content_anchor: ["record-grid", "record-card"]  # 主コンテンツ一覧クラス (複数可・HTML と同名)
        list_container: "grid"          # grid | flex-column | flex-row | stack (一覧の並べ方・開いた文法)
        columns: 2                      # grid track 数 / 横並び数 (単列=1)
        item_layout: "vertical"         # アイテム内部構成 例 vertical | photo-left | fullbleed

      # ── good 例 (RamenLog/android・全ペア相違 → PASS) ─────────────
      #   A: { content_anchor: ["record-grid","record-card"], list_container: "grid",        columns: 2, item_layout: "vertical" }
      #   B: { content_anchor: ["record-list","record-card"], list_container: "flex-column", columns: 1, item_layout: "photo-left" }
      #   C: { content_anchor: ["record-list","record-card"], list_container: "flex-column", columns: 1, item_layout: "fullbleed" }
      #   → A は grid2列、B/C は単列だが item_layout (photo-left vs fullbleed) で相違 = 全ペア distinct
      #
      # ── bad 例 (StudyLoop/mobile・全ペア一致 → FAIL) ──────────────
      #   A=B=C: { content_anchor: ["study-cards","study-card"], list_container: "flex-column", columns: 1, item_layout: "vertical" }
      #   → 3 案とも単列・カード内部構成が同一 (差は border/shadow=装飾のみ)。色だけ違う退化。
      #     この場合は衝突した case だけ list_container / columns / item_layout を実際に変えて
      #     部分 regenerate する (字面だけ変えても構造値が同じなら再び FAIL する)。

    donts:
      - "Inter フォントの使用（anti-slop）"
      - "純黒 #000000 の使用（anti-slop）"
      - "3-col equal レイアウト（anti-slop）"
      - "IBM Plex Sans を display 専用（Plus Jakarta Sans と重複させない）"
      - "絵文字・フォントアイコン（案件制約）"
      - "primary azure をラージ面積で使用（CTA/選択のみ）"
      - "装飾目的の glow・bloom 効果（計装リアリズムを損なう）"

    agent_prompt_guide:                  # §9 を構造化（narrative.agent_prompt_guide に prose 版）
      tokens_json_hint: "10 selected=A の場合 primary=#0B76B5、focus-ring=#38BDF8"
      style_guide_hint: "--font-display: 'Plus Jakarta Sans'、--font-numeric: 'JetBrains Mono' 固定"
      screen_gen_hint: "gauge-tick-sweep を KPI 値表示要素に適用、prefers-reduced-motion 時 disable"
      icon_rule: "インライン SVG のみ、stroke-linecap=round、stroke-width=1.5、Phosphor/Lucide トレース OK"
      additional_rules:
        - "KPI タイルは値＋単位＋mini-gauge の 3 要素セット必須"
        - "amber は 1 バッジのみ、テキスト併記必須"

  # ─────────────────────────────────────────────────────────
  # 案 B / 案 C は同じ構造
  # ─────────────────────────────────────────────────────────
  - id: "B"
    label: "{方向性名}"
    archetype: "{archetype}"
    concept: "{1 文}"
    differentiation: "{一点}"
    narrative:
      visual_theme: |
        ...
      target_fit: |
        ...
      component_stylings: |
        ...
      depth: |
        ...
      agent_prompt_guide: |
        ...
    palette:
      tokens: [ ... ]
      oklch_derivation_note: |
        ...
      loop_correction_history: []
    typography: [ ... ]
    dials: { design_variance: ..., motion_intensity: ..., visual_density: ... }
    signature_animation: { ... }
    depth: { ... }
    layout: { ... }
    donts: [ ... ]
    agent_prompt_guide: { ... }

  - id: "C"
    # ... 同構造

# =============================================================
# 3 案差別化サマリー
# =============================================================
differentiation_summary:
  primary_h_diffs: { "A-B": 49, "A-C": 33, "B-C": 82 }
  family_display: { A: "Plus Jakarta Sans", B: "Syne", C: "Instrument Serif" }
  signature_animation: { A: "gauge-tick-sweep", B: "hex-ripple-outward", C: "whisper-fade-stack" }
  theme_mode: { A: "dark", B: "dark", C: "light" }
  # layout.descriptor タプル {list_container, columns, item_layout} の全ペア相違 (true でなければ衝突 case を部分 regenerate)
  layout_descriptor_distinct: true
  notes: |
    機械的ルール:
    - primary OKLCH H の 3 案間差が 30° 以上
    - family_display が 3 案すべて異なる
    - signature_animation が 3 案すべて異なる
    - layout.descriptor タプルが 3 案すべて異なる (Step 09 orchestrator が HTML から再導出して照合)

# =============================================================
# anti-slop セルフチェック結果
# =============================================================
anti_slop_check:
  all_passed: true
  results:
    - { item: "Inter 不使用", A: true, B: true, C: true }
    - { item: "#000000 不使用", A: true, B: true, C: true }
    - { item: "3-col equal 不使用", A: true, B: true, C: true }
    - { item: "AI Purple / Neon gradient 不使用", A: true, B: true, C: true }
    - { item: "VISUAL_DENSITY>=7 案で Serif を base 不使用", A: true, B: true, C: true }
    - { item: "DESIGN_VARIANCE>=5 案でヒーロー中央揃え不採用", A: true, B: true, C: true }
    - { item: "Tactile Feedback / Staggered Reveals 記載", A: true, B: true, C: true }
    - { item: "signature animation 指定", A: true, B: true, C: true }
    - { item: "family_display 3 案全異", A: true, B: true, C: true }
    - { item: "primary OKLCH H の 3 案間差 30° 以上", A: true, B: true, C: true }
    - { item: "signature_animation 3 案全異", A: true, B: true, C: true }
    - { item: "layout.descriptor タプル 3 案全異", A: true, B: true, C: true }
```

---

## 1 案版（10 承認後の差分）

| 項目 | 3案版（draft:v1） | 1案版（final:v1） |
|---|---|---|
| `schema` | `design-brief:draft:v1` | `design-brief:final:v1` |
| トップレベル | `selected_*` なし | `selected_sample_id: "A"` + `selected_label: "{方向性名}"` + `approved_at` 追加 |
| `cases[]` | A / B / C の 3 エントリ | **A / B / C のまま保持**（retro での棄却案参照のため） |
| `common` | 保持 | 保持 |
| `differentiation_summary` | 保持 | 保持 |
| `anti_slop_check` | 保持 | 保持 |

10 は**メタ情報のみ更新**する（cases[] の並び替え・削除はしない）。12 以降は `yaml.cases[selected_sample_id]` を filter して読む。

---

## 不変量（divergence を構造的に排除）

- 08 が唯一の author（新規生成・ループ再実行時の上書き）
- 10 承認時は yaml のトップレベルのみ 4 フィールド追加（schema 更新・selected_sample_id・selected_label・approved_at）
- 10 否認時は yaml 削除
- WCAG ループ時（11 が violations[] 検出 → 08 再実行）は該当 case の `palette.tokens[]` と `palette.loop_correction_history[]` を更新。narrative は基本そのまま保持（OKLCH 導出根拠に補正経緯を追記するのみ）

## narrative フィールドの書き方指針

LLM priming の質を最大化するため、narrative 各フィールドは以下の原則で書く:

- **visual_theme**: archetype の世界観を物語る 2〜4 文。concept の背景・狙い・情動を自然言語で表現
- **target_fit**: このユーザー層にこの案が刺さる理由。2〜3 文、具体的な業務文脈を含める
- **component_stylings**: §4 の質感語彙。「ボタンは〜」「カードは〜」の prose で書き、CSS 値は含めない（それらは dials / depth / palette に機械的に格納）
- **depth**: §6 の質感描写。「和紙的拡散光」「金箔の硬い影」等、素材・感触の形容で書く
- **agent_prompt_guide**: §9 narrative 全文。signature animation の適用先・event binding・composition 指示を自然言語で書く。下流 17 の screen-gen で LLM が忠実再現できる粒度まで具体化する
