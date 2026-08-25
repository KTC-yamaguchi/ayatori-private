#!/usr/bin/env node
// setup-image-key.mjs — グラフィック生成 API キーの設定・診断 CLI (POCTEAMA-408)
//
// 正典の設置場所は **キーファイル ~/.ayatori/image-api-key** (単一値ファイル — 中身はキー 1 行のみ)。
// 21c/21e の resolveApiKey が実行時に直読するため、設定後の Claude Code / VSCode 再起動が不要で、
// 起動方法 (VSCode / ターミナル / 非対話 shell) にも依存しない。env 経路 (~/.zshrc /
// .claude/settings.local.json) は互換のため生き続けるが、案件横断・再クローン耐性・再起動不要の
// 3 点を満たすのは本ファイルのみ (詳細: docs/setup.md「グラフィック生成 API キー」)。
//
// 使い方:
//   node scripts/setup-image-key.mjs             # = --init
//   node scripts/setup-image-key.mjs --init      # ~/.ayatori/image-api-key を作成 (0600) してエディタで開く
//   node scripts/setup-image-key.mjs --init --no-open   # エディタを開かずパス案内のみ (テスト / CI 用)
//   node scripts/setup-image-key.mjs --doctor    # 全設置場所を走査して実効ソース・残存コピー・警告を報告
//
// 設計メモ:
// - キーの値を argv / stdin で受け取らない (ps / shell history / Claude transcript への漏出を避ける) —
//   ユーザー自身がエディタでファイルに貼り付ける。
// - キーの値は全量表示しない (先頭 8 文字 + 文字数のみ)。
// - doctor は報告と提案のみ — 他の設置場所を勝手に削除・書き換えしない (重複配置は検出で収斂させる)。
// - エディタ起動は OS 同梱コマンドのみ (macOS=open -t / Linux=xdg-open / Windows=cmd.exe /c start)。
//   起動できたかを実際に確認し、失敗時はパス提示のみに degrade する (Operating Principle 1 の
//   link-only fallback と同じ扱い)。なお本 script は opener を **node から spawn** するため、
//   .claude/settings.json の opener 許可 entry (Bash(open:*) / Bash(xdg-open:*) / Bash(cmd.exe:*)
//   — Bash tool が直接叩く人間ゲート preview 用) は経由せず Bash(node:*) の範囲で動く。
//   許可 entry を消しても本 script は動く / 本 script のために entry を足す必要もない、という関係。
// - AYATORI_IMAGE_API_KEY_FILE はテスト用のパス差し替え knob — AYATORI_REPO_ROOT (fixture) と
//   併用時のみ有効で、単独残留の env は警告して無視する (21c/21e preflight の imageKeyFilePath()
//   と同一契約。AYATORI_PIPELINE_YAML の「env が無言で差し替えない」契約に揃えたもの)。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot =
  process.env.AYATORI_REPO_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// キーファイルのパス — 21c/21e preflight の imageKeyFilePath() と同一契約 (逐字コピー不可なのは
// root script から skill 内部を import しない方針のため。振る舞いの一致は
// scripts/setup-image-key.test.mjs が 21e の resolveApiKey と突き合わせて機械検証する)。
const keyFile = (() => {
  const fallback = path.join(os.homedir(), ".ayatori", "image-api-key");
  const override = process.env.AYATORI_IMAGE_API_KEY_FILE;
  if (!override) return fallback;
  if (process.env.AYATORI_REPO_ROOT) return override;
  console.error("[image-key] warn: AYATORI_IMAGE_API_KEY_FILE は AYATORI_REPO_ROOT (fixture) と併用時のみ有効 — 実 run では無視します");
  return fallback;
})();
const keyDir = path.dirname(keyFile);

// 24 文字未満の値は全量非表示 — slice(0, 8) は 8 文字以下の値を**全量**返すため、自前 endpoint の
// 短い token が stdout (= Claude transcript / CI ログ) に丸ごと載る。先頭 8 文字の開示は
// 「値の大半が隠れる長さ」でのみ許す (実 OpenAI キーは 40 文字以上なので運用上は常に開示側)。
const mask = (v) => (v.length < 24 ? `※短い値 (${v.length} 文字 — 全量非表示)` : `${v.slice(0, 8)}… (${v.length} 文字)`);
// Windows の fs.chmod は read-only ビット相当しか反映しないため mode 比較は永久に一致せず、
// 「権限が 666 です — chmod 600 して」という直せない警告を出し続ける (レビュー L6)。
// POSIX 以外では権限の矯正・検査・表示をまとめて見送り、ACL 側で管理する旨だけ伝える。
const POSIX_PERMS = process.platform !== "win32";
const modeOf = (p) => {
  try {
    return fs.statSync(p).mode & 0o777;
  } catch {
    return null;
  }
};

