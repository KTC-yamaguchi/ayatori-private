# Third-Party Notices

本プロジェクト（AYATORI パイプライン）は、以下のサードパーティソフトウェアおよび資料を使用・参照しています。

- **§1 Style Dictionary**: npm ライブラリとしてビルドツールに使用（Apache-2.0 条件を直接充足）
- **§1b pdf-lib**: npm ライブラリとして 10 ページ超 PDF の分割に使用（MIT 条件を直接充足）
- **§2〜3 Anthropic 資料**: 原則・思想・構造を参考にした独自実装。literal コピーなし（「inspired by」の関係）。保守的立場からライセンス条件に対応
- **§4 Mermaid.js**: 生成 HTML（画面遷移図）が CDN から読み込む描画ライブラリ（MIT）
- **§5〜6 Heroicons / Phosphor Icons**: アイコン SVG を取得して成果物に同梱・再配布（MIT 条件を直接充足）
- **§7〜8 Atlassian MCP / Figma MCP**: 各社のホステッドサービス（OSS ではなく利用規約ベース。同梱すべきライセンス原文なし）
- **§9 Web フォント（Google Fonts）**: CDN リンクのみでフォントファイルを再配布しないため、ライセンス原文同梱は不要（根拠を記載）

本文書は誠実な帰属表示と、Web ツール化時の UI 表示（例: 設定画面の「サードパーティ表示」、フッターの「Licenses」リンク等）にコピーして利用できる原稿を兼ねています。

---

## 1. Style Dictionary

- **由来**: `style-dictionary/style-dictionary` npm package
- **バージョン**: v5.4.0
- **著作権**: © Style Dictionary Contributors
- **ライセンス**: Apache License, Version 2.0
- **ライセンス原文**: [`licenses/style-dictionary-Apache-2.0`](./licenses/style-dictionary-Apache-2.0)
- **NOTICE 原文**: [`licenses/style-dictionary-NOTICE`](./licenses/style-dictionary-NOTICE)
- **使用箇所**: `skills/12-design-system/refs/build-tokens.md`（W3C DTCG 形式の tokens.json を CSS / SCSS / JS / TypeScript / iOS Swift / Android XML / Compose / Flutter の 9 プラットフォームに変換するビルドツールとして使用）

### NOTICE（Apache-2.0 Section 4(d) 対応）

```
Style Dictionary
Copyright Style Dictionary Contributors.
```

### Apache-2.0 Section 4 への対応状況

| 条件 | 対応 |
|---|---|
| (a) License 全文の同梱 | `licenses/style-dictionary-Apache-2.0` に Apache-2.0 原文を同梱 |
| (b) 変更ファイルへの変更告知 | 不要（style-dictionary 自体を改変していない） |
| (c) 著作権・帰属表示の保持 | 本文書および `skills/12-design-system/refs/build-tokens.md` 冒頭コメントに著作権・帰属を明記 |
| (d) NOTICE ファイル継承 | `licenses/style-dictionary-NOTICE` に全文を同梱。上記の NOTICE ブロックにもインライン記載 |

---

## 1b. pdf-lib

- **由来**: `Hopding/pdf-lib` npm package
- **バージョン**: v1.17.1
- **著作権**: © 2019 Andrew Dillon
- **ライセンス**: MIT License
- **ライセンス原文**: [`licenses/pdf-lib-MIT`](./licenses/pdf-lib-MIT)
- **使用箇所**: `scripts/split-pdf.mjs`（10 ページ超の PDF を Read tool の native 経路で読める part に分割する。ページ分割は純 JS で完結するため、外部 CLI を導入しない原則と両立する pin 依存 — `CLAUDE.md` Operating Principle 1 の例外形態）

### MIT への対応状況

- 著作権・許諾表示の同梱 → `licenses/pdf-lib-MIT` に MIT 原文（Copyright (c) 2019 Andrew Dillon）を同梱
- pdf-lib は **ツールとして実行する依存** であり、AYATORI のコード中に取り込んでいない。分割された PDF part は入力文書の内容そのものであり、pdf-lib のコードを含まない（再配布に非該当）

