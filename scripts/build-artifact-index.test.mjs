// scripts/build-artifact-index.test.mjs
//
// scripts/build-artifact-index.mjs の単体テスト。Node 標準の node:test + node:assert のみ。
//   実行: node --test scripts/build-artifact-index.test.mjs
//
// テスト方針:
//   - 本 script は CLI (app ディレクトリを引数に取る) なので tmpdir にツリーを作って子プロセス実行
//     (build-ground-truth-index.test.mjs と同じ流儀)。
//   - 固定するのは「振る舞い詳細 × 画面 並べて表示ビュー」の入力契約: 操作イベント表 (7 列) の
//     パース境界と、md 相対リンクの app ルート付け替え。これらは skills/17-screen-gen の
//     テンプレートと暗黙の文字列契約で結ばれており、どちらかが変わると視覚ビューが無音で消える。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "build-artifact-index.mjs");

// 17 テンプレート準拠の操作イベント表ヘッダ (7 列)
const EV_HEADER = [
  "| # | トリガー (要素・操作) | 配置 (画面内の位置) | 事前条件・分岐 | 反応 (画面内変化 / 遷移) | 異常・境界時 | 根拠 |",
  "|---|---|---|---|---|---|---|",
].join("\n");

// 17 テンプレート準拠の データ項目 表 (7 列)
const DT_TABLE = [
  "## データ項目",
  "",
  "| # | 項目 | 表示・更新 | ソース | 共有 | 整形・計算 | 根拠 |",
  "|---|---|---|---|---|---|---|",
  "| DT-01 | 名前 | 表示 (画面表示時) | DB (user.name) | 画面固有 | — | [データエンティティ user](../requirements/07-data-definition.md) |",
].join("\n");

const specMd = (rows, { title = "ホーム 画面仕様", dataItems = true } = {}) => [
  `# ${title}`,
  "",
  "## 状態パターン (仕様書に記述する — HTML 生成は Step 25b)",
  "- default — 通常表示",
  "",
  "## 振る舞い詳細",
  "",
  "### 操作イベント",
  EV_HEADER,
  ...rows,
  "",
  "### 入力チェック (フォーム要素がある画面のみ)",
  "| 対象 | ルール | タイミング | エラー表示 | 根拠 |",
  "|---|---|---|---|---|",
  "",
  ...(dataItems ? [DT_TABLE, ""] : []),
  "## 画面遷移",
  "- 送信 → 02-done",
  "",
].join("\n");

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "ayatori-artifact-index-"));
  const app = join(root, "artifacts", "app");
  const write = (rel, body) => {
    const p = join(app, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body, "utf8");
  };
  // 並べて表示ビューの前提: 画面一覧 + default HTML 1 platform
  write("screens/00-screen-list.md", "# 画面一覧\n");
  write("screens/mobile/01-home.html", "<!DOCTYPE html><html><body>home</body></html>\n");
  const run = (extra = []) => spawnSync(process.execPath, [SCRIPT, app, ...extra], { encoding: "utf8" });
  const html = () => readFileSync(join(app, "index.html"), "utf8");
  return { root, app, write, run, html, cleanup: () => rmSync(root, { recursive: true, force: true }) };
};

test("操作イベント表 (17 テンプレート 7 列) をカード化し、根拠リンクを app ルート基準へ付け替える", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | 送信ボタンをタップ | CTA | 入力欄が空でない | 完了画面へ遷移 | 空なら disabled 維持 | [UC-01 基本2](../requirements/04-use-cases.md) |",
    ]));
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const html = t.html();
    assert.match(html, /画面と並べて表示/); // split ボタンが付与される
    assert.match(html, /EV-01/);
    assert.match(html, /送信ボタンをタップ/);
    // ../requirements/... が screens/ 基準 → app ルート基準へ 1 階層繰り上がる
    assert.match(html, /href="requirements\/04-use-cases\.md"/);
    assert.doesNotMatch(html, /href="\.\.\/requirements\/04-use-cases\.md"/);
  } finally { t.cleanup(); }
});

test("旧フォーマット (両セクションなし) は不足セクション名を並記 + split ビューなし (fail-soft)", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", "# ホーム 画面仕様\n\n## 画面遷移\n- なし\n");
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const html = t.html();
    assert.match(html, /振る舞い詳細 \/ データ項目 未記載/);
    assert.doesNotMatch(html, /画面と並べて表示/);
  } finally { t.cleanup(); }
});

