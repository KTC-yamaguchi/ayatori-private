---
name: 22-figma-export
description: Phase 3 の Step 22。Step 21 で承認された main (default) HTML を Figma にキャプチャ出力する。見た目の取り込みに専念し、コンポーネント化や Variables 紐付けは後工程 (Step 24・25) に委ねる。
---

# 22 Figma出力（HTMLキャプチャ — main / default のみ）

## 役割
21 で承認された **main (default) HTML** を Figma にキャプチャ出力する。コンポーネント化・Variables 紐付けは後工程（24・25）で行うため、このステップでは**見た目の取り込み**に専念する。

> **sub-state Figma 出力の縮退**: 本 step では **`states: ["default"]` 固定** で Figma capture を行う (Q2「状態粒度」質問は廃止)。empty / loading / error / 追加状態の Figma 追加 capture は **Step 25e (figma-pattern-export) に移管**された。Step 25e は `figma-capture-runner` を `mode: substate` で起動し、既存 default frame の位置を保持したまま sub-state を追加する。

## 前提条件
- 全画面HTMLが人間承認済み（21完了）
- `skills/00-figma-mode-detect/SKILL.md` の判定で `mode == "enabled"`（`disabled` の場合は下記フォールバック）
- `artifacts/{app_name}/figma-state.json` は **本ステップ (22) が初期化する**（`file_key`・`page`・`page_id` をここで設定）。Step 12 はコード生成のみで Figma を触らないため figma-state.json は作らない

---

## エージェントプロンプト

このステップを実行するとき、以下のプロンプトを自分自身への指示として適用すること。

---

**あなたは Figma MCP を扱うデザインエンジニアです。**

HTMLキャプチャを第一選択として、全画面を Figma の `{app_name}` ページへ取り込みます。
**この段階ではコンポーネント化・Variables バインドは行いません**（それぞれ 24・25 の役割）。

### 推奨方式: `generate_figma_design`（HTMLキャプチャ）

`mcp__plugin_figma_figma__generate_figma_design` を使って HTML をそのまま Figma に取り込む。
HTMLの見た目が編集可能な状態で Figma に入る。コンポーネント化は後工程。

### 補助方式: `use_figma`（Plugin API）

キャプチャが失敗する画面や、Auto Layout を細かく制御したい場合のみ補助的に使う。
このステップでは AutoLayout・Variables バインドまで作り込まない（24・25 で行う）。

---

## Phase 0: グラフィックブロック整合 assert

capture 起動前に `artifacts/{app_name}/pipeline-state.json` を確認し、次の (a)〜(c) の**いずれも成立しない**場合は実行（capture / disabled フォールバック含む本 step 全体）を起動せず中断し、resume cascade（`phases/screens/SKILL.md` 手順 8 の graphics 分岐）の該当 21x step へ差し戻す（25d/25e の layer1_skill_assert と同型、設計 `docs/graphic-generation-design.md` §9-3。Step 15 側と異なり本 step は 2nd save 通過後にしか到達しないため常時評価する）:

- (a) `pipeline-state.screens.graphics.decision == "skip"`
- (b) `pipeline-state.approvals.graphics_human_approved == true`（canonical フラグ — `step21g_approved_at` ではなくこちらを読む、設計 §9-2）
- (c) **legacy passthrough**: `pipeline-state.screens.graphics` キー未存在 AND `pipeline-state.confluence.design.save_count >= 2`（グラフィックブロック導入前に 2nd save まで到達していた決定的証拠。「2nd save 済み・Step 22 未実行」の中断 resume は P-15 で明示サポートされる正規状態 — (c) が無いとこのプロジェクトが deadlock する）

> 条件を「skip 確定 or 21g 承認済み（+ legacy 証拠）」の**肯定形**で書くのは、`decision == "generate"` のまま 21g 未承認の HTML を Figma に書き出すリークを塞ぐため（グラフィック未反映の frame が export され HTML↔Figma 乖離が固定される、設計 §3/§9-3）。

## グラフィック入り HTML の書き出し

21a〜21g で埋め込まれた AI 生成グラフィック（`<img src="../_shared/graphics/{graphic_id}.(png|webp)" alt="{graphic_id}" width height>`、C-26 形式）は、**本 step のキャプチャ経路を一切変更せずそのまま書き出される**。グラフィック専用の upload・ノード作成・配置手順は不要。

- **相対参照の解決**: 正典 `screens/_shared/graphics/` は Step 2.2 の HTTP server root（`screens/`）配下にあるため、`../_shared/graphics/` 相対参照は追加設定なしで解決される。
- **書き出し結果**: `<img>` は元ファイルと**バイト同一の IMAGE fill** になる（Figma `imageHash` = 画像ファイルの sha1 と一致）。`alt` はレイヤ名に反映される（レイヤ名は `Image ({alt})` 形式 — C-26 の alt は `{graphic_id}` のため `Image ({graphic_id})` になる）。`object-fit: cover → scaleMode FILL / contain → FIT`（未指定は FILL）。同一グラフィックを複数画面・複数 platform で参照しても Figma 画像ストアは同一 imageHash を共有する（重複格納なし）。
- **制約**: ラスターのみ。正典形式は C-26 に従い PNG/WebP（JPEG/GIF もキャプチャ自体は可能だが正典では使わない）。SVG グラフィックは C-26 が上流（21g）で禁止済み、CSS `background-image` は装飾背景のみ C-26 で許容されるため、いずれも本 step では検査不要（`background-image` 経由はノード名が汎用 `Container`・`background-size → CROP` になり `<img>` より劣るが許容範囲）。
- **不採用方式**: `use_figma` の `figma.createImage(bytes)` は image 格納までは成功するがキャンバスに描画されない — 使わない。`upload_assets`（事前アップロード、10MB 上限）もキャプチャと同一 imageHash になるだけで現行経路への利点がなく未使用 — delta 経路（Step 29 Step 4a 再埋め込み → Step 30 影響画面の再キャプチャ）も画面単位の再キャプチャで賄う。
- **後工程への影響なし**: Step 24（Variables）はグラフィック由来の色を Variables 化しない（Variables の SoT は tokens.json のみ、設計 §6 / v1 決定）。Step 25 の一括バインドは **SOLID fills / strokes のみ照合**するため IMAGE fill は素通りする。Step 25b の sub-state HTML は main の `<head>`/`<body>` 継承によりグラフィックも自動継承され、Step 25e / Step 30 も本 step と同一キャプチャ経路のため個別対応不要。