---

## 2. Anthropic Frontend Design Plugin（コンセプト参照）

- **由来**: `anthropics/claude-code` リポジトリ同梱の `plugins/frontend-design/` プラグイン
- **著作権**: © Anthropic PBC
- **ライセンス**: Apache License, Version 2.0
- **ライセンス原文**: [`licenses/frontend-design-Apache-2.0`](./licenses/frontend-design-Apache-2.0)
- **参照箇所**（AYATORI が原則・思想を参考にした箇所。literal なコピーではない）: `skills/08-design-brainstorm/SKILL.md` Phase 2.0.2（3 案 aesthetic direction 生成の原則）
  - 4 軸分離（Typography / Color & Theme / Motion / Background）の構造
  - 既定収束先（Inter / Roboto / Arial / system-default 書体、紫〜ピンクグラデ、純黒等）の回避方針
  - 支配色 + 差し色 2 層構造の思想
  - Motion を 1 本の signature animation に集中させる思想（staggered reveal など）

### Apache-2.0 Section 4 への対応状況（保守的対応）

AYATORI は原典を literal にコピーしていないため Section 4 の義務は厳密には発動しないと認識していますが、保守的立場から以下のとおり対応しています:

| 条件 | 対応 |
|---|---|
| (a) License 全文の同梱 | `licenses/frontend-design-Apache-2.0` に Apache-2.0 原文を同梱 |
| (b) 変更ファイルへの変更告知 | 該当なし（原ファイルをコピー配置していないため） |
| (c) 著作権・帰属表示の保持 | 本文書および `skills/08-design-brainstorm/SKILL.md` L79-87 の HTML コメントに参考元の表示を明記 |
| (d) NOTICE ファイル継承 | 該当なし（上流配布バンドルに NOTICE ファイルが存在しないため） |

---

## 3. Anthropic Frontend Aesthetics Cookbook（コンセプト参照）

- **由来**: `anthropics/claude-cookbooks` リポジトリの `coding/prompting_for_frontend_aesthetics.ipynb`
- **著作権**: © 2023 Anthropic
- **ライセンス**: MIT License
- **ライセンス原文**: [`licenses/anthropic-cookbooks-MIT`](./licenses/anthropic-cookbooks-MIT)
- **参照箇所**（AYATORI が原則・思想を参考にした箇所。literal なコピーではない）: `skills/08-design-brainstorm/SKILL.md` Phase 2.0.2（3 案 aesthetic direction 生成の原則）
  - 4 軸構成（Typography / Color & Theme / Motion / Background）
  - 3 戦略（Guide specific dimensions / Reference concrete inspirations / Call out common defaults）の発想
  - 書体 5 分類（Editorial / Technical / Distinctive / Startup / Code aesthetic 相当）の分類軸
  - AI 収束警告（Space Grotesk / Inter / 紫グラデ / 白背景 などの既定収束先）の列挙

### MIT への対応状況（保守的対応）

AYATORI は原典の substantial portion を literal にコピーしていないため MIT の条件は厳密には発動しないと認識していますが、誠実な帰属表示として以下のとおり対応しています:

| 条件 | 対応 |
|---|---|
| 著作権表示と許諾表示の同梱 | `licenses/anthropic-cookbooks-MIT` に MIT 原文（Copyright © 2023 Anthropic を含む）を同梱。本文書にも記載 |

---

## 4. Mermaid.js

- **由来**: `mermaid-js/mermaid`（https://github.com/mermaid-js/mermaid）
- **バージョン**: v11.15.0（jsDelivr CDN 経由）
- **著作権**: © 2014-2022 Knut Sveidqvist
- **ライセンス**: MIT License
- **ライセンス原文**: [`licenses/mermaid-MIT`](./licenses/mermaid-MIT)
- **使用箇所**: `docs/templates/transition-map.template.html`（Step 14 / 29 が派生生成する `artifacts/{app_name}/screens/00-transition-map.html` に `<script src="https://cdn.jsdelivr.net/npm/mermaid@11.15.0/dist/mermaid.min.js">` として含まれ、画面遷移図をブラウザ内でレンダリングする）