test("データ項目 だけ欠ける仕様書は そのセクション名のみ未記載 + split ビューは残る", () => {
  const t = setup();
  try {
    // 振る舞い詳細 はあるので操作イベントの並べて表示ビューは成立する
    t.write("screens/01-home.md", specMd([
      "| EV-01 | 送信ボタンをタップ | CTA | — | 02-done へ遷移 | — | 本書「画面遷移」 |",
    ], { dataItems: false }));
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const html = t.html();
    assert.match(html, /データ項目 未記載/);
    assert.doesNotMatch(html, /振る舞い詳細 \/ データ項目 未記載/);
    assert.doesNotMatch(html, /振る舞い詳細 未記載/);
    assert.match(html, /画面と並べて表示/); // 欠けているセクションに依存しない判定
  } finally { t.cleanup(); }
});

test("振る舞い詳細 だけ欠ける仕様書は そのセクション名のみ未記載 + split ビューなし", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", ["# ホーム 画面仕様", "", DT_TABLE, "", "## 画面遷移", "- なし", ""].join("\n"));
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const html = t.html();
    assert.match(html, /振る舞い詳細 未記載/);
    assert.doesNotMatch(html, /データ項目 未記載/);
    assert.doesNotMatch(html, /画面と並べて表示/);
  } finally { t.cleanup(); }
});

test("両セクションが揃った仕様書には未記載マークが付かない", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | 送信ボタンをタップ | CTA | — | 02-done へ遷移 | — | 本書「画面遷移」 |",
    ]));
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(t.html(), /未記載/);
  } finally { t.cleanup(); }
});

test("目次リンクの data-hash は rel パス基準の安定キー (item-N を漏らさない)", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | 送信ボタンをタップ | CTA | — | 02-done へ遷移 | — | 本書「画面遷移」 |",
    ]));
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const html = t.html();
    // rel 基準: 仕様書 md と画面 HTML がそれぞれ自分のパスをキーに持つ
    assert.match(html, /data-hash="screens\/01-home\.md"/);
    assert.match(html, /data-hash="screens\/mobile\/01-home\.html"/);
    // 位置連番 (item-N) をキーにしてはいけない — 成果物が増えると同じ URL が別文書を指す
    assert.doesNotMatch(html, /data-hash="item-/);
    // 全 nav-link が data-hash を持つ (欠けると その項目だけ戻る/進むが効かない)
    const links = (html.match(/class="nav-link"/g) || []).length;
    const hashes = (html.match(/data-hash="/g) || []).length;
    assert.equal(hashes, links);
  } finally { t.cleanup(); }
});

test("表示状態は location.hash で持つ (file:// のため pushState を使わない)", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | 送信ボタンをタップ | CTA | — | 02-done へ遷移 | — | 本書「画面遷移」 |",
    ]));
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const html = t.html();
    // 「使わないもの」だけをソースで固定する — file:// オリジンでは pushState / replaceState が
    // SecurityError になる環境がある。動作 (hash の読み書き) は下の DOM スタブ実行テストで見る。
    assert.doesNotMatch(html, /history\.(push|replace)State\s*\(/);
    // 位置はセッション内メモリのみ — 再読み込みで途中から始まらないよう永続化しない
    assert.doesNotMatch(html, /(local|session)Storage\.setItem\('ayatori-index-scroll/);
  } finally { t.cleanup(); }
});

test("Back to top ボタン: 生成物の構造契約 (テキスト併記・44px・可視フォーカス・scrim より下)", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | 送信ボタンをタップ | CTA | — | 02-done へ遷移 | — | 本書「画面遷移」 |",
    ]));
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const html = t.html();
    // 意味が伝わるよう矢印だけにせずテキストも出す + 生の button 要素。ラベルは chrome 文言なので
    // 他の chrome と同じ言語スイッチ (J) を通る — ja 出力に英語ラベルを残さない
    assert.match(html, /<button type="button" id="totop" class="totop">/);
    assert.match(html, /<span>先頭へ戻る<\/span>/);
    assert.doesNotMatch(html, /<span>Back to top<\/span>/);
    assert.equal(t.run(["--lang", "en"]).status, 0);
    assert.match(t.html(), /<span>Back to top<\/span>/);
    // 可視テキストがアクセシブル名になるので aria-label は付けない (二重定義を避ける)
    assert.doesNotMatch(html, /id="totop"[^>]*aria-label/);
    assert.match(html, /\.totop\{[^}]*min-height:44px/);      // WCAG 2.5.8 のタップ領域
    assert.match(html, /\.totop:focus-visible\{outline:2px/);  // キーボード可視フォーカス
    // scrim (z-index:30) より下 — モバイルでサイドバーを開いたら覆われる
    assert.match(html, /\.totop\{[^}]*z-index:20/);
    // 出現条件・フォーカス移動・スクロール復元の **動作** は下の DOM スタブ実行テストで検証する
    // (ソース文字列の grep は実装を凍結するだけで、動かない機能を green にしてしまう)
  } finally { t.cleanup(); }
});

