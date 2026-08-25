#!/bin/bash
# ============================================================
# AYATORI Setup Script （暫定版 / Phase 2 スコープ）
# ============================================================
# Phase 2（Step 08〜11 デザインブレスト）は
# AYATORI 内部で完結するため、現時点で必須の外部プラグインはありません。
#
# 本スクリプトは将来プラグインを追加する際の受け皿として残置しています。
# PLUGINS 配列に追加するだけで一括インストールが可能です。
#
# 暫定版の理由:
# - 本スクリプトは Phase 2 のスコープに限定しています。
# - Phase 3（画面デザイン生成）以降で必要な Figma プラグインは
#   本スクリプトに含めていません。README の従来手順に従ってください。
# - Phase 2 完了後、他 Phase との統合タイミングで
#   インストール対象を全 Phase 分に拡張する想定です。
# ============================================================

set -e

# インストール対象プラグイン（現時点では空。追加時はここに記載）
PLUGINS=()

echo "============================================================"
echo "AYATORI Setup (暫定版 / Phase 2)"
echo "============================================================"
echo ""

# claude CLI の存在確認
if ! command -v claude >/dev/null 2>&1; then
  echo "Error: 'claude' コマンドが見つかりません。"
  echo "Claude Code CLI をインストールしてから再実行してください。"
  echo "  https://docs.anthropic.com/claude-code"
  exit 1
fi

echo "[1/2] Claude Code CLI 確認 OK (version: $(claude --version 2>/dev/null || echo 'unknown'))"
echo ""

if [ ${#PLUGINS[@]} -eq 0 ]; then
  echo "[2/2] 必須プラグインはありません（Step 08〜11 は AYATORI 内部完結）。"
else
  echo "[2/2] プラグインを順次インストールします..."
  for plugin in "${PLUGINS[@]}"; do
    echo "  -> Installing $plugin"
    claude plugin install "$plugin"
  done
fi

echo ""
echo "============================================================"
echo "セットアップ完了（暫定版）"
echo "============================================================"
echo ""
echo "次の手順:"
echo "  1. claude を起動"
echo "  2. /ayatori-design コマンドで Phase 2 を実行"
echo ""
echo "注意: 本スクリプトは Phase 2 スコープの暫定版です。"
echo "      Figma MCP を使う場合は README の手動手順も実行してください。"
