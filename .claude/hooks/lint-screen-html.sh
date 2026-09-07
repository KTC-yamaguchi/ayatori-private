#!/bin/bash
# .claude/hooks/lint-screen-html.sh
#
# 完成プロジェクトの画面 HTML (screens/{web,web-sm,mobile}/*.html) を、パイプライン外 (ad-hoc / 手作業) で
# 編集した直後に色 lint を自動実行する PostToolUse hook。
#
# 背景: 色チェック (scripts/lint-screen-colors.mjs) は通常 Step 18 デザインレビュー内でのみトリガーされる。
#   このステップを経由しない経路 (= 完成後に画面 HTML を直接 Write/Edit) では lint が一度も走らず、
#   L1 トークン違反 (literal 色直書き / 未解決 var 等) が成果物に残ってしまう。本 hook はその穴を塞ぐ。
#
# なぜ PostToolUse か:
#   lint は「保存後の新しい内容」を見る必要がある。PreToolUse の時点では Edit がまだディスクに反映されて
#   いないため、編集前の内容を lint してしまう。したがって PostToolUse (編集がディスクに反映済み) を使う。
#   PostToolUse は tool 実行を block できないが、本 hook の要件は「fail-open の助言」なので問題ない。
#
# 動作:
#   1. Write / Edit の stdin JSON を受領し file_path を取り出す
#   2. file_path が screens/{web,web-sm,mobile}/*.html に一致し、かつ完成プロジェクト
#      (pipeline-state.json の approvals.final_approved or completed_at_states) のときだけ動く
#      (= ビルド中の Step 17/20/29 の HTML Write を「手編集」と誤認しない)
#   3. node scripts/lint-screen-colors.mjs --check <file> を実行 (単一ファイル、L1 のみ)
#   4. 編集を台帳 artifacts/{app}/delta/edited-screens.json に記録 (screen-edit delta の検知用)
#   5. hard 違反があれば systemMessage で 1 行警告。常に exit 0 (block しない)
#
# --report は実行しない: 全画面走査の color-lint-report.json は Step 18/29 が所有する derived artifact で
#   あり、fire-and-forget な hook から上書きすると single-writer 所有権違反 + race になるため。hook は
#   安価な per-file --check のみを担い、全体 report の再生成は screen-edit delta の skill 側で行う。
#
# Fail-open 設計: jq / node 不在、parse 失敗、対象外パス、未完成プロジェクト、lint 実行失敗は全て exit 0。
#   本 hook は編集そのものを妨げない (exit 2 を返さない)。

set +e  # fail-open

# ── jq 不在チェック (fail-open) ──
command -v jq >/dev/null 2>&1 || exit 0

PAYLOAD=$(cat)
[ -z "$PAYLOAD" ] && exit 0

# ── tool name と file_path 取得 ──
TOOL_NAME=$(echo "$PAYLOAD" | jq -r '.tool_name // "unknown"' 2>/dev/null)
FILE_PATH=$(echo "$PAYLOAD" | jq -r '.tool_input.file_path // ""' 2>/dev/null)

[ "$TOOL_NAME" != "Write" ] && [ "$TOOL_NAME" != "Edit" ] && exit 0
[ -z "$FILE_PATH" ] && exit 0

# ── repo root とスクリプトの解決 (CLAUDE_PROJECT_DIR 優先、無ければ自身の位置から) ──
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)}"
[ -z "$PROJECT_DIR" ] && exit 0
LINT_SCRIPT="$PROJECT_DIR/scripts/lint-screen-colors.mjs"

# ── file_path を絶対パス化 (相対パスは PROJECT_DIR 基準) ──
case "$FILE_PATH" in
  /*) ABS_PATH="$FILE_PATH" ;;
  *)  ABS_PATH="$PROJECT_DIR/$FILE_PATH" ;;
esac

# ── 再帰ガード: _backup/ 配下は対象外 ──
case "$ABS_PATH" in
  */_backup/*) exit 0 ;;
esac

# ── artifacts/ 配下判定 + app セグメントと相対パスの切り出し ──
case "$ABS_PATH" in
  */artifacts/*)
    ART_ROOT="${ABS_PATH%%/artifacts/*}/artifacts"
    REL_FULL="${ABS_PATH#*/artifacts/}"
    ;;
  *)
    exit 0   # artifacts/ 配下でない
    ;;
esac

# REL_FULL = {app}/screens/... 形式でなければ対象外
case "$REL_FULL" in
  */*) : ;;
  *)   exit 0 ;;
esac
APP_SEG="${REL_FULL%%/*}"
REL_IN_APP="${REL_FULL#*/}"
APP_ROOT="$ART_ROOT/$APP_SEG"

