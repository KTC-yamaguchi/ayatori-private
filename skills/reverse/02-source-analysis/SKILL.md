---
name: 02-source-analysis
description: 証拠ソース (アーカイブ済み文書 / ソースコード / アーカイブ済み Figma capture) からアプリの完全な理解を抽出する多ソース解析 step。source-inventory.json の roles に従い、構造抽出・振る舞い抽出 (B-01〜B-07)・ソース間突合 (Cross-Source Conflicts) を実行する。code は決定論の読み取り計画 + 予算ゲート (B2.0) を経て module 単位の shard で 1 回読み解析し、出力後に引用スポットチェックで file:line 実在を機械検証する。
---

# Step 02: Source / Document Analysis

## Purpose

Extract a complete app understanding from the available evidence sources.
This step runs in passes: (1) **Structural extraction** — screens, features, APIs; (2) **Behavioral extraction** — the second pass specifically hunts for edge cases that structural extraction always misses; (3) **Cross-source verification** — when multiple sources exist, cross-check them and record disagreements.

## Input Sources

Read `artifacts/{app_name}/reverse-engineered/source-inventory.json` and run the sub-steps whose source is present (役割規則の SoT は `phases/reverse/SKILL.md`「Input Sources & Roles」):

| Present (inventory) | Run |
|---|---|
| docs (`ground-truth/*.md` — Step 01 がアーカイブ済み) | Sub-step B1 (document pass) |
| code (`input-sources/{stack}/`) | Sub-step B2 (source pass) |
| figma (`ground-truth/figma/` — Step 01 がアーカイブ済み) | Sub-step B3 (figma cross-check pass) |

複数ソースが present なら該当 pass を全て実行し、最後に Cross-Source Conflicts (出力テンプレート参照) で突合結果を記録する。
**衝突規則**: code 勝ち (code present 時)。スコープが変わる衝突は `pending-questions.json` へ append する (Operating Principle 4)。append 時の必須 field は schema `required` + hook R3 が要求する 4 件 (`target` / `question` / `raised_by_step` / `raised_at`) に加え、**未解決 entry には `reflect_to` (回答の反映先。本 step の出力先なら `reverse-engineered/*.md`。Step 06 の E2-2 が `requirements/*.md` 系へ移行する) を併記必須** — 振り分けの唯一の材料 (`skills/_shared/preflight-gate.md` § append 経路)。

### 文書ベース化 (`roles.docs == "base"` のとき)

先方に十分な既存ドキュメントがある場合、**解析の骨格を文書から作る** (ゼロから書き起こさない):

1. **B1 を先に実行**し、画面・機能・データ・用語の**骨格リスト**を文書から起こす。文書の構成・識別子・用語を
   保持する (下流の 8 文書再構成でも先方語彙が生きるように)。
2. **B2 は独立再抽出に加えて骨格の裏取り**を行う。骨格の各主張を code に突合して 3 分類:
   - **backed** — code で確認できた → code ref を主たる証拠に昇格 (Step 03 では `source_backed`、doc ref は note 併記)
   - **contradicted** — code と食い違う → Cross-Source Conflicts に記録 (採用は衝突規則どおり code 勝ち)
   - **unverified** — code に現れない (運用ルール・背景説明等) → `doc_backed` のまま (文書だけが根拠であることを保つ)
3. code にあって文書に無い発見は通常どおり追加する (文書の網羅性ギャップ — Step 04 が Dimension 2/3 で把握する)。

`roles.docs == "cross_check"` のときは従来どおり B2 (code) を骨格とし、B1 は裏取り・補完に使う。

---

## 実行形態 (pass の subagent 分割)

実プロダクト規模 (code 数百〜数千ファイル / 文書数十ページ / figma 数十 frame) では全ソースを main が
直読すると context に収まらない。**pass 単位で subagent に分割し並列実行する**のを既定とする
(小規模プロジェクトは main 直読でもよい):

| Pass | 担当 | 備考 |
|---|---|---|
| B2 code (module shard) | 1 shard = 読み取り計画の 1 分割。自分のファイル群へ構造抽出 (B2.2) + 挙動 7 チェック (B2.3) を通しで実行 | アーカイブを読まないため **Step 01 の収集と並行起動してよい** (例外は下記)。**分割は B2.0 の読み取り計画に従う** (下記) |
| B1 文書 | `ground-truth/*.md` (index の content status に従う) | docs present 時。**ファイル数に応じて分割** (下記) |
| B3 figma | `ground-truth/figma/` アーカイブ | figma present 時。**frame 数に応じて分割** (下記) |

- ⚠️ **`roles.docs == "base"` の run は B2 を並行起動しない** — 文書ベース化 (下記) は
  「B1 が起こした骨格を B2 が code で裏取りして backed / contradicted / unverified に 3 分類する」
  順序が前提で、並行起動した B2 worker は骨格を受け取れないため 3 分類を作れない。
  **B1 を分割した場合は全 shard の findings を main で join し、骨格を組み上げてから** B2 を
  順次起動する (B1 shard 同士は並行してよい。各 B2 shard の input には骨格リストを含め、shard は
  自分の module に関わる骨格主張の backed / contradicted / unverified を findings に含めて返す)。
  `roles.docs == "cross_check"` / docs 不在なら B1 と B2 の並行起動もよい。
