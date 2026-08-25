#!/usr/bin/env node
// scripts/expand-substate-plan.mjs
//
// sub-state expected files 展開の一本化スクリプト。
//
// 背景: expected files 算出 (4 次元 cartesian + dual-theme pair assertion + path parse) が
// 3 skill に prose 疑似コードとして三重実装されていた:
//   - skills/25b-state-pattern-gen/SKILL.md  Phase 1 / Phase 1b (cartesian + parse_sub_state_path + pair assertion + resume 差集合)
//   - skills/25c-state-pattern-score/SKILL.md Step 1-1b (parse を再利用した main HTML 逆引き)
//   - skills/25e-figma-pattern-export/SKILL.md Step 1-1 (cartesian + capture key 構築)
// LLM に毎回 path 組み立てを再実装させると theme suffix 分岐で特にミスりやすく、skill 間の
// 行番号引用も drift する。本スクリプトは 3 実装を決定論の単一実装に集約する
// (lint-screen-colors.mjs と同型: 決定論 script 化 + skill 側は node 呼び出しに置換)。
//
// 命名規約 (skills/25b の暗黙契約をそのまま機械可読化):
//   - screen 名は `--` (連続ハイフン) を含まない。単一 `-` は許容 (例: "01-login")。
//   - state 名も `--` を含まない。単一ハイフンは許容 (例: "modal-dialog", "validation-error")。
//   - theme は default / light / dark のみ (ハイフン含まず)。
//   - single-theme (themes==["default"] / themes 欠落 legacy): screens/{platform}/{screen}--{state}.html
//   - dual-theme  (themes==["light","dark"]):                 screens/{platform}/{screen}--{state}--{theme}.html
//
// dual_theme_mode の決定 (優先順):
//   1. --dual-theme-mode true|false (明示指定)
//   2. --requirements <requirements.json> — skills/25b Phase 0 の 3 段 fallback を移植
//      (ファイル不在 → false / design_output_scope 欠落 → false / dual_theme_mode 欠落 → false。
//       値が true 以外 (非 boolean 含む) は false 扱い = 疑似コードの `is True` 判定と同値)
//   3. どちらも未指定 → plan の themes から推定 (light/dark を 1 つでも含めば true)。
//      25a は dual_theme_mode から themes を導出するため plan と mode は本来同期している。
//
// 使い方:
//   node scripts/expand-substate-plan.mjs <state-pattern-plan.json> \
//       [--requirements <requirements.json>] [--dual-theme-mode true|false] \
//       [--diff <completed.json>]
//   node scripts/expand-substate-plan.mjs --parse <sub-state-path>
//
//   --diff <completed.json>: 完了済ファイル一覧との差集合 (pending) を算出する (中断 resume 用)。
//       入力は「パス文字列の JSON 配列」または「pipeline-state.json そのもの」
//       (後者は screens.step25b.completed_files[] を読む。欠落は [] 扱い)。
//       dual_theme_mode==true のときは完了側の light/dark 対称性も検査し、片 theme のみ完了の
//       triple を asymmetric_completed[] に報告する (前回 run が片 theme だけ書いて落ちた
//       resume 経路の自動回復)。不足側 path は現行 plan 内なら pending に含まれる
//       (recovered_paths)。plan 外の stale triple は stale_paths で報告のみ (生成を誘発しない)。
//   --parse <sub-state-path>: 単一 path を (platform, screen, state, theme) に分解し、
//       対応する main HTML パスを逆引きする (25c Step 1-1b の導出規則)。plan 引数は不要。
//
// 出力: stdout に JSON (整形済)。expected_files[] は path 文字列のみ (25b 用)、
//       expected[] は {key, html_path, platform, screen, state, theme} (25e 用。key は
//       figma-state.json nodes.screens のキーと同形式)。
//
// exit code:
//   0 = 成功
//   1 = plan 側の契約違反 (screen/state に "--"、theme enum 外、pair assertion 失敗 等)。
//       plan or 上流 code の bug を意味する (25b では Pattern C 記録 → 即中断に対応)。
//       stdout に ok:false の JSON を出す (skill 側が violations を読めるように)。
//   2 = 運用エラー (引数不正 / ファイル不在 / JSON parse 失敗)。stderr にメッセージ。
//
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const THEME_ENUM = new Set(["default", "light", "dark"]);
const DUAL_THEMES = ["light", "dark"]; // 順序も規約 (light → dark)
const PLATFORM_ENUM = new Set(["web", "web-sm", "mobile"]); // schemas/state-pattern-plan.schema.json の enum と同期 (web-sm = Web スマホ幅)

