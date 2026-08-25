#!/usr/bin/env node
// scripts/lint-design-samples-structure.mjs
//
// Step 09 サンプル HTML (3 案 A/B/C 切替式) の「色だけ違う・構造同じ」退化を
// 機械検出する決定論 linter。
//
// 背景 (実測確定): Step 09 の 3 案が StudyLoop で「色だけ違う同じ画面」に退化した。原因はテンプレ
// ではなく、上流 design-brief の layout が free-text で「意味的に潰れる」(A=「単列主体」/ B=「単列
// レイアウト主体」/ C=「非対称単列」のように字面別だが全部単列) こと。Step 09 agent は忠実転記する
// ので上流が潰れれば下流も潰れる。
//
// 確定設計: layout を「主コンテンツ一覧クラス (content_anchor)」に錨を打った **構造記述子**
// で持ち、3 案の記述子タプルが全ペア相違かを exact 比較する (LLM 不要・色相 30° 差メトリクスと同格の
// crisp 判定)。content_anchor に錨を打つので装飾 (overlay/underline/::before/::after・border・shadow
// 等) は対象外となり、キーワード除外リスト無しで装飾ノイズを排除できる。
//
// 構造記述子 = content_anchor 各クラスの **構造プロパティ署名** (= 下記 STRUCTURAL_PROPS + grid の
// columns) を variant (A/B/C) ごとに再導出したマップ。装飾プロパティ (background / border / box-shadow
// / border-radius / color / gap / padding 等) は **意図的に含めない** — これらは「色だけ違う」退化で
// も必ず変わるため、含めると退化を見逃す。**検証する署名集合の SoT は本ファイルの STRUCTURAL_PROPS
// 定数**であり、SKILL.md / agent.md の散文記述ではない (doc は本定数を参照する)。
//
// brief の記述子タプル {list_container, columns, item_layout} と本 linter の関係:
//   - list_container → content_anchor[0] の display/flex-direction に直接対応 (grid/flex-column/flex-row/stack)。
//   - columns        → grid のとき grid-template-columns の track 数に直接対応。
//   - item_layout    → **item クラス (content_anchor[1..]) の display/flex-direction として realize された分だけ**
//                      間接検証される。photo-left(flex,row) vs fullbleed(block) のように display/direction に
//                      差が出れば拾えるが、両方とも block-flow で width/padding だけ違う item_layout 差は
//                      **機械検出しない** (= caveat「粗すぎ risk」の境界)。したがって「タプルを exact 比較」
//                      ではなく「content_anchor 各クラスの構造CSS署名を全 variant 間で exact 比較」が正確な表現。
//   - **二層の関係**: Step08 は (a) brief レベルで記述子タプルの distinct を自己判定し、(b) content_anchor
//     を本 linter に渡す。本 linter は 08 の宣言値とは突合せず、**生成 HTML の A/B/C 署名を相互比較**する
//     (= 判定の SoT は HTML 相互比較。08 宣言↔09 再導出の cross-check ではない)。08 と 09 は別レイヤーで
//     独立に distinctness を検査する二段防御であり、宣言↔実体の照合機構ではない。
//
// 既知の限界 (4ロールレビュー反映・いずれも fail-loud と Step08 で吸収):
//   - 【variant 文法】variant 別の構造規則は `:root[data-variant="X"] .anchor` 形のみ読む。
//     `.screen-a .anchor` (子孫スコープ) / `#screen-x .anchor` (id スコープ) に構造差を置くと
//     再導出できず UNRESOLVED になる。→ agent 規約で「per-variant 構造は data-variant スコープに書く」
//     を強制 (ayatori-sample-html-builder.md Phase 3.0/4.1)。
//   - 【false-PASS】記述子マップは class 名で keyed する (container↔item の役割を保つため。MoneyGrow の
//     A=縦リスト×横行 と C=横カルーセル×縦カード は方向 multiset が同一でも役割が逆なので別物と判定できる)。
//     その代償として、3 案が「別クラス名・同一構造」(例: 全部 flex-column を list-a/list-b/list-c と名付ける)
//     だと present-vs-null で distinct 扱いになり PASS してしまう。ただしこの退化は Step08 の brief レベル
//     タプル比較 (3 案の {list_container,columns,item_layout} 全異) が第一の防衛線で先に FAIL させる。
//     役割を捨てた multiset 比較に変えると MoneyGrow が誤 FAIL するため、本 linter は class 名 keyed を維持する。
//
// 判定: variant ごとの記述子マップが全ペア (A-B / A-C / B-C) で相違なら PASS、1 ペアでも一致なら FAIL。
//   - StudyLoop/mobile: 3 案とも study-cards=flex,column・study-card に display 差ゼロ → A=B=C → FAIL
//   - RamenLog/android: A=record-grid:grid2列 / B=record-list:flex縦+record-card:flex / C=record-list:flex縦
//     → 全ペア相違 → PASS
//   - RamenLog/ios:     A=records-grid:grid2列+card block / B=flex縦+card横 / C=flex縦+card縦 → PASS
//   (実データ検証で上記 3 件の PASS/FAIL 分離を実証)
//
// 位置付け:
//   - Step 08 が各 case に content_anchor + 記述子を宣言 (= 判定の SoT。宣言↔検証の二元化を避ける)。
//   - Step 09 orchestrator (main session・Bash(node:*) 許可済) が生成 HTML から本 linter で記述子を
//     再導出して全ペア相違を再検証する (subagent は Bash 不可のため enforcement の正本は orchestrator)。
//   - 衝突時は **hard-block でなく fail-loud** (exit 1 + collisions 出力)。orchestrator は衝突ペアを
//     名指しで bounded 再生成 → 上限で Step 10 人間ゲートに「構造差不足の可能性」フラグを上げる。
//     hard-block にしないのは「粗すぎ risk」(B/C を gap/grid-areas/カード深部でのみ分けるアプリが
//     誤 FAIL → 無限ループ化) を避けるため。
//
// content_anchor は **Step 08 が宣言した値を引数で渡す** (--anchors)。auto-discovery で全構造クラスを
// 拾う方式は採らない — それは「あらゆる variant 構造規則を数える」却下案そのもので、StudyLoop の
// 装飾 display 切替を誤カウントして false PASS になるため (錨を装飾でなく中身=主コンテンツ一覧に
// 打つのが分離の鍵)。
//
// 使い方:
//   node scripts/lint-design-samples-structure.mjs --anchors "record-grid,record-list,record-card" <file.html> [more.html ...]
//   node scripts/lint-design-samples-structure.mjs --anchors "study-cards,study-card" --variants A,B,C <file.html>
//   stdout: JSON ({ all_passed, has_structure_fail, has_tooling_issue, results: [...] })。
//   exit code: 0=全 PASS / 1=構造 FAIL (退化の疑い) / 2=usage error /
//              3=tooling/転記 issue のみ (ファイル不在=ERROR・anchor 不在=UNRESOLVED。構造退化ではないので
//                 orchestrator は fail-open で skip 扱いにする)。FAIL と ERROR/UNRESOLVED が混在したら 1 を優先。
//
// 依存: Node.js のみ (npm 依存ゼロ・外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。
// YAML を読まない (content_anchor は引数経由) ため yaml パーサ不要。orchestrator (LLM) が
// design-brief.yaml から content_anchor を抽出して --anchors に渡す (AYATORI パターン: LLM 抽出 →
// script 決定論検証)。

