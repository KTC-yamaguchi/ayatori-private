#!/bin/bash
# scripts/test-schema-light-check-reverse-prov.sh
#
# .claude/hooks/schema-light-check.sh の R8 (reverse-provenance.json) 回帰テスト。
# provenance enum {source_backed, doc_backed, figma_backed, derived, inferred} と
# 根拠あり 3 種の種類別 source_ref 文法 (code=input-sources file:line /
# doc=ground-truth/{file}.md:line / figma=ground-truth/figma/ 配下) を検証する。
#
# 使い方: bash scripts/test-schema-light-check-reverse-prov.sh
# 依存: jq (無ければ hook が fail-open のためテストは skip 判定)

set -u
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_DIR/.claude/hooks/schema-light-check.sh"
TMP="$(mktemp -d 2>/dev/null || echo /tmp/ayatori-revprov-test.$$)"
TARGET="$TMP/artifacts/demoapp/reverse-engineered/reverse-provenance.json"
mkdir -p "$(dirname "$TARGET")"

command -v jq >/dev/null 2>&1 || { echo "jq 不在のためテスト skip (hook は fail-open)"; exit 0; }
[ -f "$HOOK" ] || { echo "FAIL: hook が見つからない: $HOOK"; exit 1; }

PASS=0; FAIL=0
run() { # $1=desc  $2=specific(JSON object)  $3=expected_exit
  local content payload
  content=$(jq -cn --argjson s "$2" '{app_name:"demoapp",specifics:[$s]}')
  payload=$(jq -cn --arg f "$TARGET" --arg c "$content" \
    '{tool_name:"Write",tool_input:{file_path:$f,content:$c}}')
  echo "$payload" | CLAUDE_PROJECT_DIR="$TMP" bash "$HOOK" >/dev/null 2>&1
  local ec=$?
  if [ "$ec" = "$3" ]; then echo "[PASS] exit=$ec — $1"; PASS=$((PASS+1));
  else echo "[FAIL] exit=$ec (want $3) — $1"; FAIL=$((FAIL+1)); fi
}

# ── 根拠あり 3 種 × 正しい文法 → ALLOW ──
run "source_backed + input-sources file:line → ALLOW" \
  '{"ref":"F-01.badge","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"source_backed","source_ref":"input-sources/be-python/app/badge.py:142"}' 0
run "source_backed + 行範囲 :10-20 → ALLOW" \
  '{"ref":"F-02.range","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"source_backed","source_ref":"input-sources/kmp/shared/Foo.kt:10-20"}' 0
run "doc_backed + ground-truth md:line → ALLOW" \
  '{"ref":"F-03.docclaim","value":"x","artifact":"reverse-engineered/04-use-cases.md","provenance":"doc_backed","source_ref":"ground-truth/spec-page.md:33"}' 0
run "figma_backed + design-context.md:line → ALLOW" \
  '{"ref":"SCR-01.layout","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"figma_backed","source_ref":"ground-truth/figma/AbC123/1-23--home.design-context.md:12"}' 0
run "figma_backed + png (行アンカーなし) → ALLOW" \
  '{"ref":"SCR-02.visual","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"figma_backed","source_ref":"ground-truth/figma/AbC123/1-24--detail.png"}' 0
run "figma_backed + variables.json:line (デザイントークン値) → ALLOW" \
  '{"ref":"NFR.primary_color","value":"#2D6A4F","artifact":"reverse-engineered/06-non-functional.md","provenance":"figma_backed","source_ref":"ground-truth/figma/AbC123/variables.json:2"}' 0

# ── derived / inferred ──
run "derived + derived_from → ALLOW" \
  '{"ref":"F-04.calc","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"derived","derived_from":"F-01"}' 0
run "inferred + source_ref なし → ALLOW" \
  '{"ref":"F-05.guess","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"inferred"}' 0

# ── 種類と文法の不一致 → BLOCK ──
run "source_backed に ground-truth ref (文書根拠をコード根拠と申告) → BLOCK" \
  '{"ref":"F-06.mislabel","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"source_backed","source_ref":"ground-truth/spec-page.md:33"}' 2
run "doc_backed に input-sources ref → BLOCK" \
  '{"ref":"F-07.mislabel","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"doc_backed","source_ref":"input-sources/kmp/Foo.kt:10"}' 2
run "figma_backed に input-sources ref → BLOCK" \
  '{"ref":"F-08.mislabel","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"figma_backed","source_ref":"input-sources/kmp/Foo.kt:10"}' 2
run "doc_backed に figma/ 配下 ref (root 直下限定違反) → BLOCK" \
  '{"ref":"F-09.wrongdir","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"doc_backed","source_ref":"ground-truth/figma/AbC123/x.design-context.md:5"}' 2

# ── 欠落 / 書式違反 → BLOCK ──
run "doc_backed で :line 欠落 → BLOCK" \
  '{"ref":"F-10.noline","value":"x","artifact":"reverse-engineered/04-use-cases.md","provenance":"doc_backed","source_ref":"ground-truth/spec-page.md"}' 2
run "figma_backed でテキスト ref に :line 欠落 → BLOCK" \
  '{"ref":"F-11.noline","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"figma_backed","source_ref":"ground-truth/figma/AbC123/1-23--home.design-context.md"}' 2
run "figma_backed で source_ref null → BLOCK" \
  '{"ref":"F-12.null","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"figma_backed","source_ref":null}' 2
run "figma_backed + variables.json で :line 欠落 → BLOCK" \
  '{"ref":"NFR.noline","value":"x","artifact":"reverse-engineered/06-non-functional.md","provenance":"figma_backed","source_ref":"ground-truth/figma/AbC123/variables.json"}' 2
