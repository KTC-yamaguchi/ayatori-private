#!/bin/bash
# .claude/hooks/backup-on-edit.sh
#
# 人間ゲート確認対象の成果物を上書き / 編集する直前に、現行 (= 修正前) の中身を
# app ルート直下の `_backup/` フォルダ (元の相対構造をミラー) へ時刻付きで自動複製する PreToolUse hook。
# 誤った修正をしても直前バージョンに戻せるようにするのが目的。
#
# 配置方針: バックアップは `artifacts/{app_name}/_backup/{元の相対パス}/{stem}.{時刻}.{ext}` に置く。
#   deliverable ディレクトリ (requirements/ や screens/) の中に _backup/ を置くと、パイプラインが
#   それらを再帰 grep / find する際 (例: skill 33 の ID 整合 grep、C-18 の色整合 grep、skill 28/29 の
#   find) にバックアップを誤って拾うため、scan 対象ツリーの外 (= app ルート直下) へ退避する。
#
# 動作:
#   - Write / Edit の stdin JSON を受領し file_path を取り出す
#   - file_path が「対象成果物 glob」に一致し、かつ既にディスク上に存在する (= 新規生成ではなく修正)
#     場合のみ、上書き前の中身を `{app}/_backup/{相対dir}/{stem}.{YYYYMMDD_HHMMSS}.{ext}` に cp する
#   - 直前バックアップと md5 が同一なら複製しない (no-op rewrite による増殖を防ぐ)
#   - バックアップ後そのまま exit 0 し、本来の Write / Edit を続行させる
#
# 対象成果物 (artifacts/{app_name}/ からの相対パス。pipeline.yaml `artifact_backup.targets` と同期):
#   requirements/*.md / design-samples/**/*.html / style-guide.md / tokens.json /
#   screens/*.md / screens/style-guide-view.html / screens/00-transition-map.{mmd,html} /
#   screens/{web,web-sm,mobile}/*.html / graphics/raw/*.png / screens/_shared/graphics/*.{png,webp} /
#   figma-state.json / pipeline-improvements.md (webp は旧仕様 run の legacy 正典のみ — 現行 writer は無い)
#   (生成グラフィック PNG の正規 writer は Bash 起動 script [21e/21f] で本 hook は発火しない —
#    退避はスクリプト自前の backupFile が担う。ここに載せるのは targets との同期
#    維持 + 万一 Write ツールで PNG パスを潰す誤操作が起きた場合の安全網)
# 対象外: 中間ファイル・ループ用 history・machine state (scores.json / *-history.json /
#   pipeline-state.json / pending-questions.json / requirements.json / design-brief.yaml 等)。
#   許可リスト方式のため、上記 glob に一致しないものは自動的に対象外になる。
#
# 削除運用: バックアップはユーザーが手動で削除する (自動削除はしない)。
#
# 依存: bash + 標準 OS コマンド (cat / cp / mkdir / dirname / basename / date / ls / grep / awk / head / stat) のみ。
#   stdin JSON の parse は jq、md5 は md5sum (Linux) / md5 (macOS) を使う。
#   いずれかが不在でも exit 0 で素通り (fail-open)。
#
# Fail-open 設計: jq 不在 / JSON parse 失敗 / cp 失敗 / 想定外エラーは全て exit 0。
#   本 hook は「バックアップを取れなかった」ことを理由に Write / Edit をブロックしない
#   (exit 2 を返さない)。成果物の保存そのものを妨げないことを最優先する。

set +e  # fail-open

# ── jq 不在チェック (fail-open) ──
command -v jq >/dev/null 2>&1 || exit 0

PAYLOAD=$(cat)
[ -z "$PAYLOAD" ] && exit 0

# ── tool name と file_path 取得 ──
TOOL_NAME=$(echo "$PAYLOAD" | jq -r '.tool_name // "unknown"' 2>/dev/null)
FILE_PATH=$(echo "$PAYLOAD" | jq -r '.tool_input.file_path // ""' 2>/dev/null)