import { readFileSync, existsSync } from "node:fs";

// ───────────────────────────── 定数 ─────────────────────────────

// 記述子に含める「構造」プロパティ (これだけが distinct 判定の対象)。
// 装飾系 (background / border / box-shadow / border-radius / color / gap / padding / margin) は
// 意図的に除外 — 「色だけ違う」退化でも変わるため、含めると退化を見逃す。
const STRUCTURAL_PROPS = new Set([
  "display",
  "flex-direction",
  "flex-wrap",
  "grid-auto-flow",
  // grid-template-columns は columns (track 数) に正規化して別途格納するため、ここには入れない
]);
// 上記のうち flex-direction / flex-wrap / grid-auto-flow は CSS 既定値が存在するため、deriveClassSig 内で
// 「未指定 == 既定値の明示」を署名上同一に正規化する (flex-direction=row / flex-wrap=nowrap / grid-auto-flow=row)。
// これをしないと「一方が既定値を明示・他方が未指定」のペアを偽の構造差として distinct 扱いし、退化を見逃す。

const DEFAULT_VARIANTS = ["A", "B", "C"];

// ───────────────────────────── CSS パース ─────────────────────────────

// 全 <style>...</style> ブロックの中身を連結して返す
function extractStyle(html) {
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let out = "";
  let m;
  while ((m = re.exec(html)) !== null) out += m[1] + "\n";
  return out;
}

