// scripts/build-ground-truth-index.test.mjs
//
// scripts/build-ground-truth-index.mjs の単体テスト。Node 標準の node:test + node:assert のみ。
//   実行: node --test scripts/build-ground-truth-index.test.mjs
//
// テスト方針:
//   - 本 script は CLI (cwd 相対の artifacts/ を読む) なので tmpdir にツリーを作って子プロセス実行。
//   - 固定するのは content status の判定境界と、表・台帳が壊れないこと。この status は下流
//     (Step 02 B1 / Step 03 の doc_backed 引用 / Step 04 の比較分母 / Step 05 監査) が「引用してよいか」を
//     決める唯一の入力なので、誤分類は要件の根拠そのものを変える。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "build-ground-truth-index.mjs");
const PROSE = (n) => "あ".repeat(n);

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "ayatori-gt-index-"));
  return {
    root,
    dir: (app = "app") => join(root, "artifacts", app, "ground-truth"),
    doc(name, body, app = "app") {
      const p = join(this.dir(app), name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
    },
    run(args, app = "app") {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: this.root, encoding: "utf8" });
      return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
    },
    index(app = "app") {
      return readFileSync(join(this.dir(app), "index.md"), "utf8");
    },
    // Documents 表の行を file 名で引く
    row(file, app = "app") {
      const line = this.index(app).split("\n").find((l) => l.startsWith(`| ${file} `));
      assert.ok(line, `row not found for ${file}`);
      return line;
    },
    cleanup() {
      rmSync(this.root, { recursive: true, force: true });
    },
  };
};

const header = (extra = "") =>
  `**Page ID**: 111\n**Source**: confluence\n**Last updated**: 2026-07-01\n${extra}`;

test("CRLF アーカイブでも見出しのみのページは殻と判定する", () => {
  const fx = setup();
  try {
    // CRLF のままだとヘッダー区切りに当たらず、ヘッダー文字列が本文量として数えられて
    // 殻が「薄い」(引用可) に昇格していた
    fx.doc("spec-a.md", `# Spec A\r\n\r\n${header().replace(/\n/g, "\r\n")}\r\n\r\n---\r\n\r\n## 概要\r\n\r\n## 詳細\r\n`);
    fx.run(["app"]);
    assert.match(fx.row("spec-a.md"), /\*\*殻\*\*/);
    assert.match(fx.row("spec-a.md"), /\| 0 \|/, "本文長が 0 と数えられる");
  } finally {
    fx.cleanup();
  }
});

test("タイトルに | があっても列がずれない", () => {
  const fx = setup();
  try {
    fx.doc("piped.md", `# 仕様 | 画面A\n\n${header()}\n\n---\n\n${PROSE(500)}\n`);
    fx.run(["app"]);
    const idx = fx.index();
    const hdr = idx.split("\n").find((l) => l.startsWith("| File | Title |"));
    const countCells = (l) => l.split("").filter((c, i) => c === "|" && (i === 0 || l[i - 1] !== "\\")).length;
    assert.equal(countCells(fx.row("piped.md")), countCells(hdr), "エスケープ後のセル数がヘッダーと一致");
    assert.match(fx.row("piped.md"), /仕様 \\\| 画面A/);
  } finally {
    fx.cleanup();
  }
});

test("Jira 課題は文書より低い閾値で判定する (短い日本語の変更要求を殻にしない)", () => {
  const fx = setup();
  try {
    const body = PROSE(60); // 文書閾値 100 未満 / Jira 閾値 40 以上
    fx.doc("jira-ABC-12.md", `# [ABC-12] 表示条件の変更\n\n**Source**: jira\n\n---\n\n${body}\n`);
    fx.doc("cf-111-spec.md", `# Spec\n\n${header()}\n\n---\n\n${body}\n`);
    fx.run(["app"]);
    assert.match(fx.row("jira-ABC-12.md"), /\| 薄い \|/, "Jira は引用可");
    assert.match(fx.row("cf-111-spec.md"), /\*\*殻\*\*/, "Confluence ページは殻のまま");
  } finally {
    fx.cleanup();
  }
});