// ── 生成された <script> を実行して動作を検証するための最小 DOM スタブ ──────────
// 依存ゼロ (jsdom を入れない — Operating Principle 1)。SCRIPT が使う範囲の DOM だけを持つ:
// 属性 / classList / hidden / 子孫探索 (タグ・#id・.class・[attr]・[attr="v"]・:not()・
// 子孫結合子・カンマ) / イベント / focus / scrollTo。
const parseCompound = (s) => {
  const parts = { tag: null, ids: [], classes: [], attrs: [], nots: [] };
  let rest = s.trim();
  rest = rest.replace(/:not\(([^)]*)\)/g, (_, inner) => { parts.nots.push(parseCompound(inner)); return ""; });
  rest = rest.replace(/\[([\w-]+)(?:="([^"]*)")?\]/g, (_, n, v) => { parts.attrs.push([n, v ?? null]); return ""; });
  rest = rest.replace(/#([\w-]+)/g, (_, id) => { parts.ids.push(id); return ""; });
  rest = rest.replace(/\.([\w-]+)/g, (_, c) => { parts.classes.push(c); return ""; });
  if (rest) parts.tag = rest;
  return parts;
};
const matchesCompound = (e, parsed) => {
  if (typeof parsed === "string") parsed = parseCompound(parsed);
  if (parsed.tag && e.tag !== parsed.tag) return false;
  for (const id of parsed.ids) if (e.getAttribute("id") !== id) return false;
  for (const c of parsed.classes) if (!e.classList.contains(c)) return false;
  for (const [n, v] of parsed.attrs) {
    const av = e.getAttribute(n);
    if (av == null) return false;
    if (v != null && av !== v) return false;
  }
  for (const n of parsed.nots) if (matchesCompound(e, n)) return false;
  return true;
};
const matchesSelector = (e, selector) => selector.split(",").some((one) => {
  const compounds = one.trim().split(/\s+/);
  if (!matchesCompound(e, compounds[compounds.length - 1])) return false;
  let idx = compounds.length - 2, anc = e.parent;
  while (idx >= 0) {
    while (anc && !matchesCompound(anc, compounds[idx])) anc = anc.parent;
    if (!anc) return false;
    anc = anc.parent; idx -= 1;
  }
  return true;
});
const makeDom = () => {
  const doc = { activeElement: null };
  class El {
    constructor(tag, attrs = {}) {
      this.tag = tag; this.attrs = new Map(Object.entries(attrs)); this.children = []; this.parent = null;
      this.listeners = {}; this._hidden = false; this.textContent = ""; this.style = { setProperty() {} };
      this.scrollTop = 0; this.clientHeight = 0; this.scrollHeight = 0; this.scrollToCalls = [];
      const cls = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
      this.classList = {
        add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
        toggle: (c, force) => { if (force === undefined) force = !cls.has(c); force ? cls.add(c) : cls.delete(c); return force; },
      };
    }
    get hidden() { return this._hidden; }
    set hidden(v) { this._hidden = !!v; }
    getAttribute(n) { if (n === "hidden") return this._hidden ? "" : null; return this.attrs.has(n) ? this.attrs.get(n) : null; }
    setAttribute(n, v) { if (n === "hidden") { this._hidden = true; return; } this.attrs.set(n, String(v)); }
    removeAttribute(n) { if (n === "hidden") { this._hidden = false; return; } this.attrs.delete(n); }
    append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } return this; }
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
    dispatch(t, ev = {}) { ev.type = t; ev.preventDefault ||= () => {}; for (const fn of [...(this.listeners[t] || [])]) fn(ev); }
    click() { this.dispatch("click"); }
    focus() { doc.activeElement = this; }
    scrollTo(o) { this.scrollToCalls.push(o); }   // smooth スクロールの途中状態をテストが自分で刻めるよう scrollTop は動かさない
    getBoundingClientRect() { return { left: 0, right: 0, width: 0, height: 0 }; }
    closest(sel) { let e = this; while (e) { if (matchesCompound(e, sel)) return e; e = e.parent; } return null; }
    all() { const out = []; const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } }; walk(this); return out; }
    querySelectorAll(sel) { return this.all().filter((e) => matchesSelector(e, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  return { El, doc };
};

// 生成物と同じ骨格を最小構成で組む: 目次 3 件 (md 2 + html 1) / md-body 2 (両方 hidden) / totop。
// item-0 (非表示のまま残る文書) の中に a[href] を置くのがポイント — 「先頭へ戻る」のフォーカスが
// 表示中の item-1 の button ではなく、document 順で先にある非表示リンクへ吸われないかを見る。
const buildIndexDom = () => {
  const { El, doc } = makeDom();
  const html = new El("html");
  const body = new El("body", { "data-sidebar": "open" });
  const burger = new El("button", { id: "burger", class: "burger" });
  const curTitle = new El("h1", { id: "cur-title", class: "cur-title" });
  const curExt = new El("a", { id: "cur-ext", class: "cur-ext", href: "#" });
  const header = new El("header", { class: "topbar" }).append(burger, curTitle, curExt);
  const link0 = new El("a", { class: "nav-link", href: "#", "data-kind": "md", "data-ref": "item-0", "data-label": "A 画面仕様", "data-hash": "screens/01-a.md" });
  const link1 = new El("a", { class: "nav-link", href: "#", "data-kind": "md", "data-ref": "item-1", "data-label": "B 画面仕様", "data-hash": "screens/02-b.md" });
  const linkH = new El("a", { class: "nav-link", href: "#", "data-kind": "html", "data-ref": "screens/mobile/01-a.html", "data-label": "A (mobile)", "data-hash": "screens/mobile/01-a.html" });
  const nav = new El("nav", { class: "toc" }).append(link0, link1, linkH);
  const sidebar = new El("aside", { id: "sidebar", class: "sidebar" }).append(nav);
  const scrim = new El("div", { id: "scrim", class: "scrim" });
  const welcome = new El("div", { id: "welcome", class: "welcome" });
  const frame = new El("iframe", { id: "frame" }); frame.hidden = true;
  const anchorInHidden = new El("a", { href: "requirements/00-raw-input.md" });
  const item0 = new El("div", { id: "item-0", class: "md-body" }).append(anchorInHidden); item0.hidden = true;
  const buttonInVisible = new El("button", { class: "split-btn", "data-split": "none" });
  const item1 = new El("div", { id: "item-1", class: "md-body" }).append(buttonInVisible); item1.hidden = true;
  const pane = new El("main", { class: "pane" }).append(welcome, frame, item0, item1);
  const totop = new El("button", { id: "totop", class: "totop", type: "button" });
  const shell = new El("div", { class: "shell" }).append(sidebar, scrim, pane, totop);
  body.append(header, shell); html.append(body);
  Object.assign(doc, {
    body,
    getElementById: (id) => html.all().find((e) => e.getAttribute("id") === id) || null,
    querySelector: (sel) => html.querySelector(sel),
    querySelectorAll: (sel) => html.querySelectorAll(sel),
    addEventListener() {},
    createElement: (tag) => new El(tag),
  });
  const winListeners = {};
  const win = {
    __RELMAP__: {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    addEventListener: (t, fn) => { (winListeners[t] ||= []).push(fn); },
    dispatch: (t) => { for (const fn of winListeners[t] || []) fn({ type: t }); },
  };
  const location = { hash: "" };
  const rafQueue = [];
  const raf = (fn) => { rafQueue.push(fn); return rafQueue.length; };
  const flushRaf = () => { while (rafQueue.length) rafQueue.shift()(); };
  const localStorage = { getItem: () => null, setItem() {} };
  return { doc, win, location, raf, flushRaf, localStorage, els: { link0, link1, linkH, item0, item1, pane, totop, welcome, frame, anchorInHidden, buttonInVisible, curTitle } };
};

// 生成物から SCRIPT (2 つ目の <script>) を取り出し、スタブに対して実行する
const runIndexScript = (html) => {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const src = blocks[1];
  assert.ok(src && /hashchange/.test(src), "SCRIPT ブロックが見つからない");
  const env = buildIndexDom();
  new Function("document", "window", "location", "localStorage", "requestAnimationFrame", src)(
    env.doc, env.win, env.location, env.localStorage, env.raf,
  );
  return env;
};

test("[動作] 目次クリック: 該当文書だけ表示・先頭表示・location.hash に #v= キーを書く", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | 送信ボタンをタップ | CTA | — | 02-done へ遷移 | — | 本書「画面遷移」 |",
    ]));
    assert.equal(t.run().status, 0);
    const env = runIndexScript(t.html());
    const { link1, item0, item1, pane, welcome, curTitle } = env.els;
    pane.scrollTop = 120;   // welcome を途中まで読んでいた状態
    link1.click();
    assert.equal(item1.hidden, false);
    assert.equal(item0.hidden, true);
    assert.equal(welcome.hidden, true);
    assert.equal(pane.scrollTop, 0, "目次の直接クリックは先頭表示");
    assert.equal(env.location.hash, "#v=screens/02-b.md");
    assert.ok(link1.classList.contains("active"));
    assert.equal(curTitle.textContent, "B 画面仕様");
  } finally { t.cleanup(); }
});

