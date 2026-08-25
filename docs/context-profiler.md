# Context Profiler (`scripts/profile-context.mjs`)

Claude Code セッションが **どの message で context window を食っているか** を可視化する自己完結 HTML レポートを生成する補助ツール。pipeline / skill の context 消費をデバッグする用途。

パイプライン本流 (Phase 0〜6) には含まれない **スタンドアロンの開発補助ツール**。`/ayatori-*` コマンドではなく、直接 or npm で起動する。

## 何を解析するか

harness が `~/.claude/projects/<project-slug>/<session>.jsonl` に書く会話ログ (1 行 1 message の JSONL) を読み、message ごとのサイズを算出して以下を可視化する:

- **source 別内訳** — `tool_result` / `assistant:text` / `assistant:tool_use` / `attachment:*` / `claude_md` / `system-reminder` 等、どのカテゴリが bytes を食っているか。
- **`tool_result` の中身** — `tool_use_id` で元の tool_use に逆リンクし、**どの tool** (Read / Bash / Write / Edit / Agent / MCP) が生んだかに分解。さらに **どの file / command** かまで (`--session` ドリルダウン)。
- **再 Read の検出 + stale / after-edit 分類** — 同じ file の再 Read を、間に Edit/Write があったか (**after edit** = 正当) / なかったか (**stale** = 純粋な無駄) に分類する。hotspot callout は stale bytes でランク付けする (stale が 1 件もなければ従来の ×N ヒューリスティックに fallback)。`×N` は全 session 横断の総 read 数、stale/after-edit は **session 内** の再 Read のみ数える (別 session での read はその session の window で必ず初回払いになるため無駄ではない)。制約: Bash 経由の書き換え (`sed -i` / redirect / `git checkout` 等) は検出できず、その後の再 Read は stale と誤分類され得る。
- **prompt-cache 効率** — assistant turn の `usage` を `cache_read` / `cache_creation` / uncached `input` に分解し、session / 全体の **cache hit 率** を表示。さらに timeline 上で **cache break** (`⟲` マーカー: cache_creation が window 増分を大きく超過 = キャッシュ済 prefix の再作成) を検出する。5 分 TTL 切れ・system prompt / tool list の変更・compaction 後の rebuild が典型原因。閾値: 超過 ≥5k tok。初回 turn の cache 作成は正常なので対象外。
- **失敗 tool call の無駄** — `tool_result` の `is_error` を集計 (件数 + bytes)。エラー文もリトライも window に残り続けるため純粋な無駄。KPI / session カード / timeline 行 (⚠ 赤表示) の 3 箇所に出す。
- **active / waiting 時間の分離** — 連続 message 間の無音 gap ≥ 2 分を **waiting** (human gate / 離席)、それ未満を **active** として按分。timeline には `⏸ waited Xm → (human gate / user turn / next event)` の divider が入る。heuristic である点に注意: 2 分超の長い Bash 実行等も waiting に数えられる (divider のラベルで何を待っていたか判別可能)。
- **skill 別コスト** — `<command-name>` / `Skill` tool を state machine で追跡し、**どの `/ayatori-*` skill 実行中**に消費が起きたかを帰属。
- **2 段構成の出力** — **index** (`context-profile.html`) が全体 rollup + session の **By size** 一覧を持ち、各 session から **detail** ページ (`context-profile/<id>.html`) へリンク。detail は 1 session に集中し、以下を持つ:
  - **context 構成バー** — 実 peak context-window (tokens) を "used" 幅とし、各 message-source を byte 比で slice。window 上限までの残りを **free space** (ハッチ) で表示。どの種類がどれだけ window を埋めたか + 空き容量が一目で分かる。
  - **縦型 timeline** — 全 message を上から時系列に並べる。bar 長 ∝ サイズ、色 = source、実 ctx-window 値を併記。実行中 skill (amber band) でグルーピング、source でフィルタ可能。**file / command 列** は各行に人間可読の見出しを出す: `tool_result` / `tool_use` は tool + file/command (`Read → skills/07-human-gate-req/SKILL.md`)、user turn は prompt の見出し (slash コマンドなら `/ayatori-requirements — <本文>`)、assistant text は返信の冒頭 snippet、`TodoWrite` / `AskUserQuestion` / `ToolSearch` / MCP はその引数の要約。`meta:*` bookkeeping 行のみ raw type を薄く表示。フィルタバーに 2 つの独立トグル: **hide bookkeeping** (`meta:*` / `other:*` 行を隠す) と **hide small growth** (growth が `max(500, peak×2%)` tok 未満の小さな `+N` / `·` ラベルを消す — 行自体は残り、gauge も残る。大きな jump と支配的な read だけが数値を残すのでノイズが減る)。

