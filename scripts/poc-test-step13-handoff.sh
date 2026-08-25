#!/bin/bash
# ============================================================
# Step 13 引き継ぎ E2E テストヘルパー (Phase 2 → Phase 3 引き継ぎ検証)
# ============================================================
#
# 本スクリプトは Claude Code 内で実際に `/ayatori-design` / `/ayatori-screens` を
# 走らせる必要がある「セッション間 propagation」テスト用の **artifact 状態を
# セットアップする補助ツール** です。テスト本体 (Claude Code セッション) は
# 別途人手で起動してください。
#
# 提供する 4 シナリオ:
#   T1:   clean greenfield  — Phase 2 承認 → 新セッションで Phase 3 起動 (success path)
#   T1.5: Skill 13 自体検証 — step13 unset の状態で Skill 13 のみ再走 → Skill 13 が
#                              safety-net に頼らず自力で write することを確認
#                              (root cause fix 検証)
#   T2:   step13 unset      — pipeline-state から step13_approved_at を消し
#                              Phase 2 Completion safety-net を発火させる
#   T3:   brainstorm restart — 旧 session-handoff.md / design-brief 等を残し
#                              Step 13 で「ブレストやり直し」を選んだ状態を再現
#
# Usage:
#   bash scripts/poc-test-step13-handoff.sh <app_name> <scenario>
#   bash scripts/poc-test-step13-handoff.sh <app_name> restore
#
#   scenario: T1 | T1.5 | T2 | T3 | inspect | restore
# ============================================================

set -e

APP_NAME="${1:-}"
SCENARIO="${2:-inspect}"

if [ -z "$APP_NAME" ]; then
  echo "Usage: $0 <app_name> <T1|T1.5|T2|T3|inspect|restore>"
  exit 1
fi

ART_DIR="artifacts/${APP_NAME}"
BACKUP_DIR="artifacts/${APP_NAME}.backup-poc155"

if [ ! -d "$ART_DIR" ]; then
  echo "❌ artifacts/${APP_NAME}/ が存在しません。"
  exit 1
fi

backup() {
  if [ ! -d "$BACKUP_DIR" ]; then
    cp -r "$ART_DIR" "$BACKUP_DIR"
    echo "💾 backup → $BACKUP_DIR"
  else
    echo "↩  既存の backup を保持: $BACKUP_DIR"
  fi
}

