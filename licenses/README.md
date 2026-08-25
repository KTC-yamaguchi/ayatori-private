# licenses/

AYATORI が使用・参照したサードパーティ資料のライセンス原文を保持するディレクトリ。

- **npm ライブラリ**（style-dictionary 等）: ツールとして使用。ライセンス条件を直接充足するため原文を同梱
- **Anthropic 資料**（frontend-design / cookbooks）: コンセプト参照（「inspired by」関係）。literal コピーなし、保守的対応として原文を同梱
- **成果物に同梱・再配布するアセット**（Heroicons / Phosphor Icons の SVG）: 再配布に該当するため原文同梱が必須
- **生成 HTML が CDN 参照するライブラリ**（Mermaid.js）: コード再配布なしだが成果物が動作依存するため保守的対応として原文を同梱

プロジェクト全体の帰属表示・対応状況は、リポジトリルートの [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md) に集約されています。本ファイルは「どのライセンス文が、AYATORI のどの参照箇所に対応するか」を監査・レビュー時に追跡できるようにする索引です。

---

## ファイル一覧

| ファイル | ライセンス種別 | 出自 | 対応する AYATORI 参照箇所 |
|---|---|---|---|
| [`style-dictionary-Apache-2.0`](./style-dictionary-Apache-2.0) | Apache License 2.0 | `style-dictionary/style-dictionary` npm package v5.4.0 の `LICENSE` | `skills/12-design-system/refs/build-tokens.md` Step 3（トークンビルド実行） |
| [`style-dictionary-NOTICE`](./style-dictionary-NOTICE) | — (NOTICE ファイル) | `style-dictionary/style-dictionary` npm package v5.4.0 の `NOTICE` | Apache-2.0 Section 4(d) 対応 |
| [`pdf-lib-MIT`](./pdf-lib-MIT) | MIT License | `Hopding/pdf-lib` npm package v1.17.1 の `LICENSE.md` | `scripts/split-pdf.mjs`（10 ページ超 PDF の分割） |
| [`frontend-design-Apache-2.0`](./frontend-design-Apache-2.0) | Apache License 2.0 | `anthropics/claude-code` リポジトリ配布の `plugins/frontend-design/LICENSE` | `skills/08-design-brainstorm/SKILL.md` Phase 2.0.2 B/D/E 項（思想・構造を参考） |
| [`anthropic-cookbooks-MIT`](./anthropic-cookbooks-MIT) | MIT License | `anthropics/claude-cookbooks` リポジトリの `LICENSE` | `skills/08-design-brainstorm/SKILL.md` Phase 2.0.2 A/C/G 項（思想・構造を参考） |
| [`mermaid-MIT`](./mermaid-MIT) | MIT License | `mermaid-js/mermaid` リポジトリの `LICENSE` | `docs/templates/transition-map.template.html`（生成 HTML が jsDelivr CDN から v11.15.0 を読み込み） |
| [`heroicons-MIT`](./heroicons-MIT) | MIT License | `tailwindlabs/heroicons` リポジトリの `LICENSE` | `skills/17-screen-gen/SKILL.md` Step 0（SVG を `artifacts/{app}/icons/` に保存し成果物に同梱・再配布） |
| [`phosphor-icons-MIT`](./phosphor-icons-MIT) | MIT License | `phosphor-icons/core` リポジトリの `LICENSE` | 同上（skill 17 Step 0 のアイコン取得ライブラリ選択肢） |

---

## 参照範囲の詳細

### style-dictionary-Apache-2.0 / style-dictionary-NOTICE

**原典**: `style-dictionary/style-dictionary` npm package（Apache-2.0 配下）  
**バージョン**: v5.4.0  
**GitHub**: https://github.com/style-dictionary/style-dictionary

**AYATORI 側での使用箇所**:

| ファイル | 使用内容 |
|---|---|
| `skills/12-design-system/refs/build-tokens.md` | `npx style-dictionary build` を実行し、`tokens.json`（W3C DTCG 形式）を CSS / SCSS / JS / TypeScript / iOS Swift / Android XML / Compose / Flutter の 9 プラットフォームに変換 |
| `package.json`（repo root） | `"style-dictionary": "5.4.0"` として依存を宣言（厳密固定。かつての `artifacts/{app_name}/build/package.json` での per-project 宣言は廃止） |

style-dictionary は **ツールとして実行する依存** であり、AYATORI のコード中に取り込んでいません。生成された成果物（CSS 変数・トークンファイル）は AYATORI 固有の設計値であり、style-dictionary のコードを含みません。