# Write / Edit 以外、または file_path 空は素通り
[ "$TOOL_NAME" != "Write" ] && [ "$TOOL_NAME" != "Edit" ] && exit 0
[ -z "$FILE_PATH" ] && exit 0

# ── 再帰ガード: 既に _backup/ 配下のファイルはバックアップしない ──
case "$FILE_PATH" in
  */_backup/*) exit 0 ;;
esac

# ── artifacts/ 配下判定 + artifacts ルートと相対パスの切り出し (相対/絶対パス両対応) ──
# Write/Edit ツールは通常絶対パスを渡すが、schema-light-check.sh と同様に
# 相対パス (artifacts/...) でも動作させる (fail-silent 回避)。
#   ART_ROOT = .../artifacts (絶対) または artifacts (相対先頭)
#   REL_FULL = artifacts/ より後ろ全体 (例: siplog/requirements/05-features.md / pipeline-improvements.md)
case "$FILE_PATH" in
  artifacts/*)
    ART_ROOT="artifacts"
    REL_FULL="${FILE_PATH#artifacts/}"
    ;;
  */artifacts/*)
    ART_ROOT="${FILE_PATH%%/artifacts/*}/artifacts"
    REL_FULL="${FILE_PATH#*/artifacts/}"
    ;;
  *)
    exit 0   # artifacts/ 配下でない
    ;;
esac

# 新規生成 (ディスク上に未存在) はバックアップ不要 — 上書き / 編集時のみ対象
[ ! -f "$FILE_PATH" ] && exit 0

BASE=$(basename "$FILE_PATH")

# REL_IN_APP = app サブディレクトリより後ろ (例: requirements/05-features.md / figma-state.json)
case "$REL_FULL" in
  */*)
    # artifacts/{app}/... 形式
    APP_SEG="${REL_FULL%%/*}"
    REL_IN_APP="${REL_FULL#*/}"
    BACKUP_ROOT="$ART_ROOT/$APP_SEG/_backup"
    ;;
  *)
    # artifacts 直下ファイル (app サブディレクトリ無し、例: pipeline-improvements.md)
    REL_IN_APP="$REL_FULL"
    BACKUP_ROOT="$ART_ROOT/_backup"
    ;;
esac

# ── 対象判定 (許可リスト方式。REL_IN_APP = app ルートからの相対パス) ──
IN_SCOPE=0
# 共有のレトロ改善レポート (artifacts 直下 / app ルート直下のどちらの配置でも対象。
# サブディレクトリ内の同名ファイルを誤って拾わないよう REL_IN_APP で厳密判定する)
[ "$REL_IN_APP" = "pipeline-improvements.md" ] && IN_SCOPE=1
# 人間ゲート確認対象成果物の相対 glob (pipeline.yaml artifact_backup.targets と同期)
if echo "$REL_IN_APP" | grep -qE '^(requirements/[^/]+\.md|design-samples/.+\.html|style-guide\.md|tokens\.json|screens/[^/]+\.md|screens/style-guide-view\.html|screens/00-transition-map\.(mmd|html)|screens/(web|web-sm|mobile)/[^/]+\.html|graphics/raw/[^/]+\.png|screens/_shared/graphics/[^/]+\.(png|webp)|figma-state\.json)$'; then
  IN_SCOPE=1
fi
[ "$IN_SCOPE" -ne 1 ] && exit 0

# ── ファイル名を stem / ext に分解 ──
if echo "$BASE" | grep -q '\.'; then
  STEM="${BASE%.*}"
  EXT="${BASE##*.}"
else
  STEM="$BASE"
  EXT=""
fi

# バックアップ先 = app ルート直下の _backup/ に元の相対ディレクトリ構造をミラーする
# (deliverable ツリーの外へ退避してパイプラインの再帰 grep / find による誤検出を防ぐ)
REL_DIR=$(dirname "$REL_IN_APP")
if [ "$REL_DIR" = "." ]; then
  BACKUP_DIR="$BACKUP_ROOT"
else
  BACKUP_DIR="$BACKUP_ROOT/$REL_DIR"