test("[動作] 戻る/進む (hashchange) は離れる前のスクロール位置へ復元し、hash 無しは welcome へ戻る", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | 送信ボタンをタップ | CTA | — | 02-done へ遷移 | — | 本書「画面遷移」 |",
    ]));
    assert.equal(t.run().status, 0);
    const env = runIndexScript(t.html());
    const { link0, link1, item0, item1, pane, welcome } = env.els;
    link1.click();
    pane.scrollTop = 480;                 // B を途中まで読む
    link0.click();                        // A へ (離れる側 B の位置 480 を記憶)
    assert.equal(pane.scrollTop, 0);
    // ブラウザの「戻る」: hash が B に変わり hashchange が飛ぶ
    env.location.hash = "#v=screens/02-b.md";
    env.win.dispatch("hashchange");
    assert.equal(item1.hidden, false);
    assert.equal(item0.hidden, true);
    assert.equal(pane.scrollTop, 480, "履歴移動は読んでいた位置へ復元する");
    // さらに「戻る」で hash 無し = welcome
    env.location.hash = "";
    env.win.dispatch("hashchange");
    assert.equal(welcome.hidden, false);
    assert.equal(item1.hidden, true);
    // 未知のキー (削除された成果物の古いリンク) は表示を壊さない
    env.location.hash = "#v=screens/99-gone.md";
    env.win.dispatch("hashchange");
    assert.equal(welcome.hidden, false);
  } finally { t.cleanup(); }
});

