#!/usr/bin/env node
// scripts/profile-context.mjs
//
// Claude Code セッションの **context 消費プロファイラ**。
// `~/.claude/projects/<project>/<session>.jsonl` (harness が書く会話ログ) を解析し、
// 「どの message が、どれだけ context window を食っているか」を source / tool / skill / file
// 単位で可視化する自己完結 HTML レポートを **決定論的に** 生成する。
// render-color-report.mjs / render-deviations-view.mjs と同じ「解析 → derived HTML view」パターン。
//
// 用途 (harness / pipeline デバッグ):
//   - どの source (tool_result / assistant text / attachment ...) が bytes を食っているか
//   - tool_result を **どの tool** (Read / Bash / Write ...) と **どの file/command** が生んだか
//   - **同じ file の再 Read** (×N) = 純粋な無駄。context 削減の最優先レバー
//   - **どの /ayatori-* skill** の実行中に消費が起きたか
//   - **複数ファイル出力**: index (全体 rollup + session の By size 一覧) + session ごとの
//     detail ページ (context 構成バー + 縦型 timeline)。index から各 detail へリンク。
//
// 出力 (既定 artifacts/_reports/):
//   context-profile.html          … index。全体内訳 + session 一覧 (By size) + detail へのリンク。
//   context-profile/<id>.html     … session ごとの detail。構成バー + 縦 timeline。
//
// 既定 scope: 現 project の、実際に /ayatori-* コマンドを起動した session のみ (prose 言及は除外)。
// 依存: Node.js のみ (npm 依存ゼロ、外部 CLI 不要 = CLAUDE.md Operating Principle 1 適合)。
//
// 使い方:
//   node scripts/profile-context.mjs                       # 現 project の AYATORI session を解析 → artifacts/_reports/ へ
//   node scripts/profile-context.mjs --all                 # /ayatori-* フィルタを外し全 session
//   node scripts/profile-context.mjs --project <name>      # 別 project (~/.claude/projects/<name>)
//   node scripts/profile-context.mjs --session <file.jsonl># 単一 session ファイルだけ
//   node scripts/profile-context.mjs --out-dir <dir>       # 出力ディレクトリを明示 (既定 artifacts/_reports)
//   node scripts/profile-context.mjs --window <tokens>     # context window 上限を明示 (既定は model+peak から推定)
//   node scripts/profile-context.mjs --json                # HTML の代わりに解析 JSON を stdout へ
//
// npm 経由: npm run profile:context -- [flags]

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join, basename, resolve } from "node:path";

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name) { return argv.includes(`--${name}`); }
function opt(name, def = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}
if (flag("help") || flag("h") || argv.includes("-h")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n"));
  process.exit(0);
}

const AS_JSON = flag("json");
const SINGLE = opt("session");                 // a single .jsonl file
const OUT_DIR = opt("out-dir");
const WINDOW_RAW = opt("window");
const WINDOW_OVERRIDE = WINDOW_RAW == null ? null : Number(WINDOW_RAW);
if (WINDOW_OVERRIDE != null && (!Number.isFinite(WINDOW_OVERRIDE) || WINDOW_OVERRIDE <= 0)) {
  console.error(`[profile-context] invalid --window value: ${JSON.stringify(WINDOW_RAW)} (expected a positive token count, e.g. --window 1000000)`);
  process.exit(1);
}
// --session targets one file explicitly, so never filter it out; --all disables the AYATORI filter.
const ALL = flag("all") || !!SINGLE;           // include non-AYATORI sessions

// The context-window LIMIT is not recorded in the transcript (usage has only counts),
// and the recorded model id does NOT distinguish window variants (a [1m] session still
// logs plain "claude-opus-4-8"), so the peak is the only signal: the smallest standard
// window the peak fits into. A peak > 200k proves the 1M window; a 1M session that never
// crossed 200k is indistinguishable from a 200k one — pass --window to override.
// Returns tokens.
function inferWindow(peakCtx) {
  if (WINDOW_OVERRIDE != null) return WINDOW_OVERRIDE;
  if (peakCtx == null) return 200000;
  if (peakCtx <= 200000) return 200000;
  return 1000000;
}