// ───────────────────── path parse (25b Phase 1b の逐語移植) ─────────────────────

// dual-theme 命名 "screens/{platform}/{screen}--{state}--{theme}.html" を分解する。
// default 命名 (theme suffix なし) / sub-state path でないものは null を返す (silently skip)。
// 末尾から "--{theme}" を切り出す (rpartition 相当) → 残りを先頭の "--" で screen/state に分割
// (partition 相当) することで、state 内の単一ハイフン (modal-dialog 等) を保持する。
export function parseSubStatePath(path) {
  if (typeof path !== "string") return null;
  if (!path.startsWith("screens/") || !path.endsWith(".html")) return null;
  const inner = path.slice("screens/".length, -".html".length); // "{platform}/{screen}--{state}--{theme}"
  const slash = inner.indexOf("/");
  if (slash < 0) return null;
  const platform = inner.slice(0, slash);
  const rest = inner.slice(slash + 1);
  if (!rest) return null;
  const sepIdx = rest.lastIndexOf("--"); // rpartition("--")
  if (sepIdx < 0) return null; // dual-theme path ではない
  const head = rest.slice(0, sepIdx); // "{screen}--{state}"
  const theme = rest.slice(sepIdx + 2);
  const sep2Idx = head.indexOf("--"); // partition("--")
  if (sep2Idx < 0) return null; // "--" が 1 つだけ = default 命名
  const screen = head.slice(0, sep2Idx);
  const state = head.slice(sep2Idx + 2);
  // 空要素は命名規約上あり得ない不正 path ("screens/web/--a--light.html" 等)。
  // parse 結果を pair assertion / diffCompleted の triple 集計に混入させないため null で弾く。
  if (!platform || !screen || !state || !theme) return null;
  // 命名契約の機械強制 (prose 疑似コードより厳格):
  // - state は "--" を含まない ("01-login--bad--state--light.html" は screen/state 境界が
  //   確定できない不正名。通すと diffCompleted が無効な recovered path を生成し得る)
  // - dual 命名の theme は light / dark のみ (それ以外の末尾 segment を theme と誤認しない)
  // screen は partition (最初の "--" で分割) の性質上 "--" を含み得ないため検査不要。
  if (state.includes("--")) return null;
  if (theme !== "light" && theme !== "dark") return null;
  return { platform, screen, state, theme };
}

// dual / single (default 命名) の両対応 parse。25c Step 1-1b の main 逆引き前段:
// まず dual として parse し、null なら default 命名として末尾の "--{state}" を切り出す。
// sub-state path でない (main HTML 等、"--" を含まない) 場合は null。
export function parseAnySubStatePath(path) {
  const dual = parseSubStatePath(path);
  if (dual !== null) return { ...dual, naming: "dual" };
  if (typeof path !== "string") return null;
  if (!path.startsWith("screens/") || !path.endsWith(".html")) return null;
  const inner = path.slice("screens/".length, -".html".length);
  const slash = inner.indexOf("/");
  if (slash < 0) return null;
  const platform = inner.slice(0, slash);
  const rest = inner.slice(slash + 1);
  const sepIdx = rest.lastIndexOf("--"); // rpartition("--")
  if (sepIdx < 0) return null; // suffix `--{state}` がない = sub-state path ではない
  const screen = rest.slice(0, sepIdx);
  const state = rest.slice(sepIdx + 2);
  if (!platform || !screen || !state) return null; // 空要素 ("screens//01-a--empty.html" 等) は不正 path
  // screen に "--" が残る = 3 segment 以上あるのに dual として parse できなかった不正名
  // ("{screen}--modal--dialog.html" 等)。single sub-state と誤認しない。
  if (screen.includes("--")) return null;
  // state == light|dark は dual-theme プロジェクトの main HTML ("{screen}--{theme}.html") の
  // 命名と区別がつかない (文法的曖昧性)。light / dark を state 名として予約不可とし、
  // main HTML を sub-state と誤認しない側に倒す (docstring 契約「main HTML 等は null」を維持)。
  if (state === "light" || state === "dark") return null;
  return { platform, screen, state, theme: "default", naming: "single" };
}