## 実行指示

### Step 1: 環境確認

> **Mode 判定は `skills/00-figma-mode-detect/SKILL.md` で一元化されている。** 独自の env var チェックは行わず、本スキルを呼び出して結果を取得する。

Read and execute `skills/00-figma-mode-detect/SKILL.md` to resolve `mode`:
- `mode == "enabled"`: Step 2 へ進む
- `mode == "disabled"`: Step 4（フォールバック）へ

### Step 2: ユーザーへスコープ確認 → HTMLキャプチャ

`artifacts/{app_name}/figma-state.json` を読み込み、`file_key`・`page_id` (or `nodeId`) を取得する。

#### Step 2.0a: Resume mode 自動検出（P-15、必須）

スコープ質問の前に `figma-state.json.scope.status` を確認:

| 既存 status | 判定 | 動作 |
|---|---|---|
| 未設定 / `figma-state.json` に `scope` ブロックなし | 初回 | Step 2.0 へ進む（通常フロー） |
| `"success"` | 完了済 | 「既に全件キャプチャ済みです。再キャプチャしますか?」を AskUserQuestion で確認。再キャプチャを選んだ場合は Step 2.0 へ、しない場合は Step 23 へスキップ |
| `"in_progress"` / `"partial_success"` | **Resume mode** | 下記の Resume 手順を実行（Q1/Q2 はスキップ） |
| `"blocked"` | 中断あり | Resume mode と同じ扱い。`reason` フィールドの blocker (permission_denied, port_unavailable 等) は事前にユーザーへ通知 |

**Resume 手順**:

1. `scope.user_selected.platforms` と `scope.user_selected.states` を復元（Q1/Q2 は再質問しない）
2. `scope.deferred_remaining` 配列を `target_files` として採用（空の場合は in_progress 直後の中断 → `nodes.screens` に未記録の全 target を再構築して deferred として扱う）
3. **Layout 選択 (Q3, Resume mode 専用)** — `figma-state.json.scope.layout_status` が `auto_grid*` (前回 layout がパイプライン自動整列のまま = 手動配置なし) なら **質問せず `full` を採用** してこの手順を skip する (過剰質問の回避)。`layout_status` が `user_managed` / 欠落のときのみ、ユーザーが Figma 上でフレーム位置を手動調整している可能性があるため AskUserQuestion で以下を提示:

   > 前回の Step 22 が `{status}` で停止しています（{captured}/{total} captured, deferred={K} 件）。
   > **⚠️ Resume mode 注意**: 完了後の grid layout は、選択次第で Figma 上の手動位置調整を上書きする可能性があります。
   > 残り {K} 件を再開します。完了まで離席せず、Mac のスリープ抑止 (caffeinate) を起動します。

   | option | label | 動作 |
   |---|---|---|
   | `full` (推奨; 手動調整していない場合) | 全件 layout | 既存 M 件 + 新規 K 件を再整列。手動位置調整があれば上書き |
   | `new_only` | 新規 {K} 件のみ layout | 既存 M 件の位置は維持。新規分のみ計算位置に配置 |
   | `skip` | Layout スキップ | `use_figma` を呼ばない。完全に手動整列に委ねる |

   選択結果を `figma-state.json.scope.resume_layout_mode` に記録 (`"full"` / `"new_only"` / `"skip"`)。Step 2.5 で参照する。

4. `figma-state.json.scope.status = "in_progress"` に更新して Step 2.1 へ進む
5. Step 2.5 (grid layout) は `resume_layout_mode` の値で挙動が変わる（同 Step 内で詳述）

#### Step 2.0: 出力スコープを 1 問でユーザーに確認（必須）

キャプチャ開始前に **AskUserQuestion** で以下 1 問を提示する。`requirements.json.design_output_scope` をデフォルト推奨として preview に明示:

**質問 1 — 出力プラットフォーム**:

選択肢は **ディスク上に実在する platform dirs** (`screens/web/` / `screens/web-sm/` / `screens/mobile/`) から動的に構成する。推奨 default は `requirements.json.design_output_scope` (platform_combo + web_viewports) の展開結果と一致する組合せ:
- Web (デスクトップ) のみ (1440×900、`screens/web/*.html`)
- Web スマホ幅のみ (390×844、`screens/web-sm/*.html`) ※ dir 実在時のみ提示
- Mobile のみ (390×844、`screens/mobile/*.html`)
- 実在する全 platform dirs (推奨; design_output_scope の展開結果と一致)

> **Q2 (状態粒度) は廃止**: 本 step は `states: ["default"]` 固定で実行する。sub-state (empty / loading / error / 追加状態) の Figma 出力は **Step 25e (figma-pattern-export)** で追加実行される (`mode: substate` で `figma-capture-runner` を再利用)。Step 25a の AskUserQuestion で sub-state 要否を user に確認するため、本 step では聞かない。

**結果のキャプチャ対象 file 数** (default 固定):

| 質問 1 | キャプチャ件数 |
|---|---|
| 1 platform dir のみ (Web / Web スマホ幅 / Mobile) | N (画面数) |
| 2 platform dirs | N × 2 |
| 3 platform dirs (web + web-sm + mobile) | N × 3 |

