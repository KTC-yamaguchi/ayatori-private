#!/bin/bash
# scripts/test-schema-light-check-verify-scope.sh
#
# .claude/hooks/schema-light-check.sh の R11 (reverse-verify/scope-manifest.json) 回帰テスト
# + R6 の reverse_verify 層拡張 (run_id / first_run_id 必須) の回帰テスト。
# R11: top-level 必須 field (app_name / run_id / created_at / target.description / scope) と
#      「scope が全て空なら通さない」契約。
# R6 拡張: phase == "reverse_verify" の entry に run 識別子 2 種が揃っていること
#      (欠けると prune / 破棄掃除 / ゲート提示の全フィルタから漏れ、resolve 経路が無くなる)。
#
# 使い方: bash scripts/test-schema-light-check-verify-scope.sh
# 依存: jq (無ければ hook が fail-open のためテストは skip 判定)

set -u
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_DIR/.claude/hooks/schema-light-check.sh"
TMP="$(mktemp -d 2>/dev/null || echo /tmp/ayatori-verifyscope-test.$$)"
TARGET="$TMP/artifacts/demoapp/reverse-verify/scope-manifest.json"
mkdir -p "$(dirname "$TARGET")"

command -v jq >/dev/null 2>&1 || { echo "jq 不在のためテスト skip (hook は fail-open)"; exit 0; }
[ -f "$HOOK" ] || { echo "FAIL: hook が見つからない: $HOOK"; exit 1; }

PASS=0; FAIL=0
run_at() { # $1=file_path  $2=desc  $3=content(JSON object)  $4=expected_exit
  local payload
  payload=$(jq -cn --arg f "$1" --arg c "$3" \
    '{tool_name:"Write",tool_input:{file_path:$f,content:$c}}')
  echo "$payload" | CLAUDE_PROJECT_DIR="$TMP" bash "$HOOK" >/dev/null 2>&1
  local ec=$?
  if [ "$ec" = "$4" ]; then echo "[PASS] exit=$ec — $2"; PASS=$((PASS+1));
  else echo "[FAIL] exit=$ec (want $4) — $2"; FAIL=$((FAIL+1)); fi
}
run() { # $1=desc  $2=content(JSON object)  $3=expected_exit
  run_at "$TARGET" "$1" "$2" "$3"
}

BASE_TARGET='{"description":"車両検索の絞り込み"}'
SECTION='{"doc":"05-features.md","section":"### F-03: 車両検索","feature_ids":["F-03"]}'

# ── 正常形 → ALLOW ──
run "必須 field 揃い + requirement_sections 1 件 → ALLOW" \
  "$(jq -cn --argjson t "$BASE_TARGET" --argjson s "$SECTION" \
    '{app_name:"demoapp",run_id:"2026-08-12-001",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{requirement_sections:[$s]}}')" 0
run "screens だけの範囲 (要件セクション 0 件) → ALLOW" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{requirement_sections:[],screens:[{slug:"03-search",spec_path:"screens/03-search.md"}]}}')" 0
run "code_modules だけの範囲 → ALLOW" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{code_modules:["be-python/app"]}}')" 0
run "縮退 run (docs 不在 / figma 不在) でも sources 併記で ALLOW" \
  "$(jq -cn --argjson t "$BASE_TARGET" --argjson s "$SECTION" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,sources:{code:{present:false},docs:{present:true},figma:{present:false}},scope:{requirement_sections:[$s]},zero_module_fallback:"docs_only"}')" 0
run "任意 field (jira_issue_key / keywords / code_estimate) 併記 → ALLOW" \
  "$(jq -cn --argjson s "$SECTION" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:{description:"検索",jira_issue_key:"ABC-123",keywords:["search","絞り込み"]},scope:{requirement_sections:[$s],code_estimate:{files:12,chars:40000,est_tokens:200000,shards:2}}}')" 0

# ── top-level 必須 field の欠落・空・型違反 → BLOCK ──
run "app_name 欠落 → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" --argjson s "$SECTION" \
    '{run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{requirement_sections:[$s]}}')" 2
run "app_name 空文字 → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" --argjson s "$SECTION" \
    '{app_name:"",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{requirement_sections:[$s]}}')" 2
run "run_id 欠落 (台帳 reconcile の絞り込みキーが無い) → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" --argjson s "$SECTION" \
    '{app_name:"demoapp",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{requirement_sections:[$s]}}')" 2
run "run_id が数値型 → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" --argjson s "$SECTION" \
    '{app_name:"demoapp",run_id:1,created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{requirement_sections:[$s]}}')" 2
run "created_at 欠落 → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" --argjson s "$SECTION" \
    '{app_name:"demoapp",run_id:"r1",target:$t,scope:{requirement_sections:[$s]}}')" 2
run "target 欠落 → BLOCK" \
  "$(jq -cn --argjson s "$SECTION" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",scope:{requirement_sections:[$s]}}')" 2
run "target.description 欠落 (対象が特定できない) → BLOCK" \
  "$(jq -cn --argjson s "$SECTION" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:{jira_issue_key:"ABC-123"},scope:{requirement_sections:[$s]}}')" 2
run "target.description 空文字 → BLOCK" \
  "$(jq -cn --argjson s "$SECTION" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:{description:""},scope:{requirement_sections:[$s]}}')" 2
run "target が配列 (型違反で jq を落とさない) → BLOCK" \
  "$(jq -cn --argjson s "$SECTION" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:[],scope:{requirement_sections:[$s]}}')" 2
