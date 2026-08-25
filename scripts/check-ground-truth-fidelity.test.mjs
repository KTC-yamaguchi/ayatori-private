// scripts/check-ground-truth-fidelity.test.mjs
//
// scripts/check-ground-truth-fidelity.mjs の単体テスト。Node 標準の node:test + node:assert のみ。
//   実行: node --test scripts/check-ground-truth-fidelity.test.mjs
//
// テスト方針:
//   - CLI (cwd 相対の artifacts/ を読む) なので tmpdir にツリーを作って子プロセス実行
//     (build-ground-truth-index.test.mjs と同じハーネス)。
//   - 固定するのは (a) 要約汚染ページが検出され再収集対象に挙がること、(b) 正常表記
//     (Jira の [添付:] / 散文中の 省略・要約) が誤検出されないこと、(c) 0 件走査が
//     clean と混同されないこと。この判定は収集アーカイブの証拠能力そのものを守る。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-ground-truth-fidelity.mjs");
const PROSE = (n) => "本".repeat(n);
const HEADER = "**Page ID**: 111\n**Source**: confluence\n**Last updated**: 2026-07-01";

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "ayatori-gt-fidelity-"));
  return {
    root,
    dir(app = "app") {
      return join(root, "artifacts", app, "ground-truth");
    },
    doc(name, body, app = "app") {
      const p = join(this.dir(app), name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
    },
    fragment(name, obj, app = "app") {
      this.doc(name, JSON.stringify(obj, null, 2), app);
    },
    run(args = ["app"]) {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: this.root, encoding: "utf8" });
      return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
    },
    cleanup() {
      rmSync(this.root, { recursive: true, force: true });
    },
  };
};

const page = (body) => `# ページ\n\n${HEADER}\n\n---\n\n${body}\n`;

test("clean なアーカイブは exit 0 + 走査件数を出力する", () => {
  const fx = setup();
  try {
    fx.doc("cf-1-spec.md", page(PROSE(800)));
    fx.fragment(".batch1-pages.json", {
      source: "confluence", batch_id: 1,
      pages: [{ id: "1", file: "cf-1-spec.md", expected_body_chars: 810 }],
    });
    const r = fx.run();
    assert.equal(r.status, 0, r.out + r.err);
    assert.match(r.out, /scanned: 1 files \/ fragment entries: 1/);
    assert.match(r.out, /汚染疑いなし/);
  } finally {
    fx.cleanup();
  }
});

test("受け入れ基準: 受信 8000 字がアーカイブ 300 字に縮んでいたら、そのページだけ再収集対象に挙がり exit 1", () => {
  const fx = setup();
  try {
    fx.doc("cf-1-long.md", page(PROSE(300))); // 要約されてしまったアーカイブ
    fx.doc("cf-2-ok.md", page(PROSE(900)));
    fx.fragment(".batch1-pages.json", {
      source: "confluence", batch_id: 1,
      pages: [
        { id: "1", file: "cf-1-long.md", expected_body_chars: 8000 },
        { id: "2", file: "cf-2-ok.md", expected_body_chars: 910 },
      ],
    });
    const r = fx.run();
    assert.equal(r.status, 1);
    assert.match(r.out, /再収集対象 \(1 件\)/);
    assert.match(r.out, /cf-1-long\.md.*本文長不足/);
    assert.doesNotMatch(r.out, /cf-2-ok\.md.*本文長不足/);
  } finally {
    fx.cleanup();
  }
});

test("要約マーカー ((中略) / [OUTPUT TRUNCATED) は本文長が正常でも検出する", () => {
  const fx = setup();
  try {
    fx.doc("cf-1-a.md", page(`${PROSE(400)}（中略）${PROSE(400)}`));
    fx.doc("cf-2-b.md", page(`${PROSE(400)}\n[OUTPUT TRUNCATED at 5000 tokens]\n${PROSE(400)}`));
    const r = fx.run();
    assert.equal(r.status, 1);
    assert.match(r.out, /cf-1-a\.md.*要約マーカー/);
    assert.match(r.out, /cf-2-b\.md.*要約マーカー/);
  } finally {
    fx.cleanup();
  }
});