- ⚠️ **B2 は 1 shard = 読み取り計画の 1 分割まで** (`.code-inventory.json` の `shards[]` — 累積
  120,000 字 / 40 ファイル上限の決定論分割。予算超の大型 module は単独で分割し、小型 module は
  1 shard に相乗り packing する [`shards[].modules` に列挙] — worker 起動 1 回の固定費が内容より
  高くつくため、shard 数の削減がコストを支配する)。shard は構造 (B2.2 の観点) と挙動 (B2.3 の
  B-01〜B-07) を**同じ読みで 1 回だけ**実行して findings を返す — pass を構造 / 挙動で分けると
  同じファイルの読みコストを二度払うため分けない。B-03 / B-06 / B-07 は shard が「module 内の
  検出値 + 引用」を返すだけで、最終判定 (と AskUserQuestion) は main が全 shard 統合後に行う。
  **worker は専用 subagent `ayatori-code-analysis-worker` で起動する** (tools: Read / Bash / Glob のみ —
  汎用 subagent は起動のたびに全 MCP tool schema を積み込み、1 ファイルの shard でも起動固定費が
  読み取り内容を大きく上回る)。main は worker に `shard_id` + `.code-inventory.json` のパスだけを渡し、
  **ファイル一覧は worker が台帳から自力で読む** (main が一覧を prompt に貼らない)。並列は 8 目安。
- **不在主張は shard 単独で書かない** — shard が返せるのは「自 module に〜は見当たらない」まで。
  アプリ全体の「〜は存在しない」は、main が全 shard の findings を統合し `input-sources/` への
  機械検索 (grep) で裏を取ってからのみ書く (B1 の不在主張の検証義務と同じ規律。範囲外 module が
  ある run では「未解析 ≠ 不在」も併せて適用する)。
- ⚠️ **B1 は 1 pass あたり引用可能ファイル 10 本まで** (本文長 10,000 字超の大型ページは 3 本まで)。
  対象は `ground-truth/index.md` の content status が引用可
  (本文 / 本文+図依存 / 薄い系 / 抽出本) のファイルのみ — 殻 / 図のみ / テンプレート未記入 は
  B1.1 の規則どおり読まない。**ADF生JSON は生 JSON を読まず、並置の抽出本
  (`{同名}.adf-extract.md`) を読む・引用する** — 生 JSON はバイト数の 9 割超が構造ボイラープレートで
  context を浪費し、目視の表読みは隣接行の値を取り違える (抽出本が無ければ
  `node scripts/extract-adf-text.mjs {app_name}` を先に実行して生成する)。抽出本は圧縮済みのため
  通常ファイルと同じ扱いでよい。対象が 11 本以上なら pass を分割し (index の並び順で分ける)、
  各 shard が自分のファイル群に対して B1.1 + B1.2 を通しで実行して findings を返し、
  main が統合する (統合は下記「raw-analysis.md を書くのは main のみ」と同じ経路)。
  アーカイブ済み仕様ページは design-context より軽いため上限が B3 (3 本) より大きい —
  それでも数百ページを 1 pass で全文読めば確定的に context を使い切る。
- ⚠️ **B3 は 1 pass あたり design-context 3 ファイルまで** (要素の多い画面は 1〜2)。
  design context は 1 frame あたり数千〜1.5 万 token 級で、capture 側が同じ理由で
  batch を 3 frame に制限している (`skills/reverse/01-ground-truth/refs/figma-capture.md` F2) — 読み側だけ数十 frame を
  1 pass で全文読むと確定的に context を使い切り、途中停止か無言の部分読みになる。
  対象が 4 frame 以上なら pass を分割し、main が findings を統合する
  (統合は下記「raw-analysis.md を書くのは main のみ」と同じ経路)。

- 各 pass の**返却は「引用文法つきの構造化 findings」のみ** (下記 Source Evidence Rule の 3 種文法。
  全行に引用を付け、引用できない行は 未確認 / `※ 推測 (inferred)` を明示)。本文の dump は返さない。
- **raw-analysis.md を書くのは main のみ** (single writer)。main が全 pass の findings を統合し、
  Cross-Source Conflicts の突合と採否 (衝突規則) も main が行う — pass 同士は互いの結果を見ない。
- B-06 / B-03 等の AskUserQuestion は main の所有 (subagent は検出値と根拠を返すだけ)。

## Sub-step B1: Document Pass (アーカイブ読み)

**Read the archive, not live Confluence/Jira** — Step 01 が全ページ (親 + 子孫 = R-01)・Jira 課題・ローカル文書を
`ground-truth/*.md` (root 直下) に行番号つきで参照できる形でアーカイブ済み。本 pass はそれを Read する。
doc_backed の `source_ref` (`ground-truth/{file}.md:line`) はこのアーカイブの行番号を指すため、
live ページを読んでも引用にならない。

### B1.1 Structural pass