### サイズの精度と window 上限

- **bytes** は JSONL 上の格納サイズ (厳密)。`~tok` 表記の値は byte 比按分の概算。
- **context-window / output tokens** は assistant message の API `usage` メタデータ由来の **実 token 値** (概算ではない)。usage は assistant turn にのみ記録されるため、timeline では直近 assistant の値を前方に carry-forward する。
- **token growth 列のセマンティクス**: assistant turn の `usage` (`input + cache_read + cache_creation`) は「その turn を生成するために **読んだ** prompt 全体」= その turn 以前の全内容であり、**その turn 自身の返信は含まない** (返信は別途 `output_tokens`)。したがって 2 つの measured turn 間の window 増分は厳密に `Δctx(N) = output(前 turn) + inflow(その間に注入された tool_result / user / attachment)` に分解できる。**gap 単位の total (inflow) は厳密**だが、**gap 内に複数行あるときの per-row 按分 (byte 比) は推定** (bytes→tokens は一定比ではない)。そこで確実性に応じて表示を分ける:
  - `base N` … 最初の turn 開始前に既に window にある static preamble (system prompt + CLAUDE.md + skill/tool listings + 最初の user turn)。**厳密**。
  - `+N` (assistant turn) … その turn の総増分。**厳密** (hover で out/inflow 内訳)。
  - `+N` (gap に 1 行だけの tool_result/user 行、または Claude 返信行) … その行が gap の全 inflow なので **厳密**。
  - `~N est` … 複数行が 1 gap を共有した場合、**最大 byte 行にのみ**推定値を表示。gap total は厳密だが per-row 分割は推定 (「どの read の再読を止めるべきか」の **ランキング用途**であり課金値ではない)。それ以外の小さな寄与行は数値を出さず muted な `·` のみ (偽の精度を出さない)。
  - `−N` … measured turn 間で window が **縮んだ** (compaction / summarization / `/clear`)。grow 前提の分解はこの境界を跨いで適用できないため、縮小イベントとして明示し、直前 gap の行には帰属させない (silent drop しない)。
- 構成バーの slice: "used" 幅 = 実 peak ctx (正確)、その内訳は各 source の **byte 比** で按分 (実 total × per-source 比率)。按分の分母と slice には **main window を占有する source のみ** を使う — `subagent:*` (sidechain の中身は subagent 自身の window に入り、main に入るのは Agent の最終 tool_result のみ) と `meta:*` / `other:*` (harness bookkeeping、model は見ない) は除外する。timeline の gap inflow 按分も同じ理由で `subagent:*` / `meta:*` / `other:*` 行を除外する。byte rollup (Overall breakdown) はこれらも含めて全量を報告する。
- **cache hit 率 / cache break / is_error 件数は実測値** (`usage` と `tool_result.is_error` の記録そのまま)。heuristic なのは (a) active/waiting の 2 分閾値按分、(b) 再 Read の stale 分類 (Bash 経由の書き換えが見えない)、(c) cache break の ≥5k tok 閾値、の 3 点のみ。
- **context window 上限は transcript に記録されていない** (usage は count のみ)。さらに transcript の model id は window variant を区別しない (1M [1m] session でも `claude-opus-4-8` とだけ記録される) ため、**peak のみから推定する**: `peak ≤ 200k → 200k` / それ以外 → `1M`。つまり 200k を超えた peak だけが 1M の証明になり、**200k 以下で終わった 1M session は 200k と誤推定される** — その場合は `--window <tokens>` で明示上書きする (detail ページに "inferred" と明示される)。
- **skill 帰属**は harness native の `attributionSkill` field を優先し、無い行は `<command-name>` / `Skill` tool の state machine で補完する。state machine が反応するのは **user turn 内の harness コマンド封筒** (`<command-message>` を伴うもの) のみ — prose 言及や assistant の引用では active skill を切り替えない (session filter と同じガード)。