test("自然言語の要約 disclaimer (due to length / summary is provided / refer to the original / content continues) も本文長が正常でも検出する", () => {
  const fx = setup();
  try {
    fx.doc("cf-1-a.md", page(`[Due to length constraints, a summary is provided below.]\n${PROSE(400)}`));
    fx.doc("cf-2-b.md", page(`${PROSE(400)}\nFor complete details, refer to the original Confluence page.`));
    fx.doc("cf-3-c.md", page(`${PROSE(400)}\n[Content continues with detailed flow diagrams...]`));
    const r = fx.run();
    assert.equal(r.status, 1);
    assert.match(r.out, /cf-1-a\.md.*要約マーカー/);
    assert.match(r.out, /cf-2-b\.md.*要約マーカー/);
    assert.match(r.out, /cf-3-c\.md.*要約マーカー/);
  } finally {
    fx.cleanup();
  }
});

test("日本語 disclaimer (原本を参照 / 元ページを参照 / ページは長いため) も検出する", () => {
  const fx = setup();
  try {
    fx.doc("cf-1-a.md", page(`${PROSE(400)}\n本ページは長いため、詳細は原本を参照してください。`));
    fx.doc("cf-2-b.md", page(`${PROSE(400)}\n続きは元ページを参照。`));
    const r = fx.run();
    assert.equal(r.status, 1);
    assert.match(r.out, /cf-1-a\.md.*要約マーカー/);
    assert.match(r.out, /cf-2-b\.md.*要約マーカー/);
  } finally {
    fx.cleanup();
  }
});

test("probe の測定値は fragment の自己申告より優先される (短く書いて短く申告する自己整合な虚偽を検出)", () => {
  const fx = setup();
  try {
    fx.doc("cf-1-lied.md", page(PROSE(300))); // 要約されたアーカイブ
    fx.fragment(".batch1-pages.json", {
      source: "confluence", batch_id: 1,
      pages: [{ id: "1", file: "cf-1-lied.md", expected_body_chars: 310 }], // 書いた量に合わせた自己申告 → fragment 単独では検出不能
    });
    fx.fragment(".probe-pages.json", {
      source: "confluence",
      pages: [{ id: "1", body_chars: 8000 }], // 独立測定は本当の受信量を知っている
    });
    const r = fx.run();
    assert.equal(r.status, 1);
    assert.match(r.out, /cf-1-lied\.md.*本文長不足.*probe/);
  } finally {
    fx.cleanup();
  }
});

test("fragment が無くても probe があれば本文長照合を実施する", () => {
  const fx = setup();
  try {
    fx.doc("cf-1-nofrag.md", page(PROSE(300)));
    fx.fragment(".probe-pages.json", {
      source: "confluence",
      pages: [{ id: "1", body_chars: 8000 }],
    });
    const r = fx.run();
    assert.equal(r.status, 1);
    assert.match(r.out, /cf-1-nofrag\.md.*本文長不足.*probe/);
    assert.match(r.out, /本文長照合は probe で実施/);
  } finally {
    fx.cleanup();
  }
});

test("Jira の正規表記 [添付: 図.png] は誤検出しない", () => {
  const fx = setup();
  try {
    fx.doc("jira-ABC-1.md", page(`変更要求の本文。[添付: 画面設計図.png] を参照。${PROSE(100)}`));
    const r = fx.run();
    assert.equal(r.status, 0, r.out);
  } finally {
    fx.cleanup();
  }
});

test("散文中の 省略/要約 (マーカー形でない) は誤検出しない", () => {
  const fx = setup();
  try {
    fx.doc("cf-1-prose.md", page(`入力を省略できる。要約表示の仕様は別ページ参照。${PROSE(100)}`));
    const r = fx.run();
    assert.equal(r.status, 0, r.out);
  } finally {
    fx.cleanup();
  }
});