1. **最初に `ground-truth/index.md` を Read** し、各文書の content status に従って読む対象を決める:
   - **殻 / 図のみ / テンプレート未記入** — 読まない・引用しない。かつ「情報が無い」根拠にもしない
     (元ページには図・添付で情報が存在するが、アーカイブに本文化されていないだけ)。
   - **ADF生JSON** — 生 JSON は読まず、並置の抽出本 (`{同名}.adf-extract.md`) を読む
     (無ければ `node scripts/extract-adf-text.mjs {app_name}` で生成)。
   - **薄い / 薄い+図依存** — 引用可だが弱い根拠として扱う。
   - **範囲外 (未収集) / 収集失敗** — 「存在しない」と混同しない。解析中に必要と判明したら
     Step 01 の差分収集 (page-ID 冪等) に差し戻す。
2. 引用可能な各文書を Read して抽出:
   - Screen names and IDs
   - Feature descriptions and field lists
   - Navigation rules
   - API dependencies
   - PoC vs product scope flags (look for ○/×/△ columns or explicit "PoC" labels)
3. **Jira 課題ファイル (`jira-{KEY}.md`) の扱い**: 課題は「ある時点の変更要求・作業記録」であり
   「現在の実装がこうである」という現状主張の直接根拠にしない (未実装・破棄された内容を含みうる)。
   current-state の断定は code / 仕様書を優先し、課題のみが根拠の主張は時点情報である旨を明記する。
   - **課題ごとに先に種別を判定する** — (a) **変更要求** (「〜へ変更してほしい」「〜を緩和したい」等、
     現状とは別の未来を依頼する文)、(b) **現状の報告** (バグ報告・調査記録・実装詳細のコメント等、
     「いまこうなっている」という主張)。この判定を飛ばして「仕様書と値が違う = 衝突」と機械的に
     扱わない — 変更要求は現状についての主張ではないため、仕様書との値の差は衝突 (事実 vs 事実の
     食い違い) に該当しない。
   - **(a) 変更要求** → Cross-Source Conflicts に入れず、raw-analysis.md の「検出された変更要求」
     節に記録するだけに留める (Phase 0b は as-is のリバースであり、要求の取り込みは
     `/ayatori-req-delta` / `/ayatori-delta` の経路)。既存の未解決衝突と同じ対象を扱う要求は、
     当該衝突行に参考 note として併記してよい (判定材料には使わない)。
   - **(b) 現状の報告** → 仕様書・code と突合し、食い違う場合のみ Cross-Source Conflicts に
     1 行記録する (採否は衝突規則どおり)。仕様書に記述の無い新規の技術的知見は衝突ではなく
     cross_check の追加知見として該当文書 (07 等) に記録する。

4. **不在主張の検証義務**: 「〜は文書に記述が無い」「〜の仕様は存在しない」という **absence の主張**を
   findings / raw-analysis.md に書く前に、必ず `ground-truth/` 全体 (抽出本 `.adf-extract.md` 含む) への
   機械検索 (grep) で裏を取る — 読んだ範囲の記憶だけで「無い」と断定しない。検索して本当に無ければ
   そのまま書いてよい (検索キーワードを 1 つ添えると監査が再現できる)。ヒットした場合は「無い」ではなく
   「〜までは記述済みで、△△は未記述」の形に落とす。殻 / 図のみ / 範囲外のページがある run では
   「アーカイブに無い ≠ 元ソースに無い」の注意 (上記 1) も併せて適用する。

### B1.2 Behavioral annotation pass (run after B1.1)

For each screen document, re-read with a specific focus on annotations that B1.1 summary-extraction misses:

- **Table footnotes and "(備考)" columns** — these contain exclusion rules, edge cases, and format specs
- **Bullet points after tables** — often contain behavioral caveats (e.g., "前回選択した音声をデフォルト表示")
- **UI element detail tables** — check every column, especially `仕様` and `補足` columns
- **"×PoC" and "△PoC" scope markers** — must be captured per UI element, not just per screen

---

## Sub-step B2: Source Code Analysis (ローカル配置本を読む)

**読む対象は `input-sources/{stack}/` に配置済みのファイルのみ** — repo URL からの取得は本 step の責務ではない
(`source-inventory.json.sources.code.source_repo_url` は記録用。取得はユーザーが Preamble の案内に従って行う)。
inventory 上 code が present なのに配下が空なら、二次要約に fallback せずユーザーに確認する (Operating Principle 3)。

### B2.0 読み取り計画と予算ゲート (halt & ask)

code の読み取りは開始前に**必ず**決定論スクリプトで計画化する (LLM 無呼び出し・追加コスト実質ゼロ)。
上限は「黙って切り捨てる」ためではなく「**数字を見せて選ばせる**」ために使う — 数字なしで範囲を
答えさせない。

1. **resume 短絡**: `reverse-engineered/.code-scope.json` が既に存在するなら、記録済みの
   `tiers` / `modules` で**スクリプトを再実行して差分を確認する** (決定論・LLM 無呼び出しのため
   実質無コスト)。files 集合が記録と一致すれば再質問なしで B2.1 へ進む (同一 target を二度
   聞かない)。**差分がある (resume 後に code が追加/変更された) 場合は、新規分だけを shard 化して
   追加解析する** — この確認を挟まないと、resume 時に追加されたソースが無言で未解析のまま下流へ
   流れる (docs/figma の差分収集と同じ規律)。範囲を広げたいときのみ差分を提案し、確定集合は
   union 更新する。
