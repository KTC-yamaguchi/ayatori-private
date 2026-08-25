#!/usr/bin/env node
// scripts/setup-image-key.test.mjs
//
// scripts/setup-image-key.mjs の黒箱テスト (POCTEAMA-408)。
// 実行: node --test scripts/setup-image-key.test.mjs (npm test で自動 discovery)
//
// テスト方針:
//   - HOME (+ Windows 用に USERPROFILE) を tmp dir に差し替えて実 ~/.ayatori / ~/.zshrc に
//     触らない。AYATORI_REPO_ROOT も tmp fixture に向け settings.local.json 走査を隔離。
//   - 作った tmp dir は after() で一括削除する (放置すると npm test のたびに積み上がる)。
//   - --no-open を常用しテスト中にエディタを起動しない。
//   - キーの全量が stdout に出ない (mask 契約) ことをどのケースでも検証する。
// resolveApiKey 側の読み取りチェーン (env → ファイル → OPENAI) は 21c/21e の evals が担当。
// ここは設定 CLI の作成・権限・診断報告のみ。

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// 実装 (21c/21e preflight) 側の解決チェーン — doctor の effectiveSource() は同じ優先順・同じ整形を
// 手で複製した 3 本目の実装なので、逐字一致ではなく **振る舞いの突き合わせ** で同期を担保する
// (21c/21e 同士は 21e eval が逐字一致で検証済み)
import { resolveApiKey } from "../skills/21e-graphic-generate/scripts/preflight.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "setup-image-key.mjs");
const FULL_KEY = "sk-svcacct-test-0123456789abcdef0123456789abcdef";

// POSIX mode (0o600 等) の断言は win32 では成立しない (mkdirSync の mode は無視され、
// stat.mode は 0o666 系を返す) — 実装側も POSIX_PERMS=false で権限系を NTFS ACL に委ねるので、
// 権限が本題のテストは win32 では skip する (実装と同じ境界。3者レビュー#10)
const POSIX = process.platform !== "win32";
const SKIP_ON_WIN = !POSIX && "win32 では POSIX 権限検査は対象外 (POSIX_PERMS=false — NTFS ACL 側)";

// 各 test が作る tmp home を追跡し、テスト終了時にまとめて消す
const TMP_HOMES = [];
after(() => {
  for (const dir of TMP_HOMES) rmSync(dir, { recursive: true, force: true });
});

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), "setup-image-key-"));
  TMP_HOMES.push(home);
  const repo = join(home, "repo");
  mkdirSync(repo, { recursive: true });
  return { home, repo, keyFile: join(home, ".ayatori", "image-api-key") };
}

/** HOME / repoRoot を隔離して実行。キー系 env はテストごとに明示注入する。
 *  opts.noRepoRoot: fixture marker を外す (テスト knob の単独残留を再現する場合のみ)。 */
function run(args, { home, repo }, env = {}, opts = {}) {
  const childEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home, // Windows の os.homedir() は $HOME ではなく USERPROFILE を見る
    AYATORI_REPO_ROOT: repo,
    AYATORI_IMAGE_API_KEY: "",
    OPENAI_API_KEY: "",
    AYATORI_IMAGE_API_KEY_FILE: "",
    ...env,
  };
  if (opts.noRepoRoot) delete childEnv.AYATORI_REPO_ROOT;
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: childEnv });
  return { status: res.status, out: res.stdout + res.stderr };
}

test("--init --no-open: dir 0700 / file 0600 で作成し、パスと再起動不要の案内を出す", () => {
  const ctx = makeHome();
  const { status, out } = run(["--init", "--no-open"], ctx);
  assert.equal(status, 0, out);
  if (POSIX) {
    assert.equal(statSync(join(ctx.home, ".ayatori")).mode & 0o777, 0o700);
    assert.equal(statSync(ctx.keyFile).mode & 0o777, 0o600);
  }
  assert.match(out, /image-api-key/);
  assert.match(out, /再起動は不要/);
});