case "$SCENARIO" in
  inspect)
    inspect_field() {
      local file="$1" path="$2" default="$3"
      if [ ! -f "$file" ]; then
        echo "(file missing)"
      else
        jq -r "${path} // \"${default}\"" "$file" 2>/dev/null || echo "(jq error)"
      fi
    }
    echo "── State inspection for ${APP_NAME} ──"
    echo "* requirements.json.status   : $(inspect_field "$ART_DIR/requirements.json"   '.status'                       '(unset)')"
    echo "* approvals.step07_approved  : $(inspect_field "$ART_DIR/pipeline-state.json" '.approvals.step07_approved_at' '(unset)')"
    echo "* approvals.step13_approved  : $(inspect_field "$ART_DIR/pipeline-state.json" '.approvals.step13_approved_at' '(unset)')"
    echo "* session-handoff.md exists  : $([ -f "$ART_DIR/session-handoff.md" ] && echo yes || echo no)"
    echo "* design-brief.yaml exists   : $([ -f "$ART_DIR/design-brief.yaml" ] && echo yes || echo no)"
    ;;

  T1)
    backup
    # T1: Phase 2 がきれいに完了した直後を再現 (step13 set, session-handoff 存在)
    # → 新セッションで `/ayatori-screens` を実行し Phase 3 が起動できるか確認
    echo "── T1: clean greenfield post-Phase 2 ──"
    echo "前提: pipeline-state に step13_approved_at が既に書かれていること。"
    echo "Action: 何も書き換えません (現状を確認するだけ)。"
    echo ""
    echo "実行手順:"
    echo "  1. 新しい Claude Code 会話で  /ayatori-screens"
    echo "  2. Phase 3 が「Phase 2 未完了」エラーを出さず、Step 14 から開始すれば PASS"
    ;;

  T1.5)
    backup
    echo "── T1.5: Skill 13 自体の write 動作検証 (safety-net 非依存) ──"
    if [ ! -f "$ART_DIR/pipeline-state.json" ]; then
      echo "❌ pipeline-state.json が無い。先に Phase 2 完了が必要。"
      exit 1
    fi
    tmp=$(mktemp)
    jq 'del(.approvals.step13_approved_at)' "$ART_DIR/pipeline-state.json" > "$tmp"
    mv "$tmp" "$ART_DIR/pipeline-state.json"
    echo "✏  pipeline-state.json から approvals.step13_approved_at を削除しました。"
    echo ""
    echo "目的: root cause fix (Skill 13 構造化) が"
    echo "       safety-net に頼らず単独で機能することを確認する。"
    echo ""
    echo "実行手順:"
    echo "  1. 新しい Claude Code 会話で  /ayatori-design"
    echo "  2. Preamble は step13_approved_at 未設定を検出 → Step 13 から resume"
    echo "  3. Skill 13 を承認 (Phase 2 Completion へ進む直前で **手動でセッション中断**)"
    echo "     ※ Completion の safety-net が走る前に止める。Step 13 の Step 3 完了報告が"
    echo "        画面に出た直後が中断ポイント。"
    echo "  4. 状態確認:"
    echo "     bash $0 $APP_NAME inspect"
    echo "  5. approvals.step13_approved : <ISO 8601> ならば → Skill 13 が独力で書いた = PASS"
    echo "     (unset) ならば → Skill 13 の write が走っていない = FAIL (バグ再発)"
    ;;

  T2)
    backup
    echo "── T2: step13_approved_at unset (safety-net 発火) ──"
    if [ ! -f "$ART_DIR/pipeline-state.json" ]; then
      echo "❌ pipeline-state.json が無い。先に Phase 2 完了が必要。"
      exit 1
    fi
    tmp=$(mktemp)
    jq 'del(.approvals.step13_approved_at)' "$ART_DIR/pipeline-state.json" > "$tmp"
    mv "$tmp" "$ART_DIR/pipeline-state.json"
    echo "✏  pipeline-state.json から approvals.step13_approved_at を削除しました。"
    echo ""
    echo "実行手順:"
    echo "  1. 新しい Claude Code 会話で  /ayatori-design"
    echo "  2. Skill 13 が再起動 → 承認"
    echo "  3. Phase 2 Completion の safety-net が step13_approved_at を補完するか:"
    echo "     bash $0 $APP_NAME inspect"
    echo "  4. 引き続き  /ayatori-screens  が起動できれば PASS"
    ;;

  T3)
    backup
    echo "── T3: ブレスト再実行時の旧 handoff cleanup 検証 ──"
    # 旧 session-handoff.md を意図的に古い日付で残す
    cat > "$ART_DIR/session-handoff.md" <<EOF
---
app_name: ${APP_NAME}
phase_completed: "2-design"
completed_at: "2024-12-31T00:00:00+09:00"
artifacts_ready:
  - design-brief.yaml
  - tokens.json
next_phase: screens
next_command: /ayatori-screens
---
# DO NOT USE AS EXECUTION STATE — see pipeline-state.json + requirements.json.
[STALE — POC test fixture for T3]
EOF
    echo "✏  古い session-handoff.md を fixture として配置しました。"
    echo ""
    echo "実行手順:"
    echo "  1. 新しい Claude Code 会話で  /ayatori-design"
    echo "  2. Step 13 のゲートで「ブレストからやり直す」を選択"
    echo "  3. Skill 13 が session-handoff.md を **無条件削除** することを確認:"
    echo "     bash $0 $APP_NAME inspect   → session-handoff.md exists: no"
    echo "  4. pipeline-state.json の他 approvals (step07_approved_at 等) が **保持** されていれば PASS"
    ;;

  restore)
    if [ ! -d "$BACKUP_DIR" ]; then
      echo "❌ backup が見つかりません: $BACKUP_DIR"
      exit 1
    fi
    # NOTE: backup を保持したまま復元 (cp -r)。再テスト時の二重 backup を回避するため
    #       backup を消さない選択。明示的に消したい場合は手動で:
    #           rm -rf "$BACKUP_DIR"
    rm -rf "$ART_DIR"
    cp -r "$BACKUP_DIR" "$ART_DIR"
    echo "♻  $ART_DIR を backup から復元しました (backup は保持: $BACKUP_DIR)。"
    ;;

  *)
    echo "Unknown scenario: $SCENARIO (use T1|T1.5|T2|T3|inspect|restore)"
    exit 1
    ;;
esac