// CSS コメント /* ... */ を除去
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// brace-aware に rule (selector { body }) を収集する。
// @media / @supports / @keyframes 等の at-rule はラッパーを剥がして内側の rule も拾う
// (構造判定に必要な container/item rule は通常 at-rule 外だが、安全側に倒して内側も走査する)。
function collectRules(css) {
  const rules = [];
  let i = 0;
  const n = css.length;
  let selBuf = "";
  let atDepth = 0;
  while (i < n) {
    const ch = css[i];
    if (ch === "{") {
      const sel = selBuf.trim();
      selBuf = "";
      if (sel.startsWith("@") && /^@(media|supports|document|layer|container)/i.test(sel)) {
        // at-rule ラッパー: 内側を通常 rule として走査するため body へ降りる
        atDepth++;
        i++;
        continue;
      }
      // 通常 rule (または @keyframes 内の 0%/100% 等): body を brace 対応で読む
      let depth = 1;
      let body = "";
      i++;
      while (i < n && depth > 0) {
        const c = css[i];
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) break;
        }
        if (depth > 0) body += c;
        i++;
      }
      i++; // 閉じ } を消費
      rules.push({ sel, body });
    } else if (ch === "}") {
      // at-rule ラッパーの閉じ
      if (atDepth > 0) atDepth--;
      i++;
    } else {
      selBuf += ch;
      i++;
    }
  }
  return rules;
}

// body ("prop: value; prop: value") を {prop: value} に分解 (lowercase prop)
function parseDecls(body) {
  const decls = {};
  for (const part of body.split(";")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (prop) decls[prop] = value;
  }
  return decls;
}

// ───────────────────────────── セレクタ照合 ─────────────────────────────

// セレクタ s が「素の .className」(完全一致) か
function isPlainClass(s, className) {
  return s === "." + className;
}

// セレクタ s が "{:root|html}[data-variant="X"] .className" 形なら variant X を返す (else null)。
// クラス名の後ろは行末でなければならない (= :active / ::after / .modifier / -suffix を排除)。
function variantOfClass(s, className) {
  const esc = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    "^(?::root|html)\\[data-variant=[\"']?([A-Za-z0-9_-]+)[\"']?\\]\\s+\\." + esc + "$"
  );
  const m = s.match(re);
  return m ? m[1] : null;
}

// ───────────────────────────── 記述子導出 ─────────────────────────────

// grid-template-columns の値から track 数を数える。
// "1fr 1fr" → 2 / "repeat(2, 1fr)" → 2 / "repeat(2, 1fr 80px)" → 4 / "1fr 2fr 1fr" → 3
function countGridTracks(value) {
  if (!value) return null;
  let v = value.trim();
  if (v === "none") return null;
  // repeat(N, X) を N*(X の track 数) に展開
  v = v.replace(/repeat\(\s*(\d+)\s*,\s*([^)]*)\)/gi, (_, n, inner) => {
    const k = countTokens(inner);
    return new Array(Number(n) * Math.max(k, 1)).fill("1fr").join(" ");
  });
  return countTokens(v);
}

// 括弧内の空白を無視してトップレベル token 数を数える (minmax(0,1fr) 等を 1 と数える)
function countTokens(value) {
  let depth = 0;
  let count = 0;
  let inToken = false;
  for (const ch of value.trim()) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(ch)) {
      inToken = false;
    } else {
      if (!inToken) count++;
      inToken = true;
    }
  }
  return count;
}