// derive the project dir. Default: map the current working dir the way Claude Code does
// (every non-alphanumeric char -> '-', so separators, dots AND underscores all fold),
// matching ~/.claude/projects/<slug>. e.g. /Users/a.b/dev/x_y -> -Users-a-b-dev-x-y
function projectSlug(dir) {
  return dir.replace(/[^A-Za-z0-9]/g, "-");
}
const PROJECTS_ROOT = join(homedir(), ".claude", "projects");
const projectName = opt("project") || projectSlug(process.cwd());
const PROJECT_DIR = join(PROJECTS_ROOT, projectName);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function parseTs(ts) {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms / 1000;
}
function normSkill(name) {
  if (!name) return null;
  return String(name).trim().replace(/^\//, "").replace("acad-", "ayatori-");
}
function shortenPath(p) {
  if (!p) return "";
  const parts = String(p).split("/");
  return parts.length > 3 ? parts.slice(-3).join("/") : p;
}

// A *real* /ayatori-* (or legacy /acad-*) invocation: the harness command envelope
// (<command-name>/X</command-name> with a <command-message> sibling) inside a USER turn,
// or a Skill tool_use. Prose mentions / assistant quotes do NOT count.
const REAL_CMD_RE = /<command-name>\s*\/(acad-[a-z0-9-]+|ayatori-[a-z0-9-]+)\s*<\/command-name>/g;
const ANY_CMD_RE = /<command-name>\s*([^<]+?)\s*<\/command-name>/;

// Targets are kept at FULL length here (file tools return the full path) so the
// re-read ledger keys on the real file — two different files sharing a 3-segment
// suffix must not merge into one ×N counter. Shortening happens only at display
// time via displayTarget() / shortenPath().
function toolTarget(name, inp) {
  if (!inp || typeof inp !== "object") return "";
  if (["Read", "Edit", "Write", "NotebookEdit"].includes(name)) {
    return inp.file_path || inp.notebook_path || "";
  }
  if (name === "Bash") return String(inp.command || "").trim().split("\n")[0].slice(0, 70);
  if (name === "Skill") return inp.skill || "";
  if (name === "Agent") return inp.subagent_type || String(inp.description || "").slice(0, 40);
  if (name === "Glob" || name === "Grep") return String(inp.pattern || "").slice(0, 50);
  if (name === "ToolSearch") return String(inp.query || "").slice(0, 50);
  if (name === "TodoWrite") {
    const n = Array.isArray(inp.todos) ? inp.todos.length : 0;
    const cur = Array.isArray(inp.todos) ? inp.todos.find((td) => td?.status === "in_progress") : null;
    return cur?.content ? `${n} todos · ${String(cur.content).slice(0, 44)}` : `${n} todos`;
  }
  if (name === "AskUserQuestion") {
    const qs = inp.questions;
    if (Array.isArray(qs) && qs.length) {
      const first = qs[0]?.header || qs[0]?.question || "";
      return qs.length > 1 ? `${first} +${qs.length - 1} more` : String(first).slice(0, 50);
    }
    return "";
  }
  // MCP tool: mcp__<server>__<method> — the method is the meaningful bit.
  if (name.startsWith("mcp__")) return name.split("__").slice(2).join("__") || name;
  return "";
}
function toolFamily(name) {
  if (name == null) return "unknown";
  if (name.startsWith("mcp__")) return "MCP";
  if (name.startsWith("subagent:")) return "Agent";
  return name;
}
// Display form of a target: file paths are shortened to their last 3 segments; other
// targets (Bash commands, patterns, ...) may legitimately contain slashes and pass through.
const PATH_TOOLS = new Set(["Read", "Edit", "Write", "NotebookEdit"]);
function displayTarget(name, tgt) {
  return PATH_TOOLS.has(name) ? shortenPath(tgt) : tgt;
}

// text of a message's content (concat of text blocks or the raw string)
function msgText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && typeof b === "object" && b.type === "text")
      .map((b) => b.text || "")
      .join(" ");
  }
  return "";
}