2. main が実行する: `node scripts/build-code-inventory.mjs {app_name}`
   — 全ファイルを tier 分類 (entry / navigation / screen / state / model / api / config /
   other_source / excluded+理由) し、module 別の shard 計画・件数・LOC・予想所要 (token / 分) を
   `reverse-engineered/.code-inventory.json` と提案表 (stdout) に出す。テスト・アセット・生成物・
   依存 dir は excluded / 未走査 dir として台帳に残る — 黙って消えるファイルは無い。
3. **予算ゲート** (超過判定は LLM の数値比較ではなく `.code-inventory.json` の
   `summary.budget_gate.exceeded` を読む — 閾値の SoT はスクリプト定数
   `constants.gate_file_limit` / `gate_char_limit` [現行 120 ファイル / 400,000 字]。
   提案表にも「予算ゲート: 超過 / 以内」として表示される):
   - `exceeded == false` → 質問せず全 shard 実行に進む。
   - `exceeded == true` → 読み取りを開始せず停止し、AskUserQuestion 1 回で範囲を選ばせる。
     module 別の件数と予想所要 (提案表の数字) を提示する:
     - 推奨 (既定) = 優先 tier の全 module (件数 + 予想 token + 予想所要を併記)
     - 全量 (other_source 込み) は明示 opt-in (同じく数字併記。tiers CSV は
       `--tiers entry,navigation,screen,state,model,api,config,other_source` — `all` は不可)
     - module 単位の手動調整 (`--modules` / `--tiers` で再計画。module キーには `kmp/(root)` の
       ように括弧を含むものがあるため、CSV は必ず引用符で囲む: `--modules "kmp/(root),kmp/sharedUI"`)
     - 段階案: 核心 module だけ先に解析し、残りは後で追加解析する (後から範囲を広げると shard id は
       全体で振り直しになるため、「解析済み」の単位は shard id ではなく **module 名**で管理する —
       追加解析は `.code-scope.json` の modules 差分から新規 module の shard だけを起動する)
   - 提示する予想 token は**上限見積もり**である — worker 固定費定数は汎用 subagent での実測値
     (100k/shard) を基準にしており、専用の軽量 worker では実コストがこれより下がる (スクリプト内
     コメント参照)。数字が大きく見えても実消費はより小さい方向にしか外れない。
4. 確定した範囲でスクリプトを再実行 (`--tiers` / `--modules`) して shard 計画を確定し、**確定範囲を
   `reverse-engineered/.code-scope.json` に Write する**
   (`{ "tiers": [...], "modules": [...] | "all", "files": [...] }` — files は確定 in-scope パス集合)。
   これが無いと resume のたびにゲートが再発火して同じ範囲を再質問する。範囲外にした module / tier は
   raw-analysis.md の Analysis Coverage 節に「未解析」として明記する — 下流が「存在しない」と
   誤読しないため。

### B2.1 Detect architecture and read entry points

main が直接実行する (entry tier の少数ファイルのみ。なお entry tier は shard 計画にも含まれる —
main の B2.1 はアーキテクチャ判定のためだけに読み、findings 抽出は担当 shard が行う。少数の小型
ファイルの二重読みは、除外して shard 側の文脈を欠けさせるより安い):

1. Read `README.md` — app overview, tech stack, linked resources
2. Read `package.json` / `pubspec.yaml` / `build.gradle.kts` / `gradle/libs.versions.toml`
   — dependencies reveal external APIs and tech framework
3. Identify project architecture:
   - KMP (Kotlin Multiplatform): `sharedLogic/`, `sharedUI/` modules
   - React Native/Expo: `src/screens/`, `hooks/`, `services/`
   - Flutter: `lib/screens/`, `lib/services/`, `lib/models/`
   - Next.js/React: `pages/`, `components/`, `hooks/`, `api/`

### B2.2 Structural pass — read plan に従う

読む対象と順序は **B2.0 の読み取り計画** (`.code-inventory.json` の `shards[]`) が決める。旧来の
stack 別ハードコード読み順 (KMP / React Native の path 列挙) は inventory スクリプトの tier 分類
規則へ移管済み — Flutter / Next.js も同じ規則で自動分類される。各 shard 内のファイルは tier 順
(entry → navigation → screen → state → model → api → config) に並んでおり、それが優先読み順。

構造抽出の観点 (各 shard が自分のファイル群に対して):
- Screen names and IDs (screen / navigation tier)
- Navigation graph and rules
- Feature descriptions, business logic and field lists (state / model tier)
- API dependencies (api tier)
- PoC vs product scope flag 候補 (config tier — 最終判定は B-03)

### B2.3 Behavioral extraction — 7 mandatory checks (構造抽出と同じ読みで実行)

各 shard は構造抽出と**同じ読みの中で** (再読なし) 以下の 7 つの挙動観点を適用し、自分の module 内の
検出値 + 引用を findings として返す。**Do not skip any check** — module 内に該当ファイルが無い場合も
shard は "not found in this module" を明示して返す。**main が全 shard の部分信号を統合して**各チェックの
最終判定を書く (全 shard が not found のときのみ全体の "not found" にできる — 範囲外 module がある run
では「未解析 ≠ 不在」を併記する)。以下の per-stack ファイル例は shard 内での着眼点ヒントであり、
読む集合そのものは読み取り計画が決める。