test("expected < 500 の小ページは本文長照合を skip する (殻の判定は index の責務)", () => {
  const fx = setup();
  try {
    fx.doc("jira-XYZ-9.md", page(PROSE(60))); // 受信 400 字 → アーカイブ 60 字でも flag しない
    fx.fragment(".batch1-issues.json", {
      source: "jira", batch_id: 1,
      issues: [{ id: "XYZ-9", file: "jira-XYZ-9.md", expected_body_chars: 400 }],
    });
    const r = fx.run();
    assert.equal(r.status, 0, r.out);
  } finally {
    fx.cleanup();
  }
});

test("fragment 記録の無いファイルは warning (走査には含む)、ファイル不在の fragment entry は suspect", () => {
  const fx = setup();
  try {
    fx.doc("local-old.md", page(PROSE(600))); // fragment 無し (legacy)
    fx.fragment(".batch1-pages.json", {
      source: "confluence", batch_id: 1,
      pages: [{ id: "9", file: "cf-9-gone.md", expected_body_chars: 5000 }], // ファイル無し
    });
    const r = fx.run();
    assert.equal(r.status, 1);
    assert.match(r.out, /scanned: 1 files/);
    assert.match(r.out, /local-old\.md: fragment に記録が無い/);
    assert.match(r.out, /cf-9-gone\.md.*ファイル不在/);
  } finally {
    fx.cleanup();
  }
});

test("fragment はあるのに .md を 1 件も走査しなかったら exit 1 (0 件走査 ≠ clean)", () => {
  const fx = setup();
  try {
    fx.fragment(".batch1-pages.json", {
      source: "confluence", batch_id: 1,
      pages: [{ id: "1", file: "cf-1-spec.md", expected_body_chars: 900 }],
    });
    // .md を 1 件も置かない — ただし fragment entry がファイル不在 suspect にもなるため、
    // 0 件走査の警告行そのものが出ることを固定する
    const r = fx.run();
    assert.equal(r.status, 1);
    assert.match(r.out, /1 件も走査していない/);
  } finally {
    fx.cleanup();
  }
});

test("CRLF アーカイブでも header separator を認識して本文長を測る", () => {
  const fx = setup();
  try {
    const body = page(PROSE(800)).replace(/\n/g, "\r\n");
    fx.doc("cf-1-crlf.md", body);
    fx.fragment(".batch1-pages.json", {
      source: "confluence", batch_id: 1,
      pages: [{ id: "1", file: "cf-1-crlf.md", expected_body_chars: 810 }],
    });
    const r = fx.run();
    assert.equal(r.status, 0, r.out);
  } finally {
    fx.cleanup();
  }
});

test("同一 file が複数 fragment に現れたら後勝ち (台帳の append-merge と同じ規約)", () => {
  const fx = setup();
  try {
    fx.doc("cf-1-re.md", page(PROSE(900))); // 再収集後の実体
    fx.fragment(".batch1-pages.json", {
      source: "confluence", batch_id: 1,
      pages: [{ id: "1", file: "cf-1-re.md", expected_body_chars: 8000 }], // 初回 (汚染時)
    });
    fx.fragment(".batch2-pages.json", {
      source: "confluence", batch_id: 2,
      pages: [{ id: "1", file: "cf-1-re.md", expected_body_chars: 910 }], // repair batch
    });
    const r = fx.run();
    assert.equal(r.status, 0, r.out); // batch2 の expected が有効なら clean
  } finally {
    fx.cleanup();
  }
});

test("--json は scanned / fragment_entries / suspects / warnings を構造化して返す", () => {
  const fx = setup();
  try {
    fx.doc("cf-1-bad.md", page(PROSE(100)));
    fx.fragment(".batch1-pages.json", {
      source: "confluence", batch_id: 1,
      pages: [{ id: "1", file: "cf-1-bad.md", expected_body_chars: 6000 }],
    });
    const r = fx.run(["app", "--json"]);
    assert.equal(r.status, 1);
    const j = JSON.parse(r.out);
    assert.equal(j.scanned, 1);
    assert.equal(j.fragment_entries, 1);
    assert.equal(j.suspects.length, 1);
    assert.equal(j.suspects[0].file, "cf-1-bad.md");
    assert.ok(Array.isArray(j.warnings));
  } finally {
    fx.cleanup();
  }
});