test("Source 行が自由形式でも kind に正規化して閾値を引く (実アーカイブの書式)", () => {
  const fx = setup();
  try {
    const body = PROSE(60); // 文書閾値 100 未満 / Jira 閾値 40 以上
    // 収集 sub-module が実際に書くヘッダー書式 (bare の "jira"/"local" ではない)
    fx.doc("jira-XYZ-34.md", `# [XYZ-34] 通知条件\n\n**Source**: jira (XYZ-34)\n\n---\n\n${body}\n`);
    fx.doc("local-spec.md", `# 仕様メモ\n\n**Source**: input-sources/docs/spec.pdf (local, PDF transcription)\n\n---\n\n${PROSE(60)}\n`);
    fx.run(["app"]);
    assert.match(fx.row("jira-XYZ-34.md"), /\| 薄い \|/, "jira (KEY) 形式でも Jira 閾値が効く");
    assert.match(fx.row("local-spec.md"), /\*\*殻\*\*/, "local はページ閾値のまま (100 未満は殻)");
  } finally {
    fx.cleanup();
  }
});

test("台帳が壊れていても index は生成し、警告だけ出す", () => {
  const fx = setup();
  try {
    fx.doc("cf-111-spec.md", `# Spec\n\n${header()}\n\n---\n\n${PROSE(500)}\n`);
    fx.doc(".collection-failed.json", '[{"page_id":"200",}]');
    const { status, err } = fx.run(["app"]);
    assert.equal(status, 0);
    assert.ok(existsSync(join(fx.dir(), "index.md")), "index.md は生成される");
    assert.match(err, /WARNING/);
  } finally {
    fx.cleanup();
  }
});

test("台帳が配列でなければ無視して警告する", () => {
  const fx = setup();
  try {
    fx.doc("cf-111-spec.md", `# Spec\n\n${header()}\n\n---\n\n${PROSE(500)}\n`);
    fx.doc(".collection-failed.json", '{"page_id":"200"}');
    const { status, err } = fx.run(["app"]);
    assert.equal(status, 0);
    assert.match(err, /JSON array/);
    assert.equal(fx.index().includes("未収集 / 収集失敗"), false);
  } finally {
    fx.cleanup();
  }
});

test("台帳は既定パスを自動で読む (--failed を忘れても未収集が消えない)", () => {
  const fx = setup();
  try {
    fx.doc("cf-111-spec.md", `# Spec\n\n${header()}\n\n---\n\n${PROSE(500)}\n`);
    fx.doc(".collection-failed.json", JSON.stringify([{ page_id: "200", title: "権限なし | 秘匿", reason: "範囲外 (未収集)" }]));
    fx.run(["app"]);
    const idx = fx.index();
    assert.match(idx, /未収集 \/ 収集失敗/);
    assert.match(idx, /権限なし \\\| 秘匿/, "理由・タイトルも | エスケープされる");
    assert.match(idx, /範囲外 \(未収集\)/);
  } finally {
    fx.cleanup();
  }
});

test("--failed が先に来ても positional の app_name を食わない", () => {
  const fx = setup();
  try {
    fx.doc("cf-111-spec.md", `# Spec\n\n${header()}\n\n---\n\n${PROSE(500)}\n`);
    const ledger = join(fx.root, "ledger.json");
    writeFileSync(ledger, JSON.stringify([{ page_id: "300", title: "t", reason: "r" }]));
    const { status } = fx.run(["--failed", ledger, "app"]);
    assert.equal(status, 0);
    assert.match(fx.index(), /\| 300 \|/);
  } finally {
    fx.cleanup();
  }
});

