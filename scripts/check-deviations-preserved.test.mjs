// scripts/check-deviations-preserved.test.mjs
//
// scripts/check-deviations-preserved.mjs の単体テスト。Node 標準の node:test + node:assert のみ。
//   実行: node --test scripts/check-deviations-preserved.test.mjs
//
// テスト方針:
//   - 「消えると取り返せない 3 種」(他 phase / resolved / 引き継いだ未解決) が消えたら必ず exit 1 に
//     なることを固定する。これが本 script の存在理由。
//   - 自 run が初出の未解決だけは消えても PASS (再列挙の揺れ・run 破棄が正常経路) — 保全の範囲を
//     広げ過ぎると正常な prune が全部違反になり、検査が無効化される。
//   - snapshot 不在で verify を通してしまわないこと (順序ミスを構造で止める)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { identityKey, preservationKey, mustPreserve, runSnapshot, runVerify, parseArgs, main } from "./check-deviations-preserved.mjs";

const entry = (over = {}) => ({
  phase: "reverse_verify",
  raised_by_step: "02-targeted-crosscheck",
  artifact: "requirements/05-features.md",
  element: "検索は部分一致",
  deviation_kind: "要件矛盾",
  detected_at: "2026-08-13T10:00:00+09:00",
  ...over,
});

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "deviations-preserved-"));
  return {
    dir,
    write(name, doc) {
      const p = join(dir, name);
      writeFileSync(p, JSON.stringify(doc, null, 2));
      return p;
    },
    path(name) {
      return join(dir, name);
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

// ── 保全判定 ─────────────────────────────────────────────────

test("mustPreserve: 他 phase / resolved / 引き継いだ未解決 は保全対象", () => {
  assert.equal(mustPreserve(entry({ phase: "reverse" }), "rv2"), true, "他 phase");
  assert.equal(mustPreserve(entry({ phase: "screens" }), "rv2"), true, "他 phase (Phase 3 経由の記録)");
  assert.equal(mustPreserve(entry({ run_id: "rv2", first_run_id: "rv2", resolved_at: "t", resolution: "容認" }), "rv2"), true, "resolved");
  assert.equal(mustPreserve(entry({ run_id: "rv2", first_run_id: "rv1" }), "rv2"), true, "引き継いだ未解決");
});

test("mustPreserve: 自 run が初出の未解決だけ保全対象外 (正常な prune を妨げない)", () => {
  assert.equal(mustPreserve(entry({ run_id: "rv2", first_run_id: "rv2" }), "rv2"), false);
});

test("mustPreserve: first_run_id 欠落は不明 → 安全側で保全する", () => {
  assert.equal(mustPreserve(entry({ run_id: "rv2" }), "rv2"), true);
  assert.equal(mustPreserve(entry({ run_id: "rv2", first_run_id: "" }), "rv2"), true);
});

test("identityKey: ref 優先、無ければ artifact::element", () => {
  assert.equal(identityKey(entry({ ref: "F-03.match" })), "F-03.match");
  assert.equal(identityKey(entry()), "requirements/05-features.md::検索は部分一致");
});

test("preservationKey: phase が違えば同じ ref でも別 key (phase 抜きの照合を許さない)", () => {
  const a = preservationKey(entry({ phase: "reverse", ref: "F-01.match" }));
  const b = preservationKey(entry({ phase: "reverse_verify", ref: "F-01.match" }));
  assert.notEqual(a, b);
  // ref 系と artifact::element 系が同文字列になっても分岐タグで衝突しない
  const refKey = preservationKey(entry({ ref: "a::b" }));
  const aeKey = preservationKey(entry({ artifact: "a", element: "b" }));
  assert.notEqual(refKey, aeKey);
});

// ── snapshot / verify ────────────────────────────────────────

test("台帳不在でも snapshot は空台帳として成功する (初回 run の正当な経路)", () => {
  const fx = setup();
  try {
    const r = runSnapshot({ ledger: fx.path("missing.json"), out: fx.path("snap.json") });
    assert.equal(r.entries, 0);
    assert.deepEqual(JSON.parse(readFileSync(fx.path("snap.json"), "utf8")), { entries: [] });
    // その snapshot で verify しても PASS (守る対象が無い)
    const v = runVerify({ ledger: fx.path("missing.json"), snapshot: fx.path("snap.json"), runId: "rv1" });
    assert.equal(v.verdict, "PASS");
  } finally {
    fx.cleanup();
  }
});

test("他 phase の entry が消えたら MISSING (理由つき)", () => {
  const fx = setup();
  try {
    const snap = fx.write("snap.json", {
      app_name: "a",
      entries: [entry({ phase: "reverse", ref: "F-01.badge" }), entry({ run_id: "rv1", first_run_id: "rv1", ref: "F-03.match" })],
    });
    const ledger = fx.write("dev.json", { app_name: "a", entries: [entry({ run_id: "rv1", first_run_id: "rv1", ref: "F-03.match" })] });
    const r = runVerify({ ledger, snapshot: snap, runId: "rv1" });
    assert.equal(r.verdict, "MISSING");
    assert.equal(r.missing.length, 1);
    assert.equal(r.missing[0].key, "F-01.badge");
    assert.match(r.missing[0].reason, /他 phase/);
  } finally {
    fx.cleanup();
  }
});

test("引き継いだ保留が消えたら MISSING — run 破棄の掃除が過剰なケース", () => {
  const fx = setup();
  try {
    // rv1 で人間が保留 → rv2 が引き継ぎ (run_id だけ rv2 へ、first_run_id は rv1 のまま)
    const carried = entry({ run_id: "rv2", first_run_id: "rv1", ref: "F-03.match" });
    const own = entry({ run_id: "rv2", first_run_id: "rv2", ref: "F-09.new" });
    const snap = fx.write("snap.json", { app_name: "a", entries: [carried, own] });
    // rv2 を破棄して「自 run の未解決」を一括削除 → 引き継ぎ分まで消えた
    const ledger = fx.write("dev.json", { app_name: "a", entries: [] });
    const r = runVerify({ ledger, snapshot: snap, runId: "rv2" });
    assert.equal(r.verdict, "MISSING");
    assert.deepEqual(r.missing.map((m) => m.key), ["F-03.match"], "自 run 初出の F-09 は消えて良い");
    assert.match(r.missing[0].reason, /引き継いだ未解決/);
  } finally {
    fx.cleanup();
  }
});

test("resolved 済み entry が消えたら MISSING (人間の判断は履歴として残す)", () => {
  const fx = setup();
  try {
    const snap = fx.write("snap.json", {
      app_name: "a",
      entries: [entry({ run_id: "rv1", first_run_id: "rv1", resolved_at: "t", resolution: "容認", ref: "F-03.match" })],
    });
    const ledger = fx.write("dev.json", { app_name: "a", entries: [] });
    const r = runVerify({ ledger, snapshot: snap, runId: "rv1" });
    assert.equal(r.verdict, "MISSING");
    assert.match(r.missing[0].reason, /resolved/);
  } finally {
    fx.cleanup();
  }
});

test("自 run 初出の未解決だけが消えた場合は PASS (再列挙の揺れは正常)", () => {
  const fx = setup();
  try {
    const snap = fx.write("snap.json", {
      app_name: "a",
      entries: [entry({ run_id: "rv1", first_run_id: "rv1", ref: "F-03.match" })],
    });
    const ledger = fx.write("dev.json", { app_name: "a", entries: [] });
    const r = runVerify({ ledger, snapshot: snap, runId: "rv1" });
    assert.equal(r.verdict, "PASS");
    assert.equal(r.preserved_checked, 0);
  } finally {
    fx.cleanup();
  }
});

test("同じ ref を持つ他 phase の entry が残っていても、保全対象の消失は検出する", () => {
  const fx = setup();
  try {
    // ref は provenance からの転記なので、reverse と reverse_verify が同じ ref を持つのは正常な状態
    const reverseEntry = entry({ phase: "reverse", ref: "F-01.match" });
    const verifyEntry = entry({ run_id: "rv1", first_run_id: "rv1", resolved_at: "t", resolution: "修正依頼", ref: "F-01.match" });
    const snap = fx.write("snap.json", { app_name: "a", entries: [reverseEntry, verifyEntry] });
    // reverse 側の記録だけが消えた — phase 抜きの Set 照合では verify 側の同 ref で PASS してしまう形
    const ledger = fx.write("dev.json", { app_name: "a", entries: [verifyEntry] });
    const r = runVerify({ ledger, snapshot: snap, runId: "rv1" });
    assert.equal(r.verdict, "MISSING");
    assert.equal(r.missing.length, 1);
    assert.equal(r.missing[0].phase, "reverse");
    assert.match(r.missing[0].reason, /他 phase/);
  } finally {
    fx.cleanup();
  }
});

test("同 key の保全対象が 2 件 → 1 件に減ったら MISSING (存在有無でなく出現数で照合する)", () => {
  const fx = setup();
  try {
    const older = entry({ run_id: "rv1", first_run_id: "rv1", resolved_at: "t1", resolution: "容認", ref: "F-01.match" });
    const newer = entry({ run_id: "rv2", first_run_id: "rv2", resolved_at: "t2", resolution: "修正依頼", ref: "F-01.match" });
    const snap = fx.write("snap.json", { app_name: "a", entries: [older, newer] });
    const ledger = fx.write("dev.json", { app_name: "a", entries: [newer] });
    const r = runVerify({ ledger, snapshot: snap, runId: "rv3" });
    assert.equal(r.verdict, "MISSING");
    assert.equal(r.missing.length, 1);
    assert.match(r.missing[0].reason, /resolved/);
  } finally {
    fx.cleanup();
  }
});

test("ref 不在でも artifact::element で同一性が取れる (key 規則の互換)", () => {
  const fx = setup();
  try {
    const snap = fx.write("snap.json", { app_name: "a", entries: [entry({ phase: "design" })] });
    // 同じ artifact/element を持つ entry が残っていれば保全されたと判定する
    const kept = fx.write("dev.json", { app_name: "a", entries: [entry({ phase: "design", description: "更新済" })] });
    assert.equal(runVerify({ ledger: kept, snapshot: snap, runId: "rv1" }).verdict, "PASS");
  } finally {
    fx.cleanup();
  }
});

// ── CLI 契約 ─────────────────────────────────────────────────

test("verify は snapshot 不在で exit 2 (順序ミスを通さない)", () => {
  const fx = setup();
  try {
    const ledger = fx.write("dev.json", { app_name: "a", entries: [] });
    assert.equal(main(["verify", ledger, "--snapshot", fx.path("nope.json"), "--run-id", "rv1"]), 2);
  } finally {
    fx.cleanup();
  }
});

test("verify は --run-id 必須 / snapshot は --out 必須 / 未知モードは exit 2", () => {
  const fx = setup();
  try {
    const ledger = fx.write("dev.json", { app_name: "a", entries: [] });
    const snap = fx.write("snap.json", { app_name: "a", entries: [] });
    assert.equal(main(["verify", ledger, "--snapshot", snap]), 2, "--run-id 欠落");
    assert.equal(main(["snapshot", ledger]), 2, "--out 欠落");
    assert.equal(main(["bogus", ledger]), 2, "未知モード");
    assert.equal(main([]), 2, "引数なし");
  } finally {
    fx.cleanup();
  }
});

test("parseArgs は値の位置に別フラグが来たらエラーにする", () => {
  const a = parseArgs(["verify", "dev.json", "--snapshot", "--run-id", "rv1"]);
  assert.match(a.error, /--snapshot/);
});

test("main: 保全されていれば exit 0 / 消えていれば exit 1", () => {
  const fx = setup();
  try {
    const snap = fx.write("snap.json", { app_name: "a", entries: [entry({ phase: "reverse", ref: "F-01.badge" })] });
    const ok = fx.write("ok.json", { app_name: "a", entries: [entry({ phase: "reverse", ref: "F-01.badge" })] });
    const lost = fx.write("lost.json", { app_name: "a", entries: [] });
    assert.equal(main(["verify", ok, "--snapshot", snap, "--run-id", "rv1"]), 0);
    assert.equal(main(["verify", lost, "--snapshot", snap, "--run-id", "rv1"]), 1);
  } finally {
    fx.cleanup();
  }
});

test("壊れた JSON / 配列 top-level は exit 2 (検査を素通りさせない)", () => {
  const fx = setup();
  try {
    const broken = join(fx.dir, "broken.json");
    writeFileSync(broken, "{not json");
    const snap = fx.write("snap.json", { app_name: "a", entries: [] });
    assert.equal(main(["verify", broken, "--snapshot", snap, "--run-id", "rv1"]), 2);
    const arr = join(fx.dir, "arr.json");
    writeFileSync(arr, "[]");
    assert.equal(main(["verify", arr, "--snapshot", snap, "--run-id", "rv1"]), 2);
  } finally {
    fx.cleanup();
  }
});

test("snapshot は台帳の全文を残す (違反時の復旧原本になる)", () => {
  const fx = setup();
  try {
    const full = { app_name: "a", entries: [entry({ phase: "reverse", ref: "F-01.badge", description: "詳細本文" })], coverage: [{ phase: "reverse", raised_by_step: "05-review-gate", enumerated_count: 3 }] };
    const ledger = fx.write("dev.json", full);
    assert.equal(main(["snapshot", ledger, "--out", fx.path("snap.json")]), 0);
    assert.ok(existsSync(fx.path("snap.json")));
    assert.deepEqual(JSON.parse(readFileSync(fx.path("snap.json"), "utf8")), full, "coverage も description も残る");
  } finally {
    fx.cleanup();
  }
});