最小 = N (例: 11 件)、最大 = N × 3 (例: 33 件)。sub-state を含めた追加 capture は Step 25e で別途実行 (`figma-state.json.scope.user_selected.states` を append 更新)。
ユーザーの選択を `figma-state.json.scope.user_selected` にも記録する (states は `["default"]` 固定)。

#### Step 2.1: スコープ確定後の対象ファイル列挙 (default 固定)

```
selected_platforms = answer1  # subset of ["web", "web-sm", "mobile"] (固定順)
selected_states = ["default"]  # 固定値。sub-state は Step 25e で追加 capture

target_files = []
for platform in selected_platforms:
  for screen in N_screens:  # screens/00-screen-list.md より列挙
    # state == "default" なので suffix なし
    # platform 別サブフォルダ配下から取得（mobile- 接頭辞は廃止）
    target_files.append(f"screens/{platform}/{screen}.html")

assert all files exist on disk
expected_count = len(selected_platforms) × N_screens   # × 1 (default のみ)
```

> **dual_theme_mode = true 時**: Step 17 が `{画面名}--light.html` / `{画面名}--dark.html` の 2 枚を default 状態として生成しているため、`target_files` は両 theme HTML を含む。命名規約は Step 17 で確定済 (Step 22 では拡張子付きで実在ファイルを ls する)。

#### Step 2.1a: フレーム固定幅 pre-flight（必須・キャプチャ開始前）

キャプチャ機構はブラウザで開いて `figmaselector` で要素を切り出す方式で **viewport 幅を制御できない**。固定幅要素（web = `body` 1440px / web-sm・mobile = `.screen` 390px）を欠いた HTML（fluid / レスポンシブ）をそのまま capture すると、**Figma フレームがブラウザ窓幅に依存した意図しない幅で出力される**（実事故あり: スマホ中心 WEB 案件で fluid HTML が生成され、そのまま capture されて幅が崩れた）。capture 前に全 target を機械検証する:

```bash
node scripts/lint-screen-frame.mjs --check {target_files...}   # 絶対 path で列挙
```

- **exit 1（`fixed_frame_missing` / `width_media_query` あり）→ キャプチャを開始しない**。違反ファイル一覧（stdout JSON の `files[].violations`）をユーザーに提示し、「Step 17 の HTML 固定サイズルール違反のため Figma 出力を中断しました。該当画面を `skills/00-feedback-protocol` の手順で修正（固定幅ラッパー付与）するか Step 17 で再生成してから、Step 22 を再実行してください」と案内して本 step を中断する。**違反ファイルだけ除外して続行しない**（部分 capture は「一部だけ幅が正しい Figma」を作り混乱の元になる）。
- exit 0 → Step 2.1b へ進む。exit 2 は運用エラー（パス誤り等）— 違反と誤認せず原因を直して再実行。
- 本 pre-flight は Step 17 の self-check（生成直後の一次ガード）を通過していれば常に pass する二重化で、Step 17 を経ない経路（手編集画面・legacy 生成物・skill 更新前の生成物）を capture 直前で塞ぐのが目的。

#### Step 2.1b: プロジェクト専用 Figma ページを確保（P-16, 新規）

キャプチャ先ページをプロジェクトごとに分離し、既存プロジェクトのフレームと混在させない。

```js
// mcp__figma__use_figma で実行
const existingPages = figma.root.children;
const targetPageName = "{app_name}";  // e.g. "kagemusha-ai-video"
let targetPage = existingPages.find(p => p.name === targetPageName);
if (!targetPage) {
  targetPage = figma.createPage();
  targetPage.name = targetPageName;
}
await figma.setCurrentPageAsync(targetPage);
return { page_id: targetPage.id, page_name: targetPage.name, created: !existingPages.find(p => p.name === targetPageName) };
```

- 既にプロジェクト名と一致するページが存在すれば、そのページをカレントに設定（再作成しない）
- `figma-state.json.page_id` をこのステップで取得した `targetPage.id` で上書き更新する
- キャプチャループ（Step 2.3）は更新後の `page_id` を使用する

#### Step 2.1.5: Pre-flight system sleep prevention（P-15、必須）

離席による session timeout（macOS スリープ → ブラウザ–`mcp.figma.com` 間の WebSocket 切断 → captureId 失効）を防ぐため、capture 開始前にスリープ抑止を起動する。

**所要時間見積もり**:

```
N = len(target_files)
estimate_sec = max(60, N × pipeline.yaml.screens.figma_export.estimate_sec_per_file)  # default 6 sec/file
duration_sec = estimate_sec + pipeline.yaml.screens.figma_export.sleep_prevention_buffer_sec  # default +600
```

**スリープ抑止起動**:

`pipeline.yaml.screens.figma_export.system_sleep_prevention` の値で分岐:

- `auto` (default) かつ `uname -s == "Darwin"` の場合:
  ```bash
  # PID ファイルは artifacts/{app_name}/.caffeinate.pid に置く（プロジェクトスコープ）
  # /tmp はグローバルで、同一マシン上で複数 AYATORI プロジェクトを並行起動すると衝突するため使わない。
  # プロジェクト削除時に artifacts ディレクトリと一緒に消える点も clean。
  PID_FILE="artifacts/{app_name}/.caffeinate.pid"

  # 前回 AYATORI が書き残した本プロジェクトの caffeinate のみを kill する（再開時の二重起動防止）
  # NOTE: `pkill -f "caffeinate -dimsu -t"` だと、ユーザーが手動で長時間 caffeinate
  #       (例: `caffeinate -dimsu -t 7200` を別作業で起動中) を一緒に殺してしまうため、
  #       必ず PID ファイル経由で「自分のプロセスだけ」を対象とする。
  if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    [ -n "$OLD_PID" ] && kill "$OLD_PID" 2>/dev/null
    rm -f "$PID_FILE"
  fi
  caffeinate -dimsu -t {duration_sec} >/dev/null 2>&1 &
  CAFFEINATE_PID=$!
  # Claude Code の Bash tool は shell state を invocation 間で保持しないため、
  # Step 2.4 で kill するには PID をファイル経由で受け渡す必要がある
  echo "$CAFFEINATE_PID" > "$PID_FILE"
  echo "caffeinate started (PID=$CAFFEINATE_PID, duration=${duration_sec}s, pid_file=$PID_FILE)"
  ```