test("--init: opener が使えない環境では「開きました」と嘘をつかずパス提示に degrade する", () => {
  const ctx = makeHome();
  // PATH を空にして open / xdg-open を見つけられない状態にする (GUI を起動させずに失敗経路を通す)
  const { status, out } = run(["--init"], ctx, { PATH: join(ctx.home, "no-bin") });
  assert.equal(status, 0, out);
  assert.match(out, /上記パスのファイルをエディタで開いて編集してください/);
  assert.ok(!/開きました/.test(out), "起動できていないのに成功を報告してはならない");
});

test("--init: 既存キーは保持し (上書きしない)、mask 表示のみで全量を出さない", () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(ctx.keyFile, `${FULL_KEY}\n`, { mode: 0o600 });
  const { status, out } = run(["--init", "--no-open"], ctx);
  assert.equal(status, 0, out);
  assert.equal(readFileSync(ctx.keyFile, "utf8"), `${FULL_KEY}\n`); // 内容は不変
  assert.match(out, /既にキーが設定されています/);
  assert.ok(!out.includes(FULL_KEY), "キー全量が出力に含まれてはならない");
  assert.ok(out.includes(FULL_KEY.slice(0, 8)), "mask (先頭 8 文字) は表示する");
});

test("--init: キーファイルが $HOME 直下でも $HOME の権限は変えない (共有 dir を巻き込まない)", { skip: SKIP_ON_WIN }, () => {
  const ctx = makeHome();
  chmodSync(ctx.home, 0o755);
  const direct = join(ctx.home, "image-api-key");
  const { status, out } = run(["--init", "--no-open"], ctx, { AYATORI_IMAGE_API_KEY_FILE: direct });
  assert.equal(status, 0, out);
  assert.equal(statSync(ctx.home).mode & 0o777, 0o755, "$HOME の権限を変えてはならない");
  assert.equal(statSync(direct).mode & 0o777, 0o600, "キーファイル自身は 600 に矯正する");
});

test("--init: knob が指す既存の共有 dir の権限は変えない (自分が作った dir と既定 dir のみ矯正)", { skip: SKIP_ON_WIN }, () => {
  const ctx = makeHome();
  const shared = join(ctx.home, "team", "shared"); // 既存の共有 dir を模す (深さは $HOME 直下に限らない)
  mkdirSync(shared, { recursive: true });
  chmodSync(shared, 0o755);
  const { status, out } = run(["--init", "--no-open"], ctx, { AYATORI_IMAGE_API_KEY_FILE: join(shared, "image-api-key") });
  assert.equal(status, 0, out);
  assert.equal(statSync(shared).mode & 0o777, 0o755, "既存 dir の権限を変えてはならない");
  assert.equal(statSync(join(shared, "image-api-key")).mode & 0o777, 0o600, "キーファイル自身は 600 に矯正する");
});

test("--init: 既定 dir (~/.ayatori) が緩んだ権限で既存でも 0700 に矯正する (規約上の専用 dir)", { skip: SKIP_ON_WIN }, () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true });
  chmodSync(dirname(ctx.keyFile), 0o755);
  const { status } = run(["--init", "--no-open"], ctx);
  assert.equal(status, 0);
  assert.equal(statSync(dirname(ctx.keyFile)).mode & 0o777, 0o700);
});

test("--init: 権限が緩んだ既存ファイルを 0600 に矯正する", { skip: SKIP_ON_WIN }, () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true });
  writeFileSync(ctx.keyFile, FULL_KEY);
  chmodSync(ctx.keyFile, 0o644);
  const { status } = run(["--init", "--no-open"], ctx);
  assert.equal(status, 0);
  assert.equal(statSync(ctx.keyFile).mode & 0o777, 0o600);
});

test(
  "--init: キーファイルを準備できない場合は stack trace ではなく案内つきで exit 1",
  { skip: SKIP_ON_WIN || (process.getuid?.() === 0 && "root は権限に関係なく書けるため再現不能") },
  () => {
    const ctx = makeHome();
    // 既定 dir (~/.ayatori) は規約上 --init が権限を矯正してしまうため、失敗経路の再現には
    // 矯正対象外の「既存の共有 dir」(3者レビュー#7) を knob で指す — 書込不可 = sudo 作成 /
    // sandbox 拒否の代役
    const locked = join(ctx.home, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o500);
    try {
      const { status, out } = run(["--init", "--no-open"], ctx, { AYATORI_IMAGE_API_KEY_FILE: join(locked, "image-api-key") });
      assert.equal(status, 1, out);
      assert.match(out, /キーファイルを準備できません/);
      assert.match(out, /所有者と権限を確認/, "直し方へ導く");
      assert.match(out, /--doctor/, "診断へ導く");
      assert.ok(!/\n\s+at /.test(out), "裸の stack trace を出さない");
    } finally {
      chmodSync(locked, 0o700); // after() の一括削除が失敗しないよう戻す
    }
  }
);