// className について variant X の **有効構造プロパティ** を導出する。
// base (.className) を variant (:root[data-variant=X] .className) で上書きした merge 結果のうち、
// STRUCTURAL_PROPS + columns(grid track 数) だけを正規化して返す。
// rule が一切無い (base も variant も無い) なら null (= "absent": その variant では未使用)。
function deriveClassSig(rules, className, variant) {
  let base = null;
  let vrule = null;
  for (const r of rules) {
    for (const rawSel of r.sel.split(",")) {
      const s = rawSel.trim();
      if (isPlainClass(s, className)) {
        base = Object.assign(base || {}, parseDecls(r.body));
      } else if (variantOfClass(s, className) === variant) {
        vrule = Object.assign(vrule || {}, parseDecls(r.body));
      }
    }
  }
  if (base === null && vrule === null) return null;
  const merged = Object.assign({}, base || {}, vrule || {});
  // flex-flow shorthand を flex-direction / flex-wrap longhand に分解する。
  // linter は longhand (STRUCTURAL_PROPS) しか見ないため、agent が longhand 指示に反して
  // shorthand (`flex-flow: column`) に書くと「未指定 == 既定 row」と誤読し、本当は縦の構造を
  // 横と取り違えて退化 (色だけ違う同一構造) を false-PASS で見逃す (レビュー指摘 [yena-hwang])。
  // longhand が明示されていればそちらを優先 (CSS 仕様どおり後勝ちにはしない = merge 済み値を上書きしない)。
  if (merged["flex-flow"] != null) {
    for (const tok of merged["flex-flow"].toLowerCase().split(/\s+/)) {
      if (/^(row|row-reverse|column|column-reverse)$/.test(tok) && merged["flex-direction"] == null)
        merged["flex-direction"] = tok;
      else if (/^(nowrap|wrap|wrap-reverse)$/.test(tok) && merged["flex-wrap"] == null)
        merged["flex-wrap"] = tok;
    }
  }
  const sig = {};
  for (const prop of STRUCTURAL_PROPS) {
    // 値は lowercase + 連続空白を 1 つに畳んで trim する。"row  dense" と "row dense" のような
    // 内部空白だけの差を偽の構造差にしない (grid-auto-flow を署名対象に格上げした分の盲点を塞ぐ)。
    if (merged[prop] != null) sig[prop] = merged[prop].toLowerCase().replace(/\s+/g, " ").trim();
  }
  // CSS 既定値の正規化: 「未指定」と「既定値の明示」は意味的に同義なので署名上は同一に潰す。
  // (これをしないと「一方が既定値を明示・他方が未指定」のペアを偽の構造差として distinct 扱いし、
  //  退化を false-PASS で見逃す — レビュー指摘 [Copilot])。
  //   - flex コンテナ: flex-direction 既定 row / flex-wrap 既定 nowrap を補完。
  //   - grid コンテナ: grid-auto-flow 既定 row を補完。
  //   - 非 flex/非 grid の要素では flex-*/grid-auto-flow は inert (無効) なので署名から落とす
  //     (inert な明示宣言が偽の構造差を生むのを防ぐ)。
  const isFlex = sig.display === "flex" || sig.display === "inline-flex";
  const isGrid = sig.display === "grid" || sig.display === "inline-grid";
  if (isFlex) {
    if (sig["flex-direction"] == null) sig["flex-direction"] = "row";
    if (sig["flex-wrap"] == null) sig["flex-wrap"] = "nowrap";
  } else {
    delete sig["flex-direction"];
    delete sig["flex-wrap"];
  }
  if (isGrid) {
    if (sig["grid-auto-flow"] == null) sig["grid-auto-flow"] = "row";
  } else {
    delete sig["grid-auto-flow"];
  }
  // columns は grid コンテナ (grid/inline-grid) のときだけ記録する (flex/block に grid-template-columns が
  // 紛れても署名に入れない = 意味的に不正な「flex なのに columns」署名を避ける。レビュー指摘 [Arch MEDIUM])。
  // grid-auto-flow 正規化と同じ isGrid スコープに揃える (inline-grid で columns だけ非記録になる非対称を排除)。
  // grid で track 数を取れない (auto track 等) 場合は 1 とみなさず未記録のまま (不定値を入れない)。
  if (isGrid && merged["grid-template-columns"] != null) {
    const cols = countGridTracks(merged["grid-template-columns"]);
    if (cols != null) sig.columns = cols;
  }
  return sig;
}

// variant の記述子 = anchor 各クラスの構造署名マップ
function deriveDescriptor(rules, anchors, variant) {
  const d = {};
  for (const c of anchors) d[c] = deriveClassSig(rules, c, variant);
  return d;
}

// 2 つの記述子マップが構造的に相違か (deep equal の否定)
function descriptorsDistinct(a, b) {
  return JSON.stringify(canon(a)) !== JSON.stringify(canon(b));
}

// キー順を安定化して JSON 比較に使う
function canon(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = canon(obj[k]);
  return out;
}

// ───────────────────────────── 1 ファイル検査 ─────────────────────────────