## 使い方

```bash
# 現 project の、実際に /ayatori-* を起動した session だけを解析 (既定)
npm run profile:context
#   → artifacts/_reports/context-profile.html を生成 (artifacts/ は Git 管理外)

# 直接起動も可
node scripts/profile-context.mjs

# フィルタを外して全 session
node scripts/profile-context.mjs --all

# 別 project (~/.claude/projects/<name>)
node scripts/profile-context.mjs --project -Users-foo-dev-bar

# 単一 session ファイルだけ (フィルタは自動で無効化される)
node scripts/profile-context.mjs --session ~/.claude/projects/<slug>/<id>.jsonl

# 出力ディレクトリを明示 / window 上限を明示 / 解析 JSON を stdout へ
node scripts/profile-context.mjs --out-dir /tmp/ctx-report
node scripts/profile-context.mjs --window 200000
node scripts/profile-context.mjs --json > profile.json
```

生成物 (既定 `artifacts/_reports/`):

```
context-profile.html          index。全体内訳 + session 一覧 (By size) + detail へのリンク
context-profile/<id>.html     session ごとの detail。context 構成バー + 縦 timeline
```

index をブラウザで開く (`open artifacts/_reports/context-profile.html`) → session カードをクリックで detail へ。各ページは自己完結 (data inline) なので単体でも開ける。

### 既定 scope: なぜ AYATORI session のみか

`/ayatori-*` は CLAUDE.md や会話中に **prose として頻出** するため、単純な文字列一致では誤検知する。本ツールは **user turn 内の harness コマンド封筒** (`<command-message>` を伴う `<command-name>/ayatori-*</command-name>`) または `Skill` tool_use のみを「実起動」と判定し、prose 言及・assistant の引用は除外する。legacy `/acad-*` は `/ayatori-*` に畳んで集計する。

`--all` でこのフィルタを無効化できる。`--session` で単一ファイルを指定した場合はフィルタを自動で無効化する (明示指定したファイルは必ず表示する)。

**注意**: session 内で slash コマンドが実際にタイプされた場合のみ検知する。`-c` / `--continue` で前 session から再開した run は (コマンドが元 session にしかないため) 既定 scope では拾えない。その場合は `--all` か `--session` を使う。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `scripts/profile-context.mjs` | エントリ。JSONL 解析 + 集計 + CLI + 2 テンプレートへの差し込み。Node のみ、npm 依存ゼロ。 |
| `scripts/profile-context.index.template.html` | **index** ページの HTML/CSS/JS テンプレート。全体 rollup + session の By size 一覧。 |
| `scripts/profile-context.session.template.html` | **session detail** ページのテンプレート。構成バー + 縦 timeline。 |

各テンプレートは単一プレースホルダ `__DATA_INJECT__` を持ち、実行時に対応する JSON payload を差し込む。

### レポートの見た目を変えたいとき

該当テンプレート (`*.index.template.html` or `*.session.template.html`) を直接編集して `npm run profile:context` を再実行するだけ。ビルド手順はない。テンプレートは実行時に `readFileSync` される (`.mjs` と隣り合わせに置く前提)。

**`__DATA_INJECT__` プレースホルダは保持すること。** テンプレートを `.mjs` に文字列として埋め込まず静的ファイルに保つのは、レポートの client-side JS が `${...}` を多用するため — 埋め込むと Node が load 時にそれらを誤展開してしまう。静的ファイル + 文字列置換ならこの衝突が起きない。

## 依存 / 設計方針

Node.js のみで完結し外部 CLI を要求しない (CLAUDE.md Operating Principle 1 適合)。`render-color-report.mjs` / `render-deviations-view.mjs` と同じ「機械可読ソース → 決定論的 derived HTML view」パターン。出力先の既定 `artifacts/_reports/` は Git 管理外。