test("--init: env が効いているなら「貼っても有効にならない」と遮蔽を警告する (--doctor を待たせない)", () => {
  const ctx = makeHome();
  const { out } = run(["--init", "--no-open"], ctx, { AYATORI_IMAGE_API_KEY: "sk-env-side-key" });
  assert.match(out, /env AYATORI_IMAGE_API_KEY が設定されています/);
  assert.match(out, /有効になりません/);
  // env が無ければ余計な警告を出さない
  const clean = run(["--init", "--no-open"], makeHome());
  assert.ok(!/有効になりません/.test(clean.out), "遮蔽が無いときは警告しない");
});

test("--doctor: どこにも無ければ「実効ソース: なし」と E_NO_API_KEY への言及を出す", () => {
  const ctx = makeHome();
  const { status, out } = run(["--doctor"], ctx);
  assert.equal(status, 0, out);
  assert.match(out, /実効ソース: なし/);
  assert.match(out, /E_NO_API_KEY/);
  assert.match(out, /診断対象はこのプロセスの env/, "診断の有効範囲 (プロセス境界) を毎回明示する");
});

test("--doctor: 24 文字未満の短い値は全量非表示 (slice の短鍵全量漏えいを塞ぐ)", () => {
  const ctx = makeHome();
  const shortKey = "test1234"; // slice(0, 8) が全量を返す長さ
  const { status, out } = run(["--doctor"], ctx, { AYATORI_IMAGE_API_KEY: shortKey });
  assert.equal(status, 0, out);
  assert.ok(!out.includes(shortKey), "短い値は一切 stdout に出してはならない");
  assert.match(out, /全量非表示/);
});

test("--doctor: キーファイルのみ設置 → それを実効ソースとして mask 付きで報告する", () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(ctx.keyFile, `${FULL_KEY}\n`, { mode: 0o600 });
  const { status, out } = run(["--doctor"], ctx);
  assert.equal(status, 0, out);
  assert.match(out, /実効ソース: キーファイル/);
  assert.ok(!out.includes(FULL_KEY), "キー全量が出力に含まれてはならない");
});

test(
  "--doctor: 読取不能なキーファイルは「中身が空」ではなく「読めません」と報告する",
  { skip: SKIP_ON_WIN || (process.getuid?.() === 0 && "root は権限に関係なく読めるため再現不能") },
  () => {
    const ctx = makeHome();
    mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
    writeFileSync(ctx.keyFile, `${FULL_KEY}\n`);
    chmodSync(ctx.keyFile, 0o000); // 所有者にも読めない (sudo 作成で所有者が root になった状況の代役)
    try {
      const { status, out } = run(["--doctor"], ctx);
      assert.equal(status, 0, out);
      assert.match(out, /読めません \(EACCES/, "エラー種別を出す");
      assert.match(out, /所有者と権限を確認/, "直し方へ導く");
      assert.ok(!/ファイルはあるが中身が空/.test(out), "「空」と誤報してはならない");
    } finally {
      chmodSync(ctx.keyFile, 0o600); // after() の一括削除が失敗しないよう戻す
    }
  }
);

test("--doctor: 鍵にならない中身 (空白混入) は「使えません」と警告し、OK と言わない", () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(ctx.keyFile, "sk-broken key-with-space\n", { mode: 0o600 });
  const { status, out } = run(["--doctor"], ctx);
  assert.equal(status, 0, out);
  assert.match(out, /実効ソース: なし/, "整形しても鍵にならない値は未設定扱い");
  assert.match(out, /中身が鍵として使えません/);
  assert.ok(!/警告: なし/.test(out), "「このまま利用できます」と言ってはならない");
});