### MIT への対応状況

Mermaid.js のコード自体は成果物に同梱せず CDN リンクで参照するのみ（利用者のブラウザが実行時に取得）。厳密には「substantial portion の再配布」に該当しないと認識していますが、成果物 HTML が動作上依存するライブラリであるため、誠実な帰属表示として原文を同梱し本文書に記載しています。

---

## 5. Heroicons

- **由来**: `tailwindlabs/heroicons`（https://github.com/tailwindlabs/heroicons）
- **著作権**: © Tailwind Labs, Inc.
- **ライセンス**: MIT License
- **ライセンス原文**: [`licenses/heroicons-MIT`](./licenses/heroicons-MIT)
- **使用箇所**: `skills/17-screen-gen/SKILL.md` Step 0（アイコン SVG を GitHub raw URL から取得し `artifacts/{app_name}/icons/{name}.svg` に**保存**。画面 HTML に inline 埋め込みされ、`/ayatori-export` の自己完結 HTML にも同梱される = **再配布に該当**）
- **トレーサビリティ**: 各プロジェクトの `artifacts/{app_name}/icons-manifest.json` が icon ごとの `source_url` を記録する

### MIT への対応状況

SVG ファイルそのものを成果物に取り込み再配布するため、MIT の条件（著作権表示と許諾表示の同梱）が発動します。`licenses/heroicons-MIT` に原文を同梱し、本文書 + §12 の外販向け表示文で帰属を明示します。

---

## 6. Phosphor Icons

- **由来**: `phosphor-icons/core`（https://github.com/phosphor-icons/core）
- **著作権**: © 2023 Phosphor Icons
- **ライセンス**: MIT License
- **ライセンス原文**: [`licenses/phosphor-icons-MIT`](./licenses/phosphor-icons-MIT)
- **使用箇所**: Heroicons と同じ（`skills/17-screen-gen/SKILL.md` Step 0 のアイコン取得ライブラリの選択肢。取得した SVG は `artifacts/{app_name}/icons/` に保存され成果物に同梱 = **再配布に該当**）

### MIT への対応状況

Heroicons §5 と同様。`licenses/phosphor-icons-MIT` に原文を同梱し、本文書 + §12 の外販向け表示文で帰属を明示します。

---

## 7. Atlassian MCP（ホステッドサービス）

- **由来**: Atlassian 社が提供する公式リモート MCP エンドポイント（`https://mcp.atlassian.com/v1/mcp/authv2`、OAuth 2.1 認証）
- **ライセンス**: OSS ではない。Atlassian の利用規約（Terms of Service）に基づくホステッドサービス
- **使用箇所**: `.mcp.json`（`"atlassian": { "type": "http", "url": "https://mcp.atlassian.com/v1/mcp/authv2" }` — Confluence 保存ステップ等が使用）

### 対応状況

ローカルにコードを同梱しないため、OSS ライセンス原文の同梱対象はありません。サービス利用は Atlassian アカウントの利用規約に従います。

> **旧方式（廃止済み）**: 以前の `.mcp.json` は非公式 npm パッケージ `mcp-atlassian`（MIT）を `npx -y` でバージョン未固定実行していたが、サプライチェーンリスクのため公式リモート MCP に移行済み（経緯は `README.md` 「旧方式の廃止」参照）。現行構成に npm 版 `mcp-atlassian` の利用箇所は存在しないため、ライセンス原文の同梱対象外。

---

## 8. Figma MCP（ホステッドサービス）

- **由来**: Figma 社が提供するリモート MCP エンドポイント（`https://mcp.figma.com/mcp`）
- **ライセンス**: OSS ではない。Figma の利用規約（Terms of Service）に基づくホステッドサービス
- **使用箇所**:
  - `.mcp.json`（`"figma": { "type": "http", "url": "https://mcp.figma.com/mcp" }`）
  - Figma capture script（`<script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async>` — default HTML には Step 22 が注入（`phases/screens/SKILL.md` P-08）、sub-state HTML には Step 25b（delta フローでは Step 29）が注入。スクリプト本体は Figma 社サーバから実行時に配信され、repo には URL 参照のみ）

