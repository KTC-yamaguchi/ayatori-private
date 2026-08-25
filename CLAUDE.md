# AYATORI Pipeline — Router

This repository defines the AYATORI pipeline.
Pipeline configuration is defined solely in `pipeline.yaml`. Each Phase is executed by its `phases/*/SKILL.md`.

> **手順書ファイルの命名規約**: 手順書ファイルは常に大文字 `SKILL.md` を使う (`phases/*/SKILL.md` / `skills/*/SKILL.md` の両方)。Claude Code 公式規約 (skill の entrypoint は `SKILL.md`) に準拠し、case-sensitive な Linux 環境 (CI / Docker) での参照崩れを防ぐため。小文字 `skill.md` を新規に追加しないこと。

---

## Operating Principles

These apply project-wide, regardless of Phase / Step / tool.

### 1. Never resolve issues by introducing external tooling

When a tool or command does not behave as expected during an AYATORI pipeline run, **do NOT attempt to fix it by installing an external CLI dependency** (e.g. `poppler` / `pdftoppm`, `imagemagick`, `ffmpeg`, or any other system package).

- Do NOT suggest installation steps such as `brew install ...`, `apt-get install ...`, or `npm install -g ...` to the user.
- "Opt-in is fine", "use it if it happens to be installed", and "keep it as a fallback" are all forbidden — the pipeline must not assume any external CLI is present, by design.
- If a feature cannot be delivered without that dependency, either (a) drop the feature and switch to an alternative code path, or (b) ask the user to re-provide the input in a different format (paste as text, export to `.md` / `.txt`).

Rationale: absorbing environment-specific dependency variance is the pipeline's responsibility, not the user's. Forcing the user to change their environment is contrary to AYATORI's stance. This principle applies across every Phase / Step / Skill / agent / tool call — no exceptions.

**例外 (本 repo がコミット済みの依存)**: `package.json` で pin している Node.js 依存 (`style-dictionary@5.4.0` / `pdf-lib@1.17.1`、いずれも厳密固定) は本原則の対象外。これは「外部 CLI を install してくれ」とユーザーに依頼するのではなく、repo に **lock 済みの dev dependency** を `npm ci` 1 回で取得する形態。style-dictionary は Step 12 build-tokens で、pdf-lib は 10 ページ超 PDF の分割 (`scripts/split-pdf.mjs`) で使用する — PDF の**レンダリング**は poppler 必須のため本原則で不可のままだが、ページ**分割**は純 JS で完結するため pin 依存で賄える (Read tool の native 経路が読める 10 ページ未満の part に割ってから読む)。詳細は `README.md` 「依存パッケージのインストール」参照。

**例外 (OS 同梱コマンド)**: 各 OS が既定でインストール済みのコマンド (macOS=`open` / Linux=`xdg-open` / Windows=`cmd.exe` の `cmd.exe /c start "" "<file>"` 形 / 全 OS 共通=`pwd` 等) は本原則の対象外。これらは「ユーザーに `brew install ...` 等の install 操作を強いる外部 CLI」とは性質が異なり、いかなる OS でも事前準備なしに利用できる。Step 07 / 10 / 13 / 16 / 21 / 23 / 26 の人間ゲート preview で利用する。存在しない / 失敗した場合は **link-only fallback** に degrade させること (CLI 不在を理由にエラー停止させない)。なお Windows の `start` は cmd.exe の builtin であり PATH 上の独立実行ファイルではない (`command -v start` で検出できない) ため、必ず `cmd.exe /c start` の形で外側から起動すること。

### 2. Subagent permissions are pre-declared in settings.json

Claude Code の subagent は main session の permission を継承しない。Step 01 / 09 / 12 / 22 で起動する subagent (`ayatori-figma-ground-truth-collector` / `ayatori-sample-html-builder` / `ayatori-build-tokens-runner` / `figma-capture-runner`) は `Bash` と `Write` を必須とするため、`.claude/settings.json` の `permissions.allow` で `Bash(mkdir:*)` / `Bash(cp:*)` / `Bash(ls:*)` / `Bash(npm:*)` / `Bash(node:*)` 等の個別エントリと `Bash(npx style-dictionary:*)`、`Write(./artifacts/**)` を repo 全体に明示的に許可している。なお `rm` 系は誤動作時の被害を限定するため `artifacts/*/build[/*]` のみ許可する形で範囲を絞り、npx も任意パッケージの即時実行を防ぐため style-dictionary 限定に絞っている。許可リストの正確な内容は `.claude/settings.json` を参照。reverse Step 02 の B2 shard worker (`ayatori-code-analysis-worker`) は READ 専用 (`Read` / `Bash` / `Glob`、Write なし) のため、既存の許可エントリの範囲内で動く (追加許可は不要)。
新規 subagent を追加する際は: (a) `.claude/agents/{name}.md` の frontmatter `tools:` に必要なツールを列挙、(b) `.claude/settings.json` の `permissions.allow` を必要に応じて拡張。runtime での permission prompt に依存した設計にしない (sandbox 拒否で sequential 実行が中断するため)。

### 3. 一次ソース優先（Primary Source Priority）