---

**Check B-01: Audio / Media Exclusion**

*Why*: Apps with audio preview (voice samples, video playback) almost always enforce single-instance playback. This is a behavioral requirement that specs often omit but code always reveals.

- Read `AudioPlayer.kt` (or equivalent: `AudioPlayer.swift`, `AudioPlayer.ts`, `audioService.js`)
- For KMP: also read `AudioPlayer.android.kt`, `AudioPlayer.ios.kt`
- Look for: `stop()` called before `play()`, a single shared instance, `currentlyPlaying` state variable, `onStop` callback on navigation
- Extract: "Does this app enforce exclusive playback?" → if yes → record as behavioral requirement: "同時に再生できる音声は1つのみ。別のアイテムを再生する場合は前のアイテムを自動停止する"
- Also check: "Is audio stopped when leaving the screen?" → if yes → record: "画面遷移時に再生中の音声を自動停止する"

---

**Check B-02: Persistent User Preferences / Selection Defaults**

*Why*: Forms with selectors (voice dropdown, language, filter settings) often restore the previous session's selection. This is a UX requirement that is invisible to structural analysis.

- For KMP: read all `*Storage.kt` files in `sharedLogic/src/commonMain/.../data/local/` (e.g., `UserPrefsStorage.kt`, `HistoryStorage.kt`)
- For React Native: search for `AsyncStorage.setItem` / `AsyncStorage.getItem` calls
- For React: search for `localStorage.setItem` calls
- In ViewModels: search for `savedStateHandle`, `getState()`, `restoreState()`, loading from storage in `init {}`
- Extract: for each persisted field, record as behavioral requirement:
  - field name, what triggers a save, what default is shown on first use

---

**Check B-03: Feature Scope Flags (PoC vs Product)**

*Why*: PoC apps hide or gray-out product-only features. The code shows which UI elements are conditionally rendered based on environment or feature flags.

- For KMP: read `AppConfig.kt`, `AppConfig.android.kt`, `AppConfig.ios.kt`
- Look for: `BuildConfig.DEBUG`, `isPocEnabled`, `featureFlags`, `Config.POC`, `isEnabled`
- In Screen files and ViewModels: search for `if (appConfig.xxx)`, `isVisible = false`, `.alpha(0f)`, `enabled = false`
- Extract: list of UI elements that are disabled/hidden in PoC mode with explicit "×PoC" or "△PoC" annotation
- Also check: Router/NavGraph for screens that are conditionally excluded (e.g., login/register if auth is mocked)

---

**Check B-04: File Upload Post-Processing**

*Why*: "Upload a file" hides processing steps that become requirements (resize, crop, format validation, size limits). These are never in UX specs but always in use cases.

- For KMP: search for `*UploadUseCase.kt`, `*ImageFormat.kt`, `*AssetUseCase.kt`; check ViewModels in upload/create flows for image selection and upload logic
- For React Native: search for `ImageManipulator`, `ImagePicker`, `FormData` construction for file uploads
- Look for: aspect ratio enforcement, image resize/compress, format validation (JPEG/PNG only), max file size checks
- Extract: for each upload field, record:
  - Accepted formats
  - Size/dimension limits
  - Post-upload processing (resize to X, crop to 16:9, auto-trim non-standard aspect ratios)

---

**Check B-05: Navigation State Preservation**

*Why*: "Back button" behavior is a common source of omissions. Does pressing back lose form data, or is it preserved? Does a confirmation dialog appear?

- For KMP: read all ViewModels for `onBackPressed`, `onBack`, navigation params passed to next screen
- In multi-step flows (wizards, create flows): check if state is preserved across steps (passed via navigation args, held in shared ViewModel, or stored locally)
- Look for: `NavController.navigate(popUpTo=...)`, shared ViewModel scope, `rememberSaveable`, confirmation dialogs before back-navigation
- Extract: for each screen with a back button, record whether state is preserved, and whether a confirmation dialog appears

---

**Check B-06: Illustration Style**

*Why*: The existing app's icon and illustration choices reveal which visual language the team has committed to. Detecting this early prevents Phase 2 (design brainstorm) from silently overriding an established pattern with the default.

- Asset ファイル名は **main が全 shard 統合時に** `.code-inventory.json` の excluded (asset) 台帳から取得する (repo 全域の一覧のため shard の担当外 — shard はコード内のアイコン/emoji/SVG import 信号のみ返す。画像本体はどちらも読まない): PNG/WebP/JPG files whose names suggest character illustrations (e.g. `character_`, `mascot_`, `onboarding_`, `empty_`)
- Scan icon usage across screen files: look for `🏠` / `🔔` / `✅` or similar Unicode emoji used as tab bar or action icons
- Look for SVG icon library imports: `heroicons`, `phosphor`, `material-icons`, `lucide`, or `<svg>` inline usage
- For document archives (`ground-truth/*.md`): look for image assets referenced in screen spec pages (PNG/character illustrations vs. icon-only SVG specs)

Signal table:

| Signal | Inferred policy |
|---|---|
| SVG line/solid icons (heroicons, phosphor, lucide, material-icons) | `pictogram` |
| Raster image assets named `character_*`, `mascot_*`, `onboarding_*`, `empty_*` | `illustration_character` |
| Unicode emoji used as tab bar / action icons in UI code | `emoji_casual` |
| Mixed signals or no icons found | `pictogram` (safe fallback) |