**Apache-2.0 Section 4 への対応状況**:

| 条件 | 対応 |
|---|---|
| (a) License 全文同梱 | `licenses/style-dictionary-Apache-2.0` に Apache-2.0 原文を同梱 |
| (b) 変更ファイルへの変更告知 | 不要（style-dictionary 自体を改変していない） |
| (c) 著作権・帰属表示の保持 | `THIRD-PARTY-NOTICES.md` §1 + `skills/12-design-system/refs/build-tokens.md` 冒頭コメントに記載 |
| (d) NOTICE ファイル継承 | `licenses/style-dictionary-NOTICE` に NOTICE 全文を同梱。`THIRD-PARTY-NOTICES.md` §1 にもインライン記載 |

---

### pdf-lib-MIT

**原典**: `Hopding/pdf-lib` npm package（MIT 配下、© 2019 Andrew Dillon）
**バージョン**: v1.17.1
**GitHub**: https://github.com/Hopding/pdf-lib

`scripts/split-pdf.mjs` が 10 ページ超の PDF を Read tool の native 経路（`pages` パラメータなし）で読める part に分割するために使用する。PDF のレンダリングは poppler 等の外部 CLI が必須のため導入不可（`CLAUDE.md` Operating Principle 1）だが、ページ分割は純 JS で完結するため、style-dictionary と同じ「repo に pin 済みの npm 依存」例外形態で賄う。ツールとして実行する依存であり AYATORI のコード中に取り込んでいない。分割 part は入力 PDF の内容そのものであり pdf-lib のコードを含まない（再配布に非該当）。

---

### frontend-design-Apache-2.0

**原典**: `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/frontend-design/skills/frontend-design/SKILL.md`（Apache-2.0 配下）

**AYATORI 側での参照箇所**（`skills/08-design-brainstorm/SKILL.md` — literal なコピーではなく、思想・構造を参考）:

| AYATORI 条項 | 参考にした原典の思想 | 独自化の度合い |
|---|---|---|
| Phase 2.0.2 **B 項**（既定収束からの離脱） | SKILL.md "NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (purple gradients on white backgrounds)" / "NEVER converge on common choices (Space Grotesk)" | 列挙内容はほぼ踏襲（事実情報レベルの共通化）。`#000000` 純黒・等分 3-col grid・中央揃え hero は AYATORI 独自追加 |
| Phase 2.0.2 **D 項**（支配色 + 差し色 2 層構造） | SKILL.md "Dominant colors with sharp accents outperform timid, evenly-distributed palettes" | 反対論法の論理構造を参考。日本語表現・「面積色／点色」の語彙は AYATORI 独自 |
| Phase 2.0.2 **E 項**（Motion 1 本集中） | SKILL.md "one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions" | 論理構造を参考、"staggered reveal" 用語は業界共通語。`signature animation` の命名ルールは AYATORI 独自 |
| Phase 2.0.2 **F 項** の構造（極端 1 つを選んで貫く） | SKILL.md "Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, ..." | 設計思想のみ参考。アーキタイプ 10 型の語彙（削ぎ落とし型 / 密度過飽和型 / 金箔静謐型 等）は完全独自化 |

**Apache-2.0 Section 4 への対応状況（保守的対応）**:

原典を literal にコピーしていないため Section 4 の義務は厳密には発動しないと認識していますが、保守的立場から以下のとおり対応しています:

- (a) License 全文同梱 → 本ディレクトリに原文コピーを保持
- (b) 変更ファイルへの変更告知 → 該当なし（原ファイルをコピー配置していない）
- (c) attribution notice 保持 → `THIRD-PARTY-NOTICES.md` + `SKILL.md` L79-87 の HTML コメントで参考元を明記
- (d) NOTICE ファイル継承 → 上流に NOTICE ファイルなし、該当なし

---

### anthropic-cookbooks-MIT

**原典**: `anthropics/claude-cookbooks` の `coding/prompting_for_frontend_aesthetics.ipynb`（MIT 配下）

**AYATORI 側での参照箇所**（`skills/08-design-brainstorm/SKILL.md` — literal なコピーではなく、思想・構造を参考）:

| AYATORI 条項 | 参考にした原典の思想 | 独自化の度合い |
|---|---|---|
| Phase 2.0.2 **A 項**（4 軸を個別に誘導） | Cookbook の 4 軸構成（Typography / Color & Theme / Motion / Backgrounds） | 分類軸そのものは cookbook と共通（分類体系は著作物性が低い）。軸を「独立して言語化せよ」と明示する指示は AYATORI 独自の運用ルール |
| Phase 2.0.2 **C 項**（抽象語禁止、具体参照で語る） | Cookbook 3 戦略「Reference concrete inspirations / Call out common defaults」 | 発想は cookbook 由来、具体例（Dracula / Nord / Gruvbox / PANTONE / 金箔・漆・和紙 等）は AYATORI 独自 |
| Phase 2.0.2 **G 項**（書体 5 分類） | Cookbook の書体カテゴリ（Editorial / Technical / Distinctive / Startup / Code aesthetic） | カテゴリ数 5 は cookbook を参考、分類語彙は独自（世界観系 Serif / 実用系 Sans / 個性系 Display / 数値・等幅系 Mono）。和文系は AYATORI 独自追加の 6 分類目 |
| `skills/08-design-brainstorm/refs/typography-pairing.md` | Cookbook の書体例示（Playfair Display / Fraunces / IBM Plex / Clash Display / Satoshi / JetBrains Mono 等） | 具体書体名は事実データ（著作物性低）。ペアリング推奨例は AYATORI 独自 |

**MIT への対応状況（保守的対応）**:

原典の substantial portion を literal にコピーしていないため MIT の条件は厳密には発動しないと認識していますが、誠実な帰属表示として以下のとおり対応しています:

- 著作権・許諾表示の同梱 → 本ディレクトリに MIT 原文（Copyright © 2023 Anthropic を含む）を保持
- substantial portion コピーなし（構造・分類軸の参考にとどめ、原文の逐語コピーはなし）

---

### mermaid-MIT

**原典**: `mermaid-js/mermaid`（MIT 配下、© 2014-2022 Knut Sveidqvist）  
**GitHub**: https://github.com/mermaid-js/mermaid

`docs/templates/transition-map.template.html` が `https://cdn.jsdelivr.net/npm/mermaid@11.15.0/dist/mermaid.min.js` を `<script src>` で読み込み、Step 14 / 29 が派生生成する `screens/00-transition-map.html` の画面遷移図をブラウザ内でレンダリングする。コード自体は成果物に同梱せず CDN 参照のみ（再配布に非該当）だが、成果物が動作依存するため保守的対応として原文を同梱。

---

### heroicons-MIT / phosphor-icons-MIT

**原典**: `tailwindlabs/heroicons`（MIT、© Tailwind Labs, Inc.）/ `phosphor-icons/core`（MIT、© 2023 Phosphor Icons）

`skills/17-screen-gen/SKILL.md` Step 0 がアイコン SVG を GitHub raw URL から取得し `artifacts/{app_name}/icons/{name}.svg` に**保存**する。保存された SVG は画面 HTML に inline 埋め込みされ、`/ayatori-export` の自己完結 HTML にも同梱される — つまり **SVG ファイルの再配布に該当** し、MIT の著作権表示・許諾表示の同梱義務が発動する。原文を本ディレクトリに同梱し、`THIRD-PARTY-NOTICES.md` §5〜6 + §12 外販向け表示文で帰属を明示する。

per-file の取得元は各プロジェクトの `artifacts/{app_name}/icons-manifest.json`（`source_url` field）で追跡可能。なお `--normalize-icons` による `currentColor` 置換（色の正規化）は機械的変換であり、MIT 下で改変は許諾されている。

---

### （原文同梱なし）Atlassian MCP / Figma MCP / Web フォント

- **Atlassian MCP**（`https://mcp.atlassian.com/v1/mcp/authv2`、OAuth 2.1）: Atlassian 社の公式リモート MCP でホステッドサービスのため、同梱するライセンス原文が存在しない。詳細は `THIRD-PARTY-NOTICES.md` §7。旧方式の非公式 npm パッケージ `mcp-atlassian`（`npx -y` 実行）はサプライチェーンリスクのため廃止済み（`README.md` 「旧方式の廃止」参照）で、現行構成に利用箇所がないため原文同梱の対象外
- **Figma MCP**（`https://mcp.figma.com/mcp` + capture.js）: Figma 社のホステッドサービスで OSS ではないため、同梱するライセンス原文が存在しない。詳細は `THIRD-PARTY-NOTICES.md` §8
- **Google Fonts Web フォント**: CDN リンク参照のみでフォントファイルを再配布しないため OFL の表示義務が発動しない。詳細は `THIRD-PARTY-NOTICES.md` §9。フォントを self-host / 成果物同梱に切り替える場合は該当フォントの OFL 原文を本ディレクトリに追加すること