test("[動作] 先頭へ戻る: 出現 2 段条件・表示中文書内へのフォーカス移動・押下後の再点灯抑制", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | 送信ボタンをタップ | CTA | — | 02-done へ遷移 | — | 本書「画面遷移」 |",
    ]));
    assert.equal(t.run().status, 0);
    const env = runIndexScript(t.html());
    const { link1, pane, totop, anchorInHidden, buttonInVisible } = env.els;
    link1.click();                        // B (item-1) を表示。item-0 は hidden のまま DOM に残る
    pane.clientHeight = 300; pane.scrollHeight = 2000;
    // 2 画面分未満のスクロールでは出ない
    pane.scrollTop = 500; pane.dispatch("scroll"); env.flushRaf();
    assert.equal(totop.classList.contains("on"), false);
    // 4 画面分超の内容 × 2 画面分超のスクロールで出る
    pane.scrollTop = 1000; pane.dispatch("scroll"); env.flushRaf();
    assert.equal(totop.classList.contains("on"), true);
    // 短い成果物では深くスクロールしても出ない
    pane.scrollHeight = 1000; pane.dispatch("scroll"); env.flushRaf();
    assert.equal(totop.classList.contains("on"), false);
    pane.scrollHeight = 2000; pane.dispatch("scroll"); env.flushRaf();
    assert.equal(totop.classList.contains("on"), true);
    // 押下: 先頭へスクロール + フォーカスは **表示中の** 文書の先頭操作要素へ
    totop.click();
    assert.equal(pane.scrollToCalls.length, 1);
    assert.equal(pane.scrollToCalls[0].top, 0);
    assert.equal(env.doc.activeElement, buttonInVisible, "フォーカスは表示中 item-1 の要素へ");
    assert.notEqual(env.doc.activeElement, anchorInHidden, "非表示 item-0 のリンクに吸われない");
    assert.equal(totop.classList.contains("on"), false);
    // smooth スクロールの途中 (まだ深い) に scroll が走っても再点灯しない
    pane.scrollTop = 900; pane.dispatch("scroll"); env.flushRaf();
    assert.equal(totop.classList.contains("on"), false, "押下直後の点滅を抑える");
    // 先頭に着いたら抑制解除 → その後また深くスクロールすれば出る
    pane.scrollTop = 0; pane.dispatch("scroll"); env.flushRaf();
    pane.scrollTop = 1000; pane.dispatch("scroll"); env.flushRaf();
    assert.equal(totop.classList.contains("on"), true);
  } finally { t.cleanup(); }
});