function lintFile(file, anchors, variants) {
  const html = readFileSync(file, "utf8");
  const css = stripComments(extractStyle(html));
  const rules = collectRules(css);

  const descriptors = {};
  for (const v of variants) descriptors[v] = deriveDescriptor(rules, anchors, v);

  // 転記不全 (brief↔HTML のクラス名不一致 / typo / agent のクラス改名) の検出。
  // 指定 anchor がどの variant の CSS にも 1 つも実体化していなければ、全 variant の記述子が
  // 揃って null になり「全ペア一致 → FAIL」に倒れるが、これは構造退化ではなく転記不全。
  // 別カテゴリ UNRESOLVED として返し、構造 FAIL と区別する (レビュー指摘 [Harness HIGH / 天才 HIGH])。
  const anyResolved = anchors.some((c) => variants.some((v) => descriptors[v][c] !== null));
  if (!anyResolved) {
    return {
      file,
      anchors,
      variants,
      descriptors,
      verdict: "UNRESOLVED",
      reason:
        "指定された content_anchor がどの variant の CSS にも見つかりません (brief↔HTML のクラス名不一致 / typo / agent のクラス改名の疑い)。構造退化ではなく転記不全として扱い、anchor 名を確認するか agent に同名で再生成させてください。",
    };
  }

  const pairs = {};
  const collisions = [];
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      const a = variants[i];
      const b = variants[j];
      const distinct = descriptorsDistinct(descriptors[a], descriptors[b]);
      pairs[`${a}-${b}`] = { distinct };
      if (!distinct) {
        collisions.push({
          pair: `${a}-${b}`,
          reason: "案間の構造記述子 (content_anchor の display/flex-direction/columns) が完全一致 — 構造差が無く色だけ違う退化の疑い",
        });
      }
    }
  }

  const all_distinct = collisions.length === 0;
  return {
    file,
    anchors,
    variants,
    descriptors,
    pairs,
    collisions,
    verdict: all_distinct ? "PASS" : "FAIL",
  };
}

// ───────────────────────────── CLI ─────────────────────────────

function parseArgs(argv) {
  const out = { anchors: null, variants: DEFAULT_VARIANTS.slice(), files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--anchors") {
      out.anchors = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--variants") {
      out.variants = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "-h" || a === "--help") {
      out.help = true;
    } else if (a.startsWith("--")) {
      out.error = `unknown option: ${a}`;
    } else {
      out.files.push(a);
    }
  }
  return out;
}

const USAGE = `lint-design-samples-structure — Step 09 サンプル HTML の 3 案構造差を機械検証

使い方:
  node scripts/lint-design-samples-structure.mjs --anchors "<class,...>" <file.html> [more.html ...]

オプション:
  --anchors  "a,b,c"   content_anchor (主コンテンツ一覧クラス) を comma 区切りで指定 (必須)。
                       Step 08 が design-brief.yaml の cases[X].layout.descriptor.content_anchor で
                       宣言した値の和集合を渡す。
  --variants "A,B,C"   比較する variant (既定: A,B,C)。

出力: stdout に JSON { all_passed, has_structure_fail, has_tooling_issue, results: [...] }。
exit: 0=全 PASS / 1=構造 FAIL (退化の疑い) / 2=usage error / 3=tooling・転記 issue のみ (ファイル不在=ERROR /
      anchor 不在=UNRESOLVED。構造退化ではないので orchestrator は fail-open で skip する)。`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE + "\n");
    process.exit(0);
  }
  if (args.error) {
    process.stderr.write(args.error + "\n\n" + USAGE + "\n");
    process.exit(2);
  }
  if (!args.anchors || args.anchors.length === 0) {
    process.stderr.write(
      "ERROR: --anchors は必須です (content_anchor を auto-discovery しない設計 — 全構造クラスを拾うと装飾 display 切替で false PASS になるため)。\n\n" +
        USAGE +
        "\n"
    );
    process.exit(2);
  }
  if (args.files.length === 0) {
    process.stderr.write("ERROR: 検査対象 HTML ファイルを 1 つ以上指定してください。\n\n" + USAGE + "\n");
    process.exit(2);
  }

  const results = [];
  for (const f of args.files) {
    if (!existsSync(f)) {
      results.push({ file: f, verdict: "ERROR", error: "file not found" });
      continue;
    }
    try {
      results.push(lintFile(f, args.anchors, args.variants));
    } catch (e) {
      results.push({ file: f, verdict: "ERROR", error: String(e && e.message ? e.message : e) });
    }
  }

  const has_structure_fail = results.some((r) => r.verdict === "FAIL");
  const has_tooling_issue = results.some((r) => r.verdict === "ERROR" || r.verdict === "UNRESOLVED");
  const all_passed = results.every((r) => r.verdict === "PASS");
  process.stdout.write(
    JSON.stringify({ all_passed, has_structure_fail, has_tooling_issue, results }, null, 2) + "\n"
  );
  // exit: 1=構造 FAIL (退化) が最優先 / 3=tooling・転記 issue のみ (fail-open skip 対象) / 0=全 PASS
  let code = 0;
  if (has_structure_fail) code = 1;
  else if (has_tooling_issue) code = 3;
  process.exit(code);
}

main();