- `auto` かつ非 macOS、または `disabled` の場合: 抑止スキップ。ユーザーに WARNING を表示

**ユーザー向け表示（必須・キャプチャ開始前）**:

```
本ステップは {N} 件のキャプチャで約 {estimate_sec/60:.0f} 分かかります。
Mac のスリープ抑止 (caffeinate -dimsu, PID={CAFFEINATE_PID}) を起動しました。

⚠️ 離席禁止:
  capture 中にスリープ・スクリーンセーバ・Claude Code 中断が発生すると、
  Figma 側 captureId TTL ({captureid_ttl_sec}s) を超過し session timeout で
  手動コピーが必要になる場合があります。

中断発生時の復旧:
  次セッションで Step 22 を再実行すると Resume mode が自動検出し、
  deferred の残件のみ再キャプチャします。
```

**注意**: caffeinate は Step 2.4（HTTP サーバ停止）と同じタイミングで `artifacts/{app_name}/.caffeinate.pid` 経由で kill する（Claude Code の Bash tool は shell state を invocation 間で保持しないため `$CAFFEINATE_PID` を直接参照できない）。タイムアウト (`-t` 引数) が過ぎても自動終了するため、kill 取りこぼしても孤児プロセスは残らない。

#### Step 2.2: HTTP サーバ起動（P-06 補強）

`screens/` ディレクトリを HTTP 配信する（capture script は relative path で `_shared/*.css` を解決）:

```bash
cd artifacts/{app_name}/screens
lsof -ti :9342 | xargs kill 2>/dev/null
nohup python3 -m http.server 9342 > /tmp/ayatori-http.log 2>&1 &
SERVER_PID=$!
sleep 2
# target_files の先頭 1 件を ping (例: "screens/web/01-login.html" → "/web/01-login.html")
curl -fsSL -o /dev/null -w "%{http_code}\n" "http://localhost:9342/${target_files[0]#screens/}"  # 200 確認
```

注: `screens/_shared/root-variables.css` と `common-styles.css` は Step 17 が HTML 内へインライン展開するため、`<link rel="stylesheet">` は使わない。platform サブフォルダ化による相対パスの問題は発生しない。

#### Step 2.3: キャプチャループ（staggered batches + retry）

**並列度 4、batch 間 stagger 必須** — 11 件以上を同時 open すると Chrome がタブ処理を throttling する（実セッションで実証）:

```
ttl_sec = pipeline.yaml.screens.figma_export.captureid_ttl_sec  # default 300

for batch in chunks(target_files, parallel_batch_size=4):  # pipeline.yaml.screens.figma_export.parallel_batch_size
  # 1. captureId を 4 件並列生成（発行時刻を記録）
  for f in batch:
    captureId = mcp__figma__generate_figma_design(outputMode='existingFile', fileKey, nodeId)
    captures[f] = {id: captureId, generated_at: now()}

  # 2. 4 件のブラウザを stagger 間隔で開く
  # NOTE: figmaselector は「html 全体ではなく指定要素のみキャプチャする」指定 (P-13 対策)。
  #   - mobile → ".screen": 390×844 の実体要素のみを取り込む。Step 17 が mobile HTML を
  #              `.screen` (390px) + 全幅プレビュー body で出力しているため、body を指定すると
  #              全幅ラッパー (~1497px on macOS Chrome) を取り込み、内部の実画面コンテナが
  #              ラッパー中央寄せ座標 (x≒(wrapper_w−390)/2) のまま残る。clip OFF だと
  #              そのコンテナが frame 右端を超えて隣列のフレーム上に溢れる原因になる。
  #   - web-sm → ".screen": mobile と同じ固定幅 390px ラッパー機構。
  #              media query ではなく固定幅 .screen 要素でスマホ幅を表現しているため、
  #              viewport 幅制御なしでスマホ幅キャプチャが成立する。
  #   - web    → "body": 1440px の実ページ幅。html を指定すると viewport (~1372px) になる。
  for f, c in batch:
    selector = ".screen" if (パスに "mobile/" or "web-sm/" を含む) else "body"
    f_rel = f から "screens/" prefix を除去した相対パス  # HTTP server root は screens/ (Step 2.2 の cd 参照)。例: "screens/mobile/01-home.html" → "mobile/01-home.html"
    open "http://localhost:9342/{f_rel}#figmacapture={c.id}&figmaendpoint=https%3A%2F%2Fmcp.figma.com%2Fmcp%2Fcapture%2F{c.id}%2Fsubmit&figmadelay=2000&figmaselector={selector}"
    sleep stagger_open_sec=4

  # 3. batch 全体待機（capture script が submit するまで）
  sleep 10

  # 4. 並列 poll（最大 poll_max_retries × poll_interval_sec）
  for retry in range(poll_max_retries=10):
    statuses = parallel_poll(captureIds in batch)
    record node_id for each completed
    if all completed: break
    sleep poll_interval_sec=5

  # 5. 残り pending があれば re-open & retry。
  #    P-15: captureId 発行から ttl_sec を超過していれば stale 扱い → 新規発行。
  #          stale 判定により、ユーザー離席後の resume 時や long-running batch でも
  #          確実に有効な captureId で再試行できる。
  for f, c in pending:
    if (now() - c.generated_at) > ttl_sec:
      c.id = mcp__figma__generate_figma_design(outputMode='existingFile', fileKey, nodeId)  # 再発行
      c.generated_at = now()
      stale_regenerated += 1
    open browser again with (possibly new) captureId in hash
    sleep 4
  poll pending until completed (max 10 retries)
```