// A short human-readable headline from free text: first non-empty, non-markup line,
// stripped of markdown decoration, clamped to `max` chars. Used to give assistant / user /
// reminder rows a meaningful label instead of a generic "reply" / "prompt".
function headline(text, max = 64) {
  if (!text) return "";
  let s = String(text)
    // drop harness / tool envelopes that aren't the human-meaningful content
    .replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, " ")
    .replace(/<local-command-[a-z-]+>[\s\S]*?<\/local-command-[a-z-]+>/g, " ")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ")
    .replace(/<[^>]+>/g, " ");
  // first line that has real words
  const line = s
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && /[A-Za-z0-9　-鿿]/.test(l));
  if (!line) return "";
  const clean = line
    .replace(/^#{1,6}\s+/, "")          // md heading
    .replace(/^[-*>]\s+/, "")            // list / quote marker
    .replace(/`{1,3}/g, "")              // code fences / inline code ticks
    .replace(/\*\*|__/g, "")             // bold
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
}

function classify(obj, toolById) {
  const t = obj.type;
  const msg = obj.message;
  const sub = obj.isSidechain ? "subagent:" : "";

  if (t === "attachment") {
    // attachments ARE context the model sees (skill / tool / agent listings, todo reminders).
    // Label them by their kind, humanized, so the row isn't blank.
    const kind = obj.attachment?.type || "?";
    return { source: `attachment:${kind}`, detail: kind.replace(/_/g, " "), tool: null };
  }
  if (["queue-operation", "ai-title", "last-prompt", "file-history-snapshot"].includes(t))
    return { source: `meta:${t}`, detail: t, tool: null };
  if (!msg || typeof msg !== "object") return { source: `other:${t}`, detail: t, tool: null };

  const role = msg.role;
  const content = msg.content;
  const blockTypes = [];
  let text = "";

  if (Array.isArray(content)) {
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      blockTypes.push(b.type);
      if (b.type === "text") text += b.text || "";
      else if (b.type === "tool_result") {
        const c = b.content;
        if (typeof c === "string") text += c;
        else if (Array.isArray(c)) for (const cb of c) if (cb?.type === "text") text += cb.text || "";
      }
    }
  } else if (typeof content === "string") text = content;

  if (role === "assistant") {
    if (blockTypes.includes("tool_use")) {
      // tool_use rows: show tool + its target (file / command / skill) so the row reads
      // e.g. "Read → skills/07-human-gate-req/SKILL.md". A message may batch several parallel
      // tool_use blocks — label consistently from the FIRST one and count the rest.
      const tus = content.filter((b) => b && b.type === "tool_use");
      const tu = tus[0];
      const tgt = displayTarget(tu.name, toolTarget(tu.name, tu.input));
      const more = tus.length > 1 ? ` (+${tus.length - 1} more)` : "";
      return { source: `${sub}assistant:tool_use`, detail: (tgt ? `${tu.name} → ${tgt}` : tu.name) + more, tool: tu.name };
    }
    // assistant prose: a snippet of what Claude actually said, not a generic "reply".
    return { source: `${sub}assistant:text`, detail: headline(text) || "reply", tool: null };
  }
  if (role === "user") {
    if (blockTypes.includes("tool_result")) {
      const trBlock = content.find((b) => b && b.type === "tool_result");
      const meta = toolById.get(trBlock?.tool_use_id) || {};
      return { source: `${sub}tool_result`, detail: meta.target ? displayTarget(meta.name, meta.target) : "", tool: meta.name };
    }
    // NOTE: check claude_md BEFORE system-reminder — the harness may deliver the
    // CLAUDE.md payload wrapped inside a <system-reminder> envelope, and the more
    // specific bucket must win.
    if (text.includes("# claudeMd")) return { source: "claude_md", detail: "CLAUDE.md project-instructions", tool: null };
    if (text.includes("<system-reminder>")) {
      // reminders carry real content the model sees — surface a headline of it.
      return { source: "system-reminder", detail: headline(text) || "injected", tool: null };
    }
    // a typed slash-command turn: label it with the command itself (the envelope, which
    // headline() strips, IS the meaningful content here).
    if (text.includes("<command-name>")) {
      const cm = ANY_CMD_RE.exec(text);
      const body = headline(text);
      const cmd = cm ? `/${normSkill(cm[1])}` : "command";
      return { source: `${sub}user:text`, detail: body ? `${cmd} — ${body}` : cmd, tool: null };
    }
    // real user turn: the actual prompt headline.
    return { source: `${sub}user:text`, detail: headline(text) || "prompt", tool: null };
  }
  return { source: `other:${role}:${t}`, detail: t, tool: null };
}

// ---------------------------------------------------------------------------
// per-session analysis
// ---------------------------------------------------------------------------
// Stream line-by-line (readline) in a SINGLE pass instead of slurping the whole file:
// transcripts can be hundreds of MB, and holding raw string + line array + parsed objects
// simultaneously multiplies the heap several-fold (readFileSync would also hard-fail past
// Node's ~512 MB string cap). One pass suffices because a tool_use always appears BEFORE
// its tool_result in the transcript, so toolById can be built while aggregating; each
// parsed object is dropped after its line is processed and only lightweight per-line
// summaries (msgs) are retained.
async function analyze(path) {
  const toolById = new Map(); // tool_use id -> {name, target}
  const rollup = {}, toolRollup = {}, skillRollup = {}, trBySkill = {};
  const toolTargets = {}; // tool -> Map(target -> {bytes,count,max,full,stale,fresh,staleBytes})
  let totalBytes = 0, lastCtx = null, peakCtx = 0, activeSkill = null;
  // prompt-cache totals (main thread only — sidechains have their own cache)
  let cacheRead = 0, cacheCreate = 0, cacheInput = 0;
  let errCount = 0, errBytes = 0; // failed tool calls (is_error results)
  // re-read classification: a re-Read is "fresh" (justified) if the file was Edit/Write-en
  // between the two reads, "stale" (pure waste) otherwise. Keyed on the FULL path.
  const lastReadLine = new Map(), lastModLine = new Map();
  const ayatoriCmds = new Set();
  const msgs = [];

  const bump = (obj, key, nb, extra = {}) => {
    const d = (obj[key] = obj[key] || { bytes: 0, count: 0, ...extra });
    d.bytes += nb; d.count += 1;
    return d;
  };

  let lineno = 0, nlines = 0;
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const ln of rl) {
    const s = ln.trim();
    if (!s) continue;
    lineno++;
    let obj;
    try { obj = JSON.parse(s); } catch { continue; }
    nlines++;
    const nb = Buffer.byteLength(s, "utf8");
    totalBytes += nb;
    const msg = obj.message;
    const role = msg?.role;
    const content = msg?.content;
    const text = msgText(content);

    // tool_use blocks feed three ledgers as they stream past: (1) toolById, consumed by the
    // matching tool_result on a LATER line; (2) Skill -> active skill + real invocation;
    // (3) Edit/Write -> file-modification ledger (so a later re-Read of that file counts as
    // justified, not stale). Sidechain (subagent) edits DO modify files on disk, so they
    // count too. Bash-mediated writes (sed -i, redirects, git checkout ...) are invisible
    // here — documented limitation.
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b?.type !== "tool_use") continue;
        toolById.set(b.id, { name: b.name, target: toolTarget(b.name, b.input) });
        if (b.name === "Skill") {
          const sName = normSkill(b.input?.skill);
          activeSkill = sName;
          if (sName?.startsWith("ayatori-")) ayatoriCmds.add(sName);
        } else if (["Edit", "Write", "NotebookEdit"].includes(b.name)) {
          const p = b.input?.file_path || b.input?.notebook_path;
          if (p) lastModLine.set(p, lineno);
        }
      }
    }
    // command envelope only in a user message. The <command-message> sibling is required
    // for BOTH the session filter and the attribution state machine — prose mentions and
    // assistant quotes of <command-name> must not flip activeSkill either.
    if (role === "user" && text.includes("<command-message>")) {
      for (const m of text.matchAll(REAL_CMD_RE)) ayatoriCmds.add(normSkill(m[1]));
      const am = ANY_CMD_RE.exec(text);
      if (am) {
        const cmd = normSkill(am[1]);
        if (cmd === "clear" || cmd === "exit") activeSkill = null;
        else if (cmd) activeSkill = cmd;
      }
    }

    // Prefer the native attributionSkill field (reliable, harness-written) over the
    // regex state machine when present; fall back to activeSkill otherwise.
    const nativeSkill = obj.attributionSkill ? normSkill(obj.attributionSkill) : null;
    if (nativeSkill?.startsWith("ayatori-")) ayatoriCmds.add(nativeSkill);
    const effectiveSkill = nativeSkill || activeSkill;

    const { source, detail, tool } = classify(obj, toolById);
    const fam = toolFamily(tool);

    let realOut = null, ctx = null, ccTok = null, crTok = null;
    // Sidechain (subagent) lines carry their OWN context window's usage — feeding it into
    // the main sequence would corrupt peak/Δctx with a foreign measurement, so skip them.
    if (msg?.usage && !obj.isSidechain) {
      const u = msg.usage;
      realOut = u.output_tokens ?? null;
      ccTok = u.cache_creation_input_tokens || 0;
      crTok = u.cache_read_input_tokens || 0;
      ctx = (u.input_tokens || 0) + crTok + ccTok;
      cacheRead += crTok; cacheCreate += ccTok; cacheInput += u.input_tokens || 0;
      lastCtx = ctx;
      if (ctx > peakCtx) peakCtx = ctx;
    }

    bump(rollup, source, nb);
    const sk = effectiveSkill || "(no skill / main)";
    bump(skillRollup, sk, nb);
    let isErr = false;
    if (source.endsWith("tool_result")) {
      bump(toolRollup, fam, nb);
      bump(trBySkill, sk, nb);
      // failed tool call: the error text AND the retry both stay in the window — pure waste
      isErr = Array.isArray(content) && content.some((b) => b?.type === "tool_result" && b.is_error === true);
      if (isErr) { errCount += 1; errBytes += nb; }
      // per-target ledger, keyed on the FULL target so distinct files never merge
      const meta = toolById.get(
        Array.isArray(content) ? content.find((b) => b?.type === "tool_result")?.tool_use_id : null
      );
      const full = fam === "Bash" || fam === "Read" || fam === "Edit" || fam === "Write" ? (meta?.target || detail) : (meta?.target || "");
      if (full) {
        const tt = (toolTargets[fam] = toolTargets[fam] || new Map());
        const cur = tt.get(full) || { bytes: 0, count: 0, full, stale: 0, fresh: 0, staleBytes: 0 };
        cur.bytes += nb; cur.count += 1;
        // classify a re-Read: justified only if the file was modified since the previous read
        if (fam === "Read") {
          const prevRead = lastReadLine.get(full);
          if (prevRead != null) {
            const mod = lastModLine.get(full);
            if (mod != null && mod > prevRead) cur.fresh += 1;
            else { cur.stale += 1; cur.staleBytes += nb; }
          }
          lastReadLine.set(full, lineno);
        }
        tt.set(full, cur);
      }
    }

    msgs.push({ line: lineno, source, detail, tool: fam, skill: effectiveSkill || "(main)", bytes: nb, out: realOut, ctx, cc: ccTok, cr: crTok, err: isErr || undefined, ts: obj.timestamp || "" });
  }

  return { rollup, toolRollup, skillRollup, trBySkill, toolTargets, totalBytes, lastCtx, peakCtx, msgs, nlines, ayatoriCmds: [...ayatoriCmds].sort(), cacheRead, cacheCreate, cacheInput, errCount, errBytes };
}

// ---------------------------------------------------------------------------
// aggregate across sessions
// ---------------------------------------------------------------------------
function mergeInto(into, from) {
  for (const [k, v] of Object.entries(from)) {
    const d = (into[k] = into[k] || { bytes: 0, count: 0 });
    d.bytes += v.bytes; d.count += v.count;
  }
}

async function buildData() {
  let files;
  if (SINGLE) {
    files = [resolve(SINGLE)];
  } else {
    if (!existsSync(PROJECT_DIR)) {
      console.error(`[profile-context] project dir not found: ${PROJECT_DIR}`);
      console.error(`  (cwd slug = ${projectName}; pass --project <name> or --session <file>)`);
      process.exit(1);
    }
    files = readdirSync(PROJECT_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => { const p = join(PROJECT_DIR, f); return { p, mt: statSync(p).mtimeMs }; })
      .sort((a, b) => b.mt - a.mt)
      .map((x) => x.p);
  }

  const sessions = [];
  const gRoll = {}, gTool = {}, gSkill = {}, gTrSkill = {};
  const gToolTargets = {}; // tool -> Map(target -> agg)
  const gCache = { read: 0, create: 0, input: 0 };
  const gErr = { count: 0, bytes: 0 };
  let skipped = 0;

  for (const p of files) {
    let d;
    try {
      d = await analyze(p);
    } catch (e) {
      // one corrupt/unreadable file must not abort the whole run — except with an explicit
      // --session target, where silently producing an empty report would hide the mistake.
      if (SINGLE) {
        console.error(`[profile-context] cannot read session file: ${p}\n  ${e?.message || e}`);
        process.exit(1);
      }
      console.error(`[profile-context] skipping unreadable session ${basename(p)}: ${e?.message || e}`);
      skipped++;
      continue;
    }
    if (d.nlines === 0) continue;
    if (!ALL && d.ayatoriCmds.length === 0) { skipped++; continue; }

    const sid = basename(p).replace(/\.jsonl$/, "");
    const top = [...d.msgs].sort((a, b) => b.bytes - a.bytes).slice(0, 15);

    // timeline (chronological = file order); ctx carried forward.
    // We keep BOTH the carried-forward ctx (for the gauge on every row) and the raw measured
    // value + this turn's own output_tokens (only present on assistant turns) so the client can
    // decompose each window jump into "prev turn's output" vs "inflow between turns".
    const t0 = (() => { for (const m of d.msgs) { const e = parseTs(m.ts); if (e != null) return e; } return null; })();
    let runCtx = null;
    const timeline = d.msgs.map((m) => {
      const e = parseTs(m.ts);
      if (m.ctx != null) runCtx = m.ctx;
      return { line: m.line, t: e != null && t0 != null ? Math.round((e - t0) * 10) / 10 : null, source: m.source, tool: m.tool, detail: m.detail, skill: m.skill, bytes: m.bytes, ctx: runCtx, raw_ctx: m.ctx, out: m.out, cc: m.cc, err: m.err };
    });
    let duration = null;
    for (let i = timeline.length - 1; i >= 0; i--) if (timeline[i].t != null) { duration = timeline[i].t; break; }

    // active vs waiting split: a gap ≥ IDLE_MIN between consecutive timestamped rows is
    // counted as waiting (human gate / user away), everything shorter as active work.
    // Heuristic — a very long Bash build would also read as a "wait"; the divider's label
    // says what the session was waiting FOR (the row that ended the gap) so it stays honest.
    const IDLE_MIN = 120;
    let activeS = 0, idleS = 0, nWaits = 0, prevT = null;
    for (const row of timeline) {
      if (row.t == null) continue;
      // timestamps are NOT monotonic (interleaved sidechain lines can jump back) — advance
      // prevT monotonically and ignore backwards steps, else active time goes negative.
      if (prevT != null && row.t > prevT) {
        const gap = row.t - prevT;
        if (gap >= IDLE_MIN) {
          idleS += gap; nWaits += 1;
          row.gap = Math.round(gap);
          row.gapKind = row.source.endsWith("user:text") ? "user turn"
            : row.tool === "AskUserQuestion" ? "human gate (AskUserQuestion)" : "next event";
        } else activeS += gap;
      }
      prevT = prevT == null ? row.t : Math.max(prevT, row.t);
    }

    // context-composition: the real peak ctx-window (tokens) is the "used" portion, sliced
    // per source proportional to that source's share of MAIN-WINDOW transcript bytes; the
    // remainder up to the inferred window limit is free space. subagent:* content lives in
    // the sidechain's own window (only the Agent tool_result enters the main one) and
    // meta:*/other:* are harness bookkeeping the model never sees, so both are excluded
    // from the slices AND the denominator — the byte rollup still reports them.
    const peak = d.peakCtx || d.lastCtx || 0;
    const window = inferWindow(peak);
    const inWindow = Object.entries(d.rollup).filter(([src]) => !/^(subagent:|meta:|other:)/.test(src));
    const inWindowBytes = inWindow.reduce((a, [, v]) => a + v.bytes, 0);
    const composition = inWindow
      .map(([src, v]) => ({ source: src, bytes: v.bytes, count: v.count, tokens: inWindowBytes ? Math.round((v.bytes / inWindowBytes) * peak) : 0 }))
      .sort((a, b) => b.tokens - a.tokens);

    sessions.push({
      id: sid, short: sid.slice(0, 8),
      total_bytes: d.totalBytes, nlines: d.nlines, last_ctx: d.lastCtx, peak_ctx: peak,
      window, window_inferred: WINDOW_OVERRIDE == null,
      rollup: d.rollup, tool_rollup: d.toolRollup, top, cmds: d.ayatoriCmds,
      composition, timeline, duration,
      active_s: Math.round(activeS), idle_s: Math.round(idleS), n_waits: nWaits,
      cache_read: d.cacheRead, cache_create: d.cacheCreate, cache_input: d.cacheInput,
      err_count: d.errCount, err_bytes: d.errBytes,
    });

    mergeInto(gRoll, d.rollup); mergeInto(gTool, d.toolRollup);
    mergeInto(gSkill, d.skillRollup); mergeInto(gTrSkill, d.trBySkill);
    gCache.read += d.cacheRead; gCache.create += d.cacheCreate; gCache.input += d.cacheInput;
    gErr.count += d.errCount; gErr.bytes += d.errBytes;
    for (const [tool, tt] of Object.entries(d.toolTargets)) {
      const g = (gToolTargets[tool] = gToolTargets[tool] || new Map());
      for (const [tgt, agg] of tt) {
        const cur = g.get(tgt) || { bytes: 0, count: 0, full: agg.full, stale: 0, fresh: 0, staleBytes: 0 };
        cur.bytes += agg.bytes; cur.count += agg.count;
        cur.stale += agg.stale || 0; cur.fresh += agg.fresh || 0; cur.staleBytes += agg.staleBytes || 0;
        g.set(tgt, cur);
      }
    }
  }

  // finalize tool_targets: top 25 per tool. `target` is the display form (paths shortened),
  // `full` keeps the real full target for the tooltip. MCP variants are already folded
  // upstream: toolFamily() collapses every mcp__* tool into the "MCP" family and
  // toolTarget() keys its targets on the method name.
  const toolTargets = {};
  for (const [tool, g] of Object.entries(gToolTargets)) {
    const items = [...g.entries()].map(([tgt, a]) => ({ target: displayTarget(tool, tgt), full: a.full || tgt, bytes: a.bytes, count: a.count, stale: a.stale || 0, fresh: a.fresh || 0, staleBytes: a.staleBytes || 0 }));
    items.sort((a, b) => b.bytes - a.bytes);
    toolTargets[tool] = items.slice(0, 25);
  }

  return {
    project: projectName,
    scope: ALL ? "all-sessions" : "ayatori-only",
    n_sessions: sessions.length,
    n_skipped: skipped,
    global_rollup: gRoll,
    global_tool_rollup: gTool,
    global_skill_rollup: gSkill,
    global_toolresult_by_skill: gTrSkill,
    global_total_bytes: sessions.reduce((a, s) => a + s.total_bytes, 0),
    global_cache: gCache,
    global_errors: gErr,
    tool_targets: toolTargets,
    sessions,
  };
}

// ---------------------------------------------------------------------------
// render: each template is a plain HTML file next to this script; we inject a
// JSON payload into a single `__DATA_INJECT__` placeholder. No build step, no
// base64 — the templates contain client-side `${...}` literals, so we keep them
// as static files and string-replace rather than embed them in JS (embedding
// would make Node try to interpolate those `${...}` at load time). Function-form
// replacement avoids `$&`/`$1` handling since the JSON can contain `$`.
// ---------------------------------------------------------------------------
function renderTemplate(templateFile, payload) {
  const tpl = readFileSync(new URL(`./${templateFile}`, import.meta.url), "utf8");
  // <-escape `<` so transcript-derived strings containing "</script>" (a grepped
  // pattern, a quoted Bash command, ...) can never terminate the inline <script> element.
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return tpl.replace("__DATA_INJECT__", () => json);
}

const data = await buildData();

if (AS_JSON) {
  // no process.exit() here: exiting immediately after a large write truncates stdout
  // when it's a pipe (the buffer isn't drained). Let the event loop drain and exit.
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
} else {
  writeReports(data);
}

function writeReports(data) {
const outDir = OUT_DIR ? resolve(OUT_DIR) : join(process.cwd(), "artifacts", "_reports");
const sessionsDir = join(outDir, "context-profile");
mkdirSync(sessionsDir, { recursive: true });

// index payload: overall rollups + a lightweight per-session summary (no heavy
// timeline/composition arrays — those live in each detail page).
const indexPayload = {
  project: data.project, scope: data.scope,
  n_sessions: data.n_sessions, n_skipped: data.n_skipped,
  global_rollup: data.global_rollup, global_tool_rollup: data.global_tool_rollup,
  global_skill_rollup: data.global_skill_rollup, global_toolresult_by_skill: data.global_toolresult_by_skill,
  global_total_bytes: data.global_total_bytes, tool_targets: data.tool_targets,
  global_cache: data.global_cache, global_errors: data.global_errors,
  sessions: data.sessions.map((s) => ({
    id: s.id, short: s.short, total_bytes: s.total_bytes, nlines: s.nlines,
    last_ctx: s.last_ctx, peak_ctx: s.peak_ctx, window: s.window, duration: s.duration,
    active_s: s.active_s, idle_s: s.idle_s, n_waits: s.n_waits,
    cache_read: s.cache_read, cache_create: s.cache_create, cache_input: s.cache_input,
    err_count: s.err_count, err_bytes: s.err_bytes,
    rollup: s.rollup, cmds: s.cmds, top: s.top,
    detail_href: `context-profile/${s.id}.html`,
  })),
};
const indexPath = join(outDir, "context-profile.html");
writeFileSync(indexPath, renderTemplate("profile-context.index.template.html", indexPayload), "utf8");

// one detail page per session
for (const s of data.sessions) {
  writeFileSync(join(sessionsDir, `${s.id}.html`), renderTemplate("profile-context.session.template.html", { project: data.project, session: s }), "utf8");
}

const mb = (data.global_total_bytes / 1048576).toFixed(2);
console.log(`[profile-context] ${data.n_sessions} session(s) (${data.scope}), ${data.n_skipped} skipped, ${mb} MB analyzed`);
console.log(`[profile-context] index   → ${indexPath}`);
console.log(`[profile-context] details → ${sessionsDir}/*.html (${data.n_sessions})`);
console.log(`[profile-context] open it: open "${indexPath}"`);
}