Record the inferred value, then present it to the user as a confirm-or-override prompt using `AskUserQuestion`:

「アイコン・イラスト方針を『**{inferred policy label}**』と推定しました（ソース分析より）。このまま使いますか？」

Where {inferred policy label} is:
- Signal inferred `pictogram` → 表示: `ピクトグラム / アイコン系`
- Signal inferred `illustration_character` → 表示: `キャラクター・イラスト系`
- Signal inferred `emoji_casual` → 表示: `絵文字 / カジュアル系`

Choices:
1. そのまま使う → keep the inferred value as `illustration_policy_detected`
2. 変更する → show 3-choice selector: `pictogram` / `illustration_character` / `emoji_casual`, and write the user's selection as `illustration_policy_detected`

Extract: record the confirmed value as `illustration_policy_detected` in the analysis output. 06-format-convert will write this to `requirements.json`.

---

**Check B-07: Android UI Framework (View system vs Compose)**

*Why*: Step 12 build-tokens emits Android View-system XML (`colors.xml` / `dimens.xml`) only when `design_output_scope.legacy_android_xml == true`. Reverse-engineered projects are the representative opt-in case ("existing app is XML-based"), so the framework must be detected here from primary sources — not guessed downstream.

Android ソース (`input-sources/{stack}/` の Android モジュール) が存在する場合のみ判定する。**View システムの強シグナル** — 以下のいずれか:

- `res/layout/*.xml` の存在 (レイアウト XML)
- `findViewById` / ViewBinding (`*Binding` inflate) / DataBinding の使用
- `setContentView(R.layout.…)` の呼び出し

強シグナルが 1 つでもあれば `view_system`、無く Compose シグナル (`@Composable` / `setContent {` / `androidx.compose.*` import) のみなら `compose`、Android ソースはあるがどちらとも判別できなければ `not_detected`。

⚠️ **`res/values/*.xml` (strings / themes / colors) は単独では `view_system` の根拠にしない** — 純 Compose アプリにも必ず存在し、Flutter の `android/` ラッパーにも styles.xml が入っているため、弱シグナルとして扱うと全 Android 案件が誤って View システム判定になる。

Extract: record the result as a machine-readable key `android_ui_framework_detected: view_system | compose | not_detected` in the analysis output, with `input-sources/{stack}/path:line` evidence per the Source Evidence Rule below. Android ソース自体が無い場合は `not_applicable` を書く。06-format-convert はこのキーのみを読んで `requirements.json.design_output_scope.legacy_android_xml` を導出する (B-06 → `illustration_policy_detected` と同じ「キーだけ読む」構造)。

---

## Sub-step B3: Figma Cross-Check Pass (アーカイブ読み)

**Read the archive only** — `ground-truth/figma/` (Step 01 の figma sub-module が capture 済み)。
live Figma MCP を本 step から呼ばない (引用の安定性・再監査可能性のため。capture が古い/不足なら Step 01 に差し戻す)。

1. `ground-truth/figma/figma-manifest.json` を Read し、capture 済み frame を列挙する
   (frame が 4 件以上なら上記「実行形態」の分割規則に従い pass を分ける — 1 pass 3 ファイルまで)
2. 各 frame の `.design-context.md` を **全文** Read (構造・コンポーネント・スタイル・テキスト) し、
   必要に応じて `.png` を Read (視覚確認) する
   - **部分読み・見出し grep で内容を判断しない** — 大きなファイルは offset 分割してでも全量読む。
     アーカイブは範囲確定ゲートを通った厳選セットであり、読み飛ばした実例テキストの取りこぼしは
     下流の監査 (Step 05) で発見されて文書再作業として返ってくる (全文を読む方が再作業より常に安い)。
   - **画面ではない参考フレーム (design system kit / typography scale 等) も実例テキストを掘る** —
     コンポーネント説明文・ダミーデータ・ラベル (例: アプリ名の明示ラベル、アバター名、機能名入りの
     ボタン文言・ナビタブ名) は機能・ドメインの figma_backed 証拠になる。「参考フレーム = 視覚トークン
     情報のみ」と決めつけて本文を読み飛ばさない。
3. B1 / B2 の検出結果と突合する:
   - **画面カバレッジ**: Figma frame にあって code / docs に無い画面 (未実装デザイン?) と、その逆 (デザイン無しで実装された画面?)
   - **コンポーネント / レイアウト**: 主要 UI 要素の有無・配置・ラベル文言の一致
   - **スタイル**: 色・タイポグラフィが code のテーマ定義 / docs の記述と一致するか
     (`variables.json` があればトークン名も突合)
4. 不一致は **Cross-Source Conflicts** (出力テンプレート参照) に 1 行ずつ記録する。
   **判定はしない** — 採用値の決定は衝突規則 (code 勝ち) に従い、根拠 ref を両方残す。
   Figma にしか無い情報 (実装・文書に現れない視覚仕様) は figma ref つきの finding として通常どおり記録する。

