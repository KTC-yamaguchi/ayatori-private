#!/usr/bin/env node
// scripts/derive-transition-map.mjs
//
// reverse エンジニアリング産の `requirements/03-user-flow.md` (Mermaid フロー図を複数含む
// Markdown) → `screens/00-transition-map.mmd` (画面遷移図 SSoT) の決定論変換。
//
// 決定論 script にする理由:
//   03-user-flow.md の Mermaid 図は「画面遷移そのもの」を既に持っているのに、Step 14 では
//   LLM が毎 run これを読み直して .mmd を書き起こしていた。書き起こしは実質
//   「菱形を畳む / 点線を実線にする / 同名ノードを寄せる / 図をまとめる」の 4 つの機械変換で
//   あり、LLM に任せると (a) run ごとに畳み方・ラベルが揺れる (b) 元図に無い遷移が
//   「自然な補完」として混入する (c) `※ 推測 (inferred)` / `※ 不明 (unknown)` マーカーが
//   言い換え・脱落し、推測が確定事実として下流 (screens / design) へ laundering される。
//   入力から出力が一意に決まる処理なので、本 script が単一の変換 SoT となる
//   (derive-screen-nav.mjs / lint-screen-colors.mjs と同型の決定論化)。
//   **同一入力 → byte 同一出力が絶対要件** — 生成時刻等の非決定論な値は出力に入れない
//   (Date.now / new Date を使わない)。
//
// 変換規則 (確定仕様):
//   R1 菱形を畳む:   菱形 `D{"label"}` は下流パーサ (parseTransitionMap) が解釈しないため、
//                    入エッジ (A,lin) × 出エッジ (B,lout) の直積で `A -->|合成ラベル| B` に
//                    畳む。合成ラベル = `lin » D.label: lout` (lin 無し → `D.label: lout` /
//                    lout 無し → `lin » D.label`。どちらのラベルも捨てない)。
//                    菱形→菱形の連鎖は畳み込みを反復して解消する。
//                    畳めない菱形 (入エッジゼロ / 出エッジゼロ / 菱形同士の循環) は
//                    スタジアムに変換して残し warning に記録する = **エッジを消滅させない**。
//                    **畳んだ結果 `from == to` になったエッジは drop** し warning
//                    `folded_self_loop` に記録する (R5 の merged_self_loop と同じ理由 —
//                    「HOME →|削除| 確認{} →|いいえ| HOME」のような往復が自己ループに畳まれると
//                    L5 検査が inbound / outbound を 1 本ずつ数え、出口の無い画面を
//                    dead_end として検出できず沈黙する)。
//   なぜ菱形を畳むか (単純な「全部スタジアム置換」で済ませない理由):
//                    L5 の検出力は fold の有無では変わらない — validate-connectivity.mjs は
//                    入口 / 出口の**本数**だけを数え、相手が画面かピルかを区別しないため、
//                    スタジアム経由の到達も入口 1 / 出口 1 として数える。差が出るのは
//                    `00-screen-nav.json` の意味で、置換一本だと「この画面からどの画面へ行けるか」が
//                    菱形ピルの向こう側に隠れる。nav の消費者 (Step 19 の L2 再評価 / Step 28 の
//                    影響分析 / Step 29b) は画面→画面の到達関係を読むため、畳んで画面同士を
//                    直結させる必要がある。
//   R2 点線正規化:   `-.->` を `-->` へ。畳み込み後のラベルにマーカーが 1 つも無いときだけ
//                    ` ※ 推測 (inferred)` を付加する (点線 = 不確実の信号をマーカーへ移す)。
//                    **実線エッジには何も付加しない** (根拠ありの遷移にマーカーを発明しない)。
//   R3 形状正規化:   矩形ノードのラベルを 00-screen-list.md と突合し、一致 → 矩形のまま /
//                    不一致 → スタジアムへ。突合は derive-screen-nav.mjs の matchScreens を
//                    **import して共有** する (下流 L5 = validate-connectivity.mjs と同じ
//                    判定器を使うことで偽リンク切れ [dangling_edge] を防ぐのが狙い)。
//                    画面一覧に `遷移図ノードID` 列があればノード ID の完全一致が第一候補になり
//                    (matchScreens Pass 0)、ラベル語彙が揃わなくても突合できる。
//                    **ID 宣言で行に束縛された非矩形ノードは矩形へ昇格する** (warning
//                    `node_id_promoted_to_screen`) — 昇格しないと行は消費済みなのに glyph は
//                    スタジアムのままで、その画面が nav / L5 / 遷移図 HTML の凡例から
//                    無言で消える (「欠陥 0 件」ではなく「検査を受けていない」状態になる)。
//   R4 ブロック合成: 入力中の全 ```mermaid ブロックを 1 つの `flowchart TD` に統合し、
//                    各ブロックの直前の見出しを `%% from: <見出し>` で区切る。ノード宣言は
//                    初出位置で 1 回のみ。同一 (from,to,label) のエッジは重複排除。
//                    出力順序は入力の出現順 (決定論)。
//   R5 同名マージ:   R3 の前に、正規化ラベルが完全一致する矩形ノード同士を初出 ID へ
//                    マージしエッジを書き換える (例 LIST / VDLIST が共に「動画一覧」)。
//                    fuzzy マージは禁止 — 曖昧なものは触らず下流 L5 の人間レビューに委ねる。
//                    マージの結果 `src == dst` になったエッジ (同名ノード間の遷移) は **drop** し
//                    warning `merged_self_loop` に記録する — 自己ループとして残すと L5 検査
//                    (inbound / outbound の数え上げ) が孤児を検出できず沈黙するため。
//                    元ソースで最初から同一 ID の自己ループだったエッジは対象外 (そのまま保持)。
//   R6 ID 保持:      ノード ID は転写 (リネームしない)。同一 ID がブロック間で異なるラベルを
//                    持つ場合は初出ラベル優先 + warning `label_conflict` に記録。
//   マーカー逐語保持: `※ 推測 (inferred)` / `※ 不明 (unknown)` (無空白表記含む) は
//                    ラベル内で一切改変しない (sanitize 前に退避し、後で逐語復元する)。
//                    `<br/>` は半角スペース、ラベル内 `|` は `/` (下流パーサがエッジラベルに
//                    `|` を許さないため)、引用符と連続空白は正規化する。
//                    **生の山括弧 `<` `>` は全角 `＜` `＞` へ置換する** — `.mmd` は
//                    `{{MERMAID_BLOCKS}}` として `00-transition-map.html` に生連結され human gate で
//                    ブラウザに auto-open される。ラベルの元は第三者コードなので `<` が残ると
//                    `</div><script>` 等が mermaid コンテナを抜けて DOM に入る (組み立て段階で
//                    確定するため mermaid の securityLevel では防げない)。HTML escape ではなく
//                    全角にするのは、`.mmd` が FigJam 同期にそのまま渡され / Step 16 で人間が
//                    読み書きする SSoT であり / `00-screen-nav.json` の `via` にも入るため、
//                    entity 表記 (`&lt;`) が全経路に漏れるのを避けるため。`&` は text context では
//                    構造を変えられないので触らない (`保存 & 完了` を壊さない)。
//
// 出力が満たすべき文法 (derive-screen-nav.mjs parseTransitionMap の strict parse):
//   `flowchart TD` ヘッダ / ノードは `id["label"]` (矩形=画面) `id(["label"])` (スタジアム) /
//   エッジは `A -->|label| B` `A --> B` `A <--> B` のみ / ID は `[A-Za-z_]\w*` /
//   `%%` 行はコメント。点線と菱形は下流が解釈しないため出力に残してはならない。
//
// exit code 契約 (兄弟の derive-screen-nav.mjs と同じ 3 値):
//   0 = 生成成功 (.mmd + 派生 summary sidecar を書き出し、summary JSON を stdout へ)
//   1 = **使い方エラー** (不明フラグ / 値なしフラグ / 引数過多 / app ルート未指定 /
//       `--out` が app ルート外)。呼び出し側の**バグ**なので、材料不足の fail-open
//       (exit 2) に合流させない — パス typo 等で遷移図なしのまま静かに進むのを防ぐ。
//   2 = 入力不能 (source 不在 / screen-list 不在 / mermaid ブロック 0 件 /
//       **エッジ 0 本** / 出力先が既存で --force 無し)。理由を stderr へ。
//       「エッジ 0 本」= mermaid ブロックは読めたのに遷移を 1 本も抽出できなかった状態。
//       未対応記法で statement が全滅した場合 (unparsed_line だけが積まれた場合) がこれに当たり、
//       exit 0 で空の遷移図を書くと欠落に気づけないため、**空の .mmd を書かずに落とす**
//       (stderr の理由に unparsed_line / ignored_line の件数を含める)。呼び出し側 (E6-2 /
//       14-lite の 14L-1) は既存の exit 2 契約どおり fail-open / 中断で扱えばよい。
//
// 使い方:
//   node scripts/derive-transition-map.mjs <artifacts/{app_name}> \
//     [--source <path>] [--screen-list <path>] [--out <path>] [--force]
//   パスは app ルート相対 (--out は絶対パスも可)。既定は
//   source=requirements/03-user-flow.md / screen-list=screens/00-screen-list.md /
//   out=screens/00-transition-map.mmd。**出力先が既存なら --force 無しでは書かない**
//   (完走済プロジェクトの SSoT を誤って潰さないため)。`--force` で実際に上書きする場合は、
//   書き込み前に現行内容を `_backup/` へ self-backup する (下記 selfBackup — Bash 起動では
//   PreToolUse hook `backup-on-edit.sh` が発火しないため script 側の義務。`pipeline.yaml` § `artifact_backup`)。
//
// summary JSON のフィールド定義:
//   nodes / edges       = 出力 .mmd のノード宣言数 / エッジ行数 (重複排除後)
//   folded_diamonds     = R1 で畳んで消えた菱形の数 (スタジアム化して残ったものは含まない)
//   merged_nodes        = R5 で初出 ID に寄せて消えたノードの数
//   dotted_normalized   = ソース中の `-.->` エッジ本数 (畳み込みで複製されても 1 と数える)
//   screen_matched      = R3 で screen-list に突合できて矩形になったノード数 (昇格分を含む)
//   stadium_converted   = R3 で矩形からスタジアムへ変換したノード数 (菱形由来は含まない。
//                         丸角 / 円 / 六角 / サブルーチンは rect 起点なので突合外れは本数に入る)
//   promoted_to_screen  = R3 で ID 宣言により非矩形から矩形へ昇格したノード数
//   summary_sidecar     = 併記した派生 summary の書き出し先 (下記 sidecar)
//   sidecar_warning     = sidecar の書き出しに失敗した理由 (fail-open で続行するので exit 0 の
//                         まま。失敗時のみ key が出る。CLI は同じ内容を stderr へ 1 行出す)
//   backed_up           = 既存 SSoT を `--force` で上書きした際の退避先パス (退避しなかった場合は key ごと省略)
//   backup_warning      = 退避を**試みて失敗した**理由 (fail-open で続行するので exit 0 のまま。失敗時のみ
//                         key が出る。対象外 / 新規生成 / md5 dedup skip では出ない。CLI は同じ内容を
//                         stderr へ 1 行出す)
//   warnings[]          = 人間が確認すべき事象。代表的な type を挙げると (網羅列挙ではない):
//                         label_conflict / 畳めない菱形 [diamond_cycle / diamond_no_in_edges /
//                         diamond_no_out_edges] / 畳んで自己ループ化して drop したエッジ
//                         [folded_self_loop] / 同名マージ [merged_same_label] /
//                         同名マージで自己ループ化して drop したエッジ [merged_self_loop] /
//                         ID 宣言による矩形への昇格 [node_id_promoted_to_screen] /
//                         解釈できなかった行 [unparsed_line] / 画面一覧側の警告 (parseScreenList 由来:
//                         遷移図ノードID の重複 [duplicate_node_id] / 文法外の非空 ID [invalid_node_id] /
//                         画面一覧として読まなかった表 [skipped_table] / 再掲行の dedupe
//                         [duplicate_screen_row] / 正規化名の衝突 [screen_name_collision])。
//                         生成の失敗ではないので verdict は OK のままだが、
//                         **unparsed_line は「元図の遷移が欠けた」信号なので
//                         呼び出し側は件数を必ず人間に見せる** (skills 側の提示規約)。
//
// 派生 summary sidecar (`<出力 stem>.derive-summary.json`):
//   `.mmd` の隣に **同じ run の summary を永続化**する。`.mmd` は「既に存在すれば再生成しない」
//   運用 (人間の手修正を潰さないため) なので、後続 phase (Step 16 ゲート / 14-lite / fastpath) は
//   生成時の warnings を二度と取得できない — 特に unparsed_line (元図の遷移が欠けた信号) が
//   人間に届かなくなる。sidecar に残せば salvage の有無に関係なくゲートが読める。
//   `mmd_md5` を併記するので、`.mmd` がその後手修正されたかを読み手が判定できる
//   (不一致 = warnings は生成時点の情報)。**sidecar も決定論** — 時刻や backup パスは入れない。
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { InputError, matchScreens, norm, parseScreenList } from "./derive-screen-nav.mjs";