---

## ライセンス互換性メモ

Apache-2.0 と MIT は一方向互換です。本プロジェクトは両者の思想・構造を参考にした独自実装なので、**仮に Derivative Work と解釈される余地がある場合に備えて両ライセンスの条件に並立して対応**しています。どちらか片方が上位というわけではなく、各参照元ごとに保守的に条件を充足する構成です。

---

## 文言方針（藪蛇回避）

本ドキュメント群（`THIRD-PARTY-NOTICES.md` / 本 README / `SKILL.md` 内 HTML コメント）では、原典との関係を表す動詞として以下を使い分けています:

| 使用する表現（中立・弱め） | 使用しない表現（Derivative Work 自認寄り） |
|---|---|
| 参考にした / referenced | 派生した / derived from |
| 参照箇所 | 借用箇所 / portions based on |
| 思想・構造を参考 | 原文を incorporate |
| developed with reference to | Derivative Work of |

**理由**: AYATORI は原典を literal にコピーしていないため、厳密には Derivative Work に該当しない「inspired by」の関係である可能性が高い。強い表現を使うと自ら Derivative Work であることを認めたと解釈される余地があり（藪蛇）、本来主張できる立場を放棄することになるため。LICENSE 同梱 + 帰属表示は保守的対応として維持しつつ、文言は中立に保つ方針。

---

## 監査用チェックリスト

プロジェクトを外販・OSS 公開・監査提出する前に確認すべき項目:

- [ ] `licenses/style-dictionary-Apache-2.0` が Apache-2.0 原文として存在する
- [ ] `licenses/style-dictionary-NOTICE` が NOTICE 原文（"Style Dictionary\nCopyright Style Dictionary Contributors."）として存在する
- [ ] `licenses/pdf-lib-MIT` が MIT 原文（Copyright (c) 2019 Andrew Dillon）として存在する
- [ ] `licenses/frontend-design-Apache-2.0` が Apache-2.0 原文（11,358 バイト相当）として存在する
- [ ] `licenses/anthropic-cookbooks-MIT` が MIT 原文として存在する
- [ ] `licenses/mermaid-MIT` / `licenses/heroicons-MIT` / `licenses/phosphor-icons-MIT` が各 MIT 原文として存在する
- [ ] `THIRD-PARTY-NOTICES.md` に全ライセンスの帰属表示がある（style-dictionary §1、pdf-lib §1b、frontend-design §2、cookbooks §3、Mermaid §4、Heroicons §5、Phosphor §6。Atlassian MCP §7 / Figma MCP §8 はホステッドサービスとして原文同梱不要の根拠を記載）
- [ ] `skills/12-design-system/refs/build-tokens.md` 冒頭の HTML コメントに style-dictionary の attribution が残っている
- [ ] `skills/08-design-brainstorm/SKILL.md` Phase 2.0.2 冒頭の HTML コメントに attribution が残っている
- [ ] Web UI 実装時、設定画面等に外販向け attribution 表示（`THIRD-PARTY-NOTICES.md` §12 の推奨文）が埋め込まれている
- [ ] 新たに npm / npx 依存・MCP サーバ・CDN 読み込みライブラリ・同梱アセット（アイコン / フォント等）・外部プラグイン・cookbook を追加する場合、本ディレクトリに LICENSE 全文（+ NOTICE があれば NOTICE）を追加し、本 README の「参照範囲の詳細」と `THIRD-PARTY-NOTICES.md` にエントリを追加する（運用ルールの正本: `THIRD-PARTY-NOTICES.md` §10）
- [ ] バージョン未 pin で実行時解決される依存が存在する場合、そのバージョン更新時にライセンス種別が変わっていないか再確認した
- [ ] 「文言方針」セクションの表現ガイド（参考にした / 参照箇所 等の中立表現）に沿って記述する

---

## 参考メモ

- monorepo 内のサブディレクトリは、**リポジトリルートの LICENSE と配布バンドル単位の LICENSE を別物として扱う** 必要があります。本プロジェクトでは配布バンドル（`plugins/frontend-design/LICENSE`）が Apache-2.0 であることを確認済みです。
- 過去に「GitHub リポジトリルートの LICENSE が Commercial ToS だから derive 権なし」と一度誤判定し、配布バンドル単位の LICENSE を確認して訂正した経緯があります。今後同種の資産を取り込む際は、必ず `~/.claude/plugins/cache/<owner>/<plugin>/<version>/LICENSE*` レベルで確認してください。