test("生成物の <script> ブロックが構文として成立する (文法回帰の防壁)", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | 送信ボタンをタップ | CTA | — | 02-done へ遷移 | — | 本書「画面遷移」 |",
    ]));
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const html = t.html();
    // 他の単定は生成された「ソース文字列」を見るだけなので、SCRIPT テンプレートに
    // 構文エラーが入っても全部 green のまま index.html が完全に死ぬ。ここで実際に
    // パースして塞ぐ (依存ゼロ・実行はしないので副作用なし)。
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(blocks.length >= 2, `script ブロックが少なすぎる: ${blocks.length}`);
    for (const [i, src] of blocks.entries()) {
      assert.doesNotThrow(() => new Function(src), `script ブロック ${i} が構文エラー`);
    }
  } finally { t.cleanup(); }
});

test("chrome 文言の言語スイッチ: ja に英語 chrome が出ず、en に日本語 chrome が出ない", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | 送信ボタンをタップ | CTA | — | 02-done へ遷移 | — | 本書「画面遷移」 |",
    ]));
    assert.equal(t.run().status, 0);
    const ja = t.html();
    // welcome 見出しも show() と同じ言語スイッチを通ること (片方だけ直書きすると片言語に漏れる)
    assert.match(ja, /"成果物インデックス"/);
    assert.doesNotMatch(ja, /"Artifact Index"/);
    assert.equal(t.run(["--lang", "en"]).status, 0);
    const en = t.html();
    assert.match(en, /"Artifact Index"/);
    assert.doesNotMatch(en, /"成果物インデックス"/);
  } finally { t.cleanup(); }
});

test("GFM 整列マーカーの区切り行 (|:---|) をカード化しない", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "|:---|:---|:---|:---|:---|:---|---:|", // 整列マーカー入り区切り行 (人間手編集で混入しうる)
      "| EV-01 | タップ | CTA | — | 遷移 | — | 本書「画面遷移」 |",
    ]));
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const html = t.html();
    assert.match(html, /EV-01/);
    assert.doesNotMatch(html, /ev-id">:---/); // 区切り行が id=":---" のカードにならない
  } finally { t.cleanup(); }
});

test("セル内のエスケープ済みパイプ (\\|) は区切りにせずセル値として復元する", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | 「はい \\| いいえ」を選択 | メインコンテンツ | — | 選択に応じ分岐 | — | 本書「画面遷移」 |",
    ]));
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const html = t.html();
    assert.match(html, /EV-01/); // 8 セル扱いで行ごと落ちない
    assert.match(html, /はい \| いいえ/);
  } finally { t.cleanup(); }
});

test("列数不一致の行はスキップしつつ warn を出す (無音で捨てない)", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | タップ | CTA | — | 遷移 | — | 本書「画面遷移」 |",
      "| EV-02 | 6 列しかない行 | — | — | — | 根拠 |",
    ]));
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /列数不一致/);
    const html = t.html();
    assert.match(html, /EV-01/);
    assert.doesNotMatch(html, /ev-id">EV-02/);
  } finally { t.cleanup(); }
});

