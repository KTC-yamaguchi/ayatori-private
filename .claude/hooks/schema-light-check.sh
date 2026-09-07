#!/bin/bash
# .claude/hooks/schema-light-check.sh
#
# artifact 書き込み前の最小 schema 検証 (L4 hook)。
# pipeline.yaml constraints[P4-06] の machine enforcement。
#
# 機能:
#   - Write / Edit の stdin JSON を受領
#   - artifacts/{app_name}/pending-questions.json / requirement-deviations.json
#     の必須 field を jq で検証
#   - 違反検出時 exit 2 + stderr (Claude が読んで修正 / pending-questions.json
#     に push)
#
# 検証ルール (CLAUDE.md Operating Principle 4 Rule 1-6 と整合):
#   - R3: pending-questions.json の entries[] で target / question / raised_by_step / raised_at 必須
#   - R5b: pending-questions.json の entries[].target が dot/bracket 正式文法に従う
#   - R6: requirement-deviations.json の entries[] 必須 field + resolved_at→resolution 整合 (output 側)
#     + phase == "reverse_verify" の entry は run_id / first_run_id を必須 (run 単位 reconcile 層の
#      識別子。欠けると prune / 破棄掃除 / ゲート提示の全フィルタから漏れ、resolve 経路の無い
#      永久未解決になる)
#   - R7: generation-provenance.json の specifics[] 必須 field + provenance enum + derived→derived_from 整合 (F-3a)
#   - R8: reverse-provenance.json の specifics[] 必須 field + provenance enum + 根拠あり 3 種 (source_backed/doc_backed/figma_backed)→種類別 source_ref 文法 / derived→derived_from 整合
#   - R9: graphics/graphic-plan.json の top-level 必須 field + slots[] 必須 field + enum/pattern
#     (F-2、graphic-generation-design.md §10 の「検証対象へ新 schema を追加」)
#     + taste キー存在時の必須 field / enum / optional array 型 (writer の 21c F-3 が所有。
#      未知キー検出は schema 追加で hook が lockstep 必須になるため持たない — R3-R8 と同じ required-only 方針)
#   - R10: graphics/graphic-prompts.json の top-level 必須 field + prompts[] 必須 field / 型 / pattern
#     + graphic_id 重複禁止 (writer の F-4 (21d) が所有。schema では配列内 uniqueness を表現
#      できないため hook で enforce する — commit-prompts.mjs の書き込み前チェックとの二層)
#   - R11: reverse-verify/scope-manifest.json の top-level 必須 field + target.description +
#     scope が空でないこと (対象限定突合の確定範囲。空 scope は『突合したが差が無かった』と
#      『何も見ていない』を区別できなくするため schema では表現しきれない契約を hook で塞ぐ)
#
# 本 hook は唯一の hard barrier (schema 自動検証は走らない) なので target の dot/bracket 正式文法を jq でミラーして write 時に
# enforce する。
#
# 依存: bash + jq (主検証)。Edit 経路の literal 再構成のみ node を使う (build-tokens と同じ既存 Node 依存。
# node 不在時は当該 Edit の検証を fail-open skip)。いずれの外部ツール不在でも exit 0 で素通り。
#
# Fail-open 設計 (5 名レビュー C2 / C7 対応):
#   - jq 不在 / JSON parse 失敗 / 想定外エラーは exit 0 (continue) で素通り
#   - block するのは「明確に違反を検出した」場合のみ
#   - false positive で全 Write を止めない
#
# Sunset condition (PR description 参照):
#   - Opus 4.8 / 5.x で hallucination rate 1/2 改善 → 本 hook 撤去候補
#   - 2026-Q4 まで Pattern D が 5 件未満 → 本 hook 撤去候補

set +e  # fail-open

# watchdog 廃止の経緯 (公式 spec reviewer 指摘):
# 旧版で sleep 8 + kill -TERM $$ の self-bail watchdog を実装していたが、
# Claude Code v2.1.139+ で macOS の controlling terminal 構造が変更され、
# settings.json の `timeout` field が単独で正しく動作するようになったため削除。
# 現在は .claude/settings.json:36 の `"timeout": 8000` (ms) のみに依存する。

# ── jq 不在チェック (fail-open) ──
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

PAYLOAD=$(cat)
[ -z "$PAYLOAD" ] && exit 0

# ── tool name と file_path 取得 ──
TOOL_NAME=$(echo "$PAYLOAD" | jq -r '.tool_name // "unknown"' 2>/dev/null)
FILE_PATH=$(echo "$PAYLOAD" | jq -r '.tool_input.file_path // ""' 2>/dev/null)

# Write / Edit 以外は素通り
[ "$TOOL_NAME" != "Write" ] && [ "$TOOL_NAME" != "Edit" ] && exit 0
[ -z "$FILE_PATH" ] && exit 0

# user input ファイル (artifacts/{app}/input-sources/) は scan しない
# H-2 (P1): substring 一致を anchor して artifacts 配下に限定
# (`artifacts/myapp/data/input-sources-report.json` のような偽陽性誤一致を防ぐ)
echo "$FILE_PATH" | grep -qE '(^|/)artifacts/[^/]+/input-sources/' && exit 0