run "doc_backed で source_ref 欠落 → BLOCK" \
  '{"ref":"F-13.missing","value":"x","artifact":"reverse-engineered/04-use-cases.md","provenance":"doc_backed"}' 2

# ── enum / 既存ルールの回帰 ──
run "未知の provenance 値 → BLOCK" \
  '{"ref":"F-14.badenum","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"screenshot_backed","source_ref":"ground-truth/figma/AbC123/x.png"}' 2
run "source_backed で source_ref 欠落 (既存回帰) → BLOCK" \
  '{"ref":"F-15.missing","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"source_backed"}' 2
run "derived で derived_from 欠落 (既存回帰) → BLOCK" \
  '{"ref":"F-16.noderive","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"derived"}' 2
run "ref 文法違反 (既存回帰) → BLOCK" \
  '{"ref":"1bad ref!","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"inferred"}' 2
run "ref に非 ASCII (日本語セグメント) → BLOCK" \
  '{"ref":"F-01.スポット詳細","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"inferred"}' 2

# ── 型 guard: string 以外は jq の test() を error にして R8 を丸ごと無効化しうる (kill switch)。
#    型違い自体を違反として検出できていることを固定する ──
run "source_ref が数値 (kill switch) → BLOCK" \
  '{"ref":"F-17.numref","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"source_backed","source_ref":5}' 2
run "source_ref が配列 → BLOCK" \
  '{"ref":"F-18.arrref","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"doc_backed","source_ref":["ground-truth/a.md:1"]}' 2
run "ref が数値 → BLOCK" \
  '{"ref":123,"value":"x","artifact":"reverse-engineered/05-features.md","provenance":"inferred"}' 2
run "derived_from が数値 → BLOCK" \
  '{"ref":"F-19.numderive","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"derived","derived_from":7}' 2

# ── 上位ディレクトリ脱出: 証拠の種類と文法の一致という R8 の目的自体を迂回する ──
run "source_ref に .. 脱出 (code) → BLOCK" \
  '{"ref":"F-20.esc","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"source_backed","source_ref":"input-sources/../../../etc/passwd:1"}' 2
run "source_ref に .. 脱出 (figma) → BLOCK" \
  '{"ref":"F-21.esc","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"figma_backed","source_ref":"ground-truth/figma/../../secret.png"}' 2
run "source_ref に .. 脱出 (doc) → BLOCK" \
  '{"ref":"F-22.esc","value":"x","artifact":"reverse-engineered/04-use-cases.md","provenance":"doc_backed","source_ref":"ground-truth/../../elsewhere.md:1"}' 2

# ── specifics[] は全件検査される (先頭が正しくても後続の違反を見逃さない) ──
multi() { # $1=desc $2=specifics(JSON array) $3=expected_exit
  local content payload
  content=$(jq -cn --argjson s "$2" '{app_name:"demoapp",specifics:$s}')
  payload=$(jq -cn --arg f "$TARGET" --arg c "$content" \
    '{tool_name:"Write",tool_input:{file_path:$f,content:$c}}')
  echo "$payload" | CLAUDE_PROJECT_DIR="$TMP" bash "$HOOK" >/dev/null 2>&1
  local ec=$?
  if [ "$ec" = "$3" ]; then echo "[PASS] exit=$ec — $1"; PASS=$((PASS+1));
  else echo "[FAIL] exit=$ec (want $3) — $1"; FAIL=$((FAIL+1)); fi
}
multi "2 件目だけ違反 → BLOCK" \
  '[{"ref":"F-23.ok","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"inferred"},
    {"ref":"F-24.bad","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"source_backed"}]' 2
multi "全件正しい → ALLOW" \
  '[{"ref":"F-25.ok","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"inferred"},
    {"ref":"F-26.ok","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"figma_backed","source_ref":"ground-truth/figma/K/1-2--s.design-context.md:3"}]' 0

# ── 構造レベルの型 guard: 非 object 要素 / 非配列 specifics は has() で jq ごと error になり
#    R8 がファイル単位で無効化される (kill switch) — 型違い自体を違反として検出することを固定する ──
multi "非 object 要素が混入 (同じ write 内の明確な違反ごと素通りしない) → BLOCK" \
  '["junk", {"ref":"F-28.bad","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"source_backed"}]' 2
multi "非 object 要素単独 (他は全件正しい) → BLOCK" \
  '[{"ref":"F-29.ok","value":"x","artifact":"reverse-engineered/05-features.md","provenance":"inferred"}, "junk"]' 2
multi "specifics が配列でない (文字列) → BLOCK" \
  '"not-an-array"' 2

# ── stderr に規則 ID と件数が出る (BLOCK が過度に広い正規表現に置き換わっても気付けるように) ──
stderr_check() {
  local content payload out
  content=$(jq -cn '{app_name:"demoapp",specifics:[{ref:"F-27.bad",value:"x",artifact:"reverse-engineered/05-features.md",provenance:"source_backed"}]}')
  payload=$(jq -cn --arg f "$TARGET" --arg c "$content" \
    '{tool_name:"Write",tool_input:{file_path:$f,content:$c}}')
  out=$(echo "$payload" | CLAUDE_PROJECT_DIR="$TMP" bash "$HOOK" 2>&1 >/dev/null)
  if echo "$out" | grep -q 'R8' && echo "$out" | grep -q '1 件'; then
    echo "[PASS] stderr に R8 と違反件数が出る"; PASS=$((PASS+1));
  else echo "[FAIL] stderr が期待形式でない: $out"; FAIL=$((FAIL+1)); fi
}
stderr_check

echo ""
echo "PASS=$PASS FAIL=$FAIL"
rm -rf "$TMP"
[ "$FAIL" = "0" ] || exit 1
exit 0