test("content status の境界: 本文 / 薄い / テンプレート未記入 / 図のみ", () => {
  const fx = setup();
  try {
    fx.doc("full.md", `# Full\n\n${header()}\n\n---\n\n${PROSE(500)}\n`);
    fx.doc("thin.md", `# Thin\n\n${header()}\n\n---\n\n${PROSE(150)}\n`);
    fx.doc("diagram.md", `# Diagram\n\n${header()}\n\n---\n\n![](blob:abc)\n`);
    const emptyTable = ["| 項目 | 値 | 備考 |", "|---|---|---|", "|  |  |  |", "|  |  |  |", "|  |  |  |"].join("\n");
    fx.doc("template.md", `# Template\n\n${header()}\n\n---\n\n${PROSE(200)}\n\n${emptyTable}\n`);
    fx.run(["app"]);
    assert.match(fx.row("full.md"), /\| 本文 \|/);
    assert.match(fx.row("thin.md"), /\| 薄い \|/);
    assert.match(fx.row("diagram.md"), /\*\*図のみ\*\*/);
    assert.match(fx.row("template.md"), /\*\*テンプレート未記入\*\*/);
  } finally {
    fx.cleanup();
  }
});

test("本文リンクの page ID が収集済み・台帳のどちらにも無ければ「参照されているが未収集」に載る", () => {
  const s = setup();
  try {
    // 収集済み: 111 (自分) と 222 (相互リンク) / 台帳済み: 333 / どこにも無い: 999
    s.doc(
      "cf-111-a.md",
      `# A\n\n**Page ID**: 111\n**Source**: confluence\n\n---\n\n${PROSE(500)}\n` +
        "https://x.atlassian.net/wiki/spaces/sp/pages/222/t 参照\n" +
        "https://x.atlassian.net/wiki/spaces/sp/pages/333/t 参照\n" +
        "https://x.atlassian.net/wiki/spaces/sp/pages/999/t 参照\n" +
        '<custom data-type="smartlink">https://x.atlassian.net/wiki/spaces/sp/pages/edit-v2/888</custom>\n',
    );
    s.doc("cf-222-b.md", `# B\n\n**Page ID**: 222\n**Source**: confluence\n\n---\n\n${PROSE(500)}\n`);
    s.doc(
      ".collection-failed.json",
      JSON.stringify([{ page_id: "333", title: "scoped-out", reason: "範囲外 (未収集)" }]),
    );

    assert.equal(s.run(["app"]).status, 0);
    const idx = s.index();
    assert.match(idx, /## 参照されているが未収集/);
    assert.match(idx, /\| 999 \| cf-111-a\.md \|/);
    assert.match(idx, /\| 888 \| cf-111-a\.md \|/); // smartlink の edit-v2 形も拾う
    assert.ok(!/\| 222 \|/.test(idx.split("## 参照されているが未収集")[1].split("## Documents")[0]), "収集済み ID は載せない");
    assert.ok(!/\| 333 \|/.test(idx.split("## 参照されているが未収集")[1].split("## Documents")[0]), "台帳済み ID は載せない");
  } finally {
    s.cleanup();
  }
});

test("リンクが全て既知なら「参照されているが未収集」セクション自体を出さない", () => {
  const s = setup();
  try {
    s.doc(
      "cf-111-a.md",
      `# A\n\n**Page ID**: 111\n**Source**: confluence\n\n---\n\n${PROSE(500)}\nhttps://x.atlassian.net/wiki/spaces/sp/pages/111/self\n`,
    );
    assert.equal(s.run(["app"]).status, 0);
    assert.ok(!/参照されているが未収集/.test(s.index()));
  } finally {
    s.cleanup();
  }
});

test("adf-extract は Source=adf-extract として一覧され、サマリに抽出本行が出る", () => {
  const s = setup();
  try {
    s.doc(
      "cf-111-big.md",
      `# Big\n\n**Page ID**: 111\n**Source**: confluence\n\n---\n\n\`\`\`json\n{"type":"doc","content":[]}\n\`\`\`\n`,
    );
    s.doc(
      "cf-111-big.adf-extract.md",
      `# Big\n\n**Page ID**: 111\n**Source**: adf-extract (元アーカイブ: cf-111-big.md)\n\n---\n\n${PROSE(500)}\n`,
    );
    assert.equal(s.run(["app"]).status, 0);
    const idx = s.index();
    assert.match(s.row("cf-111-big.md"), /\*\*ADF生JSON\*\*/);
    assert.match(s.row("cf-111-big.adf-extract.md"), /adf-extract/);
    assert.match(idx, /抽出本 \(adf-extract\) \| 1 \|/);
  } finally {
    s.cleanup();
  }
});
