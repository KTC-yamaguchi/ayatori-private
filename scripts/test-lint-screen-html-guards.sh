#!/bin/bash
# scripts/test-lint-screen-html-guards.sh
#
# .claude/hooks/lint-screen-html.sh の in-flight ガード窓の回帰テスト。
# 完成プロジェクトの画面 HTML Write が「手編集」として台帳 (delta/edited-screens.json) に
# 記録される / されないの境界を検証する:
#   - delta run の in-flight 窓は run 完了 (figma_approved_at or figma_status) まで閉じない
#     (screens_approved_at 後の Step 30 区間のパイプライン write を誤記録しない)
#   - cancelled run は窓を閉じる (記録再開)
#   - sub-state 派生ファイルは step25b.started_at 未記録でも生成計画進行中なら skip
#     (state-pattern-plan.json 存在 / skip 未選択 / completed_at・completed_at_states 未設定)
#   - skip 選択済みプロジェクト / sub-state 完了後の同ファイル編集は手編集として記録する
#   - dismissed 済み entry と同一 path への新規編集は entry を置換し dismissed_at が消える
#     (再編集は再び検知候補に戻る)
#   - web-sm platform dir の手編集も対象判定を通過し platform="web-sm" で記録する
#
# 使い方: bash scripts/test-lint-screen-html-guards.sh
# 依存: jq + node (無ければ hook が fail-open のためテストは skip 判定)

set -u
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_DIR/.claude/hooks/lint-screen-html.sh"
TMP="$(mktemp -d 2>/dev/null || echo /tmp/ayatori-lint-guard-test.$$)"
APP="$TMP/artifacts/demoapp"
STATE="$APP/pipeline-state.json"
LEDGER="$APP/delta/edited-screens.json"
mkdir -p "$APP/screens/web" "$APP/delta"

command -v jq >/dev/null 2>&1 || { echo "jq 不在のためテスト skip (hook は fail-open)"; exit 0; }
command -v node >/dev/null 2>&1 || { echo "node 不在のためテスト skip (hook は fail-open)"; exit 0; }
[ -f "$HOOK" ] || { echo "FAIL: hook が見つからない: $HOOK"; exit 1; }

PASS=0; FAIL=0

html() { # $1=path (app からの相対) — 最小の画面 HTML fixture を配置
  mkdir -p "$(dirname "$APP/$1")"
  printf '<!DOCTYPE html><html><head><style>:root{--color-bg:#fff}</style></head><body><div class="screen" style="background:var(--color-bg)">x</div></body></html>' > "$APP/$1"
}

invoke() { # $1=path (app からの相対)
  printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$APP/$1" \
    | CLAUDE_PROJECT_DIR="$REPO_DIR" bash "$HOOK" >/dev/null 2>&1
}

count() { jq -r '(.entries // []) | length' "$LEDGER" 2>/dev/null || echo 0; }

check() { # $1=desc  $2=expected_count
  local got; got=$(count)
  if [ "$got" = "$2" ]; then echo "[PASS] entries=$got — $1"; PASS=$((PASS+1));
  else echo "[FAIL] entries=$got (want $2) — $1"; FAIL=$((FAIL+1)); fi
}

reset_ledger() { rm -f "$LEDGER"; }

BASE='"schema_version":"2026-05-22","app_name":"demoapp"'
html "screens/web/home.html"
html "screens/web/home--empty.html"

# ── delta 窓: run 進行中 (承認前) → skip (従来動作の維持) ──
reset_ledger
cat > "$STATE" <<J
{$BASE,"approvals":{"final_approved":true},"delta":{"runs":[{"run_id":"r1","initiated_at":"2026-01-01T00:00:00Z"}]}}
J
invoke "screens/web/home.html"
check "run 進行中 (承認前) の write は記録しない" 0

# ── delta 窓: screens_approved_at 後・figma 未完 (Step 30 区間) → skip (窓の拡張) ──
reset_ledger
cat > "$STATE" <<J
{$BASE,"approvals":{"final_approved":true},"delta":{"runs":[{"run_id":"r1","initiated_at":"2026-01-01T00:00:00Z","screens_approved_at":"2026-01-01T01:00:00Z"}]}}
J
invoke "screens/web/home.html"
check "Step 30 区間 (screens_approved_at 後・figma 未完) は記録しない" 0

# ── delta 窓: figma_status set (stub 完了) → 記録再開 ──
reset_ledger
cat > "$STATE" <<J
{$BASE,"approvals":{"final_approved":true},"delta":{"runs":[{"run_id":"r1","initiated_at":"2026-01-01T00:00:00Z","screens_approved_at":"2026-01-01T01:00:00Z","figma_status":"skipped_stub_mode"}]}}
J
invoke "screens/web/home.html"
check "run 完了 (figma_status) 後の write は記録する" 1