test("--doctor: 空白のみの env → 走査行の「形式不正 (下記警告)」に対応する警告を実際に出す", () => {
  const ctx = makeHome();
  const { status, out } = run(["--doctor"], ctx, { AYATORI_IMAGE_API_KEY: " " });
  assert.equal(status, 0, out);
  assert.match(out, /env AYATORI_IMAGE_API_KEY — 形式不正 \(下記警告\)/, "走査行の表示");
  assert.match(out, /空白のみの値です/, "行が指す警告が実在する");
  assert.ok(!/警告: なし/.test(out), "行で警告を予告して総括で「なし」と言う自己矛盾を出さない");
});

test("--doctor: 引用符・KEY= 前置つきで貼られた鍵は使えるが、整え直しを促す警告を出す", () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(ctx.keyFile, `AYATORI_IMAGE_API_KEY="${FULL_KEY}"\n`, { mode: 0o600 });
  const { status, out } = run(["--doctor"], ctx);
  assert.equal(status, 0, out);
  assert.match(out, /実効ソース: キーファイル/, "整形して使える");
  assert.match(out, /余分な装飾/);
  assert.ok(!out.includes(FULL_KEY), "キー全量が出力に含まれてはならない");
});

test("--doctor: env とファイルが異なる値 → env 優先の遮蔽警告を出す", () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(ctx.keyFile, "sk-file-side-key", { mode: 0o600 });
  const { status, out } = run(["--doctor"], ctx, { AYATORI_IMAGE_API_KEY: "sk-env-side-key" });
  assert.equal(status, 0, out);
  assert.match(out, /実効ソース: env AYATORI_IMAGE_API_KEY/);
  assert.match(out, /env が優先されるため/);
});

test("--doctor: 引用符つき env と同値のファイル → 遮蔽の誤報を出さない (整形後の値で比較する)", () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(ctx.keyFile, `${FULL_KEY}\n`, { mode: 0o600 });
  const { status, out } = run(["--doctor"], ctx, { AYATORI_IMAGE_API_KEY: `"${FULL_KEY}"` });
  assert.equal(status, 0, out);
  assert.ok(!/値が異なります/.test(out), "整形後は同値 — 遮蔽警告を出してはならない");
  assert.match(out, /余分な装飾/, "引用符の指摘は formatIssue が担う");
});

test("--doctor: 形式不正で効いていない env → 「env が優先される」と事実に反する警告を出さない", () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(ctx.keyFile, `${FULL_KEY}\n`, { mode: 0o600 });
  const { status, out } = run(["--doctor"], ctx, { AYATORI_IMAGE_API_KEY: "sk-broken key" });
  assert.equal(status, 0, out);
  assert.match(out, /実効ソース: キーファイル/, "壊れた env は有効にならない — ファイルが勝つ");
  assert.ok(!/env が優先されるため/.test(out), "効いていない env を「優先される」と言ってはならない");
  assert.match(out, /中身が鍵として使えません/, "壊れた env の指摘は formatIssue が担う");
});

// 「KEY=」で改行してから鍵を貼る 2 行貼り付けは docs が吸収を約束している形 — 先頭行だけ見て
// 打ち切ると前置の剥がしで空になり「中身が鍵として使えません」と誤診する。整形で吸収したうえで
// 装飾の指摘は残す (次のローテーションで同じ貼り方を繰り返させない)。
test("--doctor: KEY= で改行してから鍵を貼った 2 行のキーファイルを吸収する", () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(ctx.keyFile, `AYATORI_IMAGE_API_KEY=\n${FULL_KEY}\n`, { mode: 0o600 });
  const { status, out } = run(["--doctor"], ctx);
  assert.equal(status, 0, out);
  assert.match(out, /実効ソース: キーファイル/, "未設定扱いにしてはならない");
  assert.ok(!/中身が鍵として使えません/.test(out), "誤診を出さない");
  assert.match(out, /余分な装飾/, "吸収はするが 1 行に整える推奨は残す");
  assert.ok(!out.includes(FULL_KEY), "mask 契約");
});