### 対応状況

ローカルにコードを同梱しないため、OSS ライセンス原文の同梱対象はありません。サービス利用は Figma アカウントの利用規約に従います。`FIGMA_MCP_ENABLED=false` の場合は一切使用されません（スタブモード）。capture.js の `<script>` タグは成果物 HTML に残留しますが、これは URL 参照であり Figma のコードの再配布ではありません。

---

## 9. Web フォント（Google Fonts — 原文同梱不要の根拠）

- **対象**: 生成 HTML が `fonts.googleapis.com` から読み込む Web フォント（`Noto Sans JP` / `Inter` / `Plus Jakarta Sans` のほか、プロジェクトごとに design-brief が選定する書体）
- **ライセンス**: 大半が SIL Open Font License 1.1（一部 Apache-2.0）
- **使用箇所**: `skills/17-screen-gen/SKILL.md` / `skills/09-sample-html-gen/refs/variant-switcher-template.html` / `docs/templates/transition-map.template.html` 等の `<link href="https://fonts.googleapis.com/css2?...">`

### 原文同梱を不要と判断する根拠

フォントファイル（woff2 等）を repo にも成果物にも**同梱していない**（`/ayatori-export` の base64 埋め込み対象も画像のみでフォントは含まない）。CDN リンク参照のみの場合、フォントの再配布に該当せず OFL / Apache-2.0 の表示義務は発動しない。将来フォントファイルを self-host / 成果物同梱する場合は、その時点で該当フォントの OFL 原文を `licenses/` に追加すること（§10 運用ルール参照）。

**書体選定は Google Fonts 収載書体に限る**（`skills/08-design-brainstorm/SKILL.md` G 項 / `refs/typography-pairing.md` 前提に明記）。Fontshare 等の他のフォント配信サービスは利用していない（生成 HTML の font loader が `fonts.googleapis.com` のみ対応のため、収載外書体は読み込めず fallback に劣化する）。他サービスの書体を採用する場合は、loader 対応とあわせて §10 運用ルールに従い当該サービス / フォントライセンスの記載を追加すること。

### 参考: その他のライセンス対応不要な参照

- **OKLab ↔ sRGB 変換行列**（`scripts/oklch-color.mjs`）: Björn Ottosson 公表の数式（https://bottosson.github.io/posts/oklab/ — 著者がパブリックドメイン宣言）。コード内コメントで出典を明記済み
- **WCAG 2.2 / W3C DTCG 仕様**（`docs/wcag-standards.md` / `docs/dtcg-spec-ref.md`）: 仕様の数式・閾値を独自に要約実装したもので、仕様文書の逐語コピーなし。出典 URL を各ファイル冒頭に明記済み
- **style-dictionary / pdf-lib の transitive 依存**（`package-lock.json` 配下）: ビルド・分割の実行時のみ使用し成果物に再配布しない。直接依存本体の対応（§1 / §1b）で足りると判断

---

## 10. 依存追加時の運用ルール

今後、以下のいずれかを追加・変更する際は、**同じ PR 内で** ライセンス対応を行うこと:

| 追加するもの | 必須対応 |
|---|---|
| npm / npx 依存（`package.json` / skill 内での `npx` 実行） | ① ライセンス種別を確認（`npm view {pkg} license`）② 原文を `licenses/{pkg}-{LICENSE}` に同梱 ③ 本文書にセクション追加 ④ `licenses/README.md` の索引に行追加 |
| MCP サーバ（`.mcp.json`） | ローカル実行型（npx / uvx 等）は npm 依存と同じ。リモート型（http）はホステッドサービスとして §7〜8 同様に記載（原文同梱は不要） |
| CDN 読み込みライブラリ（生成 HTML の `<script src>` / `<link>`） | 成果物が動作依存するため本文書にセクション追加 + 原文同梱（保守的対応） |
| アセットの取得・同梱（アイコン SVG / イラスト / フォントファイル等） | **再配布に該当**するため必ず原文同梱 + 帰属表示（§5〜6 参照）。取得元 URL を manifest 等で per-file 記録する |
| 既存依存のバージョン更新 | ライセンス種別が変わっていないか再確認（特にバージョン未 pin で実行時解決される依存がある場合） |
| コンセプト参照（外部ドキュメント・プラグインの思想を参考にする） | §2〜3 と同じ保守的対応（原文同梱 + 中立文言での帰属表示）。文言は `licenses/README.md` の「文言方針」に従う |