**stale_regenerated カウンタ**は orchestrator return summary に含める（例: `Step 22 done: 88/88 captured, stale_regenerated=3, ...`）。多発する場合 (>10%) は離席が頻発しているか laptop sleep が抑止できていない兆候。

**上書きルール**: 既に `nodes.screens.{key}` に node_id が記録済みの場合、`use_figma` で既存ノードを削除してから再キャプチャ（initial run では skip 可）。

#### Step 2.4: HTTP サーバ停止 + スリープ抑止解除（必須）

```bash
kill $SERVER_PID
lsof -i :9342  # ポート解放確認

# P-15: caffeinate を明示的に停止（-t timeout も保険として効く）
# PID は Step 2.1.5 で artifacts/{app_name}/.caffeinate.pid に書き出し済み
# （Bash tool の shell state は invocation 間で消えるため env var では受け渡せない）
# プロジェクトスコープなので、並行する別 AYATORI プロジェクトの caffeinate を巻き込まない。
PID_FILE="artifacts/{app_name}/.caffeinate.pid"
if [ -f "$PID_FILE" ]; then
  CAFFEINATE_PID="$(cat "$PID_FILE")"
  if [ -n "$CAFFEINATE_PID" ] && kill "$CAFFEINATE_PID" 2>/dev/null; then
    echo "caffeinate stopped (PID=$CAFFEINATE_PID)"
  fi
  rm -f "$PID_FILE"
fi
```

#### Step 2.4b: フレーム正規化（Step 2.5 共有ルーチンに統合）

各キャプチャ済みフレームの「内容を原点へ寄せ → フレームを内容実寸へクロップ → `clipsContent=true`」という正規化は、**Step 2.5 のグリッド整列ルーチン (`refs/default-grid-layout.js` の Step 0.5) に統合済み**。本ルーチンは Step 22 (default) / Step 25e (sub-state) / delta 再キャプチャの**毎回末尾で実行される共有ルーチン**なので、追加されたフレームも常に既存フレームと同じタイル形状へ正規化される。

そのため本 step では **独立した補正パスを実行しない** (二重正規化を避ける)。設計上の要点のみ:

- **過幅だけでなく無条件で正規化する**: フレーム幅が既に 390px でも、内部コンテナがラッパー中央寄せ座標 (x≒554) のまま残ると `clipsContent=false` で隣列へ溢れる。幅トリガー (`width > expected+50`) では 390px のまま溢れるフレームを取りこぼすため、Step 0.5 はトリガー無しで全フレームに適用する。
- **union bounding box を使う**: 最大面積の子要素 1 件だけを基準にすると、複数の兄弟要素 (header / list / bottom-nav 等) が別々の x 座標に分散している画面でフレームが過小クロップされる (例: 252px になるべき画面が 390px になる逆ケースも発生)。全子要素の union bounding box (minX〜maxX, minY〜maxY) を使うことで正しい全体サイズが得られる。
- **auto-layout padding を先にクリア**: `paddingRight` が残ったまま resize すると FILL 子要素が 1px にクランプされる。Step 0.5 は resize 前に `paddingLeft/Right/Top/Bottom = 0` をセットする。
- **根本対策は Step 2.3 のセレクタ**: mobile を `figmaselector=.screen` でキャプチャすればラッパー中央寄せオフセット自体が発生しないため、Step 0.5 は冪等な安全網として働く。

#### Step 2.5: デフォルトグリッド整列（必須・post-capture layout）

> **Resume mode 分岐 (P-15)**: `figma-state.json.scope.resume_layout_mode` で挙動が変わる。初回キャプチャ (Resume mode でない) では常に `"full"` 相当。
>
> | mode | 動作 | `__NODES__` プレースホルダ |
> |---|---|---|
> | `full` (default / 初回) | 全件再整列 | `nodes.screens` 全エントリから構築 |
> | `new_only` | 本セッションでキャプチャした新規 node のみ移動。**既存ノードは Figma 上での手動位置を保持** | 本 run 開始前に snapshot した keys を除外して構築 |
> | `skip` | `mcp__figma__use_figma` を呼ばずに Step 2.5 を skip。summary に `grid moved=0, mode=skip` を記録 | (使用しない) |
>
> **`new_only` の実装**: agent は capture loop 開始前に `pre_existing_keys = Object.keys(figma-state.json.nodes.screens)` を保持。Step 2.5 で `new_keys = Object.keys(...) - pre_existing_keys` を計算し、`new_keys` 集合に含まれる screen/state/platform の組のみを `__NODES__` に詰める。テンプレート側 (`refs/default-grid-layout.js`) のロジック変更は不要 — 未指定スロットは黙ってスキップされるため、既存ノードは触られない。
>
> **`skip` の警告**: ユーザーには「自分でフレームを整列する必要があります」を明示。`figma-state.json.scope.layout_status = "user_managed"` を記録して 24 / 25 の前提が崩れていないか後続で確認できるようにする。

通常時 (mode=`full`) は全件キャプチャ完了後、`mcp__figma__use_figma` を 1 回実行して **rows = screens × cols = states × platforms** のグリッドに自動配置する。これによりレビュー時に「画面ごとに横並びで全状態 × 全プラットフォームを比較」できる視覚レイアウトが得られる。