/** win32 専用: icacls (Windows OS 同梱 — Operating Principle 1 の OS 同梱例外) で
 *  「本人以外に読める ACE があるか」を粗判定する。POSIX_PERMS=false で権限検査を全て見送ると
 *  全員可読の鍵ファイルにも doctor が沈黙する空白地帯になる (3者レビュー#10)。
 *  well-known グループの英語名に加え、ローカライズ環境向けに SID 直表記 (icacls は
 *  未解決 SID を *S-1-... で出す) も見る。判定不能 (icacls 不在 / 失敗 / 非 win32) は
 *  null = 警告しない (fail-open — 誤警告よりも沈黙を選ぶ。厳密な検査は ACL 管理者に委ねる)。 */
function windowsAclLooksOpen(p) {
  if (POSIX_PERMS) return null;
  try {
    const res = spawnSync("icacls", [p], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000, windowsHide: true });
    if (res.status !== 0 || !res.stdout) return null;
    // DENY ACE は「読める」の反証なので許可として数えない — icacls は拒否を GROUP:(DENY)(R) の形で
    // 出すため、素の名前一致だと `icacls /deny Everyone:(R)` で固めた鍵に「他人から読める可能性」と
    // 誤警告し、既に閉じているファイルへ icacls を再実行させる。誤警告よりも沈黙を選ぶ本 function の
    // 契約 (上記) に従って、拒否行は判定から落とす。
    const allowText = res.stdout
      .split(/\r?\n/)
      .filter((l) => !/\(DENY\)/i.test(l))
      .join("\n");
    return /(Everyone|Authenticated Users|BUILTIN\\Users|\*S-1-1-0|\*S-1-5-11|\*S-1-5-32-545)/i.test(allowText);
  } catch {
    return null;
  }
}
/** 「読めない / 作れない」ときの復旧案内 — 権限系の他の案内 (chmod 600 ⇄ icacls) と同様に
 *  platform で分岐する。POSIX の ls/chown/sudo をそのまま win32 に出すと存在しないコマンドを
 *  指すため案内として成立しない (Copilot review 指摘)。win32 側は OS 同梱コマンドのみを使う
 *  (Operating Principle 1 の OS 同梱例外: 所有者 = dir /q、ACL = icacls、奪取 = takeown)。 */
const ownershipHint = (p) =>
  POSIX_PERMS
    ? `所有者と権限を確認してください (ls -la ${p}。sudo で作成した場合は所有者が root になっており chown が必要)。`
    : `所有者と ACL を確認してください (所有者は dir /q "${p}"、ACL は icacls "${p}"。管理者権限で作成した場合は takeown / icacls での付与が必要)。`;

const readKeyFileRaw = () => {
  try {
    return fs.readFileSync(keyFile, "utf8");
  } catch {
    return "";
  }
};

/** 21c/21e preflight の resolveApiKey 内 clean() と同一の整形 — 貼り付け事故を吸収し、
 *  header に載せられない値 (空白・制御文字残り) は null = 未設定扱いにする。 */