# ── 対象判定: screens/{web,web-sm,mobile}/*.html のみ (sub-state / theme 派生も含む) ──
echo "$REL_IN_APP" | grep -qE '^screens/(web|web-sm|mobile)/[^/]+\.html$' || exit 0

# ── 編集がディスクに反映済みか (新規・失敗 Write は対象外) ──
[ ! -f "$ABS_PATH" ] && exit 0

# ── 完成プロジェクト・ガード: 未完成 (or state 不明) なら何もしない ──
#   ビルド中 (final_approved 前) の Step 17/20 等による HTML Write を「手編集」と誤認しないための
#   一次 discriminator。完成 *後* に走るパイプラインの画面 Write (Step 29 delta 再生成 /
#   Step 25b sub-state 生成) は final_approved を通過するため、下の in-flight ガードで別途 skip する。
STATE="$APP_ROOT/pipeline-state.json"
COMPLETED=$(jq -r '
  if ((.approvals.final_approved == true)
      or (.approvals.completed_at_states != null and .approvals.completed_at_states != ""))
  then "yes" else "no" end' "$STATE" 2>/dev/null)
[ "$COMPLETED" != "yes" ] && exit 0

# ── in-flight ガード: パイプラインが画面を (再)生成中なら skip ──
#   完成後でも Step 29 (delta 部分再生成) / Step 25b (sub-state 生成) は画面 HTML を Write する。
#   これらは「手編集」ではないため台帳に記録しない (記録すると後続 delta が手編集と誤認する)。
#   - delta in-flight: runs[-1] が存在し、run が未完了 (figma_approved_at / figma_status 未設定)
#     かつ cancelled_at 未設定 (Step 27〜30 の全区間を覆う — screens_approved_at 後の Step 30
#     区間もパイプライン write が起こり得るため、窓は run 完了まで閉じない)
#   - sub-state in-flight: screens.step25b.started_at 設定済 & completed_at 未設定
#   - sub-state fallback: 25b が started_at を記録し損ねても、対象が sub-state 派生ファイル
#     ({screen}--{state}.html) かつ生成計画が進行中 (state-pattern-plan.json 存在 / skip 未選択 /
#     step25b.completed_at 未設定 / completed_at_states 未設定) なら生成中とみなして skip する。
#     skip 選択済みプロジェクトや sub-state 完了後の同ファイル編集は手編集として記録する。
IS_SUBSTATE=0
case "$REL_IN_APP" in
  screens/web/*--*.html|screens/mobile/*--*.html) IS_SUBSTATE=1 ;;
esac
HAS_PLAN=0
[ -f "$APP_ROOT/screens/state-pattern-plan.json" ] && HAS_PLAN=1
INFLIGHT=$(jq -r --arg sub "$IS_SUBSTATE" --arg plan "$HAS_PLAN" '
  (((.delta.runs // [])[-1]) // null) as $r
  | (($r != null) and ($r.cancelled_at == null)
     and (($r.figma_approved_at // null) == null)
     and (($r.figma_status // null) == null)) as $delta
  | ((.screens.step25b.completed_at // null) == null) as $sb_open
  | (((.screens.step25b.started_at // null) != null) and $sb_open) as $substate
  | (($sub == "1") and ($plan == "1") and $sb_open
     and ((.screens.state_pattern_skipped // false) != true)
     and ((.approvals.completed_at_states // null) == null)) as $substate_fallback
  | if ($delta or $substate or $substate_fallback) then "yes" else "no" end' "$STATE" 2>/dev/null)
[ "$INFLIGHT" = "yes" ] && exit 0

# ── node + lint スクリプトの存在チェック (fail-open) ──
command -v node >/dev/null 2>&1 || exit 0
[ ! -f "$LINT_SCRIPT" ] && exit 0

# ── L1 lint 実行 (単一ファイル。stdout JSON, exit 0=ok / 1=hard違反 / 2=実行エラー) ──
LINT_OUT=$(node "$LINT_SCRIPT" --check "$ABS_PATH" 2>/dev/null)
LINT_EXIT=$?
# hard 違反数を抽出 (パース失敗時は空 = 件数不明)。SUMMARY/警告は exit code を一次信号にし、
# JSON パースの成否に依らず exit 1 を「hard 違反あり」として扱う (件数は補助情報)。
HARD=$(echo "$LINT_OUT" | jq -r '.hard_violations // empty' 2>/dev/null)
case "$HARD" in *[!0-9]*) HARD="" ;; esac   # 数字以外 (空含む) は件数不明
HARD_NUM="${HARD:-0}"                        # 台帳の整数フィールド用 (不明時は 0、違反有無は exit で判別)

if [ "$LINT_EXIT" = "2" ]; then
  SUMMARY="lint-error"
elif [ "$LINT_EXIT" = "1" ]; then
  if [ -n "$HARD" ]; then SUMMARY="色トークン hard 違反 ${HARD}件"; else SUMMARY="色トークン hard 違反あり (件数不明)"; fi
else
  SUMMARY="ok"
fi

# ── 編集台帳への記録 (screen-edit delta の検知入力) ──
SCREEN=$(basename "$REL_IN_APP" .html)
PLATFORM=$(echo "$REL_IN_APP" | sed -E 's#^screens/(web|web-sm|mobile)/.*#\1#')
NOW_ISO=$(date +%Y-%m-%dT%H:%M:%S%z 2>/dev/null | sed -E 's/([+-][0-9]{2})([0-9]{2})$/\1:\2/')
LEDGER="$APP_ROOT/delta/edited-screens.json"

ENTRY=$(jq -nc \
  --arg screen "$SCREEN" --arg platform "$PLATFORM" --arg path "$REL_IN_APP" \
  --arg edited_at "$NOW_ISO" --arg tool "$TOOL_NAME" \
  --argjson exit "$LINT_EXIT" --argjson hv "$HARD_NUM" --arg summary "$SUMMARY" \
  '{screen:$screen, platform:$platform, path:$path, edited_at:$edited_at, tool:$tool,
    lint:{exit:$exit, hard_violations:$hv, summary:$summary}, consumed_by_run:null}' 2>/dev/null)

if [ -n "$ENTRY" ]; then
  mkdir -p "$(dirname "$LEDGER")" 2>/dev/null
  # 同時 Write/Edit による台帳更新の取りこぼし (read-modify-write の競合) を防ぐ。
  # flock がある環境のみ排他ロックを取り、無ければ fail-open でそのまま更新する。
  # ロックファイルは台帳ディレクトリ外 (TMPDIR) に置き、成果物ツリーを汚さない。
  LOCK="${TMPDIR:-/tmp}/ayatori-lint-ledger-$(printf '%s' "$APP_SEG" | tr -c 'A-Za-z0-9._-' '_').lock"
  (
    if command -v flock >/dev/null 2>&1; then flock -w 5 9 2>/dev/null || true; fi
    if [ -f "$LEDGER" ] && jq -e . "$LEDGER" >/dev/null 2>&1; then
      CUR=$(cat "$LEDGER")
    else
      CUR=$(jq -nc --arg app "$APP_SEG" \
        '{app_name:$app, entries:[]}' 2>/dev/null)
    fi
    # 同一 path の未消費 (consumed_by_run==null) entry があれば置換、無ければ append
    NEW=$(printf '%s' "$CUR" | jq -c --argjson e "$ENTRY" --arg app "$APP_SEG" '
      .app_name = (.app_name // $app) |
      .entries = (.entries // []) |
      ( [ .entries[] | select(.path == $e.path and .consumed_by_run == null) ] | length ) as $dup |
      if $dup > 0
      then .entries |= map(if (.path == $e.path and .consumed_by_run == null) then $e else . end)
      else .entries += [$e] end
    ' 2>/dev/null)
    if [ -n "$NEW" ]; then
      TMP="$LEDGER.tmp.$$"
      printf '%s\n' "$NEW" | jq . > "$TMP" 2>/dev/null && mv "$TMP" "$LEDGER" 2>/dev/null
      [ -f "$TMP" ] && rm -f "$TMP" 2>/dev/null
    fi
  ) 9>"$LOCK" 2>/dev/null
fi

# ── hard 違反 (exit 1) は systemMessage で 1 行警告 (block しない)。exit code を唯一の判定にし、
#    件数が取れない場合も「件数不明」として必ず通知する (パース失敗による警告漏れを防ぐ) ──
if [ "$LINT_EXIT" = "1" ]; then
  if [ -n "$HARD" ]; then DESC="色トークン違反 ${HARD}件"; else DESC="色トークン違反あり (件数不明)"; fi
  MSG="⚠ ${REL_IN_APP}: ${DESC} (literal色/未解決var 等)。修正の取り込みは /ayatori-delta (screen-edit モード) で行えます。"
  jq -nc --arg m "$MSG" '{systemMessage:$m}' 2>/dev/null
fi

exit 0