test("--doctor: ~/.zshrc の AYATORI_IMAGE_API_KEY 代入 → 非対話 shell から見えない旨の警告を出す", () => {
  const ctx = makeHome();
  writeFileSync(join(ctx.home, ".zshrc"), 'export AYATORI_IMAGE_API_KEY="sk-zshrc-key"\n');
  const { status, out } = run(["--doctor"], ctx);
  assert.equal(status, 0, out);
  assert.match(out, /~\/\.zshrc に AYATORI_IMAGE_API_KEY の代入があります/);
  assert.match(out, /非対話 shell/);
});

// 上のテストは env を空にした「非対話 shell 視点」— 対話 shell では rc が読まれて env にも同じ鍵が
// 現れる。旧実装はこの組み合わせだけ env と由来 rc を二重に数え、1 箇所しか無いのに集約警告を出して
// いた (本 PR の移行対象がまさにこの状態なので、初回利用者が最も踏む)。env を明示注入しないと
// run() の既定が空にしてしまい踏めないため、下の 2 本は必ず env つきで走らせる。
test("--doctor: ~/.zshrc 1 箇所 + env 可視 (対話 shell 視点) → env と由来 rc を二重に数えない", () => {
  const ctx = makeHome();
  writeFileSync(join(ctx.home, ".zshrc"), `export AYATORI_IMAGE_API_KEY="${FULL_KEY}"\n`);
  const { status, out } = run(["--doctor"], ctx, { AYATORI_IMAGE_API_KEY: FULL_KEY });
  assert.equal(status, 0, out);
  assert.match(out, /由来候補: ~\/\.zshrc/, "由来が特定できている前提のケース");
  assert.ok(!/複数の場所に設置されています/.test(out), "設置は ~/.zshrc の 1 箇所 — 集約警告は誤り");
  assert.match(out, /~\/\.zshrc に AYATORI_IMAGE_API_KEY の代入があります/, "場所ごとの移行推奨は畳まない");
  assert.ok(!out.includes(FULL_KEY), "mask 契約");
});

// 上の抑制が効きすぎていないかの哨兵 — これが無いと ayatoriPlaces を 0 に固定するだけでも上が通る
test("--doctor: ~/.zshrc + キーファイルの 2 箇所併存 → 集約警告は出す", () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(ctx.keyFile, `${FULL_KEY}\n`, { mode: 0o600 });
  const rcKey = "sk-zshrc-0123456789abcdefghij";
  writeFileSync(join(ctx.home, ".zshrc"), `export AYATORI_IMAGE_API_KEY="${rcKey}"\n`);
  const { status, out } = run(["--doctor"], ctx, { AYATORI_IMAGE_API_KEY: rcKey });
  assert.equal(status, 0, out);
  assert.match(out, /複数の場所に設置されています/, "rc とキーファイルは別の設置場所 — 集約を促すのが正しい");
});

// 由来が走査で特定できない env (VSCode 起動時に固定 / 手動 export) は、それ自体が 1 箇所として
// 数えられる — キーファイルと併存すれば集約警告が出る (dedupe が origins 依存であることの裏取り)
test("--doctor: 由来不明の env + キーファイル → env を独立した設置場所として数える", () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(ctx.keyFile, `${FULL_KEY}\n`, { mode: 0o600 });
  const { status, out } = run(["--doctor"], ctx, { AYATORI_IMAGE_API_KEY: "sk-frozen-0123456789abcdefghij" });
  assert.equal(status, 0, out);
  assert.match(out, /由来は走査対象外/, "どの走査対象にも代入が無い前提のケース");
  assert.match(out, /複数の場所に設置されています/);
});

