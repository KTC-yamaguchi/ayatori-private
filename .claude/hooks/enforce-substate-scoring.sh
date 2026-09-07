#!/bin/bash
# .claude/hooks/enforce-substate-scoring.sh
#
# Sub-state 生成フロー (Step 25b→25c→25d→25e) で採点 Step 25c を
#   飛ばせないようにする機械ゲート (PreToolUse ブロック hook)。
#
# 背景: 25a→25b→25c→25d→25e のチェーンは従来 phase / skill の SKILL.md の prose 記述と、
#   preamble の resume ロジックだけで順序保証していた。preamble は `/ayatori-screens` を
#   新規再起動したときにしか発火しないため、完走後の「後続生成」を 1 セッションで連続実行すると、
#   オーケストレータ (main session) が 25b の後に 25c (ルーブリック採点 = 画面間一貫性チェック) を
#   飛ばし、そのまま人間確認・手作業修正へ直行できてしまった (振り返り原因 F)。結果、品質担保が
#   スキルの仕組みでなく人間の横断目視 FB に依存し、往復修正が 20 回以上発生した。
#   本 hook はその穴を機械的に塞ぐ最後の砦 (skill 側 Phase 0 assert が早期・明示の第 1 層)。
#
# なぜ PreToolUse か:
#   採点スキップを "記録される前に" 止める必要がある (PostToolUse では 25d 承認 /
#   completed_at_states が既にディスクに書かれた後で、ブロックできない)。PreToolUse は exit 2 で
#   tool 実行そのものを block できる。
#
# 動作 (仕様の SoT は pipeline.yaml § screens.state_pattern_gate_enforcement.layer2_hook):
#   1. Write / Edit の stdin JSON を受領し tool_name / file_path を取り出す
#   2. file_path が artifacts/{app}/pipeline-state.json のときだけ動く (それ以外は素通り)
#   3. 「書き込み後の state」を構築する:
#        - Write: tool_input.content がそのまま書き込み後の state (本パイプラインの
#          pipeline-state.json 更新は Read→merge→Write back が規約で、full Write が正規経路)
#        - Edit: ディスク現行内容に old_string→new_string の literal 置換 (replace_all 対応) を
#          simulate した結果を書き込み後の state とみなす (断片 grep はバイパス/誤爆の両方を
#          生むため行わない。simulate 不能 = old_string 不在 / disk 読めない等は fail-open)
#   4. 書き込み後の state から "未採点 sub-state 存在" 信号を計算:
#        unscored = (screens.step25b.completed_at が set)
#                   AND (screens.step25c.completed_at が unset
#                        OR  epoch(step25c.completed_at) < epoch(step25b.completed_at))
#      = 25b が sub-state を生成したのに、最新の 25b 出力を 25c がまだ採点していない状態。
#      時刻の新旧比較は epoch 換算で行う (+09:00 / Z 等のタイムゾーン表記が skill 間で混在しても
#      判定が逆転しない)。epoch 換算できない値は文字列比較に fallback。
#   5. unscored でなければ素通り (exit 0)。
#   6. unscored のとき、書き込み後の state が 25d/25e territory キー
#      (一覧の SoT は pipeline.yaml § ...layer2_hook.territory_keys) をディスク現行値から
#      **新規導入 or 値変更** するなら exit 2 で block する。
#      キーの「存在」ではなく「導入 (差分)」で判定するのは、Read→merge→Write back 規約により
#      25d の revise 判定記録 (step25d.decision="revise" 等) が残置された state を、再生成した
#      25b が自己の completed_at を記録するとき丸ごと書き戻すため。同値 carry-over を block すると
#      差し戻し→再生成の正規ループが詰まる。carry-over は allow し、新規導入 / 値変更のみ block
#      することで、25b/25c 自身の書き込みは決してブロックされず、承認の前進 (25d/25e) だけが
#      25c 採点を待つ形に強制される。
#      → 実行順序が「25b(可) → [unscored] → 25d(不可) → 25c(可) → 25d(可)」に強制される。
#
# Fail-open 設計: jq 不在 / parse 失敗 / 対象外パス / Edit simulate 不能等は全て exit 0。
#   本 hook が誤ってパイプラインを wedge しないよう、判断できないときは通す (第 1 層の skill assert が
#   保険)。ただし「unscored かつ 25d/25e キーの新規導入/値変更が明確に読めた」ケースだけは確実に block する。