// ───────────────────────────── 定数 ─────────────────────────────

const DEFAULT_SOURCE = "requirements/03-user-flow.md";
const DEFAULT_SCREEN_LIST = "screens/00-screen-list.md";
const DEFAULT_OUT = "screens/00-transition-map.mmd";

/** 出力先頭の由来コメント (手編集の抑止 + 再生成手順の明示)。 */
export const HEADER_PREFIX = "%% generated by scripts/derive-transition-map.mjs from ";
export const HEADER_SUFFIX = " — 手編集する場合はソース側を直して再生成すること";

/** R2 で点線エッジに付加するマーカー (先頭の空白込み)。 */
export const INFERRED_SUFFIX = " ※ 推測 (inferred)";

/**
 * 逐語保持するマーカー。`※` と語の間の空白は「無し / 半角 / 全角」を等価に扱い、
 * 英語括弧つき表記まで 1 つの塊として退避する (check-marker-retention.mjs の
 * MARKER_PATTERN と同じ表記ゆれ方針。あちらは出現数を数えるだけなので括弧は見ない)。
 */
export const MARKER_PATTERN = /※[ 　]?(?:推測|不明)(?:[ 　]?\((?:inferred|unknown)\))?/g;

/** R1 合成ラベルの区切り (入エッジラベル » 菱形ラベル: 出エッジラベル)。 */
const FOLD_SEP_IN = " » ";
const FOLD_SEP_OUT = ": ";