// 25c Step 1-1b の main_html_path 導出規則:
//   dual-theme 派生 → theme 別 main (screens/{platform}/{screen}--{theme}.html)
//   single-theme 派生 → suffix なし main (screens/{platform}/{screen}.html)
export function deriveMainHtmlPath(parsed) {
  if (parsed.theme === "default") {
    return `screens/${parsed.platform}/${parsed.screen}.html`;
  }
  return `screens/${parsed.platform}/${parsed.screen}--${parsed.theme}.html`;
}

// ───────────────────── 4 次元 cartesian 展開 (25b Phase 1 / 25e Step 1-1) ─────────────────────

// plan (state-pattern-plan.json の parse 済 object) から expected files を展開する。
// ループ順は screen (plan 順) → state → platform → theme (25b / 25e の疑似コードと同順)。
// themes 欠落 (legacy plan) は ["default"] と解釈する。
// 返り値: { expected: [{key, html_path, platform, screen, state, theme}], errors: [], warnings: [] }
// errors が非空のときは expected を使ってはならない (契約違反 = plan bug)。
export function expandPlan(plan) {
  const expected = [];
  const errors = [];
  const warnings = [];

  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { expected, errors: ["plan が object ではありません"], warnings };
  }
  if (!Array.isArray(plan.screens)) {
    return { expected, errors: ["plan.screens が配列ではありません"], warnings };
  }
  if (plan.screens.length === 0) {
    // 25a が proceed 選択で生成する plan は必ず 1 画面以上を含む。空 plan を exit 0 で通すと
    // 25b 側が「pending 0 件 = resume 完了済」と誤認して Phase 3 に直行してしまうため error にする。
    return { expected, errors: ["plan.screens が空配列です (生成対象 0 件 = 壊れた plan の疑い)"], warnings };
  }

  plan.screens.forEach((entry, i) => {
    const at = `screens[${i}]`;
    if (!entry || typeof entry !== "object") {
      errors.push(`${at}: entry が object ではありません`);
      return;
    }
    const { screen } = entry;
    if (typeof screen !== "string" || screen === "") {
      errors.push(`${at}.screen: 空でない文字列が必要です`);
      return;
    }
    if (screen.includes("--")) {
      errors.push(`${at}.screen: "${screen}" は連続ハイフン "--" を含みます (命名規約違反 — path parse が壊れる)`);
      return;
    }
    if (screen.includes("/")) {
      errors.push(`${at}.screen: "${screen}" は "/" を含みます (ファイル名規約違反)`);
      return;
    }
    if (!Array.isArray(entry.states) || entry.states.length === 0) {
      errors.push(`${at}.states: 非空配列が必要です`);
      return;
    }
    if (!Array.isArray(entry.platforms) || entry.platforms.length === 0) {
      errors.push(`${at}.platforms: 非空配列が必要です`);
      return;
    }
    const themes = "themes" in entry ? entry.themes : ["default"]; // legacy fallback
    if (!Array.isArray(themes) || themes.length === 0) {
      errors.push(`${at}.themes: 指定する場合は非空配列が必要です`);
      return;
    }

    let entryOk = true;
    for (const state of entry.states) {
      if (typeof state !== "string" || state === "" || state.includes("--") || state.includes("/")) {
        errors.push(`${at}.states: "${state}" が不正です (空 / "--" 含み / "/" 含み は命名規約違反)`);
        entryOk = false;
      } else if (state === "light" || state === "dark" || state === "default") {
        // light/dark は theme suffix ("{screen}--{theme}.html" = dual-theme main HTML) と
        // 命名衝突するため state 名として予約不可。default は main HTML として Step 17 で
        // 生成済のため plan に含めない (schema の states description と同一制約)。
        errors.push(`${at}.states: "${state}" は state 名として使えません (theme suffix / main HTML と命名衝突する予約語)`);
        entryOk = false;
      }
    }
    for (const platform of entry.platforms) {
      if (!PLATFORM_ENUM.has(platform)) {
        errors.push(`${at}.platforms: "${platform}" は enum {web, mobile} 外です`);
        entryOk = false;
      }
    }
    for (const theme of themes) {
      if (!THEME_ENUM.has(theme)) {
        errors.push(`${at}.themes: "${theme}" は enum {default, light, dark} 外です`);
        entryOk = false;
      }
    }
    if (themes.includes("default") && themes.some((t) => t === "light" || t === "dark")) {
      errors.push(
        `${at}.themes: default と light/dark の混在は不正です (同一画面で命名規則が割れる)`,
      );
      entryOk = false;
    }
    if (!entryOk) return;

    for (const state of entry.states) {
      for (const platform of entry.platforms) {
        for (const theme of themes) {
          let key, htmlPath;
          if (theme === "default") {
            // single-theme: theme suffix なし (legacy / dual_theme_mode=false 互換)
            key = `${platform}/${screen}--${state}`;
            htmlPath = `screens/${platform}/${screen}--${state}.html`;
          } else {
            // dual-theme: --{theme} suffix 付き
            key = `${platform}/${screen}--${state}--${theme}`;
            htmlPath = `screens/${platform}/${screen}--${state}--${theme}.html`;
          }
          expected.push({ key, html_path: htmlPath, platform, screen, state, theme });
        }
      }
    }
  });

  // 重複検出 (plan に同一 screen entry が二重登録されている等)。展開結果は faithful に残し警告のみ。
  const seen = new Set();
  for (const e of expected) {
    if (seen.has(e.html_path)) {
      warnings.push(`重複 path: ${e.html_path} (plan.screens に重複 entry がある可能性)`);
    }
    seen.add(e.html_path);
  }

  return { expected, errors, warnings };
}