> Step 22 では `STATES = ["default"]` 固定のため、グリッドは **rows = screens × cols = platforms** に縮退する。sub-state を追加した後の最終形 (rows × cols = states × platforms) は Step 25e (`mode: substate`) が `figma-state.json.scope.user_selected.states` に新 state を append した後、25e 内の Step 2.5 相当処理で組み直す。Step 22 時点では default frame だけのコンパクトな grid となる。

> **共有 finalize ルーチン (default 後も sub-state 後も同じ整列が走る)**: 本 Step 2.5 のグリッド整列 + フレーム正規化 (`refs/default-grid-layout.js`、Step 0.5 で内容を原点へ寄せ・内容実寸へクロップ・`clipsContent=true`) は、Step 22 (default) / Step 25e (sub-state 追加) / delta 再キャプチャの **毎回末尾で実行される単一の共有ルーチン**である。
>
> **layout 所有権ルール**: `figma-state.json.scope.layout_status` が `auto_grid*` (前回 layout がこのルーチンの自動整列 = 人間の手動配置なし) のとき、毎 episode 末尾で **`full` 全体再タイル化** を走らせる。sub-state を追加するときも default 含む全 frame を最終形 (cols = states × platforms) に振り直すので、**追加 frame が既存 frame の位置に重なって生成される問題が構造的に発生しない**。`new_only` (既存 frame を動かさない) は `layout_status` が manual / 不明 — 人間が Figma 上で手動配置した可能性があるとき — の保護 fallback であり、所有権がパイプラインにある通常運用では使わない。手動配置を上書きする `full` を人間所有 layout に適用する場合のみ Step 2.0a Q3 で同意を取る。
>
> **orphan sweep (Step 6)**: stale captureId が遅延完了して grid 外の任意座標に重複 frame を落とすことがある。共有ルーチン末尾で、**grid frame と同名なのに id が grid に無い FRAME** (= 遅延完了した重複キャプチャの特徴) を grid 右側の隔離カラムへ移動し `orphans_moved` / `orphan_names` で報告する (自動削除はしない — 人間がレビューして削除する)。同名一致でスコープを絞るため、ユーザーが同じページに置いた注釈・比較用などの手動 frame は移動対象にならない。これにより最終出力は常に「grid + 隔離カラム」の 2 領域に整理され、浮遊 frame が grid に重なったまま残らない。

**スキーマ**: `cols_per_row = len(PLATFORMS) × len(STATES)`、各行は `max(frame.height)` で動的に高さ決定 (web=900px / mobile=812px の min-height を超えるコンテンツに対応)。

例 — Q1=mobile_and_web × STATES=["default"] (固定) × dual_theme_mode=false → 2 cols × N rows:

```
                Web·default     | Mobile·default
01-login          [W default]   |  [M default]
02-dashboard      ...           |  ...
...
N-screen          ...           |  ...
```

**dual_theme_mode = true のとき**: theme 次元は screen 次元に統合される。`figma-state.json.nodes.screens` の key が `{platform}/{画面名}--{theme}` 形式で記録されているため (state 軸が外れた)、SCREENS placeholder に各画面 × 各 theme を別エントリとして列挙する (例: `['01-login', '01-login']` ではなく `['01-login·light', '01-login·dark']` のように theme suffix 付きで列挙)。結果として **rows = SCREENS.length × 2 (theme), cols = PLATFORMS × STATES (default のみ = 1 軸)** の grid となる。例 — Q1=mobile_and_web × STATES=["default"] × dual=true × 2 screens → 2 cols × 4 rows (2 screens × 2 themes)。

**Figma frame 命名規約 (symmetric)**:
- single-mode: `{画面名} ({platform} · {state})` (例: `Login (Web · default)`)
- dual_theme_mode=true: `{画面名} ({platform} · {state} · {theme})` (例: `Login (Web · default · light)` / `Login (Web · default · dark)`)。light frame と dark frame で同じ descriptive 名にせず、必ず ` · light` / ` · dark` suffix を含める (Figma 上での frame 一覧で theme 区別ができるように)。全 frame が unique name になる

**実装テンプレート**: `skills/22-figma-export/refs/default-grid-layout.js` を Read し、以下のプレースホルダを user-selected scope と figma-state.json から埋めて `mcp__figma__use_figma` の `code` パラメータに渡す:

| placeholder | 値 |
|---|---|
| `__SCREENS__` | JSON 配列。`screens/00-screen-list.md` の表示順 (例: `['01-login','02-dashboard',...]`) |
| `__NODES__` | JSON object。`figma-state.json.nodes.screens` から構築。各 screen を `{web: {default: "283:2", empty: "284:2", ...}, mobile: {...}}` の **state名キー形式** に変換（インデックス配列ではない）。画面ごとに状態数が異なっていてよい。**Resume mode `new_only`**: `pre_existing_keys` に含まれるキーは entry から除外（既存ノードは move しない） |
| `__PLATFORMS__` | Step 2.0 Q1 結果。subset of `['web','web-sm','mobile']` (固定順。例: `['web','web-sm']` / `['web','mobile']`) |
| `__STATES__` | Step 2.0 Q2 結果（ベース状態）。`['default']` or `['default','empty','loading','error']`。追加状態（paused / recording 等）は `__NODES__` から自動検出されるため列挙不要 |

**Layout config** (`pipeline.yaml.screens.figma_export.layout`):
- `web_frame_width`: 1440 (default)
- `web_sm_frame_width`: 390 (default)
- `mobile_frame_width`: 375 (default)
- `col_gap_px`: 100 (default)
- `section_gap_px`: 320 (platform group 間追加 gap: web ↔ web-sm ↔ mobile)
- `row_gap_px`: 240
- `add_row_labels`: true (画面名を行頭に表示)
- `add_col_headers`: true (Web · default 等を列頭に表示)

**注意**: `node.x` / `node.y` は parent 相対座標。現状の Figma capture は frame を file の page 直下 (parent_id=`2:2` 等) に追加するため、グリッド座標もページ相対になる。失敗時 (Inter フォント未ロード等) は frame 配置のみ行いラベルはスキップする。