リバースエンジニアリング系・整合チェック系のタスクでは、**`artifacts/{app_name}/input-sources/` を必ず最初に走査する**こと。raw-analysis.md / comparison-report.md / requirements/*.md 等は **二次要約** であり、これらだけを根拠に「コードはこうなっている」と結論を出してはならない。

**プレースホルダ `{stack}` の定義** (本原則および pipeline.yaml `file_topology` で共通):
- `{stack}` = ソースの言語+プラットフォーム+デプロイ役割を表す **自由名** のサブディレクトリ。
- 許容例: `ios-swift` / `be-python` / `kmp` / `android-kotlin` / `react-native` / `nextjs` / `flutter` 等。
- 予約名 `docs/` は `{stack}` ではない — ユーザー提供のローカル文書 (md/txt/pdf) の配置場所 (`input-sources/docs/`。Step 01 が `ground-truth/local-{stem}.md` へ正規化してから下流が読む)。
- **出力プラットフォームを表す `{platform}` とは別概念** なので混同しないこと。リバース系の `{stack}` は「ユーザーが置いたソースコード本体の正体」を表す。`{platform}` の許容値はツリーごとに異なる: `screens/{platform}` = web / web-sm / mobile (web-sm = Web スマホ幅)、`design-samples/{platform}` = web / mobile のみ (Step 09 はテイスト選定用のため web-sm 版サンプルを作らない)。

**対象タスク**:
- `/ayatori-reverse` (Phase 0b: reverse Steps 01〜06 + 06-confluence-save-req) — ソース解析・要件生成・比較・Confluence 保存（06 は Phase 1b の skill を再利用）
- `/ayatori-reverse-verify` (Phase 0c: verify Steps V1〜V3) — 改修対象に絞った code ↔ doc ↔ Figma 突合と要件記述の訂正
- `/ayatori-req-delta` (Phase 1c: Steps 31〜33) で「コード上は◯◯」と判断する場合
- 上記以外でも、ユーザーが「矛盾チェック」「実装と仕様が合っているか確認」等を依頼してきた場合

**必須手順**（該当タスク開始時）:
1. **ディレクトリ走査義務**: タスクの最初に `ls artifacts/{app_name}/` を実行し、`input-sources/` の有無を必ず確認する。存在すれば配下のサブディレクトリ (例: `ios-swift/` / `be-python/`) も列挙する。
2. **存在時は必須参照**: `input-sources/` が存在するなら、それが当該プロジェクトの **一次ソース** である。raw-analysis.md 等の二次要約だけで判定を下してはならない。
3. **不存在 / 不足の明示報告**: `artifacts/{app_name}/input-sources/` が空、または期待する `{stack}` (例: iOS / BE) のソースが見つからない場合は、ユーザーに「`artifacts/{app_name}/input-sources/{stack}/` が見つかりません。実コードを配置してから再実行するか、二次要約のみで進めるか確認させてください」と **明示的に確認** すること。無言で二次要約に fallback してはならない。

**自己点検ルール** (Claude 自身の出力に対して):
- 「コード上は◯◯」「ソースでは◯◯」と書く際は、必ず `artifacts/{app_name}/input-sources/{stack}/path/to/file.ext:line` 形式で **実ファイルパス** を引用する。
- 引用できない場合は「未確認 (input-sources 未参照)」または「二次要約 (raw-analysis.md より) のみ確認、一次未検証」と **明示** すること。「たぶん」「おそらく」等で曖昧にしてはならない。
- 完了報告で「ソースと付き合わせた」と書く場合、付き合わせた **具体的なファイル一覧** を併記する。一覧を出せないなら「ソースとの突き合わせは未実施」と書く。

**出力フォーマット規約 — リバース生成**: 上記の self-check (file:line 引用 or 未確認/推測明示) は prose policy だが、リバース生成パス (Phase 0b) では **機械可読フォーマットとして強制** する。これにより「どの記述がソース根拠ありで、どれが AI の推測か」を per-item で区別でき、推測が確定事実として下流に laundering されるのを防ぐ (ChargeMinder バッジ「介入群限定」誤読の再発防止)。3 点セットで担保する:
1. **生成側 self-report**: `03-requirements-gen` が `reverse-engineered/reverse-provenance.json` (`schemas/reverse-provenance.schema.json`) に load-bearing specifics を全件列挙し `provenance ∈ {source_backed, doc_backed, figma_backed, derived, inferred}` を申告。根拠あり 3 種は種類別文法の `source_ref` を **必須** (source_backed=`input-sources/{stack}/path:line` / doc_backed=`ground-truth/{file}.md:line` / figma_backed=`ground-truth/figma/` 配下。hook R8 が enforce)。`inferred` は本文に `※ 推測 (inferred)` を併記。
2. **第三者監査 + 人間ゲート**: `Step 04`↔`Step 06` 間の `05-review-gate` が `ayatori-requirements-auditor` (`layer=reverse`、突合先 = 証拠ソース実物: `input-sources/{stack}/` 実コード file:line + `ground-truth/` アーカイブ [文書 + figma capture]) を起動し、トレース不能な推測を `requirement-deviations.json` (`phase=reverse`) に記録 → 人間が view で重点確認。code-only inventory で `Step 04` が skip されても本ゲートは必ず通す。
3. **伝播 / laundering 封じ**: `06-format-convert` は `※推測` マーカーを **逐語保持** (sanitize 禁止) で `requirements/*.md` にコピーし、`requirements.json.reverse_provenance` に台帳 pointer + ゲート結果サマリを書く。下流 (design/screens) はこれで推測由来仕様の存在を認識する。

Rationale: AYATORI パイプラインは過去に「`input-sources/` に iOS Swift / BE Python のソースが揃っていたにもかかわらず、raw-analysis.md (リバース解析者の要約) のみで矛盾調査を完結させ、実コード未検証のまま結論を出した」事故を起こしている。二次要約はリバース解析時点のスナップショットであり、その後の人間 FB で書き換えられた要件と実装の乖離は二次要約からは検出できない。本原則は再発防止のための必須ルール。さらに「リバース生成自体が推測を source 事実として書き、区別がつかない」問題に対し上記出力フォーマット規約を追加した。

### 4. 未確定情報は補完せず質問する（UNCERTAIN → ASK）

AYATORI パイプラインで扱う情報は、必ず以下 **5 分類** のいずれかに該当する。AI が「想像で補完する」のは (C) DERIVED と (E) PROPOSED のみ許容され、それ以外の (D) UNCERTAIN は **`AskUserQuestion` で user に問う / artifact に「未定」を明示記録する** のいずれかでなければならない。

| カテゴリ | 表記規約 | 定義 | 下流での扱い |
|---|---|---|---|
| **(A) CONFIRMED** | `✓ <value>` | ユーザー入力 / 承認済み / 一次ソース由来 (`input-sources/{stack}/` 実コード、Phase 1 質問回答、requirements.json must、Phase 15 画面承認 等) | 無条件下流参照 OK。変更は Phase 5 delta のみ |
| **(B) ILLUSTRATIVE** | `[example]` or `〜など` | sample / placeholder と明示 (Step 09 3 案 sample text、画面仕様書 placeholder、REVERSE_ENGINEERED tokens.json の基本色 等) | screen mockup 見本データ扱い。「実データではない」と明示。実データに昇格させるには user 承認必要 |
| **(C) DERIVED** | `→ <algo>` | 確定値から **決定的アルゴリズム** で導出 (palette OKLCH → HEX 導出、must/should から必須画面数導出 等) | 導出元と式を併記必須 (Step 11 OKLCH 補正履歴 / Step 19 scoring tag の「根拠」)。導出元が変わる = 確定値が変わったシグナル |
| **(D) UNCERTAIN** | `? (ASK)` or `※不明` | ユーザー明示なし、context 不十分 (Phase 08 ブランドヒアリング前のデザイン詳細、Step 17 フォーカスリング色未選定 等) | **補完禁止**。`AskUserQuestion` で止める or artifact に「未定」を明示記録 |
| **(E) PROPOSED** | `[proposal]` or `※推測` | AI 提案で **human gate 通過前提** (Step 09 3 案 HTML、Step 19「AI 改善可能」タグ、Step 21 design-review フィードバック提案 等) | **必ず human gate (Step 13 / 21 / 23 / 25d) を通す**。gate 未通過のまま下流参照 = 違反 |

**判定ルール (Yes/No で判定できる具体条件)**:

1. **要件にない機能カテゴリを能動的に追加するのは NG** — requirements.json の must / should / could に存在しない機能を AI が画面 / token / 文書に追加しない。
2. **視覚要素の補完は (A) CONFIRMED → (C) DERIVED のルートのみ** — palette / typography / spacing を AI が単独で決定するのは NG。design-brief.yaml が確定した上で OKLCH 等で算出するのみ可。
3. **Could 要件を AI が増やすのは NG** — `requirements/06-non-functional.md` 等に「実装してもいい」とあっても、Step 08 で勝手に dual theme を決定しない。Step 01 Q7 で user 明示 → requirements.json に記録 → Step 08 参照、の順序を守る。
4. **解釈候補が N≥2 に割れたら (D) UNCERTAIN として扱う (LLM self-reflection で候補を列挙 → 数で判定 / keyword 非依存)** — artifact の Write 直前に「この入力 / 値を自分はどう解釈したか、他に妥当な解釈はあるか」を自問して**解釈候補を文字で書き出し、書き出した候補が N≥2 なら** (D) UNCERTAIN とする (内部感覚「悩んだか」はトリガーにしない＝検証不可・実行ごとに揺れ自己矛盾になるため、外形的な候補数で判定する)。固定 keyword リスト (「〜的な」「できれば」等) には依存しない (hardcode 管理コスト + 列挙漏れ + 誤 hit を回避)。曖昧さは 3 種 (semantic 複数解釈 / softening 確信度低 / enumeration 開いた列挙) にラベル付け。検出時は `※不明` 等マーカー併記 or `artifacts/{app_name}/pending-questions.json` への append を行い、直接 `AskUserQuestion` せず **Phase 入口の Pre-flight Gate で batch propose** (Rule 6 / P4-01 / P4-07 と整合、CLAUDE.md ≠ auto-interpret)。**対象は主にユーザー input の解釈** (AI 生成物は human gate でカバー済。AI 生成 step では「書く値に CONFIRMED / DERIVED の根拠があるか」を見る gap-check)。4-step 手順・2 flavor・適用 skill は `docs/principle4-disambiguation.md` 参照。
5. **必須 field の欠落 = (D) UNCERTAIN** — schema `required: [...]` の field が欠落、または `null` / 空文字 / プレースホルダ値の場合は、補完せず ask する。
6. **過剰質問の禁止 (Constitution "checks in more than necessary" 対策)** — ask する対象は (D) UNCERTAIN のみ。(C) DERIVED / (E) PROPOSED に対しては ask しない (前者は導出元を参照、後者は human gate に委ねる)。同一 session 内で同じ target を 2 回以上 ask しない (batch 化を優先)。

**Machine-readable な enforcement spec** は `pipeline.yaml` の `constraints[id=P4-01〜P4-07]` に集約されている (SoT 一本化)。skill / hook はそちらを参照する。本文の Rule 1-6 は人間可読の policy 表現。

**Rule 1-6 ↔ P4-01〜P4-07 対応表**:

| 本文 Rule | pipeline.yaml constraint | 関係 |
|---|---|---|
| Rule 1 (要件にない機能カテゴリ追加 NG) | **P4-02** | Rule 1 を must/should/could 粒度問わず一般化したのが P4-02 |
| Rule 2 (視覚要素は CONFIRMED → DERIVED ルートのみ) | **P4-03** | 1:1 |
| Rule 3 (Could 要件を AI が増やすの NG) | **P4-02 に統合** | Rule 1 と Rule 3 を統合 |
| Rule 4 (解釈が割れたら (D) UNCERTAIN) | **P4-01** | LLM self-reflection 主軸 (keyword 非依存)。4-step 手順は docs/principle4-disambiguation.md |
| Rule 5 (必須 field 欠落 = (D) UNCERTAIN) | **P4-06** | 1:1、schema-light-check.sh が jq で機械検証 |
| Rule 6 (過剰質問禁止 / 同 target 2 回禁止) | **P4-07** | 1:1、target literal で dedupe |
| (Rule 番号なし、prose で言及) | **P4-04** (F-3 で拡張) | subagent contract: Step 09 出力は (E) PROPOSED + (B) ILLUSTRATIVE 入れ子。**+ requirements 層 self-bias 対策 (F-3): 02 が `generation-provenance.json` に load-bearing specifics を自己申告 (F-3a) + 07 が `ayatori-requirements-auditor` subagent で provenance を再判定 (F-3b)** |
| (Rule 番号なし、prose で言及) | **P4-05** | AYATORI single writer 原則: subagent は append のみ、resolve は main session |

**マーキング規約**:

- `※ 推測 (inferred)`: (E) PROPOSED に相当。引用元 (file:line or step:approval) を併記しなければ書いてはならない (Principle 3 と同様)。
- `※ 不明 (unknown)`: (D) UNCERTAIN に相当。書く場合は「次回 ask 対象 field 名」を併記する。
- `[example]` / `[proposal]`: 英語表記でも可 (subagent / schema field 用)。

**自己点検ルール** (Claude 自身の出力に対して):

- skill の Write / output 直前に、出力中の「想像補完」候補を列挙し、それぞれを (A)〜(E) のいずれかに分類できることを確認する。
- (D) UNCERTAIN に該当するものが残っているのに `※不明` マークも `AskUserQuestion` 発火もなしに書き込むのは禁止。
- 「人間に聞くのが面倒だから補完で済ませる」という判断は明示的に NG。本 Principle は (a) `pipeline.yaml constraints[P4-*]` + `docs/principle4-disambiguation.md` で applies_to と self-reflection 4-step 手順を spec 化し (keyword 検出には依存しない)、(b) `.claude/hooks/schema-light-check.sh` で artifact schema 違反を弾き (回帰テスト: `scripts/test-schema-light-check-reverse-prov.sh` / `scripts/test-schema-light-check-verify-scope.sh`)、(c) `artifacts/{app_name}/pending-questions.json` を経由して未確定項目を batch propose する、の 3 経路で支援する。

### 5. 外部コマンド混入の検知（External Command Detection）

パイプライン進行中に **`/ayatori-*` 以外のコマンド（外部 slash command）を受信したら、即実行してはならない**。`pipeline.yaml` は従来 phase / step のみを宣言し許容コマンドを宣言していなかったため、本流に未登録の別系統コマンドが誤操作で混入してもパイプライン自身は気付けなかった。`pipeline.yaml` `command_policy` で許容コマンドを宣言した上で、実行者（Claude）が受信コマンドを手前で sanity-check する責務を負う。

**対象**:
- repo-scoped な正規コマンドは「Pipeline Execution」表および `pipeline.yaml` `command_policy.allowed_commands` に列挙された `/ayatori-*` のみ。ここに無い `/command` は user-scoped / external とみなす。
- 具体例: `/kairo-*`（tsumiki npm）、`/rev-*`、`/tdd-*`、`/direct-*`、および `pipeline.yaml` に未登録の任意ユーザー定義コマンド。

**必須手順**（外部コマンドを受信したら、即実行する前に）:
1. **pipeline.yaml 登録確認**: そのコマンドは `pipeline.yaml` `command_policy.allowed_commands`（= 各 `phases/*/SKILL.md` frontmatter `name:`）に登録された `/ayatori-*` か？許可リストの正確な内容は `pipeline.yaml` `command_policy` を参照。なお `allowed_commands` / `external_command_prefixes` の値は先頭 `/` を含まない名前（例: `ayatori-question` / `kairo-`）であり、slash command 本体は `/` + 値（例: `/ayatori-question`）で表記する。照合時は受信コマンドの先頭 `/` を除去してから `allowed_commands` と完全一致 / `external_command_prefixes` と前方一致を判定する。
2. **CLAUDE.md 整合確認**: 「Pipeline Execution」表の本流フローおよび本 Operating Principles と矛盾しないか？
3. **出力先衝突確認**: 出力先が唯一の正規出力ルート `artifacts/{app_name}/` を逸脱・衝突しないか？（外部コマンドが `docs/design/{app_name}/` 等の別ツリーに出力しようとしていないか）

1〜3 のいずれかが NG なら **手前で止めてユーザーに確認する（AskUserQuestion）。強行実行しない**。停止挙動の SoT は `command_policy.on_unrecognized_command`（既定 `halt_and_confirm`）。

**自己点検ルール**（Claude 自身に対して）:
- 進行中に受けたコマンドが `/ayatori-*` でないとき、「これは現在進行中のパイプラインと整合するか？」を必ず明示的に自問してから動く。`pipeline.yaml` への登録有無を確認せずに実行しない。

Rationale: AYATORI パイプラインは過去に「`/ayatori-question` → `/ayatori-requirements` まで本流で進行中のプロジェクトに、誤操作で外部スキル `/kairo-design`（tsumiki npm）が呼ばれ、警報も整合性確認もなくそのまま実行された」事故を起こしている。同じ穴は `/rev-*` / `/tdd-*` / `/direct-*` や将来の任意ユーザー定義コマンドにも開いている。本原則は再発防止のための必須ルール。

---

## Pipeline Execution

Read `pipeline.yaml` to confirm Phase order, then execute the corresponding Phase SKILL.md.

| Phase | Command | Steps | Description |
|---|---|---|---|
| — | `/ayatori-status` | — | Pipeline status dashboard (shows progress & recommends next action) |
| 0b | `/ayatori-reverse` | reverse 01~06 | **Alternative entry point** — reverse-engineer existing app → requirements.json (skips 1a+1b)。入力は多ソース: code (`input-sources/{stack}/`) + 文書 (Confluence / Jira / `input-sources/docs/`) + Figma URL を突合。code 不在時は Figma 中心の縮退モード |
| 0c | `/ayatori-reverse-verify` | verify V1~V3 | **リバース産記述の対象限定突合 (任意・反復)** — 改修対象として名指しされた機能・画面の関連範囲だけを code + 文書 + Figma と突合し、食い違いを人間確認のうえ `requirements/*.md` / `screens/{slug}.md` へ反映。全範囲の再突合・コード修正・要件変更はスコープ外。entry: リバース完走済 |
| — | `/ayatori-idea` | 01a | **アイデアブラッシュアップ (独立)** — 育成ループ (最大 3 周) で idea-brief.md を生成し、同一会話で 1a の 7 軸へ合流。明示起動のみ |
| 1a | `/ayatori-question` | 01 | Idea structuring (7-axis discovery, incl. design output scope) |
| 1b | `/ayatori-requirements` | 02~07 | ISO 29148 requirements + scoring + Confluence save |
| 1c | `/ayatori-req-delta` | 31~33 | **要件レベル delta** — 仕様変更を 8 文書へ伝播。主に UI 生成前 (完成後は原則 /ayatori-delta へ)。entry: step07 承認済み (Phase 0b 完走時にも自動押印される) |
| 1d | `/ayatori-add-feature` | 01b | **完走済への機能追加ヒアリング** — 7 軸で change-manifest.json を生成し Phase 1c→5 へ接続。entry: 完走済 or ベースライン承認済 |
| 2 | `/ayatori-design` | 08~13 | Design brainstorm → sample HTML × 3 → WCAG → 3-tier tokens → human approval |
| 3 | `/ayatori-screens` | 14~25 + 21a~21g + 25a~25e | Screen docs → **main (default) HTML** → review loop → (optional) **graphic generation block 21a~21g** → Figma export → final approval → design system update → component build → (optional) sub-state patterns 25a-25e。reverse 基線は screens-lite ルートあり (画面 HTML を作らず基線印まで) |
| 4 | `/ayatori-retro` | 26 | Retrospective + pipeline improvement |
| 5 | `/ayatori-delta` | 27~30 (+27b/29b/29c/27f) | **完成後変更の単一入口** — requirement / screen-edit / feature-add の 3 モード。影響画面のみ再生成し無関係画面に触れない。entry: 完走済 or ベースライン承認済 |
| 6 | `/ayatori-delta-mini` | 34 | **delta / req-delta の軽量振り返り** — Pattern A/B/C 集計→改善提案を artifacts/pipeline-improvements.md (全プロジェクト共有) へ。entry: 完走済 or ベースライン承認済 + 未処理 run |
| — | `/ayatori-export` | 35 | **配布物生成 (任意)** — MD 群を base64 画像埋め込みの自己完結 HTML に結合。PDF はブラウザ印刷で (Operating Principle 1 によりスコープ外) |
| — | `/ayatori-cm-consult` | cm-consult | **ChargeMinder コンサル (独立)** — ナッジ打ち手 + KPI 検証設計 + requirements.json 種を生成し 1b へ合流。明示起動のみ |
| — | `/ayatori-train` | train-00〜04 + train-07 | **コンサルトレーニング (独立)** — オーナー役 AI と対話訓練→本体パイプラインで実践→振り返り。明示起動のみ。出力 artifacts/_train-* |
| — | `/ayatori-index` | index | **成果物インデックス (独立)** — artifacts/{app_name}/ を index.html 1 枚に集約。人間ゲートでも自動再生成 |

Each Phase runs independently in a separate conversation. Inter-phase communication is only through JSON/MD files under `artifacts/{app_name}/`.

この表は repo-scoped な `/ayatori-*` コマンドの網羅リストである。説明列は 1 行要約であり、各コマンドの正確な仕様は `phases/*/SKILL.md` (frontmatter description + 本文) を SoT として参照する。ここに無い `/command`（例: `/kairo-*` / `/rev-*` / `/tdd-*` / `/direct-*`）は user-scoped / external とみなし、受信時は Operating Principle 5（外部コマンド混入の検知）を適用する。

### Standalone Phase 実行

Phase 1a / 1b をスキップして `/ayatori-design` や `/ayatori-screens` から開始する場合、各 Phase の Preamble は `pipeline-state.json.approvals.*` を読んで前 Phase の完了を確認する。手動で artifact を整えるときは、以下の最小 stub を `artifacts/{app_name}/pipeline-state.json` として配置する:

```json
{
  "app_name": "{app_name}",
  "approvals": {
    "step07_approved_at": "2026-05-22T10:00:00+09:00"
  }
}
```

| 開始したい Phase | 必要な approvals key |
|---|---|
| `/ayatori-design` (Phase 2) | `step07_approved_at` — Phase 1b 承認済みとして扱う |
| `/ayatori-screens` (Phase 3) | `step07_approved_at` + `step13_approved_at` — Phase 1b / 2 承認済みとして扱う |
| `/ayatori-retro` (Phase 4) | `final_approved: true` (main 完了) または `completed_at_states` (sub-state 含む完全完了) のいずれか — Phase 3 承認済みとして扱う。**`state_pattern_skipped` 単独では起動不可** (完走後 Phase 共通 Entry Guard に統一。sub-state skip 状態を stub で再現する場合も `final_approved: true` を書く) |
| `/ayatori-add-feature` (Phase 1d) / `/ayatori-delta` (Phase 5) / `/ayatori-delta-mini` (Phase 6) を reverse 基線で開始 | `baseline_approved_at` + `baseline_approved_via: "manual-stub"` (stub と本物のゲート通過を判別可能に保つ) — ベースライン承認済みとして扱う。**正規経路は `/ayatori-screens` の screens-lite ルート出口の人間ゲート** (`"screens-lite-gate"` を併記して押印する) であり、本 stub は検証・Standalone 運用向け。reverse 経路専用で、`step07_approved_at` (1d→1c ハンドオフ先の req-delta が要求) と `requirements.json.status = "REVERSE_ENGINEERED"` も併記すること。Phase 6 はさらに未処理 run の存在が必要 |

`requirements.json` も最小限の `{ "app_name", "created_at" }` で配置すること。REVERSE_ENGINEERED 経路から流入する場合は `requirements.json.status = "REVERSE_ENGINEERED"` を追加する (`session-handoff.md` は state SoT ではないため作成不要)。なお reverse 経路の `step07_approved_at` は Phase 0b Completion が自動で押印する (`step07_approved_via: "reverse-review-gate"` 併記) ため、Phase 0b を完走したプロジェクトでは手動 stub 不要 — 押印が入る前に完走した過去プロジェクトは `/ayatori-reverse` を再実行すれば Completion が押印する。

**ユーザー提供 INPUT の配置場所**: 既存アプリの実コードをパイプラインに読ませる場合、`artifacts/{app_name}/input-sources/{stack}/` に配置する（例: `artifacts/kinto-fleet-0421/input-sources/ios-swift/`, `.../be-python/`）。Phase 0b の `/ayatori-reverse` および Phase 0c の `/ayatori-reverse-verify` はここを一次ソースとして扱う。詳細は上記「Operating Principle 3: 一次ソース優先」を参照。

**ソース種別ごとの受け取り方の違い** (Phase 0b): **docs (Confluence / Jira) と figma は URL / ページ ID / 課題キーを答えるだけでよい** — Step 01 が MCP 経由で取得し `ground-truth/` にアーカイブする (Jira 課題は `ground-truth/jira-{KEY}.md` へ正規化。時点の変更要求記録のため current-state 根拠としては裏取り扱い)。**code だけは配置が必要** — トリー全体が必要で `git` 等の外部 CLI に依存しない設計 (Operating Principle 1) のため、パイプラインは repo URL から取得しない。URL を渡された場合は取得コマンドを提示してユーザー自身に実行してもらい、**ファイルが実在するまで code を present 扱いにしない** (URL の存在をコードの存在と混同すると、読む対象が無いまま source_backed を主張しうる)。規約の SoT は `phases/reverse/SKILL.md` Preamble 4.f。

---

## Feedback Log

When any of the following 3 patterns occur during pipeline execution, immediately append to `artifacts/{app_name}/feedback-log.md`:

- **Pattern A — Human gate returned modification instructions**
- **Pattern B — Agent made a mistake and had to redo**
- **Pattern C — Discovered a pipeline design flaw**

Record format:
```
- **[Step number] Category**: {what happened} → {cause} → {immediate fix}
```

---

## Artifact File Responsibility

`artifacts/{app_name}/` 配下は **「純粋な記述 (description / INPUT)」と「パイプライン状態 (state / OUTPUT)」を別ファイルに分離** し、**1 ファイルにつき主たる writer は 1 つ** (単一所有権 — key 分離等で複数 writer を許容する例外は責務マップに明記)。各 step skill は SoT のファイルだけを書き、他 step の責務領域には触らない。全ファイルの責務マップ (役割 / writer / reader / スキーマ) と設計原則 7 項の正本は **`docs/artifact-file-responsibility.md`** — artifact を読み書きする skill の実装・変更前に必ず参照すること。

特に踏みやすい gotcha のみ再掲:

- **lazy 初期化 (設計原則 4)**: skill 文書内の `Read or {}` 表記は **shorthand であり実際の `{}` リテラルではない**。file 不在時は各 artifact 所定の init stub に置換してから merge する (例: pipeline-state.json は `{ "app_name": "{app_name}" }`)。schema が `required: ["app_name"]` を持つ artifact は Write back 直前に `app_name` の存在・非空を assert する。
- **state SoT の最小化 (設計原則 7)**: resume / skip / phase 完了判定の SoT は `pipeline-state.json` のみ。`session-handoff.md` は表示専用で state 判定に使わない。`requirements.json.status == "REVERSE_ENGINEERED"` は Phase 0b が一度だけ書く origin sentinel (runtime state ではない)。
- 廃止 field `schema_version` は受理して無視する (carry-over 無害・能動削除もしない)。

### 成果物バックアップ (修正前自動退避)

人間ゲート確認対象の成果物への Write / Edit の直前に、PreToolUse hook `.claude/hooks/backup-on-edit.sh` が現行内容を `artifacts/{app}/_backup/` へ自動退避する (各 step は何もしなくてよい・複製失敗でも Write を block しない fail-open)。**gotcha**: hook の matcher は Write / Edit ツールのみで **Bash 経由の書き込みでは発火しない** — 人間ゲートのフィードバック反映 (`skills/00-feedback-protocol` のスクリプト一括置換) と、対象成果物を上書き / patch する同梱 script (`scripts/derive-transition-map.mjs --force` 等) は、いずれも **script 側の self-backup が義務** (規約は hook と同一: ミラー配置 / md5 dedup / fail-open)。対象成果物・dedup / cooldown の正本は `pipeline.yaml` § `artifact_backup`、詳細は `docs/artifact-backup.md`。

### 手編集画面の自動 lint (screen-edit delta の入口)

完成プロジェクト (`final_approved == true` OR `completed_at_states` set) の `screens/{web,web-sm,mobile}/*.html` がパイプライン外で手編集されると、PostToolUse hook `.claude/hooks/lint-screen-html.sh` が色 lint (`scripts/lint-screen-colors.mjs --check`) を実行し、編集台帳 `delta/edited-screens.json` (`/ayatori-delta` screen-edit モード Step 27b の検知ソース) へ append する。常に fail-open で、完了ガード + in-flight ガードによりパイプライン自身の HTML 生成 (Step 17 / 20 / 29 / 30 区間 / 25b) を「手編集」と誤記録しない (回帰テスト: `scripts/test-lint-screen-html-guards.sh`)。**gotcha**: 全画面走査の `--report` は hook では実行しない (Step 18 / 29 の所有)。詳細は hook 実装コメントと `schemas/edited-screens.schema.json`。

### Sub-state 採点スキップ防止

Step 25b→25c→25d の実行順序は prose 記述ではなく二層で機械強制される: (1) 25d / 25e skill の Phase 0 assert — 最新 25b 出力が未採点なら中断して Step 25c へ差し戻す、(2) PreToolUse hook `.claude/hooks/enforce-substate-scoring.sh` — 未採点状態のまま 25d/25e territory キーを新規導入・値変更する `pipeline-state.json` 書き込みを exit 2 で block する (回帰テスト: `scripts/test-enforce-substate-scoring.sh`)。**gotcha**: preamble の resume ロジックは `/ayatori-screens` 新規再起動時にしか発火せず、1 セッション連続実行では効かない — その穴を本二層防御が塞ぎ、25c (画面間横断一貫性軸を含む採点) が未実施のまま 25d/25e の完了 state を書く Write は block される。差し戻し→再生成の正規ループは「キー導入 (差分)」判定により詰まらない。判定式・territory キー一覧・採点軸の正本は `pipeline.yaml` § `screens.state_pattern_gate_enforcement`。

---

## Master Documents

正本は Confluence (右列の page)。File 列のパスは名目上のポインタで、`docs/master/` 配下はローカルに存在しない (ローカルへ同期して置く運用はしない)。

| File | Content | Confluence Source |
|---|---|---|
| `docs/master/01-ayatori-spec.md` | AYATORI Specification | [3740237924](https://kinto-dev.atlassian.net/wiki/spaces/mord/pages/3740237924) |
| `docs/master/02-ayatori-claude-code-rd.md` | Claude Code R&D | [3740237934](https://kinto-dev.atlassian.net/wiki/spaces/mord/pages/3740237934) |
| `docs/master/03-ayatori-web.md` | Web Implementation Design | [3740893189](https://kinto-dev.atlassian.net/wiki/spaces/mord/pages/3740893189) |
| — | AYATORI 26-step composition (trial 1–3 validated) | [3767469072](https://kinto-dev.atlassian.net/wiki/spaces/mord/pages/3767469072) |

---

## Figma MCP Flag

If environment variable `FIGMA_MCP_ENABLED` is `true`, Steps **17 / 18 / 22 / 24 / 25 / 25e** use Figma MCP.
Otherwise, they operate as MD/JSON/HTML output stubs (22 / 24 / 25 / 25e は `skipped_stub_mode` として記録される。24 / 25 は skill 冒頭の mode 判定スタブ手順が `pipeline-state.json` に `screens.step24_figma_status` / `screens.step25_figma_status` + `step24/25_completed_at` を記録して次 step へ進むため、disabled 環境でも Phase 3 完了 [Step 25a 到達] が可能)。

Step 12 (design-system) は tokens.json / style-guide HTML / マルチプラットフォームコード生成のみで Figma を書き込まない。Figma Variables 3 コレクション (Primitives / Semantic / Component) の登録は **Step 24 (design-system-update)** が担当する。

---

## Sub-State 生成の二段階モデル

Phase 3 は **二段階完了モデル** を採用する:

- `pipeline-state.json.approvals.final_approved` (Step 23) = **main HTML 完了** の合図。Step 24/25 と Phase 4 retro 起動の最低条件。
- `pipeline-state.json.approvals.completed_at_states` (Step 25e) = **sub-state 含む完全完了** の合図。25a で proceed 選択 → 25b-25e 一通り通過した場合に立つ。
- `pipeline-state.json.screens.state_pattern_skipped: true` (Step 25a で skip 選択) = **意図的に sub-state を作らない** の合図。

Phase 4 retro の起動条件は下記「完走後 Phase 共通 Entry Guard」節を唯一の SoT として参照する — retro は **2 条件 (`final_approved` OR `completed_at_states`) のみ**で、Phase 1d / 5 / 6 が accept する reverse 基線例外は適用されない。`state_pattern_skipped` は起動条件に含めない。

2 条件で十分な理由 — `state_pattern_skipped` を起動条件に含めず `completed_at_states` を残す設計根拠 — は `docs/two-phase-completion-model.md` を参照。

Phase 5 delta (`/ayatori-delta`) は同じ 2 条件 (`final_approved` OR `completed_at_states`) に加え、reverse 基線例外 (`baseline_approved_at` + 由来検査 — 下記 Entry Guard 節) も accept する。

### 完走後 Phase 共通 Entry Guard (Phase 1d / 4 / 5 / 6)

Phase 1d (`/ayatori-add-feature`) / Phase 4 (`/ayatori-retro`) / Phase 5 (`/ayatori-delta`) / Phase 6 (`/ayatori-delta-mini`) は **完走済プロジェクト** を前提とする。**本節が「このプロジェクトは対象 Phase に入場可能か?」判定式 (完走判定 + Phase 1d / 5 / 6 限定の reverse 基線例外) の唯一の SoT** であり、各 Phase の Preamble は本式を再掲してよいが (skill 単独 Read 時の自己完結性のため)、判定の正本は常に本節とする — 式を変えるときは本節を直し、各 skill には SoT ポインタ (本節への参照) を併記する:

```pseudo
if approvals.final_approved != true AND approvals.completed_at_states is not set:
  if phase in {1d, 5, 6} AND approvals.baseline_approved_at is set
       AND requirements.json.status == "REVERSE_ENGINEERED":   # 由来検査 (下記)
    pass  # reverse 基線の例外 — 入場時に基線モード announce を表示する
  else:
    display {phase-specific guard message}
    exit phase
```

判定論理は **「`final_approved` も `completed_at_states` も両方とも立っていないときのみ拒否候補になる」** で、二段階完了モデルの OR 関係を素直に反転した形 (ただし Phase 1d / 5 / 6 は拒否前に reverse 基線例外 `baseline_approved_at` を確認する — 上記擬似コード)。`state_pattern_skipped` は起動条件に **含めない** (理由・設計根拠は `docs/two-phase-completion-model.md`)。Phase 6 はさらに pending run (delta.runs[] / req_delta.runs[] のいずれかに `mini_retro_completed_at` 未 set) の存在も別途確認する (Phase 6 固有要件)。

**Reverse 基線の例外 (Phase 1d / 5 / 6 のみ)**: `approvals.baseline_approved_at` (ベースライン承認ゲート [人間] が reverse 経路プロジェクトに押す「完走相当」の印 — schema description 参照) は **Phase 1d / Phase 5 / Phase 6 に限り** accept する。Phase 4 retro は accept **しない** — retro は画面レビューの振り返りであり基線プロジェクトには対象物が無い。扉の選定基準 (材料の不変条件からの導出) と設計根拠は `docs/two-phase-completion-model.md` 参照。

**由来検査 (`requirements.json.status == "REVERSE_ENGINEERED"` の AND)**: 本例外が「reverse 経路専用」であることは prose 宣言では担保されない。`final_approved` / `completed_at_states` は writer が人間ゲートそのもの (Step 23 / Step 25e) だったため、鍵の存在自体が「画面レビュー承認済み」の証拠になり、forward 経路の Phase 3 進行中プロジェクトを**構造的に**排除していた。一方 `baseline_approved_at` の正規 writer は **`/ayatori-screens` の screens-lite ルート出口にあるベースライン承認ゲート** (`phases/screens/SKILL.md` § Execution — screens-lite の lite-4c) であり、これは実装済みかつ reverse 経路にしか存在しない。ただし検証・Standalone 運用のために**手動 stub でも書ける状態が残る**ため、鍵の存在だけで出自が保証される構造には戻りきらない。そこで由来を判定式で検査する — forward 経路のプロジェクトに手動 stub で基線印を立てても入場できない (Step 29 が未承認の画面を preserved [不変の正] として扱う経路を開かせない)。`baseline_approved_via` ではなく `status` を見るのは、正規の reverse プロジェクトを stub で検証する場合も `via` は `"manual-stub"` になり forward 誤用と区別できないため。実装済みのゲートは reverse 経路限定 (screens-lite ルートは `requirements.json.status == "REVERSE_ENGINEERED"` のプロジェクトにしか提示されず、押印直前にも同じ status を assert する) であり、鍵の出自が意味を保証する構造は F / C と同じ形にほぼ戻っている。本 AND はその分**冗長化したが、手動 stub による検証運用が残るため forward への誤適用防御として維持する** (冗長だが無害)。

`{phase-specific guard message}` は phase ごとに固有 (誘導先 slash command と recommendation が異なる)。skill 側で実際の文面を保持し、本節は判定論理のみを SoT として定義する。(Standalone Phase 実行で retro を起動する場合の stub 注意は上記「Standalone Phase 実行」表を参照。)