// ───────────────────── dual-theme pair assertion (25b Phase 1b expected 側) ─────────────────────

// expected files のうち dual-theme 命名の path を (screen, state, platform) triple で束ね、
// theme 集合が {light, dark} と完全一致することを検査する。
// default 命名 path は parse が null を返すため対象外 (25b と同挙動)。
// 返り値: violations 配列 (空 = pass)。
export function assertThemePairs(expectedFiles) {
  const triples = new Map(); // JSON.stringify([screen, state, platform]) → Set<theme> (JSON key で名前中の任意文字と衝突しない)
  for (const path of expectedFiles) {
    const parsed = parseSubStatePath(path);
    if (parsed === null) continue;
    const k = JSON.stringify([parsed.screen, parsed.state, parsed.platform]);
    if (!triples.has(k)) triples.set(k, new Set());
    triples.get(k).add(parsed.theme);
  }
  const violations = [];
  for (const [k, themesSet] of triples) {
    const isPair = themesSet.size === 2 && themesSet.has("light") && themesSet.has("dark");
    if (!isPair) {
      const [screen, state, platform] = JSON.parse(k);
      violations.push({ screen, state, platform, themes: [...themesSet].sort() });
    }
  }
  return violations;
}

// ───────────────────── resume 差集合 + 完了側対称性回復 (25b Phase 1 / 1b) ─────────────────────