// ノード形状の接尾辞。判定順序が重要: 引用符つき → 素、長い open → 短い open
// (`([` → `((` → `(` / `{{` → `{` / `[[` → `[`)。順序を崩すと `A((x))` が `(` + close `)` に
// 誤 match してラベルが壊れる。
//
// **shape 値は 3 種 (stadium / diamond / rect) に閉じる** — 下流の判定は
//   (a) foldDiamonds: `shape === "diamond"` か (R1 の畳み込み対象か)
//   (b) mergeSameLabelRects / applyScreenShapes / nodeDecl: `shape === "rect"` か
//       (画面一覧と突合する候補か / 出力を `id["..."]` にするか)
// の 2 択しか見ないため、新しい shape 名を増やさず既存 3 種へ寄せる。
// 丸角 `A(x)` / 円 `A((x))` / 六角 `A{{x}}` / サブルーチン `A[[x]]` は **菱形ではない**ので
// diamond には落とさず、いずれも `rect` として扱う (= 画面一覧と突合させる)。stadium に落とさ
// ないのは「画面かどうか」の権限が glyph ではなく `00-screen-list.md` (R3) にあるため —
// 突合できなければ R3 が stadium に変換するので、rect 起点は「候補として検査に載せる」だけの
// 安全側の選択になる (stadium 起点にすると screen として一度も検査されず孤児検出が沈黙する)。
const NODE_SUFFIXES = [
  { open: '(["', close: '"])', shape: "stadium" },
  { open: "([", close: "])", shape: "stadium" },
  { open: '(("', close: '"))', shape: "rect" }, // 円 (circle)
  { open: "((", close: "))", shape: "rect" },
  { open: '("', close: '")', shape: "rect" }, // 丸角 (rounded)
  { open: "(", close: ")", shape: "rect" },
  { open: '{{"', close: '"}}', shape: "rect" }, // 六角 (hexagon) — 菱形ではない
  { open: "{{", close: "}}", shape: "rect" },
  { open: '{"', close: '"}', shape: "diamond" },
  { open: "{", close: "}", shape: "diamond" },
  { open: '[["', close: '"]]', shape: "rect" }, // サブルーチン (subroutine)
  { open: "[[", close: "]]", shape: "rect" },
  { open: '["', close: '"]', shape: "rect" },
  { open: "[", close: "]", shape: "rect" },
];

// 受け付ける矢印。長いリテラルから順に判定する。
const ARROWS = [
  { lit: "<-.->", op: "<-->", dotted: true },
  { lit: "<-->", op: "<-->", dotted: false },
  { lit: "-.->", op: "-->", dotted: true },
  { lit: "-->", op: "-->", dotted: false },
];

// 遷移情報を持たない Mermaid 命令 (レイアウト / 装飾)。読み飛ばすが warning には残す。
const IGNORED_KEYWORD = /^(subgraph|end|direction|style|classDef|class|linkStyle|click)\b/;

const NO_HEADING = "(見出しなし)";

// ───────────────────────────── ラベル正規化 ─────────────────────────────

/** マーカーを 1 つ以上含むか (逐語保持と R2 の二重付加防止に使う)。 */
export function hasMarker(text) {
  if (text === undefined || text === null) return false;
  return new RegExp(MARKER_PATTERN.source).test(String(text));
}

const emptyToUndefined = (s) => (s === undefined || s === "" ? undefined : s);

/**
 * 生の山括弧を全角へ置換する。`.mmd` は `{{MERMAID_BLOCKS}}` として `00-transition-map.html` に
 * **生連結**され human gate でブラウザに開かれるため、`<` が残ると `</div><script>` 等が mermaid
 * コンテナを抜けて DOM に入る (組み立て段階で確定するので mermaid の securityLevel では防げない)。
 *
 * **ラベルだけでなく `.mmd` に出る全ての行に適用する** — `%%` は mermaid のコメント記法であって
 * HTML のエスケープではないので、ブロック見出しコメント (`%% from: <見出し>`) や由来コメントの
 * ソースパスも HTML パーサから見れば同じ 1 行のテキストである (ラベルだけ塞いで見出しを素通しにすると
 * 同じ経路が残る)。
 */
export const foldAngleBrackets = (s) => String(s).replace(/</g, "＜").replace(/>/g, "＞");

/**
 * ラベルを下流パーサが受け付ける 1 行文字列へ正規化する。
 * マーカーは sanitize 前に退避 → 後で逐語復元するため、内部の空白すら改変されない。
 * @returns {string|undefined} 空になった場合は undefined (ラベル無しエッジとして扱う)
 */
export function sanitizeLabel(raw) {
  if (raw === undefined || raw === null) return undefined;
  let s = String(raw).trim();
  const quoted = /^"([\s\S]*)"$/.exec(s);
  if (quoted) s = quoted[1];

  // マーカーは NUL 番号で退避する (NUL は \s にも本文にも現れないため、連続空白の圧縮や
  // 引用符正規化がマーカー内部に及ばない = 逐語保持が機械的に保証される)。
  const kept = [];
  s = s.replace(MARKER_PATTERN, (m) => {
    kept.push(m);
    return `\u0000${kept.length - 1}\u0000`;
  });
  s = s
    .replace(/<br\s*\/?>/gi, " ") // 改行タグ → 半角スペース (山括弧の全角化より前に処理する)
    .replace(/\|/g, "/") // 下流はエッジラベル内の `|` を許さない
    .replace(/"/g, "”") // 引用符の正規化 (id["..."] の囲みを曖昧にしない)
    .replace(/\s+/g, " ")
    .trim();
  s = foldAngleBrackets(s); // 残った生の山括弧 (理由は同関数の doc comment)
  s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => kept[Number(n)]);
  return emptyToUndefined(s);
}

// ───────────────────────────── ```mermaid ブロック抽出 (R4) ─────────────────────────────

/**
 * Markdown から ```mermaid ブロックを出現順に抽出する。
 * heading = ブロック直前に現れた最も近い見出し (`#`〜`######`) のテキスト。
 * @returns {{heading: string, code: string, startLine: number}[]}
 */
