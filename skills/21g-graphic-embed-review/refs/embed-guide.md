# 21g 埋め込み承認ガイド (anchor 選定・提示テンプレート・差し戻し 3 分類・却下)

`skills/21g-graphic-embed-review/SKILL.md` の Step 2〜4 (対話) 実行時のみ Read する参照資料。
routing / 分岐判断は SKILL.md 側、決定的検証・書き込みは `scripts/` 側の責務であり、本書は
**挿入位置 (anchor) をどう決め、user にどう提示・確定させ、修正指示をどう分類するか** だけを定義する。

## §1 挿入位置 (anchor) の決め方 (挿入位置の判断のみ LLM — html_transform_policy)

1 placement = 1 埋め込み先ファイル × 1 挿入位置。`embed-graphics.mjs apply` の stdin に渡す
`insert_before` / `insert_after` は **対象ファイル内で一意な逐語 HTML スニペット** (script が
一意 1 件を機械検査する — 出現 0 / 2 件以上は `E_ANCHOR`):

- **判断素材**: slot の `placements[].placement` (21b 確定の配置記述) + `spec_file`
  (`screens/{screen}.md`) + 対象 main HTML の該当ブロック (**部分参照** — 全文 Read しない。
  context 保護。anchor 候補の探索は Grep で行う)。
- **anchor の選び方**: placement が指す領域の**直近の構造タグ**を逐語コピーする (開始タグ 1 行
  で一意になるならそれで足りる。一意にならなければ属性ごと・親要素ごと広げる)。
- **`illust-placeholder` を置き換える指定の slot** (plan の placement に明記): placeholder ブロック
  の直前に `insert_before` で埋め込み → apply 成功後、旧 placeholder ブロックを **Edit ツールで
  除去** する (LLM の Edit は backup-on-edit hook が退避する)。除去は当該ブロックのみ —
  周辺の構造・色トークンには触れない。除去漏れ (`data-scene` = graphic_id の残置) は
  `approve --dry-run` が warning で検出する。
- **dual-theme プロジェクト**: `{screen}--light.html` / `--dark.html` は**両方 main** であり、
  gather の `embed_targets` に両方載る。同じ論理位置に同じ anchor が使えることが多いが、
  theme 間で markup が違う場合はファイルごとに anchor を変えてよい (placements はファイル単位)。
- `<img>` タグ自体は script が組み立てる (C-26 準拠は script が担保) — LLM がタグ文字列を
  書かない。

## §2 width / height / object_fit の決め方

- **基準は prompts の `size_px`** (21d 確定値 — gather が slot ごとに返す)。基本はそのまま
  `attrs.width` / `attrs.height` に使う。
- 21d の notes に「表示寸の 2 倍で生成 (Retina)」等の記載がある slot は、**表示寸** (= size_px の
  1/2) を width/height にする。
- **同一 slot が複数 platform に跨り表示枠が platform ごとに違う場合** (web 全幅 hero を mobile の
  390px 枠にも置く等): ファイルごとに**埋め込み先の枠寸**を width/height に採用してよい。
  アスペクト比が size_px と一致していることを確認し、ずれる場合のみ `object_fit` を付ける
  (size_px は正典画像の実寸 = 最大表示寸であり、縮小表示は劣化しない)。
- `object_fit`: 埋め込み先の枠 (カード / placeholder) と画像のアスペクト比がずれる場合のみ
  `cover` (領域全面を埋める・見切れ許容) / `contain` (全体を見せる・余白許容) を指定する
  (C-26 — この 2 値以外は script が弾く)。比が合っていれば省略。
- `class`: 既存 CSS の画像用 class (例: カード内サムネイル共通 class) がある場合のみ流用する。
  **新しい style / class を発明しない** (画面の見た目統制は既存トークン・既存 CSS の責務)。

## §3 一括提示フォーマット (plain chat + 視覚レポート)

**全 slot を 1 回で提示する** (1 箇所ずつの逐次確認にしない — slot 数分の往復は過剰質問
(P4-07) に近づく。修正指示は slot 指定で受け付ける)。視覚レポート (auto-open 済み) を主、
チャットの概要表を従とする:

```
## グラフィック埋め込み結果 ({slot_count} 箇所)

視覚レポート (ブラウザで自動表示): graphics/graphic-embed-review.html
ハイライトリングが埋め込み位置です。

| # | graphic_id | 画面 (platform) | 配置 | 表示寸 | 埋め込み先 |
|---|---|---|---|---|---|
| 1 | {graphic_id} | {screen} ({platforms}) | {placement} | {width}×{height} | {embed_targets の file 数} ファイル |
```

- 却下済み slot (`excluded_slots` に 21g 却下で載ったもの) がある再提示では、表の下に
  「却下済み: {graphic_id} — {reason}」を明示する。

## §4 確定確認 (AskUserQuestion)

提示の前に `commit-approval.mjs approve --dry-run` で埋め込み完全性を検証しておく (user には
検証済みの状態だけを見せる)。`header` は 12 文字以内厳守:

```
header: "埋め込み承認"

question: |
  全 {slot_count} 箇所のグラフィック埋め込みを提示しました (視覚レポート参照)。
  この内容で承認してよいですか? 承認すると画面仕様書に「使用グラフィック」節を追記し、
  Step 15 (2nd Confluence save) → Step 22 (Figma export) に進みます。
  修正は「どの箇所をどうしたいか」で指示できます (例: 「hero-home はもっと下に」
  「empty-cart は絵柄を変えたい」「この絵は外したい」)。

options:
  - label: "この内容で承認"
    description: "全 slot の埋め込みを承認して Step 15 (2nd save) へ進む"
  - label: "修正指示あり"
    description: "slot 指定の修正指示をチャットで受け付け、§5 の 3 分類で routing する"
  - label: "slot を却下する"
    description: "生成済みの絵ごと取り下げる箇所を指定して外す (理由を添えて記録される)"
  - label: "保留"
    description: "何も書かず終了し、次回セッションで 21g を再開する"
```