test("confluence (pages) と jira (issues) の fragment を同一 run で合流して検査する", () => {
  const fx = setup();
  try {
    fx.doc("cf-1-spec.md", page(PROSE(200))); // 汚染 (受信 4000)
    fx.doc("jira-K-1.md", page(PROSE(700))); // clean
    fx.fragment(".batch1-pages.json", {
      source: "confluence", batch_id: 1,
      pages: [{ id: "1", file: "cf-1-spec.md", expected_body_chars: 4000 }],
    });
    fx.fragment(".batch2-issues.json", {
      source: "jira", batch_id: 2,
      issues: [{ id: "K-1", file: "jira-K-1.md", expected_body_chars: 710 }],
    });
    const r = fx.run();
    assert.equal(r.status, 1);
    assert.match(r.out, /scanned: 2 files \/ fragment entries: 2/);
    assert.match(r.out, /cf-1-spec\.md.*本文長不足/);
    assert.doesNotMatch(r.out, /jira-K-1\.md.*本文長不足/);
  } finally {
    fx.cleanup();
  }
});

test("途中で切断された ADF JSON フェンスは本文長が閾値を超えていても suspect になる", () => {
  const fx = setup();
  try {
    // ADF アーカイブは markdown 計測の probe より数倍大きいため、半分に切れても
    // 長さ比の検査は素通りする — parse 検査だけが機械的に検出できる。
    const bigJson = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "本".repeat(3000) }] }] });
    const truncated = bigJson.slice(0, Math.floor(bigJson.length / 2)); // 途中切断 = 不正な JSON
    fx.doc("cf-1-adf.md", page("```json\n" + truncated + "\n```"));
    fx.fragment(".batch1-pages.json", {
      source: "confluence", batch_id: 1,
      pages: [{ id: "1", file: "cf-1-adf.md", expected_body_chars: 2000 }],
    });
    const r = fx.run();
    assert.equal(r.status, 1, r.out + r.err);
    assert.match(r.out, /ADF JSON が parse 不能/);
  } finally {
    fx.cleanup();
  }
});

test("正常な ADF JSON フェンスは parse 検査を通り clean のまま", () => {
  const fx = setup();
  try {
    const okJson = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "本".repeat(3000) }] }] });
    fx.doc("cf-1-adf.md", page("```json\n" + okJson + "\n```"));
    fx.fragment(".batch1-pages.json", {
      source: "confluence", batch_id: 1,
      pages: [{ id: "1", file: "cf-1-adf.md", expected_body_chars: 2000 }],
    });
    const r = fx.run();
    assert.equal(r.status, 0, r.out + r.err);
    assert.match(r.out, /汚染疑いなし/);
  } finally {
    fx.cleanup();
  }
});

test("本文中に JSON 例ブロックを複数含む通常ページは parse 検査の対象外 (false positive にしない)", () => {
  const fx = setup();
  try {
    // 有効な JSON 例 2 ブロック + 間に散文 — first〜last フェンスを通しで parse すると
    // 必ず失敗する形。検査が「本文全体が単一フェンス」に限定されていれば clean のまま。
    const body =
      PROSE(300) + "\n\n```json\n" + JSON.stringify({ ok: 1 }) + "\n```\n\n" +
      PROSE(300) + "\n\n```json\n" + JSON.stringify({ ok: 2 }) + "\n```\n\n" + PROSE(300);
    fx.doc("cf-1-api-spec.md", page(body));
    fx.fragment(".batch1-pages.json", {
      source: "confluence", batch_id: 1,
      pages: [{ id: "1", file: "cf-1-api-spec.md", expected_body_chars: body.length }],
    });
    const r = fx.run();
    assert.equal(r.status, 0, r.out + r.err);
    assert.match(r.out, /汚染疑いなし/);
  } finally {
    fx.cleanup();
  }
});