export function extractMermaidBlocks(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const blocks = [];
  let heading = NO_HEADING;
  let fence = null; // { marker, startLine, body[] }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (fence !== null) {
      if (new RegExp(`^\\s*${fence.marker}\\s*$`).test(line)) {
        blocks.push({ heading: fence.heading, code: fence.body.join("\n"), startLine: fence.startLine });
        fence = null;
      } else {
        fence.body.push(line);
      }
      continue;
    }
    const open = /^\s*(`{3,})\s*mermaid\s*$/.exec(line);
    if (open) {
      fence = { marker: open[1], heading, startLine: i + 2, body: [] };
      continue;
    }
    const h = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) heading = h[2].trim() || NO_HEADING;
  }
  // 閉じ忘れ fence は、そこまでの本文を 1 ブロックとして採用する (エッジを捨てない)
  if (fence !== null) {
    blocks.push({ heading: fence.heading, code: fence.body.join("\n"), startLine: fence.startLine });
  }
  return blocks;
}

// ───────────────────────────── Mermaid statement スキャナ ─────────────────────────────

/**
 * 1 行を statement 列へ分解する。走査は 1 パスで、`"` 引用と `|...|` エッジラベルの内側では
 * 区切らず・コメント判定もしない。
 *
 * **順序が要点**: `%%` 行コメントの除去を `;` 分割より**先に**行う。逆順にすると
 * `%% note; TODO` の後半が statement 扱いされ、`TODO` が幽霊ノードとして図に現れる。
 * 引用符・ラベルの内側を跨がないことで、`A -->|"保存; 閉じる"| B` のようにラベルに `;` を含む
 * 正常な statement が分断されてエッジ 1 本を丸ごと失う (unparsed_line 化する) のも防ぐ。
 * @returns {string[]} trim 済み・空要素を除いた statement 列
 */
export function splitStatements(rawLine) {
  const out = [];
  let buf = "";
  let inQuote = false;
  let inPipe = false;
  for (let i = 0; i < rawLine.length; i += 1) {
    const c = rawLine[i];
    if (c === '"') {
      inQuote = !inQuote;
    } else if (!inQuote && c === "|") {
      inPipe = !inPipe;
    } else if (!inQuote && !inPipe) {
      if (c === "%" && rawLine[i + 1] === "%") break; // 行コメント (`%%{init}%%` も丸ごと落ちる)
      if (c === ";") {
        out.push(buf);
        buf = "";
        continue;
      }
    }
    buf += c;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter((s) => s !== "");
}

/**
 * 1 statement を `node (arrow node)*` のトークン列に分解する (インライン宣言つきの
 * `A["x"] -->|l| B{"y"}` 形と、宣言のみの `A["x"]` 形の両方を受け付ける)。
 * 解釈できない形は null を返す (呼び出し側が warning に記録する = 黙って落とさない)。
 */
export function scanStatement(stmt) {
  const tokens = [];
  let i = 0;
  let expectNode = true;
  const skipSpace = () => {
    while (i < stmt.length && /\s/.test(stmt[i])) i += 1;
  };
  while (i < stmt.length) {
    skipSpace();
    if (i >= stmt.length) break;
    if (expectNode) {
      const id = /^[A-Za-z_]\w*/.exec(stmt.slice(i));
      if (id === null) return null;
      i += id[0].length;
      let shape;
      let label;
      for (const suffix of NODE_SUFFIXES) {
        if (!stmt.startsWith(suffix.open, i)) continue;
        const end = stmt.indexOf(suffix.close, i + suffix.open.length);
        if (end === -1) return null;
        shape = suffix.shape;
        label = stmt.slice(i + suffix.open.length, end);
        i = end + suffix.close.length;
        break;
      }
      tokens.push({ kind: "node", id: id[0], shape, label });
      expectNode = false;
      continue;
    }
    const arrow = ARROWS.find((a) => stmt.startsWith(a.lit, i));
    if (arrow === undefined) return null;
    i += arrow.lit.length;
    skipSpace();
    let label;
    if (stmt[i] === "|") {
      const end = stmt.indexOf("|", i + 1);
      if (end === -1) return null;
      label = stmt.slice(i + 1, end);
      i = end + 1;
    }
    tokens.push({ kind: "arrow", op: arrow.op, dotted: arrow.dotted, label });
    expectNode = true;
  }
  if (tokens.length === 0 || tokens.at(-1).kind !== "node") return null;
  return tokens;
}

// ───────────────────────────── ソースグラフ構築 (R4 / R6) ─────────────────────────────

/**
 * 全ブロックを 1 つのグラフに統合する。
 * node = { id, shape:'rect'|'stadium'|'diamond', label, block, order, explicit }
 * edge = { from, to, op:'-->'|'<-->', label?, dotted, seq:[blockIndex, seqNo] }
 * ノードの block / order は **初出位置** (bare 参照でも初出とみなす) を保持する。
 */
export function parseSourceGraph(blocks) {
  const nodes = new Map();
  const edges = [];
  const warnings = [];
  let nodeOrder = 0;
  let edgeOrder = 0;
  let dottedSource = 0;

  blocks.forEach((block, blockIndex) => {
    const registerNode = (id, shape, rawLabel) => {
      const label = shape === undefined ? undefined : sanitizeLabel(rawLabel);
      const existing = nodes.get(id);
      if (existing === undefined) {
        nodes.set(id, {
          id,
          // 宣言なしで参照されただけのノードは Mermaid 既定の矩形として扱う
          // (parseTransitionMap の implicit と同じ扱い)。ラベルは ID を流用する。
          shape: shape ?? "rect",
          label: label ?? id,
          block: blockIndex,
          order: (nodeOrder += 1),
          explicit: shape !== undefined,
        });
        return;
      }
      if (shape === undefined) return;
      if (!existing.explicit) {
        // 初出が bare 参照だった場合はラベル無しなので「衝突」ではない。形状とラベルを採用する
        // (初出位置 = 最初に参照されたブロックのまま保持する)。
        existing.shape = shape;
        existing.label = label ?? existing.label;
        existing.explicit = true;
        return;
      }
      if (existing.shape === shape && existing.label === label) return;
      warnings.push({
        type: "label_conflict",
        id,
        kept: { shape: existing.shape, label: existing.label },
        ignored: { shape, label },
        block: block.heading,
      });
    };

    for (const [lineIndex, rawLine] of block.code.split(/\r?\n/).entries()) {
      // コメント除去 + `;` 分割は splitStatements が 1 パスで行う (順序と引用符の扱いは同関数参照)
      for (const line of splitStatements(rawLine)) {
        if (/^(flowchart|graph)\b/.test(line)) continue; // ヘッダは出力側で固定する
        const context = { block: block.heading, line: block.startLine + lineIndex, text: line };
        if (IGNORED_KEYWORD.test(line)) {
          warnings.push({ type: "ignored_line", ...context });
          continue;
        }
        const tokens = scanStatement(line);
        if (tokens === null) {
          warnings.push({ type: "unparsed_line", ...context });
          continue;
        }
        for (const t of tokens) {
          if (t.kind === "node") registerNode(t.id, t.shape, t.label);
        }
        for (let k = 1; k < tokens.length; k += 2) {
          const arrow = tokens[k];
          if (arrow.dotted) dottedSource += 1;
          edges.push({
            from: tokens[k - 1].id,
            to: tokens[k + 1].id,
            op: arrow.op,
            label: sanitizeLabel(arrow.label),
            dotted: arrow.dotted,
            seq: [blockIndex, (edgeOrder += 1)],
          });
        }
      }
    }
  });

  return { nodes, edges, warnings, dottedSource };
}

// ───────────────────────────── R1: 菱形の畳み込み ─────────────────────────────

/**
 * 合成ラベル = `[lin (あれば)] » [D.label (+ lout があれば ": " + lout)]`。
 * 欠落時の振る舞いは対称で、**どちらのラベルも捨てない**:
 *   lin + lout → `lin » D.label: lout` / lin のみ → `lin » D.label` /
 *   lout のみ  → `D.label: lout`      / どちらも無し → `D.label`
 * (菱形の出エッジが無ラベル = 無条件の続きでも、入エッジのラベル [例「却下」] は
 *  遷移の条件そのものなので落としてはならない。)
 */
export function composeFoldedLabel(labelIn, diamondLabel, labelOut) {
  const base = diamondLabel ?? "";
  const lin = emptyToUndefined(labelIn);
  const lout = emptyToUndefined(labelOut);
  const head = lout === undefined ? base : `${base}${FOLD_SEP_OUT}${lout}`;
  return emptyToUndefined(lin === undefined ? head : `${lin}${FOLD_SEP_IN}${head}`);
}

/**
 * 菱形ノードを入エッジ × 出エッジの直積に畳む。菱形→菱形の連鎖は反復で解消し、畳めずに残った
 * 菱形はスタジアムに変換して warning に記録する = エッジを 1 本も消滅させない。
 *
 * **例外は畳んだ結果 `from == to` になったエッジで、落ち先が菱形でなければ drop する**
 * (`folded_self_loop`)。残すと L5 connectivity 検査が inbound / outbound を 1 本ずつ数え、実際には
 * 出口を持たない画面を dead_end として検出できず沈黙する (R5 の merged_self_loop と同じ規則 —
 * グラフ変換が作った偽の自己ループは残さない。元ソースに書かれていた自己遷移は R5 側で保持される)。
 * 落ち先が菱形の場合だけは残す (循環判定が自己ループの存在を手掛かりにしているため)。
 *
 * 畳み込みは **宣言順 (nodes の Map 挿入順 = 初出順) で決定論** — 毎回同じ菱形から畳むため
 * 同一入力 → byte 同一出力が保たれる。ただし合成ラベルは結合的では **ない**: 無ラベルの
 * 中間エッジを挟む菱形連鎖 (`A -->|lin| D --> B -->|lout2| C`) では宣言順に D → B と畳まれ、
 * `lin » D » B: lout2` 形 (通過した菱形ラベルを `»` で連結) になる。B から畳めば
 * `lin » D: B: lout2` になるため、順序が変われば結果も変わる (現行は宣言順で固定)。
 * @returns {number} 畳んで消えた菱形の数
 */
export function foldDiamonds(nodes, edges, warnings) {
  const isDiamond = (id) => nodes.get(id)?.shape === "diamond";

  // 双方向エッジが菱形に接している場合のみ 2 本の有向エッジへ展開する
  // (直積の向きを決定論にするため。菱形に無関係な `<-->` はそのまま保持する)。
  for (let i = edges.length - 1; i >= 0; i -= 1) {
    const e = edges[i];
    if (e.op !== "<-->" || !(isDiamond(e.from) || isDiamond(e.to))) continue;
    warnings.push({ type: "bidi_split_for_fold", from: e.from, to: e.to });
    edges.splice(
      i,
      1,
      { ...e, op: "-->", seq: [...e.seq, 0] },
      { ...e, op: "-->", from: e.to, to: e.from, seq: [...e.seq, 1] },
    );
  }

  let folded = 0;
  for (;;) {
    let target = null;
    for (const node of nodes.values()) {
      if (node.shape !== "diamond") continue;
      // 自己ループを持つ菱形は畳むと無限に増えるため対象外 (循環として後段でスタジアム化)
      if (edges.some((e) => e.from === node.id && e.to === node.id)) continue;
      const ins = edges.filter((e) => e.to === node.id);
      const outs = edges.filter((e) => e.from === node.id);
      if (ins.length === 0 || outs.length === 0) continue;
      target = { node, ins, outs };
      break;
    }
    if (target === null) break;
    const { node, ins, outs } = target;
    const composed = [];
    for (const a of ins) {
      for (const b of outs) {
        const label = composeFoldedLabel(a.label, node.label, b.label);
        if (a.from === b.to && !isDiamond(a.from)) {
          // 畳み込みが作った自己ループのうち **菱形以外** (= 画面になりうるノード) に落ちるものは
          // drop する (R5 の merged_self_loop と同じ理由 — 残すと L5 が inbound / outbound を
          // 1 本ずつ数え、出口の無い画面を dead_end として検出できず沈黙する)。
          // 「削除 → 確認 → いいえ → 元の画面」の往復がこの形になる。
          // 情報は warning で人間に渡す = 黙って消さない。
          //
          // 菱形に落ちる自己ループは **残す** — 菱形同士の循環判定 (diamond_cycle) が自己ループの
          // 存在を手掛かりにしており、消すと循環を「出エッジゼロ」と誤分類する。菱形は最終的に
          // スタジアム化して図に残るので、エッジを保持しても画面の検査を騙すことにはならない。
          warnings.push({
            type: "folded_self_loop",
            id: node.id,
            label: node.label,
            screen: a.from,
            dropped_label: label,
          });
          continue;
        }
        composed.push({
          from: a.from,
          to: b.to,
          op: "-->",
          label,
          dotted: Boolean(a.dotted || b.dotted),
          seq: [...a.seq, ...b.seq],
        });
      }
    }
    const dropped = new Set([...ins, ...outs]);
    for (let i = edges.length - 1; i >= 0; i -= 1) {
      if (dropped.has(edges[i])) edges.splice(i, 1);
    }
    edges.push(...composed);
    nodes.delete(node.id);
    folded += 1;
  }

  for (const node of nodes.values()) {
    if (node.shape !== "diamond") continue;
    const selfLoop = edges.some((e) => e.from === node.id && e.to === node.id);
    const ins = edges.filter((e) => e.to === node.id && e.from !== node.id);
    const outs = edges.filter((e) => e.from === node.id && e.to !== node.id);
    const type = selfLoop
      ? "diamond_cycle"
      : ins.length === 0
        ? "diamond_no_in_edges"
        : outs.length === 0
          ? "diamond_no_out_edges"
          : "diamond_cycle";
    warnings.push({ type, id: node.id, label: node.label });
    node.shape = "stadium";
  }
  return folded;
}

// ───────────────────────────── R2: 点線の正規化 ─────────────────────────────

/**
 * 点線エッジを実線化し、ラベルにマーカーが無いものだけへ ` ※ 推測 (inferred)` を付加する。
 * 実線エッジには一切触らない (根拠ありの遷移にマーカーを発明しない)。
 * @returns {number} マーカーを付加したエッジ数
 */
export function normalizeDotted(edges) {
  let marked = 0;
  for (const e of edges) {
    if (!e.dotted) continue;
    e.dotted = false;
    if (hasMarker(e.label)) continue;
    e.label = e.label === undefined ? INFERRED_SUFFIX.trimStart() : `${e.label}${INFERRED_SUFFIX}`;
    marked += 1;
  }
  return marked;
}

// ───────────────────────────── R5: 同名矩形ノードのマージ ─────────────────────────────

/**
 * 正規化ラベルが**完全一致**する矩形ノード同士を初出 ID へマージし、エッジを書き換える。
 * 正規化は derive-screen-nav.mjs の norm (NFKC + 空白/括弧除去 + 小文字化) を共有する。
 * fuzzy (包含・類似) マージは行わない — 曖昧なものは触らず L5 の人間レビューに委ねる。
 *
 * **マージで自己ループ化したエッジは drop する**: 同名ノード間のエッジ (`X["動画一覧"] --> Y["動画一覧"]`)
 * は書き換えで `X --> X` になる。これを残すと L5 connectivity 検査が inbound / outbound を
 * 1 本ずつ数えてしまい、実際には他画面と繋がっていないノードを孤児として検出できず沈黙する。
 * drop すれば in 0 / out 0 になり L5 が拾える (= 望むシグナル)。
 * **元ソースで最初から同一 ID の自己ループだったエッジ (`X --> X`) は保持する** — 作者が意図して
 * 書いた自己遷移であり、マージが作った偽の自己ループとは別物。
 * @returns {number} 消えたノード数
 */
export function mergeSameLabelRects(nodes, edges, warnings) {
  const firstByLabel = new Map();
  const remap = new Map();
  for (const node of nodes.values()) {
    if (node.shape !== "rect") continue;
    const key = norm(node.label);
    if (key === "") continue;
    const first = firstByLabel.get(key);
    if (first === undefined) {
      firstByLabel.set(key, node.id);
      continue;
    }
    remap.set(node.id, first);
    warnings.push({ type: "merged_same_label", id: node.id, merged_into: first, label: node.label });
  }
  for (const dup of remap.keys()) nodes.delete(dup);
  for (let i = edges.length - 1; i >= 0; i -= 1) {
    const e = edges[i];
    const originalFrom = e.from;
    const originalTo = e.to;
    e.from = remap.get(e.from) ?? e.from;
    e.to = remap.get(e.to) ?? e.to;
    if (e.from !== e.to || originalFrom === originalTo) continue;
    warnings.push({
      type: "merged_self_loop",
      from: originalFrom,
      to: originalTo,
      merged_into: e.from,
      ...(e.label !== undefined && { label: e.label }),
    });
    edges.splice(i, 1);
  }
  return remap.size;
}

// ───────────────────────────── R3: screen-list 突合による形状正規化 ─────────────────────────────

/**
 * 矩形ノードを 00-screen-list.md の行と突合し、突合できなかったものをスタジアムへ変換する
 * (モーダル・トースト・状態表示は画面一覧に存在しないのでスタジアムになる)。
 * 突合器は derive-screen-nav.mjs の matchScreens を共有する = 下流 L5 と同じ判定。
 *
 * **非矩形ノードが `遷移図ノードID` 宣言で行に束縛された場合は矩形へ昇格する** — 昇格しないと
 * その行は消費済み (= orphan_in_list にもならない) なのに glyph はスタジアムのままで、画面が
 * nav / L5 / 遷移図 HTML の凡例から無言で消える。「画面かどうかの権限は screen-list にある」
 * (R3 の原則) をここでも通す。非矩形が Pass 0 以外で束縛されることはない (Pass 1/2 の候補は
 * screen 形状のみ) ため、昇格の根拠は常に明示宣言。
 * @returns {{matched: number, converted: number, promoted: number}}
 */
export function applyScreenShapes(nodes, rows, warnings = []) {
  const probe = new Map();
  for (const node of nodes.values()) {
    probe.set(node.id, { ...node, category: node.shape === "rect" ? "screen" : "modal" });
  }
  const match = matchScreens({ nodes: probe, edges: [] }, rows);
  let matched = 0;
  let converted = 0;
  let promoted = 0;
  for (const node of nodes.values()) {
    if (node.shape !== "rect") {
      const row = match.nodeToRow.get(node.id);
      if (row === undefined) continue;
      warnings.push({ type: "node_id_promoted_to_screen", id: node.id, label: node.label, ref: row.ref });
      node.shape = "rect";
      promoted += 1;
      matched += 1;
      continue;
    }
    if (match.nodeToRow.has(node.id)) {
      matched += 1;
      continue;
    }
    node.shape = "stadium";
    converted += 1;
  }
  return { matched, converted, promoted };
}

// ───────────────────────────── 出力 (R4 順序 + 重複排除) ─────────────────────────────

const compareSeq = (a, b) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
};

const edgeKey = (e) => [e.from, e.op, e.label ?? "", e.to].join("\u0000");

/** 入力の出現順に並べ、同一 (from, op, label, to) を重複排除する。 */
export function finalizeGraph(nodes, edges) {
  const orderedNodes = [...nodes.values()].sort((a, b) => a.order - b.order);
  const sorted = [...edges].sort((a, b) => compareSeq(a.seq, b.seq));
  const seen = new Set();
  const orderedEdges = [];
  let deduped = 0;
  for (const e of sorted) {
    e.label = emptyToUndefined(e.label);
    const key = edgeKey(e);
    if (seen.has(key)) {
      deduped += 1;
      continue;
    }
    seen.add(key);
    orderedEdges.push(e);
  }
  return { orderedNodes, orderedEdges, deduped };
}

const nodeDecl = (node) => (node.shape === "rect" ? `${node.id}["${node.label}"]` : `${node.id}(["${node.label}"])`);

const edgeLine = (e) => `${e.from} ${e.op}${e.label === undefined ? "" : `|${e.label}|`} ${e.to}`;

/** ブロック単位に `%% from: <見出し>` で区切って .mmd 本文を組み立てる。 */
export function renderMmd(blocks, orderedNodes, orderedEdges, sourceLabel) {
  // コメント行も `.mmd` の一部として HTML に生連結されるため、見出しとソースパスにも
  // 山括弧の全角化を適用する (ノード / エッジのラベルは sanitizeLabel が済ませている)
  const lines = [`${HEADER_PREFIX}${foldAngleBrackets(sourceLabel)}${HEADER_SUFFIX}`, "flowchart TD"];
  blocks.forEach((block, blockIndex) => {
    const blockNodes = orderedNodes.filter((n) => n.block === blockIndex);
    const blockEdges = orderedEdges.filter((e) => e.seq[0] === blockIndex);
    if (blockNodes.length === 0 && blockEdges.length === 0) return;
    lines.push("", `  %% from: ${foldAngleBrackets(block.heading)}`);
    for (const node of blockNodes) lines.push(`  ${nodeDecl(node)}`);
    for (const e of blockEdges) lines.push(`  ${edgeLine(e)}`);
  });
  return `${lines.join("\n")}\n`;
}

// ───────────────────────────── 変換本体 ─────────────────────────────

/**
 * Markdown + screen-list テキストから .mmd 本文と summary を導出する (I/O なし・純関数)。
 * @throws {InputError} mermaid ブロックが 0 件 / screen-list に画面一覧テーブルが無い /
 *   **エッジが 0 本** (ブロックは読めたが遷移を 1 本も抽出できなかった = 未対応記法で全滅した疑い)
 */
export function derive({ markdown, screenListText, sourceLabel = DEFAULT_SOURCE }) {
  const blocks = extractMermaidBlocks(markdown);
  if (blocks.length === 0) {
    throw new InputError("ソースに ```mermaid ブロックが 1 つも見つからない (遷移図の材料が無い)");
  }
  const rows = parseScreenList(screenListText);
  const { nodes, edges, warnings, dottedSource } = parseSourceGraph(blocks);
  warnings.push(...rows.warnings); // 画面一覧側の警告 (遷移図ノードID の重複等) も人間に見せる
  const folded = foldDiamonds(nodes, edges, warnings);
  normalizeDotted(edges);
  const merged = mergeSameLabelRects(nodes, edges, warnings);
  const { matched, converted, promoted } = applyScreenShapes(nodes, rows.rows, warnings);
  const { orderedNodes, orderedEdges } = finalizeGraph(nodes, edges);
  if (orderedEdges.length === 0) {
    // mermaid ブロックは読めたのに遷移が 1 本も無い = 未対応記法で statement が全滅した疑い。
    // 空の遷移図を exit 0 で書くと「欠けたまま完成した」ことに誰も気づけないため落とす。
    const countOf = (type) => warnings.filter((w) => w.type === type).length;
    throw new InputError(
      `mermaid ブロック ${blocks.length} 件を読んだがエッジを 1 本も抽出できなかった ` +
        `(ノード ${orderedNodes.length} 件 / 解釈できなかった行 unparsed_line ${countOf("unparsed_line")} 件 / ` +
        `読み飛ばした行 ignored_line ${countOf("ignored_line")} 件)。` +
        `未対応の Mermaid 記法が含まれていないかソースを確認すること (空の遷移図は書き出さない)`,
    );
  }
  const mmd = renderMmd(blocks, orderedNodes, orderedEdges, sourceLabel);
  return {
    mmd,
    summary: {
      verdict: "OK",
      nodes: orderedNodes.length,
      edges: orderedEdges.length,
      folded_diamonds: folded,
      merged_nodes: merged,
      dotted_normalized: dottedSource,
      screen_matched: matched,
      stadium_converted: converted,
      promoted_to_screen: promoted,
      warnings,
    },
  };
}

// ───────────────────────────── CLI ─────────────────────────────

const USAGE =
  "usage: node scripts/derive-transition-map.mjs <artifacts/{app_name}> " +
  "[--source <path>] [--screen-list <path>] [--out <path>] [--force]";

export function parseArgs(argv) {
  const args = { appRoot: null, source: DEFAULT_SOURCE, screenList: DEFAULT_SCREEN_LIST, out: DEFAULT_OUT, force: false };
  const withValue = new Map([
    ["--source", "source"],
    ["--screen-list", "screenList"],
    ["--out", "out"],
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = withValue.get(arg);
    if (key !== undefined) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) return { error: `${arg} に値がありません` };
      args[key] = value;
      i += 1;
      continue;
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    if (arg.startsWith("--")) return { error: `不明なフラグ: ${arg}` };
    if (args.appRoot !== null) return { error: `引数が多すぎます: ${arg}` };
    args.appRoot = arg;
  }
  if (args.appRoot === null) return { error: "app ルート (artifacts/{app_name}) を指定してください" };
  return args;
}

const resolveIn = (appRoot, p) => (isAbsolute(p) ? p : join(appRoot, p));

// ───────────────────────────── self-backup (--force 上書き時) ─────────────────────────────

/**
 * 本 script が上書きしうるバックアップ対象成果物 (app ルート相対)。
 * 対象リストの正本は `pipeline.yaml` § `artifact_backup.targets` で、そのうち **本 script が書けるのは
 * 遷移図 SSoT / 派生 HTML の 2 つだけ** なのでここでは全許可リストを複製しない (`--out` で対象外の
 * パスを指定した場合は退避しない = hook と同じ許可リスト方式)。
 */
const BACKUP_TARGET = /^screens\/00-transition-map\.(mmd|html)$/;

const BACKUP_DIR_NAME = "_backup";

const md5Of = (path) => createHash("md5").update(readFileSync(path)).digest("hex");

/**
 * 既存の成果物を `_backup/{相対dir}/{stem}.{YYYYMMDD_HHMMSS}.{ext}` へ退避する。
 *
 * **現状この経路を通す呼び出しは repo 内に無い** (`--force` を渡す caller はゼロ — skills/reverse/06 /
 * skills/14 のファストパス / 14-lite の 3 箇所すべてが「`--force` は渡さない」と明記)。
 * それでも実装を持つのは、`pipeline.yaml` § `artifact_backup` が定めた「script 書き込みの
 * self-backup 義務」の参照実装であり、手動再導出 (人間が `--force` を付けて叩く運用) と将来の
 * delta 配線で最初に必要になる箇所だから。撤去すると配線した瞬間に義務の穴が開く。
 *
 * **なぜ script 側で退避するか**: PreToolUse hook (`.claude/hooks/backup-on-edit.sh`) は Write / Edit
 * ツールを matcher にしているため、Bash 経由 (= 本 script) の書き込みでは発火しない。
 * 規約 (ミラー配置 / md5 dedup / fail-open) は hook と同一 (`pipeline.yaml` § `artifact_backup`)。
 * cooldown は持たない — script の上書きは 1 回の実行で 1 度きりで、連続 Edit による増殖が起きない。
 *
 * 同型の実装が `skills/21g-graphic-embed-review/scripts/preflight.mjs` の `backupFile` にもあるが
 * import 共有はしない (skill 側の独立移動性を優先する既存方針に合わせる。加えて本実装は
 * 対象成果物の許可リスト判定を持ち [`--out` に任意パスを取れるため]、cooldown を持たない点が異なる)。
 *
 * **本 script の決定論契約とは無関係**: 時刻はバックアップの **ファイル名にのみ** 使い、
 * `.mmd` の出力内容には一切入らない (同一入力 → byte 同一出力は保たれる)。
 *
 * @returns {{dest?: string, warning?: string}} 退避した場合は `dest` (退避先パス)、**退避を試みて失敗した
 *   場合のみ** `warning` (理由文。fail-open で続行するが黙って失敗しないため summary / stderr に出す)。
 *   対象外 / 新規生成 / md5 dedup で skip した場合は空 object (「何もしなかった」= 従来と同じ)。
 */
export function selfBackup(appRoot, outPath) {
  try {
    if (!existsSync(outPath)) return {}; // 新規生成は対象外 (hook と同じ)
    const rel = relative(resolve(appRoot), resolve(outPath));
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return {}; // app ルート外
    const relPosix = rel.split(sep).join("/");
    if (!BACKUP_TARGET.test(relPosix)) return {}; // バックアップ対象成果物ではない

    const slash = relPosix.lastIndexOf("/");
    const base = relPosix.slice(slash + 1);
    const dot = base.lastIndexOf(".");
    const stem = dot === -1 ? base : base.slice(0, dot);
    const ext = dot === -1 ? "" : base.slice(dot + 1);
    const relDir = slash === -1 ? "" : relPosix.slice(0, slash); // app ルート直下なら _backup/ 直下
    const backupDir = join(appRoot, BACKUP_DIR_NAME, relDir);

    // md5 dedup: 直前バックアップと内容が同一なら複製しない (no-op rewrite の増殖防止)。
    // 「直前」は mtime 最新で選ぶ (hook の `ls -t` と同じ。同一秒の衝突連番 `-1` はファイル名順では
    // 無印より先に並ぶため、名前順では「直前」を取り違える)。
    if (existsSync(backupDir)) {
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`^${esc(stem)}\\..+${ext === "" ? "" : `\\.${esc(ext)}`}$`);
      const latest = readdirSync(backupDir)
        .filter((n) => pattern.test(n))
        .map((name) => ({ name, mtimeMs: statSync(join(backupDir, name)).mtimeMs }))
        .sort((a, b) => a.mtimeMs - b.mtimeMs || (a.name < b.name ? -1 : 1))
        .at(-1);
      if (latest !== undefined && md5Of(join(backupDir, latest.name)) === md5Of(outPath)) return {};
    }

    const d = new Date();
    const p2 = (n) => String(n).padStart(2, "0");
    const ts =
      `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_` +
      `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const nameOf = (suffix) => (ext === "" ? `${stem}.${ts}${suffix}` : `${stem}.${ts}${suffix}.${ext}`);
    mkdirSync(backupDir, { recursive: true });
    let dest = join(backupDir, nameOf(""));
    for (let i = 1; existsSync(dest); i += 1) dest = join(backupDir, nameOf(`-${i}`)); // 同一秒の衝突回避
    copyFileSync(outPath, dest);
    return { dest };
  } catch (e) {
    // fail-open: 退避できなくても本処理 (.mmd 生成) は止めない。ただし黙って失敗すると
    // 「上書き前の内容が残っていない」ことに誰も気づけないので、理由を呼び出し側へ返す。
    return { warning: e?.message ?? String(e) };
  }
}

// ───────────────────────────── 派生 summary sidecar ─────────────────────────────

/** 派生 summary sidecar のパス (`.mmd` と同じディレクトリ・同じ stem)。 */
export function sidecarPathFor(outPath) {
  const lastSep = Math.max(outPath.lastIndexOf("/"), outPath.lastIndexOf(sep));
  const dot = outPath.lastIndexOf(".");
  // 拡張子とみなすのは「区切りより後ろ、かつ basename の先頭でない `.`」 (dotfile の先頭 `.` を
  // 拡張子と誤認して stem が空になるのを防ぐ)
  const stem = dot > lastSep + 1 ? outPath.slice(0, dot) : outPath;
  return `${stem}.derive-summary.json`;
}

/**
 * 生成 run の summary を `.mmd` の隣へ永続化する (ヘッダ § 派生 summary sidecar)。
 * `.mmd` は「既に存在すれば再生成しない」運用なので、後続 phase は sidecar からしか
 * 生成時の warnings (特に unparsed_line) を知れない。
 * 内容は **決定論** — 時刻 / backup パス / 絶対パスを入れない (同一入力 → byte 同一)。
 * @returns {{path?: string, warning?: string}} fail-open (失敗しても `.mmd` 生成は止めない)
 */
export function writeSidecar(appRoot, outPath, summary, mmd, sourceLabel) {
  try {
    const doc = {
      derived_from: sourceLabel,
      mmd: relative(resolve(appRoot), resolve(outPath)).split(sep).join("/"),
      mmd_md5: createHash("md5").update(mmd).digest("hex"),
      summary,
    };
    const path = sidecarPathFor(outPath);
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
    return { path };
  } catch (e) {
    return { warning: e?.message ?? String(e) };
  }
}

/** app ルート配下なら相対パス (posix 表記) を、外なら与えられたパスをそのまま由来ラベルにする。 */
function sourceLabelFor(appRoot, sourcePath) {
  const rel = relative(resolve(appRoot), resolve(sourcePath));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return sourcePath;
  return rel.split(sep).join("/");
}

/**
 * CLI 1 回分を実行する (stdout / stderr へは書かない — 呼び出し側 main が担当)。
 * @returns {{exitCode: number, error?: string, summary?: object, out?: string, mmd?: string}}
 */
export function run(argv) {
  const args = parseArgs(argv);
  // 引数の形の誤りは **exit 1** (呼び出し側のバグ)。材料不足の fail-open (exit 2) と混ぜると、
  // フラグ typo で遷移図が無いまま静かに進む — ヘッダ § exit code 契約
  if (args.error !== undefined) return { exitCode: 1, error: `${args.error}\n${USAGE}` };

  const { appRoot } = args;
  if (!existsSync(appRoot) || !statSync(appRoot).isDirectory()) {
    return { exitCode: 2, error: `app ルートが見つからない: ${appRoot}` };
  }
  const sourcePath = resolveIn(appRoot, args.source);
  const listPath = resolveIn(appRoot, args.screenList);
  const outPath = resolveIn(appRoot, args.out);
  // `--out` は app ルート配下に限定する — 外へ書くと self-backup の許可リスト判定が効かず
  // 「退避なしで任意パスを上書き」が通ってしまう (sidecar の置き場も app 外に漏れる)
  const outRel = relative(resolve(appRoot), resolve(outPath));
  if (outRel === "" || outRel.startsWith("..") || isAbsolute(outRel)) {
    return { exitCode: 1, error: `--out は app ルート配下を指定してください: ${args.out}\n${USAGE}` };
  }
  if (!existsSync(sourcePath)) return { exitCode: 2, error: `ソースが見つからない: ${sourcePath}` };
  if (!existsSync(listPath)) return { exitCode: 2, error: `画面一覧が見つからない: ${listPath}` };
  if (existsSync(outPath) && !args.force) {
    return {
      exitCode: 2,
      error: `出力先が既存: ${outPath} (上書きするなら --force。完走済プロジェクトの SSoT を誤って潰さないための保護)`,
    };
  }

  const sourceLabel = sourceLabelFor(appRoot, sourcePath);
  let derived;
  try {
    derived = derive({
      markdown: readFileSync(sourcePath, "utf8"),
      screenListText: readFileSync(listPath, "utf8"),
      sourceLabel,
    });
  } catch (e) {
    if (e instanceof InputError) return { exitCode: 2, error: e.message };
    throw e;
  }

  // --force で既存 SSoT を上書きする経路は hook が発火しないため、script 側で退避する (fail-open)
  const backup = selfBackup(appRoot, outPath);
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, derived.mmd);
  // 生成時の warnings を後続 phase (Step 16 ゲート / 14-lite / fastpath) が読めるよう永続化する
  const sidecar = writeSidecar(appRoot, outPath, derived.summary, derived.mmd, sourceLabel);
  return {
    exitCode: 0,
    summary: {
      ...derived.summary,
      out: outPath,
      ...(sidecar.path !== undefined && { summary_sidecar: sidecar.path }),
      ...(sidecar.warning !== undefined && { sidecar_warning: sidecar.warning }),
      ...(backup.dest !== undefined && { backed_up: backup.dest }),
      ...(backup.warning !== undefined && { backup_warning: backup.warning }),
    },
    out: outPath,
    mmd: derived.mmd,
  };
}

export function main(argv) {
  const { exitCode, error, summary } = run(argv);
  if (error !== undefined) {
    process.stderr.write(`[derive-transition-map] ${error}\n`);
    return exitCode;
  }
  if (summary.backup_warning !== undefined) {
    // fail-open で続行した self-backup の失敗を 1 行だけ可視化する (exit code は 0 のまま)
    process.stderr.write(`[derive-transition-map] self-backup 失敗 (fail-open で続行): ${summary.backup_warning}\n`);
  }
  if (summary.sidecar_warning !== undefined) {
    // sidecar が無いと後続 phase が生成時 warnings を取得できないので、失敗を黙らせない
    process.stderr.write(`[derive-transition-map] 派生 summary の書き出し失敗 (fail-open で続行): ${summary.sidecar_warning}\n`);
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return exitCode;
}

// テストから import されたときは main() を走らせない (derive-screen-nav.mjs と同じ guard)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