⚠️ **Figma は挙動の根拠にならない** — 見た目に現れない条件・分岐・処理 (B-01〜B-05 相当) を
Figma から「推定」して finding にしない。デザイン上の示唆があるなら `※ 推測 (inferred)` を付ける。

### 縮退モード (`degraded_mode == true` — code 不在で figma = primary)

code が無い run では、B3 の読み方が「突合」から**構造パス (骨格作り)** に変わる:

1. **Screen List**: manifest の frame 一覧から起こす。`実装状態` は frame の完成度で埋める —
   完成した画面デザイン → `実装済み`、明らかな作業中 frame (空 / "WIP" / "TBD" / placeholder ラベル) →
   `Coming Soon`。判断に迷う frame は `実装済み` に倒した上で備考に `※ 推測 (inferred)` を付ける。
2. **レイアウト・コンポーネント・文言**: design-context.md から抽出 (figma ref つき)。
3. **挙動・業務ルール**: docs が present なら B1 から補完する (挙動の根拠は docs のみ)。
   docs にも無い挙動は書かないか、書くなら必ず `※ 推測 (inferred)`。
4. **B-01〜B-07 の適用可能性** (検出不可の明示は必須 — この「裏取り不能」の記録が Step 05 ゲート強化の根拠になる):

| Check | 縮退モードでの扱い |
|---|---|
| B-01 / B-02 / B-04 / B-05 / B-07 | **検出不可 (ソース無し)** — raw-analysis の該当セクションに "not detectable (no source code)" を明示する ("not applicable" と書かない — 存在しないのではなく確認できないだけ) |
| B-03 (スコープフラグ) | docs のスコープマーカー (×PoC / △PoC 等) から部分検出。docs にも無ければ "not detectable" |
| B-06 (イラスト方針) | 実行可能 — figma スクリーンショット・アイコンに signal table を適用し、通常どおり AskUserQuestion で確認する |

---

## Source Evidence Rule

So that Step 03 can emit a per-item `reverse-provenance.json` (evidence-backed vs inferred), this step must
record **where each finding came from**, using the citation grammar below (what Step 03 copies into
`reverse-provenance.json` `source_ref`):

| Evidence kind | Citation grammar | Notes |
|---|---|---|
| code (`input-sources/{stack}/`) | `input-sources/{stack}/path/to/file.ext:line` (range `:line-line` OK) | Operating Principle 3 の literal 引用。code に引けた finding は常にこれを優先 (code 勝ち) |
| document archive (`ground-truth/*.md`) | `ground-truth/{file}.md:line` | Step 01 のアーカイブの行番号。Confluence ページ / ローカル文書正規化本 (`local-{stem}.md`) / Jira 課題正規化本 (`jira-{KEY}.md`) すべて同文法。live Confluence / Jira のページ ID・課題キー引用は不可 (行アンカーが無く再監査できない)。引用できるのは index.md の content status が 本文 / 本文+図依存 / 薄い系 / 抽出本 のファイルのみ — 殻 / 図のみ / テンプレート未記入 は引用先として成立しない。ADF生JSON は生 JSON の行ではなく並置の抽出本 (`{同名}.adf-extract.md`) の行を引用する (決定論生成なので再監査可能性は原本と等価)。jira 由来は時点の変更要求記録 — current-state の断定根拠には code / 仕様書を優先する |
| figma capture archive (`ground-truth/figma/`) | 構造・レイアウト・文言は `ground-truth/figma/{file_key}/{node}--{slug}.design-context.md:line`、**デザイントークン値 (色・フォントサイズ) は `ground-truth/figma/{file_key}/variables.json:line`** (当該キーの行)、純粋に視覚的な根拠のみ同 `.png` パス (:line なし) | 挙動の根拠には使えない (視覚・構造・文言・トークン値のみ)。variables.json にしか無いトークンも「根拠あり」— design-context.md に無いことを理由に推測扱いへ落とさない |

- **複数ソースが同一 finding を支持**: code ref を `Source` 列に書き、並走する doc/figma ref は括弧で併記してよい
  (Step 03 は code ref を `source_ref` に採用する)。
- **⚠️ source ツリー内の文書 (README / CLAUDE.md / in-repo docs) の主張は code 事実ではない**:
  これらは `input-sources/{stack}/...:line` の引用文法を満たすため、形式上は `source_backed` として
  通ってしまうが、**実装より古い時点のスナップショット**であり実コードと食い違うことがある
  (実測例: アプリ内文書が「却下ボタンは Coming Soon」「GET /v2/voices を使用」と記載していたが、
  実装は完全な却下フローを持ち、当該 endpoint はコードに存在しなかった)。挙動・API・実装状態の
  主張は**必ず実装コードの file:line で引用**する。in-repo 文書にしか根拠が無い主張は文書引用の
  まま「実装未確認」を明示するか `※ 推測 (inferred)` を付け、実装コードと食い違う場合は code 勝ち。
- **No traceable evidence**: if you wrote something from general knowledge / assumption rather than from a source,
  mark the annotation `※ 推測 (inferred)` and do NOT fabricate a ref. Recall the ChargeMinder badge case —
  "介入群限定" was an inference presented as fact; the BE source actually allowed 対象群 to earn it. When you cannot
  cite a line, say so explicitly rather than guessing.

## Output