### Step 3: フォールバック `use_figma`（キャプチャ失敗時のみ）

特定の画面で `generate_figma_design` が失敗する場合：

1. `mcp__plugin_figma_figma__use_figma` で最低限のフレーム（幅 1440 / 390、Auto Layout なし）を作成
2. `figma.notify(frame.id)` 等で node-id を取得
3. TODO コメントを `figma-state.json` に残して 24 で再構築することを記録

### Step 4: `figma-state.json` を更新（Step 2.0 で選択したスコープ全件記録、default 固定）

**schema**: 1 画面あたり 1〜2 エントリを記録 (default × platform 数のみ):

```json
{
  "file_key": "{FIGMA_FILE_KEY}",
  "page_id": "{page_id_or_node_id}",
  "scope": {
    "user_selected": {
      "platforms": ["web", "mobile"],
      "states": ["default"]
    },
    "html_files_total_in_screens_dir": 22,
    "html_files_targeted_by_user": 22,
    "html_files_captured": 22,
    "status": "success",
    "deferred_remaining": [],
    "stale_regenerated_count": 0,
    "resume_layout_mode": null,
    "layout_status": "auto_grid",
    "last_updated_at": "2026-05-22T12:34:56Z"
  },
  "nodes": {
    "screens": {
      "web/{画面名1}":            {"node_id": "...", "platform": "web",    "state": "default", "url": "..."},
      "web-sm/{画面名1}":         {"node_id": "...", "platform": "web-sm", "state": "default", "url": "..."},
      "mobile/{画面名1}":         {"node_id": "...", "platform": "mobile", "state": "default", "url": "..."}
    }
  }
}
```

> **sub-state は Step 25e で append**: Step 25e (`mode: substate`) は本 step が書いた `scope.user_selected.states = ["default"]` に新 state (例: `"loading"`) を **append**、`nodes.screens` に `web/{画面名1}--loading` のようなキーを追加する。default 既存エントリの **node_id 値は書き換えない** (再キャプチャしない)。frame の位置は layout 所有権ルール (Step 2.5) に従い `auto_grid*` なら full 再タイル化で動く。

**部分実行時** (token budget 超過 / session timeout / permission denied 等で全件不可の場合): `status = "partial_success"` (中断検知済み) または `"in_progress"` (中断検知前にエージェントが落ちた) + `deferred_remaining` 配列に未キャプチャファイル名を列挙し、次セッションで継続。`scope.html_files_captured` を実件数で更新。`status == "success"` は **`html_files_targeted_by_user` 件全達成時のみ**。次セッションの Step 22 起動時は Step 2.0a の **Resume mode** が `status` を判定し、Q1 スキップ + `deferred_remaining` を `target_files` として再開する (Q2 は廃止のため Resume でも質問しない)。

### フォールバック（`mode == "disabled"` の場合）

Figma 出力はスキップ。skip した旨を `pipeline-state.json` に記録して 23 へ進む:

1. `artifacts/{app_name}/pipeline-state.json` を Read (or init stub) し、`screens.step22_figma_status = "skipped_stub_mode"` を merge して Write back する (`schemas/pipeline-state.schema.json` 準拠)。
2. `figma-state.json` は **作成・更新しない** (同 schema は root `additionalProperties: false` + `file_key` 必須のため、disabled 環境で安全に書けるキーが無い。旧手順の `figma-state.json` への `export_status` キー書き込みは schema 未定義の違反 write だったため本記録方式に置換)。
3. → `skills/23-human-final-approval/SKILL.md` へ進む。

> この記録は `phases/screens/SKILL.md` の resume 規則と `/ayatori-status` の Phase 3 判定が「Step 22 は disabled で処理済み」と識別するために読む。disabled では `nodes.screens` が populate されないため、これが無いと両者の Step 22 判定行が永久マッチして後段 (23〜25a) に到達できない。

> **下記「出力」/「完了後」セクションは enabled mode 専用** (Figma 画面ノード群・`figma-state.json` の `nodes.screens` 更新・キャプチャ完了メッセージを前提とするため)。fallback 経路は本手順 1〜3 で完結する — 完了メッセージは「スタブモードのため Figma 出力を skip しました。23（人間最終承認）へ進みます。」を表示する。

---

## 出力

- Figma `{app_name}` ページ上の画面ノード群（HTMLキャプチャ）
- `artifacts/{app_name}/figma-state.json`（`nodes.screens` 更新）

---

## 完了後
「{N}画面の HTML を Figma にキャプチャしました。23（人間最終承認）へ進みます。」
→ `skills/23-human-final-approval/SKILL.md` を Read して 23 を実行

---

## Subagent Isolation Mode (P-14, 必須)

> **Step 22 は常に `figma-capture-runner` サブエージェントに委譲する** (件数判定なし)。
> このセクションは agent / 呼び出し側 (`phases/screens/SKILL.md`) 双方の参照仕様。

### なぜ必須なのか

`mcp__figma__generate_figma_design` は呼び出しごとに ~3KB の verbose instruction boilerplate を返す。N=88 で 2 calls/件 (generate + poll) = ~528KB、N=200 で ~1.2MB を main context が吸収する。

| 規模 | main context 直接実行 | サブエージェント隔離 |
|---|---|---|
| 11 件 | ~66KB main 消費 | ~3KB main (summary のみ) |
| 88 件 | ~528KB main 消費 (50% 圧迫) | ~3KB main / 528KB sub-agent (1M 内) |
| 200 件 | ~1.2MB main 消費 (**context 不足**) | ~3KB main / chunk 分割で sub-agent も安全 |

### 呼び出し側 (main / phases/screens/SKILL.md) の責務