- 「全部やめたい」が出たら全 slot 却下 (= ブロック中止と同義、`decision=skip` /
  `decided_by=step21g`) になることを説明して確認する。

## §5 修正指示の 3 分類 routing (設計 §9-2b — 意図を必ずディスク状態に落とす)

指示を slot 単位に分解し、以下で分類する。**分類に迷ったら user に確認する** (分類を誤ると
再課金の要否が変わる):

| 分類 | 判別基準 (指示の内容が) | routing |
|---|---|---|
| **配置起因** | 位置・大きさ (表示寸)・object-fit・class など **絵は変えない** | 21g 内で完結 — 修正版 placements で `embed-graphics.mjs apply` を再実行 (冪等 — 旧タグは除去される)。placeholder 除去のやり直し等は Edit で。**state 書き込み不要** (未承認のまま = resume は 21g に戻る) |
| **生成品質起因** | 同じ内容でリトライしたい (「なんか崩れてる」「もう一度ガチャ」) — **プロンプトは変えない** | `route-rework.mjs {app_name} quality --stdin` — 当該 `generated_files[]` entry を削除 + 21e/21f 完了記録をクリア → resume cascade が 21e (当該 slot のみ再生成) へ |
| **プロンプト起因** | 内容・構図・被写体を変えたい (「キャラクターにしたい」「ポーズを変えて」) | `route-rework.mjs {app_name} prompt --stdin` — `prompts_confirmed_at` クリア + `rework_pending[]` append を原子的に → resume cascade が 21d (差し戻しモード) へ |

- routing script は **dry-run → 実行** の順で呼ぶ。実行後は「差し戻しを記録しました。
  {21d/21e} から再開します」を報告してセッションの 21g を終了する (以降は resume cascade)。
- 生成レイヤへ戻る経路では `step21e_completed_at` / `step21f_completed_at` も script がクリアする。
  いずれの差し戻しも `decision` は変更しない (`generate` のまま — script が保証し、eval が固定する)。
  **本 §5 が差し戻し routing の分類判別・手順・state 書き込み内容の正本** (orchestrator / SKILL.md
  は本節への pointer + 呼び出しのみ持つ)。
- **分類が複数に跨る指示** (例: 「hero-home はプロンプト変更、empty-cart はリトライ」) は、
  配置起因を先に処理 (apply 再実行) してから、routing を分類ごとに続けて呼ぶ (prompt →
  quality の順不同で再入可 — 全指示を記録してからセッションを終了する。1 件でも記録漏れが
  あると中断後に消失する)。
- **テイスト自体の変更** (「全部もっとポップに」等、style_directive に及ぶもの) は 21g では
  受けない — 21c 差し戻しは全 slot stale 化 = 全量再生成のコスト暴発経路のため v1 非対応
  (設計 §9-2b / §11)。その旨と手動リセット運用 (設計 §5) を案内し、承認 / 却下 / 保留を再確認する。
- いずれの修正指示も **Pattern A を `feedback-log.md` に記録** し、entry に分類 (配置 / 品質 /
  プロンプト / 却下) を併記する (retro が routing の妥当性を見られるように)。

## §6 却下 (per-slot 取り下げ、設計 §11 — F-7 で採用)

生成・埋め込みまで済んだ slot を**絵ごと取り下げる**操作 (再生成しない):

1. reason (却下理由) を user から聞き取る (無言の取り下げ禁止 — Operating Principle 4)。
2. `commit-approval.mjs {app_name} reject --stdin` (dry-run → 実行)。script が
   (a) 埋め込み済みタグの除去、(b) `generated_files[]` entry 削除 + `excluded_slots[]` append
   (reason に「21g 却下:」prefix)、(c) 全 slot 却下時の `decision=skip, decided_by=step21g` 転換
   を一括で行う。
3. 正典 `screens/_shared/graphics/` のファイルは**削除されない** (孤児として残る — 復活は
   設計 §5 の手動リセット運用)。その旨を user に伝える。
4. **placeholder 置き換え型 slot の却下** (script が warning で指摘する): §1 で placeholder
   ブロックを Edit 除去済みのため、タグ除去後は当該領域にイラストも placeholder も無い。
   `_backup/` の apply 前スナップショットから旧 placeholder ブロックを **Edit で戻す**
   (Step 21 承認時点の見た目に復帰させる)。戻すのは当該ブロックのみ。
5. 残 slot があれば視覚レポートを再生成して §3 の再提示へ。**Pattern A を記録** (分類: 却下)。
- 21d へ差し戻して omit する経路は**存在しない** (21d は差し戻し slot の omit を `E_VALIDATION`
  で弾く — 生成済み slot の取り下げは本手順が唯一の経路)。

## §7 再入・冪等性の扱い

- gather の `mode == "re-embed"` (既埋め込みタグ検出) は、配置起因修正のやり直し・中断再入の
  シグナル。`embed-graphics.mjs apply` は対象 graphic_id の既存タグを除去してから挿入する
  (冪等) — 手動でタグを消さない。
- 承認済み (`E_ALREADY_APPROVED`) は再質問しない (P4-07)。埋め込みのやり直しは設計 §5 の
  手動リセット 3 点セットによる。
- 保留はいっさい state を書かない — `graphics_human_approved` 未 set が次回 resume cascade の
  21g 再起動 signal (設計 §9-1 分岐 3 の else)。