Write `artifacts/{app_name}/reverse-engineered/raw-analysis.md`:

```markdown
# Raw Analysis — {app_name}

**Date**: {today}
**Sources**: {source-inventory.json の要約 — 例: code (kmp) = primary / docs (Confluence 12p + local 2) = cross_check / figma (8 frames) = cross_check}
**Repo**: {repo URL if applicable}
**Tech stack**: {detected stack}

---

## App Description
{1-3 sentences from README / overview page}

## Tech Stack
{detected stack, key libraries, external APIs}

## Screen List (detected)
| Screen ID | Name | 実装状態 | Source |
|---|---|---|---|
<!-- 実装状態: 「実装済み」または「Coming Soon」 -->

## Feature List (detected)
| Feature | カテゴリ | Source |
|---|---|---|
<!-- カテゴリ列は暫定グルーピング。Step 03 が 05-features.md の ### 見出しで正規化するため、最終的なカテゴリ名は 05-features.md が正とする -->

## Navigation Rules
{detected flows}

## API Dependencies
| Service | Endpoint | Purpose |
|---|---|---|

## PoC Scope (detected)
| UI Element | PoC | Product |
|---|---|---|

## Behavioral Annotations (from B-01~B-07)

### B-01 Audio/Media
{findings or "not applicable"}

### B-02 Persistent Preferences
{findings or "not found"}

### B-03 Feature Scope Flags
{findings or "no feature flags detected"}

### B-04 File Upload Processing
{findings or "no file upload"}

### B-05 Navigation State
{findings or "not applicable"}

### B-06 Illustration Style
illustration_policy_detected: {pictogram | illustration_character | emoji_casual | not_detected}
{1-2 sentences describing the evidence and the user's confirmation choice}

### B-07 Android UI Framework
android_ui_framework_detected: {view_system | compose | not_detected | not_applicable}
{1-2 sentences describing the strong signals found, with input-sources/{stack}/path:line evidence; "not_applicable" when there is no Android source}

## Cross-Source Conflicts

<!-- 複数ソースが present なときのみ (単一ソースなら "single source — no cross-check" と書く)。
     1 行 = 1 件。判定は衝突規則 (code 勝ち。縮退時は視覚・構造=figma / 挙動=docs)。
     採用しなかった側の ref も必ず残す — Step 03 が note に転記し、Step 04 Dimension 6 と Step 05 人間ゲートが読む。 -->

| # | Item | code | docs | figma | 採用 | Refs (採用 / 非採用) |
|---|---|---|---|---|---|---|

## Analysis Coverage

<!-- B2.0 の読み取り計画 (.code-inventory.json / .code-scope.json) の数字を転記する。
     範囲外は「存在しない」ではなく「未解析」— 下流はここを見て absence 判定を留保する。 -->
- 解析対象: {N} files / {LOC} LOC (tiers: {確定 tier 一覧})
- 除外: {excluded 内訳 — test / asset / generated / dependency dir 等}
- 未解析 (範囲外): {module / tier 一覧、なければ "なし"}

## Analysis Confidence
[High / Medium / Low] — rationale
```

### 引用スポットチェック (Write 直後・必須)

main が raw-analysis.md を Write した直後に実行する:

```
node scripts/check-source-citations.mjs {app_name} --file artifacts/{app_name}/reverse-engineered/raw-analysis.md
```

`--file` で対象をいま書いた raw-analysis.md に限定する — 既定対象に含まれる
`reverse-provenance.json` は Step 03 の管轄で、ループ 2 周目 / resume では前回分が残存しうるため
本 step では検査しない (provenance 込みの検査は Step 05 §1.5 が監査前に実行する)。

- **exit 0 (疑義なし・warnings なし)** → 次 step へ。
- **exit 3 (疑義なしだが warnings あり — 「引用が 1 件も見つからない」等)** → 通過扱いにしない。
  引用ゼロの解析は「検証できるものが無かった」であって「検証済み」ではない。原因 (対象が空 /
  引用文法違反) を解消してから再実行する。
- **exit 1 (疑義あり)** → 該当 finding を出した shard に**1 回だけ**正しい引用の再確認を依頼して
  修正する。再確認 1 回で解消しない引用は、finding を `※ 未確認` へ降格して残す (引用を捏造して
  埋めない)。**降格の書式**: 引用の `:行番号` を外し
  `※ 未確認 (引用解決不能 — 元参照: input-sources/{stack}/path/to/file.ext、行未特定)` の形に
  書き換える — 行番号つき引用文法のまま残すとスポットチェックが同じ引用を再検出し続け、
  exit 0 に永遠に到達しない (Step 05 の Completion Check は exit 0 を要求する)。
  **ループブレーカー**: 再確認は 1 回まで — それ以上は降格で確定して先へ進む。
- **exit 2 (実行エラー)** → 引用の問題ではない。対象ファイルの存在と実行位置 (repo root からの
  相対パス前提) を確認して再実行する — 疑義扱いで再確認ループに入れない。
- 本検査が見るのは「開ける参照か」(ファイル実在 + 行番号範囲 + 大文字小文字) のみ。引用先の内容が
  主張を支持するかは Step 05 の監査が見る。発火 = shard の引用規律が機能しなかったシグナルとして
  warning に残す。