// pending = expected - completed (expected の順序を保持)。
// dualThemeMode==true のときは completed 側の light/dark 対称性も検査し、片 theme のみ完了の
// triple は不足 theme の path を pending に補完する (重複追加はしない)。
// **prose 疑似コードからの意図的な安全側逸脱**: 補完は現行 plan (expected) 内の path に限定する。
// plan から rename / 削除された画面の completed 残骸 (stale triple) まで enqueue すると
// main HTML の無い画面の sub-state 生成を誘発するため、stale 分は stale_paths[] で報告のみに留める。
// (なお expected 内の不足 path は差集合の時点で必ず pending に含まれるため、enqueue は実質 defensive。)
// 返り値: { pending: [path],
//           asymmetricCompleted: [{screen, state, platform, present_themes, recovered_paths, stale_paths}] }
//   recovered_paths = 不足 theme のうち現行 plan 内の path (pending に含まれることを保証)
//   stale_paths     = 不足 theme のうち現行 plan 外の path (報告のみ、生成は誘発しない)
export function diffCompleted(expectedFiles, completedFiles, dualThemeMode) {
  const expectedSet = new Set(expectedFiles);
  const completedSet = new Set(completedFiles);
  const pending = expectedFiles.filter((p) => !completedSet.has(p));
  const pendingSet = new Set(pending); // 回復 append 時の重複チェックを O(1) にする (pending と常に同期)
  const asymmetricCompleted = [];

  if (dualThemeMode === true) {
    const completedTriples = new Map();
    for (const path of completedFiles) {
      const parsed = parseSubStatePath(path);
      if (parsed === null) continue;
      const k = JSON.stringify([parsed.screen, parsed.state, parsed.platform]);
      if (!completedTriples.has(k)) completedTriples.set(k, new Set());
      completedTriples.get(k).add(parsed.theme);
    }
    for (const [k, themesSet] of completedTriples) {
      const isPair = themesSet.size === 2 && themesSet.has("light") && themesSet.has("dark");
      if (isPair) continue;
      // 前回 run が片 theme だけ書いて落ちた → 不足側を pending に強制追加して再生成
      const [screen, state, platform] = JSON.parse(k);
      const recovered = [];
      const stale = [];
      for (const theme of DUAL_THEMES) {
        if (themesSet.has(theme)) continue;
        const path = `screens/${platform}/${screen}--${state}--${theme}.html`;
        if (expectedSet.has(path)) {
          if (!pendingSet.has(path)) {
            pending.push(path);
            pendingSet.add(path);
          }
          recovered.push(path);
        } else {
          stale.push(path); // 現行 plan 外 (rename / 削除後の残骸) — 報告のみ
        }
      }
      asymmetricCompleted.push({
        screen,
        state,
        platform,
        present_themes: [...themesSet].sort(),
        recovered_paths: recovered,
        stale_paths: stale,
      });
    }
  }

  return { pending, asymmetricCompleted };
}

// ───────────────────── dual_theme_mode の解決 ─────────────────────

// 優先順: 明示 flag → requirements.json (3 段 fallback) → plan からの推定。
// 返り値: { value: boolean, source: "flag"|"requirements"|"inferred", warnings: [] }
export function resolveDualThemeMode({ flag, requirementsPath, expected }) {
  const warnings = [];
  if (flag !== undefined) {
    return { value: flag, source: "flag", warnings };
  }
  if (requirementsPath !== undefined) {
    let raw;
    try {
      raw = readFileSync(requirementsPath, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") {
        // requirements.json 不在 (Standalone entry の最小 stub 未配置等) → single-mode fallback。
        // dual_theme は明示宣言が必須なので欠落 = false 扱いが安全側。
        return { value: false, source: "requirements", warnings };
      }
      throw e;
    }
    const requirements = JSON.parse(raw); // parse 失敗は呼び出し側で運用エラー (exit 2) に落とす
    const v = requirements?.design_output_scope?.dual_theme_mode;
    if (v !== undefined && typeof v !== "boolean") {
      warnings.push(`requirements.json の dual_theme_mode が boolean ではありません (${JSON.stringify(v)}) — false 扱い`);
    }
    return { value: v === true, source: "requirements", warnings };
  }
  const inferred = (expected ?? []).some((e) => e.theme === "light" || e.theme === "dark");
  return { value: inferred, source: "inferred", warnings };
}

// ───────────────────── summary ─────────────────────

// 全 entry の (state 数 × platform 数 × theme 数) が均一なら "N 画面 × s state × p platform × t theme = 計 件"
// の定型文を返す (25b Step 3-4 完了報告の pattern_summary)。非均一なら合計のみ。
export function buildSummary(plan, expected) {
  const entries = Array.isArray(plan?.screens) ? plan.screens : [];
  const dims = entries.map((e) => ({
    s: Array.isArray(e?.states) ? e.states.length : 0,
    p: Array.isArray(e?.platforms) ? e.platforms.length : 0,
    t: "themes" in (e ?? {}) && Array.isArray(e.themes) ? e.themes.length : 1,
  }));
  const uniform =
    dims.length > 0 && dims.every((d) => d.s === dims[0].s && d.p === dims[0].p && d.t === dims[0].t);
  const summary = {
    total: expected.length,
    screen_count: entries.length,
    states: [...new Set(expected.map((e) => e.state))],
    platforms: [...new Set(expected.map((e) => e.platform))],
    themes: [...new Set(expected.map((e) => e.theme))],
  };
  summary.pattern_summary = uniform
    ? `${dims.length} 画面 × ${dims[0].s} state × ${dims[0].p} platform × ${dims[0].t} theme = ${expected.length} 件`
    : `非均一 plan: 合計 ${expected.length} 件`;
  return summary;
}