fi

# ── md5 計算ヘルパ (md5sum: Linux / md5: macOS、いずれも無ければ空) ──
md5_of() {
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$1" 2>/dev/null | awk '{print $1}'
  elif command -v md5 >/dev/null 2>&1; then
    md5 -q "$1" 2>/dev/null
  else
    echo ""
  fi
}

# ── 直前バックアップを取得 (md5 dedup / cooldown 判定に使う) ──
if [ -n "$EXT" ]; then
  LATEST=$(ls -t "$BACKUP_DIR/$STEM."*".$EXT" 2>/dev/null | head -1)
else
  LATEST=$(ls -t "$BACKUP_DIR/$STEM."* 2>/dev/null | head -1)
fi
if [ -n "$LATEST" ] && [ -f "$LATEST" ]; then
  # (1) md5 dedup: 内容が直前バックアップと同一なら複製しない (no-op rewrite の増殖防止)
  CUR_MD5=$(md5_of "$FILE_PATH")
  PREV_MD5=$(md5_of "$LATEST")
  if [ -n "$CUR_MD5" ] && [ "$CUR_MD5" = "$PREV_MD5" ]; then
    exit 0
  fi
  # (2) cooldown: 同一ファイルの直近バックアップが一定秒数以内なら skip。
  #     1 回の修正指示を複数 Edit に分割しても、最初の Edit 直前 (= 指示前) の 1 件だけ残す。
  #     秒数は環境変数 AYATORI_BACKUP_COOLDOWN_SECONDS で調整 (既定 180、0 で無効)。
  #     stat / date が失敗した場合は skip せず複製する (fail-open: バックアップを取り逃さない)。
  #     バイナリ画像 (png/webp = 生成グラフィック) には適用しない — Edit ツールは
  #     バイナリを分割編集できず「1 指示複数 Edit」の前提が成立しない上、21e/21f の script 退避
  #     (cooldown なし) と _backup/ プールを共有するため、cooldown を適用すると script 退避直後の
  #     180 秒間だけ Write 誤操作の安全網に穴が開く (課金済み世代が無退避で消える)。
  COOLDOWN="${AYATORI_BACKUP_COOLDOWN_SECONDS:-180}"
  case "$EXT" in png|webp) COOLDOWN=0 ;; esac
  if [ "$COOLDOWN" -gt 0 ] 2>/dev/null; then
    NOW=$(date +%s 2>/dev/null)
    MTIME=$(stat -f %m "$LATEST" 2>/dev/null || stat -c %Y "$LATEST" 2>/dev/null)
    if [ -n "$NOW" ] && [ -n "$MTIME" ] && [ "$((NOW - MTIME))" -lt "$COOLDOWN" ] 2>/dev/null; then
      exit 0
    fi
  fi
fi

# ── バックアップ実行 ──
TS=$(date +%Y%m%d_%H%M%S)
if [ -n "$EXT" ]; then
  DEST="$BACKUP_DIR/$STEM.$TS.$EXT"
else
  DEST="$BACKUP_DIR/$STEM.$TS"
fi

# 同一秒の衝突回避: 既に同名が存在する場合は連番を付す (cooldown=0 等で同秒に複数退避するケースで
# 上書きによるバックアップ消失を防ぐ。既定 cooldown 下では通常発生しない)。
if [ -e "$DEST" ]; then
  i=1
  if [ -n "$EXT" ]; then
    while [ -e "$BACKUP_DIR/$STEM.$TS-$i.$EXT" ]; do i=$((i+1)); done
    DEST="$BACKUP_DIR/$STEM.$TS-$i.$EXT"
  else
    while [ -e "$BACKUP_DIR/$STEM.$TS-$i" ]; do i=$((i+1)); done
    DEST="$BACKUP_DIR/$STEM.$TS-$i"
  fi
fi

mkdir -p "$BACKUP_DIR" 2>/dev/null || exit 0
cp "$FILE_PATH" "$DEST" 2>/dev/null || exit 0

exit 0