run "scope 欠落 → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t}')" 2
run "scope が配列 (型違反) → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:[]}')" 2

# ── 空 scope → BLOCK (突合する対象が無い範囲は確定させない) ──
run "scope が空オブジェクト → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{}}')" 2
run "全リストが空配列 → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{requirement_sections:[],screens:[],ground_truth_docs:[],figma_frames:[],code_modules:[]}}')" 2
run "code_estimate だけ埋まっていて対象リストは空 → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{code_modules:[],code_estimate:{files:0,chars:0,est_tokens:0,shards:0}}}')" 2
run "リストが非配列型 (数え上げで jq を落とさない) → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{requirement_sections:"F-03"}}')" 2

# ── top-level が object でない (jq を落として R11 を無効化させない) → BLOCK ──
run "top-level が配列 → BLOCK" "$(jq -cn '[1,2]')" 2
run "top-level が文字列 → BLOCK" "$(jq -cn '"hello"')" 2
run "top-level が数値 → BLOCK" "$(jq -cn '123')" 2
run "top-level が null → BLOCK" "$(jq -cn 'null')" 2

# ── scope 要素の必須 field / 型 → BLOCK ──
run "requirement_sections の要素が空オブジェクト → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{requirement_sections:[{}]}}')" 2
run "requirement_sections に section 欠落 → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{requirement_sections:[{doc:"05-features.md"}]}}')" 2
run "screens に spec_path 欠落 → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{screens:[{slug:"03-search"}]}}')" 2
run "figma_frames に node_id 欠落 → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{figma_frames:[{file_key:"AbC123"}]}}')" 2
run "ground_truth_docs に空文字 → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{ground_truth_docs:[""]}}')" 2
run "requirement_sections の要素が文字列 (has() で jq を落とさない) → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{requirement_sections:["F-03"]}}')" 2
run "requirement_sections の要素が null → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{requirement_sections:[null]}}')" 2
run "screens の要素が文字列 → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{screens:["03-search"]}}')" 2
run "figma_frames の要素が文字列 → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{figma_frames:["1-23"]}}')" 2
run "code_modules に非 string 要素 → BLOCK" \
  "$(jq -cn --argjson t "$BASE_TARGET" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{code_modules:[{name:"x"}]}}')" 2
run "全リストの要素が正しく埋まっていれば ALLOW" \
  "$(jq -cn --argjson t "$BASE_TARGET" --argjson s "$SECTION" \
    '{app_name:"demoapp",run_id:"r1",created_at:"2026-08-12T10:00:00+09:00",target:$t,scope:{requirement_sections:[$s],screens:[{slug:"03-search",spec_path:"screens/03-search.md"}],ground_truth_docs:["cf-1-spec.md"],figma_frames:[{file_key:"AbC123",node_id:"1-23",slug:"home"}],code_modules:["be-python/app"]}}')" 0

# ── R6 拡張: reverse_verify entry の run 識別子 ──
DEV_TARGET="$TMP/artifacts/demoapp/requirement-deviations.json"
mkdir -p "$(dirname "$DEV_TARGET")"
dev_entry() { # $1=extra JSON object → entries 1 件の台帳 content
  jq -cn --argjson e "$1" \
    '{app_name:"demoapp",entries:[({phase:"reverse_verify",raised_by_step:"02-targeted-crosscheck",artifact:"requirements/05-features.md",element:"検索は部分一致",deviation_kind:"要件矛盾",detected_at:"2026-08-13T10:00:00+09:00"} + $e)]}'
}
run_at "$DEV_TARGET" "reverse_verify + run_id + first_run_id → ALLOW" \
  "$(dev_entry '{"run_id":"rv1","first_run_id":"rv1"}')" 0
run_at "$DEV_TARGET" "reverse_verify で run_id 欠落 → BLOCK" \
  "$(dev_entry '{"first_run_id":"rv1"}')" 2
run_at "$DEV_TARGET" "reverse_verify で first_run_id 欠落 (引き継ぎ判別不能) → BLOCK" \
  "$(dev_entry '{"run_id":"rv1"}')" 2
run_at "$DEV_TARGET" "reverse_verify で両方欠落 → BLOCK" \
  "$(dev_entry '{}')" 2
run_at "$DEV_TARGET" "他 phase (reverse) は run 識別子を要求しない → ALLOW" \
  "$(jq -cn '{app_name:"demoapp",entries:[{phase:"reverse",raised_by_step:"05-review-gate",artifact:"reverse-engineered/05-features.md",element:"バッジは介入群限定",deviation_kind:"根拠薄弱",detected_at:"2026-08-01T10:00:00+09:00"}]}')" 0
run_at "$DEV_TARGET" "resolved_at があるのに resolution 欠落 → BLOCK (既存 R6 の回帰)" \
  "$(dev_entry '{"run_id":"rv1","first_run_id":"rv1","resolved_at":"2026-08-13T11:00:00+09:00"}')" 2

# ── 他ファイルへの誤爆がないこと ──
run_at "$TMP/artifacts/demoapp/delta/scope-manifest.json" \
  "reverse-verify/ 配下でない同名ファイルは R11 対象外 → ALLOW" \
  "$(jq -cn '{unrelated:true}')" 0

echo
echo "R11 (scope-manifest.json) + R6 拡張 (reverse_verify run 識別子): PASS=$PASS FAIL=$FAIL"
rm -rf "$TMP"
[ "$FAIL" -eq 0 ] || exit 1