# artifacts/{app_name}/*.json のみ対象
echo "$FILE_PATH" | grep -qE '(^|/)artifacts/[^/]+/.*\.json$' || exit 0

# H-1 (P1): Edit 経路の bypass 対策
# Write は content (JSON 全体)、Edit は new_string (partial JSON 文字列 = parse 不能)
# Edit の場合は file 現物を Read してマージ後 JSON を validate する
if [ "$TOOL_NAME" = "Edit" ]; then
  # ファイルが存在しない (= 新規作成相当) なら素通り (Write hook で検証される想定)
  [ ! -f "$FILE_PATH" ] && exit 0
  OLD_STR=$(echo "$PAYLOAD" | jq -r '.tool_input.old_string // ""' 2>/dev/null)
  NEW_STR=$(echo "$PAYLOAD" | jq -r '.tool_input.new_string // ""' 2>/dev/null)
  REPLACE_ALL=$(echo "$PAYLOAD" | jq -r '.tool_input.replace_all // false' 2>/dev/null)
  # 既存ファイル全文を **literal** 置換して post-Edit の JSON 全体を CONTENT に詰める。
  # 旧版は awk gsub/sub を使っていたが 3 つの footgun があった (セルフレビュー P0):
  #   (a) old_string が正規表現扱い → メタ文字 (. [ ] * 等、JSON/CSS の target 値に頻出) で誤マッチ
  #   (b) new_string の & が「マッチ全体」に特殊展開される
  #   (c) 行単位処理のため複数行 old_string が一致しない
  # node の indexOf / split+join で完全 literal 置換に修正 (Edit の literal セマンティクスと一致)。
  # node 不在時は CONTENT 空 → 下の `[ -z "$CONTENT" ] && exit 0` で素通り (fail-open、jq 不在と同扱い)。
  if command -v node >/dev/null 2>&1; then
    CONTENT=$(OLD="$OLD_STR" NEW="$NEW_STR" RA="$REPLACE_ALL" FP="$FILE_PATH" node -e '
      const fs = require("fs");
      const c = fs.readFileSync(process.env.FP, "utf8");
      const o = process.env.OLD, n = process.env.NEW;
      let out;
      if (o === "") out = c;
      else if (process.env.RA === "true") out = c.split(o).join(n);
      else { const i = c.indexOf(o); out = i < 0 ? c : c.slice(0, i) + n + c.slice(i + o.length); }
      process.stdout.write(out);
    ' 2>/dev/null)
  else
    CONTENT=""
  fi
else
  # Write: content をそのまま使う
  CONTENT=$(echo "$PAYLOAD" | jq -r '.tool_input.content // ""' 2>/dev/null)
fi
[ -z "$CONTENT" ] && exit 0

# JSON として parse できなければ素通り (規約: parse できない artifact は別 hook で扱う前提)
# Edit のマージ結果が valid JSON にならない場合もここで素通り (fail-open)
echo "$CONTENT" | jq empty 2>/dev/null || exit 0

# ── target dot/bracket 正式文法パターン (R5b で使用) ──
# 先頭は識別子、以降 '.key' / '[N]' / '[key]' の連結。RFC 6901 ではない。
# --arg で渡し jq-string escape を回避 (regex は Oniguruma)。
TARGET_PAT='^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+|\[[A-Za-z0-9_-]+\])*$'

# ── R3: pending-questions.json の entries[] 必須 field ──
if echo "$FILE_PATH" | grep -q 'pending-questions\.json$'; then
  R3_VIOLATIONS=$(echo "$CONTENT" | jq -c '
    .entries // []
    | map(select(
        (has("target") | not) or
        (has("question") | not) or
        (has("raised_by_step") | not) or
        (has("raised_at") | not)
      ))
  ' 2>/dev/null)

  if [ -n "$R3_VIOLATIONS" ] && [ "$R3_VIOLATIONS" != "[]" ] && [ "$R3_VIOLATIONS" != "null" ]; then
    COUNT=$(echo "$R3_VIOLATIONS" | jq 'length' 2>/dev/null)
    echo "[P4-06 R3] pending-questions.json の entries[] に必須 field (target / question / raised_by_step / raised_at) が欠落 ($COUNT 件)" >&2
    echo "対応: schemas/pending-questions.schema.json の pendingQuestionEntry を参照" >&2
    exit 2
  fi

  # R5b (pending-questions 版): entries[].target の dot/bracket 文法検証
  R5B_VIOLATIONS=$(echo "$CONTENT" | jq -c --arg pat "$TARGET_PAT" '
    .entries // [] | map(select(has("target") and ((.target | test($pat)) | not)))
  ' 2>/dev/null)
  if [ -n "$R5B_VIOLATIONS" ] && [ "$R5B_VIOLATIONS" != "[]" ] && [ "$R5B_VIOLATIONS" != "null" ]; then
    COUNT=$(echo "$R5B_VIOLATIONS" | jq 'length' 2>/dev/null)
    echo "[P4-06 R5b] pending-questions.json の entries[].target が dot/bracket 文法違反 ($COUNT 件)" >&2
    echo "対応: 'cases[0].palette.tokens[primary]' の形式に。schemas/pending-questions.schema.json の target pattern 参照" >&2
    exit 2
  fi
fi

# ── R6: requirement-deviations.json の entries[] 必須 field + resolved 整合 (output 側) ──
# output 柱 (要件外追加リスト) も hook で形を検証し「2 本柱の片方が無防備」を解消 (セルフレビュー指摘)。
if echo "$FILE_PATH" | grep -q 'requirement-deviations\.json$'; then
  R6_VIOLATIONS=$(echo "$CONTENT" | jq -c '
    .entries // []
    | map(select(
        (has("phase") | not) or
        (has("raised_by_step") | not) or
        (has("artifact") | not) or
        (has("element") | not) or
        (has("deviation_kind") | not) or
        (has("detected_at") | not) or
        (has("resolved_at") and (has("resolution") | not)) or
        # run 単位で reconcile する層は run 識別子 2 種が無いと「誰の項目か」が決まらない。
        # 欠落すると prune / run 破棄の掃除・ゲート提示の全フィルタから漏れ、resolve 経路の無い
        # 永久未解決になる (未解決件数だけが増え続ける)。writer 側の書き忘れをここで塞ぐ。
        ((.phase == "reverse_verify") and ((has("run_id") | not) or (has("first_run_id") | not)))
      ))
  ' 2>/dev/null)
  if [ -n "$R6_VIOLATIONS" ] && [ "$R6_VIOLATIONS" != "[]" ] && [ "$R6_VIOLATIONS" != "null" ]; then
    COUNT=$(echo "$R6_VIOLATIONS" | jq 'length' 2>/dev/null)
    echo "[P4-06 R6] requirement-deviations.json の entries[] に必須 field (phase/raised_by_step/artifact/element/deviation_kind/detected_at) が欠落、resolved_at があるのに resolution 欠落、または phase=reverse_verify なのに run_id / first_run_id 欠落 ($COUNT 件)" >&2
    echo "対応: schemas/requirement-deviations.schema.json の deviationEntry を参照 (reverse_verify 層は run_id + first_run_id が必須 — 欠けると resolve 経路が無くなる)" >&2
    exit 2
  fi
fi

# ── R7: generation-provenance.json の specifics[] 必須 field + provenance enum + derived 整合 (F-3a) ──
# F-3a 生成側自己申告台帳 (Step02 が writer) も hook で形を検証し「生成側申告の形だけは保証」する。
# R3/R6 と同じ fail-open + jq パターン。ref の dot/bracket 文法は R5b の TARGET_PAT (L109) を流用 (DRY)。
if echo "$FILE_PATH" | grep -q 'generation-provenance\.json$'; then
  R7_VIOLATIONS=$(echo "$CONTENT" | jq -c --arg pat "$TARGET_PAT" '
    .specifics // []
    | map(select(
        (has("ref") | not) or
        (has("value") | not) or
        (has("artifact") | not) or
        (has("provenance") | not) or
        ((.provenance) as $p | ($p == "user_verbatim" or $p == "derived" or $p == "ai_proposed") | not) or
        (.provenance == "derived" and ((has("derived_from") | not) or (.derived_from == null) or (.derived_from == ""))) or
        (has("ref") and ((.ref | test($pat)) | not))
      ))
  ' 2>/dev/null)
  if [ -n "$R7_VIOLATIONS" ] && [ "$R7_VIOLATIONS" != "[]" ] && [ "$R7_VIOLATIONS" != "null" ]; then
    COUNT=$(echo "$R7_VIOLATIONS" | jq 'length' 2>/dev/null)
    echo "[P4-06 R7] generation-provenance.json の specifics[] に必須 field (ref/value/artifact/provenance) 欠落、provenance enum 不正、derived なのに derived_from 欠落、または ref 文法違反 ($COUNT 件)" >&2
    echo "対応: schemas/generation-provenance.schema.json の specific を参照" >&2
    exit 2
  fi
fi

# ── R8: reverse-provenance.json の specifics[] 必須 field + provenance enum + source_backed→source_ref / derived→derived_from 整合 ──
# リバース生成側 (Step 03 が writer) の自己申告台帳。R7 (generation-provenance) の reverse 版。
# enum は {source_backed, doc_backed, figma_backed, derived, inferred}。根拠あり 3 種は種類別文法の source_ref を必須化
# (CLAUDE.md Operating Principle 3 の引用義務を機械 enforce)。ref の dot/bracket 文法は TARGET_PAT を流用 (DRY)。
if echo "$FILE_PATH" | grep -q 'reverse-provenance\.json$'; then
  # source_ref 文法 (provenance 種類別。行範囲 :line-line 許容):
  #   source_backed → input-sources/{stack}/path:line (実コード)
  #   doc_backed    → ground-truth/{file}.md:line (root 直下の文書アーカイブ)
  #   figma_backed  → ground-truth/figma/ 配下 (テキスト = design-context.md / variables.json は :line 必須 / .png は行アンカーなし)
  SOURCE_REF_PAT='^input-sources/.+:[0-9]+(-[0-9]+)?$'
  DOC_REF_PAT='^ground-truth/[^/]+\.md:[0-9]+(-[0-9]+)?$'
  FIGMA_REF_PAT='^ground-truth/figma/.+(:[0-9]+(-[0-9]+)?|\.png)$'
  # `..` を弾く: 上位ディレクトリ脱出を許すと、実コード (input-sources/) を figma_backed と
  # 申告する等「証拠の種類と文法の一致」という R8 の目的そのものを迂回できる。
  TRAVERSAL_PAT='(^|/)\.\.(/|$)'
  # 型 guard を先に置く: `test()` / `has()` は非 string / 非 object 入力で jq ごと error になり、
  # 2>/dev/null で握り潰されて R8 が **ファイル単位で** 無効化される (kill switch — 型だけ違う
  # 1 件が混じると同じ write 内の他の違反も全部通る)。field 値の型に加え、specifics 自体が
  # 配列でない場合と要素が object でない場合も違反として検出し (R10 の select 先頭 guard と同型)、
  # pattern / has 検査は型確定後にのみ評価する
  R8_VIOLATIONS=$(echo "$CONTENT" | jq -c --arg pat "$TARGET_PAT" --arg spat "$SOURCE_REF_PAT" --arg dpat "$DOC_REF_PAT" --arg fpat "$FIGMA_REF_PAT" --arg tpat "$TRAVERSAL_PAT" '
    def bad_ref($p): (has("source_ref") | not) or ((.source_ref | type) != "string") or (.source_ref == "")
      or ((.source_ref | test($p)) | not) or (.source_ref | test($tpat));
    if ((.specifics != null) and ((.specifics | type) != "array")) then [{"specifics_not_array": true}]
    else ((.specifics // [])
    | map(select(
        (type != "object") or
        (has("ref") | not) or
        (has("value") | not) or
        (has("artifact") | not) or
        (has("provenance") | not) or
        ((.provenance) as $p | ($p == "source_backed" or $p == "doc_backed" or $p == "figma_backed" or $p == "derived" or $p == "inferred") | not) or
        (.provenance == "source_backed" and bad_ref($spat)) or
        (.provenance == "doc_backed" and bad_ref($dpat)) or
        (.provenance == "figma_backed" and bad_ref($fpat)) or
        (.provenance == "derived" and ((has("derived_from") | not) or ((.derived_from | type) != "string") or (.derived_from == ""))) or
        (has("ref") and (((.ref | type) != "string") or ((.ref | test($pat)) | not)))
      )))
    end
  ' 2>/dev/null)
  if [ -n "$R8_VIOLATIONS" ] && [ "$R8_VIOLATIONS" != "[]" ] && [ "$R8_VIOLATIONS" != "null" ]; then
    COUNT=$(echo "$R8_VIOLATIONS" | jq 'length' 2>/dev/null)
    echo "[P4-06 R8] reverse-provenance.json の specifics[] に必須 field (ref/value/artifact/provenance) 欠落、provenance enum 不正、根拠あり provenance (source_backed/doc_backed/figma_backed) なのに source_ref 欠落/種類別書式違反、derived なのに derived_from 欠落、ref 文法違反、または specifics/要素の型違反 (非配列・非 object) ($COUNT 件)" >&2
    echo "対応: schemas/reverse-provenance.schema.json の specific を参照。source_ref 文法: source_backed='input-sources/{stack}/path:line' / doc_backed='ground-truth/{file}.md:line' / figma_backed='ground-truth/figma/...design-context.md:line または .png'。" >&2
    exit 2
  fi
fi

# ── R9: graphics/graphic-plan.json の必須 field + slots[] enum/pattern (F-2) ──
# Step 21b (graphic-hearing) が「必要」確定時に 1 回の Write で一括生成する slot 計画。
# stub 状態が存在しない設計 (schemas/graphic-plan.schema.json) のため、top-level 必須 field も検証する。
# R3/R6 と同じ fail-open + jq パターン。taste キーが存在する場合の中身検証は writer 側
# (21c F-3) が下の taste ブロックで所有する。
# **size_role enum は schemas/graphic-plan.schema.json の写し** — 片側だけ拡張すると schema が
# 許す plan を hook が exit 2 で弾く (通常経路は Bash 書き込みで matcher に掛からないため、
# 人間の Write / Edit で初めて露出する遅延バグになる)。実行レベルの回帰テスト:
# scripts/test-schema-light-check-graphic-plan.sh
if echo "$FILE_PATH" | grep -qE '(^|/)graphics/graphic-plan\.json$'; then
  GRAPHIC_ID_PAT='^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
  R9_TOP_VIOLATION=$(echo "$CONTENT" | jq -r '
    if ((has("app_name") | not) or
        (has("created_at") | not) or
        (has("slots") | not) or
        ((.slots // []) | (type != "array" or length == 0)))
    then "1" else "" end
  ' 2>/dev/null)
  if [ "$R9_TOP_VIOLATION" = "1" ]; then
    echo "[P4-06 R9] graphic-plan.json の top-level 必須 field (app_name / created_at / slots[minItems 1]) が欠落" >&2
    echo "対応: schemas/graphic-plan.schema.json を参照。「不要」の場合は本ファイル自体を書かない (空 slots は設計上存在しない)" >&2
    exit 2
  fi
  # 型 guard を先に置く: `test()` は非 string 入力で jq ごと error になり、2>/dev/null で丸ごと
  # 握り潰されて R9 全体が無効化する (kill switch)。型違い自体を違反として検出し、pattern 検査は
  # string 確定後にのみ評価する (jq の and/or は short-circuit — 実測済)
  #
  # transparent_background は **required に入れない** (型検査のみ)。本 hook は Edit でも「置換後の
  # 全文」を検査するため、required に入れると本 field 導入前の plan (artifacts の既存プロジェクト)
  # への無関係な 1 文字 Edit まで exit 2 で塞がり、逃げ道が「全 slot に false を手で足す」= 21b の
  # 人間ゲートを通っていない値を CONFIRMED として焼き込む、という本末転倒になる (しかも 21c の
  # 「slots には触らない」key 分離とも衝突する)。新規 Write の必須性は commit-decision.mjs が
  # schema の required から実行時導出して弾く (eval で固定済み) — writer 側 1 箇所に寄せる。
  R9_VIOLATIONS=$(echo "$CONTENT" | jq -c --arg gpat "$GRAPHIC_ID_PAT" '
    .slots // []
    | map(select(
        (has("graphic_id") | not) or
        (has("screen") | not) or
        (has("platforms") | not) or
        (has("placement") | not) or
        (has("size_role") | not) or
        (has("state") | not) or
        (has("graphic_id") and (((.graphic_id | type) != "string") or ((.graphic_id | test($gpat)) | not))) or
        (has("screen") and ((.screen | type) != "string")) or
        (has("placement") and ((.placement | type) != "string")) or
        (has("size_role") and (((.size_role | type) != "string") or (((.size_role) as $s | ($s == "hero" or $s == "content" or $s == "small" or $s == "background")) | not))) or
        (has("transparent_background") and ((.transparent_background | type) != "boolean")) or
        (.state != "default") or
        ((.platforms // []) | (type != "array" or length == 0 or (map(. == "web" or . == "web-sm" or . == "mobile") | all | not)))
      ))
  ' 2>/dev/null)
  if [ -n "$R9_VIOLATIONS" ] && [ "$R9_VIOLATIONS" != "[]" ] && [ "$R9_VIOLATIONS" != "null" ]; then
    COUNT=$(echo "$R9_VIOLATIONS" | jq 'length' 2>/dev/null)
    echo "[P4-06 R9] graphic-plan.json の slots[] に必須 field (graphic_id/screen/platforms/placement/size_role/state) 欠落、string 型違反、graphic_id pattern 違反、size_role enum 不正 (hero/content/small/background)、transparent_background 非 boolean (21b 人間ゲート確定値 — true/false 以外は受理しない)、state != 'default' (v1 は default 固定)、または platforms 不正 (web/web-sm/mobile の非空配列) ($COUNT 件)" >&2
    echo "対応: schemas/graphic-plan.schema.json の slots.items を参照" >&2
    exit 2
  fi
  # taste キー (21c F-3 territory): 存在する場合のみ検証する (21b 生成時点では無いのが正常)。
  # required (level1_words[minItems 1] / level2_choice A|B|C / style_directive / confirmed_at) +
  # optional array (sample_files / palette_hints) の型 (非空 string の array)。
  # 未知キー検出 (additionalProperties: false) は hook では行わない — R3-R8 と同じ required-only 方針。
  # ここに許容キーの whitelist をハードコードすると、schema への optional field **追加** (通常は無害)
  # のたびに hook の lockstep 修正が必要になり、忘れると graphic-plan.json への全 Write/Edit が
  # exit 2 で固まる。additionalProperties は schema を実行時導出する commit-taste.mjs 側の責務。
  # palette_hints の "HEX (導出元)" 書式・sample_files の実在照合も commit-taste.mjs 側。
  R9_TASTE_VIOLATION=$(echo "$CONTENT" | jq -r '
    if (has("taste") | not) then "" else
      (.taste) as $t |
      if (($t | type) != "object" or
          (($t | has("level1_words")) | not) or
          (($t.level1_words // []) | (type != "array" or length == 0 or (map(type == "string" and . != "") | all | not))) or
          ((($t.level2_choice) as $c | ($c == "A" or $c == "B" or $c == "C")) | not) or
          (($t | has("style_directive")) | not) or (($t.style_directive | type) != "string") or ($t.style_directive == "") or
          (($t | has("confirmed_at")) | not) or (($t.confirmed_at | type) != "string") or ($t.confirmed_at == "") or
          (($t | has("sample_files")) and (($t.sample_files | type) != "array" or (($t.sample_files | map(type == "string" and . != "") | all) | not))) or
          (($t | has("palette_hints")) and (($t.palette_hints | type) != "array" or (($t.palette_hints | map(type == "string" and . != "") | all) | not))))
      then "1" else "" end
    end
  ' 2>/dev/null)
  if [ "$R9_TASTE_VIOLATION" = "1" ]; then
    echo "[P4-06 R9] graphic-plan.json の taste に必須 field (level1_words[minItems 1] / level2_choice A|B|C / style_directive / confirmed_at) 欠落・型違反、または optional array (sample_files / palette_hints) の型違反" >&2
    echo "対応: schemas/graphic-plan.schema.json の taste を参照。writer は 21c (commit-taste.mjs) のみ" >&2
    exit 2
  fi
fi

# ── R10: graphics/graphic-prompts.json の必須 field + prompts[] 型/pattern + graphic_id 重複禁止 (F-4) ──
# Step 21d (graphic-prompts) が user 確定時に 1 回の Write で一括生成する確定プロンプト台帳。
# stub 状態が存在しない設計 (schemas/graphic-prompts.schema.json) のため、top-level 必須 field も検証する。
# R9 と同じ fail-open + jq パターン + required-only 方針 (未知キー検出は commit-prompts.mjs 側の責務)。
# graphic_id の配列内重複は JSON Schema で表現できない契約 (schema の prompts description が SoT) の
# ため hook でも enforce する (commit script が Bash 起動で hook を経ないのと対に、縮退運転 [LLM の
# 手動 Write] 経路をここで塞ぐ二層構え)。plan slots との 1:1 対応は他ファイル参照が要るため hook では
# 見ない (commit script 側のみ)。
if echo "$FILE_PATH" | grep -qE '(^|/)graphics/graphic-prompts\.json$'; then
  GRAPHIC_ID_PAT='^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
  # schema_version は要求しない — schema で deprecated (「新規に書かない」「受理して無視」) のため、
  # 必須扱いにすると schema 準拠の正しい Write を逆に block する。required + 型 (null は has() を
  # 通るため型検査まで行う — entry 級検査との厳格度非対称を作らない)。tool は optional だが
  # 存在時は非空 string (schema type 違反のまま disk に固定させない)。
  # entry 級の optional field も同様に型/enum を見る (occupancy_band は POCTEAMA-410 で追加 —
  # 誤字 "None" 等は 21e が黙って既定帯に fallback しつつ digest だけ変えるため、人間ゲートの
  # opt-out 指示が消えたまま当該 slot が再生成 [再課金] される。schema の pattern をここでミラーする)
  R10_TOP_VIOLATION=$(echo "$CONTENT" | jq -r '
    if ((has("app_name") | not) or ((.app_name | type) != "string") or (.app_name == "") or
        (has("confirmed_at") | not) or ((.confirmed_at | type) != "string") or (.confirmed_at == "") or
        (has("tool") and (((.tool | type) != "string") or (.tool == ""))) or
        (has("prompts") | not) or
        ((.prompts // []) | (type != "array" or length == 0)))
    then "1" else "" end
  ' 2>/dev/null)
  if [ "$R10_TOP_VIOLATION" = "1" ]; then
    echo "[P4-06 R10] graphic-prompts.json の top-level 必須 field (app_name / confirmed_at / prompts[minItems 1]) の欠落・空・型違反、または optional field tool の非空 string 違反" >&2
    echo "対応: schemas/graphic-prompts.schema.json を参照。全 slot 中止の場合は本ファイル自体を書かない (空 prompts は設計上存在しない — decision='skip', decided_by='step21d' を記録する)" >&2
    exit 2
  fi
  # 型 guard を先に置く: test()/floor は非 string / 非 number 入力で jq ごと error になり 2>/dev/null で
  # 丸ごと握り潰されて R10 全体が無効化する (kill switch) — R9 と同じく short-circuit で防ぐ。
  # size_px.width/height は schema の integer/minimum 1 を number + floor 同値 + >=1 でミラーする
  # occupancy_band の許容値は **schemas/graphic-prompts.schema.json の pattern から派生** する
  # (POCTEAMA-410 N-7)。hook に literal を持つと、schema に 4 つ目の帯を足したとき
  # 「21d は書ける / 21e・21f preflight は E_PROMPTS_INVALID / hook は exit 2 で手編集も拒む」=
  # 誰にも直せない詰み file ができる。読めなければ既知値へ fail-open (本 hook の全体方針と同じ)。
  OBANDS_SCHEMA="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)/schemas/graphic-prompts.schema.json"
  OCCUPANCY_BANDS_JSON=$(jq -c '
    (.properties.prompts.items.properties.occupancy_band.pattern // "")
    | capture("^\\^\\((?<alts>[^)]+)\\)\\$$") .alts
    | split("|") | map(select(length > 0))
  ' "$OBANDS_SCHEMA" 2>/dev/null)
  case "$OCCUPANCY_BANDS_JSON" in
    '['*']') : ;;
    *) OCCUPANCY_BANDS_JSON='["none","icon","non-icon"]' ;;
  esac
  [ "$OCCUPANCY_BANDS_JSON" = "[]" ] && OCCUPANCY_BANDS_JSON='["none","icon","non-icon"]'
  # size_px の上限 (POCTEAMA-410 N-8 / R3-9): 辺上限は occupancy_band と同じく **schema の maximum
  # から派生**する — hook に literal を持つと、schema の maximum を上げたとき 21d writer
  # (commit-prompts.mjs は sdef.maximum を参照) は通すのに hook だけ exit 2 で塞ぐ = N-7 が
  # 塞いだ「詰み file」非対称の再発になる。読めなければ既知値へ fail-open (本 hook の全体方針)。
  # 面積上限は schema で表現不能 (description が SoT) のため literal のまま — 21d/21e/21f の
  # MAX_SIZE_PX_AREA と同値、変更は同時に (機械検証: 21f eval の同期契約)。21e の resample は
  # width*height*4 バイトを一括確保するため、桁間違いの手編集が入ると Node が OOM 落ちする
  R10_MAX_SIDE=$(jq -r '.properties.prompts.items.properties.size_px.properties.width.maximum // empty' "$OBANDS_SCHEMA" 2>/dev/null)
  case "$R10_MAX_SIDE" in
    '' | *[!0-9]*) R10_MAX_SIDE=8192 ;;
  esac
  R10_MAX_AREA=40000000
  # jq 式は jq 1.5 互換の builtin のみ使う (POCTEAMA-410 R3-9): IN() は jq 1.6+ の builtin で、
  # 本ブロックは 2>/dev/null 内のため旧 jq ではコンパイル失敗が握り潰されて entry 級検査が丸ごと
  # 黙って消える (上の注釈が避けたはずの kill switch そのもの)。enum 照合は any($obands[]; . == $b)。
  # 実行レベルの回帰テスト: scripts/test-schema-light-check-graphic-prompts.sh
  R10_VIOLATIONS=$(echo "$CONTENT" | jq -c --arg gpat "$GRAPHIC_ID_PAT" --argjson obands "$OCCUPANCY_BANDS_JSON" --argjson maxside "$R10_MAX_SIDE" --argjson maxarea "$R10_MAX_AREA" '
    .prompts // []
    | map(select(
        (type != "object") or
        (has("graphic_id") | not) or
        (has("prompt") | not) or
        (has("size_px") | not) or
        (has("graphic_id") and (((.graphic_id | type) != "string") or ((.graphic_id | test($gpat)) | not))) or
        (has("prompt") and (((.prompt | type) != "string") or (.prompt == ""))) or
        (has("size_px") and (
          ((.size_px | type) != "object") or
          ((.size_px.width | type) != "number") or (.size_px.width < 1) or ((.size_px.width | floor) != .size_px.width) or
          ((.size_px.height | type) != "number") or (.size_px.height < 1) or ((.size_px.height | floor) != .size_px.height) or
          (.size_px.width > $maxside) or (.size_px.height > $maxside) or
          ((.size_px.width * .size_px.height) > $maxarea))) or
        (has("transparent_background") and ((.transparent_background | type) != "boolean")) or
        (has("occupancy_band") and (((.occupancy_band | type) != "string") or
          ((.occupancy_band as $b | any($obands[]; . == $b)) | not))) or
        (has("notes") and ((.notes | type) != "string"))
      ))
  ' 2>/dev/null)
  if [ -n "$R10_VIOLATIONS" ] && [ "$R10_VIOLATIONS" != "[]" ] && [ "$R10_VIOLATIONS" != "null" ]; then
    COUNT=$(echo "$R10_VIOLATIONS" | jq 'length' 2>/dev/null)
    echo "[P4-06 R10] graphic-prompts.json の prompts[] に必須 field (graphic_id/prompt/size_px) 欠落、graphic_id pattern 違反、prompt 空/型違反、size_px 不正 (width/height は 1〜$R10_MAX_SIDE の整数 かつ 面積 $R10_MAX_AREA px 以内)、または optional field (transparent_background boolean / occupancy_band ∈ {$(echo "$OCCUPANCY_BANDS_JSON" | jq -r 'join(",")' 2>/dev/null)} / notes string) の型違反 ($COUNT 件)" >&2
    echo "対応: schemas/graphic-prompts.schema.json の prompts.items を参照。writer は 21d (commit-prompts.mjs) のみ" >&2
    exit 2
  fi
  R10_DUP_IDS=$(echo "$CONTENT" | jq -r '
    [.prompts // [] | .[] | select(type == "object") | .graphic_id | select(type == "string")]
    | group_by(.) | map(select(length > 1) | .[0]) | join(", ")
  ' 2>/dev/null)
  if [ -n "$R10_DUP_IDS" ]; then
    echo "[P4-06 R10] graphic-prompts.json の prompts[] に graphic_id 重複: $R10_DUP_IDS (1 graphic_id = 1 確定プロンプト — 重複すると 21e がどちらを使うか不定になる)" >&2
    echo "対応: schemas/graphic-prompts.schema.json の prompts description を参照 (schema では表現不能な契約のため hook + commit-prompts.mjs の二層で enforce)" >&2
    exit 2
  fi
fi

# ── R11: reverse-verify/scope-manifest.json の top-level 必須 field + 非空 scope ──
# Phase 0c (対象限定突合) が人間承認した「どこまでを突合するか」の確定範囲。writer は
# 01-target-scope のみ。R9/R10 と同じ fail-open + jq + required-only 方針 (未知キー検出は持たない)。
# 空 scope の禁止は schema の minProperties/anyOf では「どのリストか」を言い分けられないため
# hook 側で見る: どのリストも空のまま承認されると、下流は読む対象が無いまま突合を完了でき、
# 報告書の「差分なし」が「何も見ていない」と区別できなくなる (build-code-inventory が
# in-scope 0 件の読み取り計画を書き出さないのと同じ理由)。
if echo "$FILE_PATH" | grep -qE '(^|/)reverse-verify/scope-manifest\.json$'; then
  # 型 guard を先に置く: 非 object / 非 array 入力で jq ごと error になると 2>/dev/null が
  # 握り潰して R11 全体が無効化する (kill switch) — R9/R10 と同じく short-circuit で防ぐ。
  # top-level 自体が配列 / 文字列 / 数値のケースも最初の条件で弾く (has() は非 object で error になる)。
  R11_VIOLATION=$(echo "$CONTENT" | jq -r '
    if ((type != "object") or
        (has("app_name") | not) or ((.app_name | type) != "string") or (.app_name == "") or
        (has("run_id") | not) or ((.run_id | type) != "string") or (.run_id == "") or
        (has("created_at") | not) or ((.created_at | type) != "string") or (.created_at == "") or
        (has("target") | not) or ((.target | type) != "object") or
        ((.target | has("description")) | not) or ((.target.description | type) != "string") or (.target.description == "") or
        (has("scope") | not) or ((.scope | type) != "object"))
    then "1" else "" end
  ' 2>/dev/null)
  if [ "$R11_VIOLATION" = "1" ]; then
    echo "[P4-06 R11] scope-manifest.json の top-level 必須 field (app_name / run_id / created_at / target.description / scope) の欠落・空・型違反" >&2
    echo "対応: schemas/reverse-verify-scope-manifest.schema.json を参照。writer は 01-target-scope のみ" >&2
    exit 2
  fi
  R11_EMPTY_SCOPE=$(echo "$CONTENT" | jq -r '
    (.scope // {}) as $s
    | [ "requirement_sections", "screens", "ground_truth_docs", "figma_frames", "code_modules" ]
    | map(($s[.] // []) | if type == "array" then length else 0 end)
    | if (add // 0) == 0 then "1" else "" end
  ' 2>/dev/null)
  if [ "$R11_EMPTY_SCOPE" = "1" ]; then
    echo "[P4-06 R11] scope-manifest.json の scope が全て空 (requirement_sections / screens / ground_truth_docs / figma_frames / code_modules のいずれも 0 件) — 突合する対象が無い範囲は確定させない" >&2
    echo "対応: 対象の指定を見直して範囲を導出し直す。証拠ソースが縮退している場合も、要件文書・画面仕様のセクションは必ず範囲に入る (訂正対象そのものだから)" >&2
    exit 2
  fi
  # 要素の必須 field も見る (R9/R10 と同じ厳格度): 空でない配列を通しても、要素が {} なら
  # 下流は「どの文書のどのセクションか」を読み取れず、範囲が確定した形だけが残る。
  R11_ITEM_VIOLATIONS=$(echo "$CONTENT" | jq -c '
    ((.scope // {}) | if type == "object" then . else {} end) as $s
    | [
        (($s.requirement_sections // []) | if type == "array" then . else [] end
          | map(select((type != "object") or (has("doc") | not) or ((.doc | type) != "string") or (.doc == "")
                       or (has("section") | not) or ((.section | type) != "string") or (.section == ""))
                | "requirement_sections")),
        (($s.screens // []) | if type == "array" then . else [] end
          | map(select((type != "object") or (has("slug") | not) or ((.slug | type) != "string") or (.slug == "")
                       or (has("spec_path") | not) or ((.spec_path | type) != "string") or (.spec_path == ""))
                | "screens")),
        (($s.figma_frames // []) | if type == "array" then . else [] end
          | map(select((type != "object") or (has("file_key") | not) or ((.file_key | type) != "string") or (.file_key == "")
                       or (has("node_id") | not) or ((.node_id | type) != "string") or (.node_id == ""))
                | "figma_frames")),
        (($s.ground_truth_docs // []) | if type == "array" then . else [] end
          | map(select((type != "string") or (. == "")) | "ground_truth_docs")),
        (($s.code_modules // []) | if type == "array" then . else [] end
          | map(select((type != "string") or (. == "")) | "code_modules"))
      ] | add | unique
  ' 2>/dev/null)
  if [ -n "$R11_ITEM_VIOLATIONS" ] && [ "$R11_ITEM_VIOLATIONS" != "[]" ] && [ "$R11_ITEM_VIOLATIONS" != "null" ]; then
    echo "[P4-06 R11] scope-manifest.json の scope 要素に必須 field 欠落 / 型違反: $R11_ITEM_VIOLATIONS (requirement_sections は doc+section / screens は slug+spec_path / figma_frames は file_key+node_id / ground_truth_docs・code_modules は非空 string)" >&2
    echo "対応: schemas/reverse-verify-scope-manifest.schema.json の scope を参照。範囲は下流が『どこを読むか』を一意に引ける形で書く" >&2
    exit 2
  fi
fi

exit 0