set +e  # fail-open (block は明示的な exit 2 のときだけ)

command -v jq >/dev/null 2>&1 || exit 0

PAYLOAD=$(cat)
[ -z "$PAYLOAD" ] && exit 0

TOOL_NAME=$(echo "$PAYLOAD" | jq -r '.tool_name // "unknown"' 2>/dev/null)
FILE_PATH=$(echo "$PAYLOAD" | jq -r '.tool_input.file_path // ""' 2>/dev/null)

[ "$TOOL_NAME" != "Write" ] && [ "$TOOL_NAME" != "Edit" ] && exit 0
[ -z "$FILE_PATH" ] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)}"
[ -z "$PROJECT_DIR" ] && exit 0

case "$FILE_PATH" in
  /*) ABS_PATH="$FILE_PATH" ;;
  *)  ABS_PATH="$PROJECT_DIR/$FILE_PATH" ;;
esac

# ── 再帰ガード: _backup/ 配下は対象外 ──
case "$ABS_PATH" in
  */_backup/*) exit 0 ;;
esac

# ── 対象判定: artifacts/{app}/pipeline-state.json のみ ──
case "$ABS_PATH" in
  */artifacts/*/pipeline-state.json) : ;;
  *) exit 0 ;;
esac

# ── ディスク現行内容 (差分判定の基準)。不在 / 読めない → 空 = territory キーは全て「新規導入」扱い ──
DISK_RAW=""
[ -f "$ABS_PATH" ] && DISK_RAW=$(cat "$ABS_PATH" 2>/dev/null)

# ── 書き込み後の state (NEW_CONTENT) を構築 ──
if [ "$TOOL_NAME" = "Write" ]; then
  NEW_CONTENT=$(echo "$PAYLOAD" | jq -r '.tool_input.content // ""' 2>/dev/null)
else
  # Edit: ディスク現行内容へ old_string→new_string の literal 置換を simulate する。
  # 文字列 literal 置換のため jq の split/join・index を使う (sub/gsub は regex 解釈で不可)。
  # old_string 空 / disk 空 / old_string 不在 (Edit 自体が失敗するケース) は "" → fail-open。
  NEW_CONTENT=$(echo "$PAYLOAD" | jq -r --arg cur "$DISK_RAW" '
    (.tool_input.old_string // "") as $o
    | (.tool_input.new_string // "") as $n
    | if $o == "" or $cur == "" then ""
      elif ($cur | index($o)) == null then ""
      elif (.tool_input.replace_all // false) == true then ($cur | split($o) | join($n))
      else ($cur | index($o)) as $i
        | ($cur[0:$i] + $n + $cur[($i + ($o | length)):])
      end' 2>/dev/null)
fi

[ -z "$NEW_CONTENT" ] && exit 0

# ── 判定本体: 書き込み後 state が unscored かつ territory キーを新規導入 / 値変更するか ──
VERDICT=$(jq -rn --arg new "$NEW_CONTENT" --arg disk "$DISK_RAW" '
  # ISO 8601 文字列 → epoch 秒。+09:00 / +0900 / Z / 無印 (UTC 扱い) に対応。
  # parse 不能なら null を返す (呼び出し側で文字列比較に fallback)。
  def ts2e:
    if type != "string" then null
    else
      (try capture("^(?<Y>[0-9]{4})-(?<M>[0-9]{2})-(?<D>[0-9]{2})[Tt ](?<h>[0-9]{2}):(?<m>[0-9]{2}):(?<s>[0-9]{2})(\\.[0-9]+)?(?<z>[Zz]|[+-][0-9]{2}:?[0-9]{2})?") catch null) as $c
      | if $c == null then null
        else
          (try (($c.Y + "-" + $c.M + "-" + $c.D + "T" + $c.h + ":" + $c.m + ":" + $c.s + "Z") | fromdateiso8601) catch null) as $base
          | if $base == null then null
            else
              (if ($c.z == null or ($c.z | ascii_upcase) == "Z") then 0
               else
                 ((if ($c.z | length) == 6 then $c.z[4:6] else $c.z[3:5] end) | tonumber) as $mm
                 | (($c.z[1:3] | tonumber) * 3600 + $mm * 60) * (if $c.z[0:1] == "+" then 1 else -1 end)
               end) as $off
              | ($base - $off)
            end
        end
    end;

  # unscored 信号: 25b done かつ (25c 未 or 25c が 25b より古い)。epoch 比較、fallback は文字列比較。
  def unscored:
    ((try (.screens.step25b.completed_at) catch null) // "") as $b
    | ((try (.screens.step25c.completed_at) catch null) // "") as $c
    | if $b == "" then "no"
      elif $c == "" then "yes"
      else
        ($b | ts2e) as $be
        | ($c | ts2e) as $ce
        | if ($be != null and $ce != null)
          then (if $ce < $be then "yes" else "no" end)
          else (if $c < $b then "yes" else "no" end)
          end
      end;

  # 25d/25e territory キーの現在値 (一覧の SoT: pipeline.yaml § ...layer2_hook.territory_keys)
  def tvals:
    { approved: ((try (.approvals.patterns_human_approved) catch null) == true),
      d_at:     (((try (.approvals.step25d_approved_at)  catch null) // "") | tostring),
      states:   (((try (.approvals.completed_at_states)  catch null) // "") | tostring),
      dec:      (((try (.screens.step25d.decision)       catch null) // "") | tostring),
      d_done:   (((try (.screens.step25d.completed_at)   catch null) // "") | tostring) };

  ($new | try fromjson catch null) as $n
  | if ($n | type) != "object" then "allow"
    else
      (($disk | try fromjson catch {}) // {}) as $d0
      | (if ($d0 | type) == "object" then $d0 else {} end) as $d
      | if ($n | unscored) != "yes" then "allow"
        else
          ($n | tvals) as $nv
          | ($d | tvals) as $dv
          | if (($nv.approved and ($dv.approved | not))
                or ($nv.d_at   != "" and $nv.d_at   != $dv.d_at)
                or ($nv.states != "" and $nv.states != $dv.states)
                or ($nv.dec    != "" and $nv.dec    != $dv.dec)
                or ($nv.d_done != "" and $nv.d_done != $dv.d_done))
            then "block"
            else "allow"
            end
        end
    end' 2>/dev/null)

[ "$VERDICT" != "block" ] && exit 0

# ── block (exit 2 + stderr)。Claude が読んで 25c を先に実行するよう誘導する ──
cat >&2 <<'EOF'
Sub-state 採点 (Step 25c) 未実施のまま 25d/25e の承認・完了を記録しようとしています。
Step 25b で sub-state HTML を生成した後は、必ず Step 25c (ルーブリック採点 = 画面間一貫性チェック) を
通してから 25d 人間ゲート → 25e へ進んでください。採点をスキップすると画面間の一貫性逸脱
(アイコン / ボタン位置 / ラベル / CTA フォントのばらつき等) が検出されず下流に流れます。

対応: skills/25c-state-pattern-score/SKILL.md を Read して Step 25c を実行し、
      state-pattern-scores.json への採点 append + pipeline-state.json の screens.step25c.completed_at
      記録を済ませてから、この書き込みを再実行してください。
EOF
exit 2