test("ルート絶対パスのリンクは書き換えず、fenced code block 内のリンクも原文保存", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | タップ | CTA | — | 遷移 | — | [abs](/etc/passwd) |",
    ]) + "\n## 補足\n\n```\n[example](../requirements/04-use-cases.md)\n```\n");
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const html = t.html();
    // 絶対パスは相対化しない (旧実装は screens/etc/passwd に化けさせていた)
    assert.doesNotMatch(html, /screens\/etc\/passwd/);
    // code block 内はコード例なので付け替えない (原文どおり ../ が残る)
    assert.match(html, /\[example\]\(\.\.\/requirements\/04-use-cases\.md\)/);
  } finally { t.cleanup(); }
});

test("操作イベント配下の fenced code block 内の例示行はカード化しない", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | タップ | CTA | — | 遷移 | — | 本書「画面遷移」 |",
      "",
      "```",
      "| EX-99 | コード例の行 | — | — | — | — | 例示 |",
      "```",
    ]));
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const html = t.html();
    assert.match(html, /ev-id">EV-01/);
    assert.doesNotMatch(html, /ev-id">EX-99/); // fence 内の例示は実イベントカードにしない (md 本文のコード表示は残る)
    assert.doesNotMatch(r.stderr, /列数不一致/); // 例示行への誤警告も出さない
  } finally { t.cleanup(); }
});

test("inline code span 内の md リンク例は逐語保存 (rewrite しない)", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", specMd([
      "| EV-01 | タップ | CTA | — | 遷移 | — | [UC-01](../requirements/04-use-cases.md) |",
    ]) + "\n根拠リンクは `[UC-01 基本2](../requirements/04-use-cases.md)` 形式で書く。\n");
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const html = t.html();
    // 表セル内の実リンクは付け替わる
    assert.match(html, /href="requirements\/04-use-cases\.md"/);
    // backtick 内の文法例は原文のまま (../ が保存され、<code> で表示される)
    assert.match(html, /<code>\[UC-01 基本2\]\(\.\.\/requirements\/04-use-cases\.md\)<\/code>/);
  } finally { t.cleanup(); }
});

test("### レベル違いの見出しは記載ありと誤認しない (行頭 ## アンカー判定・2 セクション)", () => {
  const t = setup();
  try {
    t.write("screens/01-home.md", "# ホーム 画面仕様\n\n### 振る舞い詳細\n\n### データ項目\n\n## 画面遷移\n- なし\n");
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(t.html(), /振る舞い詳細 \/ データ項目 未記載/); // h3 は正規セクションではない → 両方未記載扱い
  } finally { t.cleanup(); }
});

test("dual-theme main ({slug}--light/--dark) でも並べて表示ビューが付与される (light 優先)", () => {
  const t = setup();
  try {
    // single-theme の default HTML を消し、dual-theme main のみにする
    rmSync(join(t.app, "screens/mobile/01-home.html"));
    t.write("screens/mobile/01-home--light.html", "<!DOCTYPE html><html><body>light</body></html>\n");
    t.write("screens/mobile/01-home--dark.html", "<!DOCTYPE html><html><body>dark</body></html>\n");
    t.write("screens/mobile/01-home--empty.html", "<!DOCTYPE html><html><body>substate</body></html>\n");
    t.write("screens/01-home.md", specMd([
      "| EV-01 | タップ | CTA | — | 遷移 | — | 本書「画面遷移」 |",
    ]));
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const html = t.html();
    assert.match(html, /画面と並べて表示/); // theme suffix 付き main でも split が付く
    assert.match(html, /01-home--light\.html/); // light を優先採用
    assert.doesNotMatch(html, /data-src="[^"]*01-home--empty\.html"/); // sub-state は iframe 対象にしない
  } finally { t.cleanup(); }
});

test("RELMAP の inline <script> は \\u003c エスケープで注入耐性を持つ", () => {
  const t = setup();
  try {
    // "<" を含むファイル名 (APFS/ext4 で合法) が </script> 断片を作れないこと
    t.write("screens/01-a<b.md", "# a<b 画面仕様\n");
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const relmapLine = t.html().split("\n").find((ln) => ln.includes("__RELMAP__"));
    assert.ok(relmapLine, "RELMAP line missing");
    assert.match(relmapLine, /u003c/);
    assert.doesNotMatch(relmapLine.replace(/^<script>/, "").replace(/<\/script>$/, ""), /</);
  } finally { t.cleanup(); }
});