// 実行中の Claude Code は permission entry の記録のたびに settings 系を記憶内容で書き戻すため、
// session 中に消した env は復活する。この前提は settings 系だけに付き、rc には付かない (Claude Code は
// ~/.zshrc を書き戻さない) — 全部に付けると rc の掃除に不要な手間を案内することになる。
test("--doctor: settings 系の削除案内には「Claude Code を終了してから」が付き、rc には付かない", () => {
  const ctx = makeHome();
  const settings = join(ctx.home, ".claude", "settings.local.json");
  mkdirSync(dirname(settings), { recursive: true });
  writeFileSync(settings, JSON.stringify({ env: { AYATORI_IMAGE_API_KEY: "sk-settings-side" } }));
  writeFileSync(join(ctx.home, ".zshrc"), 'export AYATORI_IMAGE_API_KEY="sk-zshrc-side"\n');
  const { status, out } = run(["--doctor"], ctx);
  assert.equal(status, 0, out);
  const line = (label) => out.split("\n").find((l) => l.includes(`${label} に AYATORI_IMAGE_API_KEY の代入があります`));
  assert.match(line("settings.local.json (Claude Code user 設定)"), /Claude Code .*を終了してから/, "書き戻しの前提を案内する");
  assert.doesNotMatch(line("~/.zshrc"), /終了してから/, "rc は Claude Code が書き戻さない — 不要な手間を案内しない");
});

test("--doctor: ~/.zshrc の OPENAI_API_KEY は他ツール用かもしれないので削除を勧めない (誤警告の防止)", () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(ctx.keyFile, `${FULL_KEY}\n`, { mode: 0o600 });
  writeFileSync(join(ctx.home, ".zshrc"), 'export OPENAI_API_KEY="sk-other-tool"\nunset AYATORI_IMAGE_API_KEY\n');
  const { status, out } = run(["--doctor"], ctx);
  assert.equal(status, 0, out);
  assert.match(out, /OPENAI_API_KEY の代入あり/, "走査行には出す");
  assert.ok(!/当該行の削除を推奨/.test(out), "無関係な鍵の削除を勧めてはならない");
  assert.ok(!/複数の場所に設置されています/.test(out), "AYATORI の鍵は 1 箇所なので集約警告も出さない");
  assert.ok(!/AYATORI_IMAGE_API_KEY の代入あり/.test(out), "unset 行は設置と数えない");
});

test("--doctor: 空白のみの env は「鍵の設置場所」として数えない (集約警告の誤警告)", () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(ctx.keyFile, `${FULL_KEY}\n`, { mode: 0o600 });
  const { status, out } = run(["--doctor"], ctx, { AYATORI_IMAGE_API_KEY: "   " });
  assert.equal(status, 0, out);
  assert.match(out, /空白のみの値です/, "実質未設定である旨は出す");
  assert.ok(!/複数の場所に設置されています/.test(out), "鍵はキーファイルの 1 箇所だけ — 集約警告は誤り");
});

test("--doctor: 整形しても鍵にならない env も数えない (実効ソースにならない値は設置ではない)", () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(ctx.keyFile, `${FULL_KEY}\n`, { mode: 0o600 });
  const { status, out } = run(["--doctor"], ctx, { AYATORI_IMAGE_API_KEY: "sk-broken key" });
  assert.equal(status, 0, out);
  assert.match(out, /実効ソース: キーファイル/, "壊れた env は効かない");
  assert.ok(!/複数の場所に設置されています/.test(out));
});

// 走査先を黙って別ツリーへ向けたまま「記載なし」と断言しないための開示 (critical な設置場所の偽陰性防止)
test("--doctor: 走査した repo root を明示し、env による差し替えは注意つきで出す", () => {
  const ctx = makeHome();
  const { status, out } = run(["--doctor"], ctx);
  assert.equal(status, 0, out);
  assert.ok(out.includes(`root: ${ctx.repo}`), "実際に走査した root を書く");
  assert.match(out, /AYATORI_REPO_ROOT による差し替え/, "knob 残留を疑える文面を添える");
});

test("--doctor: ホーム側 ~/.claude/settings.json の env も走査し、権限が緩ければ警告する", { skip: SKIP_ON_WIN }, () => {
  const ctx = makeHome();
  const settings = join(ctx.home, ".claude", "settings.json");
  mkdirSync(dirname(settings), { recursive: true });
  writeFileSync(settings, JSON.stringify({ env: { AYATORI_IMAGE_API_KEY: "sk-home-settings" } }));
  chmodSync(settings, 0o644);
  const { status, out } = run(["--doctor"], ctx);
  assert.equal(status, 0, out);
  assert.match(out, /~\/\.claude\/settings\.json.+AYATORI_IMAGE_API_KEY の代入あり/);
  assert.match(out, /権限が 644 です/, "設定ファイルは既定で本人のみとは限らない");
});