// ───────────────────── completed files 入力の読み取り ─────────────────────

// --diff の入力: パス文字列の JSON 配列、または pipeline-state.json そのもの
// (screens.step25b.completed_files[] を読む。欠落は [] 扱い = 25b の default [])。
// 返り値: { files, warnings }。screens key 自体が無い object は「pipeline-state.json ではない
// 別 JSON を誤って渡した」疑いがあるため、無言で 0 件扱いにせず warning で可視化する
// (0 件扱い自体は維持 — 完了済 sub-state の意図しない全件再生成を skill 側が気付ける形にする)。
export function readCompletedFiles(parsed) {
  const warnings = [];
  let list;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === "object") {
    if (!("screens" in parsed)) {
      warnings.push(
        "--diff 入力に screens key がありません (pipeline-state.json ではない別 JSON の可能性) — completed 0 件として扱います",
      );
    }
    list = parsed?.screens?.step25b?.completed_files ?? [];
    if (!Array.isArray(list)) {
      throw new Error("screens.step25b.completed_files が配列ではありません");
    }
  } else {
    throw new Error("--diff 入力は JSON 配列または pipeline-state.json 形式の object が必要です");
  }
  for (const p of list) {
    if (typeof p !== "string") {
      throw new Error(`--diff 入力に文字列でない要素があります: ${JSON.stringify(p)}`);
    }
  }
  return { files: list, warnings };
}

// ───────────────────── CLI ─────────────────────

const USAGE = `usage:
  node scripts/expand-substate-plan.mjs <state-pattern-plan.json> \\
      [--requirements <requirements.json>] [--dual-theme-mode true|false] [--diff <completed.json>]
  node scripts/expand-substate-plan.mjs --parse <sub-state-path>`;

// 運用エラー (exit 2) 用の sentinel。process.exit() は stdout/stderr の flush 前にプロセスを
// 落として大きい JSON 出力が途中で切れるため使わない — throw して isMain 側で exitCode を立て、
// プロセスは自然終了 (flush 完了後) に任せる。
class CliError extends Error {
  constructor(msg) {
    super(msg);
    this.exitCode = 2;
  }
}

function operationalError(msg) {
  throw new CliError(msg);
}

function readJsonFile(path, label) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    operationalError(`${label} を読めません: ${path} (${e.message})`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    operationalError(`${label} が JSON として parse できません: ${path} (${e.message})`);
  }
}

// stdout に JSON を書き exit code を予約する。process.exit() は呼ばない (flush 待ちのため)。
// 呼び出し側は emit 後ただちに return して main を抜けること。
function emit(obj, exitCode) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
  process.exitCode = exitCode;
}