チェックリストの正本は `licenses/README.md` の「監査用チェックリスト」。

---

## 11. 独自実装部分（参考までに）

以下は AYATORI が独自に実装した部分であり、上記サードパーティ由来ではありません:

- Phase 2.0.2 F 項「世界観アーキタイプ 10 型」（削ぎ落とし型 / 密度過飽和型 / 希望技術合流型 / 判型エディトリアル型 / 未加工生地型 / 金箔静謐型 / 筆致有機型 / 幾何対称型 / 計器機能美型 / 文化文脈型）
- Phase 2.0.2 H 項 AYATORI 固有制約（concept 命名「名詞 + 状態 + 情動」パターン / AP4 セルフ検証 5 軸 / 3 案独立離散ルール 等）
- Phase 1 6 軸ヒアリング構成
- Phase 3 OKLCH 空間での WCAG by construction 補正アルゴリズム
- Phase 4-7 のパイプライン実行フロー全体
- 各 SKILL.md の入出力 JSON schema・artifacts ディレクトリ設計

---

## 12. Web ツール（外販 / SaaS）向けの表示推奨文

Web ツール化時は、UI の「Legal / About / Third-party notices」セクション等に以下を掲示してください:

> This product uses the following third-party software and references:
>
> - Style Dictionary, © Style Dictionary Contributors (Apache License, Version 2.0)
> - pdf-lib, © 2019 Andrew Dillon (MIT License)
> - Anthropic Frontend Design Plugin, © Anthropic (developed with reference to, Apache License, Version 2.0)
> - Anthropic Frontend Aesthetics Cookbook, © 2023 Anthropic (developed with reference to, MIT License)
> - Mermaid, © 2014-2022 Knut Sveidqvist (MIT License)
> - Heroicons, © Tailwind Labs, Inc. (MIT License)
> - Phosphor Icons, © 2023 Phosphor Icons (MIT License)
>
> Full license texts are available at: [link to licenses page]

各ライセンス原文へのリンク（または同梱ダウンロード）も併設してください。Anthropic 資料については「derived from」「based on」ではなく「**developed with reference to**」を使用し、Derivative Work としての自認を避けた中立的な文言にしています。

---

## 13. 変更履歴（このファイル）

| 日付 | 変更内容 |
|---|---|
| 2026-04-23 | frontend-design プラグイン依存を除去し AYATORI 内部完結に置換（branch: `feature/remove-frontend-design-plugin-dependency`） |
| 2026-04-24 | SKILL.md 由来表現を独自語彙化。配布バンドル Apache-2.0 LICENSE を確認し two-source attribution 方式で確定 |
| 2026-04-24 | 本 THIRD-PARTY-NOTICES.md を新設（外販向け attribution 表示原稿の整備） |
| 2026-04-24 | 文言を「Derivative Work 自認」から「参考にした独自実装」寄りに調整（藪蛇リスク最小化のため。法的対応状況は実質的に変更なし） |
| 2026-04-24 | style-dictionary（Apache-2.0）を §1 に追加。NOTICE ファイル同梱・インライン記載。外販向け推奨文を更新（branch: `feature/some-fixes`） |
| 2026-07-13 | サードパーティ表記の全体棚卸し。Mermaid.js §4 / Heroicons §5 / Phosphor Icons §6 / Atlassian MCP §7 / Figma MCP §8 を追加、Web フォント等の対応不要根拠を §9 に明文化、依存追加時の運用ルールを §10 に新設。外販向け推奨文 §12 を更新 |