test("--doctor: 効いている env の「由来候補」を走査結果から示す (どこから来たか答えられる)", () => {
  const ctx = makeHome();
  const settings = join(ctx.home, ".claude", "settings.json");
  mkdirSync(dirname(settings), { recursive: true });
  writeFileSync(settings, JSON.stringify({ env: { AYATORI_IMAGE_API_KEY: "sk-home-settings" } }));
  const hit = run(["--doctor"], ctx, { AYATORI_IMAGE_API_KEY: "sk-home-settings" });
  assert.match(hit.out, /由来候補: ~\/\.claude\/settings\.json/);
  // 走査対象のどこにも代入が無い env (VSCode 起動時に固定された env 等) は素直にそう言う
  const unknown = run(["--doctor"], makeHome(), { AYATORI_IMAGE_API_KEY: "sk-from-nowhere" });
  assert.match(unknown.out, /由来は走査対象外/);
});

test("--doctor: settings.local.json の env ブロックを検出し「再クローンで消える」旨を注記する", () => {
  const ctx = makeHome();
  mkdirSync(join(ctx.repo, ".claude"), { recursive: true });
  writeFileSync(
    join(ctx.repo, ".claude", "settings.local.json"),
    JSON.stringify({ env: { AYATORI_IMAGE_API_KEY: "sk-local-key" } })
  );
  const { status, out } = run(["--doctor"], ctx);
  assert.equal(status, 0, out);
  assert.match(out, /settings\.local\.json.+AYATORI_IMAGE_API_KEY の代入あり/);
  assert.match(out, /再クローンで消える/);
});

test("--doctor: 壊れた settings JSON は「記載なし」と断言せず「走査不能 — 手動確認」を出す", () => {
  const ctx = makeHome();
  const settings = join(ctx.home, ".claude", "settings.json");
  mkdirSync(dirname(settings), { recursive: true });
  writeFileSync(settings, '{ "env": { "AYATORI_IMAGE_API_KEY": "sk-hidden", }, }'); // 末尾カンマ = JSON 不正
  const { status, out } = run(["--doctor"], ctx);
  assert.equal(status, 0, out);
  assert.match(out, /~\/\.claude\/settings\.json.+走査不能/, "偽陰性を出さない");
  assert.match(out, /手動で確認/, "警告として手動確認を求める");
  assert.ok(!/~\/\.claude\/settings\.json \(Claude Code user 設定\) — 記載なし/.test(out), "「記載なし」と断言してはならない");
});