1. **Resume 判定 (P-15)**: `figma-state.json.scope.status` を Read。`"partial_success"` / `"in_progress"` / `"blocked"` なら Resume mode。Q1 スキップ → `scope.user_selected` 復元 → `target_files = scope.deferred_remaining` (Q2 は廃止のため Resume でも質問なし)
2. **Resume 時の Layout 選択 (P-15)**: 上記 Step 2.0a 手順 3 の AskUserQuestion を **main で** 実行。結果を `resume_layout_mode` (`"full"` / `"new_only"` / `"skip"`) として agent prompt に渡し、同時に `figma-state.json.scope.resume_layout_mode` にも記録
3. **通常時**: Step 2.0 (AskUserQuestion Q1 のみ) を **main で** 実行 — UI 接点はここだけ。`scope_q2` は `["default"]` 固定。`resume_layout_mode` は `null` (agent 側で `full` 相当扱い)
4. `target_files` 配列を組み立て (Step 2.1 相当、default のみ)
5. `figma-capture-runner` を 1 回だけ呼び出し:

```
Agent({
  subagent_type: "figma-capture-runner",
  description: "Step 22 Figma capture for {N} default files",
  prompt: """
mode: orchestrator
resume: {true if Resume mode else false}
resume_layout_mode: {"full" | "new_only" | "skip" | null}
app_name: {app_name}
file_key: {figma-state.json.file_key}
page_id: {figma-state.json.page_id}
scope_q1: ["web","mobile"]   # Step 2.0 Q1 結果。subset of ["web","web-sm","mobile"]
scope_q2: ["default"]
target_files: ["01-login.html","02-dashboard.html",...]   # default のみ
"""
})
```

> `scope_q2` は `["default"]` 固定。Q2 は廃止された (sub-state Figma 出力は Step 25e で `mode: substate` 経由で追加実行される)。

6. サブエージェントの return (短い summary) をそのままユーザーに表示
7. `figma-state.json` を Read して結果サマリの正確性を確認 (sub-agent が直接 Write 済み)
8. Step 23 へ進む

### サブエージェント側の責務 (`.claude/agents/figma-capture-runner.md` で定義)

- Pre-flight (Step 2.1.5, P-15): `caffeinate -dimsu -t N` 起動 (macOS, `system_sleep_prevention=auto` 時)
- Steps 2.2 (HTTP server start) → 2.3 (capture loop, captureId timestamp 管理 + stale 再発行) → 2.4 (HTTP server stop + caffeinate stop) → 2.5 (grid layout) を順次実行
- 各 batch 完了後に `figma-state.json` を Write で更新 (durability)
- 起動時に **Resume mode** か判定 (`scope.status` が `"partial_success"` / `"in_progress"` / `"blocked"` で `deferred_remaining` が非空) — 該当時は Q1 を呼び出し元から再受信せず deferred のみ処理 (Q2 は廃止のため `["default"]` 固定で復元)
- 件数 > `pipeline.yaml.screens.figma_export.subagent_isolation.recursive_split_threshold` (default 150) の場合は orchestrator mode に切り替え:
  - HTTP server を起動したまま
  - target_files を platform-first で `chunk_size` (default 100) ずつに分割
  - 各 chunk について sequentially `Agent({subagent_type: "figma-capture-runner", prompt: "mode: worker, ..."})` を spawn
  - 全 worker 完了後に server stop + grid layout
- `< 500 char` の summary を main に return

### Worker mode の動作

worker mode で呼ばれた場合:
- HTTP server は parent が起動済み (`http_server_running: true` を信頼) → server start/stop しない
- 受け取った chunk のみ Step 2.3 capture loop を実行
- 完了 node_ids を `figma-state.json` に Write
- Step 2.5 grid layout はスキップ (orchestrator が全 chunk 完了後に 1 回実行)
- summary を return

### 並列 worker は禁止

`pipeline.yaml.screens.figma_export.subagent_isolation.parallel_workers: 1` は将来拡張用フィールドだが現在は **必ず 1 (sequential)** に固定。理由:

| 制約 | 詳細 |
|---|---|
| Browser throttling | Chrome は 11 件以上の同時 open を捨てる (P-11 実証済) |
| HTTP server | port 9342 は single instance、worker 間で共有必須 |
| figma-state.json | 並列 Write は race condition |

将来 browser bottleneck を解消する手段が見つかった場合のみ `parallel_workers: 2` 等への引き上げを検討する。

### Return schema (sub-agent → main)

サブエージェントは以下のような短いプレーンテキストを返す:

| 状況 | 例 |
|---|---|
| Orchestrator success | `Step 22 done: 88/88 captured, stale_regenerated=0, file_url=https://figma.com/design/.../影武者_ayatori_sun, grid moved=88 headers=8 rowLabels=11, deferred=[], elapsed_sec=2140` |
| Orchestrator partial | `Step 22 partial: 75/88 captured, stale_regenerated=2, deferred=[mobile/09-...,mobile/10-...], reason=stuck_captureIds, file_url=..., elapsed_sec=2480` |
| Orchestrator resume success | `Step 22 resume done: 13/13 captured (was 75/88), stale_regenerated=4, total=88/88, deferred=[], elapsed_sec=420` |
| Orchestrator split mode | `Step 22 done (3 chunks): 200/200 captured, stale_regenerated=1, chunks=[web 100/100, web 50/50, mobile 50/50], grid moved=200, deferred=[], elapsed_sec=4720` |
| Worker success | `Worker chunk 2/4 done: 50/50 captured, stale_regenerated=0, deferred=[]` |
| Worker partial | `Worker chunk 2/4 partial: 47/50, stale_regenerated=3, deferred=[mobile/...,mobile/...,mobile/...]` |

詳細な node_id 一覧 / captureId / MCP response は **絶対に return に含めない** — 全て `figma-state.json` に persist されている。