const cleanKey = (raw) => {
  const one = (line) => {
    const v = line
      .replace(/^export\s+/, "")
      .replace(/^(?:AYATORI_IMAGE_API_KEY|OPENAI_API_KEY)\s*=\s*/, "")
      .replace(/^(['"])([\s\S]*)\1$/, "$2")
      .trim();
    return v && /^[!-~]+$/.test(v) ? v : null;
  };
  // 候補行を順に試し、最初に鍵として成立した行を採る。先頭行だけで打ち切ると
  // 「AYATORI_IMAGE_API_KEY=」で改行してから鍵を貼った 2 行貼り付けが、前置の剥がしで空になって
  // 未設定扱い (E_NO_API_KEY) になり、docs の「KEY= 前置・追加行は吸収する」という約束に反する。
  // コメント行は元から読み飛ばしていたので、その挙動に他の不成立行も揃えた形。
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const v = one(t);
    if (v) return v;
  }
  return null;
};
const readKeyFile = () => cleanKey(readKeyFileRaw()) ?? "";

/** 21c/21e resolveApiKey と同一の優先順・同一の整形で「いま実効となるソース」を判定する (報告用)。 */
function effectiveSource() {
  const envKey = cleanKey(process.env.AYATORI_IMAGE_API_KEY);
  if (envKey) return { source: "env AYATORI_IMAGE_API_KEY", value: envKey };
  const fileVal = readKeyFile();
  if (fileVal) return { source: `キーファイル ${keyFile}`, value: fileVal };
  const openaiKey = cleanKey(process.env.OPENAI_API_KEY);
  if (openaiKey) return { source: "env OPENAI_API_KEY", value: openaiKey };
  return { source: null, value: null };
}

/** 生値が「そのままでは鍵にならない」ケースの説明 (null = 問題なし)。
 *  空白のみの値も報告対象 — 走査行の shown() は空白のみを「形式不正 (下記警告)」と表示するため、
 *  ここで黙ると行が実在しない警告を指す自己矛盾になる (3者レビュー#6)。完全な空 (未設定) のみ null。 */
function formatIssue(raw, label) {
  const s = String(raw ?? "");
  if (!s) return null;
  if (!s.trim())
    return `${label} が空白のみの値です — 実質未設定として扱われます (E_NO_API_KEY)。削除するか、正しいキーだけを設定してください。`;
  const cleaned = cleanKey(s);
  if (!cleaned)
    return `${label} の中身が鍵として使えません (空白・制御文字の混入 / コメント行のみ 等) — 未設定と同じ扱いになり Step 21c / 21e は E_NO_API_KEY で degrade します。キーだけを 1 行貼り直してください。`;
  if (cleaned !== s.trim())
    return `${label} に余分な装飾があります (引用符 / \`KEY=\` 前置 / 追加行 — 実行時は自動で除去して使いますが、キーだけの 1 行に整えることを推奨します)。`;
  return null;
}

const KEY_VARS = ["AYATORI_IMAGE_API_KEY", "OPENAI_API_KEY"];

/** shell rc / 設定ファイルに **代入** されているキー変数名を返す (コメント行除く素朴 grep)。
 *  2 変数を区別するのは、汎用 OPENAI_API_KEY は他ツール用に置かれている可能性があり、
 *  「~/.zshrc から削除を推奨」を無差別に出すと無関係な鍵を消させてしまうため (レビュー M4)。
 *  代入行 (`X=` / JSON の `"X":`) のみを見るので `unset X` や単なる言及は設置と数えない。
 *  `AYATORI_IMAGE_API_KEY_FILE=` も (名前の直後が `=` でないため) 誤 hit しない。 */
// scan の返り値契約 (keyVarsAssignedIn / keyVarsInSettings 共通): 配列 = 走査できた (空 = 記載なし)、
// null = ファイルは実在するのに走査できない (JSON 破損 / 権限で読めない)。null を [] に潰すと
// 「明文キーが実在するのに『記載なし』と断言する」偽陰性になる — 診断ツールが一番やってはいけない
// 嘘なので、判定不能は判定不能として報告する (3者レビュー#4)。ENOENT (未存在) だけは真に「記載なし」。
function keyVarsAssignedIn(p) {
  let text;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch (e) {
    return e?.code === "ENOENT" ? [] : null;
  }
  const lines = text.split("\n").filter((l) => !/^\s*#/.test(l) && !/^\s*\/\//.test(l));
  return KEY_VARS.filter((name) =>
    lines.some((l) => new RegExp(`(^|[^A-Z_])${name}\\s*(=|"\\s*:|'\\s*:)`).test(l))
  );
}

/** settings 系 JSON の env ブロックに置かれているキー変数名を返す (返り値契約は上記コメント)。 */
function keyVarsInSettings(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    return e?.code === "ENOENT" ? [] : null;
  }
  try {
    const env = JSON.parse(text)?.env ?? {};
    return KEY_VARS.filter((name) => Boolean(env[name]));
  } catch {
    return null; // 実在するのに JSON として読めない (JSONC コメント / 末尾カンマ / 手編集破損)
  }
}

function ensureKeyFile() {
  // mkdirSync({recursive}) は「今回実際に dir を作った」場合にのみ path を返す — これを権限矯正の
  // 因果条件にする。旧実装 (レビュー L5) は $HOME と filesystem root だけを枚挙排除していたが、
  // knob 経由で任意の既存共有 dir を指すと同型の巻き込み (755 → 700 で他ユーザーから不可視) が
  // 再発する (3者レビュー#7)。矯正してよいのは「自分が作った dir」と、規約上 AYATORI 専用と
  // 決まっている既定 dir (~/.ayatori — 過去の実行や手作業で緩んでいても直してよい) のみ。
  const created = fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  const canonicalDir = path.join(os.homedir(), ".ayatori");
  if (POSIX_PERMS && (created || keyDir === canonicalDir) && modeOf(keyDir) !== 0o700) fs.chmodSync(keyDir, 0o700);
  // flag "wx" = 既存なら EEXIST で失敗し、決して truncate しない。existsSync → write の 2 手だと
  // check と act の間に (別プロセス / 開いたエディタの保存が) 書いたキーを空に潰す TOCTOU 窓が
  // ある (3者レビュー#8)。既存ファイルは内容に一切触らない、が本 function の不変条件。
  try {
    fs.writeFileSync(keyFile, "", { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (e?.code !== "EEXIST") throw e;
  }
  if (POSIX_PERMS && modeOf(keyFile) !== 0o600) fs.chmodSync(keyFile, 0o600);
}

/** OS 同梱コマンドでファイルを開く。失敗してもエラーにしない (パス提示に degrade)。 */
function openInEditor(p) {
  // macOS は `open -t` (既定のテキストエディタで開く) を使う — キーファイルは拡張子が無く
  // UTI が public.data になるため、`open` 単体はハンドラ未登録の環境で失敗しうる。
  const cmd =
    process.platform === "darwin"
      ? ["open", ["-t", p]]
      : process.platform === "win32"
        ? ["cmd.exe", ["/c", "start", "", p]]
        : ["xdg-open", [p]];
  // 旧実装は detached spawn + try/catch だったが、spawn の ENOENT は非同期 error イベントで
  // 来るため catch されず、opener 不在でも常に true = 「開きました」と嘘をついていた
  // (レビュー L1)。spawnSync で status を確認する — いずれの opener も要求を GUI 層へ渡して
  // 即座に返るので待ちは発生しない (DISPLAY 無しの xdg-open 等で戻らない場合は timeout で degrade)。
  try {
    const res = spawnSync(cmd[0], cmd[1], { stdio: "ignore", timeout: 10_000 });
    return res.status === 0;
  } catch {
    return false;
  }
}

function runInit({ noOpen }) {
  // ensureKeyFile の失敗 (sudo 作成で所有者が root になったファイルへの chmod EPERM / sandbox が
  // $HOME への mkdir を拒否する EACCES / win32 の ACL 拒否・読み取り専用属性 等) を裸の
  // stack trace で落とさない — --doctor は同じ
  // 状態に「読めません — 所有者と権限を確認」の分岐を持つのに、--init だけ案内ゼロで崩壊すると
  // 最初に詰まった新規メンバーほど行き先を失う (3者レビュー後の残課題#1)。
  try {
    ensureKeyFile();
  } catch (e) {
    console.error(`キーファイルを準備できません: ${keyFile} (${e?.code ?? "EUNKNOWN"})`);
    console.error(`  ${ownershipHint(keyDir)}`);
    console.error("  詳細診断: node scripts/setup-image-key.mjs --doctor");
    process.exit(1);
  }
  const existing = readKeyFile();
  console.log(`キーファイル: ${keyFile} (${POSIX_PERMS ? "権限 600 = 本人のみ読み書き可" : "権限は NTFS ACL 側で管理 — 本人のみアクセス可か確認してください (--doctor が icacls で粗検査します)"})`);
  if (existing) {
    console.log(`既にキーが設定されています: ${mask(existing)}`);
    console.log("差し替える場合はファイルの中身を新しいキーで置き換えてください (保存後すぐ反映・再起動不要)。");
  } else {
    console.log("");
    console.log("次の手順でキーを設定してください:");
    console.log("  1. チーム共有サービスアカウント ayatori-openai のキーを取得する");
    console.log("     (取得先はチーム内で共有 — 不明な場合はチームのチャンネルで確認。docs/setup.md 参照)");
    console.log("  2. 上記ファイルにキーだけを 1 行貼り付けて保存する (引用符・改行・KEY= などは不要)");
    console.log("  3. そのまま Step 21c / 21e を再実行する — Claude Code / VSCode の再起動は不要");
  }
  // env が効いている状態でファイルに貼っても、優先順①の env が勝って新キーは遮蔽される。
  // 「設定したのに古いキーで 401」は本 ticket と同型の混乱なので、--doctor を待たず init で出す
  // (レビュー M1)。file > OPENAI_API_KEY なので遮蔽するのは AYATORI_IMAGE_API_KEY だけ。
  const shadow = cleanKey(process.env.AYATORI_IMAGE_API_KEY);
  if (shadow) {
    console.log("");
    console.log(`⚠ env AYATORI_IMAGE_API_KEY が設定されています (${mask(shadow)}) — 優先順①の env が勝つため、`);
    console.log("  このファイルに貼ったキーは有効になりません (ローテーションしても古いキーで 401 になる)。");
    console.log("  env 側の設置場所 (~/.zshrc / ~/.claude/settings.json / .claude/settings.local.json 等) を");
    console.log("  掃除してキーファイル 1 箇所に集約してください — 走査は --doctor で行えます。");
    console.log("  settings.json 系から消す場合は Claude Code を終了してから編集してください");
    console.log("  (実行中は permission entry の記録のたびに記憶内容で書き戻され、session 中の削除は復活します)。");
  }
  const opened = noOpen ? false : openInEditor(keyFile);
  console.log(
    opened
      ? "エディタでファイルを開きました (開かない場合は上記パスを手動で開いてください)。"
      : `上記パスのファイルをエディタで開いて編集してください。`
  );
  console.log("設定状況の確認: node scripts/setup-image-key.mjs --doctor");
}

/** ファイル系の設置場所の走査表 — scan は「代入されているキー変数名の配列」を返す。
 *  ホーム側 Claude Code 設定 (~/.claude/settings.json) と bash 系 rc も含める: これらは
 *  「env が効いているのに、その env がどこから来たのか答えられない」穴になっていた
 *  (POCTEAMA-408 の ticket 自身が ~/.claude/settings.json を第一提案として挙げており、
 *  docs も禁止対象ではないと明記しているため、診断が見落としてはならない — レビュー M3)。 */
function filePlaces() {
  const home = os.homedir();
  const rc = (name, note) => ({ label: `~/${name}`, file: path.join(home, name), scan: keyVarsAssignedIn, note });
  return [
    // claudeManaged: 実行中の Claude Code が permission entry を記録するたびに、記憶している内容で
    // このファイルを丸ごと書き戻す — session 中に消した env は次の書き戻しで復活するため、掃除には
    // 「Claude Code を終了してから編集」という前提が付く。それを案内文に載せるための印。
    { label: "~/.claude/settings.json (Claude Code user 設定)", file: path.join(home, ".claude", "settings.json"), scan: keyVarsInSettings, claudeManaged: true, note: "全 session / 全案件に env として注入される — Claude Code が派生する全プロセスへ渡るので露出面が広い" },
    { label: "~/.claude/settings.local.json (Claude Code user 設定)", file: path.join(home, ".claude", "settings.local.json"), scan: keyVarsInSettings, claudeManaged: true, note: "同上 (ローカル上書き)" },
    // repo 管理下の settings.json は全設置場所で最も危険 (commit されて全員の clone と git 履歴に
    // 載る — README / docs が禁止する場所そのもの) だが、env としては本当に注入されるため
    // 「機能してしまい誰も気付かない」。診断が見落とすと由来候補が空になり、最悪の設置場所だけ
    // 案内が出ない (3者レビュー#2)。critical: 検出時は移行推奨ではなく即削除 + ローテーションを出す。
    { label: ".claude/settings.json (この repo — ⚠ commit される)", file: path.join(repoRoot, ".claude", "settings.json"), scan: keyVarsInSettings, claudeManaged: true, note: "repo 管理下 — 全員の clone と git 履歴に載る", critical: true },
    { label: ".claude/settings.local.json (この repo)", file: path.join(repoRoot, ".claude", "settings.local.json"), scan: keyVarsInSettings, claudeManaged: true, note: "案件ローカル — 再クローンで消える" },
    rc(".zshrc", "対話 shell のみが読む — 非対話 shell (Claude Code の Bash tool) からは見えない"),
    rc(".zshenv", "zsh が常に読む — 子プロセスへの露出面が最も広い"),
    rc(".zprofile", "ログイン shell のみが読む — 非対話 shell からは見えない"),
    rc(".bash_profile", "bash ログイン shell のみが読む"),
    rc(".bashrc", "bash 対話 shell のみが読む"),
    rc(".profile", "sh / ログイン shell が読む"),
  ];
}

function runDoctor() {
  const eff = effectiveSource();
  const fileVal = readKeyFile();
  const fileMode = modeOf(keyFile);
  // 「読めない (EACCES 等)」を「中身が空」と区別する — sudo 作成で所有者が root になったファイルを
  // 「空」と報告すると、ユーザーは中身を何度貼り直しても直らない迷路に入る (3者レビュー#5)。
  // ENOENT は「未作成」行が担うので null 扱い。
  const keyFileReadError = (() => {
    try {
      fs.readFileSync(keyFile);
      return null;
    } catch (e) {
      return e?.code === "ENOENT" ? null : (e?.code ?? "EUNKNOWN");
    }
  })();
  const places = filePlaces().map((p) => ({ ...p, vars: p.scan(p.file) })); // vars: 配列 or null (走査不能)
  const hasAyatoriVar = (p) => (p.vars ?? []).includes("AYATORI_IMAGE_API_KEY");
  // AYATORI 専用鍵が明文で置かれている file place の集合 — 「由来候補」の表示・掃除の推奨・集約警告の
  // 計数の 3 つを、この 1 つの集合から導く。同じ述語を箇所ごとに別々に filter していた頃は、表示側が
  // 「この env は ~/.zshrc 由来」と説明しているのに計数側は env を独立した設置場所として数える、という
  // 自己矛盾が同一画面内で起きていた (PR #202 実機検証レビュー指摘)。集合を 1 つに束ねて構造的に防ぐ。
  const ayatoriFilePlaces = places.filter(hasAyatoriVar);

  console.log("── グラフィック生成 API キー診断 (POCTEAMA-408) ──");
  // env は実行プロセスごとに異なる — 本 ticket の原障害 (VSCode が起動時 env を固定) では、
  // 新しいターミナルで doctor を走らせると固定された env が見えず「問題なし」と出て、故障現場
  // (VSCode 内の session) と正反対の結論になる (3者レビュー#12)。診断の有効範囲を毎回明示する。
  console.log("※ 診断対象はこのプロセスの env — VSCode 内の Claude Code session を診断する場合は、必ずその session 内で実行すること (別の新しいターミナルでは固定された env は見えない)。");
  // repoRoot は AYATORI_REPO_ROOT (fixture 用 knob) で差し替わるが、こちらは兄弟 knob の
  // AYATORI_IMAGE_API_KEY_FILE (上記 — 単独残留を警告して無視する) と違って gate されていない。
  // shell に残留していると「.claude/settings.json (この repo)」の走査先が別ツリーへ向き、commit 済み
  // キー = critical: true という最悪の設置場所に対して「記載なし」と断言する偽陰性になる。gate せず
  // **どこを見たかを必ず書く** 方を選ぶ (knob を潰すとテストが自分の fixture を指せなくなる)。
  console.log(
    `※ 「この repo」として走査する root: ${repoRoot}${
      process.env.AYATORI_REPO_ROOT ? " (env AYATORI_REPO_ROOT による差し替え — テスト用 knob が残っていないか確認してください)" : ""
    }`
  );
  console.log(
    eff.source
      ? `実効ソース: ${eff.source} — ${mask(eff.value)}`
      : "実効ソース: なし — このままでは Step 21c / 21e が E_NO_API_KEY で degrade します"
  );
  console.log("(優先順: ① env AYATORI_IMAGE_API_KEY → ② キーファイル → ③ env OPENAI_API_KEY)");
  console.log("");
  console.log("設置場所の走査:");
  const row = (hit, label, note) => console.log(`  [${hit ? "x" : " "}] ${label}${note ? ` — ${note}` : ""}`);
  // 表示は整形後の値で mask する (生値をそのまま出すと改行混入で表示が崩れる) —
  // 整形しても鍵にならない値は「形式不正」と明示し、下の警告で直し方を出す
  const shown = (raw) => (cleanKey(raw) ? mask(cleanKey(raw)) : "形式不正 (下記警告)");
  // env が効いているとき「その env はどこから来たのか」を答えられるようにする (レビュー M3)
  const origins = ayatoriFilePlaces.map((p) => p.label);
  const originNote = origins.length
    ? ` / 由来候補: ${origins.join(", ")}`
    : " / 由来は走査対象外 (VSCode 起動時に固定された env / 手動 export 等)";
  row(Boolean(process.env.AYATORI_IMAGE_API_KEY), "env AYATORI_IMAGE_API_KEY", process.env.AYATORI_IMAGE_API_KEY ? `${shown(process.env.AYATORI_IMAGE_API_KEY)}${originNote}` : "未設定");
  row(Boolean(fileVal), `キーファイル ${keyFile}`, fileVal ? `${mask(fileVal)}${POSIX_PERMS ? ` / mode ${fileMode?.toString(8) ?? "?"}` : " / 権限は ACL 側"}` : keyFileReadError ? `読めません (${keyFileReadError} — 下記警告)` : !fs.existsSync(keyFile) ? "未作成" : readKeyFileRaw().trim() ? "形式不正 (下記警告)" : "ファイルはあるが中身が空");
  row(Boolean(process.env.OPENAI_API_KEY), "env OPENAI_API_KEY", process.env.OPENAI_API_KEY ? shown(process.env.OPENAI_API_KEY) : "未設定");
  for (const p of places) {
    if (p.vars === null) {
      row(true, p.label, "走査不能 (JSON として読めない / 読取権限なし) — キー変数の有無を手動確認してください");
      continue;
    }
    row(p.vars.length > 0, p.label, p.vars.length > 0 ? `${p.vars.join(" / ")} の代入あり (${p.note})` : "記載なし");
  }

  const warnings = [];
  // 遮蔽判定は整形後の値どうしで比較する (effectiveSource / --init 側の M1 検査と同じ尺度)。
  // 生値比較だと (a) 引用符つき env と素の file が「同値なのに異なる」と誤報される、
  // (b) 形式不正で実際には効いていない env を「優先される」と事実に反して断言する (3者レビュー#3)。
  // 形式不正な env の報告は下の formatIssue が担う。
  const envEffective = cleanKey(process.env.AYATORI_IMAGE_API_KEY);
  if (envEffective && fileVal && envEffective !== fileVal) {
    warnings.push(
      "env AYATORI_IMAGE_API_KEY とキーファイルの値が異なります — env が優先されるため、ファイル側の新キーは有効になりません。キーのローテーション時は env 側の設置場所 (~/.zshrc / settings.local.json 等) を掃除してキーファイル 1 箇所に集約してください。"
    );
  }
  if (POSIX_PERMS && fileVal && fileMode !== null && fileMode !== 0o600) {
    warnings.push(`キーファイルの権限が ${fileMode.toString(8)} です — chmod 600 ${keyFile} で本人のみに絞ってください。`);
  }
  if (!POSIX_PERMS && fileVal && windowsAclLooksOpen(keyFile)) {
    warnings.push(
      `キーファイルの NTFS ACL に Everyone / Users 系グループへの許可があり、本人以外から読める可能性があります — icacls で本人のみに絞ってください (例: icacls "${keyFile}" /inheritance:r /grant:r "%USERNAME%":F)。`
    );
  }
  if (keyFileReadError) {
    warnings.push(
      `キーファイル ${keyFile} が読めません (${keyFileReadError}) — ${ownershipHint(keyFile)}読めない間は未設定扱いで E_NO_API_KEY になります。`
    );
  }
  // 走査不能なファイルは「記載なし」と区別して警告する — 明文キーが実在するのに診断が
  // 見落とす偽陰性を、少なくとも「ここは自分の目で確認して」に格下げする (3者レビュー#4)
  for (const p of places.filter((x) => x.vars === null)) {
    warnings.push(
      `${p.label} が走査できません (JSON 破損 [JSONC コメント / 末尾カンマは JSON では不正] または読取権限なし) — キー変数が残っていないか手動で確認してください。`
    );
  }
  // 掃除を勧めるのは AYATORI 専用変数の代入だけ — 汎用 OPENAI_API_KEY は他ツール用に置かれて
  // いる可能性があり、無差別に「削除を推奨」すると無関係な鍵を消させてしまう (レビュー M4)。
  // OPENAI_API_KEY のみの記載は走査行に出すだけに留める (掃除対象として数えない)。
  for (const p of ayatoriFilePlaces) {
    // 削除の前提 — 実行中の Claude Code が書き戻すファイルは、session を止めずに消しても復活する。
    // 「消したのにまだ古いキーで 401」は本 ticket と同型の混乱なので、削除を勧める文と同じ行で言う。
    const editHint = p.claudeManaged
      ? " 削除は Claude Code (VSCode 利用時はその window) を終了してから行ってください — 実行中は permission entry の記録のたびに記憶内容で書き戻され、session 中の削除は復活します。"
      : "";
    warnings.push(
      p.critical
        ? `${p.label} に AYATORI_IMAGE_API_KEY の代入があります — 即削除し、キーをローテーションしてください (commit されて全員の clone と git 履歴に載る。docs/setup.md「禁止対象の明確化」参照)。${editHint}`
        : `${p.label} に AYATORI_IMAGE_API_KEY の代入があります (${p.note}) — キーファイルへの移行と当該行の削除を推奨します。${editHint}`
    );
    // ホーム側の設定ファイル / rc は既定 644 になりがちで、同一マシンの他ユーザーから読める。
    // 「設定ファイルなら既定で本人のみ読める」という思い込みを実測で否定する (レビュー M3)
    const m = modeOf(p.file);
    if (POSIX_PERMS && m !== null && (m & 0o077) !== 0) {
      warnings.push(`${p.label} の権限が ${m.toString(8)} です (同一マシンの他ユーザーから読める) — キーを残す場合は chmod 600 ${p.file} を推奨します。`);
    }
    if (!POSIX_PERMS && windowsAclLooksOpen(p.file)) {
      warnings.push(`${p.label} の NTFS ACL に Everyone / Users 系グループへの許可があります (キーが本人以外から読める可能性) — キーを残す場合は icacls で本人のみに絞ってください。`);
    }
  }
  // 形式の検査 — 「貼ったのに未設定扱い」「引用符ごと貼った」を無言で通さない (レビュー M5)。
  // 整形で吸収できるケースも報告する: 次のローテーションで同じ貼り方を繰り返さないため
  for (const issue of [
    formatIssue(readKeyFileRaw(), `キーファイル ${keyFile}`),
    formatIssue(process.env.AYATORI_IMAGE_API_KEY, "env AYATORI_IMAGE_API_KEY"),
    formatIssue(process.env.OPENAI_API_KEY, "env OPENAI_API_KEY"),
  ]) {
    if (issue) warnings.push(issue);
  }
  if (eff.value && !eff.value.startsWith("sk-")) {
    warnings.push("キーが sk- で始まっていません — OpenAI のキー形式か確認してください (カスタム endpoint 利用時はこの警告は無視してよい)。");
  }
  if (!process.env.AYATORI_IMAGE_API_KEY && !fileVal && cleanKey(process.env.OPENAI_API_KEY)) {
    warnings.push(
      "AYATORI 専用鍵が無く、汎用の env OPENAI_API_KEY が使われます — 個人アカウントへの課金になっていないか確認してください (キーファイルを設定すると専用鍵が優先されます)。"
    );
  }
  // 集約対象として数えるのは AYATORI の鍵が **設置** されている場所だけ (OPENAI_API_KEY の記載は除く)。
  // env は掃除すべき設置場所ではなく設置場所の**結果**なので、由来が走査で特定できている限り二重に
  // 数えない。旧実装は env と由来 rc を各 1 と数え、鍵が ~/.zshrc 1 箇所だけの状態 (= 本 ticket の
  // 移行対象がまさにこれ) で「複数の場所に設置されています」と誤警告し、存在しない 2 箇所目を探させて
  // いた — 診断ツールへの信頼を最初の 1 回で失う類の嘘 (PR #202 実機検証レビュー指摘)。
  // 値の一致は判定に使わない: env が古い凍結値で rc 側が新しい値でも、掃除すべきファイルは依然その
  // rc 1 箇所であり設置場所の数は増えない (古い env 自体は session 再起動で消える)。個々の移行推奨は
  // 上の ayatoriFilePlaces ループが場所ごとに出し続けるので、本警告を畳んでも案内は失われない。
  // 走査不能な place (vars === null) は origins に入らないため env が独立 1 箇所として数えられるが、
  // その不確かさは専用の「走査できません」警告が担う (ここで推測して数えない)。
  // 数えるのは整形後に鍵として成立する値だけ — fileVal 側は readKeyFile() で cleanKey 済みなのに
  // env 側が生の truthy だと、空白のみ / 制御文字混入の env (実効ソースにならない値) が 1 箇所として
  // 数えられ、「実質未設定として扱われます」と同じ画面で「複数の場所に設置されています」と言う。
  // 直上の遮蔽判定 (3者レビュー#3) が生値比較をやめたのと同じ理由で、ここも整形後の値で数える。
  const envIsOwnPlace = Boolean(cleanKey(process.env.AYATORI_IMAGE_API_KEY)) && ayatoriFilePlaces.length === 0;
  const ayatoriPlaces = ayatoriFilePlaces.length + (envIsOwnPlace ? 1 : 0) + (fileVal ? 1 : 0);
  if (ayatoriPlaces > 1) {
    warnings.push("AYATORI のキーが複数の場所に設置されています — ローテーション時の更新漏れ (古いキーで 401) を防ぐため、キーファイル 1 箇所への集約を推奨します。");
  }

  console.log("");
  if (warnings.length) {
    console.log("警告:");
    for (const w of warnings) console.log(`  - ${w}`);
  } else {
    console.log(eff.source ? "警告: なし — この設定のまま利用できます。" : "警告: なし (キー未設定) — node scripts/setup-image-key.mjs --init で設定してください。");
  }
}

const args = process.argv.slice(2);
const known = new Set(["--init", "--doctor", "--no-open"]);
const unknown = args.filter((a) => !known.has(a));
const usage = () => console.error("使い方: node scripts/setup-image-key.mjs [--init [--no-open] | --doctor]");
if (unknown.length) {
  console.error(`不明な引数: ${unknown.join(" ")}`);
  usage();
  process.exit(1);
}
// 既知引数どうしの無効な組み合わせも黙って片方を落とさない — 「--init --doctor」を受けて
// doctor だけ走ると、ユーザーが今下した --init の意図が無言で捨てられ「未作成」報告と矛盾する
// (3者レビュー#9)。
if (args.includes("--init") && args.includes("--doctor")) {
  console.error("引数エラー: --init と --doctor は同時指定できません — まず --init で設定し、その後 --doctor で確認してください。");
  usage();
  process.exit(1);
}
if (args.includes("--doctor") && args.includes("--no-open")) {
  console.error("引数エラー: --no-open は --init 専用です (--doctor はエディタを開きません)。");
  usage();
  process.exit(1);
}
if (args.includes("--doctor")) {
  runDoctor();
} else {
  runInit({ noOpen: args.includes("--no-open") });
}