# ── delta 窓: figma_approved_at set → 記録再開 ──
reset_ledger
cat > "$STATE" <<J
{$BASE,"approvals":{"final_approved":true},"delta":{"runs":[{"run_id":"r1","initiated_at":"2026-01-01T00:00:00Z","screens_approved_at":"2026-01-01T01:00:00Z","figma_approved_at":"2026-01-01T02:00:00Z"}]}}
J
invoke "screens/web/home.html"
check "run 完了 (figma_approved_at) 後の write は記録する" 1

# ── delta 窓: cancelled run → 記録再開 ──
reset_ledger
cat > "$STATE" <<J
{$BASE,"approvals":{"final_approved":true},"delta":{"runs":[{"run_id":"r1","initiated_at":"2026-01-01T00:00:00Z","cancelled_at":"2026-01-01T01:00:00Z","cancel_reason":"user_abort"}]}}
J
invoke "screens/web/home.html"
check "cancelled run の後の write は記録する" 1

# ── sub-state fallback: started_at 未記録でも計画進行中の派生ファイル write は skip ──
reset_ledger
echo '{"app_name":"demoapp","patterns":[]}' > "$APP/screens/state-pattern-plan.json"
cat > "$STATE" <<J
{$BASE,"approvals":{"final_approved":true},"screens":{}}
J
invoke "screens/web/home--empty.html"
check "25b started_at 未記録 + 計画進行中の sub-state write は記録しない (fallback)" 0

# ── sub-state fallback: 同状態でも main ファイルは記録する ──
reset_ledger
invoke "screens/web/home.html"
check "fallback 状態でも main 画面の write は記録する" 1

# ── sub-state: skip 選択済みプロジェクトでは手編集として記録する ──
reset_ledger
cat > "$STATE" <<J
{$BASE,"approvals":{"final_approved":true},"screens":{"state_pattern_skipped":true}}
J
invoke "screens/web/home--empty.html"
check "skip 選択済みプロジェクトの sub-state write は記録する" 1

# ── sub-state: 完全完了 (completed_at_states) 後は手編集として記録する ──
reset_ledger
cat > "$STATE" <<J
{$BASE,"approvals":{"final_approved":true,"completed_at_states":"2026-01-01T03:00:00Z"},"screens":{}}
J
invoke "screens/web/home--empty.html"
check "completed_at_states 後の sub-state write は記録する" 1

# ── dismissed entry の再編集: entry が置換され dismissed_at が消える ──
reset_ledger
rm -f "$APP/screens/state-pattern-plan.json"
cat > "$STATE" <<J
{$BASE,"approvals":{"final_approved":true}}
J
cat > "$LEDGER" <<J
{"schema_version":"2026-06-18","app_name":"demoapp","entries":[{"screen":"home","platform":"web","path":"screens/web/home.html","edited_at":"2026-01-01T00:00:00Z","tool":"Edit","consumed_by_run":null,"dismissed_at":"2026-01-01T01:00:00Z"}]}
J
invoke "screens/web/home.html"
GOT_COUNT=$(count)
GOT_DISMISSED=$(jq -r '.entries[0].dismissed_at // "absent"' "$LEDGER" 2>/dev/null)
if [ "$GOT_COUNT" = "1" ] && [ "$GOT_DISMISSED" = "absent" ]; then
  echo "[PASS] entries=1 / dismissed_at 消滅 — dismissed entry の再編集は候補に戻る"; PASS=$((PASS+1))
else
  echo "[FAIL] entries=$GOT_COUNT / dismissed_at=$GOT_DISMISSED — dismissed entry の再編集は候補に戻る"; FAIL=$((FAIL+1))
fi

# ── web-sm platform dir: 完成後の手編集は platform="web-sm" で記録する ──
reset_ledger
html "screens/web-sm/home.html"
cat > "$STATE" <<J
{$BASE,"approvals":{"final_approved":true}}
J
invoke "screens/web-sm/home.html"
GOT_COUNT=$(count)
GOT_PLATFORM=$(jq -r '.entries[0].platform // "absent"' "$LEDGER" 2>/dev/null)
if [ "$GOT_COUNT" = "1" ] && [ "$GOT_PLATFORM" = "web-sm" ]; then
  echo "[PASS] entries=1 / platform=web-sm — web-sm 画面の手編集は対象判定を通過し正しい platform で記録"; PASS=$((PASS+1))
else
  echo "[FAIL] entries=$GOT_COUNT / platform=$GOT_PLATFORM (want 1 / web-sm) — web-sm 画面の手編集は対象判定を通過し正しい platform で記録"; FAIL=$((FAIL+1))
fi

rm -rf "$TMP" 2>/dev/null
echo "----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] || exit 1
exit 0