test("--doctor: repo 内 .claude/settings.json (commit される) も走査し、即削除 + ローテーションを出す", () => {
  const ctx = makeHome();
  mkdirSync(join(ctx.repo, ".claude"), { recursive: true });
  writeFileSync(
    join(ctx.repo, ".claude", "settings.json"),
    JSON.stringify({ env: { AYATORI_IMAGE_API_KEY: "sk-committed-key" } })
  );
  const { status, out } = run(["--doctor"], ctx, { AYATORI_IMAGE_API_KEY: "sk-committed-key" });
  assert.equal(status, 0, out);
  assert.match(out, /\.claude\/settings\.json \(この repo.+AYATORI_IMAGE_API_KEY の代入あり/, "走査行に出る");
  assert.match(out, /由来候補: .*\.claude\/settings\.json \(この repo/, "実効 env の由来として答えられる");
  assert.match(out, /即削除し、キーをローテーション/, "移行推奨ではなく即時対応を求める");
});

test("AYATORI_IMAGE_API_KEY_FILE は AYATORI_REPO_ROOT 併用時のみ有効 (単独残留 env は警告して既定パス)", () => {
  const ctx = makeHome();
  const stray = join(ctx.home, "stray-key");
  writeFileSync(stray, FULL_KEY);
  const { status, out } = run(["--doctor"], ctx, { AYATORI_IMAGE_API_KEY_FILE: stray }, { noRepoRoot: true });
  assert.equal(status, 0, out);
  assert.match(out, /併用時のみ有効/, "無言でなく警告する");
  assert.match(out, /image-api-key/, "既定パスを診断対象にする");
  assert.ok(!out.includes("stray-key"), "単独残留 env のパスは採用しない");
  assert.ok(!out.includes(FULL_KEY.slice(0, 8)), "単独残留 env が指すファイルのキーは読まない");
});

test("--doctor の実効ソース判定は 21c/21e の resolveApiKey と一致する (3 本目の複製の同期検証)", () => {
  const ctx = makeHome();
  mkdirSync(dirname(ctx.keyFile), { recursive: true, mode: 0o700 });
  const withEnv = (env, fn) => {
    const KEYS = ["AYATORI_IMAGE_API_KEY", "OPENAI_API_KEY", "AYATORI_IMAGE_API_KEY_FILE", "AYATORI_REPO_ROOT"];
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    try {
      for (const k of KEYS) delete process.env[k];
      Object.assign(process.env, env);
      return fn();
    } finally {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  };
  const cases = [
    // fixture 鍵は 24 文字以上にする — mask は短い値を全量非表示にするため、それ未満だと
    // 「doctor が実装と同じ値を実効と判定した」ことを先頭 8 文字で照合できない
    { name: "env のみ", file: null, env: { AYATORI_IMAGE_API_KEY: "sk-env-only-0123456789abcdef" }, label: "env AYATORI_IMAGE_API_KEY" },
    { name: "ファイルのみ", file: `${FULL_KEY}\n`, env: {}, label: "キーファイル" },
    { name: "ファイル > OPENAI_API_KEY (③ の順序)", file: `${FULL_KEY}\n`, env: { OPENAI_API_KEY: "sk-openai" }, label: "キーファイル" },
    { name: "OPENAI_API_KEY のみ", file: null, env: { OPENAI_API_KEY: "sk-openai-only-0123456789abcdef" }, label: "env OPENAI_API_KEY" },
    { name: "装飾つきファイル (整形して使う)", file: `export AYATORI_IMAGE_API_KEY="${FULL_KEY}"\n`, env: {}, label: "キーファイル" },
    { name: "壊れたファイル (未設定扱い)", file: "sk-broken key\n", env: {}, label: null },
    { name: "どこにも無し", file: null, env: {}, label: null },
  ];
  for (const c of cases) {
    writeFileSync(ctx.keyFile, c.file ?? "", { mode: 0o600 });
    // 実装側 (21e preflight) が何を返すかを同じ env で先に確定させる
    const childEnv = { AYATORI_IMAGE_API_KEY_FILE: ctx.keyFile, AYATORI_REPO_ROOT: ctx.repo, ...c.env };
    const expected = withEnv(childEnv, () => resolveApiKey());
    const { out } = run(["--doctor"], ctx, childEnv);
    if (c.label === null) {
      assert.equal(expected, null, `${c.name}: 実装側も未設定であること`);
      assert.match(out, /実効ソース: なし/, c.name);
    } else {
      assert.ok(expected, `${c.name}: 実装側がキーを返すこと`);
      assert.match(out, new RegExp(`実効ソース: ${c.label}`), c.name);
      assert.ok(out.includes(expected.slice(0, 8)), `${c.name}: doctor が実装と同じ値を実効と判定すること`);
    }
  }
});

test("不明な引数は usage を出して exit 1", () => {
  const ctx = makeHome();
  const { status, out } = run(["--bogus"], ctx);
  assert.equal(status, 1);
  assert.match(out, /使い方/);
});

test("--init --doctor の同時指定は --init を黙って捨てず exit 1 で説明する", () => {
  const ctx = makeHome();
  const { status, out } = run(["--init", "--doctor"], ctx);
  assert.equal(status, 1);
  assert.match(out, /同時指定できません/);
  assert.ok(!statSync(dirname(ctx.keyFile), { throwIfNoEntry: false }), "どちらの動作も実行しない (ファイル作成なし)");
});

test("--doctor --no-open は無意味な組み合わせとして exit 1", () => {
  const ctx = makeHome();
  const { status, out } = run(["--doctor", "--no-open"], ctx);
  assert.equal(status, 1);
  assert.match(out, /--no-open は --init 専用/);
});
