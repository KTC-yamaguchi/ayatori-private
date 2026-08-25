#!/bin/bash
# scripts/test-enforce-substate-scoring.sh
#
# .claude/hooks/enforce-substate-scoring.sh の回帰テスト。
# Sub-state 採点 (Step 25c) を飛ばして 25d/25e の承認・完了を pipeline-state.json に
# 書き込もうとする Write/Edit を exit 2 で block できることを検証する。
# 加えて以下の 3 系統の回帰を含む (PR #126 レビュー対応):
#   - 差し戻し→再生成ループ: 25d の revise 判定記録が残置された state を 25b 再生成が
#     carry-over で書き戻すケースが block されない (キー「存在」でなく「新規導入/値変更」判定)
#   - タイムゾーン表記混在: +09:00 / Z が混在しても epoch 換算で新旧判定が逆転しない
#   - Edit 経路: old→new 置換 simulate により、literal バイパス (無関係な "step25c" 文字列混入)
#     と誤爆 (無関係な "decision" キー) の両方が起きない
#
# 使い方: bash scripts/test-enforce-substate-scoring.sh
# 依存: jq (無ければ hook が fail-open のためテストは skip 判定)

set -u
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_DIR/.claude/hooks/enforce-substate-scoring.sh"
TMP="$(mktemp -d 2>/dev/null || echo /tmp/ayatori-substate-test.$$)"
STATE_DIR="$TMP/artifacts/demoapp"
STATE="$STATE_DIR/pipeline-state.json"
mkdir -p "$STATE_DIR"

command -v jq >/dev/null 2>&1 || { echo "jq 不在のためテスト skip (hook は fail-open)"; exit 0; }
[ -f "$HOOK" ] || { echo "FAIL: hook が見つからない: $HOOK"; exit 1; }

PASS=0; FAIL=0
run() { # $1=desc  $2=payload  $3=expected_exit
  echo "$2" | CLAUDE_PROJECT_DIR="$TMP" bash "$HOOK" >/dev/null 2>&1
  local ec=$?
  if [ "$ec" = "$3" ]; then echo "[PASS] exit=$ec — $1"; PASS=$((PASS+1));
  else echo "[FAIL] exit=$ec (want $3) — $1"; FAIL=$((FAIL+1)); fi
}
p() { printf '{"tool_name":"%s","tool_input":{"file_path":"%s","%s":%s}}' "$1" "$STATE" "$2" "$3"; }
pe() { # Edit payload: $1=old_string $2=new_string
  jq -cn --arg f "$STATE" --arg o "$1" --arg n "$2" \
    '{tool_name:"Edit",tool_input:{file_path:$f,old_string:$o,new_string:$n}}'
}
jstr() { jq -Rn --arg s "$1" '$s'; }   # 文字列を JSON string literal 化

# ── State A: 25b done, 25c NOT (unscored) ──
cat > "$STATE" <<J
{"schema_version":"2026-05-22","app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-06-30T10:00:00+09:00"}},"approvals":{}}
J

C='{"app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-06-30T10:00:00+09:00"},"step25d":{"decision":"approve"}},"approvals":{"patterns_human_approved":true}}'
run "unscored + Write で 25d 承認/完了 → BLOCK" "$(p Write content "$(jstr "$C")")" 2

C='{"app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-06-30T10:00:00+09:00"},"step25c":{"completed_at":"2026-06-30T11:00:00+09:00","score":88}}}'
run "unscored + 25c 自身の書き込み → ALLOW" "$(p Write content "$(jstr "$C")")" 0

C='{"app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-06-30T10:00:00+09:00","completed_count":12}}}'
run "unscored + 25b のみの書き込み → ALLOW" "$(p Write content "$(jstr "$C")")" 0

C='{"app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-06-30T10:00:00+09:00"},"step25c":{"completed_at":"2026-06-30T12:00:00+09:00"},"step25d":{"decision":"approve"}},"approvals":{"patterns_human_approved":true}}'
run "unscored + batched(25c最新+承認) → ALLOW" "$(p Write content "$(jstr "$C")")" 0

# ── State A の Edit 経路 (old→new 置換 simulate で判定) ──
run "unscored + Edit で承認キー導入 → BLOCK" \
  "$(pe '"approvals":{}' '"approvals":{"patterns_human_approved":true}')" 2

# literal バイパス封じ: new_string に無関係な "step25c" 文字列を混ぜても、simulate 結果の
# screens.step25c が未採点のままなら承認キー導入は BLOCK される (旧実装は grep 素通り)
run "unscored + Edit 承認キー導入 (step25c 文字列混入バイパス) → BLOCK" \
  "$(pe '"approvals":{}' '"approvals":{"patterns_human_approved":true},"x_note":"step25c done"')" 2

# 誤爆封じ: 無関係な "decision" キー (step25d 以外) を導入する Edit は ALLOW (旧実装は grep 誤爆)
run "unscored + Edit で無関係 decision キー (step21) → ALLOW" \
  "$(pe '"approvals":{}' '"approvals":{},"step21":{"decision":"approved_main"}')" 0

# ── State B: 25c caught up (scored) ──
cat > "$STATE" <<J
{"schema_version":"2026-05-22","app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-06-30T10:00:00+09:00"},"step25c":{"completed_at":"2026-06-30T11:00:00+09:00"}},"approvals":{}}
J
C='{"app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-06-30T10:00:00+09:00"},"step25c":{"completed_at":"2026-06-30T11:00:00+09:00"},"step25d":{"decision":"approve"}},"approvals":{"patterns_human_approved":true}}'
run "scored + Write で 25d 承認 → ALLOW" "$(p Write content "$(jstr "$C")")" 0