function main() {
  const argv = process.argv.slice(2);
  const opts = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--parse" || a === "--requirements" || a === "--dual-theme-mode" || a === "--diff") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) operationalError(`${a} に値がありません`);
      opts[a.slice(2)] = v;
      i++;
    } else if (a.startsWith("--")) {
      operationalError(`不明なオプション: ${a}`);
    } else {
      opts.positional.push(a);
    }
  }

  // ── --parse モード (25c Step 1-1b: 単一 path 分解 + main 逆引き) ──
  if (opts.parse !== undefined) {
    const parsed = parseAnySubStatePath(opts.parse);
    if (parsed === null) {
      emit(
        {
          ok: false,
          path: opts.parse,
          error:
            "sub-state path として parse できません (期待形式: screens/{platform}/{screen}--{state}[--{theme}].html)",
        },
        1,
      );
      return;
    }
    emit(
      {
        ok: true,
        path: opts.parse,
        platform: parsed.platform,
        screen: parsed.screen,
        state: parsed.state,
        theme: parsed.theme,
        naming: parsed.naming,
        main_html_path: deriveMainHtmlPath(parsed),
      },
      0,
    );
    return;
  }

  // ── 展開モード ──
  if (opts.positional.length !== 1) {
    operationalError("state-pattern-plan.json のパスを 1 つ指定してください");
  }
  const planPath = opts.positional[0];
  const plan = readJsonFile(planPath, "state-pattern-plan.json");

  let dualThemeFlag;
  if (opts["dual-theme-mode"] !== undefined) {
    if (opts["dual-theme-mode"] !== "true" && opts["dual-theme-mode"] !== "false") {
      operationalError(`--dual-theme-mode は true|false のみ (got: ${opts["dual-theme-mode"]})`);
    }
    dualThemeFlag = opts["dual-theme-mode"] === "true";
  }

  const { expected, errors, warnings } = expandPlan(plan);
  if (errors.length > 0) {
    emit({ ok: false, plan_path: planPath, errors, warnings }, 1);
    return;
  }

  let dualResolved;
  try {
    dualResolved = resolveDualThemeMode({
      flag: dualThemeFlag,
      requirementsPath: opts.requirements,
      expected,
    });
  } catch (e) {
    operationalError(`requirements.json の読み取りに失敗: ${e.message}`);
  }
  warnings.push(...dualResolved.warnings);

  // dual_theme_mode と plan の themes の食い違いを可視化する (requirements.json と
  // state-pattern-plan.json の drift の疑い)。mode=false 側に倒れると pair assertion /
  // resume 対称性回復が skip されて theme 付き path が無警告で流れるため、warning で気付ける形にする。
  // source=inferred は plan 自身から推定した値なので食い違いは発生しない。
  const planHasDualThemes = expected.some((e) => e.theme === "light" || e.theme === "dark");
  if (dualResolved.value !== planHasDualThemes) {
    warnings.push(
      `dual_theme_mode=${dualResolved.value} (source=${dualResolved.source}) と plan の themes (light/dark ${planHasDualThemes ? "あり" : "なし"}) が食い違っています — requirements.json と state-pattern-plan.json の drift の疑い`,
    );
  }

  const expectedFiles = expected.map((e) => e.html_path);

  // pair assertion (25b Phase 1b expected 側)。dual_theme_mode=false のときは skip (25b と同挙動)。
  if (dualResolved.value === true) {
    const violations = assertThemePairs(expectedFiles);
    if (violations.length > 0) {
      emit(
        {
          ok: false,
          plan_path: planPath,
          dual_theme_mode: true,
          dual_theme_mode_source: dualResolved.source,
          error: "dual-theme pair assertion 失敗: light/dark が非対称な triple があります (plan bug — Pattern C 相当)",
          violations,
          warnings,
        },
        1,
      );
      return;
    }
  }

  const result = {
    ok: true,
    plan_path: planPath,
    app_name: typeof plan.app_name === "string" ? plan.app_name : null,
    dual_theme_mode: dualResolved.value,
    dual_theme_mode_source: dualResolved.source,
    summary: buildSummary(plan, expected),
    expected_files: expectedFiles,
    expected,
    warnings,
  };

  if (opts.diff !== undefined) {
    const diffParsed = readJsonFile(opts.diff, "--diff 入力");
    let completedFiles;
    try {
      const read = readCompletedFiles(diffParsed);
      completedFiles = read.files;
      warnings.push(...read.warnings);
    } catch (e) {
      operationalError(e.message);
    }
    const { pending, asymmetricCompleted } = diffCompleted(
      expectedFiles,
      completedFiles,
      dualResolved.value,
    );
    result.completed_count = completedFiles.length;
    result.pending = pending;
    result.pending_count = pending.length;
    result.asymmetric_completed = asymmetricCompleted;
  }

  emit(result, 0);
}

function isMain() {
  // process.argv[1] は相対パスのことがあるため、絶対 file URL に正規化してから比較する
  // (wcag-contrast.mjs と同じガード)。
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) {
  try {
    main();
  } catch (e) {
    if (e instanceof CliError) {
      process.stderr.write(`[expand-substate-plan] ${e.message}\n${USAGE}\n`);
      process.exitCode = e.exitCode;
    } else {
      process.stderr.write(`[expand-substate-plan] ${e.stack || e.message}\n`);
      process.exitCode = 2;
    }
  }
}