# disk は scored だが、new content が step25b を 25c より新しく再導入 (再生成) + 承認 → new_unscored → BLOCK
C='{"app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-07-01T09:00:00+09:00"},"step25c":{"completed_at":"2026-06-30T11:00:00+09:00"},"step25d":{"decision":"approve"}},"approvals":{"patterns_human_approved":true}}'
run "scored disk + Write で 25b 再導入(25cより新)+承認 → BLOCK" "$(p Write content "$(jstr "$C")")" 2

# ── State R: 差し戻し→再生成の正規ループ (25d decision="revise" が残置された state) ──
cat > "$STATE" <<J
{"schema_version":"2026-05-22","app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-06-30T10:00:00+09:00"},"step25c":{"completed_at":"2026-06-30T11:00:00+09:00"},"step25d":{"decision":"revise","completed_at":"2026-06-30T12:00:00+09:00"}},"approvals":{}}
J
# 25b 再生成が Read→merge→Write back で revise 判定記録を carry-over したまま自己完了を記録 → ALLOW
# (旧実装はキー「存在」判定のためここで block され、差し戻し 1 回で進行が詰まった)
C='{"app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-07-01T09:00:00+09:00"},"step25c":{"completed_at":"2026-06-30T11:00:00+09:00"},"step25d":{"decision":"revise","completed_at":"2026-06-30T12:00:00+09:00"}},"approvals":{}}'
run "revise残置 + 25b 再生成の carry-over 書き戻し → ALLOW" "$(p Write content "$(jstr "$C")")" 0

# 同じ残置 state でも、未採点のまま decision を revise→approve に「値変更」する Write は BLOCK
C='{"app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-07-01T09:00:00+09:00"},"step25c":{"completed_at":"2026-06-30T11:00:00+09:00"},"step25d":{"decision":"approve","completed_at":"2026-06-30T12:00:00+09:00"}},"approvals":{}}'
run "revise残置 + 未採点のまま decision 値変更 (approve) → BLOCK" "$(p Write content "$(jstr "$C")")" 2

# ── State T: タイムゾーン表記混在 (+09:00 と Z) ──
cat > "$STATE" <<J
{"schema_version":"2026-05-22","app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-06-30T10:00:00+09:00"}},"approvals":{}}
J
# 25b=10:00+09:00 (=01:00Z)、25c=02:00Z (=11:00+09:00) → 25c の方が新しい = scored。
# 文字列比較だと "02:00:00Z" < "10:00:00+09:00" で unscored 誤判定 → 誤 BLOCK になる回帰ケース
C='{"app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-06-30T10:00:00+09:00"},"step25c":{"completed_at":"2026-06-30T02:00:00Z"},"step25d":{"decision":"approve"}},"approvals":{"patterns_human_approved":true}}'
run "TZ混在: 25c(Z表記)が実時刻で新しい + 承認 → ALLOW" "$(p Write content "$(jstr "$C")")" 0

# 25b=10:00+09:00 (=01:00Z)、25c=2026-06-29T20:00:00Z (=06-30 05:00+09:00) → 25c が古い = unscored → BLOCK
C='{"app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-06-30T10:00:00+09:00"},"step25c":{"completed_at":"2026-06-29T20:00:00Z"},"step25d":{"decision":"approve"}},"approvals":{"patterns_human_approved":true}}'
run "TZ混在: 25c(Z表記)が実時刻で古い + 承認 → BLOCK" "$(p Write content "$(jstr "$C")")" 2

# ── State C: 25b 未実施 (sub-state 生成前 / skip 選択) ──
cat > "$STATE" <<J
{"schema_version":"2026-05-22","app_name":"demoapp","screens":{},"approvals":{}}
J
C='{"app_name":"demoapp","approvals":{"final_approved":true}}'
run "25b 未実施 + Write → ALLOW" "$(p Write content "$(jstr "$C")")" 0

# batched-fresh 抜け穴 (Copilot 指摘): 現行 state が unscored でなくても、1 回の Write で
# step25b.completed_at と territory キーを同時導入する payload は BLOCK されなければならない。
C='{"app_name":"demoapp","screens":{"step25b":{"completed_at":"2026-07-01T10:00:00+09:00"},"step25d":{"decision":"approve"}},"approvals":{"patterns_human_approved":true}}'
run "現行 25b 未実施 + Write で 25b完了+承認 同時導入 → BLOCK" "$(p Write content "$(jstr "$C")")" 2

# batched-fresh の Edit 版: 1 回の Edit で 25b 完了と territory キーを同時導入 → BLOCK
# (旧実装は disk が unscored でないと Edit を検査せず素通りだった)
run "現行 25b 未実施 + Edit で 25b完了+承認 同時導入 → BLOCK" \
  "$(pe '"screens":{}' '"screens":{"step25b":{"completed_at":"2026-07-01T10:00:00+09:00"},"step25d":{"decision":"approve"}}')" 2

# ── 対象外ファイル ──
run "対象外ファイル (screens html) → ALLOW" '{"tool_name":"Write","tool_input":{"file_path":"'"$STATE_DIR"'/screens/web/x--empty.html","content":"<html></html>"}}' 0

rm -rf "$TMP" 2>/dev/null
echo "----------------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ] && { echo "ALL GREEN"; exit 0; } || exit 1
